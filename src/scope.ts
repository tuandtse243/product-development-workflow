import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "./change.js";
import { Diags } from "./diag.js";
import { sections } from "./spec/parse.js";

/**
 * The scope round of the `product` Workflow (ADR-0011): during the discovery interview the user settles vision, scope,
 * MVP and what is out on one Decision Page (`kind: scope`), and the checked answer is recorded word for word under
 * `### Scope round` in the discovery appendix of analysis.md. Nothing is approved or frozen there: the Workflow's one
 * Approval Gate stays after the plan. A Workflow asks for the round with `scope_round: true`.
 */
export const SCOPE_ROUND_HEADING = "Scope round";
/** The questions of the scope page, by id; each comes back as a line `<id> <title>: <answer>` (page.ts answersText). */
export const SCOPE_QUESTIONS = ["vision", "scope", "mvp", "out"] as const;
const APPENDIX = "appendix: discovery q&a";
const PLACEHOLDER = "TODO(aidw)";

/** The body of `### Scope round` inside the discovery appendix, or null when there is none. */
export function scopeRound(analysis: string): string | null {
  const appendix = sections(analysis).find((s) => s.name.toLowerCase() === APPENDIX);
  if (!appendix) return null;
  const lines = appendix.body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^###\s+(.+?)\s*#*\s*$/.exec(l)?.[1]?.toLowerCase() === SCOPE_ROUND_HEADING.toLowerCase());
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/** The answer lines the scope round still lacks (empty when every question is answered). */
export function missingScopeAnswers(round: string): string[] {
  return SCOPE_QUESTIONS.filter((id) => !new RegExp(`^\\s*(?:[-*]\\s+)?${id}\\b[^:\\n]*:\\s*\\S`, "im").test(round));
}

/** Where a `product` package records its scope, checked by `aidw analyze`. */
export function checkScopeRound(change: Change, analysis: string, file: string): Diags {
  const d = new Diags();
  // A Change started under the old scope gate recorded its scope in brief.md; that record still counts.
  if (!checkBrief(change).errors.length) return d;
  const round = scopeRound(analysis);
  const how = `ask it on the \`scope\` Decision Page (kind: scope) and record the checked answer under "### ${SCOPE_ROUND_HEADING}" in "## Appendix: discovery Q&A"`;
  if (round === null || !round || round.includes(PLACEHOLDER)) {
    d.error(file, `the scope round is not recorded: ${how}`);
    return d;
  }
  for (const id of missingScopeAnswers(round)) d.error(file, `the scope round has no answer for "${id}": ${how}`);
  return d;
}

// ------------------------------------------------------------------ Changes started under the old scope gate

/** The product brief an older aidw wrote for its scope gate; it stands in for the scope round of such a Change. */
export const BRIEF_FILE = "brief.md";
export const BRIEF_SECTIONS = ["Vision", "Scope", "MVP", "Out of scope"] as const;

export const briefPath = (change: Change) => join(change.dir, BRIEF_FILE);

/** The four sections exist and say something. */
export function checkBrief(change: Change): Diags {
  const d = new Diags();
  const file = `changes/${change.id}/${BRIEF_FILE}`;
  if (!existsSync(briefPath(change))) {
    d.error(file, "the product brief is missing");
    return d;
  }
  const found = sections(readFileSync(briefPath(change), "utf8"));
  for (const name of BRIEF_SECTIONS) {
    const s = found.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) d.error(file, `missing section "## ${name}"`);
    else if (!s.body || s.body.includes(PLACEHOLDER)) d.error(file, `section "## ${name}" is empty or still a placeholder`, s.line);
  }
  return d;
}
