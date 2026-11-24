/**
* Re-review probes of the T7 fixes (45537d7).
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
import { ANALYSIS_MD, MAIN_SPEC, REQ, tempProject, write } from "./fixtures.js";

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
function wave(ids: string[] = ["T01", "T02", "T03"], edits: (t: string) => Record<string, string> = (t) => ({ "README.md": `# demo\nfrom ${t}\n` }), tasks = TASKS, extra: Record<string, string> = {}): string {
  const root = tempProject();
  c(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  c(root, "change", "new", ID);
  write(root, `${cdir}/analysis.md`, ANALYSIS_MD);
  write(root, `${cdir}/tasks.yaml`, tasks);
  for (const [f, body] of Object.entries(extra)) write(root, f, body);
  write(root, `${cdir}/quality.yaml`, QUALITY);
  write(root, `${cdir}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, "check.js", "process.exit(require('fs').existsSync(process.argv[2]) ? 0 : (console.log('missing ' + process.argv[2]), 1));\n");
  write(root, "README.md", "# demo\n");
  g(root, "init", "-q");
  g(root, "config", "user.email", "t@t");
  g(root, "config", "user.name", "t");
  g(root, "add", "-A");
  g(root, "commit", "-qm", "base");
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


function briefed(tasks = TASKS, extra: Record<string, string> = {}, edits?: (t: string) => Record<string, string>): string {
  const root = wave(["T01", "T02"], edits, tasks, extra);
  c(root, "review", "T01", "pass");
  c(root, "review", "T02", "pass");
  brief(root, "T02");
  return root;
}

describe("re-review of the T7 fixes", () => {
  it("blocking: an uncommitted edit left after a BLOCKED resolve is checked by verify but never by the guards, then merged", () => {
    const root = briefed(TASKS, { "tests/base.test.js": 'test("base behaviour", () => { expect(1).toBe(1); })\n' });
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const flag = join(root, "refuse.flag");
    writeFileSync(flag, "1");
    const check = `const fs=require('fs');if(fs.existsSync(${JSON.stringify(flag)})){console.log('EPERM: Operation not permitted');process.exit(1)}process.exit(fs.existsSync(process.argv[2])?0:1);\n`;
    write(wt(root, "T02"), "check.js", check);
    expect(c(root, "resolve", "T02", "--json").json()).toMatchObject({ blocked: true });
    // the merge is committed; now an uncommitted skip of a test neither side changed sits in the worktree
    write(wt(root, "T02"), "tests/base.test.js", 'test.skip("base behaviour", () => { expect(1).toBe(1); })\n');
    execFileSync("rm", [flag]);
    const r = c(root, "resolve", "T02", "--json");
    // expected: resolve refuses a worktree that differs from the commit it judged (or judges the worktree)
    if (r.code === 0) {
      // it goes on: the merge review reads the commit, and the final merge commits the worktree as it is
      write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nok\n");
      expect(c(root, "verdict", "T02", "--json").json()).toMatchObject({ status: "done" });
      expect(readFileSync(join(root, "tests/base.test.js"), "utf8")).toMatch(/test\.skip/);
    }
    expect(r.code, r.out).toBe(1);
  });

  it("blocking: a chore partner exempts the whole resolution from the check-configuration lock", () => {
    const tasks = TASKS.replace("title: Booking logic\n    role: backend\n    type: feat", "title: Booking logic\n    role: backend\n    type: chore");
    expect(tasks).toMatch(/type: chore/);
    const root = briefed(tasks, { ".eslintrc.json": '{ "rules": { "no-unused-vars": "error" } }\n' });
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    // neither task touched the lint config: the resolution switches a rule off
    write(wt(root, "T02"), ".eslintrc.json", '{ "rules": { "no-unused-vars": "off" } }\n');
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code, r.out).toBe(1);
  });

  it("note: a Markdown setext heading of seven '=' added by the partner drops a correct resolution", () => {
    const root = briefed(TASKS, {}, (t) => ({ "README.md": `# demo\nfrom ${t}\n`, ...(t === "T01" ? { "docs/release.md": "Release\n=======\n\nNotes.\n" } : {}) }));
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code, r.out).toBe(0);
  });
});

describe("the merge review merges only the reviewed commit", () => {
  function resolved(): string {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    expect(c(root, "resolve", "T02").code).toBe(0);
    write(root, ".aidw/run/review-T02.md", "VERDICT: pass\nok\n");
    return root;
  }

  it("an uncommitted edit after the resolution: dropped, nothing merged", () => {
    const root = resolved();
    write(wt(root, "T02"), "lib/b/extra.js", "module.exports = 9;\n");
    const v = c(root, "verdict", "T02", "--json");
    expect(v.json()).toMatchObject({ status: "pending" });
    expect(existsSync(join(root, "lib/b/extra.js"))).toBe(false);
    expect(task(root, "T02")).toMatchObject({ status: "pending", sequential: true });
    expect(conflicts(root)[0]).toMatchObject({ outcome: "dropped" });
  });

  it("a commit after the resolution: dropped, nothing merged", () => {
    const root = resolved();
    write(wt(root, "T02"), "lib/b/extra.js", "module.exports = 9;\n");
    g(wt(root, "T02"), "add", "-A", "--", "lib");
    g(wt(root, "T02"), "commit", "-qm", "later");
    expect(c(root, "verdict", "T02", "--json").json()).toMatchObject({ status: "pending" });
    expect(existsSync(join(root, "lib/b/extra.js"))).toBe(false);
  });

  it("a locked config file a chore partner changed itself is allowed, and the merge review names it", () => {
    const tasks = TASKS.replace("title: Booking logic\n    role: backend\n    type: feat", "title: Booking logic\n    role: backend\n    type: chore");
    const root = briefed(tasks, { ".eslintrc.json": '{ "rules": { "no-unused-vars": "error" } }\n' }, (t) => ({
      "README.md": `# demo\nfrom ${t}\n`,
      ...(t === "T01" ? { ".eslintrc.json": '{ "rules": { "no-unused-vars": "warn" } }\n' } : {}),
    }));
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code, r.out).toBe(0);
    const b = c(root, "brief", "T02", "--for", "merge-review");
    expect(readFileSync(b.out.split("\n")[0]!.trim(), "utf8")).toMatch(/Configuration of the checks[^\n]*\.eslintrc\.json/);
  });

  it("a real marker block is still found", () => {
    const root = briefed();
    write(wt(root, "T02"), "README.md", "# demo\nfrom T01\nfrom T02\n");
    write(wt(root, "T02"), "lib/b/notes.md", "x\n=======\ny\n|||||||\n");
    const r = c(root, "resolve", "T02", "--json");
    expect(r.code).toBe(1);
    expect(r.json().reason).toMatch(/markers.*lib\/b\/notes\.md/);
  });
});
