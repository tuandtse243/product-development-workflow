import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { pluginRoot } from "../src/plugin.js";
import { pathsFor } from "../src/project.js";
import { triageSummary } from "../src/run.js";
import { boundRules, citedRules, computeStats, ruleIdWarning } from "../src/stats.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

// ---------------------------------------------------------------- a synthetic project

const ENV_TAIL = "pnpm install\nError: EPERM: Operation not permitted, open '/store/lock'";

const cp = (at: string, ok: boolean, extra: Record<string, unknown> = {}) => ({
  attempt: 1,
  at,
  ok,
  base: null,
  scenarios: {},
  missing_scenarios: [],
  verify: ok ? [{ command: "npm test", exit: 0, ms: 1, timedOut: false, tail: "" }] : [{ command: "npm test", exit: 1, ms: 1, timedOut: false, tail: "1 failed" }],
  changed_files: [],
  outside_touches: [],
  ...extra,
});
const blockedCp = (at: string, extra: Record<string, unknown> = {}) => ({ ...cp(at, false), verify: [{ command: "pnpm install", exit: 1, ms: 1, timedOut: false, tail: ENV_TAIL }], ...extra });
const rv = (at: string, verdict: "pass" | "fix", notes = `VERDICT: ${verdict}`, extra: Record<string, unknown> = {}) => ({ attempt: 1, at, verdict, notes, ...extra });

function change(root: string, base: "changes" | "archive", id: string, tasks: Record<string, unknown>[], evidence: Record<string, Record<string, unknown>>): void {
  const dir = `.aidw/${base}/${id}`;
  write(root, `${dir}/change.yaml`, `id: ${id}\nstate: ${base === "archive" ? "archived" : "executing"}\n`);
  write(root, `${dir}/tasks.yaml`, YAML.stringify({ tasks }));
  for (const [task, ev] of Object.entries(evidence)) write(root, `${dir}/evidence/${task}.json`, JSON.stringify({ task, title: task, checkpoints: [], reviews: [], ...ev }, null, 2));
}

const t = (id: string, role: string, status: string, extra: Record<string, unknown> = {}) => ({ id, title: id, role, touches: ["src/**"], verify: ["npm test"], status, ...extra });

/**
 * alpha (active, T19 records), beta (archived, records before T19, no `runs` counter), gamma (active, one frontend task).
 */
function project(): string {
  const root = tempProject();
  write(root, ".aidw/project.yaml", "name: demo\n");
  const A = "2026-11-20T10:00:00.000Z";
  change(
    root,
    "changes",
    "2026-11-20-alpha",
    [
      t("A1", "backend", "done", { runs: 1, started_at: A }),
      t("A2", "backend", "done", { runs: 2, started_at: A }),
      t("A3", "backend", "done", { runs: 1, started_at: A }),
      t("A4", "backend", "not_built", { runs: 4, started_at: A, upstream: { cause: "plan", role: "technical-planner", round: 1, phase: "fixed" }, not_built: { cause: "triage", reason: "triage: implementation again; the attempt failed" } }),
      t("A5", "fullstack", "done", { runs: 2, started_at: A }),
      t("A6", "fullstack", "done", { runs: 1, started_at: A, origin: "converge" }),
      t("A7", "fullstack", "not_built", { not_built: { cause: "dependency", reason: "depends on A4, which is not built" } }),
    ],
    {
      A1: { checkpoints: [cp(A, true, { run: 1, agent: "aidw:backend" })], reviews: [rv(A, "pass", "VERDICT: pass", { run: 1, agent: "aidw:code-reviewer" })] },
      A2: {
        checkpoints: [cp(A, true, { run: 1, agent: "aidw:backend" }), cp(A, true, { run: 2, agent: "aidw:backend" })],
        reviews: [rv(A, "fix", "VERDICT: fix\n1. B7: src/orders.ts: two writes, no transaction\n2. B99: not a rule\n3. B7: again in the same review", { run: 1 }), rv(A, "pass", "VERDICT: pass", { run: 2 })],
      },
      A3: { checkpoints: [blockedCp(A, { run: 1, blocked: true }), cp(A, true, { run: 1 })], reviews: [rv(A, "pass", "VERDICT: pass", { run: 1 })] },
      A4: {
        checkpoints: [cp(A, false, { run: 1 }), cp(A, false, { run: 2 }), cp(A, false, { run: 3 }), cp(A, false, { run: 4 })],
        triage: [
          { run: 2, at: A, cause: "plan", summary: "touches misses src/db", outcome: "upstream", role: "technical-planner", round: 1 },
          { run: 3, at: A, cause: "implementation", summary: "the handler returns early", outcome: "retry" },
        ],
      },
      A5: {
        checkpoints: [cp(A, true, { run: 1, agent: "aidw:fullstack" }), cp(A, true, { run: 2, agent: "aidw:fullstack" })],
        reviews: [rv(A, "fix", "VERDICT: fix\n1. B2: src/routes/team.ts: no test for another user's record", { run: 1 }), rv(A, "pass", "VERDICT: pass", { run: 2 })],
      },
      A6: { checkpoints: [cp(A, true, { run: 1 })], reviews: [rv(A, "pass", "auto-reviewed: a converge task that changed only test files", { run: 1, auto: true })] },
    },
  );
  const B = "2026-10-01T10:00:00.000Z";
  change(
    root,
    "archive",
    "2026-10-01-beta",
    [
      t("B1", "backend", "done", { started_at: B }),
      t("B2", "backend", "done", { started_at: B }),
      t("B3", "backend", "done", { started_at: B, upstream: { cause: "spec", role: "business-analyst", round: 1, phase: "fixed" } }),
      t("B4", "backend", "not_built", { started_at: B, triage: { cause: "environment", at: B }, not_built: { cause: "environment", reason: "triage: environment. The database is down." } }),
    ],
    {
      B1: { checkpoints: [cp(B, true)], reviews: [rv(B, "pass")] },
      B2: { checkpoints: [blockedCp(B), cp(B, true)], reviews: [rv(B, "pass")] },
      B3: { checkpoints: [cp(B, false), cp(B, false), cp(B, true)], reviews: [rv(B, "pass")] },
      B4: { checkpoints: [cp(B, false), cp(B, false), cp(B, false)] },
    },
  );
  const C = "2026-11-26T10:00:00.000Z";
  change(root, "changes", "2026-11-26-gamma", [t("C1", "frontend", "done", { runs: 1, started_at: C })], {
    C1: { checkpoints: [cp(C, true, { run: 1, agent: "aidw:frontend" })], reviews: [rv(C, "pass", "VERDICT: pass", { run: 1 })] },
  });
  return root;
}

const roleOf = (s: ReturnType<typeof computeStats>, role: string) => s.roles.find((r) => r.role === role);
const HOME = pluginRoot({});

describe("aidw stats: per Role from every Change", () => {
  it("counts active and archived Changes, old and new evidence", () => {
    const s = computeStats(pathsFor(project()), HOME);
    expect(s.changes.map((c) => [c.id, c.archived, c.predates])).toEqual([
      ["2026-11-20-alpha", false, false],
      ["2026-11-26-gamma", false, false],
      ["2026-10-01-beta", true, true],
    ]);
    const backend = roleOf(s, "backend")!;
    // A1 (one run), A3 (its refused checkpoint is no run), B1, B2 (old records: one checkpoint that was not refused)
    expect(backend).toMatchObject({ tasks: 8, ended: 8, first_attempt: 4, rate: 0.5 });
    expect(backend.triage).toEqual({ plan: 1, implementation: 1, spec: 1, environment: 1 });
    expect(backend.not_built).toEqual({ triage: 1, environment: 1 });
    expect(backend.upstream_rounds).toBe(2);
  });

  it("credits a rule id to the Role that owns the table (fullstack follows backend) and ignores ids no table has", () => {
    const s = computeStats(pathsFor(project()), HOME);
    expect(roleOf(s, "backend")!.rule_ids).toEqual([
      { id: "B2", count: 1 },
      { id: "B7", count: 1 },
    ]);
    expect(roleOf(s, "fullstack")!.rule_ids).toEqual([]);
    const detail = computeStats(pathsFor(project()), HOME, { role: "fullstack" });
    expect(detail.tasks!.find((x) => x.task === "A5")!.rules).toEqual([{ id: "B2", owner: "backend" }]);
  });

  it("leaves added tasks and their auto-passed reviews out of the first-attempt figure, and tasks that never ran out of the count", () => {
    const fullstack = roleOf(computeStats(pathsFor(project()), HOME), "fullstack")!;
    expect(fullstack).toMatchObject({ tasks: 2, added: 1, ended: 1, first_attempt: 0 });
    expect(fullstack.not_built).toEqual({ dependency: 1 });
  });

  it("shows a rate only from 5 ended tasks of a Role up; counts always", () => {
    const s = computeStats(pathsFor(project()), HOME);
    expect(roleOf(s, "frontend")).toMatchObject({ tasks: 1, ended: 1, first_attempt: 1, rate: null });
    const text = cli(project(), "stats").out;
    expect(text).toMatch(/^backend\s+8\s+4 of 8 \(50%\)/m);
    expect(text).toMatch(/^frontend\s+1\s+1 of 1\s/m);
    expect(text).not.toMatch(/1 of 1 \(/);
  });

  it("says the Triage figures are partial when a Change predates the T19 records", () => {
    const out = cli(project(), "stats").out;
    expect(out).toMatch(/Changes counted: 3 \(2 active, 1 archived\)/);
    expect(out).toMatch(/Triage figures are partial: 1 Change\(s\) predate the T19 records \(2026-10-01-beta\)/);
    const alpha = cli(project(), "stats", "--change", "2026-11-26-gamma").out;
    expect(alpha).not.toMatch(/partial/);
  });

  it("--role lists each task: runs, first attempt, rule ids, Triage, upstream rounds, not-built cause", () => {
    const r = cli(project(), "stats", "--role", "backend");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/2026-11-20-alpha\/A1  done  runs 1  first attempt/);
    expect(r.out).toMatch(/2026-11-20-alpha\/A2  done  runs 2  not first attempt\n {4}rules: B7/);
    expect(r.out).toMatch(/A4  not_built  runs 4  not first attempt\n {4}triage: plan, implementation\n {4}upstream round 1: the technical-planner fixed the plan\n {4}not built \(triage\): triage: implementation again/);
    expect(r.out).toMatch(/B3  done  runs 3  not first attempt\n {4}triage: spec \(from tasks.yaml\)\n {4}upstream round 1: the business-analyst fixed the spec/);
    expect(r.out).toMatch(/B4  not_built  runs 3  not first attempt\n {4}triage: environment \(from tasks.yaml\)\n {4}not built \(environment\)/);
    expect(r.out).not.toMatch(/A5|C1/);
  });

  it("filters by Change and by start date, and prints JSON", () => {
    const root = project();
    const beta = cli(root, "stats", "--change", "2026-10-01-beta", "--json").json();
    expect(beta.changes).toEqual([{ id: "2026-10-01-beta", archived: true, predates: true }]);
    expect(beta.roles).toEqual([expect.objectContaining({ role: "backend", tasks: 4, ended: 4, first_attempt: 2, rate: null })]);
    const since = cli(root, "stats", "--since", "2026-11-25", "--json").json();
    expect(since.roles.map((r: { role: string }) => r.role)).toEqual(["frontend"]);
    expect(since.partial).toBe(false);
    expect(cli(root, "stats", "--since", "last week").code).toBe(2);
    const role = cli(root, "stats", "--role", "fullstack", "--json").json();
    expect(role.roles).toHaveLength(1);
    expect(role.tasks.map((x: { task: string }) => x.task)).toEqual(["A5", "A6", "A7"]);
  });

  it("writes nothing", () => {
    const root = project();
    const before = readFileSync(join(root, ".aidw/changes/2026-11-20-alpha/tasks.yaml"), "utf8");
    cli(root, "stats");
    cli(root, "stats", "--role", "backend", "--json");
    expect(readFileSync(join(root, ".aidw/changes/2026-11-20-alpha/tasks.yaml"), "utf8")).toBe(before);
  });
});

describe("rule ids", () => {
  it("bind a task through its Role and the Roles it follows", () => {
    expect(boundRules(HOME, "fullstack").get("B7")).toBe("backend");
    expect(boundRules(HOME, "backend").get("B15")).toBe("backend");
    expect(citedRules("1. B7: x\n2. B99: y\n3. B7: z\nHTTP2 B1", boundRules(HOME, "backend"))).toEqual([
      { id: "B7", owner: "backend" },
      { id: "B1", owner: "backend" },
    ]);
  });

  it("the verdict warning fires only for a fix review that cites no known id of a bound table", () => {
    expect(ruleIdWarning(HOME, "backend", "VERDICT: fix\n1. src/x.ts: wrong")).toMatch(/cites no rule id of backend/);
    expect(ruleIdWarning(HOME, "backend", "VERDICT: fix\n1. B99: not a rule")).toMatch(/cites no rule id/);
    expect(ruleIdWarning(HOME, "fullstack", "VERDICT: fix\n1. B3: team id from the body")).toBeNull();
    expect(ruleIdWarning(HOME, "devops", "VERDICT: fix\n1. Dockerfile: root user")).toBeNull();
  });

  it("a Triage summary keeps the first lines of the diagnosis, at most 500 characters", () => {
    expect(triageSummary("\nfirst\nsecond\n")).toBe("first\nsecond");
    expect(triageSummary("y".repeat(900))).toHaveLength(500);
    expect(triageSummary(`a\n${"z".repeat(600)}`)).toBe("a");
  });
});

// ---------------------------------------------------------------- the real CLI paths

const ID = "2026-11-28-teams";
const OK = `node -e "process.exit(0)"`;
const FAIL = `node -e "process.exit(3)"`;
const REFUSED = `node -e "console.log(process.argv[1]); process.exit(1)" "EPERM: Operation not permitted"`;
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

function executing(tasks: string): string {
  const root = tempProject();
  expect(cli(root, "init").code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(root, "change", "new", ID, "--title", "Teams").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, tasks);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, ".aidw/domain/model.md", "# Domain\n");
  write(root, ".aidw/decisions/0001-supabase.md", "# Use Supabase for auth and data\n");
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  write(root, "tests/booking.test.ts", `import { test } from "vitest";\ntest("${SCENARIO}: x", () => {});\n`);
  return root;
}

const TASKS = (verify: string, role = "backend") => `tasks:
  - id: T01
    title: Team members
    role: ${role}
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [${SCENARIO}]
    touches: ["src/**", "tests/**"]
    verify: ['${verify}']
    max_attempts: 1
    status: pending
`;

const evidence = (root: string) => JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/T01.json"), "utf8"));
const agentRuns = (root: string) => JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/agent-runs.json"), "utf8")).runs as Record<string, unknown>[];

describe("the T19 records are written by the CLI", () => {
  it("task start, checkpoint and verdict record the run and the Agent; a fix review without a rule id warns", () => {
    const root = executing(TASKS(OK));
    expect(cli(root, "task", "start", "T01").code).toBe(0);
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    write(root, ".aidw/run/review-T01.md", "VERDICT: fix\n1. src/teams.ts: the list has no limit\n");
    const v = cli(root, "verdict", "T01");
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/warning: the fix review cites no rule id of backend/);
    const ev = evidence(root);
    expect(ev.checkpoints[0]).toMatchObject({ run: 1, agent: "aidw:backend", ok: true });
    expect(ev.reviews[0]).toMatchObject({ run: 1, agent: "aidw:code-reviewer", verdict: "fix" });
    expect(agentRuns(root)).toEqual([
      expect.objectContaining({ kind: "implementer", task: "T01", role: "backend", agent: "aidw:backend" }),
      expect.objectContaining({ kind: "reviewer", task: "T01", role: "backend", agent: "aidw:code-reviewer" }),
    ]);
  });

  it("a fix review that cites a rule id does not warn, and stats counts it", () => {
    const root = executing(TASKS(OK, "fullstack"));
    cli(root, "task", "start", "T01");
    cli(root, "checkpoint", "T01");
    write(root, ".aidw/run/review-T01.md", "VERDICT: fix\n1. B10: src/teams.ts: the list has no limit\n");
    const v = cli(root, "verdict", "T01");
    expect(v.out).not.toMatch(/warning/);
    expect(evidence(root).checkpoints[0].agent).toBe("aidw:fullstack");
    const s = cli(root, "stats", "--json").json();
    expect(s.roles.find((r: { role: string }) => r.role === "backend").rule_ids).toEqual([{ id: "B10", count: 1 }]);
  });

  it("a checkpoint the machine refused is marked blocked", () => {
    const root = executing(TASKS(REFUSED));
    cli(root, "task", "start", "T01");
    expect(cli(root, "checkpoint", "T01").out).toMatch(/BLOCKED/);
    expect(evidence(root).checkpoints[0]).toMatchObject({ run: 1, blocked: true, ok: false });
  });

  it("triage appends an entry to the evidence that a retry does not wipe", () => {
    const root = executing(TASKS(FAIL));
    cli(root, "task", "start", "T01");
    cli(root, "checkpoint", "T01");
    const long = "x".repeat(800);
    write(root, ".aidw/run/triage-T01.md", `CAUSE: implementation\nThe handler returns early.\nFILES: src/teams.ts\n${long}\n`);
    expect(cli(root, "triage", "T01").code).toBe(0);
    const [entry] = evidence(root).triage;
    expect(entry).toMatchObject({ run: 1, cause: "implementation", outcome: "retry", files: ["src/teams.ts"] });
    expect(entry.summary).toBe("The handler returns early.\nFILES: src/teams.ts");
    expect(agentRuns(root).map((r) => [r.kind, r.agent])).toContainEqual(["implementer", "aidw:backend"]);
    // the extra attempt fails too: not built; the entry is still there and stats reads it
    cli(root, "task", "start", "T01");
    cli(root, "checkpoint", "T01");
    expect(evidence(root).triage).toHaveLength(1);
    const s = cli(root, "stats", "--role", "backend", "--json").json();
    expect(s.tasks[0]).toMatchObject({ task: "T01", runs: 2, first_attempt: false, triage: ["implementation"], fallback: false });
  });

  it("--unclear records an unclear Triage", () => {
    const root = executing(TASKS(FAIL));
    cli(root, "task", "start", "T01");
    cli(root, "checkpoint", "T01");
    expect(cli(root, "triage", "T01", "--unclear").code).toBe(0);
    expect(evidence(root).triage[0]).toMatchObject({ run: 1, cause: "unclear", outcome: "not_built" });
    expect(cli(root, "stats", "--json").json().roles[0].triage).toEqual({ unclear: 1 });
  });
});
