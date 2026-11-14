import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { STATES, TRANSITIONS } from "../src/change.js";
import { checkWorkflows, loadWorkflow, workflowFor, workflowIds } from "../src/workflow.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-workflows-"));
  temps.push(root);
  for (const f of ["roster.yaml", "artifacts.yaml", "roles", "workflows"]) cpSync(join(plugin, f), join(root, f), { recursive: true });
  return root;
}
const edit = (root: string, file: string, from: string | RegExp, to: string) => {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, to);
  expect(after, `${file} must change`).not.toBe(before);
  writeFileSync(path, after);
};
const errors = (root: string) => checkWorkflows(root).errors.map((e) => `${e.file}: ${e.message}`).join("\n");

describe("the workflows of the plugin", () => {
  it("are product (greenfield), feature (brownfield) and bugfix (on request), and pass their own check", () => {
    expect(workflowIds(plugin)).toEqual(["bugfix", "feature", "product"]);
    expect(workflowFor(plugin, "greenfield")?.id).toBe("product");
    expect(workflowFor(plugin, "brownfield")?.id).toBe("feature");
    const d = checkWorkflows(plugin);
    expect(d.errors).toEqual([]);
    expect(d.warnings).toEqual([]);
  });

  it("cover every state of the Change state machine, in the order aidw walks them", () => {
    for (const id of workflowIds(plugin)) {
      const w = loadWorkflow(plugin, id)!;
      const states = new Set([...w.interrupts, ...w.stages.flatMap((s) => s.states)]);
      expect([...states].sort(), id).toEqual([...STATES].sort());
      expect(w.stages.flatMap((s) => s.states).filter((s, i, a) => s !== a[i - 1]), id).toEqual(
        ["draft", "intake", "analyzing", "awaiting_approval", "approved", "executing", "verifying", "converging", "deploying", "delivered", "archived"],
      );
    }
  });

  it("have one approval gate, before the build", () => {
    for (const id of workflowIds(plugin)) {
      const stages = loadWorkflow(plugin, id)!.stages.map((s) => s.id);
      const gates = loadWorkflow(plugin, id)!.stages.filter((s) => s.gate === "approval" || s.gate === "approval-auto");
      expect(gates, id).toHaveLength(1);
      expect(stages.indexOf(gates[0]!.id), id).toBeLessThan(stages.indexOf("build"));
    }
  });

  it("differ only by the assessment stage and the baseline specs: feature adds no new kind of stage", () => {
    const product = loadWorkflow(plugin, "product")!.stages.map((s) => s.id);
    const feature = loadWorkflow(plugin, "feature")!.stages.map((s) => s.id);
    expect(feature.filter((s) => !product.includes(s))).toEqual(["assessment"]);
    expect(product.filter((s) => !feature.includes(s))).toEqual([]);
  });
});

describe("workflow consistency", () => {
  it("rejects a stage that reads an artifact no earlier stage writes", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", /(id: discovery[\s\S]*?reads: \[)intake\]/, "$1intake, architecture]");
    expect(errors(root)).toMatch(/stage discovery: reads "architecture", which no earlier stage writes/);
  });

  it("rejects a stage that writes an artifact owned by a role that is not in the stage", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", /(id: design[\s\S]*?roles: \[)ui-ux-designer\]/, "$1software-architect]");
    expect(errors(root)).toMatch(/stage design: writes "design-direction", owned by ui-ux-designer/);
  });

  it("rejects a role that is not in the roster and an artifact that is not registered", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", /(id: plan[\s\S]*?roles: \[)technical-planner\]/, "$1ghost]");
    edit(root, "workflows/product.yaml", /(id: plan[\s\S]*?writes: \[)tasks,/, "$1made-up,");
    const out = errors(root);
    expect(out).toMatch(/role "ghost" is not in roster\.yaml/);
    expect(out).toMatch(/writes "made-up", which is not an artifact/);
  });

  it("rejects a flow that skips a state aidw does not let it skip", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", "states: [verifying]", "states: [deploying]");
    expect(errors(root)).toMatch(/the stages go from state "executing" to "deploying", which aidw does not allow/);
  });

  it("rejects a workflow with no approval gate, or with a state no stage covers", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", "    gate: approval\n", "");
    edit(root, "workflows/product.yaml", "states: [converging]", "states: [verifying]");
    const out = errors(root);
    expect(out).toMatch(/exactly one stage has gate: approval or approval-auto \(found 0\)/);
    expect(out).toMatch(/no stage covers the state "converging"/);
  });

  it("rejects build agents that differ from the ones the CLI spawns", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", "review: code-reviewer", "review: security");
    expect(errors(root)).toMatch(/agents review is "security" but the CLI spawns "code-reviewer"/);
  });

  it("rejects two workflows for the same project kind", () => {
    const root = copy();
    edit(root, "workflows/feature.yaml", "applies_to: brownfield", "applies_to: greenfield");
    expect(errors(root)).toMatch(/already serves greenfield projects/);
  });

  it("warns about an artifact that no workflow writes", () => {
    const root = copy();
    edit(root, "workflows/product.yaml", "writes: [analysis-summary, analysis-decisions-to-honor, analysis-risks]", "writes: [analysis-summary, analysis-decisions-to-honor]");
    for (const f of ["feature", "bugfix"]) edit(root, `workflows/${f}.yaml`, "writes: [analysis-summary, analysis-decisions-to-honor, analysis-risks]", "writes: [analysis-summary, analysis-decisions-to-honor]");
    expect(checkWorkflows(root).warnings.map((w) => w.message).join("\n")).toMatch(/artifact "analysis-risks" is written by no workflow stage/);
  });
});

describe("the state machine", () => {
  it("is read from the workflow file and equals the table aidw ran before it moved there", () => {
    expect(TRANSITIONS).toEqual({
      draft: ["intake"],
      intake: ["analyzing"],
      analyzing: ["awaiting_approval"],
      awaiting_approval: ["analyzing"],
      approved: ["executing"],
      executing: ["verifying", "paused", "escalated"],
      paused: [],
      verifying: ["executing", "converging", "paused", "escalated"],
      converging: ["executing", "deploying", "paused", "escalated"],
      deploying: ["delivered", "paused", "escalated"],
      delivered: [],
      archived: [],
      escalated: ["executing", "verifying", "converging", "deploying", "analyzing"],
    });
  });

  it("is listed identically by every workflow, and a workflow that differs is rejected", () => {
    for (const id of workflowIds(plugin)) expect(loadWorkflow(plugin, id)!.transitions, id).toEqual(TRANSITIONS);
    const root = copy();
    edit(root, "workflows/feature.yaml", "  analyzing: [awaiting_approval]", "  analyzing: [awaiting_approval, executing]");
    expect(errors(root)).toMatch(/feature\.yaml: its "transitions:" differ/);
  });

  it("rejects a table that misses a state", () => {
    const root = copy();
    edit(root, "workflows/feature.yaml", "  archived: []\n", "");
    expect(errors(root)).toMatch(/"transitions:" must list every state/);
  });
});
