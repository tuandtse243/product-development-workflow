import { describe, expect, it } from "vitest";
import { applyDelta } from "../src/spec/merge.js";
import { parseSpec } from "../src/spec/parse.js";
import { validateSpecText } from "../src/spec/validate.js";
import { MAIN_SPEC, REQ } from "./fixtures.js";

describe("applyDelta", () => {
  it("creates a new capability from ADDED requirements and its Purpose", () => {
    const r = applyDelta(null, `## Purpose\n\nTakes card payments for confirmed appointments safely.\n\n## ADDED Requirements\n\n${REQ("Pay")}`, "billing/card-payments");
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.text).toMatch(/^# Card Payments\n\n## Purpose\n\nTakes card payments/);
    expect(parseSpec(r.text!).requirements.map((x) => x.name)).toEqual(["Pay"]);
    expect(validateSpecText(r.text!, "x").errors).toEqual([]);
  });

  it("applies RENAMED, REMOVED, MODIFIED and ADDED in order and keeps the rest verbatim", () => {
    const delta = `## RENAMED Requirements
- FROM: Create appointment
- TO: Book appointment

## MODIFIED Requirements

### Requirement: Book appointment
The system SHALL let a patient book a free slot, at most 3 per week.

#### Scenario: Weekly limit
- **WHEN** a patient already has 3 bookings this week
- **THEN** the booking is refused

## REMOVED Requirements

### Requirement: Cancel appointment
**Reason**: moved to the cancellation capability
**Migration**: see cancellation spec

## ADDED Requirements

${REQ("Reschedule appointment")}`;
    const r = applyDelta(MAIN_SPEC, delta, "booking");
    expect(r.errors).toEqual([]);
    expect(r.summary).toEqual({
      added: ["Reschedule appointment"],
      modified: ["Book appointment"],
      removed: ["Cancel appointment"],
      renamed: [{ from: "Create appointment", to: "Book appointment" }],
    });
    const merged = parseSpec(r.text!);
    expect(merged.requirements.map((x) => x.name)).toEqual(["Book appointment", "Reschedule appointment"]);
    expect(merged.requirements[0]!.description).toMatch(/at most 3 per week/);
    expect(r.text).toContain("## Purpose\n\nLets patients book");
    expect(r.text).toMatch(/## Notes\n\nKept verbatim by merge.\n$/);
  });

  it("is idempotent in shape: merging an empty-effect rename back restores the original text", () => {
    const there = applyDelta(MAIN_SPEC, "## RENAMED Requirements\n- FROM: Cancel appointment\n- TO: Cancel booking\n", "booking");
    const back = applyDelta(there.text!, "## RENAMED Requirements\n- FROM: Cancel booking\n- TO: Cancel appointment\n", "booking");
    expect(back.text).toBe(MAIN_SPEC);
  });

  it("fails all-or-nothing with precise errors", () => {
    const r = applyDelta(
      MAIN_SPEC,
      `## ADDED Requirements\n\n${REQ("Cancel appointment")}\n## MODIFIED Requirements\n\n${REQ("create appointment")}`,
      "booking",
    );
    expect(r.ok).toBe(false);
    expect(r.text).toBeUndefined();
    expect(r.errors).toContain('ADDED: requirement "Cancel appointment" already exists; use MODIFIED');
    expect(r.errors.find((e) => e.startsWith("MODIFIED"))).toMatch(/did you mean "Create appointment"\?/);
  });

  it("rejects conflicting operations on the same requirement", () => {
    const r = applyDelta(
      MAIN_SPEC,
      `## MODIFIED Requirements\n\n${REQ("Cancel appointment")}\n## REMOVED Requirements\n\n### Requirement: Cancel appointment\n**Reason**: x\n**Migration**: y\n`,
      "booking",
    );
    expect(r.errors).toContain('requirement "Cancel appointment" is both MODIFIED and REMOVED');
  });

  it("rejects non-ADDED operations on a capability without a main spec", () => {
    const r = applyDelta(null, `## MODIFIED Requirements\n\n${REQ("X")}`, "nope");
    expect(r.errors[0]).toMatch(/has no main spec yet/);
  });
});
