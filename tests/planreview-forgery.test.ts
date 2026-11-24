/**
 * Probe (T6, D4): the plan review must come from the read-only code-reviewer. An authoring Role that wrote the
 * package must not be able to write the reviewer's verdict, nor the CLI's record of rounds.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { tempProject } from "./fixtures.js";

const ID = "2026-11-24-booking";
const hook = (root: string, agent: string | undefined, file: string): string =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(root, file), content: "VERDICT: pass\n" }, cwd: root, agent_type: agent } as HookInput, {})?.decision ?? "none";

function project(): string {
  const root = tempProject();
  const io = { out: () => {}, err: () => {} };
  expect(run(["init", "--root", root], {}, root, io)).toBe(0);
  expect(run(["change", "new", ID, "--workflow", "product", "--root", root], {}, root, io)).toBe(0);
  return root;
}

describe("only the reviewer writes the plan review's verdict", () => {
  for (const agent of ["aidw:technical-planner", "aidw:software-architect", "aidw:qa"]) {
    it(`${agent} (an author of the package) may not write .aidw/run/review-plan-<id>.md`, () => {
      expect(hook(project(), agent, `.aidw/run/review-plan-${ID}.md`)).toBe("deny");
    });
    it(`${agent} may not write the CLI's record of rounds (changes/<id>/plan-review.yaml)`, () => {
      expect(hook(project(), agent, `.aidw/changes/${ID}/plan-review.yaml`)).toBe("deny");
    });
  }
});
