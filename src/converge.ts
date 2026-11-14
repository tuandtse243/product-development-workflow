/**
 * `aidw converge` (blueprint step 14, Spec Kit "converge"): every scenario this change adds or
 * modifies must have a passing test on the current code. Gaps become tasks (origin: converge)
 * that go through the normal implement -> checkpoint -> review loop.
 *
 * Evidence, strongest first:
 *   junit     a test case whose name contains the scenario id passed in a layer's JUnit report
 *             (read by `aidw verify` right after the layer ran on the current code)
 *   presence  no reports configured: a test file names the scenario id, the line is not skipped,
 *             and every layer passed on the current code. Weaker; the quality report says so.
 */
import { DEFAULT_TASK_ROLE } from "./roles.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { idsAfterChange } from "./analyze.js";
import { approvalStatus } from "./approval.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { headCommit } from "./git.js";
import { OpError, transition } from "./ops.js";
import { isFresh, loadQuality, pendingLayers, type TestCase } from "./quality.js";
import type { Paths } from "./project.js";
import { loadTasks, saveTasksDoc, SKIPPED_LINE, testFiles } from "./run.js";
import type { Task } from "./tasks.js";

export type ScenarioStatus = "pass" | "fail" | "skipped" | "missing";

export interface ScenarioResult {
  status: ScenarioStatus;
  /** test names (junit) or file:line (presence) */
  where: string[];
}

export interface ConvergeRecord {
  at: string;
  head: string | null;
  mode: "junit" | "presence";
  ok: boolean;
  scenarios: Record<string, ScenarioResult>;
  added: string[];
  escalated: string[];
}

const convergeFile = (change: Change) => join(change.dir, "evidence", "converge.json");
const now = () => new Date().toISOString();

const idPattern = (id: string) => new RegExp(`(^|[^a-z0-9/-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9/-])`);

function fromJunit(id: string, tests: TestCase[]): ScenarioResult {
  const re = idPattern(id);
  const hits = tests.filter((t) => re.test(t.name));
  if (!hits.length) return { status: "missing", where: [] };
  const status: ScenarioStatus = hits.some((t) => t.status === "fail") ? "fail" : hits.some((t) => t.status === "pass") ? "pass" : "skipped";
  return { status, where: hits.map((t) => `${t.name} (${t.status})`) };
}

function fromPresence(id: string, files: { file: string; lines: string[] }[]): ScenarioResult {
  const re = idPattern(id);
  const where: string[] = [];
  let live = false;
  for (const { file, lines } of files) {
    lines.forEach((line, n) => {
      if (!re.test(line)) return;
      const skipped = SKIPPED_LINE.test(line);
      if (!skipped) live = true;
      where.push(`${file}:${n + 1}${skipped ? " (skipped)" : ""}`);
    });
  }
  return { status: live ? "pass" : where.length ? "skipped" : "missing", where };
}

/** Scenario results for this change on the current code, without changing anything. */
export function scenarioResults(p: Paths, id: string): { mode: ConvergeRecord["mode"]; scenarios: Record<string, ScenarioResult> } {
  const change = loadChange(p, id);
  const config = loadQuality(p, change);
  const { summary } = pendingLayers(p, id);
  const tasks = loadTasks(p, id).tasks;
  const head = headCommit(p.project);
  const ids = [...idsAfterChange(p, id).changed.scenarios].sort();
  const withReports = config.layers.filter((l) => l.reports.length);
  const scenarios: Record<string, ScenarioResult> = {};

  if (withReports.length) {
    const tests = withReports.flatMap((l) => (isFresh(summary.layers[l.name], tasks, head) ? (summary.layers[l.name]?.tests ?? []) : []));
    for (const s of ids) scenarios[s] = fromJunit(s, tests);
    return { mode: "junit", scenarios };
  }
  const files = testFiles(p.project).map((f) => ({ file: f, lines: readFileSync(join(p.project, f), "utf8").split(/\r?\n/) }));
  for (const s of ids) scenarios[s] = fromPresence(s, files);
  return { mode: "presence", scenarios };
}

export interface ConvergeResult extends ConvergeRecord {
  summary: string;
}

/**
 * Runs converge in state converging. Gaps become converge tasks and the change goes back to
 * executing; a scenario that is still a gap after its converge task is done escalates instead
 * of looping.
 */
export function converge(p: Paths, id: string): ConvergeResult {
  const change = loadChange(p, id);
  if (stateOf(change) !== "converging") throw new OpError(`change "${id}" is "${String(change.data.state)}"; aidw converge runs in state converging`);
  if (approvalStatus(p, change).status !== "valid") throw new OpError(`approval drift in "${id}": escalate and re-approve`);
  const { pending } = pendingLayers(p, id);
  if (pending.length) throw new OpError(`quality layers not passing on the current code: ${pending.join(", ")}; run \`aidw verify\` first`);

  const { mode, scenarios } = scenarioResults(p, id);
  const gaps = Object.entries(scenarios)
    .filter(([, r]) => r.status !== "pass")
    .map(([s]) => s);
  const tf = loadTasks(p, id);
  const config = loadQuality(p, change);
  const record: ConvergeRecord = { at: now(), head: headCommit(p.project), mode, ok: gaps.length === 0, scenarios, added: [], escalated: [] };

  const coveredBefore = (s: string) => tf.tasks.some((t: Task) => t.origin === "converge" && Array.isArray(t.scenarios) && t.scenarios.includes(s));
  record.escalated = gaps.filter(coveredBefore);
  const fresh = gaps.filter((s) => !coveredBefore(s));

  if (record.escalated.length) {
    writeRecord(change, record);
    transition(p, id, "escalated", { reason: `converge: still no passing test after a converge task for ${record.escalated.join(", ")}` });
    return { ...record, summary: `escalated: ${record.escalated.length} scenario(s) still without a passing test after a converge task` };
  }

  if (fresh.length) {
    // The fix runs the approved test layers (not code), so its verify proves the scenario test passes.
    const testLayers = config.layers.filter((l) => l.name !== "code");
    const verify = (testLayers.length ? testLayers : config.layers).flatMap((l) => [...l.setup, ...l.run]);
    let n = tf.tasks.filter((t) => t.origin === "converge").length;
    const seq = tf.doc.get("tasks") as YAML.YAMLSeq;
    // One task per capability: its scenarios share files and context, so one implementer covers them all
    // (a task per scenario cost a subagent and a review each).
    const byCapability = new Map<string, string[]>();
    for (const s of fresh) {
      const cap = s.split("/").slice(0, -1).join("/");
      byCapability.set(cap, [...(byCapability.get(cap) ?? []), s]);
    }
    for (const [cap, ids] of byCapability) {
      n += 1;
      const taskId = `C${String(n).padStart(2, "0")}`;
      const problems = ids.map((s) => {
        const r = scenarios[s] as ScenarioResult;
        return r.status === "missing"
          ? `- ${s}: no test found (${mode} evidence). Write a test named with the id that asserts its THEN outcome, and make it pass.`
          : `- ${s}: its test is ${r.status === "fail" ? "failing" : "skipped"}: ${r.where.join("; ")}. Make it a real, passing test.`;
      });
      seq.add(
        tf.doc.createNode({
          id: taskId,
          title: ids.length === 1 ? `Cover scenario ${ids[0]}` : `Cover ${ids.length} scenarios of ${cap}`,
          role: DEFAULT_TASK_ROLE,
          origin: "converge",
          specs: [cap],
          scenarios: ids,
          depends_on: [],
          touches: ["**"],
          verify,
          problem: `Converge found scenario(s) of ${cap} without a passing test:\n${problems.join("\n")}`,
          status: "pending",
        }),
      );
      record.added.push(taskId);
    }
    saveTasksDoc(tf);
    writeRecord(change, record);
    transition(p, id, "executing", {});
    return { ...record, summary: `${fresh.length} scenario gap(s): converge task(s) ${record.added.join(", ")} added; change is executing again` };
  }

  writeRecord(change, record);
  return { ...record, summary: `all ${Object.keys(scenarios).length} scenario(s) have a passing test (${mode} evidence)` };
}

function writeRecord(change: Change, record: ConvergeRecord): void {
  const f = convergeFile(change);
  mkdirSync(join(change.dir, "evidence"), { recursive: true });
  let runs: ConvergeRecord[] = [];
  if (existsSync(f)) {
    try {
      runs = (JSON.parse(readFileSync(f, "utf8")) as { runs?: ConvergeRecord[] }).runs ?? [];
    } catch {
      runs = [];
    }
  }
  writeFileSync(f, `${JSON.stringify({ runs: [...runs, record] }, null, 2)}\n`);
}

export function lastConverge(change: Change): ConvergeRecord | null {
  const f = convergeFile(change);
  if (!existsSync(f)) return null;
  try {
    return ((JSON.parse(readFileSync(f, "utf8")) as { runs?: ConvergeRecord[] }).runs ?? []).at(-1) ?? null;
  } catch {
    return null;
  }
}

/** Guard for leaving converging: the latest converge passed on the current code. */
export function convergePassed(p: Paths, id: string): { ok: boolean; reason?: string } {
  const change = loadChange(p, id);
  const last = lastConverge(change);
  if (!last) return { ok: false, reason: "run `aidw converge` first" };
  if (!last.ok) return { ok: false, reason: "the last converge found gaps" };
  const tasks = loadTasks(p, id).tasks;
  const fresh = isFresh({ status: "pass", at: last.at, head: last.head, runs: [] }, tasks, headCommit(p.project));
  return fresh ? { ok: true } : { ok: false, reason: "code changed after the last converge; run `aidw converge` again" };
}
