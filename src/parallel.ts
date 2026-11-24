/**
 * Parallel waves (slice S8, blueprint section 9.2, decision D-29).
 *
 *   wave       ready tasks whose `touches` do not overlap, none `risk: high` or marked sequential, at most one
 *              that drives a browser (fixed e2e port), at most `parallel.max` (quality.yaml)
 *   worktree   each wave task runs in its own git worktree `.aidw/run/worktrees/<change>/<task>` on branch
 *              `aidw/<change>.<task>` (beside the change branch `aidw/<change>`), created by aidw (not the Agent tool's isolation), so the gate, the
 *              checkpoint and resume work the same for every runtime
 *   merge      review pass commits the worktree and merges it into the change branch (one commit per task);
 *              a conflict goes to the integration Role (src/conflict.ts, D11); when that fails the branch is
 *              dropped and the task reruns sequentially on the latest code. Each conflict is recorded in
 *              `changes/<id>/conflicts.yaml` for the Technical Planner
 *   integrate  after a wave, the merged code runs every wave task's verify plus the `code` layer; a failure
 *              becomes a fix task (origin: integration) before anything new starts
 */
import { defaultTaskRole } from "./roles.js";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { loadChange, type Change } from "./change.js";
import { git, headCommit, isGitRepo, junkMessage, stagedJunk } from "./git.js";
import { secretsMessage, stagedSecrets } from "./secrets.js";
import { OpError, transition } from "./ops.js";
import { readText, rel, type Paths } from "./project.js";
import { DEFAULT_PARALLEL, parseQuality, qualityFile, type ParallelConfig, type QualityConfig } from "./quality.js";
import { touchesUi } from "./skills.js";
import { globsOverlap, staticPrefix, touchesOverlap } from "./touches.js";
import type { Task } from "./tasks.js";
import type { CommandRunner, VerifyRun } from "./run.js";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const statusOf = (t: Task) => String(t.status ?? "pending");
const now = () => new Date().toISOString();
const BROWSER_VERIFY = /\b(playwright|cypress|e2e)\b/i;

// ---------------------------------------------------------------- touches overlap

export { globsOverlap, staticPrefix, touchesOverlap } from "./touches.js";

/** A task whose verify or screenshots start the app in a browser: two at once would fight over the e2e port. */
export const drivesBrowser = (t: Task) => list(t.verify).some((v) => BROWSER_VERIFY.test(v)) || touchesUi(t);

const mustRunAlone = (t: Task) => t.risk === "high" || t.sequential === true || list(t.touches).some((g) => staticPrefix(g).length === 0);

/**
 * The next wave: ready pending tasks in file order. The first ready task always runs; others join only when
 * they can run beside every task already in the wave.
 */
export function planWave(tasks: Task[], max: number): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ready = tasks.filter((t) => statusOf(t) === "pending" && list(t.depends_on).every((d) => statusOf(byId.get(d) ?? { id: d }) === "done"));
  const first = ready[0];
  if (!first) return [];
  const wave = [first];
  if (mustRunAlone(first)) return wave;
  for (const t of ready.slice(1)) {
    if (wave.length >= max) break;
    if (mustRunAlone(t)) continue;
    if (wave.some((w) => touchesOverlap(list(w.touches), list(t.touches)))) continue;
    if (drivesBrowser(t) && wave.some(drivesBrowser)) continue;
    wave.push(t);
  }
  return wave;
}

/** parallel settings from the approved quality.yaml; sequential (max 1) without git or without quality.yaml. */
export function parallelConfig(p: Paths, change: Change): ParallelConfig {
  if (!isGitRepo(p.project) || !headCommit(p.project)) return { ...DEFAULT_PARALLEL, max: 1 };
  const text = readText(qualityFile(change));
  if (text === null) return { ...DEFAULT_PARALLEL, max: 1 };
  return parseQuality(text, "quality.yaml").config?.parallel ?? { ...DEFAULT_PARALLEL, max: 1 };
}

// ---------------------------------------------------------------- worktrees

export const worktreesRoot = (p: Paths) => join(p.run, "worktrees");
export const worktreeDir = (p: Paths, id: string, taskId: string) => join(worktreesRoot(p), id, taskId);
export const branchName = (id: string, taskId: string) => `aidw/${id}.${taskId}`;

/** Where a task's files live: its worktree, or the main checkout. */
export function taskDir(p: Paths, t: Task): string {
  return typeof t.worktree === "string" && t.worktree ? join(p.project, t.worktree) : p.project;
}

/** Creates (or re-attaches after a crash) the task's worktree at `base`. Returns its project-relative path. */
export function ensureWorktree(p: Paths, id: string, taskId: string, base: string): { dir: string; branch: string; created: boolean } {
  const dir = worktreeDir(p, id, taskId);
  const branch = branchName(id, taskId);
  if (existsSync(join(dir, ".git"))) {
    linkDependencies(p, dir);
    return { dir: rel(p, dir), branch, created: false };
  }
  git(p.project, ["worktree", "prune"]);
  mkdirSync(join(dir, ".."), { recursive: true });
  const hasBranch = git(p.project, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]).ok;
  const r = hasBranch ? git(p.project, ["worktree", "add", "-q", dir, branch]) : git(p.project, ["worktree", "add", "-q", "-b", branch, dir, base]);
  if (!r.ok) {
    if (!hasBranch) git(p.project, ["branch", "-q", "-D", branch]); // git may have made the branch before it failed to make the folder
    throw new OpError(`could not create the worktree for ${taskId}: ${r.err || r.out}`);
  }
  linkDependencies(p, dir);
  return { dir: rel(p, dir), branch, created: true };
}

export function removeWorktree(p: Paths, worktree: string | undefined, branch: string | undefined): void {
  if (worktree) {
    const dir = join(p.project, worktree);
    git(p.project, ["worktree", "remove", "--force", dir]);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    git(p.project, ["worktree", "prune"]);
  }
  if (branch) git(p.project, ["branch", "-q", "-D", branch]);
}

/**
 * A plain copy of the files of `base` (no git metadata, so no branch and nothing under `.git` is written), with the
 * project's `node_modules` linked in. The way to check out old code when `git worktree add` is not allowed (a sandbox that
 * keeps `.git` read-only). Returns the project-relative folder; remove it with `removeSnapshot`.
 */
export function snapshotBase(p: Paths, id: string, taskId: string, base: string): string {
  const dir = worktreeDir(p, id, taskId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("sh", ["-c", 'git archive --format=tar "$0" | tar -x -C "$1"', base, dir], { cwd: p.project, encoding: "utf8" });
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new OpError(`could not copy the base commit: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}`);
  }
  const source = join(p.project, "node_modules");
  if (existsSync(source) && !isSymlink(join(dir, "node_modules"))) {
    try {
      symlinkSync(source, join(dir, "node_modules"), "dir");
    } catch {
      /* the tests then fail visibly on the old code, which is reported as unproven or red */
    }
  }
  return rel(p, dir);
}

export function removeSnapshot(p: Paths, folder: string): void {
  rmSync(join(p.project, folder), { recursive: true, force: true });
}

export type MergeOutcome = { ok: true } | { ok: false; conflict: string; files: string[] };

/**
 * Commits the task's work in its worktree (never its stale .aidw/ copy) and merges the branch into the main
 * checkout without committing; the caller commits the merge together with the .aidw/ state.
 */
export function mergeWorktree(p: Paths, t: Task, message: string): MergeOutcome {
  const wt = taskDir(p, t);
  const branch = String(t.branch ?? "");
  if (!existsSync(wt) || !branch) throw new OpError(`task ${t.id} has no worktree to merge (${String(t.worktree)})`);
  const add = git(wt, ["add", "-A", "--", ".", ":(exclude).aidw"]);
  if (!add.ok) throw new OpError(`git add in the worktree of ${t.id} failed: ${add.err}`);
  const junk = stagedJunk(wt);
  if (junk.length) {
    git(wt, ["reset", "-q"]);
    throw new OpError(`${t.id}: ${junkMessage(junk)}`);
  }
  const leaked = stagedSecrets(wt);
  if (leaked.length) {
    git(wt, ["reset", "-q"]);
    throw new OpError(`${t.id}: ${secretsMessage(leaked)}`);
  }
  if (!git(wt, ["diff", "--cached", "--quiet"]).ok) {
    // Same message as the merge commit: the branch commit and the merge commit describe one task.
    const c = git(wt, ["commit", "-q", "-m", message]);
    if (!c.ok) throw new OpError(`commit in the worktree of ${t.id} failed: ${c.err || c.out}`);
  }
  const m = git(p.project, ["merge", "--no-ff", "--no-commit", "-q", branch]);
  if (m.ok) return { ok: true };
  const files = git(p.project, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  git(p.project, ["merge", "--abort"]);
  return { ok: false, conflict: (m.out || m.err || files.join("\n")).split("\n").slice(0, 8).join("; "), files };
}

// ---------------------------------------------------------------- merge conflicts (T7, D11)

/**
 * The tasks already on the change branch that changed the conflicting files since `base`: read from the `Task:`
 * footer of the task commits (src/commit.ts). A file changed by a commit that is no task's has no partner.
 */
export function conflictPartners(p: Paths, taskId: string, base: string | null, files: string[]): string[] {
  if (!base || !files.length) return [];
  const log = git(p.project, ["log", "--format=%B", `${base}..HEAD`, "--", ...files]);
  if (!log.ok) return [];
  const ids = [...log.out.matchAll(/^Task: (\S+)$/gm)].map((m) => m[1] as string);
  return [...new Set(ids)].filter((x) => x !== taskId);
}

export type ConflictOutcome = "open" | "resolved" | "dropped";

export interface ConflictRecord {
  at: string;
  task: string;
  with: string[];
  files: string[];
  outcome: ConflictOutcome;
  reason?: string;
}

/** Where the Change keeps its merge conflicts; the Technical Planner reads it when it plans again (roles/technical-planner). */
export const conflictsFile = (change: Change) => join(change.dir, "conflicts.yaml");

const CONFLICTS_HEADER =
  "# Merge conflicts between tasks of a Wave (written by aidw). Each names the tasks whose work met in the same\n" +
  "# files. The Technical Planner reads it when it plans: list those files in the touches of every task that\n" +
  "# changes them, or chain the tasks with depends_on, so they never run side by side again.\n";

export function readConflicts(change: Change): ConflictRecord[] {
  const text = readText(conflictsFile(change));
  if (text === null) return [];
  try {
    const data = YAML.parse(text) as { conflicts?: ConflictRecord[] } | null;
    return Array.isArray(data?.conflicts) ? data.conflicts : [];
  } catch {
    return [];
  }
}

function writeConflicts(change: Change, records: ConflictRecord[]): void {
  writeFileSync(conflictsFile(change), `${CONFLICTS_HEADER}${YAML.stringify({ conflicts: records })}`);
}

/** Opens a record for a conflict found at a task's merge. */
export function recordConflict(change: Change, entry: Omit<ConflictRecord, "at" | "outcome">): void {
  writeConflicts(change, [...readConflicts(change), { at: now(), ...entry, outcome: "open" }]);
}

/** Closes the task's latest record: resolved by integration, or dropped (the task reruns sequentially). */
export function closeConflict(change: Change, taskId: string, outcome: Exclude<ConflictOutcome, "open">, reason?: string): void {
  const records = readConflicts(change);
  const last = records.map((r) => r.task).lastIndexOf(taskId);
  if (last < 0) return;
  records[last] = { ...(records[last] as ConflictRecord), outcome, ...(reason ? { reason: reason.slice(0, 300) } : {}) };
  writeConflicts(change, records);
}

// ---------------------------------------------------------------- integration verify

export interface IntegrationRun {
  at: string;
  head: string | null;
  ok: boolean;
  tasks: string[];
  runs: VerifyRun[];
  fixTask?: string;
}

const integrationFile = (change: Change) => join(change.dir, "evidence", "integration.json");

export function integrationRuns(change: Change): IntegrationRun[] {
  const f = integrationFile(change);
  if (!existsSync(f)) return [];
  try {
    return (JSON.parse(readFileSync(f, "utf8")) as { runs?: IntegrationRun[] }).runs ?? [];
  } catch {
    return [];
  }
}

function lastPassAt(change: Change): string {
  return integrationRuns(change).filter((r) => r.ok).at(-1)?.at ?? "";
}

/** Wave tasks merged since the last passing integration verify. */
export function pendingIntegration(change: Change, tasks: Task[]): Task[] {
  const since = lastPassAt(change);
  return tasks.filter((t) => statusOf(t) === "done" && typeof t.merged_at === "string" && t.merged_at > since);
}

export interface IntegrateResult {
  ok: boolean;
  tasks: string[];
  runs: VerifyRun[];
  fixTask?: string;
  escalated?: boolean;
  summary: string;
}

export function integrate(
  p: Paths,
  id: string,
  deps: { loadTasks: (p: Paths, id: string) => { tasks: Task[]; doc: YAML.Document; file: string }; save: (tf: { doc: YAML.Document; file: string }) => void; runner: CommandRunner; quality: QualityConfig | null; timeoutMs?: number },
): IntegrateResult {
  const change = loadChange(p, id);
  const tf = deps.loadTasks(p, id);
  const covered = pendingIntegration(change, tf.tasks);
  if (!covered.length) return { ok: true, tasks: [], runs: [], summary: "nothing merged since the last integration verify" };

  const code = deps.quality?.layers.find((l) => l.name === "code");
  const commands = [...new Set([...(code ? [...code.setup, ...code.run] : []), ...covered.flatMap((t) => list(t.verify))])];
  const runs: VerifyRun[] = [];
  for (const command of commands) {
    const started = Date.now();
    const r = deps.runner(command, p.project, deps.timeoutMs ?? 30 * 60 * 1000);
    runs.push({ command, ms: Date.now() - started, ...r });
    if (r.exit !== 0) break;
  }
  const failed = runs.find((r) => r.exit !== 0);
  const ok = !failed && runs.length === commands.length;
  const record: IntegrationRun = { at: now(), head: headCommit(p.project), ok, tasks: covered.map((t) => t.id), runs };
  const history = integrationRuns(change);
  const write = () => {
    mkdirSync(join(change.dir, "evidence"), { recursive: true });
    writeFileSync(integrationFile(change), `${JSON.stringify({ runs: [...history, record] }, null, 2)}\n`);
  };
  if (ok) {
    write();
    return { ok, tasks: record.tasks, runs, summary: `wave ${record.tasks.join(", ")} integrates: ${commands.length} command(s) pass on the merged code` };
  }

  const since = lastPassAt(change);
  const failures = history.filter((r) => !r.ok && r.at > since).length + 1;
  const max = deps.quality?.maxFixRounds ?? 3;
  if (failures > max) {
    write();
    transition(p, id, "escalated", { reason: `integration verify of ${record.tasks.join(", ")} still failing after ${failures - 1} fix round(s)` });
    return { ok: false, tasks: record.tasks, runs, escalated: true, summary: `integration verify failed; fix rounds exhausted (${failures - 1}/${max}): escalated` };
  }
  const n = tf.tasks.filter((t) => t.origin === "integration").length + 1;
  const taskId = `I${String(n).padStart(2, "0")}`;
  const problem = failed
    ? `Integration verify after merging ${record.tasks.join(", ")} failed: \`${failed.command}\`${failed.timedOut ? " timed out" : ` exited ${failed.exit}`}.\nEach task passed on its own; the merged code does not. Find the interaction between the tasks.\n\n${failed.tail}`
    : "Integration verify did not complete.";
  (tf.doc.get("tasks") as YAML.YAMLSeq).add(
    tf.doc.createNode({ id: taskId, title: `Fix the integration of ${record.tasks.join(", ")}`, role: defaultTaskRole(), origin: "integration", depends_on: [], touches: ["**"], verify: commands, problem, status: "pending" }),
  );
  deps.save(tf);
  record.fixTask = taskId;
  write();
  return { ok: false, tasks: record.tasks, runs, fixTask: taskId, summary: `integration verify failed: fix task ${taskId} added (round ${failures}/${max})` };
}

/**
 * A worktree has no node_modules (it is not tracked), so `pnpm exec vitest` fails there with "command not found"
 * (trial-3A: T02 and T03 failed their first checkpoint). Link the main checkout's node_modules into it. The link is
 * excluded from git (info/exclude is shared by every worktree) so `git add -A` never stages it.
 */
export function linkDependencies(p: Paths, dir: string): void {
  const source = join(p.project, "node_modules");
  const target = join(dir, "node_modules");
  if (!existsSync(source) || existsSync(target) || isSymlink(target)) return;
  try {
    symlinkSync(source, target, "dir");
  } catch {
    return; // the task then runs `parallel.setup` or fails visibly in its checkpoint
  }
  const ex = git(p.project, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
  if (!ex.ok || !ex.out) return;
  const text = existsSync(ex.out) ? readFileSync(ex.out, "utf8") : "";
  if (!/^\/?node_modules\/?$/m.test(text)) {
    mkdirSync(join(ex.out, ".."), { recursive: true });
    writeFileSync(ex.out, `${text}${text && !text.endsWith("\n") ? "\n" : ""}node_modules\n`);
  }
}

const isSymlink = (f: string): boolean => {
  try {
    return lstatSync(f).isSymbolicLink();
  } catch {
    return false;
  }
};
