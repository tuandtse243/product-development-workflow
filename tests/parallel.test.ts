/**
 * S8 (D-29): parallel waves in git worktrees, merge per task, conflict fallback, integration verify.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { globsOverlap, planWave } from "../src/parallel.js";
import { findProject } from "../src/project.js";
import type { Task } from "../src/tasks.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, tempProject, write } from "./fixtures.js";

const ID = "2026-11-10-wave";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

const ok = 'node -e "process.exit(0)"';
const TASKS = (extra = "") => `tasks:
  - id: T01
    title: Booking logic
    role: backend-engineer
    scenarios: [${SCENARIO}]
    touches: ["lib/a/**", "tests/a/**"]
    verify: ['${ok}']
    status: pending
  - id: T02
    title: Reports
    role: backend-engineer
    touches: ["lib/b/**"]
    verify: ['node check.js lib/b/report.js']
    status: pending
  - id: T03
    title: Booking helper
    role: backend-engineer
    touches: ["lib/a/helper.js"]
    verify: ['${ok}']
    status: pending
${extra}`;

const QUALITY = (parallel = "parallel:\n  max: 3\n") => `layers:
  - name: code
    run: ['${ok}']
  - name: unit
    run: ['${ok}']
  - name: e2e
    run: ['${ok}']
deploy:
  target: none
${parallel}`;

function g(root: string, ...a: string[]) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
}

function project(tasks = TASKS(), quality = QUALITY()): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, `${c}/tasks.yaml`, tasks);
  write(root, `${c}/quality.yaml`, quality);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, "check.js", "process.exit(require('fs').existsSync(process.argv[2]) ? 0 : (console.log('missing ' + process.argv[2]), 1));\n");
  write(root, "README.md", "# demo\n");
  g(root, "init", "-q");
  g(root, "config", "user.email", "t@t");
  g(root, "config", "user.name", "t");
  g(root, "add", "-A");
  g(root, "commit", "-qm", "base");
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  return root;
}

const tasks = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const task = (root: string, id: string) => tasks(root).find((t) => t.id === id) as Record<string, unknown>;
const next = (root: string) => cli(root, "next", "--json").json();

describe("wave planning", () => {
  it("treats globs as overlapping unless their static prefixes differ", () => {
    expect(globsOverlap("app/api/**", "lib/**")).toBe(false);
    expect(globsOverlap("app/**", "app/page.tsx")).toBe(true);
    expect(globsOverlap("lib/a/x.ts", "lib/a/y.ts")).toBe(false);
    expect(globsOverlap("lib/a", "lib/a/x.ts")).toBe(true);
    expect(globsOverlap("**", "lib/x.ts")).toBe(true);
    expect(globsOverlap("src/*/x.ts", "src/a/y.ts")).toBe(true);
  });

  it("keeps high-risk, sequential, catch-all and second browser tasks out of a wave", () => {
    const t = (id: string, touches: string[], extra: Partial<Task> = {}): Task => ({ id, title: id, touches, verify: ["x"], status: "pending", ...extra });
    expect(planWave([t("A", ["lib/a/**"]), t("B", ["lib/b/**"]), t("C", ["lib/c/**"]), t("D", ["lib/d/**"])], 3).map((x) => x.id)).toEqual(["A", "B", "C"]);
    expect(planWave([t("A", ["lib/a/**"], { risk: "high" }), t("B", ["lib/b/**"])], 3).map((x) => x.id)).toEqual(["A"]);
    expect(planWave([t("A", ["lib/a/**"]), t("B", ["lib/b/**"], { sequential: true }), t("C", ["**"])], 3).map((x) => x.id)).toEqual(["A"]);
    expect(planWave([t("A", ["app/a/page.tsx"]), t("B", ["app/b/page.tsx"]), t("C", ["lib/c/**"])], 3).map((x) => x.id)).toEqual(["A", "C"]);
    expect(planWave([t("A", ["lib/a/**"], { verify: ["pnpm exec playwright test a"] }), t("B", ["lib/b/**"], { verify: ["pnpm exec playwright test b"] })], 3).map((x) => x.id)).toEqual(["A"]);
    expect(planWave([t("A", ["lib/a/**"]), t("B", ["lib/b/**"], { depends_on: ["A"] })], 3).map((x) => x.id)).toEqual(["A"]);
  });

  it("runs sequentially without git or with parallel.max 1", () => {
    const root = project(TASKS(), QUALITY("parallel:\n  max: 1\n"));
    expect(next(root)).toMatchObject({ action: "implement", task: "T01" });
  });
});

describe("a wave in worktrees (git)", () => {
  it("runs disjoint tasks in worktrees, merges each after review, then integrates before the next task", () => {
    const root = project();
    expect(next(root)).toEqual({ change: ID, action: "wave", tasks: [{ task: "T01", title: "Booking logic" }, { task: "T02", title: "Reports" }] });

    const s1 = cli(root, "task", "start", "T01", "--worktree", "--json").json();
    expect(s1).toMatchObject({ task: "T01", worktree: `.aidw/run/worktrees/${ID}/T01` });
    expect(cli(root, "task", "start", "T02", "--worktree").out).toMatch(/T02 running: attempt 1 of 3, base [0-9a-f]{8}, worktree \.aidw\/run\/worktrees\/.*\/T02/);
    const wt1 = join(root, s1.worktree);
    const wt2 = join(root, `.aidw/run/worktrees/${ID}/T02`);
    expect(g(wt1, "rev-parse", "--abbrev-ref", "HEAD")).toBe(`aidw/${ID}/T01`);
    expect(findProject({ cwd: join(wt1, "lib"), env: {} })).toBe(root);

    // the brief sends the implementer into the worktree
    const brief = readFileSync(cli(root, "brief", "T01").out.trim(), "utf8");
    expect(brief).toMatch(/## Working directory \(parallel wave\)[\s\S]*own git worktree: `.*\/T01` \(branch `aidw\/2026-11-10-wave\/T01`\)/);

    // implementers write only in their worktrees; the main checkout stays untouched
    write(wt1, "lib/a/booking.js", "module.exports = 1;\n");
    write(wt1, "tests/a/booking.test.js", `test("${SCENARIO}: works", () => {})\n`);
    write(wt2, "lib/b/report.js", "module.exports = 2;\n");
    expect(existsSync(join(root, "lib/a/booking.js"))).toBe(false);

    // checkpoints run in each worktree: the scenario test and verify are found there, not in the main checkout
    const c1 = cli(root, "checkpoint", "T01", "--json").json();
    expect(c1).toMatchObject({ ok: true, outside_touches: [], changed_files: ["lib/a/booking.js", "tests/a/booking.test.js"] });
    expect(c1.scenarios[SCENARIO]).toEqual(["tests/a/booking.test.js:1"]);
    expect(cli(root, "checkpoint", "T02").out).toMatch(/^PASS/);
    expect(readFileSync(cli(root, "brief", "T02", "--for", "review").out.trim(), "utf8")).toMatch(/in the worktree `.*\/T02`: `git diff [0-9a-f]+`/);

    // review pass merges into the change branch: one commit per task, worktree and branch removed
    expect(next(root)).toMatchObject({ action: "review", task: "T01" });
    expect(cli(root, "review", "T01", "pass").out).toMatch(/T01: review pass -> done \(commit [0-9a-f]{8}\)/);
    expect(cli(root, "review", "T02", "pass").code).toBe(0);
    expect(g(root, "log", "--first-parent", "--format=%s", "-3").split("\n")).toEqual(["T02: Reports", "T01: Booking logic", "base"]);
    expect(g(root, "log", "--format=%s").split("\n")).toContain("T01 (worktree): Booking logic");
    expect(readFileSync(join(root, "lib/a/booking.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(existsSync(wt1)).toBe(false);
    expect(g(root, "branch", "--list", "aidw/*")).toBe("");
    expect(g(root, "status", "--porcelain")).toBe("");
    expect(task(root, "T01")).toMatchObject({ status: "done" });
    expect(task(root, "T01").worktree).toBeUndefined();
    expect(typeof task(root, "T01").merged_at).toBe("string");

    // the wave is integrated before anything new starts, and before verifying
    expect(next(root)).toEqual({ change: ID, action: "integrate", tasks: ["T01", "T02"] });
    const integ = cli(root, "integrate", "--json").json();
    expect(integ).toMatchObject({ ok: true, tasks: ["T01", "T02"] });
    expect(integ.runs.map((r: { command: string }) => r.command)).toEqual([ok, "node check.js lib/b/report.js"]);
    expect(next(root)).toMatchObject({ action: "implement", task: "T03" });
    expect(cli(root, "approval", "check", ID).code).toBe(0); // runtime fields are not drift
  });

  it("turns a failing integration into a fix task that runs before anything else", () => {
    const root = project();
    for (const t of ["T01", "T02"]) cli(root, "task", "start", t, "--worktree");
    const wt = (t: string) => join(root, `.aidw/run/worktrees/${ID}/${t}`);
    write(wt("T01"), "tests/a/booking.test.js", `test("${SCENARIO}: works", () => {})\n`);
    write(wt("T02"), "lib/b/report.js", "module.exports = 2;\n");
    for (const t of ["T01", "T02"]) expect(cli(root, "checkpoint", t).code).toBe(0);
    for (const t of ["T01", "T02"]) cli(root, "review", t, "pass");
    execFileSync("git", ["rm", "-q", "lib/b/report.js"], { cwd: root }); // the merged code breaks
    execFileSync("git", ["commit", "-qm", "break"], { cwd: root });
    const r = cli(root, "integrate", "--json");
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, fixTask: "I01" });
    expect(task(root, "I01")).toMatchObject({ origin: "integration", touches: ["**"], verify: [ok, "node check.js lib/b/report.js"] });
    expect(String(task(root, "I01").problem)).toMatch(/Integration verify after merging T01, T02 failed: `node check.js lib\/b\/report.js` exited 1/);
    expect(next(root)).toMatchObject({ action: "implement", task: "I01" });
    expect(cli(root, "transition", ID, "verifying").err).toMatch(/needs every task done/);
  });

  it("drops a branch whose merge conflicts and reruns the task sequentially", () => {
    const root = project();
    for (const t of ["T01", "T02"]) cli(root, "task", "start", t, "--worktree");
    const wt = (t: string) => join(root, `.aidw/run/worktrees/${ID}/${t}`);
    write(wt("T01"), "tests/a/booking.test.js", `test("${SCENARIO}: works", () => {})\n`);
    write(wt("T01"), "README.md", "# demo\nfrom T01\n"); // both touch README outside their touches
    write(wt("T02"), "lib/b/report.js", "module.exports = 2;\n");
    write(wt("T02"), "README.md", "# demo\nfrom T02\n");
    for (const t of ["T01", "T02"]) expect(cli(root, "checkpoint", t).code).toBe(0);
    cli(root, "review", "T01", "pass");
    const r = cli(root, "review", "T02", "pass", "--json").json();
    expect(r).toMatchObject({ status: "pending", commit: null });
    expect(r.conflict).toMatch(/README\.md|CONFLICT|conflict/i);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true, attempts: 0 });
    expect(existsSync(wt("T02"))).toBe(false);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01\n");
    // T01 still needs its integration; then T02 runs alone on the main checkout
    expect(cli(root, "integrate").code).toBe(0);
    const n = next(root);
    expect(n).toMatchObject({ action: "implement", task: "T02" });
    expect(cli(root, "task", "start", "T02", "--worktree").err).toMatch(/T02 is marked sequential; start it without --worktree/);
    expect(cli(root, "task", "start", "T02", "--json").json().worktree).toBeUndefined();
  });

  it("marks a task sequential when the worktree setup fails", () => {
    const root = project(TASKS(), QUALITY("parallel:\n  max: 3\n  setup: ['node -e \"process.exit(3)\"']\n"));
    const r = cli(root, "task", "start", "T01", "--worktree");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/worktree setup .* failed for T01 \(exit 3\); T01 is marked sequential/);
    expect(task(root, "T01")).toMatchObject({ status: "pending", sequential: true });
    expect(existsSync(join(root, `.aidw/run/worktrees/${ID}/T01`))).toBe(false);
  });
});

describe("gate in worktrees", () => {
  const hook = (cwd: string, file: string, agent_type = "aidw:implementer"): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: file },
    cwd,
    agent_type,
  });

  it("lets implementers write the worktree's code but not its stale .aidw/, and blocks aidw run", () => {
    const root = project();
    cli(root, "task", "start", "T01", "--worktree");
    const wt = join(root, `.aidw/run/worktrees/${ID}/T01`);
    const d = (h: HookInput) => decide(h, {})?.decision ?? "none";
    expect(d(hook(wt, join(wt, "lib/a/x.js")))).toBe("allow");
    expect(d(hook(wt, join(wt, ".aidw/changes/x/tasks.yaml")))).toBe("deny");
    expect(d(hook(wt, join(wt, "lib/a/x.js"), "aidw:reviewer"))).toBe("deny");
    expect(d(hook(root, join(root, `.aidw/run/worktrees/${ID}`)))).toBe("deny");
    const bash = (command: string): HookInput => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root });
    expect(decide(bash("aidw run 2026-11-10-wave"), {})).toMatchObject({ decision: "deny" });
    expect(decide(bash("aidw integrate"), {})).toBeNull();
    cli(root, "transition", ID, "paused", "--reason", "x");
    expect(d(hook(wt, join(wt, "lib/a/x.js")))).toBe("deny");
  });
});
