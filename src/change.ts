import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { bundledRoot } from "./plugin.js";
import { isDir, type Paths } from "./project.js";

export const STATES = [
  "draft",
  "intake",
  "analyzing",
  "awaiting_approval",
  "approved",
  "executing",
  "paused",
  "verifying",
  "converging",
  "deploying",
  "delivered",
  "archived",
  "escalated",
] as const;
export type State = (typeof STATES)[number];

/** States that require a valid (non-drifted) approval. */
export const POST_APPROVAL: ReadonlySet<State> = new Set<State>([
  "approved",
  "executing",
  "paused",
  "verifying",
  "converging",
  "deploying",
  "delivered",
  "escalated",
]);

/** States where the full Analysis package must exist. */
export const NEEDS_ANALYSIS: ReadonlySet<State> = new Set<State>([...POST_APPROVAL, "awaiting_approval", "archived"]);

/**
 * Allowed transitions via `aidw transition`, read from the `transitions:` of the Workflow file (workflows/*.yaml): the
 * Workflow defines the flow, this is its state machine. "approved" is reachable only through `aidw approve` and
 * "archived" only through `aidw archive`. "paused" resumes to the state it paused from. `aidw roster` checks that
 * every Workflow file lists the same table.
 */
export const TRANSITIONS: Record<State, readonly State[]> = loadTransitions();

function loadTransitions(): Record<State, readonly State[]> {
  const root = bundledRoot();
  const file = root ? join(root, "workflows", "product.yaml") : "";
  const data = file && existsSync(file) ? (YAML.parse(readFileSync(file, "utf8")) as { transitions?: unknown } | null) : null;
  const table = parseTransitions(data?.transitions);
  if (!table) throw new Error(`the Change state machine is missing: ${file || "plugin root not found"} needs a "transitions:" table that covers every state`);
  return table;
}

/** `transitions:` of a Workflow file as a complete table, or null when it is not one (checked by `aidw roster`). */
export function parseTransitions(raw: unknown): Record<State, readonly State[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {} as Record<State, readonly State[]>;
  for (const s of STATES) {
    const to = (raw as Record<string, unknown>)[s];
    if (!Array.isArray(to) || !to.every(isState)) return null;
    out[s] = to as State[];
  }
  return Object.keys(raw).length === STATES.length ? out : null;
}

export const CHANGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isState(s: unknown): s is State {
  return typeof s === "string" && (STATES as readonly string[]).includes(s);
}

export interface Change {
  id: string;
  dir: string;
  file: string;
  doc: YAML.Document;
  /** plain JS view of change.yaml */
  data: Record<string, unknown>;
}

export function changeDir(p: Paths, id: string): string {
  return join(p.changes, id);
}

/** Active change ids (directories under changes/), sorted. */
export function listChangeIds(p: Paths): string[] {
  if (!isDir(p.changes)) return [];
  return readdirSync(p.changes)
    .filter((n) => !n.startsWith(".") && isDir(join(p.changes, n)))
    .sort();
}

export class ChangeError extends Error {}

export function loadChange(p: Paths, id: string): Change {
  const dir = changeDir(p, id);
  const file = join(dir, "change.yaml");
  if (!existsSync(file)) throw new ChangeError(`change "${id}" not found (${file})`);
  const doc = YAML.parseDocument(readFileSync(file, "utf8"));
  if (doc.errors.length) throw new ChangeError(`change.yaml of "${id}" is not valid YAML: ${doc.errors[0]?.message}`);
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  return { id, dir, file, doc, data };
}

export function saveChange(c: Change): void {
  writeFileSync(c.file, String(c.doc));
  c.data = (c.doc.toJS() ?? {}) as Record<string, unknown>;
}

export function stateOf(c: Change): State | null {
  return isState(c.data.state) ? c.data.state : null;
}

/** Resolves an explicit id, or the single active change when id is omitted. */
export function resolveChangeId(p: Paths, id: string | undefined): string {
  if (id) return id;
  const ids = listChangeIds(p);
  if (ids.length === 1) return ids[0] as string;
  if (ids.length === 0) throw new ChangeError("no active changes; create one with `aidw change new <id>`");
  throw new ChangeError(`several active changes (${ids.join(", ")}); pass a change id`);
}
