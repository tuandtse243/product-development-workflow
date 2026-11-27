import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write, planReviewed } from "./fixtures.js";

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
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s)).toBe(0);
    expect(cli("approve", ID)).toBe(0);
  });

  it("asks for the start of a plugin loaded from a folder, and for bare aidw (PATH can be planted)", () => {
    expect(decision(START)).toBe("ask");
    expect(decision(`${PLUGIN}/bin/aidw run ${ID} --detach --permission-mode auto -- --plugin-dir ${PLUGIN}`)).toBe("ask");
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
    planReviewed(root, ID);
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
    expect(decision(`aidw run ${ID} --detach --permission-mode auto`)).toBe("ask");
  });
});

describe("route: a plugin loaded from a directory is passed to the runner", () => {
  it("adds -- --plugin-dir only when given one", async () => {
    const { buildRoute, installedOutside } = await import("../src/buildroute.js");
    const r = buildRoute(ID, 4, `${PLUGIN}/bin/aidw`, PLUGIN);
    expect(r.command).toBe(`${PLUGIN}/bin/aidw run ${ID} --detach --permission-mode auto -- --plugin-dir ${PLUGIN}`);
    expect(r.next).toMatch(/asks the user to confirm, because aidw is loaded from a folder/);
    expect(buildRoute(ID, 4, `${PLUGIN}/bin/aidw`).next).not.toMatch(/asks the user/);
    // B-D2: with no terminal nothing asks, and the line says so; the command is the same
    const headless = buildRoute(ID, 4, `${PLUGIN}/bin/aidw`, PLUGIN, false);
    expect(headless.next).toMatch(/no terminal is attached, so the start runs without asking/);
    expect(headless.next).not.toMatch(/the start asks the user to confirm/);
    expect(headless.command).toBe(r.command);
    expect(buildRoute(ID, 4, `${PLUGIN}/bin/aidw`, undefined, false).next).not.toMatch(/asks the user|asking/);
    const home = realpathSync(mkdtempSync(join(tmpdir(), "aidw-home-")));
    const installed = join(home, ".claude", "plugins", "cache", "aidw");
    mkdirSync(installed, { recursive: true });
    const proj = tempProject();
    expect(installedOutside(installed, proj)).toBe(true);
    expect(installedOutside(join(home, "src", "plugins", "aidw"), proj)).toBe(false); // not installed (and missing)
    const inProj = join(proj, ".claude", "plugins", "aidw");
    mkdirSync(inProj, { recursive: true });
    expect(installedOutside(inProj, proj)).toBe(false); // installed shape, but inside the project
  });
});
