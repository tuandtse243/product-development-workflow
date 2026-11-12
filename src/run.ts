/**
 * Sequential execution of the approved task graph (slice S3, decision D-23 "a+").
 *
 *   aidw next              which task to work on, and what to do with it
 *   aidw task start T      pending/failed/interrupted -> running (counts attempts, records base commit)
 *   aidw brief T           context packet for a fresh implementer or reviewer subagent
 *   aidw checkpoint T      machine-checked evidence: a test per scenario id + every verify command passes
 *   aidw review T pass|fix independent reviewer verdict; pass marks done and commits the task
 *
 * All execution state lives in tasks.yaml (runtime fields) and evidence/<task>.json, so a killed
 * session resumes from files, never from conversation memory.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import YAML from "yaml";
import { decisionsToHonor, requirementsAfterChange } from "./analyze.js";
import { approvalStatus } from "./approval.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { hardcodedColors, loadTokens, missingTokens, shotsDir, taskShots, tokensFile, tokensTable } from "./design.js";
import { taskCommitMessage } from "./commit.js";
import { changedSince, git, headCommit, isGitRepo, junkMessage, stagedJunk } from "./git.js";
import { matchesAny } from "./glob.js";
import { OpError } from "./ops.js";
import { readText, rel, walkFiles, type Paths } from "./project.js";
import { ensureWorktree, integrate, mergeWorktree, parallelConfig, pendingIntegration, planWave, removeWorktree, taskDir, type IntegrateResult } from "./parallel.js";
import { parseQuality, qualityFile } from "./quality.js";
import { selectSkills, touchesUi, isSecuritySensitive, type BriefKind } from "./skills.js";
import { DEFAULT_MAX_ATTEMPTS, parseTasks, validateTasksText, type Task } from "./tasks.js";

const now = () => new Date().toISOString();
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

// ---------------------------------------------------------------- tasks.yaml I/O

export interface TaskFile {
  change: Change;
  file: string;
  doc: YAML.Document;
  tasks: Task[];
}

export function loadTasks(p: Paths, id: string): TaskFile {
  const change = loadChange(p, id);
  const file = join(change.dir, "tasks.yaml");
  const text = readText(file);
  if (text === null) throw new OpError(`change "${id}" has no tasks.yaml`);
  const d = validateTasksText(text, rel(p, file));
  if (d.errors.length) throw new OpError(`tasks.yaml of "${id}" is invalid`, d);
  return { change, file, doc: YAML.parseDocument(text), tasks: parseTasks(text).tasks };
}

export function saveTasksDoc(tf: TaskFile): void {
  saveTasks(tf);
}

function saveTasks(tf: TaskFile): void {
  const text = String(tf.doc);
  writeFileSync(tf.file, text);
  tf.tasks = parseTasks(text).tasks;
}

function indexOf(tf: TaskFile, taskId: string): number {
  const i = tf.tasks.findIndex((t) => t.id === taskId);
  if (i < 0) throw new OpError(`task "${taskId}" not found in ${tf.change.id}/tasks.yaml`);
  return i;
}

function setField(tf: TaskFile, i: number, key: string, value: unknown): void {
  if (value === undefined || value === null) tf.doc.deleteIn(["tasks", i, key]);
  else tf.doc.setIn(["tasks", i, key], value);
}

const statusOf = (t: Task) => String(t.status ?? "pending");
const attemptsOf = (t: Task) => (Number.isInteger(t.attempts) ? Number(t.attempts) : 0);
const maxAttemptsOf = (t: Task) => (Number.isInteger(t.max_attempts) ? Number(t.max_attempts) : DEFAULT_MAX_ATTEMPTS);

/** Tasks only run while the change is executing with a valid approval. */
function requireExecuting(p: Paths, change: Change): void {
  const state = stateOf(change);
  if (state !== "executing") {
    const hint =
      state === "approved"
        ? `run \`aidw transition ${change.id} executing\` first`
        : state === "paused"
          ? `run \`aidw transition ${change.id} resume\` first`
          : "tasks run only in state executing";
    throw new OpError(`change "${change.id}" is "${String(change.data.state)}": ${hint}`);
  }
  if (approvalStatus(p, change).status !== "valid") {
    throw new OpError(`approval drift in "${change.id}": escalate and re-approve before running tasks`);
  }
}

// ---------------------------------------------------------------- next

export type NextAction =
  | { action: "implement"; task: string; title: string; reason: "new" | "retry" | "interrupted" }
  | { action: "wave"; tasks: { task: string; title: string }[] }
  | { action: "integrate"; tasks: string[] }
  | { action: "review"; task: string; title: string }
  | { action: "escalate"; task?: string; reason: string }
  | { action: "complete"; done: number };

export function nextAction(p: Paths, id: string): NextAction {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const byId = new Map(tf.tasks.map((t) => [t.id, t]));
  const title = (t: Task) => String(t.title ?? "");

  // Unfinished work first, in file order: a review or an interrupted task resumes before anything new.
  for (const t of tf.tasks) if (statusOf(t) === "review") return { action: "review", task: t.id, title: title(t) };
  for (const t of tf.tasks) if (statusOf(t) === "running") return { action: "implement", task: t.id, title: title(t), reason: "interrupted" };
  for (const t of tf.tasks) {
    if (statusOf(t) === "escalated") return { action: "escalate", task: t.id, reason: `task ${t.id} is escalated: ${String(t.notes ?? "needs the user")}` };
  }
  for (const t of tf.tasks) {
    if (statusOf(t) !== "failed") continue;
    if (attemptsOf(t) >= maxAttemptsOf(t)) {
      return { action: "escalate", task: t.id, reason: `task ${t.id} failed ${attemptsOf(t)} of ${maxAttemptsOf(t)} attempts: ${String(t.notes ?? "")}` };
    }
    return { action: "implement", task: t.id, title: title(t), reason: "retry" };
  }
  // A finished wave is integrated (merged code verified together) before anything new starts.
  const merged = pendingIntegration(tf.change, tf.tasks);
  if (merged.length) {
    const fix = tf.tasks.find((t) => t.origin === "integration" && statusOf(t) === "pending");
    if (fix) return { action: "implement", task: fix.id, title: title(fix), reason: "new" };
    return { action: "integrate", tasks: merged.map((t) => t.id) };
  }
  const wave = planWave(tf.tasks, parallelConfig(p, tf.change).max);
  if (wave.length >= 2) return { action: "wave", tasks: wave.map((t) => ({ task: t.id, title: title(t) })) };
  if (wave[0]) return { action: "implement", task: wave[0].id, title: title(wave[0]), reason: "new" };
  const open = tf.tasks.filter((t) => statusOf(t) !== "done");
  if (open.length === 0) return { action: "complete", done: tf.tasks.length };
  const waiting = open.map((t) => `${t.id} (${statusOf(t)}${list(t.depends_on).length ? `, needs ${list(t.depends_on).join(", ")}` : ""})`);
  return { action: "escalate", reason: `no runnable task: ${waiting.join("; ")}` };
}

// ---------------------------------------------------------------- task start

export interface StartResult {
  task: string;
  attempt: number;
  maxAttempts: number;
  base: string | null;
  resumed: boolean;
  /** project-relative worktree of a wave task (absent on the main checkout) */
  worktree?: string;
}

export function startTask(p: Paths, id: string, taskId: string, opts: { worktree?: boolean; runner?: CommandRunner } = {}): StartResult {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  const status = statusOf(t);
  const byId = new Map(tf.tasks.map((x) => [x.id, x]));

  if (status === "pending") {
    const missing = list(t.depends_on).filter((d) => statusOf(byId.get(d) ?? { id: d }) !== "done");
    if (missing.length) throw new OpError(`task ${taskId} depends on unfinished task(s): ${missing.join(", ")}`);
  } else if (status !== "failed" && status !== "running") {
    throw new OpError(`task ${taskId} is "${status}"; only pending, failed or interrupted (running) tasks can start`);
  }

  const resumed = status === "running";
  const attempt = resumed ? Math.max(attemptsOf(t), 1) : attemptsOf(t) + 1;
  const max = maxAttemptsOf(t);
  if (attempt > max) {
    setField(tf, i, "status", "escalated");
    setField(tf, i, "notes", `attempts exhausted (${max}); last: ${String(t.notes ?? "unknown")}`);
    saveTasks(tf);
    throw new OpError(`task ${taskId} used all ${max} attempts; it is now escalated`);
  }
  // The base commit is fixed at the first attempt, so the reviewer sees the whole task's diff.
  const base = typeof t.base === "string" ? t.base : status === "pending" ? headCommit(p.project) : null;
  let worktree = typeof t.worktree === "string" ? t.worktree : undefined;
  if ((opts.worktree && status === "pending") || worktree) {
    if (!base) throw new OpError(`task ${taskId} cannot run in a worktree: the project has no commit yet`);
    if (t.sequential === true && !worktree) throw new OpError(`task ${taskId} is marked sequential; start it without --worktree`);
    const wt = ensureWorktree(p, id, taskId, base);
    if (wt.created) {
      const setup = parallelConfig(p, tf.change).setup;
      const runner = opts.runner ?? shellRunner;
      for (const command of setup) {
        const r = runner(command, join(p.project, wt.dir), 15 * 60 * 1000);
        if (r.exit !== 0) {
          removeWorktree(p, wt.dir, wt.branch);
          setField(tf, i, "sequential", true);
          saveTasks(tf);
          throw new OpError(`worktree setup \`${command}\` failed for ${taskId} (exit ${r.exit}); ${taskId} is marked sequential and runs later on the main checkout:\n${r.tail}`);
        }
      }
    }
    worktree = wt.dir;
    setField(tf, i, "worktree", wt.dir);
    setField(tf, i, "branch", wt.branch);
  }
  setField(tf, i, "status", "running");
  setField(tf, i, "attempts", attempt);
  if (!t.started_at) setField(tf, i, "started_at", now());
  if (base) setField(tf, i, "base", base);
  saveTasks(tf);
  return { task: taskId, attempt, maxAttempts: max, base, resumed, ...(worktree ? { worktree } : {}) };
}

/** User-granted retry of an escalated or failed task: a fresh attempt budget, same base commit. */
export function retryTask(p: Paths, id: string, taskId: string): { task: string } {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  if (statusOf(t) !== "escalated" && statusOf(t) !== "failed") {
    throw new OpError(`task ${taskId} is "${statusOf(t)}"; only escalated or failed tasks can be retried`);
  }
  setField(tf, i, "status", "failed");
  setField(tf, i, "attempts", 0);
  setField(tf, i, "notes", `retry granted by the user; before: ${String(t.notes ?? "")}`.slice(0, 500));
  saveTasks(tf);
  return { task: taskId };
}

// ---------------------------------------------------------------- evidence

const SKIP_DIRS = new Set(["node_modules", ".git", ".aidw", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", "dist", "build", "out", "coverage", "playwright-report", "test-results"]);
const TEST_FILE = /(^|\/)(__tests__|tests?|e2e|specs?)\/|\.(test|spec|e2e)\.[a-z0-9]+$/i;
const MAX_TEST_FILE = 1024 * 1024;

function walkProject(dir: string, root: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkProject(full, root, out);
    else if (st.size <= MAX_TEST_FILE) out.push(relative(root, full).split(sep).join("/"));
  }
}

/** Test files in the project (outside dependencies and build output). */
export function testFiles(project: string): string[] {
  const all: string[] = [];
  walkProject(project, project, all);
  return all.filter((f) => TEST_FILE.test(f));
}

/** A test line that is declared but not run (skip, todo, fixme, xit...). */
export const SKIPPED_LINE = /\.(skip|todo|fixme)\s*\(|\b(xit|xtest|xdescribe)\s*\(/;

/** Locations (file:line) where each scenario id appears verbatim in a test file, on a line that is not skipped. */
export function findScenarioTests(project: string, ids: string[]): Record<string, string[]> {
  const found: Record<string, string[]> = Object.fromEntries(ids.map((s) => [s, [] as string[]]));
  if (!ids.length) return found;
  const patterns = ids.map((s) => [s, new RegExp(`(^|[^a-z0-9/-])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9/-])`)] as const);
  for (const f of testFiles(project)) {
    const lines = readFileSync(join(project, f), "utf8").split(/\r?\n/);
    lines.forEach((line, n) => {
      if (SKIPPED_LINE.test(line)) return;
      for (const [s, re] of patterns) if (re.test(line)) found[s]?.push(`${f}:${n + 1}`);
    });
  }
  return found;
}

export interface VerifyRun {
  command: string;
  exit: number | null;
  ms: number;
  timedOut: boolean;
  tail: string;
  /** failed once, then passed on an immediate rerun: the command is unreliable, not the code */
  flaky?: boolean;
}

export interface CheckpointRecord {
  attempt: number;
  at: string;
  ok: boolean;
  base: string | null;
  scenarios: Record<string, string[]>;
  missing_scenarios: string[];
  verify: VerifyRun[];
  changed_files: string[] | null;
  outside_touches: string[];
  /** UI tasks with approved design tokens only */
  design?: DesignEvidence;
}

export interface DesignEvidence {
  /** color/font tokens whose value is nowhere in the code (fails the checkpoint) */
  missing_tokens: string[];
  /** color literals in changed files that are not tokens (for the reviewer) */
  hardcoded_colors: string[];
  /** fresh screenshots of this attempt (at least one required) */
  screenshots: string[];
}

/** Design checks for a UI task when the approved design has tokens; null otherwise. */
function designEvidence(p: Paths, id: string, t: Task, changed: string[] | null, since: string | undefined): DesignEvidence | null {
  if (!touchesUi(t)) return null;
  const { tokens, exists, diags } = loadTokens(p);
  if (!exists || diags.errors.length > 0 || tokens.length === 0) return null;
  const dir = taskDir(p, t);
  return {
    missing_tokens: missingTokens(dir, tokens),
    hardcoded_colors: hardcodedColors(dir, changed ?? [], tokens),
    screenshots: taskShots(p, id, t.id, since),
  };
}

export interface ReviewRecord {
  attempt: number;
  at: string;
  verdict: "pass" | "fix";
  notes: string;
}

export interface Evidence {
  task: string;
  title: string;
  checkpoints: CheckpointRecord[];
  reviews: ReviewRecord[];
}

export const evidenceRel = (taskId: string) => `evidence/${taskId}.json`;

function readEvidence(change: Change, t: Task): Evidence {
  const file = join(change.dir, evidenceRel(t.id));
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Evidence;
    } catch {
      // a corrupt evidence file is replaced
    }
  }
  return { task: t.id, title: String(t.title ?? ""), checkpoints: [], reviews: [] };
}

function writeEvidence(change: Change, ev: Evidence): void {
  const file = join(change.dir, evidenceRel(ev.task));
  mkdirSync(join(change.dir, "evidence"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(ev, null, 2)}\n`);
}

const tailOf = (s: string, lines = 60) => s.split(/\r?\n/).slice(-lines).join("\n").trim();

export type CommandRunner = (command: string, cwd: string, timeoutMs: number, env?: Record<string, string>) => Omit<VerifyRun, "command" | "ms">;

export const shellRunner: CommandRunner = (command, cwd, timeoutMs, env) => {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { exit: r.status, timedOut, tail: tailOf(`${r.stdout ?? ""}\n${r.stderr ?? ""}`) };
};

/**
 * Default runner for verify commands: a command that fails (not a timeout) is run once more. When the rerun
 * passes, the result is marked `flaky` so the evidence shows an unreliable test instead of burning an attempt.
 * Injected runners and deploy commands are never retried.
 */
export const retryingShellRunner: CommandRunner = (command, cwd, timeoutMs, env) => {
  const first = shellRunner(command, cwd, timeoutMs, env);
  if (first.exit === 0 || first.timedOut) return first;
  const second = shellRunner(command, cwd, timeoutMs, env);
  return second.exit === 0 ? { ...second, flaky: true } : first;
};

export interface CheckpointResult extends CheckpointRecord {
  task: string;
  status: "review" | "failed";
  /** why the checkpoint failed, one line each (empty when it passed) */
  problems: string[];
  evidence: string;
}

export function checkpoint(
  p: Paths,
  id: string,
  taskId: string,
  opts: { timeoutMs?: number; runner?: CommandRunner } = {},
): CheckpointResult {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  if (statusOf(t) !== "running") throw new OpError(`task ${taskId} is "${statusOf(t)}"; checkpoint needs a running task (aidw task start ${taskId})`);

  const dir = taskDir(p, t);
  const scenarios = findScenarioTests(dir, list(t.scenarios));
  const missing = Object.entries(scenarios)
    .filter(([, locs]) => locs.length === 0)
    .map(([s]) => s);

  const base = typeof t.base === "string" ? t.base : null;
  const changed = changedSince(dir, base)?.filter((f) => !f.startsWith(".aidw/")) ?? null;
  const touches = list(t.touches);
  const outside = changed ? changed.filter((f) => !matchesAny(touches, f)) : [];

  const runner = opts.runner ?? retryingShellRunner;
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const verify: VerifyRun[] = [];
  for (const command of list(t.verify)) {
    const started = Date.now();
    const r = runner(command, dir, timeoutMs);
    verify.push({ command, ms: Date.now() - started, ...r });
    if (r.exit !== 0) break; // later commands usually depend on earlier ones passing
  }
  const verifyOk = verify.length === list(t.verify).length && verify.every((v) => v.exit === 0);
  const previous = readEvidence(tf.change, t).checkpoints.at(-1)?.at;
  const design = designEvidence(p, id, t, changed, previous ?? (typeof t.started_at === "string" ? t.started_at : undefined));
  const designOk = !design || (design.missing_tokens.length === 0 && design.screenshots.length > 0);
  const ok = verifyOk && missing.length === 0 && designOk;

  const record: CheckpointRecord = {
    attempt: attemptsOf(t),
    at: now(),
    ok,
    base,
    scenarios,
    missing_scenarios: missing,
    verify,
    changed_files: changed,
    outside_touches: outside,
    ...(design ? { design } : {}),
  };
  const ev = readEvidence(tf.change, t);
  ev.checkpoints.push(record);
  writeEvidence(tf.change, ev);

  const problems: string[] = [];
  if (missing.length) problems.push(`no test names scenario ${missing.join(", ")}`);
  const failed = verify.find((v) => v.exit !== 0);
  if (failed) problems.push(`verify failed: \`${failed.command}\`${failed.timedOut ? " (timed out)" : ` (exit ${failed.exit})`}`);
  if (design?.missing_tokens.length) problems.push(`design tokens not in the code: ${design.missing_tokens.join(", ")}`);
  if (design && design.screenshots.length === 0) problems.push(`no fresh screenshot in ${rel(p, shotsDir(p, id, taskId))}`);
  setField(tf, i, "status", ok ? "review" : "failed");
  setField(tf, i, "evidence", evidenceRel(taskId));
  setField(tf, i, "notes", ok ? null : `checkpoint: ${problems.join("; ")}`);
  saveTasks(tf);
  return { ...record, task: taskId, status: ok ? "review" : "failed", problems, evidence: rel(p, join(tf.change.dir, evidenceRel(taskId))) };
}

// ---------------------------------------------------------------- review

export interface ReviewResult {
  task: string;
  verdict: "pass" | "fix";
  status: string;
  commit: string | null;
  warning?: string;
  /** wave task whose merge conflicted: dropped and back to pending, to rerun sequentially */
  conflict?: string;
}

export function recordReview(
  p: Paths,
  id: string,
  taskId: string,
  verdict: "pass" | "fix",
  notes: string,
  opts: { commit?: boolean } = {},
): ReviewResult {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  if (statusOf(t) !== "review") throw new OpError(`task ${taskId} is "${statusOf(t)}"; only a checkpointed task (review) can be reviewed`);

  const ev = readEvidence(tf.change, t);
  ev.reviews.push({ attempt: attemptsOf(t), at: now(), verdict, notes: notes.trim() });
  writeEvidence(tf.change, ev);

  if (verdict === "fix") {
    const exhausted = attemptsOf(t) >= maxAttemptsOf(t);
    setField(tf, i, "status", exhausted ? "escalated" : "failed");
    setField(tf, i, "notes", `review requested fixes (see ${evidenceRel(taskId)})${exhausted ? "; attempts exhausted" : ""}`);
    saveTasks(tf);
    return { task: taskId, verdict, status: exhausted ? "escalated" : "failed", commit: null };
  }

  const msg = taskCommitMessage(t, id, `.aidw/changes/${id}/${evidenceRel(taskId)}`);
  const inWorktree = typeof t.worktree === "string" && t.worktree !== "";
  if (inWorktree) {
    const m = mergeWorktree(p, t, msg);
    if (!m.ok) {
      // Blueprint 9.2: drop the branch and rerun the task sequentially on the latest code.
      removeWorktree(p, String(t.worktree), String(t.branch ?? ""));
      for (const f of ["worktree", "branch", "base", "started_at"]) setField(tf, i, f, null);
      setField(tf, i, "status", "pending");
      setField(tf, i, "attempts", 0);
      setField(tf, i, "sequential", true);
      setField(tf, i, "notes", `merge conflict after review (${m.conflict}); dropped, reruns sequentially on the latest code`.slice(0, 500));
      saveTasks(tf);
      return { task: taskId, verdict, status: "pending", commit: null, conflict: m.conflict };
    }
    setField(tf, i, "merged_at", now());
    setField(tf, i, "worktree", null);
    setField(tf, i, "branch", null);
  }
  setField(tf, i, "status", "done");
  setField(tf, i, "notes", null);
  setField(tf, i, "finished_at", now());
  saveTasks(tf);

  if (opts.commit === false && !inWorktree) return { task: taskId, verdict, status: "done", commit: null };
  if (!isGitRepo(p.project)) return { task: taskId, verdict, status: "done", commit: null, warning: "not a git repository: task not committed" };
  const add = git(p.project, ["add", "-A"]);
  const junk = add.ok ? stagedJunk(p.project) : [];
  if (junk.length) git(p.project, ["reset", "-q"]);
  const commit = junk.length ? { ok: false, out: "", err: junkMessage(junk) } : add.ok ? git(p.project, ["commit", "-q", "-m", msg]) : add;
  if (inWorktree && commit.ok) removeWorktree(p, String(t.worktree), String(t.branch ?? ""));
  if (!commit.ok) {
    // keep the task reviewable so the commit can be retried
    if (inWorktree) {
      git(p.project, ["merge", "--abort"]);
      setField(tf, i, "worktree", t.worktree);
      setField(tf, i, "branch", t.branch);
      setField(tf, i, "merged_at", null);
    }
    setField(tf, i, "status", "review");
    setField(tf, i, "finished_at", null);
    saveTasks(tf);
    throw new OpError(`task ${taskId} passed review but the commit failed: ${commit.err || commit.out}`);
  }
  return { task: taskId, verdict, status: "done", commit: headCommit(p.project) };
}

/** `VERDICT: pass|fix` on the first non-empty line of a reviewer's verdict; null when it is not there. */
export function parseVerdict(text: string): "pass" | "fix" | null {
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const m = /^\W*VERDICT:\s*(pass|fix)\b/i.exec(first);
  return m ? ((m[1] as string).toLowerCase() as "pass" | "fix") : null;
}

/**
 * A converge task only adds tests for scenarios that lacked one, and `aidw converge` re-checks them after
 * the fix. When its checkpoint passed and every changed file is a test file, a reviewer subagent adds a
 * whole fresh context for nothing: record the review as passed. Anything else still goes to a reviewer.
 */
export function autoReview(p: Paths, id: string, taskId: string, changed: string[] | null): ReviewResult | null {
  const tf = loadTasks(p, id);
  const t = tf.tasks[indexOf(tf, taskId)] as Task;
  if (t.origin !== "converge" || statusOf(t) !== "review" || !changed || changed.length === 0) return null;
  if (!changed.every((f) => TEST_FILE.test(f))) return null;
  return recordReview(p, id, taskId, "pass", "auto-reviewed: a converge task that changed only test files (checkpoint passed; `aidw converge` re-checks every scenario).");
}

// ---------------------------------------------------------------- integrate

/** Integration verify after a wave (state executing): the merged code runs the wave's verify and the code layer. */
export function integrateChange(p: Paths, id: string, opts: { runner?: CommandRunner; timeoutMs?: number } = {}): IntegrateResult {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const text = readText(qualityFile(tf.change));
  const quality = text === null ? null : parseQuality(text, "quality.yaml").config;
  return integrate(p, id, { loadTasks, save: (x) => saveTasks(x as TaskFile), runner: opts.runner ?? shellRunner, quality, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
}

// ---------------------------------------------------------------- brief

export interface Brief {
  kind: BriefKind;
  task: string;
  path: string;
  text: string;
  skills: { id: string; path: string; reason: string }[];
}

function pointer(p: Paths, file: string, what: string): string | null {
  return existsSync(file) ? `- \`${rel(p, file)}\`: ${what}` : null;
}

function adrPointers(p: Paths): string[] {
  return walkFiles(p.decisions)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const title = (readFileSync(f, "utf8").match(/^#\s+(.+)$/m)?.[1] ?? "").trim();
      return `- \`${rel(p, f)}\`${title ? `: ${title}` : ""}`;
    });
}

export function buildBrief(p: Paths, id: string, taskId: string, kind: BriefKind, vendorDir: string): Brief {
  const tf = loadTasks(p, id);
  const t = tf.tasks[indexOf(tf, taskId)] as Task;
  const status = statusOf(t);
  const ev = readEvidence(tf.change, t);
  const lastCheckpoint = ev.checkpoints.at(-1);
  const lastReview = ev.reviews.at(-1);
  // The latest event decides what the implementer must fix: a failed checkpoint or a "fix" review.
  const reviewIsLatest = !!lastReview && (!lastCheckpoint || lastReview.at >= lastCheckpoint.at);
  const failedCheckpoint = !reviewIsLatest && lastCheckpoint && !lastCheckpoint.ok ? lastCheckpoint : undefined;
  const fixReview = reviewIsLatest && lastReview?.verdict === "fix" ? lastReview : undefined;
  const retry = kind === "implement" && (!!failedCheckpoint || !!fixReview);

  const skills = selectSkills(t, kind, { retry }).map((s) => ({ ...s, path: join(vendorDir, ...s.id.split("/"), "SKILL.md") }));
  const reqs = requirementsAfterChange(p, id);
  const scenarioIds = list(t.scenarios);
  const reqIds = [...new Set([...list(t.specs), ...scenarioIds.map((s) => s.split("/").slice(0, -1).join("/"))])];
  const reqBlocks = reqIds.map((r) => {
    const req = reqs.get(r);
    return req ? `<!-- ${r} -->\n${req.raw.trim()}` : `<!-- ${r}: not found in specs after this change -->`;
  });
  const done = list(t.depends_on).map((d) => {
    const dep = tf.tasks.find((x) => x.id === d);
    return `- ${d}: ${String(dep?.title ?? "")} (${dep ? statusOf(dep) : "unknown"})`;
  });
  const base = typeof t.base === "string" ? t.base : null;
  // Prior work exists after a failed attempt or an interrupted session: changes since the base commit.
  const taskRoot = taskDir(p, t);
  const inWorktree = taskRoot !== p.project;
  const priorWork =
    kind === "implement" && status === "running" && base !== null && (changedSince(taskRoot, base) ?? []).some((f) => !f.startsWith(".aidw/"));
  const h = (title: string, body: string[]) => (body.length ? [`## ${title}`, "", ...body, ""] : []);
  const workdir = inWorktree
    ? h("Working directory (parallel wave)", [
        `This task runs beside other tasks, in its own git worktree: \`${taskRoot}\` (branch \`${String(t.branch ?? "")}\`).`,
        `\`cd\` there before anything else and run every command there. Paths in **Touches** are relative to it. Never edit the main checkout \`${p.project}\`, and never the worktree's own \`.aidw/\` (a stale copy).`,
        ...(kind === "implement" ? ["Dependencies resolve from the main checkout's `node_modules` (a parent folder). Do not install packages unless the task needs a new one; if it does, install inside the worktree and say so in your report."] : []),
      ])
    : [];

  const pointers = [
    pointer(p, p.constitution, "engineering principles every agent follows"),
    pointer(p, join(p.domain, "model.md"), "glossary, entities, business rules"),
    pointer(p, join(p.architecture, "overview.md"), "architecture, folder structure, integrations"),
    pointer(p, join(p.requirements, `${id}.md`), "user stories and implementation/testing decisions"),
    ...(touchesUi(t) ? [pointer(p, p.design, "design direction and assets (UI task)")] : []),
  ].filter((x): x is string => x !== null);
  const adrs = adrPointers(p);

  const touches = list(t.touches);
  const verify = list(t.verify);
  const decisions = decisionsToHonor(readText(join(tf.change.dir, "analysis.md")) ?? "");
  const tokenInfo = touchesUi(t) ? loadTokens(p) : null;
  const tokens = tokenInfo && tokenInfo.diags.errors.length === 0 ? tokenInfo.tokens : [];
  const shots = shotsDir(p, id, taskId);
  const reportFile = join(p.run, `report-${taskId}.md`);
  if (kind === "implement") rmSync(reportFile, { force: true }); // a note from an earlier attempt would be stale
  const header = [
    `# ${kind === "implement" ? "Task" : "Review"} brief: ${taskId} - ${String(t.title ?? "")}`,
    "",
    `Change \`${id}\` · role ${String(t.role ?? "?")} · attempt ${attemptsOf(t) || 1} of ${maxAttemptsOf(t)}`,
    "",
  ];

  const shared = [
    ...h("Scenarios", scenarioIds.length ? scenarioIds.map((s) => `- \`${s}\``) : ["- (none: this task is verified by its verify commands only)"]),
    ...h("Requirements (spec text after this change)", reqBlocks.length ? ["```markdown", reqBlocks.join("\n\n"), "```"] : []),
    ...h("Decisions to honor (approved; binding)", decisions.map((x) => `- ${x}`)),
    ...h(
      "Design tokens (approved; binding for UI)",
      tokens.length ? [...tokensTable(tokens), "", `Source: \`${rel(p, tokensFile(p))}\`. Each token's **Use** says where it must appear.`] : [],
    ),
    ...h("Builds on (finished tasks; see `git log`)", done),
    ...h("Touches (files this task may change)", touches.map((g) => `- \`${g}\``)),
    ...h("Verify", verify.map((v) => `- \`${v}\``)),
    ...h("Read first (context pointers; read only what you need)", [...pointers, ...adrs]),
    ...h("Skills (read each SKILL.md and apply it)", skills.map((s) => `- \`${s.path}\`: ${s.reason}`)),
  ];

  let body: string[];
  if (kind === "implement") {
    const previous: string[] = [];
    if (failedCheckpoint) {
      if (failedCheckpoint.missing_scenarios.length) previous.push(`- Missing scenario tests: ${failedCheckpoint.missing_scenarios.map((s) => `\`${s}\``).join(", ")}`);
      const failed = failedCheckpoint.verify.find((v) => v.exit !== 0);
      if (failed) previous.push(`- \`${failed.command}\` failed${failed.timedOut ? " (timed out)" : ` with exit ${failed.exit}`}:`, "", "```", failed.tail, "```");
      if (failedCheckpoint.design?.missing_tokens.length) previous.push(`- Design tokens not found in the code: ${failedCheckpoint.design.missing_tokens.map((x) => `\`${x}\``).join(", ")}`);
      if (failedCheckpoint.design && failedCheckpoint.design.screenshots.length === 0) previous.push(`- No fresh screenshot in \`${shots}\``);
    }
    if (fixReview) previous.push("- The reviewer asked for fixes:", "", fixReview.notes.split("\n").map((l) => `  ${l}`).join("\n"));
    body = [
      "You are the implementer of exactly this task, in a fresh context. Work from this brief and the files it points to.",
      "",
      "## Rules",
      "",
      "- Change only files matching **Touches**. If the task truly needs more, keep it minimal and say so in your report; never widen scope silently.",
      "- Do not edit anything under `.aidw/`, do not run `aidw checkpoint`/`aidw review`, and do not commit, push or deploy: the orchestrator records progress and commits after an independent review.",
      "- Test first. For every scenario, write a test whose name contains the scenario id verbatim, e.g. `test(\"booking/cancel-appointment/cancel-upcoming: cancels and frees the slot\")`, asserting the THEN outcome. `aidw checkpoint` looks for these ids in test files.",
      "- Run every **Verify** command yourself and make it pass before reporting.",
      "- Stop every process you start (dev servers, watchers) before you report; the checkpoint reruns everything on a clean machine state.",
      ...(decisions.length
        ? ["- **Decisions to honor** are approved and binding. If one is wrong or blocks the task, stop and report it as a blocker; never deviate silently (not even a key name or a tool)."]
        : []),
      ...(tokens.length
        ? [
            "- **Design**: style through the tokens below (CSS variables or theme), never hard-coded colors, and apply each token where its **Use** says.",
            `- **Screenshots**: when it works, save at most 6 PNG screenshots of the screens and states this task changes into \`${shots}\` (create it): the most telling states, at desktop and mobile width, dark theme too if tokens have dark values. The reviewer opens every one. **Every attempt, retries included, saves new ones**: the checkpoint counts only PNGs written after the previous checkpoint, even when the UI did not change.`,
            "- Take screenshots with Playwright through the project's `webServer` config (it starts and stops the app), e.g. a spec run on its own with `npx playwright test <file>`. If you start a server yourself, stop it before you report: a leftover server holds the e2e port and fails the checkpoint.",
          ]
        : []),
      "- Report in at most 10 lines: what works now, files changed, verify result.",
      `- Only if the reviewer needs to know something (a file outside Touches and why, a scenario you narrowed or could not cover, a risk), write it to \`${reportFile}\` with the Write tool (the only .aidw file you may write besides screenshots). Otherwise write nothing: do not create the file.`,
      "",
      ...workdir,
      ...(priorWork
        ? h("Resuming", [
            `Work from an earlier attempt or an interrupted session may already be in the working tree. Inspect it first (\`git status\`, \`git diff ${base}\`) and continue from it; do not start over.`,
          ])
        : []),
      ...h("Problem to fix", typeof t.problem === "string" ? ["```", t.problem.trim(), "```", "", "Find the root cause (debugging skill below), fix it, and make the verify commands pass. Touches is the whole project, but change only what the fix needs."] : []),
      ...h("Previous attempt", previous),
      ...shared,
    ];
  } else {
    const diff = base
      ? `${inWorktree ? `in the worktree \`${taskRoot}\`: ` : ""}\`git diff ${base}\` plus untracked files (\`git status --porcelain\`)`
      : "the files matching Touches (no base commit was recorded)";
    const outside = lastCheckpoint?.outside_touches ?? [];
    const design = lastCheckpoint?.design;
    body = [
      "You are an independent reviewer in a fresh context. You did not write this code. You may read files and run read-only commands (tests included); you cannot edit anything.",
      "",
      ...workdir,
      "## What to review",
      "",
      `- The task's changes: ${diff}.`,
      `- Checkpoint evidence: \`${rel(p, join(tf.change.dir, evidenceRel(taskId)))}\` (verify output, where each scenario test lives).`,
      ...(existsSync(reportFile) ? [`- Implementer notes: \`${rel(p, reportFile)}\` (read it first; it explains files outside Touches and anything the implementer flagged).`] : []),
      ...(outside.length ? [`- Files changed outside Touches: ${outside.map((f) => `\`${f}\``).join(", ")}. Decide whether each is justified.`] : []),
      ...(design?.screenshots.length ? [`- Screenshots (open each with Read): ${design.screenshots.map((f) => `\`${join(p.project, f)}\``).join(", ")}`] : []),
      ...(design?.hardcoded_colors.length ? [`- Color literals that are not tokens, in changed files: ${design.hardcoded_colors.map((f) => `\`${f}\``).join(", ")}. Each needs a reason or becomes a token.`] : []),
      "",
      "## Checklist",
      "",
      "1. Every scenario is implemented as the spec says, and its test really asserts the THEN outcome (not a placeholder, not mocked away).",
      "2. Behavior matches the requirement text; nothing outside this task's scope was added.",
      "3. Constitution, architecture and ADRs are followed.",
      ...(decisions.length ? ["4. Every **Decision to honor** below is kept exactly (names, keys, formats, tools). A silent deviation is a blocking issue."] : []),
      ...(tokens.length
        ? ["5. Design: look at every screenshot. Each token is used where its **Use** says (e.g. the accent color really appears on what it names), the layout matches the design direction, and no stray colors. A visible mismatch is a blocking issue."]
        : []),
      ...(isSecuritySensitive(t) ? ["6. Security: authorization on every path, input validation, secrets handling, data exposure (security skill below)."] : []),
      "",
      "## Verdict",
      "",
      "Your verdict starts with exactly one line: `VERDICT: pass` or `VERDICT: fix`.",
      "For `fix`, follow with numbered blocking issues: file, problem, expected fix. Only blocking issues justify `fix`;",
      "put anything else under `Non-blocking:`. Be concrete: the implementer will get your notes verbatim.",
      `**Write the whole verdict to \`${join(p.run, `review-${taskId}.md`)}\` with the Write tool** (the only file you may write), then reply with just its first line, \`VERDICT: pass\` or \`VERDICT: fix\`. The orchestrator reads the file; keeping your reply short saves its context.`,
      "",
      ...shared,
    ];
  }

  const text = [...header, ...body].join("\n").replace(/\n{3,}/g, "\n\n");
  const dir = join(p.run, "briefs", id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${taskId}.${kind}.md`);
  writeFileSync(path, text);
  return { kind, task: taskId, path, text, skills };
}
