import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildRoute, RUNNER_THRESHOLD } from "../src/buildroute.js";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

// Plan D2: after the Approval Gate the CLI says where the Change is built. More than 3 tasks start the detached
// runner; 3 or fewer are built in the session.

const ID = "app";
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

function tasks(n: number): string {
  const rows = [
    `  - id: T01
    title: Booking API
    role: backend-engineer
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]
    depends_on: []
    touches: ["app/api/bookings/**"]
    verify: ["pnpm vitest run lib/booking"]
    status: pending`,
  ];
  for (let i = 2; i <= n; i++) {
    const id = `T0${i}`;
    rows.push(`  - id: ${id}
    title: Page ${i}
    role: backend-engineer
    type: feat
    depends_on: [T01]
    touches: ["app/page${i}/**"]
    verify: ["pnpm vitest run page${i}"]
    status: pending`);
  }
  return `tasks:\n${rows.join("\n")}\n`;
}

function awaitingApproval(n: number) {
  root = tempProject();
  expect(cli("init").code).toBe(0);
  expect(cli("change", "new", ID).code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, tasks(n));
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s).code).toBe(0);
}

describe("build route after approval (D2)", () => {
  it("builds 3 tasks in the session and starts the runner for 4", () => {
    expect(RUNNER_THRESHOLD).toBe(3);
    expect(buildRoute(ID, 3)).toMatchObject({ mode: "session" });
    expect(buildRoute(ID, 4)).toMatchObject({ mode: "runner", command: `aidw run ${ID} --detach --permission-mode auto` });
  });

  it("aidw approve prints NEXT: build here for 3 tasks", () => {
    awaitingApproval(3);
    const r = cli("approve", ID);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^NEXT: build here: follow the \/aidw:run steps for app \(3 tasks, 3 or fewer\)$/m);
    expect(r.out).not.toMatch(/start the runner/);
  });

  it("aidw approve prints NEXT: start the runner with the exact command for 4 tasks", () => {
    awaitingApproval(4);
    const r = cli("approve", ID);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^NEXT: start the runner: \S*aidw run app --detach --permission-mode auto \(4 tasks/m);
    expect(r.out).not.toMatch(/build here/);
  });

  it("aidw approve --json carries the route", () => {
    awaitingApproval(4);
    const r = cli("approve", ID, "--json");
    expect(JSON.parse(r.out).route).toMatchObject({ mode: "runner", tasks: 4 });
  });
});

describe("gate: the main session starts the detached runner after approval", () => {
  const hook = (command: string, agent_type?: string): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    cwd: root,
    ...(agent_type ? { agent_type } : {}),
  });
  const env = {} as NodeJS.ProcessEnv;
  const decision = (command: string, agent_type?: string, e: NodeJS.ProcessEnv = env) => decide(hook(command, agent_type), e)?.decision ?? "none";
  const START = `aidw run ${ID} --detach --permission-mode auto`;

  beforeEach(() => awaitingApproval(4));

  it("denies the runner before approval", () => {
    expect(decision(START)).toBe("deny");
  });

  describe("after approval", () => {
    beforeEach(() => {
      expect(cli("approve", ID).code).toBe(0);
    });

    it("allows the detached runner from the main session, by name or by path", () => {
      expect(decision(START)).toBe("allow");
      expect(decision(`/opt/plugin/bin/aidw run ${ID} --detach --permission-mode auto -- --plugin-dir /opt/plugin`)).toBe("allow");
      expect(decision(`aidw run --detach`)).toBe("allow");
    });

    it("still denies a foreground runner, a subagent, and a session under the runner", () => {
      expect(decision(`aidw run ${ID} --permission-mode auto`)).toBe("deny");
      expect(decision(START, "aidw:fullstack")).toBe("deny");
      expect(decision(START, "general-purpose")).toBe("deny");
      expect(decision(START, undefined, { AIDW_RUNNER: "1" } as NodeJS.ProcessEnv)).toBe("deny");
    });

    it("asks for a runner with another binary, permission mode or claude arguments, or chained", () => {
      for (const c of [
        `aidw run ${ID} --detach --claude /tmp/x`,
        `aidw run ${ID} --detach --permission-mode bypassPermissions`,
        `aidw run ${ID} --detach -- --dangerously-skip-permissions`,
        `${START} && echo started`,
      ]) {
        expect([c, decision(c)]).toEqual([c, "ask"]);
      }
    });

    it("leaves --status and --stop alone", () => {
      expect(decision("aidw run --status")).toBe("none");
    });
  });
});

describe("skills: /aidw:start carries on through approval into the build", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "plugins", "aidw", "skills", p, "SKILL.md"), "utf8");

  it("start approves after the gate page and follows the route, reading approve and run by path", () => {
    const start = read("start");
    expect(start).toMatch(/## 10\. Approve and build \(same session\)/);
    expect(start).toContain("aidw plugin-path skills/approve/SKILL.md");
    expect(start).toContain("aidw plugin-path skills/run/SKILL.md");
    expect(start).toMatch(/NEXT: build here[\s\S]*NEXT: start the runner/);
    expect(start).not.toMatch(/Never run `aidw approve`/);
  });

  it("approve still works standalone and starts the runner with the sandbox disabled", () => {
    const approve = read("approve");
    expect(approve).toMatch(/disable-model-invocation: true/);
    expect(approve).toMatch(/NEXT: start the runner[\s\S]*dangerouslyDisableSandbox: true/);
    expect(approve).toContain("aidw plugin-path skills/run/SKILL.md");
  });

  it("run stays an entry point and no longer says the gate denies the detached runner", () => {
    const runSkill = read("run");
    expect(runSkill).toMatch(/## 0\. Enter execution/);
    expect(runSkill).toMatch(/aidw run <id> --detach --permission-mode auto/);
    expect(runSkill).not.toMatch(/never run it yourself; the gate denies it/);
  });
});
