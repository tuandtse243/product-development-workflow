import { parseDelta, parseSpec, type ParsedDelta, type RequirementBlock } from "./parse.js";

export interface MergeSummary {
  added: string[];
  modified: string[];
  removed: string[];
  renamed: { from: string; to: string }[];
}

export interface MergeResult {
  ok: boolean;
  /** merged spec text; present only when ok */
  text?: string;
  /** true when the capability had no main spec yet */
  created: boolean;
  summary: MergeSummary;
  errors: string[];
}

function titleFromCapability(capability: string): string {
  const last = capability.split("/").filter(Boolean).pop() ?? capability;
  return last
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renameRaw(raw: string, to: string): string {
  const nl = raw.indexOf("\n");
  const rest = nl < 0 ? "" : raw.slice(nl);
  return `### Requirement: ${to}${rest}`;
}

function render(prefix: string, blocks: string[], suffix: string): string {
  const parts = [prefix.replace(/\s+$/, "")];
  if (blocks.length) parts.push(blocks.join("\n\n"));
  if (suffix) parts.push(suffix);
  return `${parts.join("\n\n")}\n`;
}

/** Cross-operation conflicts inside one delta (the same requirement touched twice). */
function conflictErrors(d: ParsedDelta): string[] {
  const errors: string[] = [];
  const dupes = (label: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) errors.push(`${label} lists "${k}" more than once`);
      seen.add(k);
    }
  };
  const added = d.added.map((b) => b.key);
  const modified = d.modified.map((b) => b.key);
  const removed = d.removed.map((b) => b.key);
  const renFrom = d.renamed.map((r) => r.from);
  const renTo = d.renamed.map((r) => r.to);
  dupes("ADDED", added);
  dupes("MODIFIED", modified);
  dupes("REMOVED", removed);
  dupes("RENAMED FROM", renFrom);
  dupes("RENAMED TO", renTo);

  const both = (a: string[], b: string[], msg: string) => {
    for (const k of a) if (b.includes(k)) errors.push(msg.replace("%s", k));
  };
  both(added, [...modified, ...removed, ...renFrom], 'requirement "%s" is ADDED and also modified, removed or renamed');
  both(modified, removed, 'requirement "%s" is both MODIFIED and REMOVED');
  both(modified, renFrom, 'MODIFIED "%s" uses the old name of a RENAMED requirement; use the new name');
  both(removed, renTo, 'requirement "%s" is renamed and then REMOVED');
  return errors;
}

/**
 * Applies a delta spec to a main spec deterministically.
 * Order: RENAMED -> REMOVED -> MODIFIED -> ADDED. Header matching is exact after whitespace normalization.
 * All-or-nothing: any error leaves `text` undefined.
 */
export function applyDelta(mainText: string | null, deltaText: string, capability: string): MergeResult {
  const delta = parseDelta(deltaText);
  const summary: MergeSummary = { added: [], modified: [], removed: [], renamed: [] };
  const errors = [...delta.issues.filter((i) => i.level === "error").map((i) => `line ${i.line}: ${i.message}`)];
  errors.push(...conflictErrors(delta));

  const created = mainText === null;
  // A main spec without "## Requirements" is tolerated: parseSpec appends the section to its prefix.
  const main = mainText === null ? null : parseSpec(mainText);

  if (created && (delta.modified.length || delta.removed.length || delta.renamed.length)) {
    errors.push(`capability "${capability}" has no main spec yet; only ADDED requirements are allowed`);
  }

  // Ordered working list of requirement blocks.
  const reqs: { key: string; raw: string }[] = (main?.requirements ?? []).map((r) => ({ key: r.key, raw: r.raw }));
  const indexOf = (key: string) => reqs.findIndex((r) => r.key === key);
  const caseHint = (key: string) => {
    const near = reqs.find((r) => r.key.toLowerCase() === key.toLowerCase());
    return near ? ` (did you mean "${near.key}"? header matching is exact)` : "";
  };

  for (const r of delta.renamed) {
    const i = indexOf(r.from);
    if (i < 0) {
      errors.push(`RENAMED: requirement "${r.from}" not found${caseHint(r.from)}`);
      continue;
    }
    if (indexOf(r.to) >= 0) {
      errors.push(`RENAMED: target name "${r.to}" already exists`);
      continue;
    }
    const cur = reqs[i] as { key: string; raw: string };
    reqs[i] = { key: r.to, raw: renameRaw(cur.raw, r.to) };
    summary.renamed.push({ from: r.from, to: r.to });
  }

  for (const b of delta.removed) {
    const i = indexOf(b.key);
    if (i < 0) {
      errors.push(`REMOVED: requirement "${b.key}" not found${caseHint(b.key)}`);
      continue;
    }
    reqs.splice(i, 1);
    summary.removed.push(b.key);
  }

  for (const b of delta.modified) {
    const i = indexOf(b.key);
    if (i < 0) {
      errors.push(`MODIFIED: requirement "${b.key}" not found${caseHint(b.key)}`);
      continue;
    }
    reqs[i] = { key: b.key, raw: b.raw };
    summary.modified.push(b.key);
  }

  for (const b of delta.added as RequirementBlock[]) {
    if (indexOf(b.key) >= 0) {
      errors.push(`ADDED: requirement "${b.key}" already exists; use MODIFIED`);
      continue;
    }
    reqs.push({ key: b.key, raw: b.raw });
    summary.added.push(b.key);
  }

  if (errors.length) return { ok: false, created, summary, errors };

  let prefix: string;
  let suffix = "";
  if (main) {
    prefix = main.prefix;
    suffix = main.suffix;
  } else {
    const purpose = delta.purpose?.trim() || "TBD - describe what this capability is for.";
    prefix = `# ${titleFromCapability(capability)}\n\n## Purpose\n\n${purpose}\n\n## Requirements`;
  }
  return { ok: true, text: render(prefix, reqs.map((r) => r.raw), suffix), created, summary, errors };
}
