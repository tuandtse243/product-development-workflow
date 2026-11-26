import { describe, expect, it } from "vitest";
import { canonicalTasks, validateTasksText } from "../src/tasks.js";
import { TASKS_YAML } from "./fixtures.js";

describe("validateTasksText", () => {
  it("accepts a valid task graph", () => {
    expect(validateTasksText(TASKS_YAML, "tasks.yaml").items).toEqual([]);
  });

  it("reports missing contract fields, unknown dependencies and cycles", () => {
    const text = `tasks:
  - id: A
    title: a
    role: backend-engineer
    type: feat
    depends_on: [C]
    touches: ["a/**"]
    verify: ["x"]
  - id: B
    title: b
    role: backend-engineer
    type: feat
    depends_on: [A, Z]
    touches: []
    verify: ["x"]
    status: weird
  - id: C
    title: c
    role: qa-engineer
    type: feat
    depends_on: [B]
    touches: ["c/**"]
`;
    const msgs = validateTasksText(text, "tasks.yaml").errors.map((e) => e.message);
    expect(msgs).toContain('task B needs a non-empty "touches" list of file globs');
    expect(msgs).toContain('task C needs a non-empty "verify" list');
    expect(msgs).toContain('task B depends on unknown task "Z"');
    expect(msgs.some((m) => m.startsWith("task B: unknown status"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("dependency cycle: A -> C -> B -> A"))).toBe(true);
  });

  it("rejects a file without a tasks list", () => {
    expect(validateTasksText("foo: 1\n", "t").errors[0]?.message).toMatch(/top-level "tasks:" list/);
  });
});

describe("canonicalTasks", () => {
  it("ignores runtime fields and converge-added tasks", () => {
    const progressed = TASKS_YAML.replace("status: pending", "status: done\n    attempts: 2\n    evidence: evidence/tasks/T01.md").concat(
      `  - id: T03\n    title: gap\n    role: qa-engineer\n    type: feat\n    origin: converge\n    touches: ["e2e/**"]\n    verify: ["x"]\n`,
    );
    expect(canonicalTasks(progressed)).toBe(canonicalTasks(TASKS_YAML));
  });

  it("changes when the planned contract changes", () => {
    expect(canonicalTasks(TASKS_YAML.replace("Booking page", "Booking pages"))).not.toBe(canonicalTasks(TASKS_YAML));
  });
});

describe("manual checks on a task (I11, M4)", () => {
  const task = (manual: string) => `tasks:
  - id: A
    title: a
    role: backend-engineer
    type: feat
    touches: ["a/**"]
    verify: ["x"]
${manual}`;

  it("accepts a list of checks that need a human", () => {
    expect(validateTasksText(task('    manual: ["the reset email arrives in a real inbox"]\n'), "tasks.yaml").items).toEqual([]);
  });

  it("refuses manual that is not a list of non-empty strings", () => {
    for (const bad of ["    manual: check the email\n", "    manual: [1]\n", '    manual: [""]\n']) {
      const msgs = validateTasksText(task(bad), "tasks.yaml").errors.map((e) => e.message);
      expect(msgs).toContain('task A: "manual" must be a list of checks a human makes, each a non-empty line');
    }
  });
});
