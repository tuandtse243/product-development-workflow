import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "./change.js";
import { Diags } from "./diag.js";
import { sections } from "./spec/parse.js";

/**
 * The scope gate of the `product` Workflow (Approval Gate 1): before any requirement is written the user approves the
 * product brief: vision, scope, MVP and what is out. The Change records `scope_gate: true` when it is created under a
 * Workflow that has the gate; `aidw transition <id> awaiting_approval` is refused until the brief is approved, and again
 * when the brief changed after that.
 */
export const BRIEF_FILE = "brief.md";
export const BRIEF_SECTIONS = ["Vision", "Scope", "MVP", "Out of scope"] as const;
const PLACEHOLDER = "TODO(aidw)";

export const briefPath = (change: Change) => join(change.dir, BRIEF_FILE);

export const BRIEF_TEMPLATE = (title: string) => `# Product brief: ${title}

## Vision

${PLACEHOLDER}: who this is for, the problem, and what success looks like, in a few lines.

## Scope

${PLACEHOLDER}: the capabilities the product has, as a short list the user can approve or strike.

## MVP

${PLACEHOLDER}: the smallest cut that is worth building first, and why it is that cut.

## Out of scope

${PLACEHOLDER}: what is deliberately not built now ("None" only if true).
`;

export const hasScopeGate = (change: Change): boolean => change.data.scope_gate === true;

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

export function briefHash(change: Change): string {
  return `sha256:${createHash("sha256").update((readFileSync(briefPath(change), "utf8")).replace(/\r\n?/g, "\n")).digest("hex")}`;
}

/** Why the Change may not go to the final approval yet, or null: its scope is approved and the brief has not changed since. */
export function scopeGuard(change: Change): string | null {
  if (!hasScopeGate(change)) return null;
  const a = change.data.scope_approval as { hash?: unknown } | null | undefined;
  if (!a || typeof a.hash !== "string") return 'the scope is not approved yet: present the product brief (`aidw transition <id> awaiting_scope_approval`) and let the user approve it';
  if (!existsSync(briefPath(change)) || briefHash(change) !== a.hash) return "the product brief changed after the scope was approved: ask the user to approve the scope again";
  return null;
}
