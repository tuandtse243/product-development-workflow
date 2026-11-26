/**
 * The architect's round and the Program Design (ADR-0015; D2, D3, I5, Q2 to Q7 of the rpi upgrades).
 *
 * The Software Architect writes the System Design and lists its Design Questions under `### Design Questions` in
 * `## Architecture` of analysis.md, one `- DQ<n>: <question>` bullet each with indented plain lines:
 *
 *   - DQ1: Where do reminder jobs run?
 *     Open: a queue worker | a cron route in the API (recommend: a queue worker)
 *   - DQ2: How are times stored?
 *     Chosen: UTC in the database, shown in the clinic's timezone.
 *     Why: patients book across a daylight-saving change (architecture/overview.md, "Time").
 *     Rejected: clinic local time (a clock change moves booked slots by an hour).
 *
 * An `Open:` line is a question the Agent may not settle alone (hard to reverse, options about equal, or it changes
 * cost or operation): at most five per round. The round (stage `system-design-round`, Decision Page `system-design`)
 * puts them to the user; its checked answer is recorded word for word under `### System design round` in
 * `## Architecture`, and each open question becomes a settled one (Chosen, Why, Rejected). With nothing open the round
 * is one question in the chat, recorded as `confirmed: <the user's reply>`. A `Size: small` Change has no round.
 *
 * Then the Architect writes `program-design.md` (stage `program-design`): `## File tree` and `## Signatures and
 * contracts` are required, call trees, component trees, a dependency map and pseudocode are optional. It is part of
 * the approved package (package version 4): code that differs from it is a Deviation.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stateOf, type Change } from "./change.js";
import { Diags } from "./diag.js";
import { fenceTracker } from "./fences.js";
import type { PageSection, PageView, ViewKind } from "./page.js";
import { rel, type Paths } from "./project.js";
import { sections, toLines } from "./spec/parse.js";
import { h3Blocks } from "./beforeafter.js";
import type { Workflow } from "./workflow.js";

/** The analysis.md template from which a Change owes the round and the Program Design. */
export const PROGRAM_DESIGN_TEMPLATE = 3;
export const PROGRAM_DESIGN_FILE = "program-design.md";
export const DESIGN_QUESTIONS = "Design Questions";
export const SYSTEM_DESIGN_ROUND = "System design round";
/** D2, Q6: at most this many open Design Questions in one round; the Architect settles the rest with reasons. */
export const MAX_OPEN_QUESTIONS = 5;
/** I5, Q2: the parts every Program Design has (the short one of a small Change has only these). */
export const REQUIRED_PARTS = ["File tree", "Signatures and contracts"] as const;
/** I5, Q3: parts added where they help, and the kind of View each is shown as at the gate. */
export const OPTIONAL_PARTS: Record<string, ViewKind> = { "Call trees": "calltree", "Component trees": "component", "Dependency map": "tree", Pseudocode: "pseudocode" };
const PLACEHOLDER = "TODO(aidw)";
const ARCHITECTURE = "architecture";
/** The states before the Approval Gate: the file tree is compared with the code only while nothing is built. */
const BEFORE_GATE = new Set(["draft", "intake", "analyzing", "awaiting_approval"]);

/** Recorded on the Change when it is created (`analysis_template`), so an older Change is never asked for it. */
export const owesProgramDesign = (change: Change): boolean => Number(change.data.analysis_template) >= PROGRAM_DESIGN_TEMPLATE;

/** The Artifacts the two stages write (artifacts.yaml); a stage is told by what it writes, as the plan review is. */
export const ROUND_ARTIFACT = "analysis-system-design-round";
export const PROGRAM_DESIGN_ARTIFACT = "program-design";

/**
 * What a Change created with template 3 owes, from its Workflow's stages: the Program Design when a stage writes it
 * (not `audit`), the round when a stage writes it and the Change is not `Size: small` (`bugfix` has no round). A
 * Workflow that cannot be read owes both, so a broken plugin never lets a package through unchecked.
 */
export function programDesignDue(change: Change, w: Pick<Workflow, "stages"> | null, small: boolean): { programDesign: boolean; round: boolean } {
  if (!owesProgramDesign(change)) return { programDesign: false, round: false };
  const writes = (a: string) => (w ? w.stages.some((s) => s.writes.includes(a)) : true);
  return { programDesign: writes(PROGRAM_DESIGN_ARTIFACT), round: !small && writes(ROUND_ARTIFACT) };
}

// ------------------------------------------------------------------------------------------- Design Questions

export interface DesignQuestion {
  id: string;
  question: string;
  /** the `Open:` line (options and recommendation) while the question waits for the user */
  open: string | null;
  chosen: string | null;
  why: string | null;
  rejected: string | null;
}

const DQ_LINE = /^\s*[-*]\s+\**(DQ\d+)\**\s*:\s*(\S.*)$/;
const BULLET = /^\s*[-*]\s+\S/;
const FIELD = /^\s+(Open|Chosen|Why|Rejected)\s*:\s*(.*)$/i;

/** The `### <name>` block inside `## Architecture`, with the line of its heading; null when there is none. */
function architectureBlock(analysis: string, name: string): { line: number; lines: string[] } | null {
  const arch = sections(analysis).find((s) => s.name.toLowerCase() === ARCHITECTURE);
  if (!arch) return null;
  const b = h3Blocks(arch.body).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!b) return null;
  const at = toLines(analysis).find((l) => !l.fenced && l.no > arch.line && /^###\s+/.test(l.text) && l.text.replace(/^###\s+/, "").replace(/\s*#*\s*$/, "").trim().toLowerCase() === name.toLowerCase());
  return { line: at?.no ?? arch.line, lines: b.lines };
}

/** The Design Questions of `## Architecture`, "None", and the bullets that are not `- DQ<n>: ...`; null when the block is missing. */
export function designQuestionsOf(analysis: string): { line: number; none: boolean; items: DesignQuestion[]; bad: string[]; text: string } | null {
  const b = architectureBlock(analysis, DESIGN_QUESTIONS);
  if (!b) return null;
  const items: DesignQuestion[] = [];
  const bad: string[] = [];
  let none = /^\s*none\b/im.test(b.lines.join("\n"));
  let cur: DesignQuestion | null = null;
  // the field the last indented line went to: a line that is no field continues it
  let last: "question" | "open" | "chosen" | "why" | "rejected" = "question";
  for (const l of b.lines) {
    const m = DQ_LINE.exec(l);
    if (m) {
      cur = { id: m[1] as string, question: (m[2] as string).trim(), open: null, chosen: null, why: null, rejected: null };
      last = "question";
      items.push(cur);
      continue;
    }
    if (BULLET.test(l)) {
      cur = null;
      if (/^\s*[-*]\s+none\b/i.test(l)) none = true;
      else bad.push(l.trim());
      continue;
    }
    const f = cur ? FIELD.exec(l) : null;
    if (cur && f) {
      const key = (f[1] as string).toLowerCase() as "open" | "chosen" | "why" | "rejected";
      cur[key] = (f[2] as string).trim();
      last = key;
    } else if (cur && /^\s+\S/.test(l)) {
      cur[last] = `${cur[last] ?? ""} ${l.trim()}`.trim(); // a long line wrapped onto the next indented line
    } else if (!/^\s*$/.test(l)) cur = null;
  }
  return { line: b.line, none, items, bad, text: b.lines.join("\n") };
}

/** The Design Questions still waiting for the user (an `Open:` line). */
export const openQuestions = (analysis: string): DesignQuestion[] => (designQuestionsOf(analysis)?.items ?? []).filter((q) => q.open !== null);

/** `### System design round`: the answer lines by question id and the chat confirmation; null when it is missing. */
export function systemDesignRoundOf(analysis: string): { line: number; body: string; answers: string[]; confirmed: string | null } | null {
  const b = architectureBlock(analysis, SYSTEM_DESIGN_ROUND);
  if (!b) return null;
  const body = b.lines.join("\n").trim();
  // `aidw page answers` prints `<id> <title>: <answer>`; a `- ` in front is accepted too
  const answers = [...new Set(b.lines.map((l) => /^\s*(?:[-*]\s+)?\**(DQ\d+)\**\b[^\n]*:\s*\S/.exec(l)?.[1]).filter((x): x is string => !!x))];
  const confirmed = b.lines.map((l) => /^\s*(?:[-*]\s+)?confirmed\s*:\s*(\S.*)$/i.exec(l)?.[1]?.trim()).find((x): x is string => !!x) ?? null;
  return { line: b.line, body, answers, confirmed };
}

const settledProblems = (q: DesignQuestion): string[] => [q.chosen ? "" : '"Chosen:"', q.why ? "" : '"Why:"', q.rejected ? "" : '"Rejected:"'].filter(Boolean);

/**
 * The checks of the Design Questions and the round. `round`: whether this Change owes the round (a `Size: normal`
 * Change); a small one may still list settled questions, and they are checked the same way.
 */
export function checkSystemDesign(analysis: string, file: string, opts: { round: boolean }, d: Diags): void {
  const qs = designQuestionsOf(analysis);
  const how = `list each as "- DQ<n>: <question>" with indented "Chosen:", "Why:" and "Rejected:" lines once settled, or write "None"`;
  if (!qs) {
    if (opts.round) d.error(file, `missing "### ${DESIGN_QUESTIONS}" (under "## Architecture"): ${how}`);
  } else {
    const seen = new Set<string>();
    for (const q of qs.items) {
      if (seen.has(q.id)) d.error(file, `"### ${DESIGN_QUESTIONS}": duplicate ${q.id}`, qs.line);
      seen.add(q.id);
      if (q.open !== null) d.error(file, `"### ${DESIGN_QUESTIONS}": ${q.id} is still open: put it to the user in the system design round, then record what was chosen with "Chosen:", "Why:" and "Rejected:"`, qs.line);
      else {
        const missing = settledProblems(q);
        if (missing.length) d.error(file, `"### ${DESIGN_QUESTIONS}": ${q.id} says no ${missing.join(", no ")}: a settled Design Question records what was chosen, why, and why the other options were not ("Rejected: none" when there were none)`, qs.line);
      }
    }
    for (const l of qs.bad) d.error(file, `"### ${DESIGN_QUESTIONS}": "${l.slice(0, 60)}" must be "- DQ<n>: <question>"`, qs.line);
    if (!qs.none && !qs.items.length && !qs.bad.length) d.error(file, `"### ${DESIGN_QUESTIONS}": ${how}`, qs.line);
  }
  if (!opts.round) return;
  const round = systemDesignRoundOf(analysis);
  const record = `ask the open Design Questions on the \`system-design\` Decision Page (or, with none open, one question in the chat) and record the checked answer under "### ${SYSTEM_DESIGN_ROUND}" in "## Architecture"`;
  if (!round || !round.body || round.body.includes(PLACEHOLDER)) {
    d.error(file, `the system design round is not recorded: ${record}`);
    return;
  }
  if (!round.answers.length && !round.confirmed) d.error(file, `"### ${SYSTEM_DESIGN_ROUND}" has no answer: a line per question asked ("DQ1 <title>: <answer>"), or "confirmed: <the user's reply>" when nothing was open`, round.line);
  if (round.answers.length > MAX_OPEN_QUESTIONS) d.error(file, `"### ${SYSTEM_DESIGN_ROUND}" asked ${round.answers.length} Design Questions; a round asks at most ${MAX_OPEN_QUESTIONS} and the Software Architect settles the rest with its reasons`, round.line);
  const known = new Set((qs?.items ?? []).map((q) => q.id));
  for (const id of round.answers) {
    if (!known.has(id)) d.error(file, `"### ${SYSTEM_DESIGN_ROUND}" answers ${id}, which "### ${DESIGN_QUESTIONS}" does not list`, round.line);
  }
}

/** Why the `system-design-round` stage is not done yet, or null. A small Change skips the round. */
export function systemDesignRoundBlocker(analysis: string | null, small: boolean): string | null {
  if (small) return null;
  if (analysis === null) return "analysis.md is missing";
  const open = openQuestions(analysis);
  if (open.length > MAX_OPEN_QUESTIONS) return `${open.length} Design Questions are open (${open.map((q) => q.id).join(", ")}); a round asks at most ${MAX_OPEN_QUESTIONS}: the Software Architect settles the rest with its reasons`;
  const d = new Diags();
  checkSystemDesign(analysis, "analysis.md", { round: true }, d);
  return d.errors.length ? d.errors.map((e) => e.message).join("; ") : null;
}

/** What the round asks: the open Design Questions on the Decision Page, or (none open) one question in the chat. */
export function roundAdvice(analysis: string | null): string {
  if (analysis === null) return "";
  const qs = designQuestionsOf(analysis);
  if (!qs) return `the Software Architect lists no "### ${DESIGN_QUESTIONS}" in "## Architecture" yet`;
  const open = qs.items.filter((q) => q.open !== null);
  if (open.length > MAX_OPEN_QUESTIONS) return `${open.length} Design Questions are open (${open.map((q) => q.id).join(", ")}); at most ${MAX_OPEN_QUESTIONS}: spawn the Software Architect again to settle the rest`;
  if (open.length) return `${open.length} open Design Question(s) (${open.map((q) => q.id).join(", ")}): put them on the \`system-design\` Decision Page`;
  return "no Design Question is open: ask one question in the chat (a summary, the link to the architecture and a View) and record the reply as \"confirmed: <reply>\"";
}

// ---------------------------------------------------------------------------------------------- Program Design

export interface FileTreeLine {
  mark: "+" | "~" | "-";
  path: string;
}

export interface Fence {
  lang: string;
  text: string;
}

/** The fenced blocks of a Markdown body, with their language. */
export function fences(body: string): Fence[] {
  const out: Fence[] = [];
  const t = fenceTracker();
  let cur: { lang: string; lines: string[] } | null = null;
  for (const l of body.split(/\r?\n/)) {
    if (!t.step(l)) continue;
    if (!cur) cur = { lang: (/^\s*(?:`{3,}|~{3,})\s*([\w+-]*)/.exec(l)?.[1] ?? "").toLowerCase(), lines: [] };
    else if (!t.open()) {
      out.push({ lang: cur.lang, text: cur.lines.join("\n") });
      cur = null;
    } else cur.lines.push(l);
  }
  return out;
}

/** The `## ` parts of program-design.md by lower-cased name. */
export function programDesignParts(text: string): Map<string, { name: string; line: number; body: string }> {
  return new Map(sections(text).map((s) => [s.name.toLowerCase(), s]));
}

/** The marked lines of the file tree: `+ path` new, `~ path` changed, `- path` removed (inside its fenced blocks). */
export function fileTreeOf(text: string): FileTreeLine[] {
  const part = programDesignParts(text).get("file tree");
  if (!part) return [];
  const out: FileTreeLine[] = [];
  for (const f of fences(part.body)) {
    for (const l of f.text.split("\n")) {
      const m = /^\s*([+~-])\s+([^\s]+)/.exec(l);
      if (m) out.push({ mark: m[1] as FileTreeLine["mark"], path: (m[2] as string).replace(/^\.\//, "") });
    }
  }
  return out;
}

/** The checks `aidw analyze` runs on program-design.md of a Change that owes it. */
export function checkProgramDesign(p: Paths, change: Change, opts: { small: boolean }, d: Diags): void {
  const abs = join(change.dir, PROGRAM_DESIGN_FILE);
  const file = rel(p, abs);
  if (!existsSync(abs)) {
    d.error(file, `${PROGRAM_DESIGN_FILE} is missing: the Software Architect writes the Program Design (${REQUIRED_PARTS.map((x) => `"## ${x}"`).join(" and ")}) after the system design round (/aidw:start step 6)`);
    return;
  }
  const text = readFileSync(abs, "utf8");
  text.split(/\r?\n/).forEach((l, i) => {
    if (l.includes(PLACEHOLDER)) d.error(file, `unresolved ${PLACEHOLDER} placeholder`, i + 1);
  });
  const parts = programDesignParts(text);
  for (const name of REQUIRED_PARTS) {
    const s = parts.get(name.toLowerCase());
    if (!s) d.error(file, `missing "## ${name}"`);
    else if (!s.body) d.error(file, `"## ${name}" is empty`, s.line);
  }
  const treePart = parts.get("file tree");
  const tree = fileTreeOf(text);
  if (treePart?.body && !tree.length) {
    d.error(file, '"## File tree" marks no file: one path from the project root per line in a fenced block, "+ <path>" new, "~ <path>" changed, "- <path>" removed', treePart.line);
  }
  const sig = parts.get("signatures and contracts");
  const sigFences = sig ? fences(sig.body) : [];
  if (sig?.body && !sigFences.length) d.error(file, '"## Signatures and contracts" shows no code: put each signature or contract in a fenced block (a diff for a shape that exists, the full shape for new code)', sig.line);
  if (sigFences.length && tree.some((t) => t.mark === "~") && !sigFences.some((f) => f.lang === "diff")) {
    d.warn(file, '"## Signatures and contracts": the file tree changes existing files (~) but no block is a diff; show a changed shape as a ```diff block', sig?.line);
  }
  if (opts.small) {
    const extra = [...parts.values()].filter((s) => Object.keys(OPTIONAL_PARTS).some((o) => o.toLowerCase() === s.name.toLowerCase()));
    if (extra.length) d.warn(file, `Size: small gets the short Program Design (file tree and signatures); ${extra.map((s) => `"## ${s.name}"`).join(", ")} can go`);
  }
  // The file tree is a diff of today's code: before anything is built, a changed or removed file exists and a new one does not.
  const state = stateOf(change);
  if (state && BEFORE_GATE.has(state)) {
    for (const t of tree) {
      if (/[*?[\]{}]/.test(t.path)) continue;
      const there = existsSync(join(p.project, t.path));
      if (t.mark !== "+" && !there) d.error(file, `"## File tree" marks ${t.path} ${t.mark === "~" ? "changed" : "removed"}, but it does not exist; mark a new file "+"`, treePart?.line);
      if (t.mark === "+" && there) d.warn(file, `"## File tree" marks ${t.path} new, but it exists; mark it "~" and show the change as a diff`, treePart?.line);
    }
  }
}

/** Why the `program-design` stage is not done yet, or null. */
export function programDesignBlocker(p: Paths, change: Change, small: boolean): string | null {
  const d = new Diags();
  checkProgramDesign(p, change, { small }, d);
  return d.errors.length ? d.errors.map((e) => e.message).join("; ") : null;
}

const MAX_VIEW = 20_000;
const cut = (s: string) => (s.length > MAX_VIEW ? `${s.slice(0, MAX_VIEW - 40)}\n... (cut: read program-design.md)` : s);

/** A fenced block as a View: a diff stays a diff; the full shape of new code is shown as added lines. */
function signatureView(f: Fence): PageView {
  if (f.lang === "diff") return { kind: "diff", text: cut(f.text) };
  return { kind: "diff", text: cut(f.text.split("\n").map((l) => `+${l}`).join("\n")) };
}

/** Q4: the gate page's Program Design section, built from program-design.md; null when there is none. */
export function programDesignSection(text: string | null, changeId: string): PageSection | null {
  if (text === null || !text.trim()) return null;
  const parts = programDesignParts(text);
  const views: PageView[] = [];
  const tree = parts.get("file tree");
  for (const f of tree ? fences(tree.body) : []) if (f.text.trim()) views.push({ kind: "tree", text: cut(f.text) });
  const sig = parts.get("signatures and contracts");
  for (const f of sig ? fences(sig.body) : []) if (f.text.trim()) views.push(signatureView(f));
  for (const [name, kind] of Object.entries(OPTIONAL_PARTS)) {
    const s = parts.get(name.toLowerCase());
    for (const f of s ? fences(s.body) : []) if (f.text.trim()) views.push({ kind, text: cut(f.text) });
  }
  if (!views.length) return null;
  return {
    id: "program-design",
    title: "Program Design",
    body: `The files this Change adds, changes and removes, and its main signatures and contracts (.aidw/changes/${changeId}/${PROGRAM_DESIGN_FILE}). You approve it with the package: code that differs from it is a Deviation, decided by the Software Architect and listed in the pull request.`,
    points: [],
    html: "",
    views,
  };
}

// --------------------------------------------------------------------------------------------- Deviation

/**
 * Whether a text names a path as a whole: `app/a.ts` is named in "see app/a.ts." but not in "app/a.tsx" or
 * "lib/app/a.ts".
 */
export function namesPath(text: string, path: string): boolean {
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w./-])${esc}(?![\\w/-]|\\.\\w)`).test(text);
}

/**
 * The paths a change to the Program Design concerns: the file-tree lines added, removed or re-marked, and the paths the
 * file tree names that appear in a part whose text changed. null: the change names no path, so every task reads it.
 */
export function programDesignChangedPaths(before: string | null, after: string | null): string[] | null {
  const b = before ?? "";
  const a = after ?? "";
  const key = (t: FileTreeLine) => `${t.mark} ${t.path}`;
  const was = new Set(fileTreeOf(b).map(key));
  const is = new Set(fileTreeOf(a).map(key));
  const paths = new Set<string>();
  for (const t of [...fileTreeOf(b), ...fileTreeOf(a)]) if (was.has(key(t)) !== is.has(key(t))) paths.add(t.path);
  const pb = programDesignParts(b);
  const pa = programDesignParts(a);
  const all = [...new Set([...fileTreeOf(b), ...fileTreeOf(a)].map((t) => t.path))];
  for (const name of new Set([...pb.keys(), ...pa.keys()])) {
    if (name === "file tree") continue;
    const x = pb.get(name)?.body ?? "";
    const y = pa.get(name)?.body ?? "";
    if (x === y) continue;
    const named = all.filter((path) => namesPath(x, path) || namesPath(y, path));
    if (!named.length) return null;
    for (const path of named) paths.add(path);
  }
  return [...paths];
}
