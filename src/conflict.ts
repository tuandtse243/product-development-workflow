/**
 * A Wave's merge conflict goes to the integration Role (T7, decision D11). The CLI owns the flow (ADR-0003):
 *
 *   review pass   the task's merge into the change branch conflicts (src/run.ts recordReview): its work is kept,
 *                 status `conflict` (phase open), the conflict recorded in `changes/<id>/conflicts.yaml`
 *   brief         `aidw brief T --for conflict` starts the merge of the change branch into the task's worktree and
 *                 briefs the integration Role with both tasks, the conflicting files and both branches
 *   resolve       `aidw resolve T` checks the resolution (no markers, nothing staged that must not be), commits the
 *                 merge in the worktree, and runs the checks of both tasks again on it (verify + a test per scenario)
 *   review        `aidw brief T --for merge-review` briefs the code-reviewer on the merge; `aidw verdict T` records it:
 *                 pass merges the task into the change branch, which now applies cleanly
 *   fallback      any failure on the way drops the branch and the task reruns sequentially on the latest code
 *
 * The flow is the same in the main session and under the runner: each step is a CLI command that prints the next.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configEvidence } from "./configlock.js";
import { packageEvidence, packageProblems } from "./depsafety.js";
import { git, headCommit, isGeneratedPath, junkMessage, stagedJunk } from "./git.js";
import { OpError } from "./ops.js";
import { conflictPartners, taskDir, updateConflict } from "./parallel.js";
import { rel, type Paths } from "./project.js";
import {
  dropConflictTask,
  ENVIRONMENT_FAILURE,
  evidenceRel,
  findScenarioTests,
  loadTasks,
  requireExecuting,
  retryingShellRunner,
  saveTasksDoc,
  setField,
  TEST_FILE,
  type CommandRunner,
  type TaskFile,
  type VerifyRun,
} from "./run.js";
import { secretsInChanges, secretsMessage, secretsProblem, stagedSecrets } from "./secrets.js";
import { tamperEvidence, tamperProblems } from "./tamper.js";
import type { Task } from "./tasks.js";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const now = () => new Date().toISOString();
/**
 * Conflict markers, the diff3 base marker included. A bare `=======` is a Markdown or RST heading underline unless it
 * stands between a `<<<<<<<` and a `>>>>>>>` line, and then the opening line is found anyway: it is not a marker alone.
 */
const MARKER = /^(?:<{7}|>{7}|\|{7})(?: |$)/m;
const TOOLING_TYPES = new Set(["build", "ci", "chore"]);
const ENV_FILE = /(^|\/)\.env(?:\.(?!example$)[\w.-]+)?$/;

interface OpenConflict {
  tf: TaskFile;
  i: number;
  t: Task;
  c: Record<string, unknown>;
  dir: string;
  partners: Task[];
}

function openConflict(p: Paths, id: string, taskId: string, phase: "open" | "review"): OpenConflict {
  const tf = loadTasks(p, id);
  requireExecuting(p, tf.change);
  const i = tf.tasks.findIndex((x) => x.id === taskId);
  const t = tf.tasks[i];
  if (!t) throw new OpError(`task "${taskId}" not found in ${id}/tasks.yaml`);
  const c = t.conflict && typeof t.conflict === "object" && !Array.isArray(t.conflict) ? (t.conflict as Record<string, unknown>) : null;
  if (t.status !== "conflict" || !c) throw new OpError(`task ${taskId} is "${String(t.status ?? "pending")}"; it has no open merge conflict`);
  if (c.phase !== phase) {
    throw new OpError(
      phase === "open"
        ? `the conflict of ${taskId} is already resolved and waits for the review of the merge: \`aidw brief ${taskId} --for merge-review\``
        : `the conflict of ${taskId} is not resolved yet: \`aidw brief ${taskId} --for conflict\`, then \`aidw resolve ${taskId}\``,
    );
  }
  const dir = taskDir(p, t);
  if (dir === p.project || !existsSync(dir)) throw new OpError(`task ${taskId} has no worktree to resolve the conflict in (${String(t.worktree)})`);
  const partners = list(c.with).map((x) => tf.tasks.find((y) => y.id === x) ?? { id: x });
  return { tf, i, t, c, dir, partners };
}

const mergeInProgress = (dir: string) => git(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;

function taskLines(t: Task): string[] {
  return [
    `### ${t.id}: ${String(t.title ?? "")}`,
    "",
    `- Role: ${String(t.role ?? "?")}`,
    `- Scenarios: ${list(t.scenarios).length ? list(t.scenarios).map((s) => `\`${s}\``).join(", ") : "(none: verified by its verify commands only)"}`,
    `- Touches: ${list(t.touches).map((g) => `\`${g}\``).join(", ") || "(none)"}`,
    `- Verify: ${list(t.verify).map((v) => `\`${v}\``).join(", ") || "(none)"}`,
    "",
  ];
}

function writeBrief(p: Paths, id: string, name: string, text: string): string {
  const dir = join(p.run, "briefs", id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, text.replace(/\n{3,}/g, "\n\n"));
  return path;
}

/**
 * The integration Role's brief. On the first call it merges the change branch into the task's worktree (an Agent may not
 * merge; the gate denies it), leaving the conflict markers for the Agent to resolve. Later calls rebuild the brief only.
 */
export function buildConflictBrief(p: Paths, id: string, taskId: string): { path: string; text: string } {
  let o = openConflict(p, id, taskId, "open");
  const changeBranch = git(p.project, ["branch", "--show-current"]).out || "HEAD";
  let onto = typeof o.c.onto === "string" ? o.c.onto : null;
  if (!onto) {
    // The task's own tip, before the merge: the side the resolution is judged against (HEAD until the merge is committed).
    const tip = git(o.dir, ["rev-parse", "HEAD"]).out;
    if (mergeInProgress(o.dir)) {
      // a restart between starting the merge and recording it: the merge in progress is the one to resolve
      onto = git(o.dir, ["rev-parse", "MERGE_HEAD"]).out;
    } else {
      onto = headCommit(p.project);
      if (!onto) throw new OpError("the Change Branch has no commit to merge");
      const m = git(o.dir, ["merge", "--no-ff", "--no-commit", "-q", onto]);
      if (!m.ok && !mergeInProgress(o.dir)) {
        const why = `the Change Branch could not be merged into the worktree of ${taskId} (${(m.err || m.out).split("\n")[0]})`;
        dropConflictTask(p, id, taskId, why);
        throw new OpError(`${why}; ${taskId} was dropped and reruns sequentially on the latest code`);
      }
    }
    // The Change Branch may have moved since the conflict was found (another task merged): the files and the tasks on
    // the other side are those of this merge.
    const unmerged = git(o.dir, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
    const conflictFiles = unmerged.length ? unmerged : list(o.c.files);
    const partners = conflictPartners(p, taskId, typeof o.t.base === "string" ? o.t.base : null, conflictFiles);
    // A binary file shows no markers: left as it is, one side would silently win.
    const from = onto;
    const binary = conflictFiles.filter((f) => /^-\t-\t/.test(git(o.dir, ["diff", "--numstat", from, "HEAD", "--", f]).out));
    setField(o.tf, o.i, "conflict", { ...o.c, with: partners, files: conflictFiles, onto, tip, branch: changeBranch });
    saveTasksDoc(o.tf);
    updateConflict(o.tf.change, taskId, { with: partners, files: conflictFiles });
    if (binary.length) {
      const why = `binary file in the conflict (${binary.join(", ")}): no marker shows both sides`;
      dropConflictTask(p, id, taskId, why);
      throw new OpError(`${why}; ${taskId} was dropped and reruns sequentially on the latest code`);
    }
    o = openConflict(p, id, taskId, "open");
  }
  const { t, c, dir, partners } = o;
  const files = list(c.files);
  const branch = String(t.branch ?? "");
  const text = [
    `# Conflict brief: ${taskId} - ${String(t.title ?? "")}`,
    "",
    `Change \`${id}\` · a merge conflict between tasks of one Wave`,
    "",
    "You are the integration Role in a fresh context. You did not write either side. Two tasks ran side by side, each in its",
    "own **Task Worktree**; both passed their checks and their reviews, but their work meets in the same files, so the second",
    "merge into the **Change Branch** conflicts. Resolve the conflict so that **both** tasks' behaviour holds. This is not a split-Slice task: follow this brief.",
    "",
    "## The tasks",
    "",
    `- **${taskId}** is the task being merged, built on branch \`${branch}\` in the worktree below.`,
    partners.length
      ? `- ${partners.map((x) => `**${x.id}**`).join(", ")} ${partners.length > 1 ? "are" : "is"} already merged into the Change Branch \`${changeBranch}\` (commit \`${onto.slice(0, 12)}\`).`
      : `- The other side is the Change Branch \`${changeBranch}\` (commit \`${onto.slice(0, 12)}\`): no task commit changed these files.`,
    "",
    ...taskLines(t),
    ...partners.flatMap(taskLines),
    "## Conflicting files",
    "",
    ...files.map((f) => `- \`${f}\``),
    "",
    "## Where",
    "",
    `aidw merged \`${changeBranch}\` (\`${onto.slice(0, 12)}\`) into \`${branch}\` in the Task Worktree \`${dir}\` and stopped at the conflicts. \`cd\` there and work only there; never edit the main checkout \`${p.project}\` nor the worktree's own \`.aidw/\`. \`git diff\` shows the conflicting hunks; \`git log --oneline ${onto.slice(0, 12)} -5\` and \`git log --oneline HEAD -5\` show each side's commits.`,
    "",
    "## Rules",
    "",
    "- Remove every conflict marker. Keep what each task added: combine both sides, do not pick one and drop the other.",
    "- Change only what the conflict needs, in the conflicting files (and a test that must follow them). Do not redesign either task.",
    "- Do not run `git add`, `git commit`, `git merge --abort` or any other git write: aidw commits the merge after its checks.",
    "- Do not delete, skip or weaken a test of either task to get green.",
    "- Run the verify commands of both tasks above in the worktree and make them pass.",
    "",
    "## Done when",
    "",
    `No conflict marker is left, both tasks' verify commands pass in the worktree, and every scenario of both still has its test. aidw then runs both tasks' checks again (\`aidw resolve ${taskId}\`) and an independent reviewer reviews the merge; if any of that fails, ${taskId}'s work is dropped and it is built again on the latest code.`,
    "Reply in at most 5 lines: each file and how the two sides were combined. If the two tasks cannot both hold (they contradict each other), say so and leave the markers: that is a plan problem.",
    "",
  ].join("\n");
  return { path: writeBrief(p, id, `${taskId}.conflict.md`, text), text };
}

export interface MergeCheck {
  task: string;
  missing_scenarios: string[];
  runs: VerifyRun[];
  ok: boolean;
}

export interface GuardCheck {
  /** the commit the resolution is compared with: the task's side or the Change Branch */
  side: string;
  changed: string[];
  problems: string[];
  tamper?: unknown;
  config?: unknown;
  secrets?: unknown;
  packages?: unknown;
}

export interface ResolveResult {
  ok: boolean;
  task: string;
  with: string[];
  files: string[];
  resolution: string | null;
  checks: MergeCheck[];
  /** the checkpoint's guards on the committed resolution, against each side it joins */
  guards?: GuardCheck[];
  /** a check the machine refused: nothing dropped, the conflict stays open and resolve runs again */
  blocked?: boolean;
  /** why the resolution was dropped (or, when blocked, why it could not be judged) */
  reason?: string;
  evidence?: string;
}

/**
 * Checks and commits the integration Role's resolution in the task's worktree, then runs the checks of both tasks again:
 * the checkpoint's guards (markers, junk, tamper, check configuration, secrets, packages) against both sides of the merge,
 * then each task's verify commands and a test per scenario. Pass: the merge waits for its review. A check the machine
 * refused leaves the conflict open. Anything else: dropped.
 */
export function resolveConflict(p: Paths, id: string, taskId: string, opts: { runner?: CommandRunner; timeoutMs?: number } = {}): ResolveResult {
  const o = openConflict(p, id, taskId, "open");
  const { tf, t, c, dir, partners } = o;
  const onto = typeof c.onto === "string" ? c.onto : null;
  if (!onto) throw new OpError(`the merge of ${taskId} was not started: run \`aidw brief ${taskId} --for conflict\` and spawn the integration Role first`);
  const files = list(c.files);
  const withIds = partners.map((x) => x.id);
  const base: ResolveResult = { ok: false, task: taskId, with: withIds, files, resolution: null, checks: [] };
  const evidenceFile = join(tf.change.dir, "evidence", `merge-${taskId}.json`);
  const record = (r: ResolveResult): ResolveResult => {
    mkdirSync(join(tf.change.dir, "evidence"), { recursive: true });
    writeFileSync(evidenceFile, `${JSON.stringify({ at: now(), onto, ...r }, null, 2)}\n`);
    return { ...r, evidence: rel(p, evidenceFile) };
  };
  const fail = (reason: string, r: ResolveResult = base): ResolveResult => {
    const out = record({ ...r, ok: false, reason });
    dropConflictTask(p, id, taskId, `merge conflict not resolved: ${reason}`);
    return out;
  };

  if (mergeInProgress(dir)) {
    const add = git(dir, ["add", "-A", "--", ".", ":(exclude).aidw"]);
    if (!add.ok) return fail(`git add in the worktree failed: ${add.err}`);
    const junk = stagedJunk(dir);
    if (junk.length) return fail(junkMessage(junk));
    const leaked = stagedSecrets(dir);
    if (leaked.length) return fail(secretsMessage(leaked));
    const left = git(dir, ["diff", "--name-only", "--diff-filter=U"]).out;
    if (left) return fail(`files are still unmerged: ${left.split("\n").join(", ")}`);
    const commit = git(dir, ["commit", "-q", "--no-edit"]);
    if (!commit.ok) return fail(`the merge commit failed: ${(commit.err || commit.out).split("\n")[0]}`);
  } else if (!git(dir, ["merge-base", "--is-ancestor", onto, "HEAD"]).ok) {
    return fail("the merge of the Change Branch is no longer in the worktree (was it aborted?)");
  } else {
    // The merge was committed earlier (by the Agent, or by a resolve the machine blocked): what is judged is that commit,
    // so the worktree must hold nothing else.
    const dirty = git(dir, ["status", "--porcelain", "--", ".", ":(exclude).aidw"]).out;
    if (dirty) return fail(`the worktree has changes that are not in the merge commit: ${dirty.split("\n").map((l) => l.slice(3)).join(", ")}`);
  }
  const resolution = headCommit(dir);
  if (!resolution) return fail("the worktree has no commit");

  // The resolution is judged against each side it joins, the way a checkpoint judges a task against its base: the
  // task's own side (first parent) and the Change Branch it was merged with. The Agent may have committed it itself,
  // so everything here reads the committed diff, not what was staged.
  const taskSide = typeof c.tip === "string" && c.tip ? c.tip : git(dir, ["rev-parse", `${resolution}^1`]).out || onto;
  const sides = [...new Set([taskSide, onto])];
  const changedBy = new Map(sides.map((side) => [side, git(dir, ["diff", "--name-only", side, resolution]).out.split("\n").filter(Boolean)]));
  const touched = [...new Set([...changedBy.values()].flat())];
  const marked = touched.filter((f) => {
    const file = join(dir, f);
    if (!existsSync(file)) return false;
    const text = readFileSync(file);
    return !text.includes(0) && MARKER.test(text.toString("utf8"));
  });
  if (marked.length) return fail(`conflict markers are left in ${marked.join(", ")}`);
  const junk = touched.filter((f) => isGeneratedPath(f) || ENV_FILE.test(f));
  if (junk.length) return fail(junkMessage(junk));

  // A locked check-configuration file may differ only where a tooling task (build, ci, chore) changed it itself, or where
  // it is one of the conflicting files; anything else the resolution did to it is refused like in a checkpoint.
  const isTooling = (x: Task) => typeof x.type === "string" && TOOLING_TYPES.has(x.type);
  const ownChanges = isTooling(t) && typeof t.base === "string" ? git(dir, ["diff", "--name-only", t.base, taskSide]).out.split("\n") : [];
  const toolingPartners = new Set(partners.filter(isTooling).map((x) => x.id));
  const exempt = (f: string): boolean => {
    if (files.includes(f) || ownChanges.includes(f)) return true;
    if (!toolingPartners.size) return false;
    const log = git(dir, ["log", "--format=%B", `${taskSide}..${onto}`, "--", f]).out;
    return [...log.matchAll(/^Task: (\S+)$/gm)].some((m) => toolingPartners.has(m[1] as string));
  };
  const guards: GuardCheck[] = sides.map((side) => {
    const changed = changedBy.get(side) ?? [];
    const tamper = tamperEvidence(dir, side, changed, { isTest: (f) => TEST_FILE.test(f), removesTests: false });
    const raw = configEvidence(dir, side, changed, "feat");
    const config = raw ? { locked: raw.locked.filter((f) => !exempt(f)), watched: [...raw.watched, ...raw.locked.filter(exempt)] } : null;
    const secrets = secretsInChanges(dir, side, changed) ?? [];
    const packages = packageEvidence(dir, side, changed);
    const problems = [
      ...tamperProblems(tamper),
      ...(config?.locked.length ? [`check configuration changed: ${config.locked.join(", ")}`] : []),
      ...(secrets.length ? [secretsProblem(secrets)] : []),
      ...packageProblems(packages),
    ];
    return { side, changed, problems, ...(tamper ? { tamper } : {}), ...(config ? { config } : {}), ...(secrets.length ? { secrets } : {}), ...(packages ? { packages } : {}) };
  });
  const guarded: ResolveResult = { ...base, resolution, guards };
  const problem = guards.flatMap((x) => x.problems)[0];
  if (problem) return fail(problem, guarded);

  const runner = opts.runner ?? retryingShellRunner;
  const checks: MergeCheck[] = [t, ...partners].map((x) => {
    const found = findScenarioTests(dir, list(x.scenarios));
    const missing = Object.entries(found).filter(([, where]) => where.length === 0).map(([s]) => s);
    const runs: VerifyRun[] = [];
    for (const command of list(x.verify)) {
      const started = Date.now();
      const r = runner(command, dir, opts.timeoutMs ?? 30 * 60 * 1000);
      runs.push({ command, ms: Date.now() - started, ...r });
      if (r.exit !== 0) break;
    }
    return { task: x.id, missing_scenarios: missing, runs, ok: missing.length === 0 && runs.every((r) => r.exit === 0) };
  });
  // A check the machine refused says nothing about the resolution: the conflict stays open and resolve runs again.
  const refused = checks.flatMap((x) => x.runs).find((r) => r.exit !== 0 && !r.timedOut && ENVIRONMENT_FAILURE.test(r.tail));
  if (refused) {
    const why = `environment: \`${refused.command}\` was refused by the machine (${ENVIRONMENT_FAILURE.exec(refused.tail)?.[0]}), not by the code`;
    return record({ ...guarded, checks, ok: false, blocked: true, reason: why });
  }
  const result: ResolveResult = { ...guarded, checks };
  const bad = checks.find((x) => !x.ok);
  if (bad) {
    const failed = bad.runs.find((r) => r.exit !== 0);
    const why = failed
      ? `${bad.task}: \`${failed.command}\`${failed.timedOut ? " timed out" : ` exited ${failed.exit}`} on the resolved code`
      : `${bad.task}: no test names scenario ${bad.missing_scenarios.join(", ")} on the resolved code`;
    return fail(why, result);
  }
  const configFiles = [...new Set(guards.flatMap((x) => [...((x.config as { locked: string[] } | undefined)?.locked ?? []), ...((x.config as { watched: string[] } | undefined)?.watched ?? [])]))];
  setField(tf, o.i, "conflict", { ...c, phase: "review", resolution, ...(configFiles.length ? { config: configFiles } : {}) });
  setField(tf, o.i, "notes", `merge conflict resolved by integration (${resolution?.slice(0, 8)}); both tasks' checks pass; the merge waits for its review`);
  saveTasksDoc(tf);
  return { ...record({ ...result, ok: true }) };
}

/** The code-reviewer's brief for the merge the integration Role resolved. The verdict goes where a task review's does. */
export function buildMergeReviewBrief(p: Paths, id: string, taskId: string): { path: string; text: string } {
  const { t, c, dir, partners, tf } = openConflict(p, id, taskId, "review");
  const onto = String(c.onto ?? "");
  const resolution = String(c.resolution ?? "HEAD");
  const files = list(c.files);
  const verdictFile = join(p.run, `review-${taskId}.md`);
  rmSync(verdictFile, { force: true }); // the verdict of the task's own review must not be read as this one
  const text = [
    `# Merge review brief: ${taskId} - ${String(t.title ?? "")}`,
    "",
    `Change \`${id}\` · the review of a merge conflict the integration Role resolved`,
    "",
    "You are an independent reviewer in a fresh context. You wrote neither task nor the resolution. You may read files and run read-only commands (tests included); you cannot edit anything.",
    "",
    `Two tasks of one Wave changed the same files. ${taskId} was reviewed and passed on its own; its merge into the change branch conflicted with ${partners.length ? partners.map((x) => x.id).join(", ") : "the change branch"}. The integration Role resolved it, and aidw ran the checks of both tasks again on the result: they pass. Judge only the resolution.`,
    "",
    "## The tasks",
    "",
    ...taskLines(t),
    ...partners.flatMap(taskLines),
    "## What to review",
    "",
    `- Work in the worktree \`${dir}\`; the resolution is the merge commit \`${resolution}\`.`,
    `- \`git show --cc ${resolution}\`: the hunks where the resolution differs from both sides.`,
    `- \`git diff ${onto.slice(0, 12)} ${resolution} -- ${files.join(" ")}\`: the conflicting files against the change branch.`,
    `- Conflicting files: ${files.map((f) => `\`${f}\``).join(", ")}.`,
    ...(list(c.config).length
      ? [`- Configuration of the checks this merge changes against one side: ${list(c.config).map((f) => `\`${f}\``).join(", ")}. Read the diff of each: a lowered threshold, a removed rule or a narrower include that neither task made is a \`fix\`.`]
      : []),
    `- Checks of both tasks on the resolved code: \`${rel(p, join(tf.change.dir, "evidence", `merge-${taskId}.json`))}\`; ${taskId}'s own evidence: \`${rel(p, join(tf.change.dir, evidenceRel(taskId)))}\`.`,
    "",
    "## Checklist",
    "",
    "1. Each conflicting file keeps what **both** tasks added: nothing of either side was dropped or silently rewritten.",
    "2. The resolution changes nothing beyond what the conflict needs.",
    "3. No test of either task was deleted, skipped or weakened, and every scenario of both still has a test that asserts its THEN outcome.",
    "",
    "## Verdict",
    "",
    "Your verdict starts with exactly one line: `VERDICT: pass` or `VERDICT: fix`.",
    "For `fix`, follow with numbered blocking issues: file, problem. A `fix` drops the resolution and the task is built again on the latest code, so use it only for a real loss or breakage.",
    `**Write the whole verdict to \`${verdictFile}\` with the Write tool** (the only file you may write), then reply with just its first line.`,
    "",
  ].join("\n");
  return { path: writeBrief(p, id, `${taskId}.merge-review.md`, text), text };
}
