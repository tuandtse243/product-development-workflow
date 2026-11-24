import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide } from "../src/gate.js";
import { parseTriage } from "../src/run.js";
import { write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

const ID = "2026-11-08-booking";
const FAIL = `node -e "console.log(process.argv[1]); process.exit(3)" expected-2-slots-got-1`;

function cli(root: string, ...argv: string[]) {
  // UI tasks need a fresh screenshot at checkpoint (design compliance); these flow tests always provide one.
  if (argv[0] === "checkpoint" && argv[1]) write(root, `.aidw/run/shots/${ID}/${argv[1]}/page.png`, "png");
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
const task = (root: string, id: string) =>
  (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks.find((t) => t.id === id) as Record<string, unknown>;

/** T01 done, T02 (max 2 attempts) failed twice: out of attempts. */
function exhausted(): string {
  const root = executingProject({ t2Verify: FAIL });
  write(root, "tests/booking.test.ts", `import { test } from "vitest";\ntest("booking/reschedule-appointment/reschedule-appointment-works: x", () => {});\n`);
  cli(root, "task", "start", "T01");
  cli(root, "checkpoint", "T01");
  cli(root, "review", "T01", "pass");
  for (let i = 0; i < 2; i++) {
    cli(root, "task", "start", "T02");
    cli(root, "checkpoint", "T02");
  }
  return root;
}
const answer = (root: string, text: string) => write(root, ".aidw/run/triage-T02.md", text);

describe("triage of a task that ran out of attempts", () => {
  it("is asked for instead of an escalation, with a brief that carries the evidence", () => {
    const root = exhausted();
    const next = cli(root, "next", "--json").json();
    expect(next).toMatchObject({ action: "triage", task: "T02" });
    const b = cli(root, "brief", "T02", "--for", "triage");
    expect(b.out).toMatch(/SPAWN aidw:software-architect with: Triage brief: /);
    const text = readFileSync(b.out.split("\n")[0]!, "utf8");
    expect(text).toMatch(/2 of 2 attempts used/);
    expect(text).toMatch(/expected-2-slots-got-1/);
    expect(text).toMatch(/CAUSE: <one of implementation, environment, plan, spec, architecture>/);
  });

  it("removes an answer left by an earlier change when it makes the brief, so it cannot pass for this diagnosis", () => {
    const root = exhausted();
    answer(root, "CAUSE: environment\nLeft by an earlier change whose task also had the id T02.\n");
    expect(cli(root, "brief", "T02", "--for", "triage").code).toBe(0);
    expect(existsSync(join(root, ".aidw/run/triage-T02.md"))).toBe(false);
    const r = cli(root, "triage", "T02", "--json"); // the Agent wrote nothing this time
    expect(r.code).not.toBe(0);
    expect(task(root, "T02")).not.toHaveProperty("triage");
  });

  it("implementation: grants one further attempt with the diagnosis in the brief; if that fails too the task is not built", () => {
    const root = exhausted();
    answer(root, "CAUSE: implementation\nThe handler in app/api/bookings/route.ts returns before it frees the slot.\n");
    const r = cli(root, "triage", "T02", "--json").json();
    expect(r).toMatchObject({ cause: "implementation", outcome: "retry" });
    expect(task(root, "T02")).toMatchObject({ status: "failed", triage: { cause: "implementation" } });
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T02", reason: "retry" });
    cli(root, "task", "start", "T02");
    expect(readFileSync(cli(root, "brief", "T02").out.trim(), "utf8")).toMatch(/independent architect diagnosed[\s\S]*before it frees the slot/);
    cli(root, "checkpoint", "T02");
    // the extra attempt failed: no second triage and nobody asked after the gate (ADR-0014): not built, the rest carries on
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "complete", not_built: ["T02"] });
    expect(task(root, "T02")).toMatchObject({ status: "not_built" });
  });

  it.each([
    ["plan", "technical-planner"],
    ["spec", "business-analyst"],
    ["architecture", "software-architect"],
  ])("%s: goes back to the Role that wrote it (%s), not to the user", (cause, role) => {
    const root = exhausted();
    answer(root, `CAUSE: ${cause}\nthe evidence says so.\n`);
    const r = cli(root, "triage", "T02");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`the ${cause}, so it goes back to the ${role}, who wrote it: upstream round 1 of 3`));
    expect(task(root, "T02").status).toBe("failed");
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "upstream", task: "T02", cause, role, round: 1 });
  });

  it("environment: not built at once, with what the user must fix to finish it", () => {
    const root = exhausted();
    answer(root, "CAUSE: environment\nThe test database is not running on port 5432.\n");
    const r = cli(root, "triage", "T02");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/the environment, which nothing inside the factory fixes, so it is not built[\s\S]*port 5432/);
    expect(task(root, "T02")).toMatchObject({ status: "not_built" });
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "complete", not_built: ["T02"] });
  });

  it("is done once per task, and only for a task that ran out of attempts", () => {
    const root = exhausted();
    answer(root, "CAUSE: implementation\nfix it.\n");
    expect(cli(root, "triage", "T02").code).toBe(0);
    cli(root, "task", "start", "T02");
    cli(root, "checkpoint", "T02");
    expect(cli(root, "triage", "T02").err).toMatch(/already triaged/);
    write(root, ".aidw/run/triage-T01.md", "CAUSE: spec\nx\n");
    expect(cli(root, "triage", "T01").err).toMatch(/triage is for a failed task that ran out of attempts/);
    expect(cli(root, "brief", "T01", "--for", "triage").err).toMatch(/triage is for a failed task/);
  });

  it("rejects an answer without a CAUSE line, and a missing file", () => {
    const root = exhausted();
    expect(cli(root, "triage", "T02").err).toMatch(/no triage answer/);
    answer(root, "It is probably the code.\n");
    expect(cli(root, "triage", "T02").err).toMatch(/must start with "CAUSE:/);
    answer(root, "CAUSE: network\nx\n");
    expect(cli(root, "triage", "T02").err).toMatch(/must start with "CAUSE:/);
    expect(task(root, "T02").status).toBe("failed");
  });

  it("parses the first line and keeps the rest as the diagnosis", () => {
    expect(parseTriage("CAUSE: spec\nline one\nline two\n")).toEqual({ cause: "spec", diagnosis: "line one\nline two" });
    expect(parseTriage("cause: spec")).toBeNull();
    expect(parseTriage("x\nCAUSE: spec")).toBeNull();
  });
});

describe("what the triage Agent may write", () => {
  it("only its answer: not the approved package and not project files", () => {
    const root = exhausted();
    const ask = (file: string) => decide({ tool_name: "Write", tool_input: { file_path: join(root, file) }, cwd: root, agent_type: "aidw:software-architect" }, {});
    expect(ask(".aidw/run/triage-T02.md")?.decision).toBe("allow");
    expect(ask(`.aidw/changes/${ID}/analysis.md`)?.decision).toBe("deny");
    expect(ask("app/api/bookings/route.ts")?.decision).toBe("deny");
  });
});
