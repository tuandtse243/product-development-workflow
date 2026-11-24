/**
 * T10 probes (plan D9, D10; ADR-0014): the edges of the upstream fix loop, of not-built propagation and of the
 * Agent-run cap that tests/fixloop.test.ts does not walk.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { agentRunStatus, countAgentRun } from "../src/agentruns.js";
import { run } from "../src/cli.js";
import { loadChange } from "../src/change.js";
import { decide, type HookInput } from "../src/gate.js";
import { pathsFor } from "../src/project.js";
import { QUALITY_YAML, tempProject, write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

const ID = "2026-11-08-booking";
const OK = `node -e "process.exit(0)"`;
const FAIL = `node -e "process.exit(3)"`;
const SCEN = "    specs: [booking/reschedule-appointment]\n    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]\n";

const task = (id: string, deps: string[], verify: string, extra = "") => `  - id: ${id}
    title: Task ${id}
    role: fullstack-engineer
    type: feat
    depends_on: [${deps.join(", ")}]
    touches: ["lib/${id.toLowerCase()}/**"]
    verify: ['${verify}']
${extra}    status: pending
`;

/** A fails (one attempt); B and C depend on A; D depends on B and C (a diamond); E is independent. */
const DIAMOND = `tasks:\n${task("A", [], FAIL, `    max_attempts: 1\n${SCEN}`)}${task("B", ["A"], OK)}${task("C", ["A"], OK)}${task("D", ["B", "C"], OK)}${task("E", [], OK)}`;

/** A fails (one attempt); B depends on A; C on B (a chain); E independent; R independent and may run three attempts. */
const CHAIN = `tasks:\n${task("A", [], FAIL, `    max_attempts: 1\n${SCEN}`)}${task("B", ["A"], OK)}${task("C", ["B"], OK)}${task("E", [], OK)}${task("R", [], OK)}`;

const GRANTS = (n: number) => `${QUALITY_YAML}grants:\n  agent_runs: ${n}\n`;

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
const tasksFile = (root: string) => join(root, ".aidw/changes", ID, "tasks.yaml");
const tasks = (root: string) => (YAML.parse(readFileSync(tasksFile(root), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const get = (root: string, id: string) => tasks(root).find((t) => t.id === id) as Record<string, unknown>;
const next = (root: string) => cli(root, "next", "--json").json();
const used = (root: string) => {
  const p = pathsFor(root);
  return agentRunStatus(p, loadChange(p, ID)).used;
};
function setTask(root: string, id: string, fields: Record<string, unknown>): void {
  const data = YAML.parse(readFileSync(tasksFile(root), "utf8")) as { tasks: Record<string, unknown>[] };
  Object.assign(data.tasks.find((t) => t.id === id) as object, fields);
  writeFileSync(tasksFile(root), YAML.stringify(data));
}

function failA(root: string): void {
  expect(cli(root, "task", "start", "A").code).toBe(0);
  expect(cli(root, "checkpoint", "A").code).toBe(1);
  expect(next(root)).toMatchObject({ action: "triage", task: "A" });
}
function triage(root: string, id: string, cause: string) {
  expect(cli(root, "brief", id, "--for", "triage").code).toBe(0);
  write(root, `.aidw/run/triage-${id}.md`, `CAUSE: ${cause}\nthe evidence says so.\n`);
  return cli(root, "triage", id);
}
function upstreamRound(root: string, id: string): void {
  expect(cli(root, "brief", id, "--for", "upstream").code).toBe(0);
  expect(cli(root, "upstream", id).code).toBe(0);
}

describe("not-built propagation (D9)", () => {
  it("marks a diamond's dependants once each, and the independent task still runs", () => {
    const root = executingProject({ tasks: DIAMOND });
    failA(root);
    const t = triage(root, "A", "environment");
    expect(t.code).toBe(0);
    for (const id of ["A", "B", "C", "D"]) expect(get(root, id).status).toBe("not_built");
    expect(get(root, "A").not_built).toMatchObject({ cause: "environment" });
    for (const id of ["B", "C"]) expect(get(root, id).not_built).toMatchObject({ cause: "dependency", reason: expect.stringMatching(/depends on A/) });
    expect(get(root, "D").not_built).toMatchObject({ cause: "dependency", reason: expect.stringMatching(/depends on [BC]/) });
    expect(get(root, "E").status).toBe("pending");
    expect(next(root)).toMatchObject({ action: "implement", task: "E" });
  });

  it("follows a chain to its end", () => {
    const root = executingProject({ tasks: CHAIN });
    failA(root);
    triage(root, "A", "environment");
    expect(get(root, "B").not_built).toMatchObject({ cause: "dependency", reason: expect.stringMatching(/depends on A/) });
    expect(get(root, "C").not_built).toMatchObject({ cause: "dependency", reason: expect.stringMatching(/depends on B/) });
    expect(get(root, "E").status).toBe("pending");
  });

  it("leaves a dependant that is already running alone: it finishes, and nothing escalates", () => {
    const root = executingProject({ tasks: CHAIN });
    failA(root);
    // B was started before A failed (as after a reopen of A): it is running when A becomes not built
    setTask(root, "B", { status: "running", attempts: 1, runs: 1 });
    triage(root, "A", "environment");
    expect(get(root, "A").status).toBe("not_built");
    expect(get(root, "B").status).toBe("running");
    expect(get(root, "C").status).toBe("pending");
    const n = next(root);
    expect(n.action).not.toBe("escalate");
    expect(n).toMatchObject({ action: "implement", task: "B" });
  });
});

describe("the upstream loop at its edges (D9)", () => {
  it("counts the rounds across causes: plan, spec, architecture, then a fourth upstream cause is not built", () => {
    const root = executingProject({ tasks: CHAIN, quality: GRANTS(60) });
    failA(root);
    for (const [round, cause] of (["plan", "spec", "architecture"] as const).entries()) {
      expect(triage(root, "A", cause).out).toMatch(new RegExp(`round ${round + 1} of 3`));
      upstreamRound(root, "A");
      expect(next(root)).toMatchObject({ action: "implement", task: "A", reason: "retry" });
      failA(root);
    }
    const last = triage(root, "A", "plan");
    expect(last.out).toMatch(/not built/);
    expect(get(root, "A")).toMatchObject({ status: "not_built", not_built: { cause: "triage" } });
    expect(get(root, "C").status).toBe("not_built");
  });

  it("an implementation cause after an upstream round: the extra attempt fails, the task is not built", () => {
    const root = executingProject({ tasks: CHAIN, quality: GRANTS(60) });
    failA(root);
    triage(root, "A", "spec");
    upstreamRound(root, "A");
    failA(root);
    expect(triage(root, "A", "implementation").out).toMatch(/One further attempt/);
    expect(cli(root, "task", "start", "A").code).toBe(0);
    expect(cli(root, "checkpoint", "A").code).toBe(1);
    const n = next(root);
    expect(n.action).not.toBe("escalate");
    expect(get(root, "A")).toMatchObject({ status: "not_built", not_built: { cause: "triage" } });
    expect(n).toMatchObject({ action: "implement", task: "E" });
  });

  it("refuses `aidw upstream` when no round is open", () => {
    const root = executingProject({ tasks: CHAIN });
    failA(root);
    expect(cli(root, "upstream", "A").err).toMatch(/no open upstream round/);
    triage(root, "A", "environment");
    expect(cli(root, "upstream", "A").err).toMatch(/no open upstream round/);
  });
});

describe("Agent runs: the count (D10)", () => {
  it("does not count a resumed task start again", () => {
    const root = executingProject({ tasks: CHAIN });
    expect(cli(root, "task", "start", "E").code).toBe(0);
    expect(cli(root, "task", "start", "E").code).toBe(0); // resumed: the same run
    expect(used(root)).toBe(1);
  });

  it("counts nothing before approval", () => {
    const root = tempProject();
    expect(cli(root, "init").code).toBe(0);
    expect(cli(root, "change", "new", ID, "--title", "Booking").code).toBe(0);
    const change = loadChange(pathsFor(root), ID);
    expect(countAgentRun(change, "consulted", "C01")).toBe(false);
    expect(used(root)).toBe(0);
  });
});

describe("Agent runs: the cap (D10)", () => {
  it("a failed task waiting for Triage at the cap gets no triage: it and its dependants are not built", () => {
    const root = executingProject({ tasks: CHAIN, quality: GRANTS(1) });
    expect(cli(root, "task", "start", "A").code).toBe(0); // run 1: the cap
    expect(cli(root, "checkpoint", "A").code).toBe(1);
    const n = next(root);
    expect(n.action).not.toBe("triage");
    expect(n).toMatchObject({ action: "complete", done: 0 });
    expect(get(root, "A").not_built).toMatchObject({ cause: "cap" });
    expect(get(root, "B").status).toBe("not_built");
    expect(get(root, "E").not_built).toMatchObject({ cause: "cap" });
  });

  it("an open upstream round at the cap is not built, and its brief is refused", () => {
    const root = executingProject({ tasks: CHAIN, quality: GRANTS(3) });
    failA(root); // 1
    triage(root, "A", "plan"); // 2
    expect(get(root, "A").upstream).toMatchObject({ phase: "open" });
    expect(cli(root, "task", "start", "E").code).toBe(0); // 3: the cap
    expect(cli(root, "checkpoint", "E").code).toBe(0); // its reviewer: running work finishes
    expect(next(root)).toMatchObject({ action: "review", task: "E" });
    expect(get(root, "A")).toMatchObject({ status: "not_built", not_built: { cause: "cap" } });
    expect(cli(root, "brief", "A", "--for", "upstream").code).not.toBe(0);
  });

  it("reached with two tasks running: both finish, nothing new starts, the Change moves on", () => {
    const root = executingProject({ tasks: CHAIN, quality: GRANTS(2) });
    expect(cli(root, "task", "start", "E").code).toBe(0); // 1
    expect(cli(root, "task", "start", "R").code).toBe(0); // 2: the cap
    expect(cli(root, "checkpoint", "E").code).toBe(0);
    expect(cli(root, "review", "E", "pass").code).toBe(0);
    // R is still running: it is resumed, not cut off and not marked not built
    expect(get(root, "R").status).toBe("running");
    expect(next(root)).toMatchObject({ action: "implement", task: "R" });
    // the orchestrator resumes it (a new session): allowed at the cap, and not counted again
    expect(cli(root, "task", "start", "R").code).toBe(0);
    expect(used(root)).toBe(3); // E, R and E's reviewer
    expect(cli(root, "checkpoint", "R").code).toBe(0);
    expect(cli(root, "review", "R", "pass").code).toBe(0);
    expect(next(root)).toMatchObject({ action: "complete", done: 2, not_built: ["A", "B", "C"] });
    expect(String(loadChange(pathsFor(root), ID).data.state)).toBe("executing");
    expect(cli(root, "transition", ID, "verifying").code).toBe(0);
  });

  it("a review fix at the cap does not start a new attempt: the task is not built", () => {
    const root = executingProject({ tasks: CHAIN, quality: GRANTS(2) });
    expect(cli(root, "task", "start", "R").code).toBe(0);
    expect(cli(root, "checkpoint", "R").code).toBe(0); // reviewer: the cap
    expect(cli(root, "review", "R", "fix", "--notes", "1. wrong").code).toBe(0);
    expect(next(root)).toMatchObject({ action: "complete", done: 0 });
    expect(get(root, "R").not_built).toMatchObject({ cause: "cap" });
  });
});

describe("the gate keeps the count out of the Agents' hands (D10)", () => {
  const env = {} as NodeJS.ProcessEnv;
  const hook = (root: string, file: string, agent_type: string): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: join(root, ".aidw/changes", ID, "evidence/agent-runs.json") },
    cwd: root,
    agent_type,
  });

  it.each(["aidw:fullstack", "aidw:code-reviewer"])(
    "denies %s writing evidence/agent-runs.json during the build",
    (who) => {
      const root = executingProject({ tasks: CHAIN });
      expect(decide(hook(root, "", who), env)?.decision).toBe("deny");
    },
  );
});
