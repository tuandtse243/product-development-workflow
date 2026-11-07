import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, TASKS_YAML, tempProject, write } from "./fixtures.js";

const ID = "booking-v2";
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, messages: () => (JSON.parse(out).errors as { message: string }[]).map((e) => e.message) };
}

beforeEach(() => {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli("change", "new", ID);
  write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
});

describe("aidw analyze", () => {
  it("passes a consistent package", () => {
    const r = cli("analyze", ID);
    expect(r.out).toMatch(/^OK: 0 error/m);
    expect(r.code).toBe(0);
  });

  it("requires every changed requirement and scenario to be covered by a task", () => {
    write(
      root,
      `.aidw/changes/${ID}/specs/booking/spec.md`,
      `## ADDED Requirements\n\n${REQ("Reschedule appointment")}\n${REQ("Waitlist")}`,
    );
    const r = cli("analyze", ID, "--json");
    expect(r.code).toBe(1);
    expect(r.messages()).toContain('requirement "booking/waitlist" changed by this change is not covered by any task');
    expect(r.messages()).toContain('scenario "booking/waitlist/waitlist-works" has no task that implements and verifies it');
  });

  it("rejects references to unknown requirements and scenarios", () => {
    write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML.replace("booking/reschedule-appointment]", "booking/nope]"));
    expect(cli("analyze", ID, "--json").messages()).toContain(
      `task T01 references unknown requirement "booking/nope" (see \`aidw ids ${ID}\`)`,
    );
  });

  it("checks analysis.md sections, declarations and placeholders", () => {
    write(
      root,
      `.aidw/changes/${ID}/analysis.md`,
      ANALYSIS_MD.replace("Source: fallback", "Source: whatever")
        .replace("Mode: ai_design", "TODO(aidw): pick a mode")
        .replace(/## Permissions\n\n.*\n/, "## Permissions\n\nmaybe later\n")
        .replace(/## Plan\n\n.*\n/, ""),
    );
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"## Stack" must declare "Source: client | ai | fallback"');
    expect(m).toContain('"## Design" must declare "Mode: existing | claude_design | ai_design | hybrid"');
    expect(m).toContain('"## Permissions" must list each tier-2 resource as a bullet, or say "None"');
    expect(m).toContain('missing section "## Plan"');
    expect(m).toContain("unresolved TODO(aidw) placeholder");
  });

  it("lists ids after the change, marking changed ones", () => {
    const r = cli("ids", ID);
    expect(r.out).toContain("* booking/reschedule-appointment");
    expect(r.out).toContain("  booking/create-appointment");
    expect(r.out).toContain("* booking/reschedule-appointment/reschedule-appointment-works");
  });
});
