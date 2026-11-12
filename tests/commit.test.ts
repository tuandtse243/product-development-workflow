import { describe, expect, it } from "vitest";
import { aidwCommitMessage, header, isConventional, scopeOf, subjectOf, taskCommitMessage, typeProblem } from "../src/commit.js";
import { validateTasksText } from "../src/tasks.js";

const task = (extra: Record<string, unknown> = {}) => ({ id: "T01", title: "Add expense form", type: "feat", specs: ["expenses/add-expense"], ...extra });

describe("conventional commits", () => {
  it("builds a valid task message with capability scope and footers", () => {
    const m = taskCommitMessage(task(), "2026-01-01-x", ".aidw/changes/x/evidence/T01.json");
    expect(m.split("\n")[0]).toBe("feat(expenses): add expense form");
    expect(m).toContain("\n\nChange: 2026-01-01-x\nTask: T01\nEvidence: .aidw/changes/x/evidence/T01.json");
    expect(isConventional(m)).toBe(true);
  });
  it("falls back to scope config, keeps acronyms, marks breaking changes", () => {
    expect(scopeOf(task({ specs: [] }))).toBe("config");
    expect(scopeOf(task({ specs: ["a/b/req"] }))).toBe("a-b");
    expect(subjectOf("API client works.", 60)).toBe("API client works");
    expect(header("feat", "api", "Drop v1", true)).toBe("feat(api)!: drop v1");
  });
  it("keeps the header within 72 characters and cuts at a word", () => {
    const h = header("feat", "expenses", "Add a very long title that goes on and on about expense categories and totals");
    expect(h.length).toBeLessThanOrEqual(72);
    expect(h.endsWith(" ")).toBe(false);
    expect(isConventional(h)).toBe(true);
  });
  it("types tasks added after approval from their origin", () => {
    expect(taskCommitMessage({ id: "C01", title: "Cover x", origin: "converge" }, "c", "e").startsWith("test(config):")).toBe(true);
    expect(typeProblem({ id: "C01", origin: "quality" })).toBeNull();
  });
  it("makes aidw bookkeeping commits chore(aidw)", () => {
    expect(isConventional(aidwCommitMessage("x delivered", "Evidence: y"))).toBe(true);
  });
  it("rejects a planned task without a valid type at analysis", () => {
    const yaml = (t: string) => `tasks:\n  - id: T01\n    title: x\n    role: qa-engineer\n${t}    touches: ["a/**"]\n    verify: ["x"]\n`;
    expect(validateTasksText(yaml(""), "t.yaml").errors.length).toBeGreaterThan(0);
    expect(validateTasksText(yaml("    type: feature\n"), "t.yaml").errors.length).toBeGreaterThan(0);
    expect(validateTasksText(yaml("    type: feat\n"), "t.yaml").errors).toHaveLength(0);
  });
});
