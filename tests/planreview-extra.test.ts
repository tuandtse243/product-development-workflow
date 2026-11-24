/**
 * D4 edge cases of the review before the Approval Gate: the cap on recorded rounds, a verdict on disk that was never
 * recorded, the review counting once per Change when the user sends the package back, and verdict-shape corners.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { digestOf, MAX_REVIEWS, parsePlanReview } from "../src/planreview.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-24-booking";
const verdict = `.aidw/run/review-plan-${ID}.md`;
const roundsYaml = `.aidw/changes/${ID}/plan-review.yaml`;

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

function drafted(): string {
  const root = tempProject();
  cli(root, "init");
  expect(cli(root, "change", "new", ID, "--workflow", "product").code).toBe(0);
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

const FIX = (n: number) => `VERDICT: fix\n1. [item 4] T02: round ${n}: a slot cache nobody needs -> drop it\n`;
const PASS = "VERDICT: pass\n";

describe("the gate counts recorded rounds", () => {
  it("refuses awaiting_approval when more reviews are recorded than the cap allows", () => {
    const root = drafted();
    const rounds = Array.from({ length: MAX_REVIEWS + 1 }, (_, i) => ({
      round: i + 1,
      verdict: i === MAX_REVIEWS ? "pass" : "fix",
      digest: digestOf(i === MAX_REVIEWS ? PASS : FIX(i + 1)),
      at: "2026-11-24T00:00:00.000Z",
      findings: i === MAX_REVIEWS ? [] : [{ item: 4, target: "T02", text: "x" }],
    }));
    write(root, verdict, PASS);
    write(root, roundsYaml, YAML.stringify({ rounds }));
    const r = cli(root, "transition", ID, "awaiting_approval");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/at most 2 fix rounds of the plan review \(3 reviews\); 4 are recorded/);
  });

  it("refuses awaiting_approval while a verdict sits on disk unrecorded", () => {
    const root = drafted();
    write(root, verdict, PASS);
    const r = cli(root, "transition", ID, "awaiting_approval");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/the plan review's verdict \(.*review-plan-2026-11-24-booking\.md\) recorded: run `aidw plan-review 2026-11-24-booking`/);
  });

  it("a pass on the second review ends the stage after one fix round", () => {
    const root = drafted();
    write(root, verdict, FIX(1));
    expect(cli(root, "plan-review", ID).out).toMatch(/fix round 1 of 2/);
    write(root, verdict, PASS);
    const r = cli(root, "plan-review", ID);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/plan review round 2: pass/);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
  });
});

describe("the user sends the package back from the gate", () => {
  it("the recorded review still counts: back to analyzing, revise, and the gate opens again without a new review", () => {
    const root = drafted();
    write(root, verdict, PASS);
    expect(cli(root, "plan-review", ID).code).toBe(0);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
    expect(cli(root, "transition", ID, "analyzing").code).toBe(0);
    // the user asked for a change; the planner revises the plan
    const c = `.aidw/changes/${ID}`;
    write(root, `${c}/tasks.yaml`, TASKS_YAML.replace("status: pending", "status: pending\n    notes: revised after the gate"));
    // no second review: the stage is finished and recording again is refused
    expect(cli(root, "plan-review", ID).err).toMatch(/the plan review is finished \(round 1: pass\)/);
    const t = cli(root, "transition", ID, "awaiting_approval");
    expect(t.code, t.err).toBe(0);
    expect((YAML.parse(readFileSync(join(root, roundsYaml), "utf8")) as { rounds: unknown[] }).rounds).toHaveLength(1);
  });

  it("carried findings still head the gate page after the round trip", () => {
    const root = drafted();
    for (const n of [1, 2, 3]) {
      write(root, verdict, FIX(n));
      expect(cli(root, "plan-review", ID).code, `round ${n}`).toBe(0);
    }
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
    expect(cli(root, "transition", ID, "analyzing").code).toBe(0);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    expect(cli(root, "page", "render", "gate").code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect([...html.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1])[0]).toBe("open-findings");
    expect(html).toContain("round 3: a slot cache nobody needs");
  });
});

describe("verdict shape corners", () => {
  it("numbered lines under Non-blocking are not findings, so a fix with only remarks is refused and a pass with remarks is fine", () => {
    expect(parsePlanReview("VERDICT: fix\nNon-blocking:\n1. [item 1] T01: x -> y\n").problems.join()).toMatch(/a `fix` verdict lists at least one finding/);
    expect(parsePlanReview("VERDICT: pass\nNon-blocking:\n1. [item 1] T01: x -> y\n").problems).toEqual([]);
  });

  it("the verdict must be the first non-empty line and only pass or fix", () => {
    expect(parsePlanReview("\n\n**VERDICT: PASS**\n").verdict).toBe("pass");
    expect(parsePlanReview("Summary\nVERDICT: pass\n").verdict).toBeNull();
    expect(parsePlanReview("VERDICT: approve\n").verdict).toBeNull();
    expect(parsePlanReview("").problems.join()).toMatch(/first line must be/);
  });

  it("a shape refusal does not use up a round: the corrected verdict is round 1", () => {
    const root = drafted();
    write(root, verdict, "VERDICT: fix\n");
    expect(cli(root, "plan-review", ID).code).toBe(1);
    write(root, verdict, FIX(1));
    expect(cli(root, "plan-review", ID).out).toMatch(/plan review round 1: fix/);
  });

  it("is only recorded while the change is analyzing", () => {
    const root = drafted();
    write(root, verdict, PASS);
    expect(cli(root, "plan-review", ID).code).toBe(0);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
    write(root, verdict, FIX(1));
    expect(cli(root, "plan-review", ID).err).toMatch(/the plan review runs while the change is analyzing/);
  });
});

describe("who may write the review's verdict", () => {
  const hook = (root: string, agent: string | undefined, file: string): string =>
    decide({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(root, file), content: "VERDICT: pass\n" }, cwd: root, agent_type: agent } as HookInput, {})?.decision ?? "none";

  it("an implementer may not write the plan review's verdict", () => {
    const root = drafted();
    expect(hook(root, "aidw:fullstack", verdict)).toBe("deny");
  });
});
