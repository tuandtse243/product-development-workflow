/**
 * T10 (plan D9, D10; ADR-0014): after the Approval Gate a task that fails after Triage goes back to the Role that
 * caused it, at most three rounds; then it and its dependants are not built and the rest carries on. Agent runs are
 * counted per Change, and at the cap no new task starts and the Change moves on.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { agentRunStatus } from "../src/agentruns.js";
import { run } from "../src/cli.js";
import { loadChange } from "../src/change.js";
import { pathsFor } from "../src/project.js";
import { MAX_UPSTREAM_ROUNDS } from "../src/run.js";
import { QUALITY_YAML, write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

const ID = "2026-11-08-booking";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
const OK = `node -e "process.exit(0)"`;
const FAIL = `node -e "console.log(process.argv[1]); process.exit(3)" expected-2-slots-got-1`;

/** T01 -> T02 (fails, one attempt) -> T03; T04 depends on nothing. */
const TASKS = `tasks:
  - id: T01
    title: Reschedule an appointment
    role: fullstack-engineer
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [${SCENARIO}]
    depends_on: []
    touches: ["app/api/bookings/**", "tests/**"]
    verify: ['${OK}']
    status: pending
  - id: T02
    title: Staff calendar
    role: fullstack-engineer
    type: feat
    specs: [booking/reschedule-appointment]
    depends_on: [T01]
    touches: ["lib/calendar/**"]
    verify: ['${FAIL}']
    max_attempts: 1
    status: pending
  - id: T03
    title: Calendar export
    role: fullstack-engineer
    type: feat
    depends_on: [T02]
    touches: ["lib/export/**"]
    verify: ['${OK}']
    status: pending
  - id: T04
    title: Reminder mail
    role: fullstack-engineer
    type: feat
    depends_on: []
    touches: ["lib/mail/**"]
    verify: ['${OK}']
    status: pending
`;

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
const tasks = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const task = (root: string, id: string) => tasks(root).find((t) => t.id === id) as Record<string, unknown>;
const state = (root: string) => String(loadChange(pathsFor(root), ID).data.state);
const next = (root: string) => cli(root, "next", "--json").json();

function project(quality = QUALITY_YAML): string {
  const root = executingProject({ tasks: TASKS, quality });
  write(root, "tests/booking.test.ts", `import { test } from "vitest";\ntest("${SCENARIO}: moves it", () => {});\n`);
  return root;
}

function finish(root: string, id: string): void {
  expect(cli(root, "task", "start", id).code).toBe(0);
  expect(cli(root, "checkpoint", id).code).toBe(0);
  expect(cli(root, "review", id, "pass").code).toBe(0);
}

/** T01 done; T02 used its one attempt and waits for Triage. */
function failedT02(quality = QUALITY_YAML): string {
  const root = project(quality);
  finish(root, "T01");
  expect(cli(root, "task", "start", "T02").code).toBe(0);
  expect(cli(root, "checkpoint", "T02").code).toBe(1);
  expect(next(root)).toMatchObject({ action: "triage", task: "T02" });
  return root;
}

function triage(root: string, cause: string, text = "the evidence says so."): ReturnType<typeof cli> {
  expect(cli(root, "brief", "T02", "--for", "triage").code).toBe(0);
  write(root, ".aidw/run/triage-T02.md", `CAUSE: ${cause}\n${text}\n`);
  return cli(root, "triage", "T02");
}

let edits = 0;
/** The author's round (T9): the brief opens the Deviation, the technical-planner changes T02 in tasks.yaml, the lead closes it. */
function authorRound(root: string): void {
  expect(cli(root, "brief", "T02", "--for", "upstream").code).toBe(0);
  const file = join(root, ".aidw/changes", ID, "tasks.yaml");
  edits += 1;
  writeFileSync(file, readFileSync(file, "utf8").replace(/title: Staff calendar.*/, `title: Staff calendar v${edits}`));
  const c = cli(root, "deviation", "close");
  expect(c.code, c.err).toBe(0);
  expect(cli(root, "upstream", "T02").code).toBe(0);
}

/** The task is back after the author's round: it reruns, and fails again. */
function rerunAndFail(root: string): void {
  expect(next(root)).toMatchObject({ action: "implement", task: "T02", reason: "retry" });
  expect(cli(root, "task", "start", "T02").code).toBe(0);
  expect(cli(root, "checkpoint", "T02").code).toBe(1);
}

describe("the upstream fix loop (D9)", () => {
  it("routes a plan cause to the technical-planner, and the task runs again after the author's round", () => {
    const root = failedT02();
    const t = triage(root, "plan", "T02 touches lib/calendar but the handler lives in app/api/calendar.");
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/plan.*technical-planner.*round 1 of 3/);
    expect(t.out).not.toMatch(/escalat|the user decides/);
    expect(task(root, "T02")).toMatchObject({ status: "failed", upstream: { cause: "plan", role: "technical-planner", round: 1, phase: "open" } });
    expect(state(root)).toBe("executing");

    const n = next(root);
    expect(n).toMatchObject({ action: "upstream", step: "open", task: "T02", cause: "plan", role: "technical-planner", round: 1 });
    expect(cli(root, "next").out).toMatch(/aidw brief T02 --for upstream/);

    const b = cli(root, "brief", "T02", "--for", "upstream");
    expect(b.code, b.err).toBe(0);
    // the approved Artifact changes only through a Deviation (T9): the brief opens it for the author's files, one SPAWN
    expect(b.out).toContain(`Deviation D01 is open for the technical-planner: .aidw/changes/${ID}/tasks.yaml`);
    expect(b.out.match(/SPAWN /g)).toHaveLength(1);
    expect(b.out).toMatch(/SPAWN aidw:technical-planner with: Upstream brief: .*T02\.upstream\.md/);
    expect(b.out).toMatch(/Then: aidw deviation close, and aidw upstream T02/);
    const brief = readFileSync(b.out.match(/Upstream brief: (\S+)\./)![1]!, "utf8");
    expect(brief).toMatch(/handler lives in app\/api\/calendar/);
    expect(brief).toMatch(/keep the purpose/i);
    expect(brief).toMatch(/smallest change/i);
    expect(brief).toMatch(/no new scope/i);
    expect(brief).toMatch(/Deviation D01 is open[\s\S]*D01\.deviation\.md/);
    // the Deviation brief points back at the diagnosis and at the upstream brief
    const dbrief = readFileSync(join(root, ".aidw/run/briefs", ID, "D01.deviation.md"), "utf8");
    expect(dbrief).toMatch(/\.aidw\/run\/triage-T02\.md/);
    expect(dbrief).toMatch(/T02\.upstream\.md/);
    // while it is open, next says the author is at work, not "spawn the Deviation's author" a second time
    expect(next(root)).toMatchObject({ action: "upstream", step: "author", task: "T02", deviation: "D01" });
    // printed again: the same Deviation and the same Agent run
    expect(cli(root, "brief", "T02", "--for", "upstream").out).toContain("Deviation D01 is open");
    expect(agentRunStatus(pathsFor(root), loadChange(pathsFor(root), ID)).used).toBe(5);

    // not before the Deviation is closed
    expect(cli(root, "upstream", "T02").err).toMatch(/D01 for T02 is still open: `aidw deviation close` first/);
    const file = join(root, ".aidw/changes", ID, "tasks.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/title: Staff calendar.*/, "title: Staff calendar in app/api/calendar"));
    const closed = cli(root, "deviation", "close");
    expect(closed.code, closed.err).toBe(0);
    const u = cli(root, "upstream", "T02");
    expect(u.code).toBe(0);
    expect(u.out).toMatch(/NEXT: implement T02 \(retry\)/);
    const t2 = task(root, "T02");
    expect(t2).toMatchObject({ status: "failed", attempts: 0, upstream: { round: 1, phase: "fixed" } });
    expect(t2).not.toHaveProperty("triage");
    rerunAndFail(root);
    // a new failure after the author's round is triaged again
    expect(next(root)).toMatchObject({ action: "triage", task: "T02" });
  });

  it.each([
    ["spec", "business-analyst", `.aidw/changes/${ID}/specs/booking/spec.md`],
    ["architecture", "software-architect", ".aidw/architecture/overview.md"],
  ])("routes a %s cause to its author (%s, from artifacts.yaml)", (cause, role, file) => {
    const root = failedT02();
    expect(triage(root, cause).code).toBe(0);
    expect(next(root)).toMatchObject({ action: "upstream", task: "T02", cause, role, round: 1 });
    const b = cli(root, "brief", "T02", "--for", "upstream");
    expect(b.code, b.err).toBe(0);
    expect(b.out).toContain(`Deviation D01 is open for the ${role}: ${file}`);
    expect(b.out).toMatch(new RegExp(`SPAWN aidw:${role} with: Upstream brief`));
  });

  it("lets Triage name the file at fault: its owner in artifacts.yaml fixes it", () => {
    const root = failedT02();
    // the domain model is an approved Artifact of the product-manager (artifacts.yaml: domain-model)
    const t = triage(root, "architecture", "The domain model has no notion of a moved slot.\nFILES: domain/model.md");
    expect(t.out).toMatch(/goes back to the product-manager/);
    expect(task(root, "T02").upstream).toMatchObject({ role: "product-manager", files: [".aidw/domain/model.md"] });
    const b = cli(root, "brief", "T02", "--for", "upstream");
    expect(b.code, b.err).toBe(0);
    expect(b.out).toContain("Deviation D01 is open for the product-manager: .aidw/domain/model.md");
  });

  it("names every delta spec of the Change for a spec cause of a task without specs", () => {
    const root = project();
    finish(root, "T01");
    for (let i = 0; i < 3; i++) {
      expect(cli(root, "task", "start", "T04").code).toBe(0);
      expect(cli(root, "checkpoint", "T04").code).toBe(0);
      expect(cli(root, "review", "T04", "fix", "--notes", "1. still wrong").code).toBe(0);
    }
    expect(cli(root, "brief", "T04", "--for", "triage").code).toBe(0);
    write(root, ".aidw/run/triage-T04.md", "CAUSE: spec\nThe reminder scenario cannot be observed.\n");
    expect(cli(root, "triage", "T04").code).toBe(0);
    const b = cli(root, "brief", "T04", "--for", "upstream");
    expect(b.code, b.err).toBe(0);
    expect(b.out).toContain(`Deviation D01 is open for the business-analyst: .aidw/changes/${ID}/specs/booking/spec.md`);
  });

  it(`after ${MAX_UPSTREAM_ROUNDS} rounds the task and its dependants are not built, and an independent task still runs`, () => {
    const root = failedT02();
    for (let round = 1; round <= MAX_UPSTREAM_ROUNDS; round++) {
      expect(triage(root, "plan").out).toMatch(new RegExp(`round ${round} of ${MAX_UPSTREAM_ROUNDS}`));
      authorRound(root);
      rerunAndFail(root);
    }
    const last = triage(root, "plan");
    expect(last.code).toBe(0);
    expect(last.out).toMatch(/not built/);
    expect(last.out).not.toMatch(/escalat/);
    expect(task(root, "T02")).toMatchObject({ status: "not_built" });
    expect(String((task(root, "T02").not_built as { reason?: string }).reason)).toMatch(/plan.*3 upstream rounds/);
    expect(task(root, "T03")).toMatchObject({ status: "not_built" });
    expect(task(root, "T03").not_built).toMatchObject({ cause: "dependency", reason: expect.stringMatching(/depends on T02/) });
    expect(task(root, "T04").status).toBe("pending");
    expect(state(root)).toBe("executing");

    expect(next(root)).toMatchObject({ action: "implement", task: "T04", reason: "new" });
    finish(root, "T04");
    expect(next(root)).toMatchObject({ action: "complete", done: 2, not_built: ["T02", "T03"] });
    expect(cli(root, "next").out).toMatch(/not built: T02, T03/);
    // the Change moves on with the not-built tasks listed; the PR (T11) shows them
    expect(cli(root, "transition", ID, "verifying").code).toBe(0);
  });

  it("an environment cause is not built at once, with its dependants, and nothing asks the user", () => {
    const root = failedT02();
    const t = triage(root, "environment", "The STRIPE_KEY variable is not set in .env.");
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/environment.*not built.*STRIPE_KEY/);
    expect(task(root, "T02")).toMatchObject({ status: "not_built" });
    expect(task(root, "T02").not_built).toMatchObject({ cause: "environment", reason: expect.stringMatching(/environment.*STRIPE_KEY/) });
    expect(task(root, "T03").status).toBe("not_built");
    expect(task(root, "T02")).not.toHaveProperty("upstream");
    expect(next(root)).toMatchObject({ action: "implement", task: "T04" });
    expect(state(root)).toBe("executing");
  });

  it("an implementation cause keeps today's extra attempt; when that fails too the task is not built, not escalated", () => {
    const root = failedT02();
    const t = triage(root, "implementation", "The handler returns early.");
    expect(t.out).toMatch(/One further attempt/);
    rerunAndFail(root);
    const n = next(root);
    expect(n.action).not.toBe("escalate");
    expect(task(root, "T02")).toMatchObject({ status: "not_built" });
    expect(String((task(root, "T02").not_built as { reason?: string }).reason)).toMatch(/implementation/);
    expect(task(root, "T03").status).toBe("not_built");
    expect(n).toMatchObject({ action: "implement", task: "T04" });
  });

  it("a review that asks for fixes on the last attempt goes to Triage, not to the user", () => {
    const root = project();
    finish(root, "T01");
    // T04 allows 3 attempts; review fix three times
    for (let i = 0; i < 3; i++) {
      expect(cli(root, "task", "start", "T04").code).toBe(0);
      expect(cli(root, "checkpoint", "T04").code).toBe(0);
      expect(cli(root, "review", "T04", "fix", "--notes", "1. still wrong").code).toBe(0);
    }
    expect(task(root, "T04").status).toBe("failed");
    expect(next(root)).toMatchObject({ action: "triage", task: "T04" });
  });

  it("an author that cannot fix its Artifact leaves the task not built at once; its Deviation is abandoned", () => {
    const root = failedT02();
    triage(root, "spec");
    cli(root, "brief", "T02", "--for", "upstream");
    const u = cli(root, "upstream", "T02", "--cannot", "the two scenarios contradict and both are core to the purpose");
    expect(u.code, u.err).toBe(0);
    expect(cli(root, "deviation", "list").out).toMatch(/D01 abandoned/);
    expect(task(root, "T02")).toMatchObject({ status: "not_built" });
    expect(String((task(root, "T02").not_built as { reason?: string }).reason)).toMatch(/business-analyst could not fix.*contradict/);
    expect(task(root, "T03").status).toBe("not_built");
  });

  it("refuses to rerun after an abandoned Deviation without --cannot", () => {
    const root = failedT02();
    triage(root, "plan");
    cli(root, "brief", "T02", "--for", "upstream");
    expect(cli(root, "deviation", "abandon").code).toBe(0);
    expect(cli(root, "upstream", "T02").err).toMatch(/D01 of this round was abandoned/);
  });
});

describe("Agent runs and the cap (D10)", () => {
  it("counts every Agent run the CLI prints once, whatever prints it again", () => {
    const root = failedT02();
    // T01 implementer + reviewer, T02 implementer
    const p = pathsFor(root);
    expect(agentRunStatus(p, loadChange(p, ID)).used).toBe(3);
    cli(root, "brief", "T02", "--for", "triage");
    cli(root, "brief", "T02", "--for", "triage"); // printed again: the same run
    expect(agentRunStatus(p, loadChange(p, ID))).toMatchObject({ used: 4, cap: 24, reached: false });
    write(root, ".aidw/run/triage-T02.md", "CAUSE: plan\nx\n");
    cli(root, "triage", "T02");
    cli(root, "brief", "T02", "--for", "upstream");
    expect(agentRunStatus(p, loadChange(p, ID)).used).toBe(5);
    const runs = JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/agent-runs.json"), "utf8")).runs as { kind: string }[];
    expect(runs.map((r) => r.kind)).toEqual(["implementer", "reviewer", "implementer", "triage", "author"]);
  });

  it("at the cap no new task starts, running work finishes, and the Change moves on cleanly", () => {
    const root = project(`${QUALITY_YAML}grants:\n  agent_runs: 2\n`);
    expect(cli(root, "task", "start", "T01").code).toBe(0); // run 1
    expect(cli(root, "checkpoint", "T01").out).toMatch(/SPAWN aidw:code-reviewer/); // run 2: the cap
    const p = pathsFor(root);
    expect(agentRunStatus(p, loadChange(p, ID))).toMatchObject({ used: 2, cap: 2, reached: true });
    // the running task finishes: its review is not cut off
    expect(next(root)).toMatchObject({ action: "review", task: "T01" });
    expect(cli(root, "review", "T01", "pass").code).toBe(0);
    // nothing new starts: the rest is not built, with the cap as the reason
    const n = next(root);
    expect(n).toMatchObject({ action: "complete", done: 1, not_built: ["T02", "T03", "T04"] });
    expect(task(root, "T04").not_built).toMatchObject({ cause: "cap", reason: expect.stringMatching(/cap of 2 Agent runs/) });
    expect(cli(root, "task", "start", "T04").err).toMatch(/not_built/);
    expect(state(root)).toBe("executing");
    expect(cli(root, "transition", ID, "verifying").code).toBe(0);
  });

  it("refuses a new start at the cap", () => {
    const root = project(`${QUALITY_YAML}grants:\n  agent_runs: 1\n`);
    expect(cli(root, "task", "start", "T01").code).toBe(0);
    expect(cli(root, "task", "start", "T04").err).toMatch(/cap of 1 Agent run/);
  });
});

describe("after review: the cap, the seam and the fallbacks", () => {
  const setTask = (root: string, id: string, fields: Record<string, unknown>) => {
    const file = join(root, ".aidw/changes", ID, "tasks.yaml");
    const data = YAML.parse(readFileSync(file, "utf8")) as { tasks: Record<string, unknown>[] };
    Object.assign(data.tasks.find((t) => t.id === id) as object, fields);
    writeFileSync(file, YAML.stringify(data));
  };

  it("measures the default cap against the planned Agent runs and fixes it in the approval record", () => {
    const root = project();
    const p = pathsFor(root);
    // 4 tasks x 2 (implementer and reviewer) + 0 review layers = 8 planned; 3 x 8
    expect((loadChange(p, ID).data.approval as { agent_run_cap?: number }).agent_run_cap).toBe(24);
    expect(agentRunStatus(p, loadChange(p, ID)).cap).toBe(24);
  });

  it("fails closed on a record of Agent runs that cannot be read", () => {
    const root = project();
    write(root, `.aidw/changes/${ID}/evidence/agent-runs.json`, "{ not json");
    const p = pathsFor(root);
    expect(agentRunStatus(p, loadChange(p, ID))).toMatchObject({ reached: true, unreadable: true });
    expect(cli(root, "task", "start", "T01").err).toMatch(/cannot be read/);
    expect(next(root)).toMatchObject({ action: "complete", done: 0 });
    expect(task(root, "T04").not_built).toMatchObject({ cause: "cap" });
  });

  it("a blocker no Role can answer is an environment cause: `aidw not-built --cause environment`, dependants with it", () => {
    const root = project();
    finish(root, "T01");
    expect(cli(root, "task", "start", "T02").code).toBe(0);
    const r = cli(root, "not-built", "T02", "--cause", "environment", "--reason", "the SMS provider's sandbox key is not in .env");
    expect(r.code, r.err).toBe(0);
    expect(task(root, "T02")).toMatchObject({ status: "not_built", not_built: { cause: "environment" } });
    expect(task(root, "T03").not_built).toMatchObject({ cause: "dependency" });
    expect(next(root)).toMatchObject({ action: "implement", task: "T04" });
    expect(state(root)).toBe("executing");
  });

  it("`aidw triage --unclear`: no clear cause twice, the task is not built", () => {
    const root = failedT02();
    expect(cli(root, "brief", "T02", "--for", "triage").code).toBe(0);
    const r = cli(root, "triage", "T02", "--unclear");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/no clear cause, so it is not built/);
    expect(task(root, "T02")).toMatchObject({ status: "not_built", not_built: { cause: "triage" } });
  });

  it("only `aidw next` and state changes settle: a read-only next does not mark anything", async () => {
    const root = project(`${QUALITY_YAML}grants:\n  agent_runs: 1\n`);
    expect(cli(root, "task", "start", "T01").code).toBe(0); // the cap
    const { nextAction } = await import("../src/run.js");
    expect(nextAction(pathsFor(root), ID)).toMatchObject({ action: "implement", task: "T01", reason: "interrupted" });
    expect(task(root, "T04").status).toBe("pending");
    expect(cli(root, "next").code).toBe(0);
    expect(task(root, "T04").status).toBe("not_built");
  });

  it("at the cap an open upstream Deviation is abandoned before the task is not built", () => {
    const root = failedT02(`${QUALITY_YAML}grants:\n  agent_runs: 5\n`);
    triage(root, "plan"); // 4
    expect(cli(root, "brief", "T02", "--for", "upstream").code).toBe(0); // 5: the cap
    expect(next(root)).toMatchObject({ action: "complete" });
    expect(cli(root, "deviation", "list").out).toMatch(/D01 abandoned/);
    expect(task(root, "T02").not_built).toMatchObject({ cause: "cap" });
  });

  it("tasks that can never run are not built, so the run does not stop on them", () => {
    const root = project();
    finish(root, "T01");
    setTask(root, "T02", { status: "blocked" });
    finish(root, "T04");
    const n = next(root);
    expect(n.action).toBe("complete");
    expect(task(root, "T03").not_built).toMatchObject({ cause: "dependency" });
    expect(task(root, "T02").status).toBe("not_built");
  });

  it("a resolve the machine refused twice leaves the task not built (environment)", async () => {
    const root = project();
    expect(cli(root, "task", "start", "T04").code).toBe(0);
    const { recordBlocked } = await import("../src/run.js");
    expect(recordBlocked(pathsFor(root), ID, "T04", "environment: `pnpm test` was refused by the machine (EPERM)")).toBeNull();
    expect(recordBlocked(pathsFor(root), ID, "T04", "environment: `pnpm test` was refused by the machine (EPERM)")).toEqual(["T04"]);
    expect(task(root, "T04").not_built).toMatchObject({ cause: "environment", reason: expect.stringMatching(/refused a check twice.*EPERM/) });
  });
});

describe("after re-review: change.yaml and a not-built task's work on the main checkout", () => {
  it("denies every Agent writing change.yaml, by any spelling and through the shell; reading stays allowed", async () => {
    const { decide } = await import("../src/gate.js");
    const root = project();
    const c = `.aidw/changes/${ID}`;
    const ask = (tool_name: string, tool_input: Record<string, unknown>, agent_type = "aidw:technical-planner") =>
      decide({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: root, agent_type }, {} as NodeJS.ProcessEnv)?.decision;
    expect(ask("Edit", { file_path: join(root, c, "Change.YAML") })).toBe("deny");
    expect(ask("Write", { file_path: join(root, c, "change.yaml") }, "aidw:fullstack")).toBe("deny");
    expect(ask("Bash", { command: `sed -i '' 's/agent_run_cap: 24/agent_run_cap: 999/' ${c}/change.yaml` })).toBe("deny");
    expect(ask("Bash", { command: `echo x > ${c}/CHANGE.yaml` })).toBe("deny");
    expect(ask("Bash", { command: `cat ${c}/change.yaml` })).not.toBe("deny");
  });

  it("puts back tracked edits and removes created files of a task not built on the main checkout, keeping what was dirty before", () => {
    const root = executingProject({ git: true, tasks: TASKS, quality: QUALITY_YAML });
    const g = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    write(root, "lib/calendar/existing.ts", "export const v = 1;\n");
    g("add", "-A");
    g("commit", "-qm", "existing");
    write(root, "notes-of-the-user.md", "mine\n");
    finish(root, "T04"); // T04's commit takes the file along (git add -A)
    write(root, "notes-of-the-user.md", "mine, still uncommitted\n"); // dirty before T01 starts: not its work
    expect(cli(root, "task", "start", "T01").code).toBe(0);
    write(root, "lib/calendar/existing.ts", "export const v = 2; // half done\n"); // tracked, changed
    write(root, "lib/calendar/half.ts", "export const half = 1;\n"); // untracked, created
    const r = cli(root, "not-built", "T01", "--cause", "environment", "--reason", "no calendar API key in .env");
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(root, "lib/calendar/existing.ts"), "utf8")).toBe("export const v = 1;\n");
    expect(existsSync(join(root, "lib/calendar/half.ts"))).toBe(false);
    expect(readFileSync(join(root, "notes-of-the-user.md"), "utf8")).toBe("mine, still uncommitted\n");
    const nb = task(root, "T01").not_built as { reason: string; discarded: string[] };
    expect(nb.discarded.sort()).toEqual(["lib/calendar/existing.ts", "lib/calendar/half.ts"]);
    expect(nb.reason).toMatch(/uncommitted work on the main checkout was discarded: .*half\.ts/);
  });
});
