/**
 * D1 and I9 of the rpi upgrades: `## Before / After` (what the user sees today and after this Change, 3 to 6 lines
 * each) and `### Deferred to architecture` (technical questions raised in discovery, each answered by the Software
 * Architect in `## Architecture`). `aidw analyze` requires both of a Change created with `analysis_template: 2` or later;
 * the gate page shows Before / After first.
 */
import type { Change } from "./change.js";
import type { Diags } from "./diag.js";
import type { PageSection } from "./page.js";
import { sections, toLines } from "./spec/parse.js";

/**
 * The analysis.md template a Change is created with: 2 adds Before / After and Deferred to architecture, 3 the
 * system design round and the Program Design (src/programdesign.ts). Each check asks for its own template or later.
 */
export const ANALYSIS_TEMPLATE = 3;
export const BEFORE_AFTER_TEMPLATE = 2;
export const BEFORE_AFTER = "Before / After";
export const DEFERRED = "Deferred to architecture";
const SCOPE_SECTION = "Requirements and scope";
export const BEFORE_AFTER_LINES = { min: 3, max: 6 } as const;
export const EXISTING_SYSTEM_FILE = "existing-system.md";

/**
 * Whether the Change owes both parts. It is recorded on the Change at creation: deciding it at analyze time would
 * refuse older Changes whose approved analysis.md can no longer change (deviation re-runs the checks after the gate).
 */
export const owesBeforeAfter = (change: Change): boolean => Number(change.data.analysis_template) >= BEFORE_AFTER_TEMPLATE;

const BULLET = /^\s*[-*]\s+(\S.*)$/;
const DEFERRED_LINE = /^\s*[-*]\s+\**(DA\d+)\**\s*:\s*(\S.*)$/;

/** Level-3 blocks (`### Name` and the lines up to the next heading of level 1 to 3), with the heading's line number. */
export function h3Blocks(text: string): { name: string; line: number; lines: string[] }[] {
  const out: { name: string; line: number; lines: string[] }[] = [];
  let cur: { name: string; line: number; lines: string[] } | null = null;
  for (const l of toLines(text)) {
    const h = l.fenced ? null : /^(#{1,3})\s+(.*?)\s*#*\s*$/.exec(l.text);
    if (h) {
      cur = h[1] === "###" ? { name: (h[2] as string).trim(), line: l.no, lines: [] } : null;
      if (cur) out.push(cur);
    } else if (cur) cur.lines.push(l.text);
  }
  return out;
}

const bullets = (lines: string[]): string[] => lines.map((l) => BULLET.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);

/** The Before and After lines of `## Before / After`, or null when the section is missing. */
export function beforeAfterOf(analysis: string): { line: number; before: string[]; after: string[]; beforeText: string; hasBefore: boolean; hasAfter: boolean } | null {
  const s = sections(analysis).find((x) => x.name.toLowerCase() === BEFORE_AFTER.toLowerCase());
  if (!s) return null;
  const blocks = h3Blocks(s.body);
  const find = (name: string) => blocks.find((b) => b.name.toLowerCase() === name);
  const before = find("before");
  const after = find("after");
  return {
    line: s.line,
    before: bullets(before?.lines ?? []),
    after: bullets(after?.lines ?? []),
    beforeText: (before?.lines ?? []).join("\n"),
    hasBefore: !!before,
    hasAfter: !!after,
  };
}

/** The deferred technical questions (`- DA1: ...`), "None", and the lines that are neither; null when the block is missing. */
export function deferredOf(analysis: string): { line: number; none: boolean; items: { id: string; text: string }[]; bad: string[] } | null {
  // Only the block under "## Requirements and scope" counts, never a heading of the same name elsewhere.
  const scope = sections(analysis).find((x) => x.name.toLowerCase() === SCOPE_SECTION.toLowerCase());
  if (!scope) return null;
  const b = h3Blocks(scope.body).find((x) => x.name.toLowerCase() === DEFERRED.toLowerCase());
  if (!b) return null;
  const at = toLines(analysis).find((l) => l.no > scope.line && /^###\s+/.test(l.text) && l.text.replace(/^###\s+/, "").trim().toLowerCase() === DEFERRED.toLowerCase());
  const items: { id: string; text: string }[] = [];
  const bad: string[] = [];
  let none = /^\s*none\b/im.test(b.lines.join("\n"));
  for (const l of b.lines) {
    if (!BULLET.test(l)) continue;
    const m = DEFERRED_LINE.exec(l);
    if (m) items.push({ id: m[1] as string, text: (m[2] as string).trim() });
    else if (/^\s*[-*]\s+none\b/i.test(l)) none = true; // "- None" says the same as "None"
    else bad.push(l.trim());
  }
  return { line: at?.no ?? scope.line, none, items, bad };
}

/** The checks `aidw analyze` runs on a Change that owes both parts. */
export function checkBeforeAfter(analysis: string, file: string, opts: { existingSystem: boolean }, d: Diags): void {
  const { min, max } = BEFORE_AFTER_LINES;
  const ba = beforeAfterOf(analysis);
  if (!ba) d.error(file, `missing section "## ${BEFORE_AFTER}" (### Before and ### After, ${min} to ${max} lines each, as the user sees it)`);
  else {
    for (const [name, has, lines] of [["Before", ba.hasBefore, ba.before], ["After", ba.hasAfter, ba.after]] as const) {
      if (!has) d.error(file, `"## ${BEFORE_AFTER}": missing "### ${name}"`, ba.line);
      else if (lines.length < min || lines.length > max) d.error(file, `"## ${BEFORE_AFTER}": "### ${name}" has ${lines.length} line(s); write ${min} to ${max}, as the user sees it`, ba.line);
    }
    if (opts.existingSystem && ba.hasBefore && !ba.beforeText.includes(EXISTING_SYSTEM_FILE)) {
      d.error(file, `"## ${BEFORE_AFTER}": this Change has an Existing System Report; "### Before" must draw from it and name ${EXISTING_SYSTEM_FILE}`, ba.line);
    }
  }

  const def = deferredOf(analysis);
  if (!def) {
    d.error(file, `missing "### ${DEFERRED}" (under "## Requirements and scope"): list each technical question as "- DA<n>: <question>", or write "None"`);
    return;
  }
  const seen = new Set<string>();
  for (const it of def.items) {
    if (seen.has(it.id)) d.error(file, `"### ${DEFERRED}": duplicate ${it.id}`, def.line);
    seen.add(it.id);
  }
  for (const l of def.bad) d.error(file, `"### ${DEFERRED}": "${l.slice(0, 60)}" must be "- DA<n>: <question>"`, def.line);
  if (!def.none && !def.items.length && !def.bad.length) d.error(file, `"### ${DEFERRED}" must list "- DA<n>: <question>" lines, or say "None"`, def.line);
  // I9: the Software Architect answers each line, by its id, in the architecture section it owns.
  const arch = sections(analysis).find((x) => x.name.toLowerCase() === "architecture");
  const answered = new Set(
    (arch?.body ?? "")
      .split(/\r?\n/)
      .map((l) => DEFERRED_LINE.exec(l)?.[1])
      .filter((x): x is string => !!x),
  );
  for (const id of seen) {
    if (!answered.has(id)) d.error(file, `"### ${DEFERRED}": ${id} has no answer in "## Architecture" (a "- ${id}: <answer>" line)`, def.line);
  }
}

/** The first section of the gate page, from analysis.md; null when the analysis has no Before / After lines. */
export function beforeAfterSection(analysis: string): PageSection | null {
  const ba = beforeAfterOf(analysis);
  if (!ba || (!ba.before.length && !ba.after.length)) return null;
  return {
    id: "before-after",
    title: BEFORE_AFTER,
    body: "What the user sees today, and what they will see once this Change is built.",
    points: [...ba.before.map((l) => `**Before**: ${l}`), ...ba.after.map((l) => `**After**: ${l}`)],
    html: "",
  };
}
