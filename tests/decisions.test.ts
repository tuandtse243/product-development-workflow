import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { loadWorkflow } from "../src/workflow.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const ID = "booking-v2";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

function project(): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  return root;
}
const recorded = (root: string) => YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "decisions.yaml"), "utf8")) as Record<string, Record<string, unknown>>;

describe("the decision points of a workflow", () => {
  it("are declared in the workflow file with a deciding role, fixed options and a stage", () => {
    const x = loadWorkflow(plugin, "product")!.decisions[0]!;
    expect(x).toEqual({ id: "design-needed", decide: "ui-ux-designer", options: ["full-design", "reuse-existing", "no-ui"], multiple: false, stage: "design", required: false });
  });
});

describe("aidw decide", () => {
  it("records the answer, the reason and the deciding role", () => {
    const root = project();
    const r = cli(root, "decide", "design-needed", "full-design", "--reason", "a new product, no brand yet", "--json");
    expect(r.code, r.err).toBe(0);
    expect(recorded(root)["design-needed"]).toMatchObject({ answer: "full-design", reason: "a new product, no brand yet", by: "ui-ux-designer" });
    expect(cli(root, "decisions").out).toMatch(/design-needed\s+full-design: a new product, no brand yet/);
  });

  it("rejects an answer outside the options, a second answer, a missing reason and an unknown decision", () => {
    const root = project();
    expect(cli(root, "decide", "design-needed", "maybe", "--reason", "x").err).toMatch(/"maybe" is not an answer of "design-needed" \(options: full-design, reuse-existing, no-ui\)/);
    expect(cli(root, "decide", "design-needed", "full-design,no-ui", "--reason", "x").err).toMatch(/takes exactly one answer/);
    expect(cli(root, "decide", "design-needed", "no-ui").err).toMatch(/needs a reason/);
    expect(cli(root, "decide", "pick-a-colour", "x", "--reason", "y").err).toMatch(/has no decision "pick-a-colour"/);
  });

  it("is frozen with the approved package", () => {
    const root = project();
    cli(root, "decide", "design-needed", "full-design", "--reason", "x");
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
    expect(cli(root, "approve", ID).code).toBe(0);
    expect(cli(root, "decide", "design-needed", "reuse-existing", "--reason", "changed my mind").err).toMatch(/decisions are frozen with it/);
    // and the file is part of the hash: changing it behind the CLI's back is drift
    write(root, `.aidw/changes/${ID}/decisions.yaml`, "design-needed: { answer: no-ui, reason: x, by: ui-ux-designer, at: now }\n");
    expect(cli(root, "approval", "check", ID).code).toBe(1);
  });
});

describe("aidw analyze and the decisions", () => {
  it("refuses no-ui when a task changes the UI", () => {
    const root = project();
    cli(root, "decide", "design-needed", "no-ui", "--reason", "a pure API change");
    const r = cli(root, "analyze", ID, "--json");
    expect(r.code).toBe(1);
    expect(JSON.stringify(r.json())).toMatch(/decision \\"design-needed\\" is no-ui, but task\(s\) .* change UI/);
  });

  it("accepts the other answers, and a plan that records none", () => {
    const root = project();
    expect(cli(root, "analyze", ID).code).toBe(0);
    cli(root, "decide", "design-needed", "reuse-existing", "--reason", "the brand guide exists");
    expect(cli(root, "analyze", ID).code).toBe(0);
  });

  it("refuses a recorded answer that is no longer one of the options", () => {
    const root = project();
    write(root, `.aidw/changes/${ID}/decisions.yaml`, "design-needed: { answer: sparkly, reason: x, by: ui-ux-designer, at: now }\n");
    expect(cli(root, "analyze", ID).out).toMatch(/"sparkly" is not one of full-design, reuse-existing, no-ui/);
  });
});
