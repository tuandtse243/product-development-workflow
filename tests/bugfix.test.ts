import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { loadWorkflow } from "../src/workflow.js";
import { ANALYSIS_MD, QUALITY_YAML, REQ, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const ID = "2026-11-14-fix-cancel";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const change = (root: string) => YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8")) as Record<string, unknown>;

const task = (n: number, touches = '"lib/cancel.ts"', scenario = "") =>
  `  - id: T0${n}\n    title: Fix cancel ${n}\n    role: fullstack\n    type: fix\n${scenario ? `    specs: [booking/cancel-appointment]\n    scenarios: [${scenario}]\n` : ""}    touches: [${touches}]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`;

/** A bugfix change waiting at the gate. */
function atGate(opts: { tasks?: string; delta?: boolean; workflow?: string | null } = {}): string {
  const root = tempProject();
  cli(root, "init");
  const wf = opts.workflow === undefined ? ["--workflow", "bugfix"] : opts.workflow ? ["--workflow", opts.workflow] : [];
  expect(cli(root, "change", "new", ID, ...wf).code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, `tasks:\n${opts.tasks ?? (opts.delta ? task(1, '"lib/cancel.ts"', "booking/cancel-appointment/cancel-appointment-works") : task(1))}`);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  if (opts.delta) {
    write(root, ".aidw/specs/booking/spec.md", `# Booking\n\n## Purpose\n\nx\n\n## Requirements\n\n${REQ("Cancel appointment")}`);
    write(root, `${c}/specs/booking/spec.md`, `## MODIFIED Requirements\n\n${REQ("Cancel appointment")}`);
  }
  if (opts.workflow !== undefined) write(root, `${c}/change.yaml`, readFileSync(join(root, c, "change.yaml"), "utf8").replace("skip_specs: false", "skip_specs: true")); // a change with no delta spec
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const r = cli(root, "transition", ID, s);
    expect(r.code, `${s}: ${r.err}${r.out}`).toBe(0);
  }
  return root;
}

describe("the bugfix workflow", () => {
  it("is chosen per request, approves itself inside a small boundary and falls back to feature", () => {
    const w = loadWorkflow(plugin, "bugfix")!;
    expect(w.applies_to).toBe("request");
    const gate = w.stages.find((s) => s.gate === "approval-auto")!;
    expect(gate.boundary).toEqual({ max_tasks: 3, migrations: false, spec_changes: false, reclassify_to: "feature" });
  });

  it("records the workflow of a change, and rejects one that does not exist", () => {
    const root = atGate();
    expect(change(root).workflow).toBe("bugfix");
    expect(cli(root, "change", "new", "other", "--workflow", "nope").err).toMatch(/unknown workflow "nope" \(expected audit, bugfix, feature, product\)/);
  });
});

describe("aidw approve --auto", () => {
  it("approves a small fix itself, and keeps the hash and the drift protection", () => {
    const root = atGate({ tasks: task(1) + task(2) + task(3) });
    const r = cli(root, "approve", ID, "--auto");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/approved .* by aidw \(bugfix boundary\)/);
    expect(change(root)).toMatchObject({ state: "approved", approval: { by: "aidw (bugfix boundary)" } });
    expect(cli(root, "approval", "check", ID).code).toBe(0);
    write(root, `.aidw/changes/${ID}/analysis.md`, `${ANALYSIS_MD}\nsneaked in\n`);
    expect(cli(root, "approval", "check", ID).code).toBe(1);
  });

  it.each([
    ["more than 3 tasks", { tasks: task(1) + task(2) + task(3) + task(4) }, /the plan has 4 tasks \(at most 3\)/],
    ["a migration", { tasks: task(1, '"prisma/migrations/**"') }, /T01 change a database migration/],
    ["a change of behavior written in a spec", { delta: true }, /changes behavior written in a spec/],
  ])("reclassifies a fix with %s to feature and waits for the user", (_name, opts, message) => {
    const root = atGate(opts);
    const r = cli(root, "approve", ID, "--auto");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(message);
    expect(r.err).toMatch(/now a "feature" change and waits for the user/);
    expect(change(root)).toMatchObject({ state: "awaiting_approval", workflow: "feature" });
    expect(cli(root, "approve", ID, "--auto").err).toMatch(/has no automatic approval/); // feature has none now
    expect(cli(root, "approve", ID).code).toBe(0); // the user still can
    expect(change(root)).toMatchObject({ approval: { by: "user" } });
  });

  it("is refused for a change whose workflow has no automatic approval, or none named", () => {
    for (const workflow of ["feature", null]) {
      const root = atGate({ workflow });
      expect(cli(root, "approve", ID, "--auto").err).toMatch(/has no automatic approval/);
      expect(change(root).state).toBe("awaiting_approval");
    }
  });

  it("still lets the user approve a bugfix change the usual way", () => {
    const root = atGate();
    expect(cli(root, "approve", ID).code).toBe(0);
    expect(change(root)).toMatchObject({ approval: { by: "user" } });
  });
});
