import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-14-notes-app";
const BRIEF = "# Product brief: Notes\n\n## Vision\n\nA notes app for freelancers who lose track of client calls.\n\n## Scope\n\n- capture a note\n- tag it with a client\n\n## MVP\n\nCapture and tag; search comes later because the first users have few notes.\n\n## Out of scope\n\nSharing and sync.\n";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const change = (root: string) => YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8")) as Record<string, unknown>;

/** A product change in analyzing, with everything but the scope approval in place. */
function product(opts: { workflow?: string | null } = {}): string {
  const root = tempProject();
  cli(root, "init");
  const wf = opts.workflow === null ? [] : ["--workflow", opts.workflow ?? "product"];
  expect(cli(root, "change", "new", ID, ...wf).code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, TASKS_YAML);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  return root;
}

describe("a product change has a scope gate", () => {
  it("is created with a brief skeleton and records that it needs the scope approved", () => {
    const root = product();
    expect(change(root)).toMatchObject({ workflow: "product", scope_gate: true, scope_approval: null });
    expect(readFileSync(join(root, ".aidw/changes", ID, "brief.md"), "utf8")).toMatch(/## Vision[\s\S]*TODO\(aidw\)[\s\S]*## Out of scope/);
  });

  it("cannot reach the final approval without the scope approved", () => {
    const root = product();
    expect(cli(root, "transition", ID, "awaiting_approval").err).toMatch(/the scope is not approved yet/);
  });

  it("refuses to present a brief that is still a skeleton", () => {
    const root = product();
    expect(cli(root, "transition", ID, "awaiting_scope_approval").err).toMatch(/needs the product brief: .*empty or still a placeholder/);
  });

  it("goes brief, scope approval by the user, then on to the final approval", () => {
    const root = product();
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF);
    expect(cli(root, "transition", ID, "awaiting_scope_approval").code).toBe(0);
    expect(change(root).state).toBe("awaiting_scope_approval");
    expect(cli(root, "approve", ID, "--auto").err).toMatch(/the scope is always approved by the user/);
    const r = cli(root, "approve", ID);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^scope approved /);
    expect(change(root)).toMatchObject({ state: "analyzing", scope_approval: { by: "user" } });
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
    expect(cli(root, "approve", ID).code).toBe(0);
    expect(change(root)).toMatchObject({ state: "approved", approval: { by: "user" } });
  });

  it("asks for the scope again when the brief changes after it was approved", () => {
    const root = product();
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF);
    cli(root, "transition", ID, "awaiting_scope_approval");
    cli(root, "approve", ID);
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF.replace("Sharing and sync.", "Sharing, sync and a mobile app."));
    expect(cli(root, "transition", ID, "awaiting_approval").err).toMatch(/the product brief changed after the scope was approved/);
  });

  it("the user can send the brief back for changes without approving it", () => {
    const root = product();
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF);
    cli(root, "transition", ID, "awaiting_scope_approval");
    expect(cli(root, "transition", ID, "analyzing").code).toBe(0);
    expect(cli(root, "transition", ID, "awaiting_approval").err).toMatch(/the scope is not approved yet/); // going back is not approving
  });

  it("covers the brief by the final approval hash, so changing it after the gate is drift", () => {
    const root = product();
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF);
    cli(root, "transition", ID, "awaiting_scope_approval");
    cli(root, "approve", ID);
    cli(root, "transition", ID, "awaiting_approval");
    cli(root, "approve", ID);
    write(root, `.aidw/changes/${ID}/brief.md`, `${BRIEF}\nsneaked in\n`);
    expect(cli(root, "approval", "check", ID).code).toBe(1);
  });

  it("keeps the code closed while the scope is being approved", () => {
    const root = product();
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF);
    cli(root, "transition", ID, "awaiting_scope_approval");
    const r = decide({ tool_name: "Write", tool_input: { file_path: join(root, "app/page.tsx") }, cwd: root }, {});
    expect(r?.decision).toBe("deny");
  });
});

describe("the other workflows have no scope gate", () => {
  it.each(["feature", "bugfix", null])("%s: no brief, no scope approval needed", (workflow) => {
    const root = product({ workflow });
    expect(change(root).scope_gate).toBeUndefined();
    const r = cli(root, "transition", ID, "awaiting_approval");
    expect(r.err).not.toMatch(/scope/);
  });
});
