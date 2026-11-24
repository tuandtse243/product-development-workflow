/** Review of cd92389 (H1): legitimate commands the hardened gate now denies. Failing until fixed. */
import { beforeEach, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "app";
let root: string;
const cli = (...argv: string[]) => run([...argv, "--root", root], {}, root, { out: () => {}, err: () => {} });
const bash = (command: string, agent_type?: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, ...(agent_type ? { agent_type } : {}) } as HookInput, {} as NodeJS.ProcessEnv)?.decision ?? "none";
function analyzed() {
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing"]) expect(cli("transition", ID, s)).toBe(0);
}
function executing() {
  analyzed();
  for (const s of ["awaiting_approval"]) cli("transition", ID, s);
  cli("approve", ID);
  cli("transition", ID, "executing");
}
beforeEach(() => {
  root = tempProject();
  cli("init");
  cli("change", "new", ID);
});

it("an implementer copies the approved mock's binary assets (fonts, images) out of .aidw/design", () => {
  executing();
  expect(bash("cp -r .aidw/design/mock/riso/fonts public/fonts", "aidw:frontend")).toBe("none");
  expect(bash("cat .aidw/run/brief-T01.md && mkdir -p src/x", "aidw:frontend")).toBe("none");
});

it("a reviewer runs the project's test runners with loader flags and a worktree script by absolute path", () => {
  executing();
  for (const c of ["node --import tsx --test tests/", "node -r dotenv/config scripts/check.js", "ruby -Itest test/a_test.rb", `node ${root}/.aidw/run/worktrees/${ID}/T01/scripts/check.mjs`, 'grep -rnE "(bash|sh) -c" src']) {
    expect([c, bash(c, "aidw:code-reviewer")]).toEqual([c, "none"]);
  }
});

it("free text on a new line is not a command for the lead before approval", () => {
  analyzed();
  expect(bash('git commit -m "docs: analysis\n\nrm stale notes"')).toBe("none");
  expect(bash('aidw page answers decisions --text "1. yes\ninstall on the VPS"')).toBe("none");
});
