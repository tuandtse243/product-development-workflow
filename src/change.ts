import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
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
 * Allowed transitions via `aidw transition`. "approved" is reachable only through `aidw approve`
 * and "archived" only through `aidw archive`. "paused" resumes to the state it paused from.
 */
export const TRANSITIONS: Record<State, readonly State[]> = {
  draft: ["intake"],
  intake: ["analyzing"],
  analyzing: ["awaiting_approval"],
  awaiting_approval: ["analyzing"],
  approved: ["executing"],
  executing: ["verifying", "paused", "escalated"],
  paused: [],
  verifying: ["executing", "converging", "paused", "escalated"],
  converging: ["executing", "deploying", "paused", "escalated"],
  deploying: ["delivered", "paused", "escalated"],
  delivered: [],
  archived: [],
  escalated: ["executing", "verifying", "converging", "deploying", "analyzing"],
};

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
