import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parseJunit } from "../src/quality.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, tempProject, write } from "./fixtures.js";

const ID = "2026-11-08-booking";
const S1 = "booking/reschedule-appointment/reschedule-appointment-works";
const S2 = "booking/waitlist/waitlist-works";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

const PRESENCE_Q = `layers:
  - name: code
    run: ['node -e "process.exit(0)"']
  - name: unit
    run: ['node -e "process.exit(0)"']
  - name: e2e
    run: ['node -e "process.exit(0)"']
`;

// The unit layer "runs tests" by copying cases.xml (set by the test) to the JUnit report path.
const JUNIT_Q = `layers:
  - name: code
    run: ['node -e "process.exit(0)"']
  - name: unit
    run: ["node junit.js"]
    reports: [test-results/junit.xml]
  - name: e2e
    run: ['node -e "process.exit(0)"']
`;

const junit = (cases: string) => `<?xml version="1.0"?>\n<testsuites><testsuite name="unit">${cases}</testsuite></testsuites>\n`;

function project(quality: string): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD.replace(/## Permissions\n\n.*\n/, "## Permissions\n\nNone\n"));
  write(root, `${c}/quality.yaml`, quality);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}\n${REQ("Waitlist")}`);
  write(
    root,
    `${c}/tasks.yaml`,
    `tasks:\n  - id: T01\n    title: Reschedule and waitlist\n    role: fullstack-engineer\n    scenarios: [${S1}, ${S2}]\n    touches: ["lib/**", "tests/**"]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`,
  );
  write(root, "junit.js", "const fs=require('fs');fs.mkdirSync('test-results',{recursive:true});fs.copyFileSync('cases.xml','test-results/junit.xml');\n");
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).err).toBe("");
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  return root;
}

function finishTask(root: string, task: string, work: () => void) {
  expect(cli(root, "task", "start", task).code).toBe(0);
  work();
  expect(cli(root, "checkpoint", task).out).toMatch(/^PASS/);
  expect(cli(root, "review", task, "pass").code).toBe(0);
}

function toConverging(root: string) {
  expect(cli(root, "transition", ID, "verifying").err).toBe("");
  expect(cli(root, "verify").out).toMatch(/^PASS/);
  expect(cli(root, "transition", ID, "converging").err).toBe("");
}

const tasks = (root: string) => (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")) as { tasks: Record<string, unknown>[] }).tasks;
const state = (root: string) => cli(root, "status", "--json").json().changes[0].state;

describe("JUnit parsing", () => {
  it("reads names, statuses and entities from vitest/Playwright/node reports", () => {
    const xml = junit(
      `<testcase classname="e2e/book.spec.ts" name="Booking &gt; ${S1}: moves it &amp; frees &quot;slot&quot;" time="1.2"/>` +
        `<testcase classname="unit" name="${S2}: joins"><failure message="expected 1">stack</failure></testcase>` +
        `<testcase name="a > b"><skipped/></testcase>`,
    );
    expect(parseJunit(xml)).toEqual([
      { name: `e2e/book.spec.ts > Booking > ${S1}: moves it & frees "slot"`, status: "pass" },
      { name: `unit > ${S2}: joins`, status: "fail" },
      { name: "a > b", status: "skipped" },
    ]);
  });
});

describe("converge with presence evidence", () => {
  it("adds a task per untested scenario, loops back through verify, then passes", () => {
    const root = project(PRESENCE_Q);
    finishTask(root, "T01", () => write(root, "tests/a.test.ts", `test("${S1}: works", () => {})\ntest("${S2}: joins", () => {})\n`));
    // later the S2 test gets skipped (a regression the per-task checkpoint no longer sees)
    write(root, "tests/a.test.ts", `test("${S1}: works", () => {})\ntest.skip("${S2}: later", () => {})\n`);
    toConverging(root);
    const r = cli(root, "converge", "--json");
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, mode: "presence", added: ["C01"] });
    expect(r.json().scenarios[S2]).toEqual({ status: "skipped", where: ["tests/a.test.ts:2 (skipped)"] });
    expect(state(root)).toBe("executing");
    const c01 = tasks(root).find((t) => t.id === "C01");
    expect(c01).toMatchObject({ origin: "converge", scenarios: [S2], specs: ["booking/waitlist"], touches: ["**"] });
    expect(c01?.verify).toEqual(['node -e "process.exit(0)"', 'node -e "process.exit(0)"']); // test layers, not code
    expect(String(c01?.problem)).toMatch(/skipped: tests\/a\.test\.ts:2/);
    expect(cli(root, "approval", "check", ID).code).toBe(0);

    finishTask(root, "C01", () => write(root, "tests/a.test.ts", `test("${S1}: works", () => {})\ntest("${S2}: joins", () => {})\n`));
    toConverging(root);
    expect(cli(root, "converge").out).toMatch(/^PASS \(presence\): all 2 scenario\(s\) have a passing test/);
    expect(cli(root, "transition", ID, "deploying").code).toBe(0);
  });

  it("escalates instead of looping when a converge task did not close the gap", () => {
    const root = project(PRESENCE_Q);
    const both = `test("${S1}: works", () => {})\ntest("${S2}: joins", () => {})\n`;
    const skipped = `test("${S1}: works", () => {})\ntest.todo("${S2}: joins")\n`;
    finishTask(root, "T01", () => write(root, "tests/a.test.ts", both));
    write(root, "tests/a.test.ts", skipped);
    toConverging(root);
    expect(cli(root, "converge", "--json").json().added).toEqual(["C01"]);
    finishTask(root, "C01", () => write(root, "tests/a.test.ts", both));
    write(root, "tests/a.test.ts", skipped);
    toConverging(root);
    const r = cli(root, "converge", "--json").json();
    expect(r).toMatchObject({ ok: false, escalated: [S2], added: [] });
    expect(state(root)).toBe("escalated");
  });
});

describe("converge with JUnit evidence", () => {
  it("trusts the report over the source: a skipped or failing case is a gap", () => {
    const root = project(JUNIT_Q);
    finishTask(root, "T01", () => {
      write(root, "tests/a.test.ts", `test("${S1}: works", () => {})\ntest("${S2}: joins", () => {})\n`);
      write(root, "cases.xml", junit(`<testcase name="${S1}: works"/><testcase name="${S2}: joins"><skipped/></testcase>`));
    });
    toConverging(root);
    const r = cli(root, "converge", "--json").json();
    expect(r.mode).toBe("junit");
    expect(r.scenarios[S1]).toEqual({ status: "pass", where: [`${S1}: works (pass)`] });
    expect(r.scenarios[S2].status).toBe("skipped");
    expect(r.added).toEqual(["C01"]);

    finishTask(root, "C01", () => write(root, "cases.xml", junit(`<testcase name="${S1}: works"/><testcase name="${S2}: joins"/>`)));
    toConverging(root);
    expect(cli(root, "converge").out).toMatch(/^PASS \(junit\)/);
  });

  it("ignores reports from a run older than the current code", () => {
    const root = project(JUNIT_Q);
    finishTask(root, "T01", () => {
      write(root, "tests/a.test.ts", `test("${S1}: works", () => {})\ntest("${S2}: joins", () => {})\n`);
      write(root, "cases.xml", junit(`<testcase name="${S1}: works"/><testcase name="${S2}: joins"/>`));
    });
    toConverging(root);
    // a stale summary (older than the last finished task) must not count
    const f = join(root, ".aidw/changes", ID, "evidence/quality/summary.json");
    const summary = JSON.parse(readFileSync(f, "utf8"));
    for (const l of Object.values(summary.layers) as { at: string }[]) l.at = "2000-01-01T00:00:00.000Z";
    write(root, `.aidw/changes/${ID}/evidence/quality/summary.json`, JSON.stringify(summary));
    expect(cli(root, "converge").err).toMatch(/quality layers not passing on the current code: code, unit, e2e/);
  });
});
