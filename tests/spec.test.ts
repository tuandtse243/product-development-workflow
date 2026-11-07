import { describe, expect, it } from "vitest";
import { parseDelta, parseSpec } from "../src/spec/parse.js";
import { validateDeltaText, validateSpecText } from "../src/spec/validate.js";
import { MAIN_SPEC, REQ } from "./fixtures.js";

describe("parseSpec", () => {
  it("parses title, purpose, requirements and scenarios", () => {
    const s = parseSpec(MAIN_SPEC);
    expect(s.title).toBe("Booking");
    expect(s.purpose).toMatch(/^Lets patients book/);
    expect(s.requirements.map((r) => r.name)).toEqual(["Create appointment", "Cancel appointment"]);
    const first = s.requirements[0]!;
    expect(first.description).toBe("The system SHALL let a patient book a free slot with a practitioner.");
    expect(first.scenarios).toEqual([{ name: "Slot is free", line: 12, hasTrigger: true, hasOutcome: true }]);
    expect(s.suffix).toMatch(/^## Notes/);
  });

  it("ignores headings inside fenced code blocks", () => {
    const text = `# T\n\n## Requirements\n\n### Requirement: A\nThe system SHALL a.\n\n\`\`\`md\n### Requirement: Not real\n#### Scenario: Not real\n\`\`\`\n\n#### Scenario: Real\n- **WHEN** x\n- **THEN** y\n`;
    const s = parseSpec(text);
    expect(s.requirements.map((r) => r.name)).toEqual(["A"]);
    expect(s.requirements[0]!.scenarios.map((x) => x.name)).toEqual(["Real"]);
  });
});

describe("validateSpecText", () => {
  it("accepts a well-formed spec", () => {
    const d = validateSpecText(MAIN_SPEC, "spec.md");
    expect(d.items).toEqual([]);
  });

  it("flags missing scenarios, wrong scenario level, duplicates and weak wording", () => {
    const text = `# T

## Purpose

Short.

## Requirements

### Requirement: No scenario
The system SHALL do something.

### Requirement: Wrong level
The system does it.

### Scenario: three hashes
- **WHEN** x

### Requirement: No scenario
The system SHALL again.

#### Scenario: Only then
- **THEN** y
`;
    const d = validateSpecText(text, "spec.md");
    const errors = d.errors.map((e) => e.message);
    expect(errors).toContain('Requirement "No scenario" must have at least one "#### Scenario:"');
    expect(errors.some((m) => m.includes("4 hashes"))).toBe(true);
    expect(errors.some((m) => m.startsWith('Duplicate requirement "No scenario"'))).toBe(true);
    const warnings = d.warnings.map((w) => w.message);
    expect(warnings.some((m) => m.includes("SHALL or MUST"))).toBe(true);
    expect(warnings.some((m) => m.includes("too brief"))).toBe(true);
    expect(warnings.some((m) => m.includes("no **WHEN** or **GIVEN**"))).toBe(true);
  });

  it("warns on descriptions over 500 characters", () => {
    const long = `# T\n\n## Purpose\n\n${"x".repeat(60)}\n\n## Requirements\n\n${REQ("Long", ` ${"word ".repeat(120)}`)}`;
    const d = validateSpecText(long, "spec.md");
    expect(d.warnings.some((w) => w.message.includes("max 500"))).toBe(true);
  });
});

describe("parseDelta / validateDeltaText", () => {
  it("parses all four operations", () => {
    const delta = `## ADDED Requirements

${REQ("Reschedule appointment")}
## MODIFIED Requirements

${REQ("Create appointment")}
## REMOVED Requirements

### Requirement: Cancel appointment
**Reason**: replaced by reschedule
**Migration**: use reschedule

## RENAMED Requirements

- FROM: \`### Requirement: Old\`
- TO: \`### Requirement: New\`
`;
    const d = parseDelta(delta);
    expect(d.added.map((r) => r.name)).toEqual(["Reschedule appointment"]);
    expect(d.modified.map((r) => r.name)).toEqual(["Create appointment"]);
    expect(d.removed[0]).toMatchObject({ name: "Cancel appointment", reason: "replaced by reschedule", migration: "use reschedule" });
    const fromLine = delta.split("\n").findIndex((l) => l.startsWith("- FROM:")) + 1;
    expect(d.renamed).toEqual([{ from: "Old", to: "New", line: fromLine }]);
  });

  it("requires Reason and Migration for REMOVED, and runs the merge preflight", () => {
    const delta = `## REMOVED Requirements

### Requirement: Cancel appointment

## MODIFIED Requirements

${REQ("Does not exist")}`;
    const d = validateDeltaText(delta, "delta.md", MAIN_SPEC, "booking");
    const errors = d.errors.map((e) => e.message);
    expect(errors).toContain('REMOVED requirement "Cancel appointment" needs a **Reason**');
    expect(errors).toContain('REMOVED requirement "Cancel appointment" needs a **Migration**');
    expect(errors).toContain('merge: MODIFIED: requirement "Does not exist" not found');
  });

  it("rejects an empty delta and warns on a missing purpose for a new capability", () => {
    expect(validateDeltaText("# nothing\n", "d.md", null, "x").errors[0]?.message).toMatch(/no ADDED, MODIFIED/);
    const d = validateDeltaText(`## ADDED Requirements\n\n${REQ("A")}`, "d.md", null, "payments");
    expect(d.errors).toEqual([]);
    expect(d.warnings.map((w) => w.message)).toContain('New capability "payments" should start with a "## Purpose" section');
  });
});
