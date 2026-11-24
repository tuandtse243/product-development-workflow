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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { decisionsToHonor, requirementsAfterChange } from "./analyze.js";
import { approvalStatus } from "./approval.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { hardcodedColors, loadTokens, missingTokens, shotsDir, taskShots, tokensFile, tokensTable } from "./design.js";
import { header as commitHeader, scopeOf, taskCommitMessage } from "./commit.js";
import { changedSince, git, headCommit, isGitRepo, junkMessage, stagedJunk } from "./git.js";
import { matchesAny } from "./glob.js";
import { detectProject } from "./detect.js";
import { defaultTaskRole, implementerOf, loadRole, loadRuleTable } from "./roles.js";
import { packsFor, packsOf } from "./stackpacks.js";
import { OpError, transition } from "./ops.js";
import { readText, rel, walkFiles, type Paths } from "./project.js";
import { planWaveBeside, closeConflict, conflictPartners, ensureWorktree, recordConflict, updateConflict, removeSnapshot, snapshotBase, integrate, mergeWorktree, parallelConfig, pendingIntegration, planWave, removeWorktree, taskDir, type IntegrateResult } from "./parallel.js";
import { parseQuality, qualityFile, resetQualitySummary } from "./quality.js";
import { selectSkills, skillPath, SKILLS_WITH_NOTES, touchesUi, isSecuritySensitive, type BriefKind } from "./skills.js";
import { configEvidence, type ConfigEvidence } from "./configlock.js";
import { envelopeBrief } from "./grants.js";
import { loadArtifacts } from "./artifacts.js";
import { BRIEF_READS } from "./briefreads.js";
export { BRIEF_READS } from "./briefreads.js";
import { loadDeviations, openDeviation } from "./deviationrecord.js";
import { abandonDeviation, authorsOf, openDeviationFor } from "./deviation.js";
import { loadConsultations, MAX_CONSULTATIONS_PER_RUN, pendingConsultation, taskAnswers, taskConsultable, taskRequestPath } from "./consult.js";
import { packageEvidence, packageProblems, type PackageEvidence } from "./depsafety.js";
import { secretsInChanges, secretsMessage, secretsProblem, stagedSecrets, type SecretFinding } from "./secrets.js";
import { tamperEvidence, tamperProblems, type TamperEvidence } from "./tamper.js";
import { DEFAULT_MAX_ATTEMPTS, parseTasks, planSha, validateTasksText, type Task } from "./tasks.js";
import { agentRunStatus, capReason } from "./agentruns.js";

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

export function setField(tf: TaskFile, i: number, key: string, value: unknown): void {
  if (value === undefined || value === null) tf.doc.deleteIn(["tasks", i, key]);
  else tf.doc.setIn(["tasks", i, key], value);
}

const statusOf = (t: Task) => String(t.status ?? "pending");
const attemptsOf = (t: Task) => (Number.isInteger(t.attempts) ? Number(t.attempts) : 0);
/** The planned attempts (`max_attempts` is part of the approved plan), plus the one a triage of cause `implementation` grants. */
const maxAttemptsOf = (t: Task) =>
  (Number.isInteger(t.max_attempts) ? Number(t.max_attempts) : DEFAULT_MAX_ATTEMPTS) +
  (typeof t.triage === "object" && t.triage !== null && (t.triage as { cause?: unknown }).cause === "implementation" ? 1 : 0);

/** Tasks only run while the change is executing with a valid approval. */
export function requireExecuting(p: Paths, change: Change): void {
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

// ---------------------------------------------------------------- not built (ADR-0014)

/** D9: rounds in which the author Role fixes its Artifact for one task before the task is marked not built. */
export const MAX_UPSTREAM_ROUNDS = 3;
export const UPSTREAM_CAUSES = ["plan", "spec", "architecture"] as const;
export type UpstreamCause = (typeof UPSTREAM_CAUSES)[number];

/** The Artifact of each upstream cause (artifacts.yaml): its owner is the Role that fixes it. */
const CAUSE_ARTIFACT: Record<UpstreamCause, string> = { plan: "tasks", spec: "delta-specs", architecture: "architecture" };
const DEFAULT_AUTHOR: Record<UpstreamCause, string> = { plan: "technical-planner", spec: "business-analyst", architecture: "software-architect" };
const DEFAULT_PATH: Record<UpstreamCause, string> = { plan: "changes/<id>/tasks.yaml", spec: "changes/<id>/specs/<capability>/spec.md", architecture: "architecture/overview.md" };

/** One upstream round of a task: the author Role of the cause fixes its Artifact (`open`), then the task reruns (`fixed`). */
export interface Upstream {
  cause: UpstreamCause;
  role: string;
  round: number;
  phase: "open" | "fixed";
  /** the Deviation this round opened for the author (T9), once `aidw brief --for upstream` opened it */
  deviation?: string;
  /** the files Triage named (an architecture or contract cause), else the Artifact of the cause */
  files?: string[];
}

function upstreamOf(t: Task): Upstream | null {
  const u = t.upstream;
  if (!isRecord(u) || !(UPSTREAM_CAUSES as readonly unknown[]).includes(u.cause) || typeof u.role !== "string" || !Number.isInteger(u.round)) return null;
  return {
    cause: u.cause as UpstreamCause,
    role: u.role,
    round: Number(u.round),
    phase: u.phase === "open" ? "open" : "fixed",
    ...(typeof u.deviation === "string" ? { deviation: u.deviation } : {}),
    ...(Array.isArray(u.files) ? { files: u.files.map(String) } : {}),
  };
}

function registryOf(pluginHome: string | undefined): ReturnType<typeof loadArtifacts> {
  if (!pluginHome) return null;
  try {
    return loadArtifacts(pluginHome);
  } catch {
    return null; // `aidw roster` reports a broken registry
  }
}

/** The Role that wrote the Artifact a cause points at: its owner in artifacts.yaml. */
export function authorOf(cause: UpstreamCause, pluginHome?: string): string {
  const owner = registryOf(pluginHome)?.[CAUSE_ARTIFACT[cause]]?.owner;
  return typeof owner === "string" && owner ? owner : DEFAULT_AUTHOR[cause];
}

/** Project-relative files of the Artifact the author changes for this task (the delta specs of the task's capabilities for a spec cause). */
function upstreamFiles(p: Paths, id: string, t: Task, cause: UpstreamCause, pluginHome?: string): string[] {
  const e = registryOf(pluginHome)?.[CAUSE_ARTIFACT[cause]];
  const path = (typeof e?.path === "string" ? e.path : DEFAULT_PATH[cause]).replace(/<id>/g, id);
  const file = (x: string) => rel(p, join(p.aidw, x));
  if (!path.includes("<capability>")) return [file(path)];
  const caps = [...new Set(list(t.specs).map((s) => s.split("/").slice(0, -1).join("/")).filter(Boolean))];
  if (caps.length) return caps.map((c) => file(path.replace(/<capability>/g, c)));
  // a task with no specs: every delta spec of the Change (a Deviation names files, not folders)
  const root = join(p.aidw, path.slice(0, path.indexOf("<capability>")));
  const all = walkFiles(root).filter((f) => f.endsWith(`${sep}spec.md`) || f.endsWith("/spec.md")).map((f) => rel(p, f)).sort();
  return all.length ? all : [file(path.replace(/<capability>/g, "<capability>"))];
}

/** Files Triage named in its answer (`FILES: a, b`), as project-relative paths inside .aidw/. */
function triageFiles(p: Paths, raw: string[]): string[] {
  return raw
    .map((f) => f.trim().replace(/^`|`$/g, ""))
    .filter(Boolean)
    .map((f) => (f.startsWith(".aidw/") ? f : `.aidw/${f.replace(/^\/+/, "")}`))
    .filter((f) => !f.split("/").includes("..") && existsSync(join(p.project, f)));
}

const OPEN_WORK = new Set(["done", "not_built", "running", "review", "conflict"]);

/** Why a task was not built: the same shape as the Deviation record's (T9). */
export type NotBuiltCause = "triage" | "environment" | "dependency" | "envelope" | "cap" | "fix-rounds";

/**
 * Marks a task not built (`not_built: { cause, reason, at }`), and every task that depends on it, directly or not, that
 * has not started or failed, with the cause `dependency` (D9). Work that is done or still running is left alone. A
 * failed wave task's worktree is removed: nothing of it is merged. Saves tasks.yaml and returns the ids marked.
 */
export function markNotBuilt(p: Paths, tf: TaskFile, taskId: string, reason: string, cause: NotBuiltCause): string[] {
  const marked: string[] = [];
  const queue: [string, string, NotBuiltCause][] = [[taskId, reason, cause]];
  while (queue.length) {
    const [tid, why, kind] = queue.shift() as [string, string, NotBuiltCause];
    const i = tf.tasks.findIndex((t) => t.id === tid);
    const t = tf.tasks[i];
    if (!t || marked.includes(tid) || (tid !== taskId && OPEN_WORK.has(statusOf(t)))) continue;
    if (typeof t.worktree === "string" && t.worktree) removeWorktree(p, t.worktree, typeof t.branch === "string" ? t.branch : undefined);
    // its half-done work on the main checkout must not ride along in the next task's commit
    const gone = tid === taskId ? discardWork(p, tf, t) : { files: [] as string[] };
    const text = gone.files.length
      ? `${why}; its uncommitted work on the main checkout was discarded: ${gone.files.slice(0, 20).join(", ")}${gone.files.length > 20 ? ` and ${gone.files.length - 20} more` : ""} (saved in ${(gone.saved ?? []).join(" and ")})`
      : gone.skipped
        ? `${why}; ${gone.skipped}`
        : why;
    for (const f of ["worktree", "branch"]) setField(tf, i, f, null);
    setField(tf, i, "status", "not_built");
    setField(tf, i, "not_built", { cause: kind, reason: text.slice(0, 1000), at: now(), ...(gone.files.length ? { discarded: gone.files, saved: gone.saved ?? [] } : {}) });
    setField(tf, i, "notes", text.slice(0, 500));
    marked.push(tid);
    for (const d of tf.tasks) if (list(d.depends_on).includes(tid)) queue.push([d.id, `depends on ${tid}, which is not built`, "dependency"]);
  }
  if (marked.length) saveTasks(tf);
  return marked;
}

/** Lists of paths from a NUL-separated git output. */
const zList = (out: string): string[] => out.split("\0").filter(Boolean);

/** Paths that differ from HEAD on the main checkout (changed, deleted, staged or untracked), outside .aidw/. */
function dirtyPaths(p: Paths): string[] {
  const changed = git(p.project, ["diff", "--name-only", "-z", "HEAD", "--", ".", ":(exclude).aidw"]);
  const untracked = git(p.project, ["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ":(exclude).aidw"]);
  return [...new Set([...zList(changed.out), ...zList(untracked.out)])].sort();
}

/**
 * A task that ran on the main checkout and is now not built (ADR-0014): what it left uncommitted is put back as HEAD
 * has it (tracked files) or removed (files it created), so the next task's commit does not carry it. Paths that were
 * already dirty when the task first started (`start_dirty`) and everything under .aidw/ are left alone. Nothing is
 * touched while another task works on the main checkout.
 */
function discardWork(p: Paths, tf: TaskFile, t: Task): { files: string[]; skipped?: string; saved?: string[] } {
  if ((typeof t.worktree === "string" && t.worktree) || typeof t.base !== "string" || !isGitRepo(p.project)) return { files: [] };
  if (!["running", "failed", "review", "conflict"].includes(statusOf(t))) return { files: [] };
  const busy = tf.tasks.find((x) => x.id !== t.id && ["running", "review"].includes(statusOf(x)) && !(typeof x.worktree === "string" && x.worktree));
  if (busy) return { files: [], skipped: `its uncommitted work was left on the main checkout because ${busy.id} works there too` };
  const keep = new Set(list(t.start_dirty));
  const files = dirtyPaths(p).filter((f) => !keep.has(f));
  if (!files.length) return { files };
  // nothing is destroyed for good: the tracked edits as a patch, the files the task created as copies
  const inHead = (f: string) => git(p.project, ["cat-file", "-e", `HEAD:${f}`]).ok;
  const evidence = join(p.run, "evidence");
  const patchFile = join(evidence, `notbuilt-${t.id}.patch`);
  const copyDir = join(evidence, `notbuilt-${t.id}`);
  const tracked = files.filter(inHead);
  const created = files.filter((f) => !inHead(f));
  const saved: string[] = [];
  mkdirSync(evidence, { recursive: true });
  if (tracked.length) {
    const d = git(p.project, ["diff", "--binary", "HEAD", "--", ...tracked]);
    if (!d.ok) return { files: [], skipped: `its uncommitted work was left on the main checkout: saving it failed (${d.err})` };
    writeFileSync(patchFile, `${d.out}\n`);
    saved.push(rel(p, patchFile));
  }
  rmSync(copyDir, { recursive: true, force: true });
  for (const f of created) {
    const from = join(p.project, f);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(copyDir, f)), { recursive: true });
    copyFileSync(from, join(copyDir, f));
  }
  if (created.length && existsSync(copyDir)) saved.push(`${rel(p, copyDir)}/`);
  for (const f of files) {
    if (git(p.project, ["cat-file", "-e", `HEAD:${f}`]).ok) git(p.project, ["checkout", "HEAD", "--", f]);
    else {
      git(p.project, ["rm", "-q", "--cached", "--ignore-unmatch", "--", f]);
      rmSync(join(p.project, f), { force: true });
    }
  }
  return { files, saved };
}

/**
 * What the run decides by itself before it picks the next step (ADR-0014); `aidw next` and the commands that change
 * state run it, the read-only views (the SessionStart hook, a NEXT line) do not:
 *   - a task whose extra attempt after an `implementation` Triage failed too is not built;
 *   - at the cap on Agent runs no new task starts: an open upstream Deviation is abandoned (its author was not spawned
 *     or is cut short), then every task that has not started or that failed is not built; running work
 *     (running, review, conflict) finishes;
 *   - tasks that can never run (no runnable task and nothing in flight) are not built, so the run never stops on them.
 * Nothing is written while a Deviation of tasks.yaml is open: its author is editing that file.
 */
export function settleChange(p: Paths, id: string): void {
  let tf = loadTasks(p, id);
  if (stateOf(tf.change) !== "executing") return;
  const cap = agentRunStatus(p, tf.change);
  let dev = openDeviation(tf.change);
  if (cap.reached && dev?.task) {
    const u = upstreamOf(tf.tasks.find((t) => t.id === dev?.task) ?? { id: "" });
    if (u?.phase === "open" && u.deviation === dev.id) {
      abandonDeviation(p, id);
      tf = loadTasks(p, id);
      dev = openDeviation(tf.change);
    }
  }
  if (dev && dev.files.includes(rel(p, tf.file))) return;
  for (const t of [...tf.tasks]) {
    const now = tf.tasks.find((x) => x.id === t.id) as Task;
    if (statusOf(now) === "failed" && attemptsOf(now) >= maxAttemptsOf(now) && isRecord(now.triage) && now.triage.cause === "implementation") {
      markNotBuilt(p, tf, now.id, `triage: implementation; the further attempt failed too: ${String(now.notes ?? "")}`, "triage");
    }
  }
  if (cap.reached) {
    for (const t of [...tf.tasks]) {
      const now = tf.tasks.find((x) => x.id === t.id) as Task;
      if (statusOf(now) === "pending" || statusOf(now) === "failed") markNotBuilt(p, tf, now.id, capReason(cap), "cap");
    }
  }
  // the last fallback: nothing runnable and nothing in flight, yet tasks are open (a dependency that is escalated or blocked)
  const n = taskAction(p, tf, new Set());
  if (n.action === "escalate" && !n.task) {
    for (const t of [...tf.tasks]) {
      const now = tf.tasks.find((x) => x.id === t.id) as Task;
      if (!OPEN_WORK.has(statusOf(now)) && statusOf(now) !== "escalated") markNotBuilt(p, tf, now.id, `can never run: ${n.reason}`, "dependency");
    }
  }
}

// ---------------------------------------------------------------- next

export type TaskAction =
  | { action: "implement"; task: string; title: string; reason: "new" | "retry" | "interrupted" }
  | { action: "wave"; tasks: { task: string; title: string }[] }
  | { action: "integrate"; tasks: string[] }
  | { action: "review"; task: string; title: string }
  | { action: "resolve"; task: string; title: string; with: string[]; files: string[] }
  | { action: "review-merge"; task: string; title: string; with: string[] }
  | { action: "triage"; task: string; title: string; reason: string }
  /** open: `aidw brief --for upstream` opens the round's Deviation and briefs the author; author: it is open, the author works */
  | { action: "upstream"; step: "open" | "author"; task: string; title: string; cause: UpstreamCause; role: string; round: number; deviation?: string; brief?: string }
  | { action: "escalate"; task?: string; reason: string }
  | { action: "complete"; done: number; not_built?: string[] };

/**
 * A Consultation in flight (ADR-0013): `answer` spawns the consulted Role, `record` runs `aidw consult answer` (the
 * answer file is there), `resume` continues the asker. `meanwhile` is what the rest of the Change does at the same time.
 */
export type ConsultAction = {
  action: "consult";
  /** deviation: the answer needs a change to the approved package; the lead opens a Deviation for the author Role */
  step: "answer" | "record" | "deviation" | "resume";
  consultation: string;
  from: string;
  to: string;
  task?: string;
  stage?: string;
  status: string;
  brief: string;
  meanwhile?: TaskAction;
};

/** An open Deviation (ADR-0014): the author Role changes the files it names, then `aidw deviation close` checks and records it. */
export type DeviationAction = {
  action: "deviation";
  deviation: string;
  /** file -> the Role that changes it */
  authors: Record<string, string>;
  brief: string;
  meanwhile?: TaskAction;
};

export type NextAction = TaskAction | ConsultAction | DeviationAction;

/**
 * What may run beside tasks that wait for an answer (ADR-0013), or nothing. An asker on the main checkout (a sequential
 * Change) holds it with its half-done work: nothing runs beside it, since a checkpoint, a commit or a new task there
 * would take that work along. Askers in their own worktrees: work on tasks already started (a review, a conflict, an
 * integration, a task that runs in its own worktree), and new tasks only as a wave that counts every running task as
 * holding its slot, its touches and its browser. An escalation or the end of the Change waits.
 */
function besideAction(p: Paths, tf: TaskFile, waiting: Task[], rest: TaskAction): TaskAction | undefined {
  if (waiting.some((t) => typeof t.worktree !== "string" || !t.worktree)) return undefined;
  switch (rest.action) {
    case "review":
    case "resolve":
    case "review-merge":
    case "triage":
    case "upstream":
    case "integrate":
      return rest;
    case "implement": {
      const t = tf.tasks.find((x) => x.id === rest.task);
      if (rest.reason !== "new") return t && typeof t.worktree === "string" && t.worktree ? rest : undefined;
      break;
    }
    case "wave":
      break;
    default:
      return undefined;
  }
  const busy = tf.tasks.filter((t) => statusOf(t) === "running");
  const wave = planWaveBeside(tf.tasks, parallelConfig(p, tf.change).max, busy);
  return wave.length ? { action: "wave", tasks: wave.map((t) => ({ task: t.id, title: String(t.title ?? "") })) } : undefined;
}

export function nextAction(p: Paths, id: string): NextAction {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  // A Consultation in flight first, so a fresh session does not respawn its asker blind; the tasks that wait for one are
  // left out of the rest, which carries on meanwhile (ADR-0013).
  const pending = loadConsultations(tf.change).filter((c) => c.status !== "resumed");
  const c = pendingConsultation(tf.change);
  const waitingIds = new Set(pending.flatMap((x) => (x.task ? [x.task] : [])));
  const rest = taskAction(p, tf, waitingIds);
  // ADR-0014: an open Deviation before anything new; work already in flight goes on beside it.
  const dev = openDeviation(tf.change);
  const up = dev?.task ? tf.tasks.find((t) => t.id === dev.task) : undefined;
  const upRound = up ? upstreamOf(up) : null;
  if (dev && up && upRound?.phase === "open" && upRound.deviation === dev.id) {
    // the Deviation of an upstream round: its author was spawned with the upstream brief, one brief for one Agent run
    return { action: "upstream", step: "author", task: up.id, title: String(up.title ?? ""), cause: upRound.cause, role: upRound.role, round: upRound.round, deviation: dev.id, brief: join(p.run, "briefs", id, `${up.id}.upstream.md`) };
  }
  if (dev) {
    // nothing beside a Deviation of the task list: the CLI would record progress in the file its author is editing
    const tasksOpen = dev.files.includes(rel(p, join(tf.change.dir, "tasks.yaml")));
    const inFlight = !tasksOpen && (["review", "resolve", "review-merge", "integrate", "triage"].includes(rest.action) || (rest.action === "implement" && rest.reason !== "new"));
    return { action: "deviation", deviation: dev.id, authors: dev.authors, brief: join(p.run, "briefs", id, `${dev.id}.deviation.md`), ...(inFlight ? { meanwhile: rest } : {}) };
  }
  if (c) {
    const step =
      c.status === "needs-deviation" && c.deviation === "pending"
        ? "deviation"
        : c.status !== "open"
          ? "resume"
          : existsSync(join(tf.change.dir, c.answer))
            ? "record"
            : "answer";
    return {
      action: "consult",
      step,
      consultation: c.id,
      from: c.from,
      to: c.to,
      ...(c.task ? { task: c.task } : {}),
      ...(c.stage ? { stage: c.stage } : {}),
      status: c.status,
      brief: join(p.aidw, c.brief),
      ...((m) => (m ? { meanwhile: m } : {}))(besideAction(p, tf, tf.tasks.filter((t) => waitingIds.has(t.id)), rest)),
    };
  }
  return rest;
}

function taskAction(p: Paths, tf: TaskFile, waiting: ReadonlySet<string>): TaskAction {
  const title = (t: Task) => String(t.title ?? "");
  // Unfinished work first, in file order: a review or an interrupted task resumes before anything new.
  for (const t of tf.tasks) if (statusOf(t) === "review") return { action: "review", task: t.id, title: title(t) };
  for (const t of tf.tasks) if (statusOf(t) === "running" && !waiting.has(t.id)) return { action: "implement", task: t.id, title: title(t), reason: "interrupted" };
  // T7: a wave task whose merge conflicted waits for the integration Role, then for the review of the merge.
  for (const t of tf.tasks) {
    if (statusOf(t) !== "conflict") continue;
    const c = isRecord(t.conflict) ? t.conflict : {};
    if (c.phase === "review") return { action: "review-merge", task: t.id, title: title(t), with: list(c.with) };
    return { action: "resolve", task: t.id, title: title(t), with: list(c.with), files: list(c.files) };
  }
  for (const t of tf.tasks) {
    if (statusOf(t) === "escalated") return { action: "escalate", task: t.id, reason: `task ${t.id} is escalated: ${String(t.notes ?? "needs the user")}` };
  }
  for (const t of tf.tasks) {
    if (statusOf(t) !== "failed") continue;
    if (attemptsOf(t) >= maxAttemptsOf(t)) {
      // A task that ran out of attempts is diagnosed by an independent Agent; the CLI routes its cause (ADR-0014).
      if (t.triage === undefined) return { action: "triage", task: t.id, title: title(t), reason: `task ${t.id} used ${attemptsOf(t)} of ${maxAttemptsOf(t)} attempts: ${String(t.notes ?? "")}` };
      const u = upstreamOf(t);
      if (u?.phase === "open") return { action: "upstream", step: "open", task: t.id, title: title(t), cause: u.cause, role: u.role, round: u.round };
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
  const open = tf.tasks.filter((t) => statusOf(t) !== "done" && statusOf(t) !== "not_built");
  if (open.length === 0) {
    const notBuilt = tf.tasks.filter((t) => statusOf(t) === "not_built").map((t) => t.id);
    return { action: "complete", done: tf.tasks.length - notBuilt.length, ...(notBuilt.length ? { not_built: notBuilt } : {}) };
  }
  const stuck = open.map((t) => `${t.id} (${statusOf(t)}${list(t.depends_on).length ? `, needs ${list(t.depends_on).join(", ")}` : ""})`);
  return { action: "escalate", reason: `no runnable task: ${stuck.join("; ")}` };
}

// ---------------------------------------------------------------- task start

export interface StartResult {
  task: string;
  /** the Role that owns the task (`role:` in tasks.yaml); the Agent that runs it is derived from it */
  role?: string;
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
  // Triage decides what follows a task out of attempts (ADR-0014); starting it again is not the way on.
  if (attempt > max) throw new OpError(`task ${taskId} used all ${max} attempts: run \`aidw next\` (Triage comes next)`);
  // D10: at the cap on Agent runs no new attempt starts; one already running is resumed and finishes.
  const cap = agentRunStatus(p, tf.change);
  if (!resumed && cap.reached) throw new OpError(`task ${taskId} does not start: ${capReason(cap)}; run \`aidw next\``);
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
  // what was already uncommitted when the task first started on the main checkout is not its work (see discardWork)
  if (!worktree && status === "pending" && t.start_dirty === undefined && isGitRepo(p.project) && base) setField(tf, i, "start_dirty", dirtyPaths(p).slice(0, 2000));
  setField(tf, i, "status", "running");
  setField(tf, i, "attempts", attempt);
  // ADR-0013: a Consultation budget belongs to one Agent run; a new attempt (a granted retry too) is a new run.
  setField(tf, i, "runs", resumed ? Math.max(Number.isInteger(t.runs) ? Number(t.runs) : attemptsOf(t), 1) : (Number.isInteger(t.runs) ? Number(t.runs) : attemptsOf(t)) + 1);
  if (!t.started_at) setField(tf, i, "started_at", now());
  if (base) setField(tf, i, "base", base);
  saveTasks(tf);
  return { task: taskId, ...(typeof t.role === "string" ? { role: t.role } : {}), attempt, maxAttempts: max, base, resumed, ...(worktree ? { worktree } : {}) };
}

/**
 * User-granted retry of an escalated, failed or not-built task: a fresh attempt budget, same base commit. A task not
 * built (ADR-0014) comes back with the tasks that were not built only because they depend on it.
 */
export function retryTask(p: Paths, id: string, taskId: string): { task: string; revived?: string[] } {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  if (statusOf(t) === "not_built") {
    const cause = String((t.not_built as { cause?: unknown } | null | undefined)?.cause ?? "");
    if (cause === "dependency") throw new OpError(`task ${taskId} is not built because a task it depends on is not built: ${String((t.not_built as { reason?: unknown }).reason ?? "")}; retry that one`);
    const cap = agentRunStatus(p, tf.change);
    if (cap.reached) throw new OpError(`${capReason(cap)}: raise it first (the user runs \`aidw cap ${id} --raise <runs>\`), then retry ${taskId}`);
    return { task: taskId, revived: reviveNotBuilt(tf, taskId, "retry granted by the user") };
  }
  if (statusOf(t) !== "escalated" && statusOf(t) !== "failed") {
    throw new OpError(`task ${taskId} is "${statusOf(t)}"; only escalated, failed or not built tasks can be retried`);
  }
  setField(tf, i, "status", "failed");
  setField(tf, i, "attempts", 0);
  // a fresh budget: a later failure is triaged again; an open upstream round is closed (the rounds already used still count)
  setField(tf, i, "triage", null);
  if (upstreamOf(t)?.phase === "open") setField(tf, i, "upstream", { ...(t.upstream as Record<string, unknown>), phase: "fixed" });
  setField(tf, i, "notes", `retry granted by the user; before: ${String(t.notes ?? "")}`.slice(0, 500));
  saveTasks(tf);
  return { task: taskId };
}

/**
 * Brings a not-built task back (ADR-0014; `aidw task retry`, or /aidw:resume of a draft): a task that had started is
 * `failed` with a fresh attempt budget, one that never started is `pending`; the tasks not built only because they
 * depend on it, directly or not, are `pending` again. Saves tasks.yaml and returns the ids brought back.
 */
export function reviveNotBuilt(tf: TaskFile, taskId: string, why: string): string[] {
  const out: string[] = [];
  const queue = [taskId];
  while (queue.length) {
    const tid = queue.shift() as string;
    const i = tf.tasks.findIndex((x) => x.id === tid);
    const t = tf.tasks[i];
    if (!t || out.includes(tid) || statusOf(t) !== "not_built") continue;
    if (tid !== taskId && (t.not_built as { cause?: unknown } | null | undefined)?.cause !== "dependency") continue;
    const started = attemptsOf(t) > 0 || Boolean(t.started_at);
    setField(tf, i, "status", started ? "failed" : "pending");
    setField(tf, i, "attempts", started ? 0 : null);
    for (const f of ["not_built", "triage", "blocked_runs"]) setField(tf, i, f, null);
    if (upstreamOf(t)?.phase === "open") setField(tf, i, "upstream", { ...(t.upstream as Record<string, unknown>), phase: "fixed" });
    setField(tf, i, "notes", `${why}; before: ${String(t.notes ?? "")}`.slice(0, 500));
    out.push(tid);
    for (const d of tf.tasks) if (list(d.depends_on).includes(tid)) queue.push(d.id);
  }
  if (out.length) saveTasks(tf);
  return out;
}

// ---------------------------------------------------------------- evidence

const SKIP_DIRS = new Set(["node_modules", ".git", ".aidw", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", "dist", "build", "out", "coverage", "playwright-report", "test-results"]);
export const TEST_FILE = /(^|\/)(__tests__|tests?|e2e|specs?)\/|\.(test|spec|e2e)\.[a-z0-9]+$/i;
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
  /** tests removed, skipped or focused, and checks switched off, in what the task changed */
  tamper?: TamperEvidence;
  /** configuration of the checks (lint, types, CI, hooks, test runner) this task changed */
  config?: ConfigEvidence;
  /** credentials in the lines this task added (the value is never recorded) */
  secrets?: SecretFinding[];
  /** packages this task added: existence, release age and known advisories */
  packages?: PackageEvidence;
  /** UI tasks with approved design tokens only */
  design?: DesignEvidence;
  /** `type: fix` tasks only: does the new test fail on the old code? */
  regression?: RegressionEvidence;
}

/**
 * Proof that a bugfix's regression test reproduces the bug: the changed test files are run, with the task's unit-test
 * verify commands, against a checkout of the base commit. `red` = they fail there (good); `not-red` = they pass on the
 * old code or the task changed no test (the checkpoint fails); `unproven` = it could not be checked (the reviewer is told).
 */
export interface RegressionEvidence {
  status: "red" | "not-red" | "unproven";
  reason: string;
  files: string[];
  /** how the old code was checked out: a git worktree, or a plain copy when git may not write under .git */
  via?: "worktree" | "snapshot";
  command?: string;
  exit?: number | null;
  tail?: string;
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
const SERVER_ROLES: ReadonlySet<string> = new Set(["backend", "database", "devops"]);
/**
 * A task whose screens the design check judges: it touches UI paths and its Role is not a server-side one, which builds
 * no screen whatever its paths look like (seen on a real run: a backend task owning a Next.js route handler under
 * app/rooms/ had to screenshot raw JSON to pass).
 */
const buildsScreens = (t: Task): boolean => touchesUi(t) && !(typeof t.role === "string" && SERVER_ROLES.has(t.role));

function designEvidence(p: Paths, id: string, t: Task, changed: string[] | null, since: string | undefined): DesignEvidence | null {
  if (!buildsScreens(t)) return null;
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

/**
 * Output of a check the machine refused, not the code: the sandbox denying a file lock, a proxy answering 407 or 502,
 * a package scanner timing out. Seen on a real run: `pnpm install --frozen-lockfile` in a scaffold's verify hit the
 * sandbox's denial of pnpm's store lock twice, and each counted as a failed attempt (2 of 3 used on a correct task).
 */
export const ENVIRONMENT_FAILURE =
  /Operation not permitted|ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK|Proxy Authentication Required|proxy CONNECT failed|502 Bad Gateway|Timeout exceeded while scanning|Failed to check for malicious packages|getaddrinfo (EAI_AGAIN|ENOTFOUND)/i;

export interface CheckpointResult extends CheckpointRecord {
  task: string;
  /**
   * `blocked`: a check failed for a reason outside the code; the task stays running and no attempt is used.
   * `not_built`: the machine refused a check of this task a second time (ADR-0014: an environment cause)
   */
  status: "review" | "failed" | "blocked" | "not_built";
  /** not_built: the task and its dependants */
  not_built?: string[];
  /** why the checkpoint failed, one line each (empty when it passed) */
  problems: string[];
  evidence: string;
}

const UNIT_TEST_COMMAND = /\b(vitest|jest|mocha|pytest|test)\b|go test|cargo test/;
const BROWSER_COMMAND = /playwright|cypress|\be2e\b/i;

/** Output of a test run that failed before running any assertion: a missing module or export. */
const NOT_LOADABLE = /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import|Failed to load url|ModuleNotFoundError|ImportError|does not provide an export named/i;

function proveRegression(p: Paths, id: string, t: Task, dir: string, base: string | null, changed: string[] | null, runner: CommandRunner, timeoutMs: number): RegressionEvidence {
  const files = (changed ?? []).filter((f) => TEST_FILE.test(f));
  if (!base || !isGitRepo(dir)) return { status: "unproven", reason: "there is no base commit to compare with", files };
  if (!files.length) return { status: "not-red", reason: "the task changed no test file: a fix needs a regression test that fails on the old code", files };
  const commands = list(t.verify).filter((c) => UNIT_TEST_COMMAND.test(c) && !BROWSER_COMMAND.test(c));
  if (!commands.length) return { status: "unproven", reason: "no verify command runs unit tests, so the old code could not be checked", files };
  // Prefer a git worktree; when git may not write under `.git` (a sandbox), fall back to a plain copy of the base commit.
  let wt: { dir: string; branch?: string };
  let via: "worktree" | "snapshot" = "worktree";
  try {
    wt = ensureWorktree(p, id, `${String(t.id)}-red`, base);
  } catch (e) {
    try {
      wt = { dir: snapshotBase(p, id, `${String(t.id)}-red`, base) };
      via = "snapshot";
    } catch (e2) {
      return { status: "unproven", reason: `could not check out the base commit: ${(e as Error).message}; a plain copy failed too: ${(e2 as Error).message}`, files };
    }
  }
  const wdir = join(p.project, wt.dir);
  try {
    for (const f of files) {
      if (!existsSync(join(dir, f))) continue; // a deleted test
      mkdirSync(dirname(join(wdir, f)), { recursive: true });
      copyFileSync(join(dir, f), join(wdir, f));
    }
    let last: { command: string; exit: number | null; tail: string } = { command: commands[0] as string, exit: 0, tail: "" };
    for (const command of commands) {
      const r = runner(command, wdir, Math.min(timeoutMs, 5 * 60 * 1000));
      if (r.timedOut) return { status: "unproven", reason: `\`${command}\` timed out on the old code`, files, command, via };
      last = { command, exit: r.exit, tail: r.tail };
      if (r.exit !== 0) {
        // A test that cannot even load on the old code (it imports a module the fix adds) fails for that, not for the bug.
        if (NOT_LOADABLE.test(r.tail)) {
          return { status: "unproven", reason: "the new tests fail on the old code, but because something they import does not exist there yet, not necessarily because of the bug: check that the assertion itself fails", files, via, ...last };
        }
        return { status: "red", reason: "the new tests fail on the old code", files, via, ...last };
      }
    }
    return { status: "not-red", reason: "the new tests pass on the old code: they do not reproduce the bug", files, via, ...last };
  } finally {
    if (via === "worktree") removeWorktree(p, wt.dir, wt.branch);
    else removeSnapshot(p, wt.dir);
  }
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
  const regression = t.type === "fix" && verifyOk ? proveRegression(p, id, t, dir, base, changed, runner, timeoutMs) : undefined;
  const regressionOk = !regression || regression.status !== "not-red";
  const tamper = tamperEvidence(dir, base, changed, { isTest: (f) => TEST_FILE.test(f), removesTests: t.removes_tests === true });
  const tamperOk = !tamper || tamper.blocked.length === 0;
  const config = configEvidence(dir, base, changed, t.type);
  const secrets = secretsInChanges(dir, base, changed) ?? [];
  const packages = packageEvidence(dir, base, changed);
  const guardsOk = tamperOk && !config?.locked.length && secrets.length === 0 && !packages?.blocked.length;
  const ok = verifyOk && missing.length === 0 && designOk && regressionOk && guardsOk;

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
    ...(tamper && (tamper.blocked.length || tamper.justified.length || tamper.snapshots?.length) ? { tamper } : {}),
    ...(config && (config.locked.length || config.watched.length) ? { config } : {}),
    ...(secrets.length ? { secrets } : {}),
    ...(packages ? { packages } : {}),
    ...(design ? { design } : {}),
    ...(regression ? { regression } : {}),
  };
  const ev = readEvidence(tf.change, t);
  ev.checkpoints.push(record);
  writeEvidence(tf.change, ev);

  const problems: string[] = [];
  if (missing.length) problems.push(`no test names scenario ${missing.join(", ")}`);
  const failed = verify.find((v) => v.exit !== 0);
  if (failed) problems.push(`verify failed: \`${failed.command}\`${failed.timedOut ? " (timed out)" : ` (exit ${failed.exit})`}`);
  if (regression?.status === "not-red") problems.push(`no regression proof: ${regression.reason}`);
  problems.push(...tamperProblems(tamper));
  if (config?.locked.length) problems.push(`check configuration changed by a task that is not a tooling task: ${config.locked.join(", ")}`);
  if (secrets.length) problems.push(secretsProblem(secrets));
  problems.push(...packageProblems(packages));
  if (design?.missing_tokens.length) problems.push(`design tokens not in the code: ${design.missing_tokens.join(", ")}`);
  if (design && design.screenshots.length === 0) problems.push(`no fresh screenshot in ${rel(p, shotsDir(p, id, taskId))}`);
  const refused = failed && !failed.timedOut ? ENVIRONMENT_FAILURE.exec(failed.tail)?.[0] : undefined;
  if (refused) {
    const why = `environment: \`${failed!.command}\` was refused by the machine (${refused}), not by the code`;
    const evidence = rel(p, join(tf.change.dir, evidenceRel(taskId)));
    const marked = noteBlocked(p, tf, i, why);
    if (marked) return { ...record, task: taskId, status: "not_built", not_built: marked, problems: [why], evidence };
    return { ...record, task: taskId, status: "blocked", problems: [why, ...problems.filter((x) => !x.startsWith("verify failed"))], evidence };
  }
  setField(tf, i, "blocked_runs", null);
  setField(tf, i, "status", ok ? "review" : "failed");
  setField(tf, i, "evidence", evidenceRel(taskId));
  setField(tf, i, "notes", ok ? null : `checkpoint: ${problems.join("; ")}`);
  saveTasks(tf);
  return { ...record, task: taskId, status: ok ? "review" : "failed", problems, evidence: rel(p, join(tf.change.dir, evidenceRel(taskId))) };
}

/**
 * A check of the task the machine refused (the sandbox, a proxy, a scanner): the first time the task stays as it is and
 * the lead runs the check once more outside the sandbox; the second time it is an environment cause (ADR-0014): the
 * task and its dependants are not built and the rest carries on. Returns the ids marked, or null on the first refusal.
 */
function noteBlocked(p: Paths, tf: TaskFile, i: number, why: string): string[] | null {
  const t = tf.tasks[i] as Task;
  const n = (Number.isInteger(t.blocked_runs) ? Number(t.blocked_runs) : 0) + 1;
  if (n < 2) {
    setField(tf, i, "blocked_runs", n);
    setField(tf, i, "notes", `blocked: ${why}`);
    saveTasks(tf);
    return null;
  }
  setField(tf, i, "blocked_runs", n);
  if (isRecord(t.conflict)) {
    setField(tf, i, "conflict", null);
    closeConflict(tf.change, t.id, "dropped", `${why}; refused twice, not built`);
  }
  saveTasks(tf);
  return markNotBuilt(p, tf, t.id, `the machine refused a check twice: ${why}`, "environment");
}

/** `aidw resolve` was blocked by the machine (src/conflict.ts): counted like a blocked checkpoint. */
export function recordBlocked(p: Paths, id: string, taskId: string, why: string): string[] | null {
  const tf = loadTasks(p, id);
  return noteBlocked(p, tf, indexOf(tf, taskId), why);
}

// ---------------------------------------------------------------- review

export interface ReviewResult {
  task: string;
  verdict: "pass" | "fix";
  status: string;
  commit: string | null;
  warning?: string;
  /** wave task whose merge conflicted: status `conflict` (the integration Role resolves it) or, when that failed, dropped and pending */
  conflict?: string;
}

/**
 * Today's fallback for a wave task whose merge cannot be made (blueprint 9.2): drop its branch and rerun it sequentially
 * on the latest code. Closes its conflict record as dropped, with the reason, for the Technical Planner.
 */
function dropToSequential(p: Paths, tf: TaskFile, i: number, why: string): void {
  const t = tf.tasks[i] as Task;
  removeWorktree(p, typeof t.worktree === "string" ? t.worktree : undefined, typeof t.branch === "string" ? t.branch : undefined);
  for (const f of ["worktree", "branch", "base", "started_at", "conflict", "start_dirty"]) setField(tf, i, f, null);
  setField(tf, i, "status", "pending");
  setField(tf, i, "attempts", 0);
  setField(tf, i, "sequential", true);
  setField(tf, i, "notes", `${why}; dropped, reruns sequentially on the latest code`.slice(0, 500));
  saveTasks(tf);
  closeConflict(tf.change, t.id, "dropped", why);
}

/** The fallback for src/conflict.ts: the integration Role's resolution failed a check. */
export function dropConflictTask(p: Paths, id: string, taskId: string, why: string): void {
  const tf = loadTasks(p, id);
  dropToSequential(p, tf, indexOf(tf, taskId), why);
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
  // T7: the verdict on a merge the integration Role resolved (src/conflict.ts)
  const mergeReview = statusOf(t) === "conflict" && isRecord(t.conflict) && t.conflict.phase === "review";
  if (statusOf(t) !== "review" && !mergeReview) throw new OpError(`task ${taskId} is "${statusOf(t)}"; only a checkpointed task (review) can be reviewed`);

  const ev = readEvidence(tf.change, t);
  ev.reviews.push({ attempt: attemptsOf(t), at: now(), verdict, notes: notes.trim() });
  writeEvidence(tf.change, ev);

  if (mergeReview) {
    if (verdict === "fix") {
      const why = "the review of the merge the integration Role resolved asked for fixes";
      dropToSequential(p, tf, i, why);
      return { task: taskId, verdict, status: "pending", commit: null, conflict: why };
    }
    // What was checked and reviewed is the merge commit: the worktree must still be exactly that, or nothing is merged.
    const wtDir = taskDir(p, t);
    const head = git(wtDir, ["rev-parse", "HEAD"]).out;
    const dirty = git(wtDir, ["status", "--porcelain", "--", ".", ":(exclude).aidw"]).out;
    const resolution = String((t.conflict as Record<string, unknown>).resolution ?? "");
    if (head !== resolution || dirty) {
      const why = head !== resolution ? "the worktree moved past the reviewed merge commit" : `the worktree has changes after the reviewed merge commit (${dirty.split("\n").map((l) => l.slice(3)).join(", ")})`;
      dropToSequential(p, tf, i, why);
      return { task: taskId, verdict, status: "pending", commit: null, conflict: why };
    }
    setField(tf, i, "conflict", { ...(t.conflict as Record<string, unknown>), phase: "merged" });
  }

  if (verdict === "fix") {
    // Out of attempts it waits for Triage like a failed checkpoint (`aidw next`), never for the user (ADR-0014).
    const exhausted = attemptsOf(t) >= maxAttemptsOf(t);
    setField(tf, i, "status", "failed");
    setField(tf, i, "notes", `review requested fixes (see ${evidenceRel(taskId)})${exhausted ? "; attempts exhausted" : ""}`);
    saveTasks(tf);
    return { task: taskId, verdict, status: "failed", commit: null };
  }

  const msg = taskCommitMessage(t, id, `.aidw/changes/${id}/${evidenceRel(taskId)}`);
  const inWorktree = typeof t.worktree === "string" && t.worktree !== "";
  if (inWorktree) {
    const m = mergeWorktree(p, t, msg);
    if (!m.ok) {
      if (isRecord(t.conflict)) {
        // It conflicts again after the integration Role resolved it: today's fallback.
        dropToSequential(p, tf, i, `merge conflict again after integration resolved it (${m.conflict})`);
        return { task: taskId, verdict, status: "pending", commit: null, conflict: m.conflict };
      }
      // D11: the work is kept and the integration Role resolves the conflict with the task(s) already merged.
      const partners = conflictPartners(p, taskId, typeof t.base === "string" ? t.base : null, m.files);
      setField(tf, i, "status", "conflict");
      setField(tf, i, "conflict", { with: partners, files: m.files, at: now(), phase: "open" });
      setField(tf, i, "notes", `merge conflict${partners.length ? ` with ${partners.join(", ")}` : ""} in ${m.files.join(", ") || m.conflict}: the integration Role resolves it`.slice(0, 500));
      saveTasks(tf);
      recordConflict(tf.change, { task: taskId, with: partners, files: m.files });
      return { task: taskId, verdict, status: "conflict", commit: null, conflict: m.conflict };
    }
    setField(tf, i, "merged_at", now());
    setField(tf, i, "worktree", null);
    setField(tf, i, "branch", null);
    // Written before the commit so it is part of it; reopened below when the commit fails.
    if (mergeReview) closeConflict(tf.change, taskId, "resolved");
  }
  setField(tf, i, "status", "done");
  setField(tf, i, "plan_sha", planSha(t));
  setField(tf, i, "notes", null);
  setField(tf, i, "finished_at", now());
  saveTasks(tf);

  if (opts.commit === false && !inWorktree) return { task: taskId, verdict, status: "done", commit: null };
  if (!isGitRepo(p.project)) return { task: taskId, verdict, status: "done", commit: null, warning: "not a git repository: task not committed" };
  const add = git(p.project, ["add", "-A"]);
  const junk = add.ok ? stagedJunk(p.project) : [];
  const leaked = add.ok && !junk.length ? stagedSecrets(p.project) : [];
  if (junk.length || leaked.length) git(p.project, ["reset", "-q"]);
  const commit = junk.length ? { ok: false, out: "", err: junkMessage(junk) } : leaked.length ? { ok: false, out: "", err: secretsMessage(leaked) } : add.ok ? git(p.project, ["commit", "-q", "-m", msg]) : add;
  if (inWorktree && commit.ok) removeWorktree(p, String(t.worktree), String(t.branch ?? ""));
  if (!commit.ok) {
    // keep the task reviewable so the commit can be retried
    if (inWorktree) {
      git(p.project, ["merge", "--abort"]);
      setField(tf, i, "worktree", t.worktree);
      setField(tf, i, "branch", t.branch);
      setField(tf, i, "merged_at", null);
    }
    setField(tf, i, "status", mergeReview ? "conflict" : "review");
    if (mergeReview) {
      // the merge review is recorded again once the commit can be made
      setField(tf, i, "conflict", t.conflict);
      updateConflict(tf.change, taskId, { outcome: "open" });
    }
    setField(tf, i, "finished_at", null);
    saveTasks(tf);
    throw new OpError(`task ${taskId} passed review but the commit failed: ${commit.err || commit.out}`);
  }
  return { task: taskId, verdict, status: "done", commit: headCommit(p.project) };
}

const RESET_FIELDS = ["worktree", "branch", "base", "started_at", "finished_at", "merged_at", "plan_sha", "evidence", "sequential", "conflict", "upstream", "not_built", "start_dirty"];

function resetTask(tf: TaskFile, i: number, note: string): void {
  for (const f of RESET_FIELDS) setField(tf, i, f, null);
  setField(tf, i, "status", "pending");
  setField(tf, i, "attempts", 0);
  setField(tf, i, "notes", note);
}

/**
 * Re-approval keeps done work (docs/roadmap.md): after the user approves a revised Analysis, a done task whose
 * planned fields still match what it was finished against stays done with its evidence; an edited one runs again.
 */
export function reconcileDoneTasks(p: Paths, id: string): { kept: string[]; reopened: string[] } {
  const tf = loadTasks(p, id);
  const kept: string[] = [];
  const reopened: string[] = [];
  tf.tasks.forEach((t, i) => {
    if (statusOf(t) !== "done" || typeof t.plan_sha !== "string") return;
    if (t.plan_sha === planSha(t)) kept.push(t.id);
    else {
      resetTask(tf, i, "the plan changed at re-approval; runs again");
      reopened.push(t.id);
    }
  });
  if (reopened.length) saveTasks(tf);
  return { kept, reopened };
}

/**
 * A Deviation (src/deviation.ts) changed what these tasks were built against: the done ones go back to pending with a
 * fresh attempt budget and the quality results are dropped; tasks still open simply run on the changed package.
 */
export function rerunTasks(p: Paths, id: string, ids: readonly string[], note: string): string[] {
  const tf = loadTasks(p, id);
  const reset: string[] = [];
  tf.tasks.forEach((t, i) => {
    if (!ids.includes(t.id) || statusOf(t) !== "done") return;
    resetTask(tf, i, note);
    reset.push(t.id);
  });
  if (!reset.length) return reset;
  saveTasks(tf);
  resetQualitySummary(tf.change);
  const state = stateOf(tf.change);
  if (state === "verifying" || state === "converging") transition(p, id, "executing", {});
  return reset;
}

/**
 * User or orchestrator: a done task turned out wrong. It goes back to pending with a fresh attempt budget and the
 * quality results are dropped (they described code that is changing). With `revert` its commit is reverted first.
 */
export function reopenTask(p: Paths, id: string, taskId: string, opts: { revert?: boolean } = {}): { task: string; reverted: string | null; dependents: string[] } {
  const tf0 = loadTasks(p, id);
  const t0 = tf0.tasks[indexOf(tf0, taskId)] as Task;
  if (statusOf(t0) !== "done") throw new OpError(`task ${taskId} is "${statusOf(t0)}"; only done tasks can be reopened`);
  const state = stateOf(tf0.change);
  if (state && ["verifying", "converging", "escalated"].includes(state)) transition(p, id, "executing", {});
  else if (state !== "executing") throw new OpError(`change "${id}" is "${String(state)}"; reopen a task while it is executing, verifying, converging or escalated`);

  let reverted: string | null = null;
  if (opts.revert) {
    if (!isGitRepo(p.project)) throw new OpError("--revert needs a git repository");
    // The task commit carries "Task:" and "Change:" footers; first-parent finds the merge commit of a wave task.
    const r = git(p.project, ["log", "--first-parent", "--format=%H", "-n", "1", "--grep", `^Task: ${taskId}$`, "--grep", `^Change: ${id}$`, "--all-match"]);
    const sha = r.ok ? r.out : "";
    if (!sha) throw new OpError(`no commit found for ${taskId}; reopen without --revert`);
    const isMerge = git(p.project, ["rev-list", "--parents", "-n", "1", sha]).out.split(" ").length > 2;
    const rv = git(p.project, ["revert", "--no-commit", ...(isMerge ? ["-m", "1"] : []), sha]);
    if (!rv.ok) {
      git(p.project, ["revert", "--abort"]);
      throw new OpError(`git revert of ${sha.slice(0, 8)} failed (${(rv.err || rv.out).split("\n")[0]}); resolve by hand, then reopen without --revert`);
    }
    // The task commit also carried .aidw/ state and evidence; the revert must undo the code only.
    git(p.project, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ".aidw"]);
    const msg = `${commitHeader("revert", scopeOf(t0), String(t0.title ?? ""))}\n\nChange: ${id}\nTask: ${taskId}\nReverts: ${sha}`;
    const c = git(p.project, ["commit", "-q", "-m", msg]);
    if (!c.ok) throw new OpError(`could not commit the revert: ${c.err || c.out}`);
    reverted = sha;
  }
  const tf = loadTasks(p, id);
  resetTask(tf, indexOf(tf, taskId), opts.revert ? "reopened by the user; its commit was reverted" : "reopened by the user");
  saveTasks(tf);
  resetQualitySummary(tf.change);
  const dependents = tf.tasks.filter((x) => statusOf(x) === "done" && list(x.depends_on).includes(taskId)).map((x) => x.id);
  return { task: taskId, reverted, dependents };
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
  if (statusOf(t) !== "review" || !changed || changed.length === 0) return null;
  if (t.origin === "quality" && typeof t.layer === "string") {
    // A fix for a layer that has its own reviewer is judged again by that reviewer right after: a per-task reviewer
    // would be a third pair of eyes on a few lines (trial-3A: three of them, 24 turns).
    const text = readText(qualityFile(tf.change));
    const layer = text === null ? undefined : parseQuality(text, "quality.yaml").config?.layers.find((l) => l.name === t.layer);
    if (!layer?.review) return null;
    return recordReview(p, id, taskId, "pass", `auto-reviewed: a fix for the ${layer.name} layer (checkpoint passed); the ${layer.review} reviewer judges the layer again next.`);
  }
  if (t.origin !== "converge") return null;
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
  const r = integrate(p, id, { loadTasks, save: (x) => saveTasks(x as TaskFile), runner: opts.runner ?? shellRunner, quality, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  if (r.notBuilt) {
    // the integration is given up on: a fix task still waiting goes with it
    const after = loadTasks(p, id);
    const cap = agentRunStatus(p, after.change).reached;
    for (const t of after.tasks.filter((x) => x.origin === "integration" && statusOf(x) === "pending")) {
      markNotBuilt(p, loadTasks(p, id), t.id, `the integration of ${r.tasks.join(", ")} is not built: ${r.summary}`, cap ? "cap" : "fix-rounds");
    }
  }
  return r;
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

  // A framework pack names the Skills that load with it (ADR-0005): no framework is named in the selection code.
  const stackNow = detectProject(p.project).stack;
  const pluginHome = resolve(vendorDir, "..", "..");
  const fromPacks =
    kind === "implement"
      ? packsFor(pluginHome, stackNow, implementerOf(pluginHome, typeof t.role === "string" ? t.role : undefined) ?? defaultTaskRole()).flatMap((k) => k.skills.map((id) => ({ id, reason: `the project is built with ${k.framework} (framework pack)` })))
      : packsOf(pluginHome, stackNow).flatMap((k) => k.reviewSkills.map((id) => ({ id, reason: `review of ${k.framework} code (framework pack)` })));
  const picked = selectSkills(t, kind, { retry, reviewFix: kind === "implement" && !!fixReview });
  const skills = [...picked, ...fromPacks.filter((s) => !picked.some((x) => x.id === s.id))]
    .map((s) => ({ ...s, path: skillPath(vendorDir, s.id) }));
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

  // One list (src/briefreads.ts) for the pointers and for whom a Consultation may go to.
  let registry: ReturnType<typeof loadArtifacts> = null;
  try {
    registry = loadArtifacts(pluginHome);
  } catch {
    registry = null; // `aidw roster` reports a broken registry
  }
  const pointers = BRIEF_READS.filter((r) => r.what && (!r.ui || touchesUi(t)))
    .map((r) => {
      const e = registry?.[r.name];
      if (!e || typeof e.path !== "string") return null;
      const file = join(p.aidw, e.path.replace(/<id>/g, id));
      return pointer(p, r.dir ? dirname(file) : file, r.what as string);
    })
    .filter((x): x is string => x !== null);
  const adrs = adrPointers(p);
  // The framework pack of the stack the project uses, for the Roles that build with it (never another side's framework).
  const pluginDir = resolve(vendorDir, "..", "..");
  const packLines =
    kind === "implement"
      ? packsFor(pluginDir, detectProject(p.project).stack, implementerOf(pluginDir, typeof t.role === "string" ? t.role : undefined) ?? defaultTaskRole()).map(
          (k) => `- \`${k.file}\`: how to build with ${k.framework} (framework pack)`,
        )
      : [];

  const touches = list(t.touches);
  const verify = list(t.verify);
  const decisions = decisionsToHonor(readText(join(tf.change.dir, "analysis.md")) ?? "");
  const tokenInfo = buildsScreens(t) ? loadTokens(p) : null;
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
    ...h("Permission envelope (granted at the Approval Gate)", envelopeBrief(tf.change)),
    ...h("Builds on (finished tasks; see `git log`)", done),
    ...h("Touches (files this task may change)", touches.map((g) => `- \`${g}\``)),
    ...h("Verify", verify.map((v) => `- \`${v}\``)),
    ...h("Read first (context pointers; read only what you need)", [...pointers, ...adrs, ...packLines]),
    ...h("Skills (read each SKILL.md and apply it)", [
      ...skills.map((s) => `- \`${s.path}\`: ${s.reason}`),
      ...(skills.some((s) => SKILLS_WITH_NOTES.has(s.id))
        ? [`- Some of these were written for another setup. Read \`${join(vendorDir, "..", "vendored-skill-notes.md")}\` first: it says what differs here and which of their statements are wrong.`]
        : []),
    ]),
  ];

  // ADR-0013: the Agent asks the authors of the contracts it builds against instead of guessing.
  const consultable = kind === "implement" ? taskConsultable(p, id, t, pluginHome) : null;
  const requestPath = taskRequestPath(p, id, taskId);
  const consultRule = consultable
    ? consultable.roles.length
      ? `- **Lacking information** (a hole in a contract, a decision nobody made): ask, never guess; the user is not the first stop. You may ask: ${consultable.roles.join(", ")} (the authors of the contracts this task builds against), at most ${MAX_CONSULTATIONS_PER_RUN} questions in this attempt. Write the request to \`${requestPath}\` with the Write tool (format: \"Ask before you guess\" in your procedure), then end your turn with one line: \`CONSULT ${requestPath}\`. The orchestrator gets the answer, and you or a fresh Agent of your Role continue.`
      : "- **Lacking information**: no author of a contract of this task can be asked. Never guess: build what this brief states and write the gap to your report file."
    : null;
  const answered = kind === "implement" ? taskAnswers(tf.change, taskId) : [];
  const answers = answered.map((c) => `- ${c.id} (${c.to}, ${c.status}): \`${join(tf.change.dir, c.answer)}\`; question in \`${join(tf.change.dir, c.request)}\``);

  let body: string[];
  if (kind === "implement") {
    const previous: string[] = [];
    if (failedCheckpoint) {
      if (failedCheckpoint.missing_scenarios.length) previous.push(`- Missing scenario tests: ${failedCheckpoint.missing_scenarios.map((s) => `\`${s}\``).join(", ")}`);
      const failed = failedCheckpoint.verify.find((v) => v.exit !== 0);
      if (failed) previous.push(`- \`${failed.command}\` failed${failed.timedOut ? " (timed out)" : ` with exit ${failed.exit}`}:`, "", "```", failed.tail, "```");
      if (failedCheckpoint.regression?.status === "not-red") previous.push(`- Regression proof failed: ${failedCheckpoint.regression.reason}. Write a test that fails on the old code (it is run against the base commit), then fix.`);
      for (const problem of tamperProblems(failedCheckpoint.tamper ?? null)) {
        previous.push(`- ${problem[0]?.toUpperCase()}${problem.slice(1)}. Put the test back and make it pass, or fix the code instead of switching the check off. A check may stay off only with the reason written on the same line; if the spec really removed the behavior a test covered, stop and report it.`);
      }
      if (failedCheckpoint.config?.locked.length) {
        previous.push(`- You changed the configuration of the checks: ${failedCheckpoint.config.locked.map((f) => `\`${f}\``).join(", ")}. Put each file back as it was at the base commit (\`git checkout ${base ?? "<base>"} -- <file>\`) and fix the code instead. If the task cannot be done without that change, stop and report it: only a task planned as \`build\`, \`ci\` or \`chore\` changes these files.`);
      }
      if (failedCheckpoint.secrets?.length) previous.push(`- ${secretsProblem(failedCheckpoint.secrets)}. Read it from an environment variable, put only the name in \`.env.example\`, and say in your report that the key must be revoked if it was real.`);
      for (const problem of packageProblems(failedCheckpoint.packages ?? null)) previous.push(`- ${problem}. Use an older released version without advisories, or another package; if none exists, stop and report it.`);
      if (failedCheckpoint.design?.missing_tokens.length) previous.push(`- Design tokens not found in the code: ${failedCheckpoint.design.missing_tokens.map((x) => `\`${x}\``).join(", ")}`);
      if (failedCheckpoint.design && failedCheckpoint.design.screenshots.length === 0) previous.push(`- No fresh screenshot in \`${shots}\``);
    }
    if (fixReview) previous.push("- The reviewer asked for fixes:", "", fixReview.notes.split("\n").map((l) => `  ${l}`).join("\n"));
    const triaged = readTriage(p, taskId);
    if (triaged && isRecord(t.triage) && t.triage.cause === "implementation") {
      previous.push("- The attempts ran out and an independent architect diagnosed the cause as the implementation. Its diagnosis (follow it; this is your last attempt):", "", triaged.diagnosis.split("\n").map((l) => `  ${l}`).join("\n"));
    }
    const up = upstreamOf(t);
    if (up?.phase === "fixed" && t.triage === undefined) {
      previous.push(`- The attempts ran out and Triage found the cause in the ${up.cause}; the ${up.role} changed it (upstream round ${up.round} of ${MAX_UPSTREAM_ROUNDS}). Read this task again in the plan and the specs: what it asks may have changed.`);
    }
    body = [
      "You are the implementer of exactly this task, in a fresh context. Work from this brief and the files it points to.",
      "",
      "## Rules",
      "",
      "- Change only files matching **Touches**. If the task truly needs more, keep it minimal and say so in your report; never widen scope silently.",
      "- Do not edit anything under `.aidw/` (except the files this brief names: the report note, screenshots, a Consultation request), do not run `aidw checkpoint`/`aidw review`, and do not commit, push or deploy: the orchestrator records progress and commits after an independent review.",
      "- Test first. For every scenario, write a test whose name contains the scenario id verbatim, e.g. `test(\"booking/cancel-appointment/cancel-upcoming: cancels and frees the slot\")`, asserting the THEN outcome. `aidw checkpoint` looks for these ids in test files.",
      "- Run every **Verify** command yourself and make it pass before reporting.",
      "- Do not change lint, type-check, CI or git-hook configuration that already exists, and never put a key, token or password in a file: both fail the checkpoint.",
      "- Add a package only when the task needs it, in a released version that is not brand new. The checkpoint looks every added package up: one that does not exist, is days old or has a known advisory fails.",
      "- Never make a check pass by weakening it: do not delete or skip a test, leave `.only`, or add `eslint-disable`, `@ts-ignore`, `as any`, `# noqa` and the like. The checkpoint reads your diff for these and fails. If one is truly needed, write the reason on the same line; the reviewer judges it.",
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
      ...(t.type === "fix"
        ? ["- **Bugfix**: first write a regression test that reproduces the bug and run it to watch it FAIL on the current code; only then fix it. The test name keeps the scenario id. The checkpoint proves it: your new test files are run against the base commit, and a test that passes there fails the checkpoint."]
        : []),
      ...(consultRule ? [consultRule] : []),
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
      ...h("Consultations of this task (answered; read each answer before you continue)", answers),
      ...shared,
    ];
  } else {
    const diff = base
      ? `${inWorktree ? `in the worktree \`${taskRoot}\`: ` : ""}\`git diff ${base}\` plus untracked files (\`git status --porcelain\`)`
      : "the files matching Touches (no base commit was recorded)";
    const outside = lastCheckpoint?.outside_touches ?? [];
    const design = lastCheckpoint?.design;
    // Plan R2: the reviewer judges the task against the rules of the Role that built it (and of the Roles it follows,
    // `follows_rules` in role.md: fullstack follows backend's), and names the rule a finding breaks.
    const builder = implementerOf(pluginHome, typeof t.role === "string" ? t.role : undefined) ?? defaultTaskRole();
    const ruleFiles = [builder, ...(loadRole(pluginHome, builder)?.follows_rules ?? [])]
      .map((r) => ({ role: r, file: join(pluginHome, "roles", r, "rules.md") }))
      .filter((x) => existsSync(x.file))
      .map((x) => ({ ...x, table: loadRuleTable(pluginHome, x.role) }));
    const exampleId = ruleFiles.find((x) => x.table?.length)?.table?.[0]?.id;
    const rulesSection = ruleFiles.length
      ? h(`Rules of the Role that built it (${builder})`, [
          ...ruleFiles.map((x) =>
            x.table
              ? `- \`${x.file}\`: rules of ${x.role}, one per row with an id.`
              : `- \`${x.file}\`: rules of ${x.role}.`,
          ),
          "",
          "The implementer had to follow these. Judge the diff against every rule whose \"applies when\" fits this task. A rule checked only by the CLI is already proven by the checkpoint; when reviewer is also listed, judge it. For a rule checked by a script, read its output in the implementer notes, if any.",
          "A rule whose right action is to ask (a hole in a contract, a missing constraint) is kept when the implementer asked instead of guessing.",
          exampleId ? `A broken rule is a blocking issue: cite its id (for example \`${exampleId}\`) in the finding.` : "A broken rule is a blocking issue.",
        ])
      : [];
    body = [
      "You are an independent reviewer in a fresh context. You did not write this code. You may read files and run read-only commands (tests included); you cannot edit anything.",
      "",
      ...workdir,
      "## What to review",
      "",
      `- The task's changes: ${diff}.`,
      `- Checkpoint evidence: \`${rel(p, join(tf.change.dir, evidenceRel(taskId)))}\` (verify output, where each scenario test lives).`,
      ...(lastCheckpoint?.regression
        ? [
            lastCheckpoint.regression.status === "red"
              ? `- Regression proof (done by aidw): the new tests (${lastCheckpoint.regression.files.map((f) => `\`${f}\``).join(", ")}) FAIL on the base commit (\`${lastCheckpoint.regression.command}\`, exit ${lastCheckpoint.regression.exit}) and pass now. Judge whether they fail for the bug's reason, not for a missing import.`
              : `- Regression proof NOT done by aidw: ${lastCheckpoint.regression.reason}. Check by hand that the new test fails on the old code (\`git stash\` is not allowed to you: read the diff and reason about it), and say what you could not verify.`,
          ]
        : []),
      ...(existsSync(reportFile) ? [`- Implementer notes: \`${rel(p, reportFile)}\` (read it first; it explains files outside Touches and anything the implementer flagged).`] : []),
      ...(outside.length ? [`- Files changed outside Touches: ${outside.map((f) => `\`${f}\``).join(", ")}. Decide whether each is justified.`] : []),
      ...(lastCheckpoint?.tamper?.justified.length
        ? [`- Checks the task switched off, each with a stated reason: ${lastCheckpoint.tamper.justified.map((f) => `\`${f.file}:${f.line}\``).join(", ")}. Read each reason: if fixing the code was possible, the verdict is \`fix\`.`]
        : []),
      ...(lastCheckpoint?.tamper?.snapshots?.length
        ? [`- Stored snapshots this task rewrote or removed: ${lastCheckpoint.tamper.snapshots.map((f) => `\`${f}\``).join(", ")}. Read the diff of each: a snapshot updated to match wrong output is a \`fix\`.`]
        : []),
      ...(lastCheckpoint?.config?.watched.length
        ? [`- Configuration of the checks changed by this task: ${lastCheckpoint.config.watched.map((f) => `\`${f}\``).join(", ")}. Read the diff of each: a lowered threshold, a removed rule or a narrower include is a \`fix\`.`]
        : []),
      ...(lastCheckpoint?.packages?.checked.length ? [`- Packages added (each exists, is old enough and has no known advisory): ${lastCheckpoint.packages.checked.map((x) => `\`${x}\``).join(", ")}. Judge whether each is needed.`] : []),
      ...(lastCheckpoint?.packages?.unproven.length ? [`- Packages aidw could NOT check: ${lastCheckpoint.packages.unproven.join("; ")}. Check that each is a real, established package.`] : []),
      ...(design?.screenshots.length ? [`- Screenshots (open each with Read): ${design.screenshots.map((f) => `\`${join(p.project, f)}\``).join(", ")}`] : []),
      ...(design?.hardcoded_colors.length ? [`- Color literals that are not tokens, in changed files: ${design.hardcoded_colors.map((f) => `\`${f}\``).join(", ")}. Each needs a reason or becomes a token.`] : []),
      "",
      ...rulesSection,
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
      "7. Tests are independent: each one sets up its own data and passes alone and in any order. A test that only passes after another test ran (shared in-memory state, a list the previous test filled) is a blocking issue: it breaks when the tests are reordered or run in parallel.",
      ...(touchesUi(t) ? ["8. Accessibility beyond what axe finds (axe misses names that are wrong rather than missing, keyboard traps and focus order): controls have readable accessible names, a keyboard user can reach and operate them, dialogs and menus move and return focus, and state is not shown by color alone."] : []),
      "",
      "## Verdict",
      "",
      "Your verdict starts with exactly one line: `VERDICT: pass` or `VERDICT: fix`.",
      "For `fix`, follow with numbered blocking issues: file, problem, expected fix. Only blocking issues justify `fix`;",
      "put anything else under `Non-blocking:`. Be concrete: the implementer will get your notes verbatim.",
      ...(exampleId ? [`When a finding breaks one of those rules, name the rule id first, e.g. \`1. ${exampleId}: <file>: <problem>; <expected fix>\`.`] : []),
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

// ---------------------------------------------------------------- triage

/**
 * Why a task ran out of attempts (docs/factory-architecture.md, section 7). One independent Agent (the Software Architect
 * with its triage skill) reads the evidence and names the cause; the CLI decides what follows, and after the Approval
 * Gate nothing waits for the user (ADR-0014, plan D9):
 *   implementation  one further attempt, with the diagnosis in the brief; if that fails too the task is not built
 *   environment     not built at once (a key, the network: nothing inside the factory fixes it); the reason names the fix
 *   plan, spec, architecture  an upstream round: the Role that wrote that Artifact fixes it (through a Deviation, T9) and
 *                   the task runs again, at most MAX_UPSTREAM_ROUNDS times; then the task is not built
 * A task marked not built takes every task that depends on it along; independent tasks carry on.
 */
export const TRIAGE_CAUSES = ["implementation", "environment", "plan", "spec", "architecture"] as const;
export type TriageCause = (typeof TRIAGE_CAUSES)[number];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const triageFile = (p: Paths, taskId: string) => join(p.run, `triage-${taskId}.md`);

/**
 * `CAUSE: <cause>` on the first line, then the diagnosis. Null when the first line is not one. A line `FILES: a, b` in
 * the diagnosis names the approved files at fault (an architecture or contract cause): their owner fixes them.
 */
export function parseTriage(text: string): { cause: TriageCause; diagnosis: string; files?: string[] } | null {
  const m = /^\s*CAUSE:\s*([a-z]+)\s*\n?([\s\S]*)$/.exec(text);
  if (!m || !(TRIAGE_CAUSES as readonly string[]).includes(m[1] as string)) return null;
  const diagnosis = (m[2] ?? "").trim();
  const f = /^FILES:\s*(.+)$/m.exec(diagnosis);
  return { cause: m[1] as TriageCause, diagnosis, ...(f ? { files: (f[1] as string).split(",").map((x) => x.trim()).filter(Boolean) } : {}) };
}

function readTriage(p: Paths, taskId: string): { cause: TriageCause; diagnosis: string } | null {
  const text = readText(triageFile(p, taskId));
  return text === null ? null : parseTriage(text);
}

/** The context packet of the triage Agent: the evidence of every attempt, the spec it was held to, and how to answer. */
export function buildTriageBrief(p: Paths, id: string, taskId: string): { path: string; text: string } {
  const tf = loadTasks(p, id);
  const t = tf.tasks[indexOf(tf, taskId)] as Task;
  if (t.triage !== undefined) throw new OpError(`task ${taskId} was already triaged: one triage per failure`);
  if (statusOf(t) !== "failed" || attemptsOf(t) < maxAttemptsOf(t)) throw new OpError(`task ${taskId} is "${statusOf(t)}" with ${attemptsOf(t)} of ${maxAttemptsOf(t)} attempts: triage is for a failed task that ran out of attempts`);
  rmSync(triageFile(p, taskId), { force: true }); // task ids repeat across changes: an old diagnosis must not be read as this one
  const ev = readEvidence(tf.change, t);
  const reqs = requirementsAfterChange(p, id);
  const scenarioIds = list(t.scenarios);
  const reqIds = [...new Set([...list(t.specs), ...scenarioIds.map((s) => s.split("/").slice(0, -1).join("/"))])];
  const reqBlocks = reqIds.map((r) => (reqs.get(r) ? `<!-- ${r} -->\n${reqs.get(r)!.raw.trim()}` : `<!-- ${r}: not found in specs after this change -->`));
  const attempts = ev.checkpoints.map((c, i) => {
    const failed = c.verify.find((v) => v.exit !== 0);
    return [
      `### Checkpoint ${i + 1}: ${c.ok ? "passed" : "failed"}`,
      ...(c.missing_scenarios.length ? [`- Missing scenario tests: ${c.missing_scenarios.map((s) => `\`${s}\``).join(", ")}`] : []),
      ...(failed ? [`- \`${failed.command}\` failed${failed.timedOut ? " (timed out)" : ` with exit ${failed.exit}`}:`, "", "```", failed.tail, "```"] : []),
    ].join("\n");
  });
  const reviews = ev.reviews.map((r, i) => `### Review ${i + 1}: ${r.verdict}\n${r.notes.trim()}`);
  const out = triageFile(p, taskId);
  const pointers = [
    pointer(p, p.constitution, "engineering principles"),
    pointer(p, join(p.architecture, "overview.md"), "architecture"),
    pointer(p, join(p.requirements, `${id}.md`), "requirements"),
    pointer(p, join(tf.change.dir, "tasks.yaml"), "the plan (this task and its neighbours)"),
  ].filter((x): x is string => x !== null);
  const text = [
    `# Triage brief: ${taskId} - ${String(t.title ?? "")}`,
    "",
    `Change \`${id}\` · role ${String(t.role ?? "?")} · ${attemptsOf(t)} of ${maxAttemptsOf(t)} attempts used, all unsuccessful.`,
    "",
    "You are the Software Architect in a fresh context, asked once to say WHY this task keeps failing. You did not write this code. You may read files and run read-only commands; you edit nothing. Write only the file named at the end.",
    "",
    "## Task",
    "",
    `- Scenarios: ${scenarioIds.length ? scenarioIds.map((s) => `\`${s}\``).join(", ") : "(none)"}`,
    `- Touches: ${list(t.touches).map((g) => `\`${g}\``).join(", ")}`,
    `- Verify: ${list(t.verify).map((v) => `\`${v}\``).join(", ")}`,
    `- Depends on: ${list(t.depends_on).join(", ") || "nothing"}`,
    ...(t.notes ? [`- Last note: ${String(t.notes)}`] : []),
    "",
    "## Requirements the task was held to (spec text after this change)",
    "",
    ...(reqBlocks.length ? ["```markdown", reqBlocks.join("\n\n"), "```"] : ["(none)"]),
    "",
    "## What happened",
    "",
    ...(attempts.length ? attempts : ["(no checkpoint recorded)"]),
    ...(reviews.length ? ["", ...reviews] : []),
    "",
    "## Read if you need it",
    "",
    ...pointers,
    `- the task's changes: \`git diff ${typeof t.base === "string" ? t.base : "HEAD"}\``,
    "",
    "## Decide the cause: exactly one",
    "",
    "- `implementation`: the plan, spec and architecture are sound and the code is wrong or incomplete. A fresh attempt with your diagnosis can fix it.",
    "- `environment`: the machine, not the code: a missing binary, package registry, credential, port, browser, permission or network. Say the exact thing the user must fix.",
    "- `plan`: the task cannot succeed as planned (wrong `touches`, missing dependency, scope too big or too small, `verify` that cannot pass).",
    "- `spec`: a scenario contradicts another, cannot be observed or tested, or asks for something the requirement text does not support.",
    "- `architecture`: the approved architecture or a Decision to honor cannot be met together with the requirements.",
    "",
    "Judge from the evidence above, not from the number of failures. Prefer `implementation` only when you can say concretely what to change.",
    "",
    "## Answer",
    "",
    `**Write the answer to \`${out}\` with the Write tool** (the only file you may write): the first line is exactly \`CAUSE: <one of implementation, environment, plan, spec, architecture>\`, then the diagnosis: the evidence that shows it (file, command, error), and what must change. For \`implementation\` say what to do differently; for \`environment\` the exact fix for the user; for \`plan\`, \`spec\` or \`architecture\` what the Role that wrote it must change. Reply with only the first line.`,
    "",
  ].join("\n");
  const dir = join(p.run, "briefs", id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${taskId}.triage.md`);
  writeFileSync(path, text);
  return { path, text };
}

export interface TriageResult {
  task: string;
  cause: TriageCause;
  /** retry: one further attempt; upstream: the author Role fixes its Artifact, then the task reruns; not_built: it stops here */
  outcome: "retry" | "upstream" | "not_built";
  diagnosis: string;
  /** upstream: the author Role and the round (1..MAX_UPSTREAM_ROUNDS) */
  role?: string;
  round?: number;
  /** not_built: the task and its dependants */
  not_built?: string[];
  /** `--unclear`: the triage Agent gave no clear cause twice */
  unclear?: boolean;
}

/** Records the triage Agent's answer and applies the rule of its cause (ADR-0014). One triage per failure. */
export function recordTriage(p: Paths, id: string, taskId: string, text: string, opts: { pluginHome?: string; unclear?: boolean } = {}): TriageResult {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  if (t.triage !== undefined) throw new OpError(`task ${taskId} was already triaged: one triage per failure`);
  if (statusOf(t) !== "failed" || attemptsOf(t) < maxAttemptsOf(t)) throw new OpError(`task ${taskId} is "${statusOf(t)}" with ${attemptsOf(t)} of ${maxAttemptsOf(t)} attempts: triage is for a failed task that ran out of attempts`);
  if (opts.unclear) {
    // the triage Agent gave no clear cause twice: nobody else guesses one (ADR-0014)
    setField(tf, i, "triage", { cause: "unclear", at: now() });
    saveTasks(tf);
    const marked = markNotBuilt(p, tf, taskId, `triage gave no clear cause; the task's last note: ${String(t.notes ?? "")}`, "triage");
    return { task: taskId, cause: "environment", outcome: "not_built", diagnosis: "no clear cause", not_built: marked, unclear: true };
  }
  const parsed = parseTriage(text);
  if (!parsed) throw new OpError(`the triage answer must start with "CAUSE: ${TRIAGE_CAUSES.join("|")}"; spawn the triage Agent once more, and if it is still unclear run \`aidw triage ${taskId} --unclear\``);
  const { cause, diagnosis } = parsed;
  const gist = diagnosis.split("\n").find((l) => l.trim()) ?? "";
  const full = `(full diagnosis: .aidw/run/triage-${taskId}.md)`;
  setField(tf, i, "triage", { cause, at: now() });
  if (cause === "implementation") {
    setField(tf, i, "notes", `triage: implementation, one more attempt: ${gist}`.slice(0, 500));
    saveTasks(tf);
    return { task: taskId, cause, outcome: "retry", diagnosis };
  }
  if (cause === "environment") {
    saveTasks(tf);
    const marked = markNotBuilt(p, tf, taskId, `triage: environment. ${gist} ${full}`, "environment");
    return { task: taskId, cause, outcome: "not_built", diagnosis, not_built: marked };
  }
  const done = upstreamOf(t)?.round ?? 0;
  // the files Triage named decide the author (artifacts.yaml: api-designer for the API contract, database-architect for
  // the data model...); without any, the Artifact of the cause and its owner
  const named = triageFiles(p, parsed.files ?? []);
  const fromAidw = (f: string) => relative(p.aidw, join(p.project, f)).split(sep).join("/");
  const owner = named.length && opts.pluginHome ? authorsOf(opts.pluginHome, id, fromAidw(named[0] as string))[0] : undefined;
  const role = owner ?? authorOf(cause, opts.pluginHome);
  const files = owner && opts.pluginHome ? named.filter((f) => authorsOf(opts.pluginHome as string, id, fromAidw(f)).includes(owner)) : undefined;
  if (done >= MAX_UPSTREAM_ROUNDS) {
    saveTasks(tf);
    const marked = markNotBuilt(p, tf, taskId, `triage: ${cause} after ${MAX_UPSTREAM_ROUNDS} upstream rounds by ${role}. ${gist} ${full}`, "triage");
    return { task: taskId, cause, outcome: "not_built", diagnosis, role, not_built: marked };
  }
  const round = done + 1;
  setField(tf, i, "upstream", { cause, role, round, phase: "open", at: now(), ...(files?.length ? { files } : {}) });
  setField(tf, i, "notes", `triage: ${cause}, upstream round ${round} of ${MAX_UPSTREAM_ROUNDS}: ${role} fixes its Artifact. ${gist} ${full}`.slice(0, 500));
  saveTasks(tf);
  return { task: taskId, cause, outcome: "upstream", diagnosis, role, round };
}

export interface UpstreamBrief {
  path: string;
  text: string;
  role: string;
  cause: UpstreamCause;
  round: number;
  files: string[];
  /** the Deviation this round opened for the author (T9): its brief carries the rules and what the CLI checks */
  deviation: string;
  deviationBrief: string;
}

/**
 * The author Role's one brief for an upstream round: it opens the round's Deviation (T9) for the files at fault, with a
 * reason that points at the diagnosis and at this brief, and writes the brief: the diagnosis, the files, the Deviation
 * brief to read, how to answer. Printing it again reuses the open Deviation.
 */
export function buildUpstreamBrief(p: Paths, id: string, taskId: string, opts: { pluginHome?: string } = {}): UpstreamBrief {
  const tf = loadTasks(p, id);
  const i = indexOf(tf, taskId);
  const t = tf.tasks[i] as Task;
  const u = upstreamOf(t);
  if (statusOf(t) !== "failed" || u?.phase !== "open") throw new OpError(`task ${taskId} has no open upstream round: an upstream brief follows a Triage whose cause is plan, spec or architecture`);
  const path = join(p.run, "briefs", id, `${taskId}.upstream.md`);
  const triage = `.aidw/run/triage-${taskId}.md`;
  const diagnosis = readText(triageFile(p, taskId))?.trim() ?? `(the diagnosis file is gone; the task's note: ${String(t.notes ?? "")})`;
  const gist = diagnosis.split("\n").find((l) => l.trim() && !l.startsWith("FILES:")) ?? "";
  let did = u.deviation;
  let files: string[];
  let deviationBrief: string;
  const mine = did ? loadDeviations(tf.change).find((d) => d.id === did) : undefined;
  if (mine && mine.status === "open") {
    files = mine.files;
    deviationBrief = join(p.run, "briefs", id, `${mine.id}.deviation.md`);
  } else {
    files = u.files?.length ? u.files : upstreamFiles(p, id, t, u.cause, opts.pluginHome);
    const reason = `Triage of task ${taskId} found the cause in the ${u.cause} (upstream round ${u.round} of ${MAX_UPSTREAM_ROUNDS}): ${gist} The full diagnosis is ${triage}; the ${u.role}'s brief is ${rel(p, path)}.`;
    const opened = openDeviationFor(p, id, { role: u.role, files, reason: reason.slice(0, 1000), task: taskId, pluginRoot: opts.pluginHome ?? "" });
    did = opened.deviation.id;
    files = opened.deviation.files;
    deviationBrief = opened.brief;
    const fresh = loadTasks(p, id);
    const j = indexOf(fresh, taskId);
    setField(fresh, j, "upstream", { ...((fresh.tasks[j] as Task).upstream as Record<string, unknown>), deviation: did });
    saveTasks(fresh);
  }
  const text = [
    `# Upstream brief: ${taskId} - ${String(t.title ?? "")}`,
    "",
    `Change \`${id}\` · Triage cause **${u.cause}** · round ${u.round} of ${MAX_UPSTREAM_ROUNDS} · you are the ${u.role}, the Role that wrote it.`,
    "",
    `Task ${taskId} ran out of attempts, and an independent Triage found that the cause is in the ${u.cause}, not in the code. The Approval Gate is behind: nobody asks the user now (ADR-0014). You decide the fix, the task then runs again. After ${MAX_UPSTREAM_ROUNDS} rounds it is not built, together with the tasks that depend on it.`,
    "",
    "## Rules for the change",
    "",
    "1. Keep the purpose of the requirement: what the user approved this for must still hold.",
    "2. Make the smallest change that lets the task succeed.",
    "3. Add no new scope: no behaviour, screen or endpoint that no approved scenario asks for.",
    "",
    "## The diagnosis",
    "",
    "```markdown",
    diagnosis,
    "```",
    "",
    "## Your files",
    "",
    ...files.map((f) => `- \`${f}\``),
    "",
    `Deviation ${did} is open for exactly these files: the gate lets you change them and nothing else. Read its brief \`${deviationBrief}\` too: it says what the CLI checks when the lead closes it. If the fix needs another file, do not write it: say so in your reply.`,
    "",
    "## The task",
    "",
    `- Scenarios: ${list(t.scenarios).map((s) => `\`${s}\``).join(", ") || "(none)"}`,
    `- Touches: ${list(t.touches).map((g) => `\`${g}\``).join(", ")}`,
    `- Verify: ${list(t.verify).map((v) => `\`${v}\``).join(", ")}`,
    `- Depends on: ${list(t.depends_on).join(", ") || "nothing"}`,
    "",
    "## Answer",
    "",
    "Reply with one line: `FIXED: <files you changed>: <what changed>`, or `CANNOT FIX: <why>` when no change within the three rules lets the task succeed (the task is then not built, and the pull request says why).",
    "",
  ].join("\n");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return { path, text, role: u.role, cause: u.cause, round: u.round, files, deviation: did as string, deviationBrief };
}

export interface UpstreamResult {
  task: string;
  cause: UpstreamCause;
  role: string;
  round: number;
  outcome: "rerun" | "not_built";
  not_built?: string[];
}

/**
 * Closes the author's round. After `aidw deviation close` recorded the change, the task runs again with a fresh attempt
 * budget; with `cannot` (the author found no change within the rules) the round's Deviation is abandoned if it is still
 * open and the task is not built.
 */
export function recordUpstream(p: Paths, id: string, taskId: string, opts: { cannot?: string } = {}): UpstreamResult {
  let tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const t = tf.tasks[indexOf(tf, taskId)] as Task;
  const u = upstreamOf(t);
  // closing the Deviation (T9) may already have reset the task for its rerun: pending is accepted too
  if (!["failed", "pending"].includes(statusOf(t)) || u?.phase !== "open") throw new OpError(`task ${taskId} has no open upstream round`);
  const base = { task: taskId, cause: u.cause, role: u.role, round: u.round };
  const devs = loadDeviations(tf.change);
  const mine = u.deviation ? devs.find((d) => d.id === u.deviation) : undefined;
  if (opts.cannot !== undefined) {
    if (mine?.status === "open") {
      abandonDeviation(p, id);
      tf = loadTasks(p, id);
    }
    const why = opts.cannot.trim() || "no reason given";
    return { ...base, outcome: "not_built", not_built: markNotBuilt(p, tf, taskId, `triage: ${u.cause}; the ${u.role} could not fix it: ${why}`, "triage") };
  }
  const openForTask = devs.find((d) => d.status === "open" && d.task === taskId);
  if (openForTask) throw new OpError(`Deviation ${openForTask.id} for ${taskId} is still open: \`aidw deviation close\` first (or \`aidw upstream ${taskId} --cannot "<why>"\` when the author cannot fix it)`);
  if (!mine) throw new OpError(`the upstream round of ${taskId} has no Deviation yet: \`aidw brief ${taskId} --for upstream\` opens it and briefs the ${u.role}`);
  if (mine.status !== "closed") throw new OpError(`Deviation ${mine.id} of this round was ${mine.status}: nothing was recorded, so ${taskId} does not rerun; \`aidw upstream ${taskId} --cannot "<why>"\``);
  const i = indexOf(tf, taskId);
  const cur = tf.tasks[i] as Task;
  setField(tf, i, "upstream", { ...(cur.upstream as Record<string, unknown>), phase: "fixed", fixed_at: now() });
  setField(tf, i, "triage", null);
  if (statusOf(cur) === "failed") setField(tf, i, "attempts", 0);
  setField(tf, i, "notes", `the ${u.role} fixed the ${u.cause} after Triage (upstream round ${u.round} of ${MAX_UPSTREAM_ROUNDS}, Deviation ${mine.id}); the task runs again on the changed Artifact`);
  saveTasks(tf);
  return { ...base, outcome: "rerun" };
}
