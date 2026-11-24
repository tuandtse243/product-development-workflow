import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

// Plan D2 gate rule: only the plain detached start the route prints is allowed without asking. These forms load code
// the user never approved into the unsandboxed runner, or run a second command, and must not be allowed silently.

const ID = "app";
const PLUGIN = "/opt/plugin";
let root: string;

function cli(...argv: string[]) {
  return run([...argv, "--root", root], {}, root, { out: () => {}, err: () => {} });
}

const TASKS = `tasks:
${[1, 2, 3, 4]
  .map(
    (i) => `  - id: T0${i}
    title: Slice ${i}
    role: backend-engineer
    type: feat
    ${i === 1 ? "specs: [booking/reschedule-appointment]\n    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]\n    " : ""}depends_on: ${i === 1 ? "[]" : "[T01]"}
    touches: ["app/s${i}/**"]
    verify: ["pnpm vitest run s${i}"]
    status: pending`,
  )
  .join("\n")}
`;

describe("gate: bypasses of the plain detached start (D2)", () => {
  const env = { AIDW_PLUGIN_ROOT: PLUGIN } as NodeJS.ProcessEnv;
  const decision = (command: string) =>
    decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root } as HookInput, env)?.decision ?? "none";
  const START = `aidw run ${ID} --detach --permission-mode auto`;

  beforeEach(() => {
    root = tempProject();
    expect(cli("init")).toBe(0);
    expect(cli("change", "new", ID)).toBe(0);
    write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS);
    write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
    write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s)).toBe(0);
    expect(cli("approve", ID)).toBe(0);
  });

  it("still allows the bundled plugin's own start", () => {
    expect(decision(START)).toBe("allow");
    expect(decision(`${PLUGIN}/bin/aidw run ${ID} --detach --permission-mode auto -- --plugin-dir ${PLUGIN}`)).toBe("allow");
  });

  it("does not allow a --plugin-dir other than the bundled plugin (its hooks run unsandboxed in the runner)", () => {
    for (const c of [`${START} -- --plugin-dir /tmp/evil`, `${START} -- --plugin-dir ~/.evil`, `${START} -- --plugin-dir ${PLUGIN} --plugin-dir /tmp/evil`]) {
      expect([c, decision(c)]).not.toEqual([c, "allow"]);
    }
  });

  it("does not allow a binary named aidw that is not the bundled CLI", () => {
    for (const c of [`./aidw run ${ID} --detach --permission-mode auto`, `/tmp/evil/aidw run ${ID} --detach --permission-mode auto`]) {
      expect([c, decision(c)]).not.toEqual([c, "allow"]);
    }
  });

  it("does not allow a newline that turns the change id into a second command", () => {
    for (const c of [`aidw run\nevil --detach --permission-mode auto`, `aidw\nrun ${ID} --detach`]) {
      expect([JSON.stringify(c), decision(c)]).not.toEqual([JSON.stringify(c), "allow"]);
    }
  });
});

describe("gate: the runner allowance is narrow (D2, follow-up review)", () => {
  const env = { AIDW_PLUGIN_ROOT: PLUGIN } as NodeJS.ProcessEnv;
  const decision = (command: string, e: NodeJS.ProcessEnv = env) =>
    decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root } as HookInput, e)?.decision ?? "none";

  function change(id: string) {
    expect(cli("change", "new", id)).toBe(0);
    write(root, `.aidw/changes/${id}/analysis.md`, ANALYSIS_MD);
    write(root, `.aidw/changes/${id}/tasks.yaml`, TASKS);
    write(root, `.aidw/changes/${id}/quality.yaml`, QUALITY_YAML);
    write(root, `.aidw/changes/${id}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  }

  beforeEach(() => {
    root = tempProject();
    expect(cli("init")).toBe(0);
    write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    change(ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s)).toBe(0);
  });

  it("aidw approve from the main session still asks the user", () => {
    expect(decision(`aidw approve ${ID}`)).toBe("ask");
    expect(decision(`aidw approve ${ID} --auto`)).toBe("ask");
  });

  it("asks for a foreign aidw binary or plugin dir, and for --max-runs 0", () => {
    expect(cli("approve", ID)).toBe(0);
    for (const c of [
      `/tmp/evil/bin/aidw run ${ID} --detach --permission-mode auto`,
      `aidw run ${ID} --detach --permission-mode auto -- --plugin-dir /tmp/evil`,
      `aidw run ${ID} --detach --max-runs 0`,
    ]) {
      expect([c, decision(c)]).toEqual([c, "ask"]);
    }
  });

  it("holds only for the named Change when it is approved, not for any approved Change", () => {
    expect(cli("approve", ID)).toBe(0);
    change("other");
    expect(decision(`aidw run other --detach --permission-mode auto`)).toBe("deny");
    expect(decision(`aidw run --detach --permission-mode auto`)).toBe("deny"); // two changes: none resolved
    expect(decision(`aidw run ${ID} --detach --permission-mode auto`)).toBe("allow");
  });
});

describe("route: a plugin loaded from a directory is passed to the runner", () => {
  it("adds -- --plugin-dir only when given one", async () => {
    const { buildRoute, installedPlugin } = await import("../src/buildroute.js");
    expect(buildRoute(ID, 4, `${PLUGIN}/bin/aidw`, PLUGIN).command).toBe(`${PLUGIN}/bin/aidw run ${ID} --detach --permission-mode auto -- --plugin-dir ${PLUGIN}`);
    expect(installedPlugin("/Users/x/.claude/plugins/cache/aidw/aidw/1.0.0")).toBe(true);
    expect(installedPlugin("/Users/x/src/aidw/plugins/aidw")).toBe(false);
  });
});
