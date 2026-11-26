import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { caseSection, hasUnclosedFence, loadEvalCases } from "../src/evals.js";

const quoted = [
  "---",
  "case: quotes-a-markdown-file",
  "---",
  "## Input",
  "",
  "The orchestrator hands you `questions.md`:",
  "",
  "```markdown",
  "## Group 1: routes",
  "",
  "1. How is a booking created?",
  "",
  "## Group 2: data",
  "```",
  "",
  "Merge it.",
  "",
  "## Criteria",
  "",
  "- must keep both groups",
  "",
].join("\n");

describe("a case section and fenced headings", () => {
  it("keeps `## ` lines inside a fence in the Input", () => {
    const input = caseSection(quoted, "Input");
    expect(input).toContain("## Group 1: routes");
    expect(input).toContain("## Group 2: data");
    expect(input).toContain("Merge it.");
    expect(input).not.toContain("must keep both groups");
  });

  it("still ends a section at the next heading outside a fence", () => {
    expect(caseSection(quoted, "Criteria")).toBe("- must keep both groups");
  });

  it("ignores a heading of the same title quoted inside a fence", () => {
    const text = ["## Input", "", "```", "## Criteria", "- must not be read", "```", "", "## Criteria", "", "- must be read", ""].join("\n");
    expect(caseSection(text, "Criteria")).toBe("- must be read");
  });

  it("does not open a fence on a line of inline backticks", () => {
    const text = ["## Input", "", "```foo``` bar", "", "## Criteria", "", "- must be read", ""].join("\n");
    expect(caseSection(text, "Criteria")).toBe("- must be read");
    expect(hasUnclosedFence(text)).toBe(false);
  });

  it("reports a fence left open", () => {
    const text = ["## Input", "", "```", "## x", "", "## Criteria", "- must a", ""].join("\n");
    expect(hasUnclosedFence(text)).toBe(true);
    expect(hasUnclosedFence(quoted)).toBe(false);
  });

  it("returns null for a missing section", () => {
    expect(caseSection(quoted, "Expected")).toBeNull();
  });

  const root = mkdtempSync(join(tmpdir(), "aidw-fences-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("loads the case with its whole Input and its criteria", () => {
    const dir = join(root, "roles", "research", "evals");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "quotes-a-markdown-file.md"), quoted);
    const { cases } = loadEvalCases(root, "research");
    expect(cases).toHaveLength(1);
    expect(cases[0]!.input).toContain("## Group 2: data");
    expect(cases[0]!.criteria).toEqual(["must keep both groups"]);
  });
});
