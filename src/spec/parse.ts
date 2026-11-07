/**
 * Parser for aidw specs and delta specs.
 *
 * Main spec (.aidw/specs/<capability>/spec.md):
 *   # <Title>
 *   ## Purpose
 *   ## Requirements
 *   ### Requirement: <name>
 *   <description, SHALL/MUST>
 *   #### Scenario: <name>
 *   - **GIVEN** / **WHEN** / **THEN** / **AND**
 *
 * Delta spec (.aidw/changes/<id>/specs/<capability>/spec.md):
 *   ## ADDED | MODIFIED | REMOVED | RENAMED Requirements
 *
 * Headings inside fenced code blocks are ignored.
 */

export interface Line {
  text: string;
  /** 1-based line number */
  no: number;
  /** true when the line is inside (or delimits) a fenced code block */
  fenced: boolean;
}

export interface Scenario {
  name: string;
  line: number;
  hasTrigger: boolean;
  hasOutcome: boolean;
}

export interface Issue {
  level: "error" | "warning";
  line: number;
  message: string;
}

export interface RequirementBlock {
  name: string;
  /** whitespace-normalized name used for matching */
  key: string;
  line: number;
  /** full block text, header included, trailing blank lines trimmed */
  raw: string;
  description: string;
  scenarios: Scenario[];
  issues: Issue[];
  /** REMOVED blocks only */
  reason?: string;
  migration?: string;
}

export interface ParsedSpec {
  title?: string;
  purpose?: string;
  hasPurpose: boolean;
  hasRequirementsSection: boolean;
  requirements: RequirementBlock[];
  /** text before the first requirement (title, purpose, "## Requirements" header, preamble) */
  prefix: string;
  /** text from the first level-2 heading after the requirements section */
  suffix: string;
}

export interface Rename {
  from: string;
  to: string;
  line: number;
}

export interface ParsedDelta {
  purpose?: string;
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: RequirementBlock[];
  renamed: Rename[];
  /** ## headings that are not a known delta section */
  unknownSections: { name: string; line: number }[];
  issues: Issue[];
}

const H1 = /^#(?!#)\s+(.*\S)\s*$/;
const H2 = /^##(?!#)\s+(.*\S)\s*$/;
const REQ = /^###(?!#)\s+Requirement:\s*(.*\S)\s*$/;
const SCEN = /^####(?!#)\s+Scenario:\s*(.*\S)\s*$/;
const WRONG_SCEN = /^(?:#{1,3}|#{5,})\s+Scenario:|^\s*[-*]\s+(?:\*\*)?Scenario\b/i;
const STEP = /^\s*[-*]\s+\*\*(GIVEN|WHEN|THEN|AND)\*\*/i;
const FENCE = /^\s*(```|~~~)/;
const DELTA_SECTION = /^(ADDED|MODIFIED|REMOVED|RENAMED)(?:\s+Requirements?)?$/i;

export function normalizeKey(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function toLines(text: string): Line[] {
  const out: Line[] = [];
  let inFence = false;
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((t, i) => {
      const isFence = FENCE.test(t);
      if (isFence) inFence = !inFence;
      out.push({ text: t, no: i + 1, fenced: inFence || isFence });
    });
  return out;
}

function joinTrim(lines: Line[]): string {
  return lines
    .map((l) => l.text)
    .join("\n")
    .replace(/\s+$/, "");
}

function isH2(l: Line): RegExpMatchArray | null {
  return l.fenced ? null : l.text.match(H2);
}

/** Index of the next level-2 heading at or after `from`, or lines.length. */
function nextH2(lines: Line[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    const l = lines[i];
    if (l && isH2(l)) return i;
  }
  return lines.length;
}

/** Parses `### Requirement:` blocks in lines[start, end). Returns blocks and the preamble before the first block. */
export function parseRequirementBlocks(
  lines: Line[],
  start: number,
  end: number,
): { blocks: RequirementBlock[]; preamble: Line[] } {
  const headers: number[] = [];
  for (let i = start; i < end; i++) {
    const l = lines[i];
    if (l && !l.fenced && REQ.test(l.text)) headers.push(i);
  }
  const preamble = lines.slice(start, headers[0] ?? end);
  const blocks = headers.map((h, idx) => {
    const blockEnd = headers[idx + 1] ?? end;
    return parseBlock(lines.slice(h, blockEnd));
  });
  return { blocks, preamble };
}

function parseBlock(block: Line[]): RequirementBlock {
  const header = block[0] as Line;
  const name = (header.text.match(REQ)?.[1] ?? "").trim();
  const issues: Issue[] = [];
  const scenarios: Scenario[] = [];
  const descLines: Line[] = [];
  let current: Scenario | null = null;

  for (const l of block.slice(1)) {
    if (!l.fenced) {
      const sm = l.text.match(SCEN);
      if (sm) {
        current = { name: (sm[1] ?? "").trim(), line: l.no, hasTrigger: false, hasOutcome: false };
        scenarios.push(current);
        continue;
      }
      if (WRONG_SCEN.test(l.text)) {
        issues.push({
          level: "error",
          line: l.no,
          message: 'Scenario heading must be exactly "#### Scenario: <name>" (4 hashes)',
        });
      }
      const step = l.text.match(STEP);
      if (step && current) {
        const kw = (step[1] ?? "").toUpperCase();
        if (kw === "WHEN" || kw === "GIVEN") current.hasTrigger = true;
        if (kw === "THEN") current.hasOutcome = true;
      }
    }
    if (!current) descLines.push(l);
  }

  const raw = joinTrim(block);
  const removedMeta = extractRemovedMeta(raw);
  return {
    name,
    key: normalizeKey(name),
    line: header.no,
    raw,
    description: joinTrim(descLines).trim(),
    scenarios,
    issues,
    ...removedMeta,
  };
}

function extractRemovedMeta(raw: string): { reason?: string; migration?: string } {
  const pick = (label: string): string | undefined => {
    const re = new RegExp(`(?:\\*\\*${label}:?\\*\\*|^${label})\\s*:?\\s*(.*\\S)`, "im");
    return raw.match(re)?.[1]?.trim();
  };
  const reason = pick("Reason");
  const migration = pick("Migration");
  return { ...(reason ? { reason } : {}), ...(migration ? { migration } : {}) };
}

export function parseSpec(text: string): ParsedSpec {
  const lines = toLines(text);
  let title: string | undefined;
  for (const l of lines) {
    if (l.fenced) continue;
    const m = l.text.match(H1);
    if (m) {
      title = m[1];
      break;
    }
  }

  let purpose: string | undefined;
  let hasPurpose = false;
  let reqStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as Line;
    const m = isH2(l);
    if (!m) continue;
    const heading = (m[1] ?? "").trim().toLowerCase();
    if (heading === "purpose") {
      hasPurpose = true;
      purpose = joinTrim(lines.slice(i + 1, nextH2(lines, i + 1))).trim();
    } else if (heading === "requirements" && reqStart < 0) {
      reqStart = i;
    }
  }

  if (reqStart < 0) {
    return {
      ...(title ? { title } : {}),
      ...(purpose !== undefined ? { purpose } : {}),
      hasPurpose,
      hasRequirementsSection: false,
      requirements: [],
      prefix: `${joinTrim(lines)}\n\n## Requirements`.replace(/^\s+/, ""),
      suffix: "",
    };
  }

  const reqEnd = nextH2(lines, reqStart + 1);
  const { blocks, preamble } = parseRequirementBlocks(lines, reqStart + 1, reqEnd);
  return {
    ...(title ? { title } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    hasPurpose,
    hasRequirementsSection: true,
    requirements: blocks,
    prefix: joinTrim([...lines.slice(0, reqStart + 1), ...preamble]),
    suffix: joinTrim(lines.slice(reqEnd)).trim(),
  };
}

/** Level-2 sections of any markdown document (fenced headings ignored). */
export function sections(text: string): { name: string; line: number; body: string }[] {
  const lines = toLines(text);
  const out: { name: string; line: number; body: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as Line;
    const m = isH2(l);
    if (!m) continue;
    out.push({ name: (m[1] ?? "").trim(), line: l.no, body: joinTrim(lines.slice(i + 1, nextH2(lines, i + 1))).trim() });
  }
  return out;
}

/** Stable id segment for requirement and scenario names: "Book a slot!" -> "book-a-slot". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanRenameName(s: string): string {
  return normalizeKey(
    s
      .replace(/`/g, "")
      .replace(/^###\s+Requirement:\s*/i, "")
      .trim(),
  );
}

export function parseDelta(text: string): ParsedDelta {
  const lines = toLines(text);
  const out: ParsedDelta = { added: [], modified: [], removed: [], renamed: [], unknownSections: [], issues: [] };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as Line;
    const m = isH2(l);
    if (!m) continue;
    const heading = (m[1] ?? "").trim();
    const end = nextH2(lines, i + 1);

    if (heading.toLowerCase() === "purpose") {
      out.purpose = joinTrim(lines.slice(i + 1, end)).trim();
      continue;
    }
    const op = heading.match(DELTA_SECTION)?.[1]?.toUpperCase();
    if (!op) {
      out.unknownSections.push({ name: heading, line: l.no });
      continue;
    }
    if (op === "RENAMED") {
      let pending: { from: string; line: number } | null = null;
      for (const r of lines.slice(i + 1, end)) {
        if (r.fenced) continue;
        const from = r.text.match(/^\s*(?:[-*]\s*)?FROM:\s*(.*\S)\s*$/i);
        const to = r.text.match(/^\s*(?:[-*]\s*)?TO:\s*(.*\S)\s*$/i);
        if (from) {
          if (pending) out.issues.push({ level: "error", line: pending.line, message: "RENAMED: FROM without matching TO" });
          pending = { from: cleanRenameName(from[1] ?? ""), line: r.no };
        } else if (to) {
          if (!pending) {
            out.issues.push({ level: "error", line: r.no, message: "RENAMED: TO without preceding FROM" });
          } else {
            out.renamed.push({ from: pending.from, to: cleanRenameName(to[1] ?? ""), line: pending.line });
            pending = null;
          }
        }
      }
      if (pending) out.issues.push({ level: "error", line: pending.line, message: "RENAMED: FROM without matching TO" });
      continue;
    }
    const { blocks } = parseRequirementBlocks(lines, i + 1, end);
    if (op === "ADDED") out.added.push(...blocks);
    else if (op === "MODIFIED") out.modified.push(...blocks);
    else out.removed.push(...blocks);
  }
  return out;
}
