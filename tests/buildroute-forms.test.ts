import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

// Plan D2 gate rule against a real plugin directory: forms around the plain detached start, and the denials that
// must hold whatever the form.

const ID = "app";
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

describe("gate: forms of the detached start against a real plugin dir (D2)", () => {
  let base: string;
  let plugin: string;
  let env: NodeJS.ProcessEnv;
  const decision = (command: string, agent_type?: string, e?: NodeJS.ProcessEnv) =>
    decide(
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, ...(agent_type ? { agent_type } : {}) } as HookInput,
      e ?? env,
    )?.decision ?? "none";
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
    base = realpathSync(mkdtempSync(join(tmpdir(), "aidw-forms-")));
    plugin = join(base, "plugin");
    mkdirSync(join(plugin, "bin"), { recursive: true });
    env = { AIDW_PLUGIN_ROOT: plugin } as NodeJS.ProcessEnv;
  });

  it("denies every form of the start for an unapproved Change", () => {
    for (const c of [START, `${plugin}/bin/aidw run ${ID} --detach --permission-mode auto -- --plugin-dir ${plugin}`]) {
      expect([c, decision(c)]).toEqual([c, "deny"]);
    }
  });

  describe("after approval", () => {
    beforeEach(() => {
      expect(cli("approve", ID)).toBe(0);
    });

    it("asks for the own options in any order, tab separators and an empty trailing -- (only the exact command is allowed)", () => {
      for (const c of [
        `aidw run ${ID} --permission-mode auto --detach`,
        `aidw run ${ID} --detach --max-runs 3 --permission-mode auto`,
        `aidw\trun ${ID}\t--detach --permission-mode auto`,
        `${START} --`,
      ]) {
        expect([JSON.stringify(c), decision(c)]).toEqual([JSON.stringify(c), "ask"]);
      }
    });

    it("does not allow --detach=true, an id after the options, or -- with something other than one --plugin-dir", () => {
      expect(decision(`aidw run ${ID} --detach=true --permission-mode auto`)).toBe("deny"); // not a detached start
      for (const c of [
        `aidw run --permission-mode auto ${ID} --detach`,
        `${START} -- --plugin-dir`,
        `${START} -- --plugin-dir=${plugin}`,
        `${START} -- --plugin-dir ${plugin}/bin`,
        `${START} -- -- --plugin-dir ${plugin}`,
      ]) {
        expect([c, decision(c)]).not.toEqual([c, "allow"]);
      }
    });

    it("does not allow a path named like the plugin root that points elsewhere", () => {
      const other = join(base, "other");
      mkdirSync(join(other, "bin"), { recursive: true });
      const fake = join(base, "fake");
      mkdirSync(fake);
      symlinkSync(other, join(fake, "plugin"));
      for (const c of [`${fake}/plugin/bin/aidw run ${ID} --detach --permission-mode auto`, `${START} -- --plugin-dir ${fake}/plugin`]) {
        expect([c, decision(c)]).not.toEqual([c, "allow"]);
      }
    });

    it("takes the plugin root from the hook's environment, not from the command", () => {
      // The command cannot set AIDW_PLUGIN_ROOT for the hook: an env prefix is not the plain form.
      const other = join(base, "other");
      mkdirSync(join(other, "bin"), { recursive: true });
      for (const c of [`AIDW_PLUGIN_ROOT=${other} ${other}/bin/aidw run ${ID} --detach --permission-mode auto`, `${other}/bin/aidw run ${ID} --detach --permission-mode auto`]) {
        expect([c, decision(c)]).not.toEqual([c, "allow"]);
      }
    });

    it("still denies a foreground run, a subagent, a session under the runner and another id", () => {
      expect(decision(`aidw run ${ID} --permission-mode auto`)).toBe("deny");
      expect(decision(START, "aidw:fullstack")).toBe("deny");
      expect(decision(START, "general-purpose")).toBe("deny");
      expect(decision(START, undefined, { ...env, AIDW_RUNNER: "1" })).toBe("deny");
      expect(decision(`aidw run nope --detach --permission-mode auto`)).toBe("deny");
    });
  });
});
