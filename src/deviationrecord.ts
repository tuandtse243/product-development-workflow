/**
 * The CLI's record of Deviations (ADR-0014): `.aidw/changes/<id>/deviations.yaml`. It sits beside the approved package,
 * not in it: it says how the package moved after the gate, so writing it is never drift, and only `aidw deviation`
 * writes it (the gate hook denies every Agent). The logic is in src/deviation.ts; this module only reads and writes the
 * record, so the approval hash, the gate hook and `aidw next` can read it without importing the whole Deviation path.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import type { Change } from "./change.js";

export const DEVIATIONS_FILE = "deviations.yaml";
/** Copies of the files of each Deviation as they were when it opened: `deviations/D<NN>/<project-relative path>`. */
export const DEVIATIONS_DIR = "deviations";

/** unclassified: the text changed and the CLI found no difference it can classify; handled like prose (rerun) */
export type ContractClass = "none" | "additive" | "breaking" | "prose" | "unclassified";

export interface ContractDiff {
  file: string;
  kind: "openapi" | "dbml" | "prose";
  class: ContractClass;
  changes: string[];
  /** the tasks that build against it (recorded for an additive change too, which reruns none of them) */
  readers?: string[];
}

export interface DeviationRecord {
  id: string;
  /** open: the author may edit `files`; closed: checked, rehashed and recorded; abandoned: the files were put back */
  status: "open" | "closed" | "abandoned";
  /**
   * the Roles that wrote what changes; usually one, several when one change spans Artifacts of different authors (a
   * scenario renamed in a delta spec and in the task that verifies it)
   */
  roles: string[];
  /** project-relative files that may change */
  files: string[];
  /** file -> the one Role the gate lets edit it while the Deviation is open */
  authors: Record<string, string>;
  reason: string;
  /** the Consultation that routed here (T8: needs-deviation) */
  consultation?: string;
  /** the task that asked for it (a Consultation of a task, or a Triage that routed a cause upstream) */
  task?: string;
  opened_at: string;
  /** the approval hash the Deviation started from */
  previous: string;
  /** digest of each file when it opened (null: it did not exist); the approval hash reads these while it is open */
  before: Record<string, string | null>;
  closed_at?: string;
  /** the approval hash after it */
  hash?: string;
  /** the package version it was hashed with (the approval's own; src/approval.ts) */
  package?: number;
  /** every step of the close is done: the hash written, the tasks reset, the Consultation recorded */
  finished?: boolean;
  /** files that really changed */
  changed?: string[];
  /** the author's account, given at close (`--summary`) */
  summary?: string;
  scenarios?: { removed: { scenario: string; reason: string }[]; added: string[]; changed: string[] };
  requirements?: { added: string[]; removed: string[]; changed: string[] };
  /** why a new requirement is not new scope (`--scope-reason`) */
  scope_reason?: string;
  contracts?: ContractDiff[];
  /** removed_done: removed tasks that were already done (their code stays) */
  tasks?: { added: string[]; removed: string[]; removed_done: string[]; changed: string[] };
  /** tasks to run again, and the done ones among them that were reset to pending */
  rerun?: string[];
  reset?: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const deviationsPath = (change: Change) => join(change.dir, DEVIATIONS_FILE);

export function loadDeviations(change: Change): DeviationRecord[] {
  const file = deviationsPath(change);
  if (!existsSync(file)) return [];
  let data: unknown;
  try {
    data = YAML.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const list = isRecord(data) && Array.isArray(data.deviations) ? data.deviations : [];
  return list.filter(isRecord) as unknown as DeviationRecord[];
}

export function saveDeviations(change: Change, list: DeviationRecord[]): void {
  writeFileSync(deviationsPath(change), YAML.stringify({ deviations: list }));
}

export const openDeviation = (change: Change): DeviationRecord | null => loadDeviations(change).find((d) => d.status === "open") ?? null;

/** While a Deviation is open: the digest each of its files had when it opened (null: the file did not exist). */
export function openDeviationDigests(change: Change): Map<string, string | null> | null {
  const open = openDeviation(change);
  if (!open || !isRecord(open.before)) return null;
  return new Map(Object.entries(open.before).map(([k, v]) => [k, typeof v === "string" ? v : null]));
}

/**
 * A file of the package as the user approved it: while an open Deviation names it, its copy from when it opened (null
 * when it did not exist), so a half-edited quality.yaml never widens the grants or the tier 2 permissions meanwhile;
 * otherwise the file on disk.
 */
export function approvedText(change: Change, file: string): string | null {
  const read = (f: string) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return null;
    }
  };
  const open = openDeviation(change);
  if (open) {
    const project = resolve(change.dir, "..", "..", "..");
    const r = relative(project, file).split(sep).join("/");
    if (open.files.includes(r)) return open.before?.[r] === null ? null : read(join(change.dir, DEVIATIONS_DIR, open.id, "files", r));
  }
  return read(file);
}
