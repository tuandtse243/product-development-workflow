/**
 * S10 (D-31): brownfield detection at init, the Existing system section, lazy baseline specs approved with the
 * change and frozen while it runs.
 */
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { detectProject } from "../src/detect.js";
import { decide } from "../src/gate.js";
import { ANALYSIS_MD, tempProject, write } from "./fixtures.js";

const FIXTURE = join(__dirname, "..", "evals", "fixtures", "brownfield-app");
const ID = "2026-11-10-due-dates";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

function brownfield(): string {
  const root = tempProject();
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

const EXISTING = `
## Existing system

Next.js 15 app router, in-memory todo store in lib/todos.ts, one API route. Lint, typecheck and 2 unit tests pass
today. This change touches the todos capability (baseline spec written) and keeps the API shape.
`;

const DELTA = `## MODIFIED Requirements

### Requirement: Add a todo
The system SHALL add a todo with a trimmed title of 1 to 120 characters and an optional due date.

#### Scenario: Trimmed title
- **WHEN** a user adds "  buy milk "
- **THEN** the todo is stored as "buy milk"
`;

const BASELINE = `# Todos

<!-- aidw:baseline -->

## Purpose

Keeps an in-memory list of todos.

## Requirements

### Requirement: Add a todo
The system SHALL add a todo with a trimmed title of 1 to 120 characters.

#### Scenario: Trimmed title
- **WHEN** a user adds "  buy milk "
- **THEN** the todo is stored as "buy milk"
`;

describe("brownfield detection", () => {
  it("reads the stack, package manager and suggested layers from the existing code", () => {
    const d = detectProject(FIXTURE);
    expect(d.kind).toBe("brownfield");
    expect(d.packageManager).toBe("pnpm");
    expect(d.languages).toEqual(["TypeScript"]);
    expect(d.stack).toMatchObject({ framework: "Next.js 15.5.0", ui: "React 19.1.0", styling: "Tailwind CSS 4.1.0", "unit tests": "Vitest 3.2.0", "e2e tests": "Playwright 1.55.0", deploy: "Vercel" });
    expect(d.layers).toEqual([
      { name: "code", run: ["pnpm lint", "pnpm typecheck", "pnpm build"] },
      { name: "unit", run: ["pnpm test"] },
      { name: "e2e", run: ["pnpm test:e2e"] },
    ]);
    expect(d.signals[0]).toBe("package.json with 11 dependencies");
    expect(detectProject(tempProject())).toMatchObject({ kind: "greenfield", packageManager: null, layers: [] });
  });

  it("records brownfield in project.yaml at init and keeps the stack (source client)", () => {
    const root = brownfield();
    const r = cli(root, "init");
    expect(r.out).toMatch(/^initialized \.aidw\/ \(\d+ files\): brownfield\n {2}signal {2}package\.json with 11 dependencies[\s\S]*stack {3}framework: Next\.js 15\.5\.0/);
    const y = YAML.parse(readFileSync(join(root, ".aidw/project.yaml"), "utf8"));
    expect(y).toMatchObject({ kind: "brownfield", stack: { source: "client", items: { framework: "Next.js 15.5.0" } }, detected: { package_manager: "pnpm" } });
    expect(y.detected.suggested_layers.code).toEqual(["pnpm lint", "pnpm typecheck", "pnpm build"]);
    expect(cli(root, "detect").out).toMatch(/^brownfield \(pnpm\), TypeScript\n/);
    const green = tempProject();
    cli(green, "init");
    expect(readFileSync(join(green, ".aidw/project.yaml"), "utf8")).toMatch(/\nschema: 1\nkind: greenfield /);
  });
});

describe("brownfield analysis and baseline specs", () => {
  function analyzing() {
    const root = brownfield();
    cli(root, "init");
    cli(root, "change", "new", ID, "--input-type", "codebase");
    for (const s of ["intake", "analyzing"]) cli(root, "transition", ID, s);
    return root;
  }
  const errors = (root: string) => cli(root, "analyze", ID, "--json").json().errors.map((e: { message: string }) => e.message) as string[];

  it("asks for the Existing system section and a finished baseline spec", () => {
    const root = analyzing();
    expect(readFileSync(join(root, ".aidw/changes", ID, "analysis.md"), "utf8")).toMatch(/## Existing system\n\nTODO\(aidw\): brownfield assessment/);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD);
    expect(errors(root)).toContain('brownfield project: missing section "## Existing system" (assessment of the current code)');

    const b = cli(root, "baseline", "todos");
    expect(b.out).toMatch(/^wrote baseline skeleton \.aidw\/specs\/todos\/spec\.md/);
    expect(readFileSync(join(root, ".aidw/specs/todos/spec.md"), "utf8")).toMatch(/^# Todos\n\n<!-- aidw:baseline: current behavior of the existing code, written for change 2026-11-10-due-dates/);
    expect(cli(root, "baseline", "todos").err).toMatch(/already exists; a capability gets its baseline once/);
    expect(cli(root, "baseline", "Todos").err).toMatch(/must be kebab-case/);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD.replace("## Domain", `${EXISTING}\n## Domain`));
    expect(errors(root).some((m) => /unfinished baseline spec: unresolved TODO\(aidw\)/.test(m))).toBe(true);
    expect(errors(root)).not.toContain('brownfield project: missing section "## Existing system" (assessment of the current code)');
  });

  it("approves the baseline with the change and freezes it while the change runs", () => {
    const root = analyzing();
    cli(root, "baseline", "todos");
    write(root, ".aidw/specs/todos/spec.md", BASELINE);
    write(root, `.aidw/changes/${ID}/analysis.md`, ANALYSIS_MD.replace("## Domain", `${EXISTING}\n## Domain`));
    write(root, `.aidw/changes/${ID}/specs/todos/spec.md`, DELTA);
    write(root, `.aidw/changes/${ID}/tasks.yaml`, `tasks:\n  - id: T01\n    title: Due dates\n    role: fullstack-engineer\n    scenarios: [todos/add-a-todo/trimmed-title]\n    touches: ["lib/**", "tests/**"]\n    verify: ["pnpm test"]\n    status: pending\n`);
    write(root, `.aidw/changes/${ID}/quality.yaml`, "layers:\n  - name: code\n    run: [pnpm lint]\n  - name: unit\n    run: [pnpm test]\n  - name: e2e\n    run: [pnpm test:e2e]\ndeploy:\n  target: none\n");
    expect(errors(root)).toEqual([]);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(0);
    const a = cli(root, "approve", ID, "--json").json();
    expect(a.files).toContain(".aidw/specs/todos/spec.md");
    expect(cli(root, "baseline", "billing").err).toMatch(/baseline specs are written during the Analysis/);
    cli(root, "transition", ID, "executing");
    const edit = { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(root, ".aidw/specs/todos/spec.md") }, cwd: root };
    expect(decide(edit, {})?.decision).toBe("deny");
    write(root, ".aidw/specs/todos/spec.md", BASELINE.replace("Keeps", "Holds"));
    expect(cli(root, "approval", "check", ID).code).toBe(1);
  });
});
