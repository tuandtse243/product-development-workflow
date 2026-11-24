import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "./change.js";
import { capabilityOf, rel, walkFiles, type Paths } from "./project.js";
import { canonicalTasks } from "./tasks.js";

export interface ApprovalHash {
  hash: string;
  /** project-relative files covered by the hash, sorted */
  files: string[];
}

/** Change-level files of the approved package (besides specs/** and the planned part of tasks.yaml). */
export const CHANGE_PACKAGE_FILES = ["intake.md", "analysis.md", "design.md", "quality.yaml", "decisions.yaml", "brief.md"] as const;

/** Project-level directories that belong to the approved package (with constitution.md). */
export const FROZEN_PROJECT_DIRS = (p: Paths): string[] => [p.design, p.domain, p.architecture, p.requirements];

/**
 * Main specs the change's deltas apply to (S10): MODIFIED/REMOVED requirements are only meaningful against
 * them, and in a brownfield project they are the baseline written before the gate. They are approved with
 * the change and frozen while it runs.
 */
export function baseSpecFiles(p: Paths, change: Change): string[] {
  const out = new Set<string>();
  for (const f of walkFiles(join(change.dir, "specs"))) {
    const cap = capabilityOf(join(change.dir, "specs"), f);
    if (!cap) continue;
    const main = join(p.specs, ...cap.split("/"), "spec.md");
    if (existsSync(main)) out.add(main);
  }
  return [...out];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const normalize = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * Hash of everything the user approves at the gate:
 *   change: intake.md, analysis.md, design.md, quality.yaml, specs/** (deltas), tasks.yaml (planned fields only),
 *           and the main specs those deltas apply to
 *   project: constitution.md, design/**, domain/**, architecture/**, requirements/**
 * Execution progress (task status, evidence, run state) is deliberately excluded.
 * decisions/ (ADRs) is excluded: implementation-level ADRs may be added during execution.
 * The push binding fixed at approval (`approval.push`: Change Branch, remote and its URL, base; src/grants.ts) is
 * hashed too, so editing it in change.yaml is drift. `push` is passed by `aidw approve` (null: none); otherwise it
 * is read from the recorded approval.
 */
export function computeApprovalHash(p: Paths, change: Change, push?: unknown): ApprovalHash {
  const entries: { path: string; digest: string }[] = [];
  const add = (file: string, content?: string) => {
    if (!existsSync(file)) return;
    const text = content ?? normalize(readFileSync(file, "utf8"));
    entries.push({ path: rel(p, file), digest: sha256(text) });
  };

  for (const name of CHANGE_PACKAGE_FILES) add(join(change.dir, name));
  for (const f of walkFiles(join(change.dir, "specs"))) add(f);
  for (const f of baseSpecFiles(p, change)) add(f);
  const tasksFile = join(change.dir, "tasks.yaml");
  if (existsSync(tasksFile)) add(tasksFile, canonicalTasks(readFileSync(tasksFile, "utf8")));
  add(p.constitution);
  for (const dir of FROZEN_PROJECT_DIRS(p)) for (const f of walkFiles(dir)) add(f);

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bound = push !== undefined ? push : (change.data.approval as { push?: unknown } | null | undefined)?.push;
  const binding = bound ? `approval.push\n${sha256(JSON.stringify(bound))}\n` : "";
  const manifest = entries.map((e) => `${e.path}\n${e.digest}\n`).join("") + binding;
  return { hash: `sha256:${sha256(manifest)}`, files: entries.map((e) => e.path) };
}

export type ApprovalStatus = "none" | "valid" | "drift";

export function approvalStatus(p: Paths, change: Change): { status: ApprovalStatus; expected?: string; actual: string } {
  const actual = computeApprovalHash(p, change).hash;
  const approval = change.data.approval as { hash?: unknown } | null | undefined;
  const expected = typeof approval?.hash === "string" ? approval.hash : undefined;
  if (!expected) return { status: "none", actual };
  return { status: expected === actual ? "valid" : "drift", expected, actual };
}
