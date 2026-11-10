import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { unexpectedChanges } from "../src/backstop.js";
import { decide, type HookInput } from "../src/gate.js";
import { stagedJunk } from "../src/git.js";
import { parseVerdict } from "../src/run.js";
import { tempProject, write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

const ID = "2026-11-08-booking";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
const TEST = `import { test } from "vitest";\ntest("${SCENARIO}: moves the appointment", () => {});\n`;

function cli(root: string, env: NodeJS.ProcessEnv, ...argv: string[]) {
  if (argv[0] === "checkpoint" && argv[1]) write(root, `.aidw/run/shots/${ID}/${argv[1]}/page.png`, "png");
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], env, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

describe("parseVerdict", () => {
  it("reads the verdict from the first non-empty line only", () => {
    expect(parseVerdict("VERDICT: pass\nNon-blocking:\n- x")).toBe("pass");
    expect(parseVerdict("\n\n**VERDICT: fix**\n1. a.ts: bad")).toBe("fix");
    expect(parseVerdict("verdict: PASS")).toBe("pass");
    expect(parseVerdict("Looks fine.\nVERDICT: pass")).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });
});

describe("fewer orchestrator turns", () => {
  it("task start prints the brief and the implementer prompt; checkpoint prints the reviewer prompt; verdict reads the file", () => {
    const root = executingProject();
    const start = cli(root, {}, "task", "start", "T01");
    expect(start.out).toMatch(/brief .*T01\.implement\.md/);
    expect(start.out).toMatch(/SPAWN aidw:implementer with: Task brief: .*T01\.implement\.md\. Read it and implement the task\./);

    write(root, "tests/a.test.ts", TEST);
    const cp = cli(root, {}, "checkpoint", "T01");
    expect(cp.out).toMatch(/SPAWN aidw:reviewer with: Review brief: .*T01\.review\.md/);
    expect(cp.out).toMatch(/Then: aidw verdict T01/);
    const brief = readFileSync(join(root, ".aidw/run/briefs", ID, "T01.review.md"), "utf8");
    expect(brief).toMatch(/Write the whole verdict to `.*\.aidw\/run\/review-T01\.md`/);

    expect(cli(root, {}, "verdict", "T01").err).toMatch(/no verdict file/);
    write(root, ".aidw/run/review-T01.md", "Fine.\nVERDICT: pass\n");
    expect(cli(root, {}, "verdict", "T01").err).toMatch(/does not start with "VERDICT/);
    write(root, ".aidw/run/review-T01.md", "VERDICT: pass\nNon-blocking:\n- rename later\n");
    const v = cli(root, {}, "verdict", "T01");
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/T01: review pass -> done/);
    expect(v.out).toMatch(/NEXT: implement T02/);
    expect(v.out).not.toMatch(/END THIS SESSION/); // interactive run: no session boundary
  });

  it("under aidw run a finished task ends the session, so the next one starts fresh", () => {
    const root = executingProject();
    cli(root, {}, "task", "start", "T01");
    write(root, "tests/a.test.ts", TEST);
    cli(root, {}, "checkpoint", "T01");
    write(root, ".aidw/run/review-T01.md", "VERDICT: pass\n");
    expect(cli(root, { AIDW_RUNNER: "1" }, "verdict", "T01").out).toMatch(/END THIS SESSION/);
  });

  it("a fix verdict keeps the session going (the retry needs it)", () => {
    const root = executingProject();
    cli(root, {}, "task", "start", "T01");
    write(root, "tests/a.test.ts", TEST);
    cli(root, {}, "checkpoint", "T01");
    write(root, ".aidw/run/review-T01.md", "VERDICT: fix\n1. a.ts: wrong -> right\n");
    const v = cli(root, { AIDW_RUNNER: "1" }, "verdict", "T01");
    expect(v.out).toMatch(/T01: review fix -> failed/);
    expect(v.out).toMatch(/NEXT: implement T01 \(retry\)/);
    expect(v.out).not.toMatch(/END THIS SESSION/);
  });
});

describe("a converge task that only adds tests skips the reviewer subagent", () => {
  const g = (root: string, ...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });

  function convergeTask(root: string, extra: Record<string, unknown> = {}) {
    const file = join(root, ".aidw/changes", ID, "tasks.yaml");
    const doc = YAML.parse(readFileSync(file, "utf8")) as { tasks: Record<string, unknown>[] };
    doc.tasks = [
      { ...(doc.tasks[0] as object), status: "done" },
      { ...(doc.tasks[1] as object), status: "done" },
      { id: "C01", title: "Cover scenario", role: "fullstack-engineer", origin: "converge", scenarios: [SCENARIO], depends_on: [], touches: ["**"], verify: ['node -e "process.exit(0)"'], status: "pending", ...extra },
    ];
    write(root, `.aidw/changes/${ID}/tasks.yaml`, YAML.stringify(doc));
  }

  it("passes the review itself when every changed file is a test", () => {
    const root = executingProject({ git: true });
    convergeTask(root);
    g(root, "add", "-A");
    g(root, "commit", "-q", "-m", "tasks");
    cli(root, {}, "task", "start", "C01");
    write(root, "tests/a.test.ts", TEST);
    const cp = cli(root, {}, "checkpoint", "C01");
    expect(cp.out).toMatch(/review C01: auto-passed/);
    expect(cp.out).not.toMatch(/SPAWN aidw:reviewer/);
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: root, encoding: "utf8" }).trim()).toMatch(/^C01:/);
  });

  it("still goes to a reviewer when it touched product code", () => {
    const root = executingProject({ git: true });
    convergeTask(root);
    g(root, "add", "-A");
    g(root, "commit", "-q", "-m", "tasks");
    cli(root, {}, "task", "start", "C01");
    write(root, "tests/a.test.ts", TEST);
    write(root, "lib/booking.ts", "export const x = 1;\n");
    const cp = cli(root, {}, "checkpoint", "C01");
    expect(cp.out).toMatch(/SPAWN aidw:reviewer/);
    expect(cp.out).not.toMatch(/auto-passed/);
  });
});

describe("reviewer writes only its verdict file", () => {
  const hook = (root: string, file: string, agent_type: string): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: file },
    cwd: root,
    agent_type,
  });

  it("allows .aidw/run/review-*.md and layer-review-*.md, denies everything else", () => {
    const root = executingProject();
    const d = (file: string, agent = "aidw:reviewer") => decide(hook(root, file, agent), {} as NodeJS.ProcessEnv)?.decision;
    expect(d(join(root, ".aidw/run/review-T01.md"))).toBe("allow");
    expect(d(join(root, ".aidw/run/layer-review-ui-ux.md"), "aidw:ui-reviewer")).toBe("allow");
    expect(d(join(root, ".aidw/run/review-T01.txt"))).toBe("deny");
    expect(d(join(root, ".aidw/changes", ID, "tasks.yaml"))).toBe("deny");
    expect(d(join(root, "lib/a.ts"))).toBe("deny");
    expect(d(join(root, ".aidw/run/briefs", ID, "review-T01.md"))).toBe("deny");
  });
});

describe("generated files never get committed", () => {
  it("stagedJunk flags tsbuildinfo, next-env.d.ts, .env, coverage; not .env.example", () => {
    const root = tempProject();
    const g = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
    g("init", "-q");
    for (const f of ["tsconfig.tsbuildinfo", "next-env.d.ts", ".env", ".env.production", "coverage/lcov.info", "src/a.ts", ".env.example", "docs/next-env.d.ts.md"]) write(root, f, "x\n");
    g("add", "-A");
    expect(stagedJunk(root).sort()).toEqual([".env", ".env.production", "coverage/lcov.info", "next-env.d.ts", "tsconfig.tsbuildinfo"]);
  });
});

describe("false alarms seen in trial-3b", () => {
  const env = {} as NodeJS.ProcessEnv;
  const bash = (root: string, command: string) =>
    decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root }, env)?.decision ?? "none";

  it("a secret scan that greps for sk_live_ is not a use of live payment credentials", () => {
    const root = executingProject();
    expect(bash(root, `git grep -nE 'sk_live_[0-9a-zA-Z]{24}' -- . ; pnpm audit`)).not.toBe("ask");
    expect(bash(root, "curl -H 'Authorization: Bearer sk_live_51Habcdefghijklmnop' https://api.stripe.com/v1/charges")).toBe("ask");
    expect(bash(root, "stripe charges create --live")).toBe("ask");
  });

  it("the backstop ignores files tools generate (tsc state, Next shim) but not a stray source file", () => {
    expect(unexpectedChanges(["tsconfig.tsbuildinfo", "next-env.d.ts", ".next/types/a.ts", "src/a.ts", ".env"], [])).toEqual([".env", "src/a.ts"]);
  });
});
