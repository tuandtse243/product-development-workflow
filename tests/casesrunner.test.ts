import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { answerPrompt, buildGradePrompt, parseGrade, printResults, roleSystem, runCases, type Exec } from "../src/evalrun.js";
import { loadEvalCases, roleDigest } from "../src/evals.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const env = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin };
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
/** A copy of the plugin: `aidw eval` writes a result file into the Role's folder, never into the repo's during a test. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-cases-"));
  temps.push(root);
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  return root;
}

/** A model that answers "ANSWER" and grades every criterion with `pass`. */
const fake = (pass: boolean, seen: string[] = []): Exec => (prompt, system) => {
  seen.push(system ? `answer:${prompt.slice(0, 20)}` : "grade");
  if (system) return "ANSWER " + "x".repeat(400);
  const n = (prompt.match(/^\d+\. /gm) ?? []).length;
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, pass, reason: "r" })));
};

describe("the Role case runner", () => {
  it("gives the Role's instructions as the system prompt, not the generated front matter", () => {
    const s = roleSystem(plugin, "backend");
    expect(s.length).toBeGreaterThan(100);
    expect(s.startsWith("---")).toBe(false);
  });

  it("inlines the Role's skills, since an Agent without tools cannot read them", () => {
    const s = roleSystem(plugin, "database");
    expect(s).toContain("## Your skills, in full");
    expect(s).toContain("### Skill: expand-contract");
    expect(s).toContain("### Skill: prisma-migration");
    expect(s).not.toMatch(/^name: expand-contract/m); // the skill's front matter is dropped
    expect(roleSystem(plugin, "fullstack")).not.toContain("Your skills, in full"); // a Role with no skills
  });

  it("passes a case when every criterion passes, and fails it otherwise", () => {
    const ok = runCases(plugin, "backend", undefined, fake(true));
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.every((r) => r.pass && r.answer.startsWith("ANSWER"))).toBe(true);
    expect(runCases(plugin, "backend", undefined, fake(false)).every((r) => !r.pass)).toBe(true);
  });

  it("runs one answer call and one grading call per case", () => {
    const seen: string[] = [];
    const rs = runCases(plugin, "backend", undefined, fake(true, seen));
    expect(seen).toHaveLength(rs.length * 2);
  });

  it("runs every active Role when none is named, and rejects an unknown Role or case", () => {
    const all = runCases(plugin, undefined, undefined, fake(true));
    expect(new Set(all.map((r) => r.role)).size).toBeGreaterThanOrEqual(8);
    expect(() => runCases(plugin, "ghost", undefined, fake(true))).toThrow(/not a Role/);
    expect(() => runCases(plugin, "backend", "nope", fake(true))).toThrow(/no case "nope"/);
  });

  it("counts a missing or malformed verdict as a failed criterion", () => {
    expect(parseGrade("not json", ["a", "b"]).map((x) => x.pass)).toEqual([false, false]);
    const r = parseGrade('Here: [{"n":1,"pass":true,"reason":"ok"},{"n":2,"pass":"yes"}]', ["a", "b"]);
    expect(r.map((x) => x.pass)).toEqual([true, false]);
  });

  it("asks the Agent to write out its work, so a short report format cannot hide what is graded", () => {
    const c = loadEvalCases(plugin, "backend").cases[0]!;
    const p = answerPrompt(c);
    expect(p.startsWith(c.input)).toBe(true);
    expect(p).toMatch(/Nothing can be run here/);
    expect(p).toMatch(/deliverable for this task in full/);
    expect(p).toMatch(/## Steps/);
    expect(p).toMatch(/## Reply/);
    expect(p).toMatch(/do not stop to ask/); // a brief with no tools to read more is complete by definition
    expect(p).not.toMatch(/reasoning|thinking/i); // the safeguards refuse a request to show reasoning
  });

  it("does not grade a reply that is no deliverable: it retries once, then reports an ERROR", () => {
    let calls = 0;
    const refusing: Exec = (_p, system) => (system ? (calls++, "I can't help with that.") : "[]");
    const rs = runCases(plugin, "backend", "validates-authorizes-and-does-not-leak", refusing);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ pass: false });
    expect(rs[0]!.error).toMatch(/^no deliverable \(the model replied: I can't help with that\.\)/);
    expect(calls).toBe(2); // one retry

    let n = 0;
    const flaky: Exec = (p, system) => (system ? (n++ === 0 ? "filtered" : "ANSWER " + "x".repeat(400)) : fake(true)(p, system));
    expect(runCases(plugin, "backend", "validates-authorizes-and-does-not-leak", flaky)[0]).toMatchObject({ pass: true });
  });

  it("runs a case N times and calls it FLAKY when it passes only some of them", () => {
    let grade = 0;
    const alternating: Exec = (p, system) => {
      if (system) return "ANSWER " + "x".repeat(400);
      const pass = grade++ % 3 !== 0; // runs 1 of 3 fails, the others pass
      return fake(pass)(p, system);
    };
    const [r] = runCases(plugin, "backend", undefined, alternating, undefined, 3);
    expect(r).toMatchObject({ pass: false, runs: { total: 3, passed: 2, errors: 0 } });
    expect(r!.criteria.length).toBeGreaterThan(0);
    expect(r!.criteria[0]!.reason).toMatch(/failed in 1 of 3 graded runs/);
    expect(printResults([r!])).toMatch(/FLAKY backend\/.* \(2\/3 runs\)/);

    const [all] = runCases(plugin, "backend", undefined, fake(true), undefined, 3);
    expect(all).toMatchObject({ pass: true, runs: { total: 3, passed: 3 } });
    expect(printResults([all!])).toMatch(/PASS {2}backend\/.* \(3\/3 runs\)/);
  });

  it("counts a run whose model call failed as an error, and reports ERROR only when every run failed", () => {
    let n = 0;
    const half: Exec = (p, system) => {
      if (system && n++ === 0) throw new Error("claude -p failed: flagged");
      return fake(true)(p, system);
    };
    const [r] = runCases(plugin, "backend", undefined, half, undefined, 2);
    expect(r).toMatchObject({ pass: false, runs: { total: 2, passed: 1, errors: 1 } });
    expect(r!.error).toBeUndefined();
    const boom: Exec = () => {
      throw new Error("claude -p failed: flagged");
    };
    expect(runCases(plugin, "backend", undefined, boom, undefined, 2)[0]).toMatchObject({ error: "flagged", runs: { errors: 2 } });
  });

  it("rejects a --runs that is not a whole number from 1 to 10", () => {
    for (const bad of ["0", "11", "x"]) {
      let out = "";
      const code = run(["eval", "backend", "--runs", bad], env, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s), modelExec: () => fake(true) });
      expect(code, bad).not.toBe(0);
      expect(out).toMatch(/--runs takes a whole number from 1 to 10/);
    }
  });

  it("reports a failed model call as an ERROR of that case and goes on with the others", () => {
    const boom: Exec = (_p, system) => {
      if (system && _p.includes("DELETE /api/bookings")) throw new Error("claude -p failed: API Error: flagged");
      return fake(true)(_p, system);
    };
    const rs = runCases(plugin, undefined, undefined, boom);
    const bad = rs.filter((r) => r.error);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((r) => !r.pass && r.error === "API Error: flagged")).toBe(true);
    expect(rs.some((r) => r.pass)).toBe(true);
    expect(printResults(rs)).toMatch(/ERROR backend\//);
  });

  it("puts the situation, the answer and numbered criteria in the grading prompt", () => {
    const c = loadEvalCases(plugin, "backend").cases[0]!;
    const p = buildGradePrompt(c, "MY ANSWER");
    expect(p).toContain(c.input);
    expect(p).toContain("MY ANSWER");
    expect(p).toMatch(/Reply section only/); // reply-format criteria are graded against the Reply section
    expect(p).toContain(`1. ${c.criteria[0]}`);
  });

  it("takes --model and --case with a value, not as a Role name", () => {
    const seen: (string | undefined)[] = [];
    let out = "";
    const code = run(["eval", "--model", "sonnet", "--case", "validates-authorizes-and-does-not-leak"], env, process.cwd(), {
      out: (s) => (out += s),
      err: (s) => (out += s),
      modelExec: (m) => (seen.push(m), fake(true)),
    });
    expect(code, out).toBe(0);
    expect(seen).toEqual(["sonnet"]);
    expect(out).toMatch(/1\/1 case\(s\) passed/);
  });

  it("is the `aidw eval` command: exit 0 on pass, 1 on a failed case, JSON on request", () => {
    const root = copy();
    const go = (pass: boolean, extra: string[] = []) => {
      let out = "";
      const code = run(["eval", "backend", ...extra], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: () => {}, modelExec: () => fake(pass) });
      return { code, out };
    };
    expect(go(true).code).toBe(0);
    expect(go(true).out).toMatch(/PASS {2}backend\//);
    const bad = go(false);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/FAIL {2}backend\//);
    expect(JSON.parse(go(true, ["--json"]).out).ok).toBe(true);
  });

  it("runs each case 3 times by default, and a case passes only 3 of 3 (C2)", () => {
    const root = copy();
    const seen: string[] = [];
    let out = "";
    const code = run(["eval", "backend", "--case", "validates-authorizes-and-does-not-leak"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), {
      out: (s) => (out += s),
      err: () => {},
      modelExec: () => fake(true, seen),
    });
    expect(code, out).toBe(0);
    expect(seen).toHaveLength(6); // 3 answers, 3 gradings
    expect(out).toMatch(/PASS {2}backend\/validates-authorizes-and-does-not-leak \(3\/3 runs\)/);
  });

  describe("a case that expects a question (expect: ask)", () => {
    const askCase = (root: string) => {
      const f = join(root, "roles", "backend", "evals", "validates-authorizes-and-does-not-leak.md");
      writeFileSync(f, readFileSync(f, "utf8").replace("case: validates-authorizes-and-does-not-leak\n", "case: validates-authorizes-and-does-not-leak\nexpect: ask\n"));
      return loadEvalCases(root, "backend").cases.find((c) => c.name === "validates-authorizes-and-does-not-leak")!;
    };

    it("drops the line that forbids asking", () => {
      const root = copy();
      const c = askCase(root);
      expect(c.expect).toBe("ask");
      const p = answerPrompt(c);
      expect(p).not.toMatch(/do not stop to ask/);
      expect(p).not.toMatch(/nothing is blocked/);
      expect(p).toMatch(/## Reply/);
    });

    it("grades a short answer (the question itself) instead of calling it no deliverable", () => {
      const root = copy();
      askCase(root);
      let answers = 0;
      const asks: Exec = (p, system) => (system ? (answers++, "Which status does the contract give a duplicate invite?") : fake(true)(p, system));
      const [r] = runCases(root, "backend", "validates-authorizes-and-does-not-leak", asks);
      expect(r).toMatchObject({ pass: true });
      expect(r!.error).toBeUndefined();
      expect(answers).toBe(1); // no retry either
    });
  });

  describe("the result file (C6)", () => {
    const results = (root: string) => JSON.parse(readFileSync(join(root, "roles", "backend", "evals", "results.json"), "utf8"));

    it("is written into the Role's folder after a run of all its cases", () => {
      const root = copy();
      let out = "";
      const code = run(["eval", "backend", "--model", "sonnet"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s), modelExec: () => fake(true) });
      expect(code, out).toBe(0);
      const r = results(root);
      expect(r).toMatchObject({ role: "backend", model: "sonnet", tier: "deep", runs: 3, digest: roleDigest(root, "backend") });
      expect(Number.isNaN(Date.parse(r.date))).toBe(false);
      expect(r.cases.map((c: { name: string }) => c.name).sort()).toEqual(["entity-is-not-a-response", "validates-authorizes-and-does-not-leak"]);
      expect(r.cases[0]).toMatchObject({ pass: true, runs: { total: 3, passed: 3, errors: 0 } });
      expect(out).toMatch(/wrote roles\/backend\/evals\/results\.json/);
      expect(existsSync(join(plugin, "roles", "backend", "evals", "results.json"))).toBe(false); // tests never write the repo's
    });

    it("records a failed case with the criteria that failed", () => {
      const root = copy();
      const code = run(["eval", "backend", "--runs", "1"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: () => {}, err: () => {}, modelExec: () => fake(false) });
      expect(code).toBe(1);
      const r = results(root);
      expect(r).toMatchObject({ runs: 1, model: null });
      expect(r.cases[0]).toMatchObject({ pass: false, runs: { total: 1, passed: 0, errors: 0 } });
      expect(r.cases[0].failed.length).toBeGreaterThan(0);
    });

    it("is not written for a run of one case: it would stand for cases that did not run", () => {
      const root = copy();
      let err = "";
      run(["eval", "backend", "--case", "validates-authorizes-and-does-not-leak"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: () => {}, err: (s) => (err += s), modelExec: () => fake(true) });
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);
      expect(err).toMatch(/no result file written: --case runs only part/);
    });
  });
});
