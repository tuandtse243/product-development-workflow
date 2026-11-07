import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "./change.js";
import { rel, walkFiles, type Paths } from "./project.js";
import { canonicalTasks } from "./tasks.js";

export interface ApprovalHash {
  hash: string;
  /** project-relative files covered by the hash, sorted */
  files: string[];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const normalize = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * Hash of everything the user approves at the gate:
 *   change: intake.md, analysis.md, design.md, specs/** (deltas), tasks.yaml (planned fields only)
 *   project: constitution.md, design/**
 * Execution progress (task status, evidence, run state) is deliberately excluded.
 */
export function computeApprovalHash(p: Paths, change: Change): ApprovalHash {
  const entries: { path: string; digest: string }[] = [];
  const add = (file: string, content?: string) => {
    if (!existsSync(file)) return;
    const text = content ?? normalize(readFileSync(file, "utf8"));
    entries.push({ path: rel(p, file), digest: sha256(text) });
  };

  for (const name of ["intake.md", "analysis.md", "design.md"]) add(join(change.dir, name));
  for (const f of walkFiles(join(change.dir, "specs"))) add(f);
  const tasksFile = join(change.dir, "tasks.yaml");
  if (existsSync(tasksFile)) add(tasksFile, canonicalTasks(readFileSync(tasksFile, "utf8")));
  add(p.constitution);
  for (const f of walkFiles(p.design)) add(f);

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = entries.map((e) => `${e.path}\n${e.digest}\n`).join("");
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
