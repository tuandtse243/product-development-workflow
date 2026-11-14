import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gitDirtyPaths, runBackstop } from "../src/backstop.js";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { globToRegExp, matchesAny } from "../src/glob.js";
import { findScenarioTests } from "../src/run.js";
import { selectSkills } from "../src/skills.js";
import { ANALYSIS_MD, TOKENS_YAML, MAIN_SPEC, QUALITY_YAML, REQ, tempProject, write } from "./fixtures.js";

const ID = "2026-11-08-booking";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
const OK = `node -e "process.exit(0)"`;
const FAIL = `node -e "console.log(process.argv[1]); process.exit(3)" expected-2-slots-got-1`;

const RUN_TASKS = (t2Verify = OK) => `tasks:
  - id: T01
    title: Reschedule an appointment
    role: fullstack-engineer
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [${SCENARIO}]
    depends_on: []
    touches: ["app/api/bookings/**", "app/(site)/book/**", "tests/**"]
    verify: ['${OK}']
    status: pending
  - id: T02
    title: Staff calendar
    role: fullstack-engineer
    type: feat
    depends_on: [T01]
    touches: ["app/(staff)/**"]
    verify: ['${t2Verify}']
    max_attempts: 2
    status: pending
`;

function cli(root: string, ...argv: string[]) {
  // UI tasks need a fresh screenshot at checkpoint (design compliance); these flow tests always provide one.
  if (argv[0] === "checkpoint" && argv[1]) write(root, `.aidw/run/shots/${ID}/${argv[1]}/page.png`, "png");
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

const tasksOf = (root: string) =>
  (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const task = (root: string, id: string) => tasksOf(root).find((t) => t.id === id) as Record<string, unknown>;

function gitInit(root: string) {
  const g = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "aidw@test");
  g("config", "user.name", "aidw test");
  g("add", "-A");
  g("commit", "-q", "-m", "baseline");
}

/** Approved change in state executing. */
export function executingProject(opts: { git?: boolean; t2Verify?: string; quality?: string } = {}): string {
  const root = tempProject();
  expect(cli(root, "init").code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(root, "change", "new", ID, "--title", "Booking").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, "app/globals.css", ":root { --accent: #e5533d; --surface: #faf5ec; font-family: Inter; }\n.dark { --accent: #ff7a66; }\n");
  write(root, `${c}/tasks.yaml`, RUN_TASKS(opts.t2Verify));
  write(root, `${c}/quality.yaml`, opts.quality ?? QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, ".aidw/domain/model.md", "# Domain\n");
  write(root, ".aidw/decisions/0001-supabase.md", "# Use Supabase for auth and data\n");
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  expect(cli(root, "approve", ID).code).toBe(0);
  if (opts.git) gitInit(root);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  return root;
}

const SCENARIO_TEST = `import { test } from "vitest";\ntest("${SCENARIO}: moves the appointment", () => {});\n`;

describe("execution loop (exit criterion [4])", () => {
  let root: string;
  beforeEach(() => {
    root = executingProject();
  });

  it("refuses to run tasks before the change is executing", () => {
    const other = tempProject();
    cli(other, "init");
    cli(other, "change", "new", "x");
    write(other, ".aidw/changes/x/tasks.yaml", RUN_TASKS());
    const r = cli(other, "next");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/tasks run only in state executing/);
  });

  it("walks the graph: implement, checkpoint, review, next task, complete", () => {
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T01", reason: "new" });
    expect(cli(root, "task", "start", "T02").err).toMatch(/depends on unfinished task\(s\): T01/);
    expect(cli(root, "task", "start", "T01", "--json").json()).toMatchObject({ attempt: 1, maxAttempts: 3, resumed: false });

    // no test names the scenario yet: the checkpoint fails even though verify passes
    const fail = cli(root, "checkpoint", "T01");
    expect(fail.code).toBe(1);
    expect(fail.out).toMatch(/MISSING booking\/reschedule-appointment\/reschedule-appointment-works/);
    expect(task(root, "T01")).toMatchObject({ status: "failed", evidence: "evidence/T01.json" });
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T01", reason: "retry" });

    // the retry brief carries the failure and adds the debugging skill
    expect(cli(root, "task", "start", "T01", "--json").json().attempt).toBe(2);
    const brief = readFileSync(cli(root, "brief", "T01").out.trim(), "utf8");
    expect(brief).toMatch(/## Previous attempt/);
    expect(brief).toMatch(/Missing scenario tests: `booking\/reschedule-appointment\/reschedule-appointment-works`/);
    expect(brief).toMatch(/addy\/debugging-and-error-recovery\/SKILL\.md/);

    // implementer notes: the brief says where to write them; the review brief links the file only when it exists
    expect(brief).toMatch(/Only if the reviewer needs to know something[^\n]*report-T01\.md/);
    expect(readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8")).not.toMatch(/Implementer notes/);
    write(root, ".aidw/run/report-T01.md", "Touched lib/x.ts: shared helper.\n");
    expect(readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8")).toMatch(/Implementer notes: `\.aidw\/run\/report-T01\.md`/);
    expect(existsSync(join(root, ".aidw/run/report-T01.md"))).toBe(true);
    cli(root, "brief", "T01"); // a new implement brief drops the stale note
    expect(existsSync(join(root, ".aidw/run/report-T01.md"))).toBe(false);

    write(root, "tests/booking.test.ts", SCENARIO_TEST);
    const pass = cli(root, "checkpoint", "T01", "--json");
    expect(pass.code).toBe(0);
    expect(pass.json().scenarios[SCENARIO]).toEqual(["tests/booking.test.ts:2"]);
    expect(task(root, "T01").status).toBe("review");
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "review", task: "T01" });

    const reviewed = cli(root, "review", "T01", "pass", "--json");
    expect(reviewed.json()).toMatchObject({ status: "done", commit: null, warning: "not a git repository: task not committed" });
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T02" });

    cli(root, "task", "start", "T02");
    expect(cli(root, "checkpoint", "T02").code).toBe(0); // no scenarios: verify alone decides
    cli(root, "review", "T02", "pass");
    expect(cli(root, "next", "--json").json()).toEqual({ change: ID, action: "complete", done: 2 });

    // execution progress never counts as approval drift
    expect(cli(root, "approval", "check", ID).code).toBe(0);
    const ev = JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/T01.json"), "utf8"));
    expect(ev.checkpoints.map((c: { ok: boolean }) => c.ok)).toEqual([false, true]);
    expect(ev.reviews[0].verdict).toBe("pass");
  });

  it("feeds review notes back to the implementer and escalates when attempts run out", () => {
    root = executingProject({ t2Verify: FAIL });
    write(root, "tests/booking.test.ts", SCENARIO_TEST);
    cli(root, "task", "start", "T01");
    cli(root, "checkpoint", "T01");
    expect(cli(root, "review", "T01", "fix").err).toMatch(/needs --notes/);
    const notesFile = write(root, ".aidw/run/review-T01.md", "VERDICT: fix\n1. app/api/bookings/route.ts: no auth check.\n");
    expect(cli(root, "review", "T01", "fix", "--notes-file", notesFile, "--json").json()).toMatchObject({ status: "failed" });
    cli(root, "task", "start", "T01");
    expect(readFileSync(cli(root, "brief", "T01").out.trim(), "utf8")).toMatch(/The reviewer asked for fixes:[\s\S]*no auth check/);
    cli(root, "checkpoint", "T01");
    cli(root, "review", "T01", "pass");

    // T02 verify keeps failing: max_attempts 2, then escalate
    cli(root, "task", "start", "T02");
    const c1 = cli(root, "checkpoint", "T02");
    expect(c1.out).toMatch(/expected-2-slots-got-1/);
    expect(task(root, "T02").notes).toMatch(/verify failed: `node -e .*` \(exit 3\)/);
    cli(root, "task", "start", "T02");
    cli(root, "checkpoint", "T02");
    // out of attempts: one independent triage first (step 3); a spec cause stops for the user
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "triage", task: "T02" });
    write(root, ".aidw/run/triage-T02.md", "CAUSE: spec\nThe THEN of the scenario cannot be observed.\n");
    expect(cli(root, "triage", "T02").code).toBe(0);
    const n = cli(root, "next", "--json").json();
    expect(n).toMatchObject({ action: "escalate", task: "T02" });
    expect(n.reason).toMatch(/triage: spec/);
    expect(task(root, "T02").status).toBe("escalated");

    // the orchestrator escalates the change; the user resolves it and grants a retry
    expect(cli(root, "transition", ID, "escalated", "--reason", "T02 keeps failing").code).toBe(0);
    expect(cli(root, "task", "retry", "T02").err).toMatch(/tasks run only in state executing/);
    expect(cli(root, "transition", ID, "executing").code).toBe(0);
    expect(cli(root, "task", "retry", "T01").err).toMatch(/only escalated or failed tasks can be retried/);
    expect(cli(root, "task", "retry", "T02").code).toBe(0);
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T02", reason: "retry" });
    expect(cli(root, "task", "start", "T02", "--json").json().attempt).toBe(1);
    expect(readFileSync(cli(root, "brief", "T02").out.trim(), "utf8")).toMatch(/## Previous attempt[\s\S]*exit 3/);
  });

  it("resumes an interrupted task without counting a new attempt (exit criterion [5])", () => {
    cli(root, "task", "start", "T01");
    // session killed here; a new session asks what to do
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T01", reason: "interrupted" });
    expect(cli(root, "task", "start", "T01", "--json").json()).toMatchObject({ attempt: 1, resumed: true });
    expect(cli(root, "checkpoint", "T02").err).toMatch(/checkpoint needs a running task/);
    expect(cli(root, "review", "T01", "pass").err).toMatch(/only a checkpointed task \(review\) can be reviewed/);
  });

  it("pauses running changes on a StopFailure and resumes where it stopped", () => {
    cli(root, "task", "start", "T01");
    const r = run(["stop-failure"], { CLAUDE_PROJECT_DIR: root }, root, {
      out: () => {},
      err: () => {},
      stdin: () => JSON.stringify({ cwd: root, error: "rate_limit" }),
    });
    expect(r).toBe(0);
    expect(cli(root, "status", "--json").json().changes[0]).toMatchObject({ state: "paused", paused: { reason: "rate_limit" } });
    expect(cli(root, "next").err).toMatch(/run `aidw transition .* resume` first/);
    cli(root, "transition", ID, "resume");
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T01", reason: "interrupted" });
  });
});

describe("briefs", () => {
  it("packs the scenario, the requirement text, pointers and only the selected skills", () => {
    const root = executingProject();
    cli(root, "task", "start", "T01");
    const out = cli(root, "brief", "T01", "--json").json();
    expect(out.path).toBe(join(root, ".aidw/run/briefs", ID, "T01.implement.md"));
    const b = readFileSync(out.path, "utf8");
    expect(b).toMatch(/^# Task brief: T01 - Reschedule an appointment/);
    expect(b).toContain(`- \`${SCENARIO}\``);
    expect(b).toContain("### Requirement: Reschedule appointment");
    expect(b).toContain("`.aidw/domain/model.md`");
    expect(b).toContain("`.aidw/decisions/0001-supabase.md`: Use Supabase for auth and data");
    expect(b).not.toContain(".aidw/architecture/overview.md"); // absent files are not pointed to
    expect(b).not.toMatch(/## Resuming/);
    expect(out.skills.map((s: { id: string }) => s.id)).toEqual([
      "addy/incremental-implementation",
      "addy/test-driven-development",
      "addy/frontend-ui-engineering",
      "addy/api-and-interface-design",
    ]);

    const review = readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8");
    expect(review).toMatch(/You are an independent reviewer/);
    expect(review).toMatch(/`VERDICT: pass` or `VERDICT: fix`/);
    expect(review).toMatch(/addy\/code-review-and-quality\/SKILL\.md/);
    expect(review).not.toMatch(/test-driven-development/);
  });
});

describe("with git (checkpoint per task)", () => {
  it("commits each reviewed task, reports files outside touches, and resumes on prior work", () => {
    const root = executingProject({ git: true });
    const start = cli(root, "task", "start", "T01", "--json").json();
    expect(start.base).toMatch(/^[0-9a-f]{40}$/);
    write(root, "tests/booking.test.ts", SCENARIO_TEST);
    write(root, "app/api/bookings/route.ts", "export {};\n");
    write(root, "lib/stray.ts", "export {};\n");

    // a new session after an interruption sees the earlier work in its brief
    expect(readFileSync(cli(root, "brief", "T01").out.trim(), "utf8")).toMatch(new RegExp(`## Resuming[\\s\\S]*git diff ${start.base}`));

    const cp = cli(root, "checkpoint", "T01", "--json").json();
    expect(cp.changed_files).toEqual(["app/api/bookings/route.ts", "lib/stray.ts", "tests/booking.test.ts"]);
    expect(cp.outside_touches).toEqual(["lib/stray.ts"]);
    expect(readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8")).toMatch(/outside Touches: `lib\/stray.ts`/);

    const r = cli(root, "review", "T01", "pass", "--json").json();
    expect(r.commit).toMatch(/^[0-9a-f]{40}$/);
    const log = execFileSync("git", ["log", "--format=%s", "-n", "1"], { cwd: root, encoding: "utf8" });
    expect(log.trim()).toBe("feat(booking): reschedule an appointment");
    // code, tasks.yaml and evidence land in the same commit; run/ stays out of git
    expect(gitDirtyPaths(root)).toEqual([]);
    const files = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: root, encoding: "utf8" });
    expect(files).toContain(`.aidw/changes/${ID}/tasks.yaml`);
    expect(files).toContain(`.aidw/changes/${ID}/evidence/T01.json`);
    expect(files).not.toContain(".aidw/run/");
    expect(cli(root, "approval", "check", ID).code).toBe(0);
  });
});

describe("backstop with real git", () => {
  it("flags a file written around the gate before approval, but not pre-existing user files", () => {
    const root = tempProject();
    write(root, "notes.md", "the user's own file\n");
    gitInit(root);
    write(root, "notes.md", "the user's own file, edited\n");
    cli(root, "init");
    cli(root, "change", "new", "x"); // records notes.md in the baseline
    write(root, "src/sneaky.ts", "export {};\n"); // e.g. via python -c
    const out = JSON.parse(runBackstop(JSON.stringify({ cwd: root }), {}));
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/src\/sneaky\.ts/);
    expect(out.reason).not.toMatch(/notes\.md/);
  });
});

describe("scenario evidence", () => {
  it("matches scenario ids exactly, only in test files", () => {
    const root = tempProject();
    write(root, "e2e/book.spec.ts", "test('a/b/c: works', () => {})\ntest('a/b/c-d: other', () => {})\n");
    write(root, "src/a.ts", "// a/b/c is mentioned in source, which is not a test\n");
    write(root, "node_modules/x/a.test.js", "a/b/c\n");
    write(root, "tests/x.test.ts", "test.skip('a/b/x: later', () => {})\nit.todo('a/b/x: todo')\n");
    expect(findScenarioTests(root, ["a/b/c", "a/b/c-d", "a/b/x"])).toEqual({
      "a/b/c": ["e2e/book.spec.ts:1"],
      "a/b/c-d": ["e2e/book.spec.ts:2"],
      "a/b/x": [], // skipped or todo tests do not count
    });
  });
});

describe("skill selection", () => {
  const base = { id: "T", title: "x", role: "fullstack-engineer", type: "feat", verify: ["pnpm vitest"] };
  const ids = (t: Record<string, unknown>, kind: "implement" | "review" = "implement", retry = false) =>
    selectSkills({ ...base, ...t } as never, kind, { retry }).map((s) => s.id.replace("addy/", ""));

  it("loads the core plus what touches, risk and verify call for", () => {
    expect(ids({ touches: ["lib/booking/**"] })).toEqual(["incremental-implementation", "test-driven-development"]);
    expect(ids({ touches: ["components/calendar/**"] })).toEqual(["incremental-implementation", "test-driven-development", "frontend-ui-engineering"]);
    expect(ids({ touches: ["app/api/bookings/**"], verify: ["pnpm playwright test"] })).toEqual([
      "incremental-implementation",
      "test-driven-development",
      "api-and-interface-design",
      "browser-testing-with-devtools",
    ]);
    expect(ids({ touches: ["supabase/migrations/**"], title: "RLS policies for staff" })).toContain("security-and-hardening");
    expect(ids({ touches: ["app/(auth)/login/**"] })).toContain("security-and-hardening");
    expect(ids({ touches: ["lib/x/**"], risk: "high" }, "review")).toEqual(["code-review-and-quality", "security-and-hardening"]);
    expect(ids({ touches: ["lib/x/**"] }, "review")).toEqual(["code-review-and-quality"]);
    expect(ids({ touches: ["lib/x/**"], skills: ["performance-optimization"] }, "implement", true)).toEqual(
      expect.arrayContaining(["debugging-and-error-recovery", "performance-optimization"]),
    );
  });
});

describe("glob", () => {
  it("matches touches globs", () => {
    expect(matchesAny(["app/api/bookings/**"], "app/api/bookings/route.ts")).toBe(true);
    expect(matchesAny(["app/(site)/book/**"], "app/(site)/book/page.tsx")).toBe(true);
    expect(matchesAny(["lib/booking"], "lib/booking/slots.ts")).toBe(true);
    expect(matchesAny(["lib/*.ts"], "lib/a.ts")).toBe(true);
    expect(matchesAny(["lib/*.ts"], "lib/x/a.ts")).toBe(false);
    expect(matchesAny(["**/*.test.ts"], "a/b/c.test.ts")).toBe(true);
    expect(matchesAny(["src/{a,b}/**"], "src/b/x.ts")).toBe(true);
    expect(globToRegExp("lib/booking/**").test("lib/bookings/x.ts")).toBe(false);
  });
});

describe("gate for subagents", () => {
  let root: string;
  beforeAll(() => {
    root = executingProject();
  });
  const hook = (agent_type: string | undefined, tool_name: string, tool_input: Record<string, unknown>): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    cwd: root,
    ...(agent_type ? { agent_type } : {}),
  });
  const d = (h: HookInput) => decide(h, {})?.decision ?? "none";

  it("keeps an authoring role inside .aidw/, with the Write tool, and out of aidw state", () => {
    for (const a of ["aidw:product-manager", "aidw:software-architect", "aidw:technical-planner"]) {
      expect(d(hook(a, "Write", { file_path: "src/a.ts" })), a).toBe("deny");
      expect(d(hook(a, "Edit", { file_path: "README.md" })), a).toBe("deny");
      expect(d(hook(a, "Bash", { command: "echo x > src/a.ts" })), a).toBe("deny");
      expect(d(hook(a, "Bash", { command: "aidw transition T01 executing" })), a).toBe("deny");
      expect(d(hook(a, "Bash", { command: "git commit -m x" })), a).toBe("deny");
      expect(d(hook(a, "Bash", { command: "aidw validate" })), a).toBe("none");
    }
    // inside .aidw/ the normal rules apply: the approved package is frozen, the task list is not
    expect(d(hook("aidw:technical-planner", "Edit", { file_path: `.aidw/changes/${ID}/analysis.md` }))).toBe("deny");
    expect(d(hook("aidw:technical-planner", "Write", { file_path: `.aidw/changes/${ID}/tasks.yaml` }))).toBe("allow");
    expect(d(hook("aidw:product-manager", "Write", { file_path: ".aidw/domain/model.md" }))).toBe("deny"); // frozen while executing
  });

  it("keeps the reviewer read-only and the implementer out of aidw state", () => {
    expect(d(hook("aidw:code-reviewer", "Write", { file_path: "src/a.ts" }))).toBe("deny");
    expect(d(hook("aidw:code-reviewer", "Bash", { command: "echo x > src/a.ts" }))).toBe("deny");
    expect(d(hook("aidw:code-reviewer", "Bash", { command: "pnpm vitest run" }))).toBe("none");
    expect(d(hook("aidw:code-reviewer", "Bash", { command: "aidw review T01 pass" }))).toBe("deny");
    expect(d(hook("aidw:fullstack", "Write", { file_path: "src/a.ts" }))).toBe("allow");
    expect(d(hook("aidw:fullstack", "Edit", { file_path: `.aidw/changes/${ID}/tasks.yaml` }))).toBe("deny");
    expect(d(hook("aidw:fullstack", "Bash", { command: "aidw checkpoint T01" }))).toBe("deny");
    expect(d(hook("aidw:fullstack", "Bash", { command: "git commit -m done" }))).toBe("deny");
    expect(d(hook("aidw:fullstack", "Bash", { command: "aidw status" }))).toBe("none");
    // the orchestrator (main session) does all of it
    expect(d(hook(undefined, "Bash", { command: "aidw checkpoint T01" }))).toBe("none");
    expect(d(hook(undefined, "Edit", { file_path: `.aidw/changes/${ID}/tasks.yaml` }))).toBe("allow");
  });

  it("does not let an aidw command smuggle a write through before approval", () => {
    const fresh = tempProject();
    cli(fresh, "init");
    const h = (command: string): HookInput => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: fresh });
    expect(decide(h("aidw status && echo x > src/a.ts"), {})?.decision).toBe("deny");
    expect(decide(h("aidw status --json | head -5"), {})).toBeNull();
    expect(decide(h('aidw transition x paused --reason "a > b"'), {})).toBeNull(); // quoted: not a redirect
    expect(decide(h('aidw transition x paused --reason "a" > src/a.ts'), {})?.decision).toBe("deny");
  });
});
