/**
 * T7 (D11): a Wave's merge conflict goes to the integration Role; afterwards both tasks' checks run again and the
 * merge is reviewed; any failure falls back to dropping the branch and rerunning the task sequentially. Every conflict
 * is recorded in the Change for the Technical Planner.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { AIDW_STATE_COMMAND } from "../src/policy.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, tempProject, write, planReviewed } from "./fixtures.js";

const ID = "2026-11-24-clash";
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
`;
const QUALITY = `layers:
  - name: code
    run: ['${ok}']
deploy:
  target: none
parallel:
  max: 3
`;

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
const g = (root: string, ...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const cdir = `.aidw/changes/${ID}`;
const wt = (root: string, t: string) => join(root, `.aidw/run/worktrees/${ID}/${t}`);
const task = (root: string, id: string) =>
  ((YAML.parse(readFileSync(join(root, cdir, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks.find((t) => t.id === id) ?? {}) as Record<string, unknown>;
const conflicts = (root: string) => (YAML.parse(readFileSync(join(root, cdir, "conflicts.yaml"), "utf8")) as { conflicts: Record<string, unknown>[] }).conflicts;
const next = (root: string) => cli(root, "next", "--json").json();

/** T01 and T02 run as a wave and both edit README.md outside their touches: T02's merge conflicts. */
function clash(): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
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
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);

  for (const t of ["T01", "T02"]) cli(root, "task", "start", t, "--worktree");
  write(wt(root, "T01"), "tests/a/booking.test.js", `test("${SCENARIO}: works", () => {})\n`);
  write(wt(root, "T01"), "README.md", "# demo\nfrom T01\n");
  write(wt(root, "T02"), "lib/b/report.js", "module.exports = 2;\n");
  write(wt(root, "T02"), "README.md", "# demo\nfrom T02\n");
  for (const t of ["T01", "T02"]) expect(cli(root, "checkpoint", t).code).toBe(0);
  expect(cli(root, "review", "T01", "pass").code).toBe(0);
  return root;
}

/** clash() plus T02's review: the conflict is open. */
function opened(): { root: string; review: Record<string, unknown> } {
  const root = clash();
  const r = cli(root, "review", "T02", "pass", "--json");
  expect(r.code).toBe(0);
  return { root, review: r.json() };
}

/** opened() plus the integration brief: the merge of the change branch is in progress in T02's worktree. */
function briefed(): { root: string; brief: string; out: string } {
  const { root } = opened();
  const r = cli(root, "brief", "T02", "--for", "conflict");
  expect(r.code).toBe(0);
  const path = r.out.split("\n")[0]!.trim();
  return { root, brief: readFileSync(path, "utf8"), out: r.out };
}

describe("a Wave's merge conflict goes to integration (D11)", () => {
  it("keeps the task's work, records the conflict for the Technical Planner and asks for the integration Role", () => {
    const { root, review } = opened();
    expect(review).toMatchObject({ status: "conflict", commit: null });
    expect(String(review.conflict)).toMatch(/README\.md/);
    expect(task(root, "T02")).toMatchObject({ status: "conflict", conflict: { with: ["T01"], files: ["README.md"] } });
    expect(existsSync(wt(root, "T02"))).toBe(true); // nothing is dropped yet
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01\n");
    expect(conflicts(root)).toEqual([expect.objectContaining({ task: "T02", with: ["T01"], files: ["README.md"], outcome: "open" })]);
    expect(next(root)).toMatchObject({ action: "resolve", task: "T02", with: ["T01"], files: ["README.md"] });
    const text = cli(root, "next").out;
    expect(text).toMatch(/aidw brief T02 --for conflict/);
    expect(text).toMatch(/aidw:integration/);
    expect(text).toMatch(/aidw resolve T02/);
    // the review command says what happens instead of "reruns sequentially"
    expect(readFileSync(join(root, cdir, "tasks.yaml"), "utf8")).not.toMatch(/sequential: true/);
  });

  it("briefs the integration Role with both tasks, the conflicting files and both branches, and starts the merge", () => {
    const { root, brief, out } = briefed();
    expect(out).toMatch(/SPAWN aidw:integration with: Conflict brief: .*T02\.conflict\.md/);
    expect(out).toMatch(/Then: aidw resolve T02/);
    for (const s of ["T01", "Booking logic", "T02", "Reports", "README.md", `aidw/${ID}.T02`, `aidw/${ID}`, wt(root, "T02"), "node check.js lib/b/report.js", SCENARIO]) {
      expect(brief).toContain(s);
    }
    expect(brief).toMatch(/do not (run )?`?git (add|commit)/i);
    // the CLI started the merge of the change branch into the task's worktree: the markers are there to resolve
    expect(readFileSync(join(wt(root, "T02"), "README.md"), "utf8")).toMatch(/^<<<<<<< /m);
    expect(existsSync(join(wt(root, "T02"), "tests/a/booking.test.js"))).toBe(true);
    // asking again does not start a second merge
    expect(cli(root, "brief", "T02", "--for", "conflict").code).toBe(0);
  });

  it("after the resolution reruns both tasks' checks, reviews the merge, then merges and records it resolved", () => {
    const { root } = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const r = cli(root, "resolve", "T02", "--json");
    expect(r.code).toBe(0);
    const res = r.json();
    expect(res).toMatchObject({ ok: true, task: "T02", with: ["T01"] });
    expect(res.checks.map((c: { task: string }) => c.task)).toEqual(["T02", "T01"]);
    expect(res.checks.find((c: { task: string }) => c.task === "T01").runs.map((x: { command: string }) => x.command)).toEqual([ok]);
    expect(res.checks.find((c: { task: string }) => c.task === "T02").runs.map((x: { command: string }) => x.command)).toEqual(["node check.js lib/b/report.js"]);
    expect(existsSync(join(root, cdir, "evidence/merge-T02.json"))).toBe(true);
    const text = cli(root, "next").out;
    expect(next(root)).toMatchObject({ action: "review-merge", task: "T02" });
    expect(text).toMatch(/aidw brief T02 --for merge-review/);

    const rb = cli(root, "brief", "T02", "--for", "merge-review");
    expect(rb.out).toMatch(/SPAWN aidw:code-reviewer/);
    const reviewBrief = readFileSync(rb.out.split("\n")[0]!.trim(), "utf8");
    for (const s of ["T01", "T02", "README.md", "VERDICT: pass", "review-T02.md", res.resolution as string]) expect(reviewBrief).toContain(s);

    write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nBoth lines kept.\n");
    const v = cli(root, "verdict", "T02", "--json");
    expect(v.code).toBe(0);
    expect(v.json()).toMatchObject({ status: "done" });
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01\nfrom T02\n");
    expect(readFileSync(join(root, "lib/b/report.js"), "utf8")).toBe("module.exports = 2;\n");
    expect(existsSync(wt(root, "T02"))).toBe(false);
    expect(g(root, "status", "--porcelain")).toBe("");
    expect(task(root, "T02")).toMatchObject({ status: "done" });
    expect(conflicts(root)).toEqual([expect.objectContaining({ task: "T02", with: ["T01"], files: ["README.md"], outcome: "resolved" })]);
    expect(next(root)).toMatchObject({ action: "integrate", tasks: ["T01", "T02"] });
  });

  it("falls back to dropping the task when the conflict is left unresolved", () => {
    const { root } = briefed();
    const r = cli(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, task: "T02" });
    expect(r.json().reason).toMatch(/conflict markers.*README\.md/);
    expectDropped(root);
  });

  it("falls back when a task's checks fail on the resolved code", () => {
    const { root } = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    execFileSync("git", ["rm", "-q", "lib/b/report.js"], { cwd: wt(root, "T02") }); // the resolution lost T02's work
    const r = cli(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/T02.*node check\.js lib\/b\/report\.js/);
    expectDropped(root);
    expect(existsSync(join(root, cdir, "evidence/merge-T02.json"))).toBe(true);
  });

  it("falls back when the review of the merge asks for fixes", () => {
    const { root } = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T02\n");
    expect(cli(root, "resolve", "T02").code).toBe(0);
    write(root, ".aidw/run/review-T02.md", "VERDICT: fix\n1. README.md: T01's line was dropped.\n");
    const v = cli(root, "verdict", "T02", "--json");
    expect(v.code).toBe(0);
    expect(v.json()).toMatchObject({ verdict: "fix", status: "pending" });
    expectDropped(root);
  });

  it("the planner's Role points at the record and the integration Role knows the conflict brief", () => {
    const plugin = join(__dirname, "..", "plugins", "aidw");
    expect(readFileSync(join(plugin, "roles/technical-planner/role.md"), "utf8")).toMatch(/conflicts\.yaml/);
    expect(readFileSync(join(plugin, "roles/integration/role.md"), "utf8")).toMatch(/Conflict brief/);
    expect(AIDW_STATE_COMMAND.test("aidw resolve T02")).toBe(true);
  });
});

function expectDropped(root: string): void {
  expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true, attempts: 0 });
  expect(task(root, "T02").conflict).toBeUndefined();
  expect(existsSync(wt(root, "T02"))).toBe(false);
  expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# demo\nfrom T01\n");
  expect(conflicts(root)).toEqual([expect.objectContaining({ task: "T02", with: ["T01"], outcome: "dropped" })]);
  expect(String(conflicts(root)[0]!.reason)).not.toBe("");
  expect(cli(root, "integrate").code).toBe(0);
  expect(next(root)).toMatchObject({ action: "implement", task: "T02" });
}
