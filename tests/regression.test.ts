import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, QUALITY_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-14-fix-add";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const git = (root: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" });

/** A bugfix change, approved, with the buggy code committed; T01 is running and its base commit is the buggy code. */
function running(opts: { baseTest?: string } = {}): string {
  const root = tempProject();
  cli(root, "init");
  expect(cli(root, "change", "new", ID, "--workflow", "bugfix").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/tasks.yaml`, `tasks:\n  - id: T01\n    title: Fix add\n    role: fullstack\n    type: fix\n    scope: math\n    touches: ["lib/**", "tests/**"]\n    verify: ["node tests/regress.test.js"]\n    status: pending\n`);
  write(root, "lib/bug.js", "exports.add = (a, b) => a - b;\n");
  if (opts.baseTest) write(root, "tests/regress.test.js", opts.baseTest);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  expect(cli(root, "approve", ID, "--auto").code).toBe(0);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  expect(cli(root, "task", "start", "T01").code).toBe(0);
  return root;
}
const test = (body: string) => `const assert = require("node:assert");\nconst { add } = require("../lib/bug.js");\n${body}\n`;
const evidence = (root: string) => JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/T01.json"), "utf8")).checkpoints.at(-1);

describe("a bugfix proves its regression test on the old code", () => {
  it("passes when the new test fails on the base commit and passes now", () => {
    const root = running();
    write(root, "lib/bug.js", "exports.add = (a, b) => a + b;\n");
    write(root, "tests/regress.test.js", test("assert.strictEqual(add(2, 3), 5);"));
    const r = cli(root, "checkpoint", "T01");
    expect(r.code, r.out + r.err).toBe(0);
    expect(evidence(root).regression).toMatchObject({ status: "red", files: ["tests/regress.test.js"], command: "node tests/regress.test.js" });
    // the check left nothing behind
    expect(existsSync(join(root, ".aidw/run/worktrees", ID, "T01-red"))).toBe(false);
    expect(git(root, "branch", "--list", "*T01-red").trim()).toBe("");
  });

  it("fails when the new test passes on the old code: it does not reproduce the bug", () => {
    const root = running();
    write(root, "lib/bug.js", "exports.add = (a, b) => a + b;\n");
    write(root, "tests/regress.test.js", test("assert.strictEqual(add(2, 0), 2);")); // a - 0 is also 2
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no regression proof: the new tests pass on the old code/);
    expect(evidence(root).regression.status).toBe("not-red");
    expect(JSON.stringify(cli(root, "next", "--json"))).toBeTruthy();
    expect(readFileSync(cli(root, "brief", "T01").out.trim(), "utf8")).toMatch(/Regression proof failed: the new tests pass on the old code/);
  });

  it("fails when the task changed no test file", () => {
    const root = running({ baseTest: test("assert.strictEqual(add(2, 0), 2);") });
    write(root, "lib/bug.js", "exports.add = (a, b) => a + b;\n");
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/no regression proof: the task changed no test file/);
  });

  it("tells the reviewer what was proven", () => {
    const root = running();
    write(root, "lib/bug.js", "exports.add = (a, b) => a + b;\n");
    write(root, "tests/regress.test.js", test("assert.strictEqual(add(2, 3), 5);"));
    cli(root, "checkpoint", "T01");
    const brief = readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8");
    expect(brief).toMatch(/Regression proof \(done by aidw\): the new tests \(`tests\/regress\.test\.js`\) FAIL on the base commit/);
  });

  it("names the commit scope after the task's `scope` field", () => {
    const root = running();
    write(root, "lib/bug.js", "exports.add = (a, b) => a + b;\n");
    write(root, "tests/regress.test.js", test("assert.strictEqual(add(2, 3), 5);"));
    cli(root, "checkpoint", "T01");
    write(root, ".aidw/run/review-T01.md", "VERDICT: pass\n");
    expect(cli(root, "verdict", "T01").code).toBe(0);
    expect(git(root, "log", "-3", "--format=%s")).toMatch(/^fix\(math\): fix add/m);
  });
});
