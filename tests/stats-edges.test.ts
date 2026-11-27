/**
 * T19 (aidw stats) edge cases the first tests leave open: a whole Change driven through the real CLI (checkpoint,
 * verdict, triage, retry, upstream, not built), attempt counting, rule ids, --since and --change, damaged and old
 * files, several Changes with the same task ids, the verdict warning, the JSON shape, and that stats writes nothing.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { pluginRoot } from "../src/plugin.js";
import { pathsFor } from "../src/project.js";
import { blockingPart, computeStats, ruleIdWarning } from "../src/stats.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const HOME = pluginRoot({});

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

// ---------------------------------------------------------------- a Change driven by the real CLI

const ID = "2026-11-28-teams";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
/** verify reads `modes/<task>`: ok (exit 0), fail (exit 3) or refuse (the machine refuses: an environment failure) */
const VERIFY_JS = `const fs = require("fs");
const f = "modes/" + process.argv[2];
const m = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "ok";
if (m === "ok") process.exit(0);
if (m === "refuse") { console.log("EPERM: Operation not permitted, open '/store/lock'"); process.exit(1); }
console.log("expected 2 got 1");
process.exit(3);
`;

const taskYaml = (id: string, extra = "", role = "backend") => `  - id: ${id}
    title: Task ${id}
    role: ${role}
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [${SCENARIO}]
    touches: ["src/**", "tests/**"]
    verify: ['node verify.cjs ${id}']
    max_attempts: 1
    status: pending
${extra}`;

function executing(tasks: string): string {
  const root = tempProject();
  expect(cli(root, "init").code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(root, "change", "new", ID, "--title", "Teams").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, tasks);
  write(root, `${c}/quality.yaml`, `${QUALITY_YAML}grants:\n  agent_runs: 200\n`);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, ".aidw/domain/model.md", "# Domain\n");
  write(root, ".aidw/decisions/0001-supabase.md", "# Use Supabase for auth and data\n");
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  write(root, "tests/booking.test.ts", `import { test } from "vitest";\ntest("${SCENARIO}: x", () => {});\n`);
  write(root, "verify.cjs", VERIFY_JS);
  return root;
}

const mode = (root: string, task: string, m: "ok" | "fail" | "refuse") => write(root, `modes/${task}`, m);
const tasksOf = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const taskOf = (root: string, id: string) => tasksOf(root).find((t) => t.id === id) as Record<string, unknown>;
const evidence = (root: string, task: string) => JSON.parse(readFileSync(join(root, ".aidw/changes", ID, `evidence/${task}.json`), "utf8"));

function ok(r: ReturnType<typeof cli>, code = 0): ReturnType<typeof cli> {
  expect(r.code, `${r.out}\n${r.err}`).toBe(code);
  return r;
}

function verdict(root: string, task: string, text: string): ReturnType<typeof cli> {
  write(root, `.aidw/run/review-${task}.md`, text);
  return ok(cli(root, "verdict", task));
}

function triage(root: string, task: string, answer: string): ReturnType<typeof cli> {
  ok(cli(root, "brief", task, "--for", "triage"));
  write(root, `.aidw/run/triage-${task}.md`, answer);
  return ok(cli(root, "triage", task));
}

/** The author's round: the brief opens the Deviation, the author edits tasks.yaml, the lead closes it and reruns. */
function authorRound(root: string, task: string): void {
  ok(cli(root, "brief", task, "--for", "upstream"));
  const file = join(root, ".aidw/changes", ID, "tasks.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace(`title: Task ${task}`, `title: Task ${task} fixed`));
  ok(cli(root, "deviation", "close"));
  ok(cli(root, "upstream", task));
}

const RUN_TASKS = `tasks:
${taskYaml("T01")}${taskYaml("T02")}${taskYaml("T03").replace("max_attempts: 1", "max_attempts: 2")}${taskYaml("T04")}${taskYaml("T05")}${taskYaml("T06")}${taskYaml("T07")}${taskYaml("T08", "    depends_on: [T07]\n")}`;

/** T01 clean; T02 refused once; T03 review fix then pass; T04 triage implementation then pass; T05 upstream plan then
 * pass; T06 upstream spec, the author cannot fix; T07 triage environment; T08 depends on T07. */
function drivenChange(): string {
  const root = executing(RUN_TASKS);
  // T01: a clean first attempt
  ok(cli(root, "task", "start", "T01"));
  ok(cli(root, "checkpoint", "T01"));
  verdict(root, "T01", "VERDICT: pass\n");
  // T02: the machine refuses the first check (not a run), the second passes
  ok(cli(root, "task", "start", "T02"));
  mode(root, "T02", "refuse");
  expect(cli(root, "checkpoint", "T02").out).toMatch(/BLOCKED/);
  mode(root, "T02", "ok");
  ok(cli(root, "checkpoint", "T02"));
  verdict(root, "T02", "VERDICT: pass\n");
  // T03: the review asks for a fix citing B7 mid-line; the second run passes
  ok(cli(root, "task", "start", "T03"));
  ok(cli(root, "checkpoint", "T03"));
  verdict(root, "T03", "VERDICT: fix\n1. src/orders.ts: two writes without a transaction break B7 -> wrap them\n");
  ok(cli(root, "task", "start", "T03"));
  ok(cli(root, "checkpoint", "T03"));
  verdict(root, "T03", "VERDICT: pass\n");
  // T04: fails, Triage says implementation, the extra attempt passes
  mode(root, "T04", "fail");
  ok(cli(root, "task", "start", "T04"));
  cli(root, "checkpoint", "T04");
  triage(root, "T04", "CAUSE: implementation\nThe handler returns early.\n");
  mode(root, "T04", "ok");
  ok(cli(root, "task", "start", "T04"));
  ok(cli(root, "checkpoint", "T04"));
  verdict(root, "T04", "VERDICT: pass\n");
  // T05: fails, Triage says plan, the technical-planner fixes tasks.yaml, the rerun passes
  mode(root, "T05", "fail");
  ok(cli(root, "task", "start", "T05"));
  cli(root, "checkpoint", "T05");
  triage(root, "T05", "CAUSE: plan\nT05 touches the wrong folder.\n");
  authorRound(root, "T05");
  mode(root, "T05", "ok");
  ok(cli(root, "task", "start", "T05"));
  ok(cli(root, "checkpoint", "T05"));
  verdict(root, "T05", "VERDICT: pass\n");
  // T06: fails, Triage says spec, the business-analyst cannot fix it: not built
  mode(root, "T06", "fail");
  ok(cli(root, "task", "start", "T06"));
  cli(root, "checkpoint", "T06");
  triage(root, "T06", "CAUSE: spec\nThe two scenarios contradict.\n");
  ok(cli(root, "brief", "T06", "--for", "upstream"));
  ok(cli(root, "upstream", "T06", "--cannot", "both scenarios are core to the purpose"));
  // T07: fails, Triage says environment: not built, and T08 (depends on it) with it
  mode(root, "T07", "fail");
  ok(cli(root, "task", "start", "T07"));
  cli(root, "checkpoint", "T07");
  triage(root, "T07", "CAUSE: environment\nThe database is not running.\n");
  return root;
}

describe("aidw stats on a Change driven by the real CLI", () => {
  const root = drivenChange();
  const detail = () => cli(root, "stats", "--role", "backend", "--json").json() as { roles: Record<string, unknown>[]; tasks: Record<string, unknown>[] };
  const one = (id: string) => detail().tasks.find((x) => x.task === id) as Record<string, unknown>;

  it("ends with the statuses the steps lead to", () => {
    expect(tasksOf(root).map((t) => [t.id, t.status])).toEqual([
      ["T01", "done"],
      ["T02", "done"],
      ["T03", "done"],
      ["T04", "done"],
      ["T05", "done"],
      ["T06", "not_built"],
      ["T07", "not_built"],
      ["T08", "not_built"],
    ]);
  });

  it("counts a clean task and a task whose only refused checkpoint is not a run as first attempts", () => {
    expect(one("T01")).toMatchObject({ runs: 1, first_attempt: true, triage: [], upstream: [], rules: [] });
    expect(evidence(root, "T02").checkpoints.map((c: Record<string, unknown>) => [c.run, c.ok, c.blocked === true])).toEqual([
      [1, false, true],
      [1, true, false],
    ]);
    expect(one("T02")).toMatchObject({ runs: 1, first_attempt: true });
  });

  it("a review fix, a Triage retry and an upstream round each make a task not a first attempt", () => {
    expect(one("T03")).toMatchObject({ status: "done", runs: 2, first_attempt: false, rules: [{ id: "B7", owner: "backend" }] });
    expect(one("T04")).toMatchObject({ status: "done", runs: 2, first_attempt: false, triage: ["implementation"], upstream: [] });
    expect(one("T05")).toMatchObject({ status: "done", runs: 2, first_attempt: false, triage: ["plan"], upstream: [{ round: 1, cause: "plan", role: "technical-planner", outcome: "fixed" }] });
    expect(one("T06")).toMatchObject({ status: "not_built", first_attempt: false, triage: ["spec"], upstream: [{ round: 1, cause: "spec", role: "business-analyst", outcome: "cannot" }] });
    expect(one("T07")).toMatchObject({ status: "not_built", first_attempt: false, triage: ["environment"], not_built: { cause: "environment" } });
  });

  it("the upstream round resets the attempt number while the run number keeps counting", () => {
    const cps = evidence(root, "T05").checkpoints as Record<string, unknown>[];
    expect(cps.map((c) => [c.attempt, c.run, c.ok])).toEqual([
      [1, 1, false],
      [1, 2, true],
    ]);
    const reviews = evidence(root, "T05").reviews as Record<string, unknown>[];
    expect(reviews.map((r) => [r.attempt, r.run, r.verdict])).toEqual([[1, 2, "pass"]]);
    expect(taskOf(root, "T05")).toMatchObject({ runs: 2, attempts: 1 });
  });

  it("a task not built only because of a dependency never ran: not in the task count nor the first-attempt base", () => {
    expect(one("T08")).toMatchObject({ ran: false, runs: 0, first_attempt: null, not_built: { cause: "dependency" } });
    const backend = detail().roles[0]!;
    // T01..T08 listed, T08 never ran; T01..T07 ended; T01 and T02 first attempts; 7 >= 5 so a rate
    expect(backend).toMatchObject({ role: "backend", tasks: 7, ended: 7, first_attempt: 2, upstream_rounds: 2 });
    expect(backend.rate).toBeCloseTo(2 / 7);
    expect(backend.triage).toEqual({ implementation: 1, plan: 1, spec: 1, environment: 1 });
    expect(backend.not_built).toEqual({ triage: 1, environment: 1, dependency: 1 });
    expect(backend.rule_ids).toEqual([{ id: "B7", count: 1 }]);
  });

  it("is not partial: every record is a T19 record", () => {
    const s = cli(root, "stats", "--json").json();
    expect(s.partial).toBe(false);
    expect(s.changes).toEqual([{ id: ID, archived: false, predates: false }]);
    expect(cli(root, "stats").out).toMatch(/^backend\s+7\s+2 of 7 \(29%\)\s+environment 1, implementation 1, plan 1, spec 1\s+B7 x1$/m);
  });
});

// ---------------------------------------------------------------- hand-made records

const cp = (at: string, ok: boolean, extra: Record<string, unknown> = {}) => ({
  attempt: 1,
  at,
  ok,
  base: null,
  scenarios: {},
  missing_scenarios: [],
  verify: [{ command: "npm test", exit: ok ? 0 : 1, ms: 1, timedOut: false, tail: ok ? "" : "1 failed" }],
  changed_files: [],
  outside_touches: [],
  ...extra,
});
const rv = (at: string, verdict: "pass" | "fix", notes = `VERDICT: ${verdict}`, extra: Record<string, unknown> = {}) => ({ attempt: 1, at, verdict, notes, ...extra });
const t = (id: string, role: string, status: string, extra: Record<string, unknown> = {}) => ({ id, title: id, role, touches: ["src/**"], verify: ["npm test"], status, ...extra });
const AT = "2026-11-20T10:00:00.000Z";

function change(root: string, base: "changes" | "archive", folder: string, tasks: unknown[], evidence: Record<string, unknown>, id: string | null = folder): void {
  const dir = `.aidw/${base}/${folder}`;
  if (id !== null) write(root, `${dir}/change.yaml`, `id: ${id}\nstate: ${base === "archive" ? "archived" : "executing"}\n`);
  write(root, `${dir}/tasks.yaml`, YAML.stringify({ tasks }));
  for (const [task, ev] of Object.entries(evidence)) write(root, `${dir}/evidence/${task}.json`, typeof ev === "string" ? ev : JSON.stringify({ task, title: task, checkpoints: [], reviews: [], ...(ev as object) }, null, 2));
}

function blank(): string {
  const root = tempProject();
  write(root, ".aidw/project.yaml", "name: demo\n");
  return root;
}

const clean = (_task: string, at = AT) => ({ checkpoints: [cp(at, true, { run: 1 })], reviews: [rv(at, "pass", "VERDICT: pass", { run: 1 })] });

describe("attempt counting from the records", () => {
  it("an auto-passed review is not the task's review: a planned task with only that is not a first attempt", () => {
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T1", "backend", "done", { runs: 1, started_at: AT })], {
      T1: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [rv(AT, "pass", "auto-reviewed: a fix for the unit layer", { run: 1, auto: true })] },
    });
    expect(computeStats(pathsFor(root), HOME, { role: "backend" }).tasks![0]).toMatchObject({ first_attempt: false });
  });

  it("an auto-passed review is recognised by its note alone (records before the auto flag)", () => {
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T1", "backend", "done", { runs: 1, started_at: AT })], {
      T1: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [rv(AT, "pass", "auto-reviewed: a converge task that changed only test files", { run: 1 })] },
    });
    expect(computeStats(pathsFor(root), HOME, { role: "backend" }).tasks![0]).toMatchObject({ first_attempt: false });
  });

  it("a merge review does not stand in for the implementer's review, and its fix does not spoil a first attempt", () => {
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T1", "backend", "done", { runs: 1, started_at: AT }), t("T2", "backend", "done", { runs: 1, started_at: AT })], {
      T1: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [rv(AT, "pass", "VERDICT: pass", { run: 1, merge: true })] },
      T2: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [rv(AT, "pass", "VERDICT: pass", { run: 1 }), rv(AT, "fix", "VERDICT: fix\n1. merge lost a line", { run: 1, merge: true }), rv(AT, "pass", "VERDICT: pass", { run: 1, merge: true })] },
    });
    const tasks = computeStats(pathsFor(root), HOME, { role: "backend" }).tasks!;
    expect(tasks.map((x) => [x.task, x.first_attempt])).toEqual([
      ["T1", false],
      ["T2", true],
    ]);
  });

  it("a blocked checkpoint is not counted as a run in records without a `runs` counter (old records), flagged or not", () => {
    const root = blank();
    const refused = { verify: [{ command: "pnpm install", exit: 1, ms: 1, timedOut: false, tail: "EPERM: Operation not permitted" }] };
    const timedOut = { verify: [{ command: "pnpm install", exit: 1, ms: 1, timedOut: true, tail: "EPERM: Operation not permitted" }] };
    change(
      root,
      "archive",
      "2026-10-01-old",
      [t("T1", "backend", "done", { started_at: AT }), t("T2", "backend", "done", { started_at: AT }), t("T3", "backend", "done", { started_at: AT })],
      {
        T1: { checkpoints: [cp(AT, false, { blocked: true }), cp(AT, true)], reviews: [rv(AT, "pass")] },
        T2: { checkpoints: [cp(AT, false, refused), cp(AT, true)], reviews: [rv(AT, "pass")] },
        // a timed-out check is the code's failure, not the machine's: it is a run
        T3: { checkpoints: [cp(AT, false, timedOut), cp(AT, true)], reviews: [rv(AT, "pass")] },
      },
    );
    const tasks = computeStats(pathsFor(root), HOME, { role: "backend" }).tasks!;
    expect(tasks.map((x) => [x.task, x.runs, x.first_attempt])).toEqual([
      ["T1", 1, true],
      ["T2", 1, true],
      ["T3", 2, false],
    ]);
  });

  it("a task still running or in review is counted but is not in the first-attempt base", () => {
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T1", "backend", "running", { runs: 1, started_at: AT }), t("T2", "backend", "review", { runs: 1, started_at: AT }), t("T3", "backend", "pending")], {
      T2: { checkpoints: [cp(AT, true, { run: 1 })] },
    });
    expect(computeStats(pathsFor(root), HOME).roles).toEqual([expect.objectContaining({ role: "backend", tasks: 2, ended: 0, first_attempt: 0, rate: null })]);
  });

  it("the rate appears at exactly 5 ended tasks and not at 4", () => {
    const root = blank();
    const ids = ["T1", "T2", "T3", "T4"];
    change(root, "changes", "2026-11-20-a", ids.map((i) => t(i, "backend", "done", { runs: 1, started_at: AT })), Object.fromEntries(ids.map((i) => [i, clean(i)])));
    expect(computeStats(pathsFor(root), HOME).roles[0]).toMatchObject({ ended: 4, first_attempt: 4, rate: null });
    expect(cli(root, "stats").out).toMatch(/^backend\s+4\s+4 of 4\s+-/m);
    const five = [...ids, "T5"];
    change(root, "changes", "2026-11-20-a", five.map((i) => t(i, "backend", "done", { runs: 1, started_at: AT })), Object.fromEntries(five.map((i) => [i, clean(i)])));
    expect(computeStats(pathsFor(root), HOME).roles[0]).toMatchObject({ ended: 5, first_attempt: 5, rate: 1 });
    expect(cli(root, "stats").out).toMatch(/^backend\s+5\s+5 of 5 \(100%\)/m);
  });
});

// ---------------------------------------------------------------- rule ids

function reviewed(notes: string[], role = "backend"): ReturnType<typeof computeStats> {
  const root = blank();
  change(root, "changes", "2026-11-20-a", [t("T1", role, "done", { runs: notes.length + 1, started_at: AT })], {
    T1: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [...notes.map((n) => rv(AT, "fix", n, { run: 1 })), rv(AT, "pass", "VERDICT: pass", { run: notes.length + 1 })] },
  });
  return computeStats(pathsFor(root), HOME, { role });
}

describe("rule ids from fix reviews", () => {
  it("counts an id written mid-line in a blocking finding", () => {
    expect(reviewed(["VERDICT: fix\n1. src/a.ts: two writes break B7, wrap them"]).tasks![0]!.rules).toEqual([{ id: "B7", owner: "backend" }]);
  });

  it("counts an id once per review and once more for each later review that cites it again", () => {
    const s = reviewed(["VERDICT: fix\n1. B7: a\n2. B7: b", "VERDICT: fix\n1. B7: still"]);
    expect(s.tasks![0]!.rules).toEqual([
      { id: "B7", owner: "backend" },
      { id: "B7", owner: "backend" },
    ]);
    expect(s.roles[0]!.rule_ids).toEqual([{ id: "B7", count: 2 }]);
  });

  it("does not count a lower-case id (tables use upper case) and the verdict warns about it", () => {
    expect(reviewed(["VERDICT: fix\n1. b7: src/a.ts: no transaction"]).tasks![0]!.rules).toEqual([]);
    expect(ruleIdWarning(HOME, "backend", "VERDICT: fix\n1. b7: src/a.ts: no transaction")).toMatch(/cites no rule id of backend/);
  });

  it("does not count ids glued to other words (HTTP2, B7x, xB7) nor ids of a pass review", () => {
    expect(reviewed(["VERDICT: fix\n1. src/a.ts: HTTP2 and B7x and xB7 and B7_old"]).tasks![0]!.rules).toEqual([]);
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T1", "backend", "done", { runs: 1, started_at: AT })], {
      T1: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [rv(AT, "pass", "VERDICT: pass\nNon-blocking:\n- B7 holds", { run: 1 })] },
    });
    expect(computeStats(pathsFor(root), HOME).roles[0]!.rule_ids).toEqual([]);
  });

  it("orders ids most cited first, then by letter and number (B2 before B10)", () => {
    const s = reviewed(["VERDICT: fix\n1. B10: a\n2. B2: b\n3. B7: c", "VERDICT: fix\n1. B7: again"]);
    expect(s.roles[0]!.rule_ids).toEqual([
      { id: "B7", count: 2 },
      { id: "B2", count: 1 },
      { id: "B10", count: 1 },
    ]);
  });

  it("ignores ids in a review of a Role with no rule table, and its fix review does not warn", () => {
    const s = reviewed(["VERDICT: fix\n1. B7: src/ui/list.tsx: no transaction"], "frontend");
    expect(s.tasks![0]!.rules).toEqual([]);
    expect(s.roles).toEqual([expect.objectContaining({ role: "frontend", rule_ids: [] })]);
    expect(ruleIdWarning(HOME, "frontend", "VERDICT: fix\n1. src/ui/list.tsx: wrong")).toBeNull();
    expect(ruleIdWarning(HOME, "devops", "VERDICT: fix\n1. B7: whatever")).toBeNull();
  });

  it("credits a fullstack task's backend id to the backend row, which then appears with no tasks", () => {
    const s = computeStats(pathsFor((() => {
      const root = blank();
      change(root, "changes", "2026-11-20-a", [t("T1", "fullstack", "done", { runs: 2, started_at: AT })], {
        T1: { checkpoints: [cp(AT, true, { run: 1 }), cp(AT, true, { run: 2 })], reviews: [rv(AT, "fix", "VERDICT: fix\n1. B7: x", { run: 1 }), rv(AT, "pass", "VERDICT: pass", { run: 2 })] },
      });
      return root;
    })()), HOME);
    expect(s.roles.map((r) => [r.role, r.tasks, r.rule_ids])).toEqual([
      ["fullstack", 1, []],
      ["backend", 0, [{ id: "B7", count: 1 }]],
    ]);
  });

  it("an id cited only in the Non-blocking part of a fix review is not a broken rule and is not counted", () => {
    // code-reviewer.md: `1. <file>: <blocking problem>` ... `Non-blocking:` `- <optional remarks>`; T19: count broken rules
    const notes = "VERDICT: fix\n1. src/a.ts: the list has no limit -> add one\nNon-blocking:\n- B15 could be tighter here";
    expect(reviewed([notes]).tasks![0]!.rules).toEqual([]);
  });

  it("a fix review whose only rule id is in the Non-blocking part still warns", () => {
    const notes = "VERDICT: fix\n1. src/a.ts: the list has no limit -> add one\nNon-blocking:\n- B15 could be tighter here";
    expect(ruleIdWarning(HOME, "backend", notes)).toMatch(/cites no rule id/);
  });

  it("only a Non-blocking heading ends the blocking part, not a finding line that starts with the word", () => {
    // a blocking finding wrapped onto a line that starts "Non-blocking I/O ..." stays blocking
    const wrapped = "VERDICT: fix\n1. src/a.ts: the handler awaits a file read inline;\nNon-blocking I/O in the handler breaks B5 -> stream it";
    expect(blockingPart(wrapped)).toBe(wrapped);
    expect(ruleIdWarning(HOME, "backend", wrapped)).toBeNull();
    for (const heading of ["Non-blocking:", "**Non-blocking:**", "## Non-blocking", "- Non-blocking:"]) {
      const notes = `VERDICT: fix\n1. src/a.ts: B7 the list has no limit\n${heading}\n- B15 could be tighter`;
      expect(blockingPart(notes)).not.toContain("B15");
      expect(blockingPart(notes)).toContain("B7");
    }
  });
});

// ---------------------------------------------------------------- --since and --change

describe("--since and --change", () => {
  function dated(): string {
    const root = blank();
    const days = { T1: "2026-11-24T23:59:59.999Z", T2: "2026-11-25T00:00:00.000Z", T3: "2026-11-25T23:59:59.999Z", T4: "2026-11-26T08:00:00.000Z" };
    change(root, "changes", "2026-11-24-a", Object.entries(days).map(([id, at]) => t(id, "backend", "done", { runs: 1, started_at: at })), Object.fromEntries(Object.entries(days).map(([id, at]) => [id, clean(id, at)])));
    // no started_at: the earliest checkpoint or review date counts
    change(root, "changes", "2026-11-24-b", [t("U1", "backend", "done", { runs: 1 }), t("U2", "backend", "done", { runs: 1 })], {
      U1: { checkpoints: [cp("2026-11-25T00:00:00.000Z", true, { run: 1 })], reviews: [rv("2026-11-25T01:00:00.000Z", "pass", "VERDICT: pass", { run: 1 })] },
      U2: { checkpoints: [cp("2026-11-24T23:00:00.000Z", true, { run: 1 })], reviews: [rv("2026-11-25T01:00:00.000Z", "pass", "VERDICT: pass", { run: 1 })] },
    });
    return root;
  }

  it("keeps a task that started on the boundary day, from its first instant to its last, and drops the day before", () => {
    const s = computeStats(pathsFor(dated()), HOME, { role: "backend", since: "2026-11-25" });
    expect(s.tasks!.map((x) => x.task)).toEqual(["T2", "T3", "T4", "U1"]);
    expect(s.roles[0]).toMatchObject({ tasks: 4 });
  });

  it("a day after every task counts nothing and says so", () => {
    const r = cli(dated(), "stats", "--since", "2026-12-01");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/No tasks to count\./);
    expect(r.out).toMatch(/Changes counted: none/);
  });

  it("drops a Change from the count when --since leaves none of its tasks", () => {
    const s = cli(dated(), "stats", "--since", "2026-11-26", "--json").json();
    expect(s.changes.map((c: { id: string }) => c.id)).toEqual(["2026-11-24-a"]);
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    for (const bad of ["2026-11-5", "26-11-25", "2026/11/25", "2026-13-01", ""]) expect(cli(dated(), "stats", "--since", bad).code, bad).toBe(2);
  });

  it("rejects a day that does not exist (2026-02-30)", () => {
    expect(cli(dated(), "stats", "--since", "2026-02-30").code).toBe(2);
  });

  function archived(): string {
    const root = blank();
    // aidw archive moves `teams` to .aidw/archive/<date>-teams; change.yaml keeps the id `teams`
    change(root, "archive", "2026-11-27-teams", [t("T1", "backend", "done", { runs: 1, started_at: AT })], { T1: clean("T1") }, "teams");
    change(root, "archive", "2026-11-01-billing", [t("T1", "backend", "done", { runs: 1, started_at: AT })], { T1: clean("T1") }, null);
    change(root, "changes", "2026-11-27-teams-two", [t("T1", "frontend", "done", { runs: 1, started_at: AT })], { T1: clean("T1") });
    return root;
  }

  it("--change finds an archived Change by its id and by its archive folder name", () => {
    for (const ref of ["teams", "2026-11-27-teams"]) {
      const s = cli(archived(), "stats", "--change", ref, "--json").json();
      expect(s.changes, ref).toEqual([{ id: "teams", archived: true, predates: false }]);
      expect(s.roles.map((r: { role: string; tasks: number }) => [r.role, r.tasks])).toEqual([["backend", 1]]);
    }
  });

  it("--change finds an archived folder with no change.yaml by its folder name", () => {
    const s = cli(archived(), "stats", "--change", "2026-11-01-billing", "--json").json();
    expect(s.changes).toEqual([{ id: "2026-11-01-billing", archived: true, predates: false }]);
  });

  it("--change does not match a prefix of another Change's name", () => {
    for (const ref of ["2026-11-27", "teams-tw", "eams"]) {
      const r = cli(archived(), "stats", "--change", ref, "--json").json();
      expect(r.roles, ref).toEqual([]);
      expect(r.changes, ref).toEqual([]);
    }
  });

  it("several Changes with the same task ids are counted apart; --role lists each with its Change", () => {
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T01", "backend", "done", { runs: 1, started_at: AT })], { T01: clean("T01") });
    change(root, "changes", "2026-11-21-b", [t("T01", "backend", "done", { runs: 2, started_at: AT })], {
      T01: { checkpoints: [cp(AT, false, { run: 1 }), cp(AT, true, { run: 2 })], reviews: [rv(AT, "pass", "VERDICT: pass", { run: 2 })] },
    });
    change(root, "archive", "2026-10-01-c", [t("T01", "backend", "done", { runs: 1, started_at: AT })], {
      T01: { checkpoints: [cp(AT, true, { run: 1 })], reviews: [rv(AT, "fix", "VERDICT: fix\n1. B7: x", { run: 1 }), rv(AT, "pass", "VERDICT: pass", { run: 1 })] },
    });
    const s = computeStats(pathsFor(root), HOME, { role: "backend" });
    expect(s.tasks!.map((x) => [x.change, x.task, x.first_attempt])).toEqual([
      ["2026-11-20-a", "T01", true],
      ["2026-11-21-b", "T01", false],
      ["2026-10-01-c", "T01", false],
    ]);
    expect(s.roles[0]).toMatchObject({ tasks: 3, ended: 3, first_attempt: 1, rule_ids: [{ id: "B7", count: 1 }] });
    const text = cli(root, "stats", "--role", "backend").out;
    expect(text).toMatch(/2026-11-20-a\/T01 {2}done {2}runs 1 {2}first attempt/);
    expect(text).toMatch(/2026-11-21-b\/T01 {2}done {2}runs 2 {2}not first attempt/);
    expect(text).toMatch(/2026-10-01-c\/T01 {2}done {2}runs 1 {2}not first attempt\n {4}rules: B7/);
    expect(computeStats(pathsFor(root), HOME, { change: "2026-11-21-b" }).roles[0]).toMatchObject({ tasks: 1, first_attempt: 0 });
  });
});

// ---------------------------------------------------------------- damaged and old files

describe("damaged and old files never crash aidw stats", () => {
  const good = () => {
    const root = blank();
    change(root, "changes", "2026-11-20-good", [t("G1", "backend", "done", { runs: 1, started_at: AT })], { G1: clean("G1") });
    return root;
  };
  const damaged: [string, (root: string) => void][] = [
    ["evidence that is not JSON", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: "{ not json" })],
    ["evidence that is JSON null", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: "null" })],
    ["evidence that is a JSON list", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: "[1, 2]" })],
    ["evidence that is empty", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: "" })],
    ["evidence lists that are not lists", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: { checkpoints: "x", reviews: 5, triage: { cause: "plan" } } })],
    [
      "an evidence path that is a folder",
      (r) => {
        change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], {});
        mkdirSync(join(r, ".aidw/changes/2026-11-21-x/evidence/X1.json"), { recursive: true });
      },
    ],
    ["a missing evidence file", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], {})],
    ["tasks.yaml that is not YAML", (r) => write(r, ".aidw/changes/2026-11-21-x/tasks.yaml", "tasks: [\n  - id: : :\n")],
    ["tasks.yaml without a list", (r) => write(r, ".aidw/changes/2026-11-21-x/tasks.yaml", "tasks: 5\n")],
    ["tasks.yaml that is empty", (r) => write(r, ".aidw/changes/2026-11-21-x/tasks.yaml", "")],
    ["tasks that are not records", (r) => write(r, ".aidw/changes/2026-11-21-x/tasks.yaml", "tasks:\n  - 5\n  - null\n  - [a]\n  - { title: no id }\n")],
    ["a change.yaml that is not YAML", (r) => {
      change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: clean("X1") });
      write(r, ".aidw/changes/2026-11-21-x/change.yaml", "id: [\n");
    }],
    ["a file where a Change folder would be", (r) => write(r, ".aidw/changes/README.md", "# notes\n")],
    ["odd field types in tasks.yaml", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: "one", started_at: 5, role: 7, upstream: { round: "x" }, triage: "plan", not_built: { cause: 3, reason: 4 } })], { X1: clean("X1") })],
    ["a checkpoint whose verify is not a list", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { started_at: AT })], { X1: { checkpoints: [{ ok: false, verify: "npm test" }], reviews: [] } })],
    ["old records: no run, no agent, no triage list, no runs counter", (r) => change(r, "archive", "2026-09-01-old", [t("O1", "backend", "done", { started_at: "2026-09-01T10:00:00Z", attempts: 2, triage: { cause: "implementation", at: AT } })], { O1: { checkpoints: [cp(AT, false), cp(AT, true)], reviews: [rv(AT, "pass")] } })],
    ["a null checkpoint entry", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: { checkpoints: [null], reviews: [] } })],
    ["a null review entry", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: { checkpoints: [], reviews: [null] } })],
    ["a null triage entry", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: { checkpoints: [], reviews: [], triage: [null] } })],
    ["a null verify entry in a failed checkpoint", (r) => change(r, "changes", "2026-11-21-x", [t("X1", "backend", "done", { runs: 1, started_at: AT })], { X1: { checkpoints: [{ ok: false, verify: [null] }], reviews: [] } })],
  ];

  it.each(damaged)("%s", (_name, damage) => {
    const root = good();
    damage(root);
    for (const argv of [["stats"], ["stats", "--json"], ["stats", "--role", "backend", "--json"], ["stats", "--since", "2026-01-01"]]) {
      let r: ReturnType<typeof cli> | undefined;
      expect(() => (r = cli(root, ...argv)), argv.join(" ")).not.toThrow();
      expect(r!.code, `${argv.join(" ")}: ${r!.err}`).toBe(0);
    }
    // the good Change is still counted in full
    const s = cli(root, "stats", "--role", "backend", "--json").json();
    expect(s.tasks.find((x: { task: string }) => x.task === "G1")).toMatchObject({ first_attempt: true });
  });

  it("an old record's Triage comes from tasks.yaml and the report is marked partial", () => {
    const root = good();
    change(root, "archive", "2026-09-01-old", [t("O1", "backend", "done", { started_at: "2026-09-01T10:00:00Z", triage: { cause: "implementation", at: AT } })], {
      O1: { checkpoints: [cp(AT, false), cp(AT, true)], reviews: [rv(AT, "pass")] },
    });
    const s = cli(root, "stats", "--role", "backend", "--json").json();
    expect(s.partial).toBe(true);
    expect(s.changes.find((c: { id: string }) => c.id === "2026-09-01-old")).toEqual({ id: "2026-09-01-old", archived: true, predates: true });
    expect(s.tasks.find((x: { task: string }) => x.task === "O1")).toMatchObject({ runs: 2, first_attempt: false, triage: ["implementation"], fallback: true });
  });

  it("a project without any Change prints that there is nothing to count", () => {
    const r = cli(blank(), "stats");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^No tasks to count\.$/m);
    expect(cli(blank(), "stats", "--json").json()).toEqual({ changes: [], partial: false, roles: [] });
  });
});

// ---------------------------------------------------------------- the verdict warning

describe("the aidw verdict warning", () => {
  const one = (role = "backend", attempts = 1) => `tasks:\n${taskYaml("T01", "", role).replace("max_attempts: 1", `max_attempts: ${attempts}`)}`;
  function inReview(role = "backend", attempts = 1): string {
    const root = executing(one(role, attempts));
    ok(cli(root, "task", "start", "T01"));
    ok(cli(root, "checkpoint", "T01"));
    return root;
  }
  const fix = (root: string, notes: string) => {
    write(root, ".aidw/run/review-T01.md", notes);
    return cli(root, "verdict", "T01", "--json");
  };

  it.each([
    ["backend", "VERDICT: fix\n1. src/a.ts: no limit\n", true],
    ["backend", "VERDICT: fix\n1. B99: not a rule\n", true],
    ["backend", "VERDICT: fix\n1. b7: lower case\n", true],
    ["backend", "VERDICT: fix\n1. src/a.ts: two writes break B7 here\n", false],
    // L1: fullstack only follows backend's table: a fix review about something else owes no backend id
    ["fullstack", "VERDICT: fix\n1. src/a.ts: no limit\n", false],
    ["fullstack-engineer", "VERDICT: fix\n1. src/a.ts: no limit\n", false],
    ["fullstack", "VERDICT: fix\n1. B2: src/a.ts: no test\n", false],
    ["frontend", "VERDICT: fix\n1. src/a.tsx: wrong\n", false],
    ["devops", "VERDICT: fix\n1. Dockerfile: root user\n", false],
  ])("%s, %j: warns %s", (role, notes, warns) => {
    const root = inReview(role);
    const r = fix(root, notes);
    expect(r.code, r.err).toBe(0);
    const j = r.json();
    if (warns) expect(j.rule_warning).toMatch(/cites no rule id of backend/);
    else expect(j).not.toHaveProperty("rule_warning");
  });

  it("a pass verdict never warns", () => {
    const root = inReview("backend");
    write(root, ".aidw/run/review-T01.md", "VERDICT: pass\n");
    const r = cli(root, "verdict", "T01");
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/rule id/);
    expect(r.out).toMatch(/review pass -> done/);
  });

  it("the warning is printed in the text output and the review is still recorded", () => {
    const root = inReview("backend", 2);
    write(root, ".aidw/run/review-T01.md", "VERDICT: fix\n1. src/a.ts: no limit\n");
    const r = cli(root, "verdict", "T01");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ {2}warning: the fix review cites no rule id of backend/m);
    expect(evidence(root, "T01").reviews).toEqual([expect.objectContaining({ verdict: "fix", run: 1, agent: "aidw:code-reviewer" })]);
    expect(taskOf(root, "T01").status).not.toBe("review");
  });
});

// ---------------------------------------------------------------- JSON shape and read-only

describe("the JSON output and that stats writes nothing", () => {
  function sample(): string {
    const root = blank();
    change(root, "changes", "2026-11-20-a", [t("T1", "backend", "done", { runs: 2, started_at: AT }), t("T2", "backend", "not_built", { not_built: { cause: "dependency", reason: "depends on T1" } })], {
      T1: {
        checkpoints: [cp(AT, false, { run: 1, agent: "aidw:backend" }), cp(AT, true, { run: 2, agent: "aidw:backend" })],
        reviews: [rv(AT, "pass", "VERDICT: pass", { run: 2 })],
        triage: [{ run: 1, at: AT, cause: "implementation", summary: "x", outcome: "retry" }],
      },
    });
    return root;
  }

  it("has a stable shape: report, Role row and task row keys", () => {
    const all = cli(sample(), "stats", "--json").json();
    expect(Object.keys(all).sort()).toEqual(["changes", "partial", "roles"]);
    expect(Object.keys(all.roles[0]).sort()).toEqual(["added", "ended", "first_attempt", "no_evidence", "not_built", "rate", "refused", "role", "rule_ids", "tasks", "triage", "upstream_rounds"]);
    expect(Object.keys(all.changes[0]).sort()).toEqual(["archived", "id", "predates"]);
    const detail = cli(sample(), "stats", "--role", "backend", "--json").json();
    expect(Object.keys(detail).sort()).toEqual(["changes", "partial", "roles", "tasks"]);
    const [t1, t2] = detail.tasks;
    expect(t1).toEqual({
      change: "2026-11-20-a",
      task: "T1",
      title: "T1",
      role: "backend",
      status: "done",
      ran: true,
      runs: 2,
      first_attempt: false,
      rules: [],
      triage: ["implementation"],
      upstream: [],
      fallback: false,
      agents: ["aidw:backend"],
      started: AT,
    });
    expect(t2).toEqual({
      change: "2026-11-20-a",
      task: "T2",
      title: "T2",
      role: "backend",
      status: "not_built",
      ran: false,
      runs: 0,
      first_attempt: null,
      rules: [],
      triage: [],
      upstream: [],
      not_built: { cause: "dependency", reason: "depends on T1" },
      fallback: false,
      agents: [],
    });
    // the rate is null below 5 ended tasks, never left out
    expect(detail.roles[0]).toHaveProperty("rate", null);
  });

  it("--role of a Role with no task gives an empty list, not an error", () => {
    const r = cli(sample(), "stats", "--role", "database", "--json");
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ roles: [], tasks: [] });
  });

  function snapshot(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const f = join(dir, name);
        const st = statSync(f);
        if (st.isDirectory()) walk(f);
        else out[f] = `${st.mtimeMs}:${readFileSync(f, "utf8")}`;
      }
    };
    walk(root);
    return out;
  }

  it("writes nothing anywhere in the project, whatever the flags, on a driven Change too", () => {
    for (const root of [sample(), drivenChange()]) {
      const before = snapshot(root);
      for (const argv of [["stats"], ["stats", "--json"], ["stats", "--role", "backend"], ["stats", "--role", "backend", "--json"], ["stats", "--since", "2026-01-01"], ["stats", "--change", "2026-11-20-a"], ["stats", "--change", ID]]) {
        expect(cli(root, ...argv).code).toBe(0);
      }
      expect(snapshot(root)).toEqual(before);
    }
  });
});
