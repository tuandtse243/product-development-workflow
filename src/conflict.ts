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
import { git, headCommit, junkMessage, stagedJunk } from "./git.js";
import { OpError } from "./ops.js";
import { taskDir } from "./parallel.js";
import { rel, type Paths } from "./project.js";
import { dropConflictTask, evidenceRel, findScenarioTests, loadTasks, requireExecuting, saveTasksDoc, setField, shellRunner, type CommandRunner, type TaskFile, type VerifyRun } from "./run.js";
import { secretsMessage, stagedSecrets } from "./secrets.js";
import type { Task } from "./tasks.js";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const now = () => new Date().toISOString();
const MARKER = /^(?:<{7}|>{7})(?: |$)/m;

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
  const o = openConflict(p, id, taskId, "open");
  const { t, c, dir, partners } = o;
  const changeBranch = git(p.project, ["branch", "--show-current"]).out || "HEAD";
  let onto = typeof c.onto === "string" ? c.onto : null;
  if (!onto) {
    onto = headCommit(p.project);
    if (!onto) throw new OpError("the change branch has no commit to merge");
    const m = git(dir, ["merge", "--no-ff", "--no-commit", "-q", onto]);
    if (!m.ok && !mergeInProgress(dir)) {
      const why = `the change branch could not be merged into the worktree of ${taskId} (${(m.err || m.out).split("\n")[0]})`;
      dropConflictTask(p, id, taskId, why);
      throw new OpError(`${why}; ${taskId} was dropped and reruns sequentially on the latest code`);
    }
    setField(o.tf, o.i, "conflict", { ...c, onto, branch: changeBranch });
    saveTasksDoc(o.tf);
  }
  const files = list(c.files);
  const branch = String(t.branch ?? "");
  const text = [
    `# Conflict brief: ${taskId} - ${String(t.title ?? "")}`,
    "",
    `Change \`${id}\` · a merge conflict between tasks of one Wave`,
    "",
    "You are the integration Role in a fresh context. You did not write either side. Two tasks ran side by side in their own",
    "worktrees; both passed their checks and their reviews, but their work meets in the same files, so the second merge",
    "conflicts. Resolve the conflict so that **both** tasks' behaviour holds. This is not a split-Slice task: follow this brief.",
    "",
    "## The tasks",
    "",
    `- **${taskId}** is the task being merged, built on branch \`${branch}\` in the worktree below.`,
    partners.length
      ? `- ${partners.map((x) => `**${x.id}**`).join(", ")} ${partners.length > 1 ? "are" : "is"} already merged into the change branch \`${changeBranch}\` (commit \`${onto.slice(0, 12)}\`).`
      : `- The other side is the change branch \`${changeBranch}\` (commit \`${onto.slice(0, 12)}\`): no task commit changed these files.`,
    "",
    ...taskLines(t),
    ...partners.flatMap(taskLines),
    "## Conflicting files",
    "",
    ...files.map((f) => `- \`${f}\``),
    "",
    "## Where",
    "",
    `aidw merged \`${changeBranch}\` (\`${onto.slice(0, 12)}\`) into \`${branch}\` in the worktree \`${dir}\` and stopped at the conflicts. \`cd\` there and work only there; never edit the main checkout \`${p.project}\` nor the worktree's own \`.aidw/\`. \`git diff\` shows the conflicting hunks; \`git log --oneline ${onto.slice(0, 12)} -5\` and \`git log --oneline HEAD -5\` show each side's commits.`,
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

export interface ResolveResult {
  ok: boolean;
  task: string;
  with: string[];
  files: string[];
  resolution: string | null;
  checks: MergeCheck[];
  /** why the resolution was dropped */
  reason?: string;
  evidence?: string;
}

/**
 * Checks and commits the integration Role's resolution in the task's worktree, then runs the checks of both tasks again:
 * each one's verify commands and a test per scenario. Pass: the merge waits for its review. Anything else: dropped.
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

  const unmerged = git(dir, ["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
  const marked = [...new Set([...files, ...unmerged])].filter((f) => {
    const file = join(dir, f);
    return existsSync(file) && MARKER.test(readFileSync(file, "utf8"));
  });
  if (marked.length) return fail(`conflict markers are left in ${marked.join(", ")}`);

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
    return fail("the merge of the change branch is no longer in the worktree (was it aborted?)");
  }
  const resolution = headCommit(dir);

  const runner = opts.runner ?? shellRunner;
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
  const result: ResolveResult = { ...base, resolution, checks };
  const bad = checks.find((x) => !x.ok);
  if (bad) {
    const failed = bad.runs.find((r) => r.exit !== 0);
    const why = failed
      ? `${bad.task}: \`${failed.command}\`${failed.timedOut ? " timed out" : ` exited ${failed.exit}`} on the resolved code`
      : `${bad.task}: no test names scenario ${bad.missing_scenarios.join(", ")} on the resolved code`;
    return fail(why, result);
  }
  setField(tf, o.i, "conflict", { ...c, phase: "review", resolution });
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
