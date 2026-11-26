/**
 * T7 (D11) edge cases of the integration flow for a Wave's merge conflict: three tasks, a second conflict on the final
 * merge, a session restart in the middle, an integration Agent that staged or committed itself, conflicts outside the
 * plain text case, and the runner.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, tempProject, write, planReviewed } from "./fixtures.js";

const ID = "2026-11-24-clash3";
const SCENARIO = "booking/reschedule-appointment/reschedule-appointment-works";
const ok = 'node -e "process.exit(0)"';
const TASKS = `tasks:
  - id: T01
    title: Booking logic
    role: backend
    type: feat
    scenarios: [${SCENARIO}]
    touches: ["lib/a/**", "tests/a/**"]
    verify: ['${ok}']
    status: pending
  - id: T02
    title: Reports
    role: backend
    type: feat
    touches: ["lib/b/**"]
    verify: ['node check.js lib/b/report.js']
    status: pending
  - id: T03
    title: Exports
    role: backend
    type: feat
    touches: ["lib/c/**"]
    verify: ['node check.js lib/c/export.js']
    status: pending
`;
const QUALITY = `layers:
  - name: code
    run: ['${ok}']
deploy:
  target: none
parallel:
  max: 3
`;

function cli(root: string, argv: string[], env: NodeJS.ProcessEnv = {}) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], env, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
const c = (root: string, ...argv: string[]) => cli(root, argv);
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const cdir = `.aidw/changes/${ID}`;
const wt = (root: string, t: string) => join(root, `.aidw/run/worktrees/${ID}/${t}`);
const task = (root: string, id: string) =>
  ((YAML.parse(readFileSync(join(root, cdir, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks.find((t) => t.id === id) ?? {}) as Record<string, unknown>;
const conflicts = (root: string) => (YAML.parse(readFileSync(join(root, cdir, "conflicts.yaml"), "utf8")) as { conflicts: Record<string, unknown>[] }).conflicts;
const next = (root: string) => c(root, "next", "--json").json();
const own: Record<string, [string, string]> = { T01: ["tests/a/booking.test.js", `test("${SCENARIO}: works", () => {})\n`], T02: ["lib/b/report.js", "module.exports = 2;\n"], T03: ["lib/c/export.js", "module.exports = 3;\n"] };

/**
 * An approved, executing change with three tasks started as one wave. `edits(t)` is what each task writes besides its
 * own file (by default a line in README.md, so every pair of tasks conflicts there). All are checkpointed.
 */
function wave(ids: string[] = ["T01", "T02", "T03"], edits: (t: string) => Record<string, string> = (t) => ({ "README.md": `# demo\nfrom ${t}\n` })): string {
  const root = tempProject();
  c(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  c(root, "change", "new", ID);
  write(root, `${cdir}/analysis.md`, ANALYSIS_MD);
  write(root, `${cdir}/tasks.yaml`, TASKS);
  write(root, `${cdir}/quality.yaml`, QUALITY);
  write(root, `${cdir}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, "check.js", "process.exit(require('fs').existsSync(process.argv[2]) ? 0 : (console.log('missing ' + process.argv[2]), 1));\n");
  write(root, "README.md", "# demo\n");
  g(root, "init", "-q");
  g(root, "config", "user.email", "t@t");
  g(root, "config", "user.name", "t");
  g(root, "add", "-A");
  g(root, "commit", "-qm", "base");
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(c(root, "transition", ID, s).err).toBe("");
  expect(c(root, "approve", ID).code).toBe(0);
  expect(c(root, "transition", ID, "executing").code).toBe(0);
  for (const t of ids) expect(c(root, "task", "start", t, "--worktree").code).toBe(0);
  for (const t of ids) {
    const [f, body] = own[t]!;
    write(wt(root, t), f, body);
    for (const [file, text] of Object.entries(edits(t))) write(wt(root, t), file, text);
  }
  for (const t of ids) expect(c(root, "checkpoint", t).code).toBe(0);
  return root;
}

function brief(root: string, t: string): string {
  const r = c(root, "brief", t, "--for", "conflict");
  expect(r.code, r.err).toBe(0);
  return readFileSync(r.out.split("\n")[0]!.trim(), "utf8");
}

/** brief + resolution text + resolve + merge review pass. */
function integrate(root: string, t: string, readme: string): void {
  brief(root, t);
  write(wt(root, t), "README.md", readme);
  const r = c(root, "resolve", t);
  expect(r.code, r.out + r.err).toBe(0);
  expect(c(root, "brief", t, "--for", "merge-review").code).toBe(0);
  write(root, `.aidw/run/review-${t}.md`, "VERDICT: pass\nok\n");
  const v = c(root, "verdict", t, "--json");
  expect(v.code, v.err).toBe(0);
  expect(v.json()).toMatchObject({ status: "done" });
}

describe("three tasks of a Wave meet in one file", () => {
  it("resolves both later tasks one after the other; every conflict is recorded and closed", () => {
    const root = wave();
    expect(c(root, "review", "T01", "pass").code).toBe(0);
    expect(c(root, "review", "T02", "pass", "--json").json()).toMatchObject({ status: "conflict" });
    expect(c(root, "review", "T03", "pass", "--json").json()).toMatchObject({ status: "conflict" });
    // two open conflicts at once: file order, and nothing is integrated while one is open
    expect(next(root)).toMatchObject({ action: "resolve", task: "T02", with: ["T01"] });
    integrate(root, "T02", "# demo\nfrom T01\nfrom T02\n");
    expect(next(root)).toMatchObject({ action: "resolve", task: "T03" });
    integrate(root, "T03", "# demo\nfrom T01\nfrom T02\nfrom T03\n");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01\nfrom T02\nfrom T03\n");
    for (const f of ["lib/b/report.js", "lib/c/export.js", "tests/a/booking.test.js"]) expect(existsSync(join(root, f))).toBe(true);
    expect(conflicts(root).map((r) => [r.task, r.outcome])).toEqual([
      ["T02", "resolved"],
      ["T03", "resolved"],
    ]);
    expect(next(root)).toMatchObject({ action: "integrate", tasks: ["T01", "T02", "T03"] });
  });

  it("a task merged with a third conflicts with two: the record names both", () => {
    const root = wave();
    expect(c(root, "review", "T01", "pass").code).toBe(0);
    expect(c(root, "review", "T02", "pass").code).toBe(0);
    integrate(root, "T02", "# demo\nfrom T01\nfrom T02\n");
    // T03 is reviewed only now: both T01 and T02 changed README.md on the change branch since its base
    expect(c(root, "review", "T03", "pass", "--json").json()).toMatchObject({ status: "conflict" });
    expect(task(root, "T03").conflict).toMatchObject({ files: ["README.md"] });
    expect([...((task(root, "T03").conflict as { with: string[] }).with)].sort()).toEqual(["T01", "T02"]);
    const text = brief(root, "T03");
    for (const s of ["T01", "Booking logic", "T02", "Reports", "node check.js lib/b/report.js"]) expect(text).toContain(s);
    write(wt(root, "T03"), "README.md", "# demo\nfrom T01\nfrom T02\nfrom T03\n");
    const r = c(root, "resolve", "T03", "--json");
    expect(r.code).toBe(0);
    expect(r.json().checks.map((x: { task: string }) => x.task).sort()).toEqual(["T01", "T02", "T03"]);
  });

  it("a partner merged after the conflict was found is briefed and checked too", () => {
    // T02 and T03 both conflict with T01; T02 is resolved and merged first. When T03's merge is started, the change
    // branch carries T02's README line as well, so T02 is the other side of T03's conflict too.
    const root = wave();
    expect(c(root, "review", "T01", "pass").code).toBe(0);
    expect(c(root, "review", "T02", "pass").code).toBe(0);
    expect(c(root, "review", "T03", "pass").code).toBe(0);
    integrate(root, "T02", "# demo\nfrom T01\nfrom T02\n");
    const text = brief(root, "T03");
    expect(readFileSync(join(wt(root, "T03"), "README.md"), "utf8")).toMatch(/from T02/); // T02's side is in the merge
    expect(text).toContain("Reports"); // ... so the integration Role must know T02
    expect(text).toContain("node check.js lib/b/report.js");
    write(wt(root, "T03"), "README.md", "# demo\nfrom T01\nfrom T02\nfrom T03\n");
    const r = c(root, "resolve", "T03", "--json");
    expect(r.code).toBe(0);
    expect(r.json().checks.map((x: { task: string }) => x.task)).toContain("T02"); // ... and T02's checks run again
  });

  it("the partner still in the Wave: a running task does not block the resolution, integrate waits for it", () => {
    const root = wave(["T01", "T02"]);
    expect(c(root, "task", "start", "T03", "--worktree").code).toBe(0); // T03 still being implemented
    expect(c(root, "review", "T01", "pass").code).toBe(0);
    expect(c(root, "review", "T02", "pass", "--json").json()).toMatchObject({ status: "conflict", });
    integrate(root, "T02", "# demo\nfrom T01\nfrom T02\n");
    expect(task(root, "T03")).toMatchObject({ status: "running" });
    expect(next(root)).toMatchObject({ action: "implement", task: "T03" });
  });
});

describe("the final merge after a resolution", () => {
  it("conflicts again when the change branch moved on: the task is dropped and the record closed as dropped", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    expect(c(root, "resolve", "T02").code).toBe(0);
    // the change branch changes the same line before the merge review is recorded
    write(root, "README.md", "# demo\nfrom T01, edited\n");
    g(root, "commit", "-qam", "edit on the change branch");
    expect(c(root, "brief", "T02", "--for", "merge-review").code).toBe(0);
    write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nok\n");
    const v = c(root, "verdict", "T02", "--json");
    expect(v.code).toBe(0);
    expect(v.json()).toMatchObject({ status: "pending", commit: null });
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true, attempts: 0 });
    expect(task(root, "T02").conflict).toBeUndefined();
    expect(existsSync(wt(root, "T02"))).toBe(false);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01, edited\n");
    expect(g(root, "status", "--porcelain", "--", ":(exclude).aidw")).toBe(""); // no merge left half done
    const rec = conflicts(root);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ task: "T02", outcome: "dropped" });
    expect(String(rec[0]!.reason)).toMatch(/again/);
  });
});

describe("a session restart in the middle of the flow", () => {
  it("brief --for conflict twice keeps the merge and what the integration Agent already wrote", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    const onto = (task(root, "T02").conflict as Record<string, unknown>).onto;
    const mergeHead = g(wt(root, "T02"), "rev-parse", "MERGE_HEAD");
    expect(mergeHead).toBe(onto);
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n"); // the Agent's half-done work
    const again = brief(root, "T02");
    expect(again).toContain("README.md");
    expect((task(root, "T02").conflict as Record<string, unknown>).onto).toBe(onto);
    expect(g(wt(root, "T02"), "rev-parse", "MERGE_HEAD")).toBe(mergeHead);
    expect(readFileSync(join(wt(root, "T02"), "README.md"), "utf8")).toBe("# demo\nfrom T01\nfrom T02\n");
    expect(next(root)).toMatchObject({ action: "resolve", task: "T02" });
    expect(c(root, "resolve", "T02").code).toBe(0);
  });

  it("resolve before the brief refuses without dropping anything", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    const r = c(root, "resolve", "T02");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/aidw brief T02 --for conflict/);
    expect(task(root, "T02")).toMatchObject({ status: "conflict" });
    expect(existsSync(wt(root, "T02"))).toBe(true);
  });

  it("resolve twice: the second refuses and points at the merge review; nothing is dropped", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    expect(c(root, "resolve", "T02").code).toBe(0);
    const second = c(root, "resolve", "T02");
    expect(second.code).not.toBe(0);
    expect(second.err).toMatch(/merge-review/);
    expect(c(root, "brief", "T02", "--for", "conflict").err).toMatch(/merge-review/);
    expect(task(root, "T02")).toMatchObject({ status: "conflict", conflict: { phase: "review" } });
    expect(existsSync(wt(root, "T02"))).toBe(true);
    expect(conflicts(root)[0]).toMatchObject({ outcome: "open" });
  });

  it("the merge review brief after a restart (twice) still leads to the merge", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    expect(c(root, "resolve", "T02").code).toBe(0);
    expect(next(root)).toMatchObject({ action: "review-merge", task: "T02", with: ["T01"] });
    expect(c(root, "brief", "T02", "--for", "merge-review").code).toBe(0);
    expect(c(root, "brief", "T02", "--for", "merge-review").code).toBe(0);
    // a verdict is only recorded after the reviewer wrote it
    expect(c(root, "verdict", "T02").err).toMatch(/no verdict file/);
    write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nok\n");
    expect(c(root, "verdict", "T02", "--json").json()).toMatchObject({ status: "done" });
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01\nfrom T02\n");
  });

  it("a merge review brief before the resolution is refused", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    const r = c(root, "brief", "T02", "--for", "merge-review");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/not resolved yet/);
    // a plain review verdict cannot skip the integration either
    expect(c(root, "review", "T02", "pass").code).not.toBe(0);
    expect(task(root, "T02")).toMatchObject({ status: "conflict", conflict: { phase: "open" } });
  });
});

describe("what the integration Agent did with git", () => {
  function briefed(): string {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    return root;
  }

  it("it staged the resolution itself (git add): resolve still commits and checks it", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    g(wt(root, "T02"), "add", "README.md");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(0);
    expect(r.json().resolution).toBe(g(wt(root, "T02"), "rev-parse", "HEAD"));
    expect(g(wt(root, "T02"), "rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(3); // a merge commit
  });

  it("it staged a file that still has markers: refused and dropped", () => {
    const root = briefed();
    g(wt(root, "T02"), "add", "README.md");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/markers.*README\.md/);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
  });

  it("it committed the merge itself: the commit is accepted and both tasks' checks run", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    g(wt(root, "T02"), "commit", "-qam", "resolve");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(0);
    expect(r.json().checks.map((x: { task: string }) => x.task)).toEqual(["T02", "T01"]);
  });

  it("it aborted the merge: resolve drops the task", () => {
    const root = briefed();
    g(wt(root, "T02"), "merge", "--abort");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/aborted/);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
  });

  it("it left a dependency folder in the worktree: refused as junk, dropped", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    write(wt(root, "T02"), "node_modules/x/index.js", "module.exports = 1;\n");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/node_modules/);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
  });

  it("it added a credential in the resolution: refused as a secret, dropped", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", `# demo\nfrom T01\nfrom T02\nkey: AKIA${"A".repeat(16)}\n`);
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().ok).toBe(false);
    expect(g(root, "log", "--all", "-p").includes(`AKIA${"A".repeat(16)}`)).toBe(false);
  });

  it("it committed a credential itself: resolve still refuses it", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", `# demo\nfrom T01\nfrom T02\nkey: AKIA${"A".repeat(16)}\n`);
    g(wt(root, "T02"), "commit", "-qam", "resolve");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
  });

  it("it left conflict markers in a file outside the conflict list: refused", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    write(wt(root, "T02"), "lib/b/notes.md", "<<<<<<< HEAD\nfrom T01\n=======\nfrom T02\n>>>>>>> aidw\n");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/markers.*lib\/b\/notes\.md/);
  });
});

describe("conflicts that are not two text edits", () => {
  it("a change-branch commit that is no task's: no partner, only the task's own checks", () => {
    const root = wave(["T02"]);
    write(root, "README.md", "# demo\nby hand\n");
    g(root, "commit", "-qam", "edit on the change branch");
    expect(c(root, "review", "T02", "pass", "--json").json()).toMatchObject({ status: "conflict" });
    expect(task(root, "T02").conflict).toMatchObject({ with: [], files: ["README.md"] });
    const text = brief(root, "T02");
    expect(text).toMatch(/no task commit changed these files/);
    write(wt(root, "T02"), "README.md", "# demo\nby hand\nfrom T02\n");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ with: [] });
    expect(r.json().checks.map((x: { task: string }) => x.task)).toEqual(["T02"]);
  });

  it("a binary file both tasks changed: no marker can show it, so the brief drops the task (binary file)", () => {
    const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, n, 0, 1, 2, 3]);
    const root = wave(["T01", "T02"], () => ({}));
    for (const [t, n] of [["T01", 1], ["T02", 2]] as const) writeFileSync(join(wt(root, t), "logo.png"), png(n));
    // re-checkpoint is not needed: the files are committed at the merge (review pass)
    expect(c(root, "review", "T01", "pass").code).toBe(0);
    expect(c(root, "review", "T02", "pass", "--json").json()).toMatchObject({ status: "conflict" });
    expect(task(root, "T02").conflict).toMatchObject({ with: ["T01"], files: ["logo.png"] });
    const r = c(root, "brief", "T02", "--for", "conflict");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/binary file.*logo\.png/);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
    expect(existsSync(wt(root, "T02"))).toBe(false);
    expect(conflicts(root)[0]).toMatchObject({ outcome: "dropped" });
    expect(String(conflicts(root)[0]!.reason)).toMatch(/binary file/);
  });
});

describe("under the runner (aidw run)", () => {
  it("next names resolve and review-merge with the commands; the session ends only once the merge is done", () => {
    const root = wave(["T01", "T02"]);
    const env = { AIDW_RUNNER: "1" };
    c(root, "review", "T01", "pass");
    const rv = cli(root, ["review", "T02", "pass"], env);
    expect(rv.out).toMatch(/the integration Role resolves it/);
    expect(rv.out).toMatch(/NEXT: resolve the merge conflict of T02 with T01 \(README\.md\)/);
    expect(rv.out).not.toMatch(/END THIS SESSION/);
    expect(cli(root, ["brief", "T02", "--for", "conflict"], env).code).toBe(0);
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const rs = cli(root, ["resolve", "T02"], env);
    expect(rs.out).toMatch(/^RESOLVED T02/);
    expect(rs.out).toMatch(/SPAWN aidw:code-reviewer/);
    expect(rs.out).not.toMatch(/END THIS SESSION/);
    expect(cli(root, ["next"], env).out).toMatch(/review the merge of T02 with T01: `aidw brief T02 --for merge-review`/);
    write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nok\n");
    const v = cli(root, ["verdict", "T02"], env);
    expect(v.out).toMatch(/review pass -> done/);
    expect(v.out).toMatch(/END THIS SESSION/);
  });

  it("a dropped resolution prints DROPPED and the next step", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    const r = cli(root, ["resolve", "T02"], { AIDW_RUNNER: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^DROPPED T02: conflict markers/);
    expect(r.out).toMatch(/NEXT: /);
  });
});

describe("review findings (B1, N2, N4, N8)", () => {
  function briefed(): string {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    brief(root, "T02");
    return root;
  }

  it("a resolution that skips T01's scenario test is dropped by the checkpoint's guards", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    write(wt(root, "T02"), "tests/a/booking.test.js", `test.skip("${SCENARIO}: works", () => {})\n`);
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/skip|disabled|switched off|tests/i);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
    const ev = JSON.parse(readFileSync(join(root, cdir, "evidence/merge-T02.json"), "utf8"));
    expect(ev.guards.flatMap((x: { problems: string[] }) => x.problems).join("; ")).toMatch(/tests\/a\/booking\.test\.js/);
  });

  it("a resolution that deletes T01's scenario test is dropped", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    execFileSync("git", ["rm", "-q", "-f", "tests/a/booking.test.js"], { cwd: wt(root, "T02") });
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/tests\/a\/booking\.test\.js/);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
  });

  it("the brief's merge fails (a file in the way): dropped at once", () => {
    const root = wave(["T01", "T02"]);
    c(root, "review", "T01", "pass");
    c(root, "review", "T02", "pass");
    write(wt(root, "T02"), "tests/a/booking.test.js", "// in the way\n"); // untracked, the merge would overwrite it
    const r = c(root, "brief", "T02", "--for", "conflict");
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/could not be merged/);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
    expect(conflicts(root)[0]).toMatchObject({ outcome: "dropped" });
  });

  it("a check the machine refused leaves the conflict open; resolve again after the restart passes", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const flag = join(root, "refuse.flag");
    writeFileSync(flag, "1");
    // T02's verify (`node check.js ...`, run in the worktree) reports an environment refusal while the flag exists
    const check = `const fs=require('fs');if(fs.existsSync(${JSON.stringify(flag)})){console.log('EPERM: Operation not permitted');process.exit(1)}process.exit(fs.existsSync(process.argv[2])?0:1);\n`;
    write(wt(root, "T02"), "check.js", check);
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, blocked: true });
    const text = c(root, "next").out;
    expect(text).toMatch(/resolve the merge conflict of T02/);
    expect(task(root, "T02")).toMatchObject({ status: "conflict", conflict: { phase: "open" } });
    expect(existsSync(wt(root, "T02"))).toBe(true);
    expect(conflicts(root)[0]).toMatchObject({ outcome: "open" });
    // the merge commit is already there (restart after the resolve commit)
    expect(g(wt(root, "T02"), "rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(3);
    // run once more outside the sandbox (T10, B3: a second refusal would make the task not built): now it passes
    execFileSync("rm", [flag]);
    const again = c(root, "resolve", "T02", "--json");
    expect(again.code, again.out).toBe(0);
    expect(task(root, "T02")).toMatchObject({ conflict: { phase: "review" } });
  });

  it("a resolve the machine refuses twice leaves the task not built (environment) and closes its conflict", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const flag = join(root, "refuse.flag");
    writeFileSync(flag, "1");
    const check = `const fs=require('fs');if(fs.existsSync(${JSON.stringify(flag)})){console.log('EPERM: Operation not permitted');process.exit(1)}process.exit(fs.existsSync(process.argv[2])?0:1);\n`;
    write(wt(root, "T02"), "check.js", check);
    const first = c(root, "resolve", "T02");
    expect(first.out).toMatch(/^BLOCKED \(environment\) T02: .*nothing dropped/);
    expect(first.out).toMatch(/NEXT: .*aidw resolve T02 .*outside the sandbox/);
    const second = c(root, "resolve", "T02");
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/^NOT BUILT \(environment\) T02/);
    expect(task(root, "T02")).toMatchObject({ status: "not_built", not_built: { cause: "environment" } });
    expect(task(root, "T02").conflict).toBeUndefined();
    expect(existsSync(wt(root, "T02"))).toBe(false);
    expect(conflicts(root)[0]).toMatchObject({ outcome: "dropped" });
  });

  it("the record is closed as resolved only by the commit of the final merge", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    expect(c(root, "resolve", "T02").code).toBe(0);
    expect(conflicts(root)[0]).toMatchObject({ outcome: "open" });
    write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nok\n");
    expect(c(root, "verdict", "T02", "--json").json()).toMatchObject({ status: "done" });
    expect(conflicts(root)[0]).toMatchObject({ outcome: "resolved" });
    expect(g(root, "status", "--porcelain")).toBe("");
  });
});
