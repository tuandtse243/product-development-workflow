import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { unexpectedChanges, runBackstop } from "../src/backstop.js";
import { addBinToPath, run } from "../src/cli.js";
import { AIDW_COMMAND, AIDW_STATE_COMMAND, APPROVE_COMMAND } from "../src/policy.js";
import { decide, runGate, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, TOKENS_YAML, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, tempProject, write } from "./fixtures.js";

const ID = "app";
let root: string;

function cli(...argv: string[]) {
  return run([...argv, "--root", root], {}, root, { out: () => {}, err: () => {} });
}

const env = {} as NodeJS.ProcessEnv;
const hook = (tool_name: string, tool_input: Record<string, unknown>, cwd = root): HookInput => ({
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input,
  cwd,
});
const decision = (h: HookInput) => decide(h, env)?.decision ?? "none";

function readyForApproval() {
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s)).toBe(0);
}

beforeEach(() => {
  root = tempProject();
  cli("init");
  cli("change", "new", ID);
});

describe("gate before approval (exit criterion [2])", () => {
  it("denies project writes and allows .aidw/ writes", () => {
    expect(decision(hook("Write", { file_path: join(root, "src/a.ts") }))).toBe("deny");
    expect(decision(hook("Edit", { file_path: "package.json" }))).toBe("deny");
    expect(decision(hook("Write", { file_path: join(root, ".aidw/changes/app/analysis.md") }))).toBe("allow");
    expect(decide(hook("Write", { file_path: "src/a.ts" }), env)?.reason).toMatch(/not approved yet \(app=draft\)/);
  });

  it("denies writing shell commands but lets read-only ones and aidw through", () => {
    for (const c of ["echo x > src/a.ts", "mkdir -p src", "npm install", "pnpm add zod", "npx create-next-app .", "cat a | tee b", "sed -i s/a/b/ f"]) {
      expect([c, decision(hook("Bash", { command: c }))]).toEqual([c, "deny"]);
    }
    for (const c of ["ls -la", "grep -rn install README.md", "cat package.json 2>/dev/null", "git status", "node -e 'x => 1'", "aidw status", "aidw change new other"]) {
      expect([c, decision(hook("Bash", { command: c }))]).toEqual([c, "none"]);
    }
  });

  it("ignores writes outside the project and projects without .aidw/", () => {
    expect(decision(hook("Write", { file_path: "/tmp/notes.md" }))).toBe("none");
    const plain = tempProject();
    expect(decide(hook("Write", { file_path: join(plain, "x.ts") }, plain), env)).toBeNull();
    expect(runGate(JSON.stringify(hook("Bash", { command: "rm -rf build" }, plain)), env)).toBe("");
  });
});

describe("gate after approval", () => {
  beforeEach(() => {
    readyForApproval();
    expect(cli("approve", ID)).toBe(0);
    expect(cli("transition", ID, "executing")).toBe(0);
  });

  it("allows project writes and shell writes", () => {
    expect(decision(hook("Write", { file_path: "src/a.ts" }))).toBe("allow");
    expect(decision(hook("Bash", { command: "pnpm add zod" }))).toBe("none");
  });

  it("freezes the approved package but lets tasks.yaml and run state change", () => {
    expect(decision(hook("Edit", { file_path: `.aidw/changes/${ID}/analysis.md` }))).toBe("deny");
    expect(decision(hook("Write", { file_path: `.aidw/changes/${ID}/specs/booking/spec.md` }))).toBe("deny");
    expect(decision(hook("Edit", { file_path: ".aidw/constitution.md" }))).toBe("deny");
    for (const f of [".aidw/domain/model.md", ".aidw/architecture/overview.md", ".aidw/requirements/app.md", ".aidw/design/direction.md"]) {
      expect([f, decision(hook("Write", { file_path: f }))]).toEqual([f, "deny"]);
    }
    expect(decision(hook("Write", { file_path: ".aidw/decisions/0002-impl-detail.md" }))).toBe("allow");
    expect(decision(hook("Edit", { file_path: `.aidw/changes/${ID}/tasks.yaml` }))).toBe("allow");
    expect(decision(hook("Write", { file_path: ".aidw/run/progress.json" }))).toBe("allow");
  });

  it("closes again on drift (exit criterion [3])", () => {
    write(root, `.aidw/changes/${ID}/analysis.md`, `${ANALYSIS_MD}\nScope quietly widened.\n`);
    const d = decide(hook("Write", { file_path: "src/a.ts" }), env);
    expect(d?.decision).toBe("deny");
    expect(d?.reason).toMatch(/approval drift in app/);
  });

  it("unfreezes the package while escalated", () => {
    expect(cli("transition", ID, "escalated")).toBe(0);
    expect(decision(hook("Edit", { file_path: `.aidw/changes/${ID}/analysis.md` }))).toBe("allow");
    expect(decision(hook("Write", { file_path: "src/a.ts" }))).toBe("deny");
  });
});

describe("tiers", () => {
  it("asks before outward-facing or costly commands and before approving", () => {
    for (const c of [
      "git push origin main",
      "vercel --prod",
      "npx vercel deploy",
      "vercel",
      "supabase db push",
      "npm publish",
      "gh pr merge 3",
      "aidw approve app",
      "/x/plugins/aidw/bin/aidw approve app",
    ]) {
      expect([c, decision(hook("Bash", { command: c }))]).toEqual([c, "ask"]);
    }
    for (const c of ["vercel env ls", "pnpm add vercel", "git status && git log"]) {
      expect([c, decision(hook("Bash", { command: c }))]).not.toEqual([c, "ask"]);
    }
  });

  it("denies personal credentials and destructive commands (tier x)", () => {
    expect(decision(hook("Read", { file_path: "/Users/me/.ssh/id_ed25519" }))).toBe("deny");
    expect(decision(hook("Read", { file_path: "/Users/me/.aws/credentials" }))).toBe("deny");
    expect(decision(hook("Read", { file_path: join(root, "README.md") }))).toBe("none");
    expect(decision(hook("Bash", { command: "cat ~/.ssh/id_rsa" }))).toBe("deny");
    expect(decision(hook("Bash", { command: "security find-generic-password -s x" }))).toBe("deny");
    expect(decision(hook("Bash", { command: "rm -rf ~" }))).toBe("deny");
  });

  it("gates MCP tools: read-like names pass, others are denied before approval and asked after", () => {
    const sub = (h: HookInput) => ({ ...h, agent_type: "aidw:implementer" });
    for (const t of ["mcp__vercel__list_deployments", "mcp__github__get_file", "mcp__figma__whoami", "mcp__x__search_docs"]) {
      expect([t, decision(hook(t, {}))]).toEqual([t, "none"]);
    }
    expect(decision(hook("mcp__vercel__deploy_to_vercel", {}))).toBe("deny");
    readyForApproval();
    expect(cli("approve", ID)).toBe(0);
    expect(cli("transition", ID, "executing")).toBe(0);
    expect(decision(hook("mcp__vercel__deploy_to_vercel", {}))).toBe("ask");
    expect(decision(hook("mcp__github__create_pull_request", {}))).toBe("ask");
    expect(decision(sub(hook("mcp__supabase__apply_migration", {})))).toBe("deny");
    expect(decision(sub(hook("mcp__supabase__list_tables", {})))).toBe("none");
  });

  it("lets an implementer write only a report-<task>.md note under .aidw/", () => {
    readyForApproval();
    expect(cli("approve", ID)).toBe(0);
    expect(cli("transition", ID, "executing")).toBe(0);
    const sub = (f: string) => ({ ...hook("Write", { file_path: join(root, f) }), agent_type: "aidw:implementer" });
    expect(decision(sub(".aidw/run/report-T01.md"))).toBe("allow");
    expect(decision(sub(".aidw/run/progress.json"))).toBe("deny");
    expect(decision(sub(".aidw/changes/app/tasks.yaml"))).toBe("deny");
    expect(decision({ ...sub(".aidw/run/report-T01.md"), agent_type: "aidw:reviewer" })).toBe("deny");
  });

  it("tells a session where the run stands after a compaction, and only then", () => {
    readyForApproval();
    expect(cli("approve", ID)).toBe(0);
    expect(cli("transition", ID, "executing")).toBe(0);
    const hookOut = (source: string) => {
      let out = "";
      run(["session-start"], {}, root, { out: (s) => (out += s), err: () => {}, stdin: () => JSON.stringify({ hook_event_name: "SessionStart", source, cwd: root }) });
      return out;
    };
    expect(hookOut("compact")).toMatch(/context was compacted\): app=executing\. Next: implement T01/);
    expect(hookOut("startup")).toBe("");
  });

  it("the hook matcher covers MCP tools", () => {
    const hooks = JSON.parse(readFileSync(join(__dirname, "../plugins/aidw/hooks/hooks.json"), "utf8"));
    expect(new RegExp(`^(?:${hooks.hooks.PreToolUse[0].matcher})$`).test("mcp__vercel__deploy_to_vercel")).toBe(true);
  });

  it("emits the PreToolUse wire format", () => {
    const out = JSON.parse(runGate(JSON.stringify(hook("Write", { file_path: "src/a.ts" })), env));
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
  });
});

describe("backstop", () => {
  it("only reports changes outside .aidw/ that are not in the baseline", () => {
    expect(unexpectedChanges(["src/a.ts", ".aidw/run/x", "notes.md"], ["notes.md"])).toEqual(["src/a.ts"]);
  });

  it("blocks the stop once, then only warns", () => {
    const dirty = () => ["src/d.txt"];
    const first = JSON.parse(runBackstop(JSON.stringify({ cwd: root }), env, dirty));
    expect(first.decision).toBe("block");
    expect(first.reason).toMatch(/src\/d\.txt/);
    expect(first.reason).toMatch(/Do not delete or revert/);
    const again = JSON.parse(runBackstop(JSON.stringify({ cwd: root, stop_hook_active: true }), env, dirty));
    expect(again.decision).toBeUndefined();
    expect(again.systemMessage).toMatch(/src\/d\.txt/);
  });

  it("stays silent when the gate is open, nothing changed, or there is no project", () => {
    expect(runBackstop(JSON.stringify({ cwd: root }), env, () => [".aidw/changes/app/analysis.md"])).toBe("");
    const plain = tempProject();
    mkdirSync(join(plain, "src"));
    expect(runBackstop(JSON.stringify({ cwd: plain }), env, () => ["src/x"])).toBe("");
    readyForApproval();
    cli("approve", ID);
    expect(runBackstop(JSON.stringify({ cwd: root }), env, () => ["src/x"])).toBe("");
  });
});

describe("AIDW_HOOK_LOG", () => {
  it("appends each hook call with its input and output, and stays silent without the variable", () => {
    const log = join(root, "hooks.jsonl");
    const input = JSON.stringify({ ...hook("Write", { file_path: join(root, "src/a.ts"), content: "x" }), agent_type: "aidw:implementer" });
    const io = { out: () => {}, err: () => {}, stdin: () => input };
    expect(run(["gate"], { AIDW_HOOK_LOG: log }, root, io)).toBe(0);
    expect(run(["stop-failure"], { AIDW_HOOK_LOG: log }, root, io)).toBe(0);
    expect(run(["gate"], {}, root, io)).toBe(0);
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.hook)).toEqual(["gate", "stop-failure"]);
    expect(lines[0].input.agent_type).toBe("aidw:implementer");
    expect(lines[0].output).toContain("deny");
  });
});

describe("plugin bin on PATH", () => {
  it("appends the bin dir to CLAUDE_ENV_FILE once, after the existing PATH", () => {
    const file = join(root, "env.sh");
    const env = { CLAUDE_ENV_FILE: file, AIDW_PLUGIN_ROOT: "/opt/aidw" } as NodeJS.ProcessEnv;
    expect(addBinToPath(env)).toBe(true);
    expect(addBinToPath(env)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(`export PATH="$PATH":'/opt/aidw/bin'\n`);
    expect(addBinToPath({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("treats a quoted absolute path to the CLI like the bare name", () => {
    const bin = '"/Users/x/.claude/plugins/aidw/bin/aidw"';
    expect(AIDW_COMMAND.test(`${bin} status`)).toBe(true);
    expect(APPROVE_COMMAND.test(`${bin} approve app`)).toBe(true);
    expect(AIDW_STATE_COMMAND.test(`${bin} transition app executing`)).toBe(true);
    expect(AIDW_COMMAND.test("/opt/aidw/bin/aidw status")).toBe(true);
    expect(AIDW_COMMAND.test("aidwx status")).toBe(false);
  });
});

describe("trial fixes", () => {
  it("backstop: re-opening the Analysis after execution does not blame the build's files", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    readyForApproval();
    cli("approve", ID);
    expect(cli("transition", ID, "executing")).toBe(0);
    write(root, "app/page.tsx", "export default 1;\n"); // written by an implementer while approved
    expect(cli("transition", ID, "escalated", "--reason", "env")).toBe(0);
    expect(cli("transition", ID, "analyzing")).toBe(0);
    expect(runBackstop(JSON.stringify({ cwd: root }), env)).toBe("");
    write(root, "app/other.tsx", "x\n"); // a new write while analyzing is still reported
    expect(runBackstop(JSON.stringify({ cwd: root }), env)).toMatch(/app\/other\.tsx/);
  });

  it("gate: redirects to temp locations are not project writes", () => {
    for (const c of ['npx next start > "$TMPDIR/next.log" 2>&1', "node a.js > $TMPDIR/x", "echo hi > /tmp/x", "ls > /dev/stderr"]) {
      expect(decision(hook("Bash", { command: c })), c).toBe("none");
    }
    expect(decision(hook("Bash", { command: "echo hi > src/x.ts" }))).toBe("deny");
  });
});
