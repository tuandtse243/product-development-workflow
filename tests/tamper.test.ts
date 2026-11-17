import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { tamperEvidence } from "../src/tamper.js";
import { validateTasksText } from "../src/tasks.js";
import { ANALYSIS_MD, QUALITY_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-17-add-sum";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const git = (root: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" });

const OLD_TEST = 'const assert = require("node:assert");\nassert.ok(true);\n';
const LEGACY = "// eslint-disable-next-line no-console\nconsole.log(1);\n";

/** An approved change on a project that already has a test and a suppression; T01 is running. */
function running(taskExtra = ""): string {
  const root = tempProject();
  cli(root, "init");
  expect(cli(root, "change", "new", ID, "--workflow", "bugfix").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/tasks.yaml`, `tasks:\n  - id: T01\n    title: Add sum\n    role: fullstack\n    type: refactor\n    scope: math\n    touches: ["lib/**", "tests/**"]\n    verify: ["node -e 0"]\n${taskExtra}    status: pending\n`);
  write(root, "tests/old.test.js", OLD_TEST);
  write(root, "lib/legacy.js", LEGACY);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  expect(cli(root, "approve", ID, "--auto").code).toBe(0);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  expect(cli(root, "task", "start", "T01").code).toBe(0);
  return root;
}
const evidence = (root: string) => JSON.parse(readFileSync(join(root, ".aidw/changes", ID, "evidence/T01.json"), "utf8")).checkpoints.at(-1);

describe("the checkpoint refuses checks that were weakened", () => {
  it("passes a clean change and leaves the project's existing suppressions alone", () => {
    const root = running();
    write(root, "lib/sum.js", "exports.sum = (a, b) => a + b;\n");
    write(root, "lib/legacy.js", `${LEGACY}console.log(2);\n`);
    const r = cli(root, "checkpoint", "T01");
    expect(r.code, r.out + r.err).toBe(0);
    expect(evidence(root).tamper).toBeUndefined();
  });

  it("fails when a test file is deleted", () => {
    const root = running();
    rmSync(join(root, "tests/old.test.js"));
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/test file deleted: tests\/old\.test\.js/);
  });

  it("allows the deletion when the approved task says it removes tests", () => {
    const root = running("    removes_tests: true\n");
    rmSync(join(root, "tests/old.test.js"));
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
  });

  it("does not call a renamed test file deleted", () => {
    const root = running();
    git(root, "mv", "tests/old.test.js", "tests/renamed.test.js");
    const r = cli(root, "checkpoint", "T01");
    expect(r.code, r.out).toBe(0);
  });

  it("does not call a moved test file deleted when git has not tracked the new file yet", () => {
    const root = running();
    rmSync(join(root, "tests/old.test.js"));
    write(root, "tests/moved/old.test.js", OLD_TEST); // untracked: git cannot pair it as a rename
    const r = cli(root, "checkpoint", "T01");
    expect(r.code, r.out).toBe(0);
  });

  it("tells a moved test file from a deleted one by its test titles", () => {
    const root = tempProject();
    const isTest = (f: string) => /\.(?:test|spec)\./.test(f);
    git(root, "init", "-q");
    write(root, "e2e/home.spec.ts", 'test("home shows the empty state", async () => {});\ntest("home lists todos", async () => {});\n');
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    const base = git(root, "rev-parse", "HEAD").trim();
    rmSync(join(root, "e2e/home.spec.ts"));
    mkdirSync(join(root, "e2e/pages"), { recursive: true });
    write(root, "e2e/pages/home.spec.ts", 'import { test } from "@playwright/test";\ntest("home shows the empty state", async () => {});\ntest("home lists todos", async () => {});\ntest("home is new", async () => {});\n');
    expect(tamperEvidence(root, base, ["e2e/home.spec.ts", "e2e/pages/home.spec.ts"], { isTest })?.blocked).toEqual([]);
    // one of the two tests is gone: that is a deletion
    write(root, "e2e/pages/home.spec.ts", 'test("home shows the empty state", async () => {});\n');
    expect(tamperEvidence(root, base, ["e2e/home.spec.ts", "e2e/pages/home.spec.ts"], { isTest })?.blocked).toEqual([{ kind: "deleted-test", file: "e2e/home.spec.ts" }]);
  });

  it("fails on a skipped and on a focused test", () => {
    const root = running();
    write(root, "tests/new.test.js", 'it.skip("a", () => {});\ndescribe.only("b", () => {});\n');
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/test skipped: tests\/new\.test\.js:1/);
    expect(r.out).toMatch(/test focused with \.only: tests\/new\.test\.js:2/);
  });

  it("fails on a suppression without a reason, in an added line only", () => {
    const root = running();
    write(root, "lib/legacy.js", `${LEGACY}// @ts-ignore\nconst x = y as any;\n`);
    write(root, "lib/job.py", "import os  # noqa: F401\n");
    const r = cli(root, "checkpoint", "T01");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/check switched off without a reason on the same line: lib\/job\.py:1, lib\/legacy\.js:3, lib\/legacy\.js:4/);
    const brief = readFileSync(cli(root, "brief", "T01").out.trim(), "utf8");
    expect(brief).toMatch(/Check switched off without a reason on the same line: lib\/job\.py:1/);
  });

  it("passes a suppression that states its reason, and shows it to the reviewer", () => {
    const root = running();
    write(root, "lib/sum.ts", "// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the vendor SDK ships no types\nexport const sum = (a: number, b: number) => a + b;\nconst v = w as any; // the vendor SDK ships no types\n");
    const r = cli(root, "checkpoint", "T01");
    expect(r.code, r.out).toBe(0);
    expect(evidence(root).tamper.justified.map((f: { line: number }) => f.line)).toEqual([1, 3]);
    const brief = readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8");
    expect(brief).toMatch(/Checks the task switched off, each with a stated reason: `lib\/sum\.ts:1`, `lib\/sum\.ts:3`/);
  });

  it("lists a rewritten snapshot for the reviewer, not a new one", () => {
    const root = tempProject();
    cli(root, "init");
    expect(cli(root, "change", "new", ID, "--workflow", "bugfix").code).toBe(0);
    const c = `.aidw/changes/${ID}`;
    write(root, `${c}/analysis.md`, ANALYSIS_MD);
    write(root, `${c}/quality.yaml`, QUALITY_YAML);
    write(root, `${c}/tasks.yaml`, 'tasks:\n  - id: T01\n    title: Card\n    role: fullstack\n    type: refactor\n    scope: ui\n    touches: ["**"]\n    verify: ["node -e 0"]\n    status: pending\n');
    write(root, "ui/__snapshots__/card.test.tsx.snap", "exports[`card 1`] = `<p>old</p>`;\n");
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
    expect(cli(root, "approve", ID, "--auto").code).toBe(0);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    expect(cli(root, "transition", ID, "executing").code).toBe(0);
    expect(cli(root, "task", "start", "T01").code).toBe(0);
    write(root, "ui/__snapshots__/card.test.tsx.snap", "exports[`card 1`] = `<p>new</p>`;\n");
    write(root, "ui/__snapshots__/list.test.tsx.snap", "exports[`list 1`] = `<ul></ul>`;\n");
    expect(cli(root, "checkpoint", "T01").code).toBe(0);
    expect(evidence(root).tamper.snapshots).toEqual(["ui/__snapshots__/card.test.tsx.snap"]);
    const brief = readFileSync(cli(root, "brief", "T01", "--for", "review").out.trim(), "utf8");
    expect(brief).toMatch(/Stored snapshots this task rewrote or removed: `ui\/__snapshots__\/card\.test\.tsx\.snap`/);
  });

  it("rejects removes_tests that is not a boolean", () => {
    const d = validateTasksText('tasks:\n  - id: T01\n    title: A\n    role: fullstack\n    type: feat\n    touches: ["lib/**"]\n    verify: ["true"]\n    removes_tests: "yes"\n', "tasks.yaml");
    expect(d.errors.map((e) => e.message).join("\n")).toMatch(/"removes_tests" must be true or false/);
  });
});
