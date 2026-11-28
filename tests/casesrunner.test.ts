import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { answerPrompt, buildGradePrompt, parseGrade, printResults, roleSystem, runCases, type Exec } from "../src/evalrun.js";
import { caseDigest, loadEvalCases, roleDigest, sharedDigest } from "../src/evals.js";
import { writeAgents } from "../src/roles.js";
import { bareBackend } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const env = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin };
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
/** A copy of the plugin inside its own git work tree, as a source checkout is: `aidw eval` writes its result file there. */
function gitCopy(): string {
  const root = copy();
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}
/** A copy of the plugin: `aidw eval` writes a result file into the Role's folder, never into the repo's during a test. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-cases-"));
  temps.push(root);
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  bareBackend(root);
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
    const bare = copy(); // a Role with no skills: frontend with its index and skills/ folder removed
    const fe = join(bare, "roles", "frontend");
    writeFileSync(join(fe, "role.md"), readFileSync(join(fe, "role.md"), "utf8").replace(/^skills:\n(?:[ \t]+-.*\n)*/m, ""));
    rmSync(join(fe, "skills"), { recursive: true, force: true });
    expect(roleSystem(bare, "frontend")).not.toContain("Your skills, in full");
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
      const pass = grade++ >= 2; // run 1 fails its grade and its re-grade; runs 2 and 3 pass
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

  it("re-grades an answer once when a criterion fails, and fails it only when both grades do", () => {
    const seen: string[] = [];
    // the first grade fails every criterion, the re-grade passes them: one noisy grade does not fail the case
    let g = 0;
    const noisy: Exec = (p, system) => (system ? fake(true, seen)(p, system) : fake(g++ % 2 === 1, seen)(p, system));
    const [r] = runCases(plugin, "backend", undefined, noisy);
    expect(r!.pass).toBe(true);
    expect(seen.filter((x) => x === "grade").length).toBe(2 * seen.filter((x) => x.startsWith("answer")).length);
    // failing twice fails, with the re-grade's reason
    const twice = runCases(plugin, "backend", undefined, fake(false));
    expect(twice.every((x) => !x.pass && x.criteria.every((c) => !c.pass && /failed both gradings/.test(c.reason)))).toBe(true);
    // a passing grade is not re-graded
    const once: string[] = [];
    runCases(plugin, "backend", undefined, fake(true, once));
    expect(once.filter((x) => x === "grade").length).toBe(once.filter((x) => x.startsWith("answer")).length);
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
    // a copy: were --case ever to write a result file, it must not land in the repo's plugin
    const code = run(["eval", "--model", "sonnet", "--case", "validates-authorizes-and-does-not-leak"], { ...process.env, AIDW_PLUGIN_ROOT: copy() }, process.cwd(), {
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
      const before = repoResults();
      const root = gitCopy();
      let out = "";
      const code = run(["eval", "backend"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s), modelExec: () => fake(true) });
      expect(code, out).toBe(0);
      const r = results(root);
      expect(r).toMatchObject({ format: 2, role: "backend", model: null, tier: "deep", runs: 3, digest: sharedDigest(root, "backend") });
      expect(r.cases.every((c: { digest: string; date: string; model: unknown }) => c.digest.startsWith("sha256:") && c.date === r.date && c.model === null)).toBe(true);
      expect(Number.isNaN(Date.parse(r.date))).toBe(false);
      expect(r.cases.map((c: { name: string }) => c.name).sort()).toEqual(["entity-is-not-a-response", "validates-authorizes-and-does-not-leak"]);
      expect(r.cases[0]).toMatchObject({ pass: true, runs: { total: 3, passed: 3, errors: 0 } });
      expect(out).toMatch(/wrote roles\/backend\/evals\/results\.json/);
      expect(repoResults()).toEqual(before); // tests never write the repo's
    });

    it("records a failed case with the criteria that failed", () => {
      const root = gitCopy();
      const code = run(["eval", "backend", "--runs", "1"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: () => {}, err: () => {}, modelExec: () => fake(false) });
      expect(code).toBe(1);
      const r = results(root);
      expect(r).toMatchObject({ runs: 1, model: null });
      expect(r.cases[0]).toMatchObject({ pass: false, runs: { total: 1, passed: 0, errors: 0 } });
      expect(r.cases[0].failed.length).toBeGreaterThan(0);
    });

    describe("a run of one case (--case)", () => {
      const file = (root: string) => join(root, "roles", "backend", "evals", "results.json");
      const ONE = "validates-authorizes-and-does-not-leak";
      const OTHER = "entity-is-not-a-response";
      const entry = (root: string, name: string) => results(root).cases.find((c: { name: string }) => c.name === name);
      const full = () => {
        const root = gitCopy();
        expect(go(root, ["eval", "backend"], () => fake(true)).code).toBe(0);
        return root;
      };

      it("replaces only that case's entry in the file of the last full run", () => {
        const root = full();
        const before = results(root);
        const f = join(root, "roles", "backend", "evals", `${ONE}.md`);
        writeFileSync(f, readFileSync(f, "utf8") + "\n- must not leak a stack trace\n");
        const r = go(root, ["eval", "backend", "--case", ONE, "--runs", "1"], () => fake(false));
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/wrote roles\/backend\/evals\/results\.json/);
        const after = results(root);
        expect(after.digest).toBe(before.digest);
        expect(entry(root, OTHER)).toEqual(before.cases.find((c: { name: string }) => c.name === OTHER));
        expect(entry(root, ONE)).toMatchObject({ pass: false, runs: { total: 1, passed: 0, errors: 0 }, digest: caseDigest(root, `roles/backend/evals/${ONE}.md`), date: after.date });
        expect(after.runs).toBe(1); // the fewest runs of any entry
        expect(after.cases.map((c: { name: string }) => c.name)).toEqual(before.cases.map((c: { name: string }) => c.name));
      });

      it("also merges with no Role named, into each Role that has the case", () => {
        const root = full();
        const r = go(root, ["eval", "--case", ONE], () => fake(true));
        expect(r.code, r.out).toBe(0);
        expect(r.out).toMatch(/wrote roles\/backend\/evals\/results\.json/);
      });

      it("is refused when the Role's shared content changed since the last full run", () => {
        const root = full();
        const before = readFileSync(file(root), "utf8");
        const role = join(root, "roles", "backend", "role.md");
        writeFileSync(role, readFileSync(role, "utf8") + "\nmore\n");
        const r = go(root, ["eval", "backend", "--case", ONE], () => fake(true));
        expect(r.out).toContain("no result file written for backend: the Role's shared content changed since the last full run: run `aidw eval backend` for all cases");
        expect(readFileSync(file(root), "utf8")).toBe(before);
      });

      it("is refused on an old-format file, or with no file", () => {
        const root = gitCopy();
        let r = go(root, ["eval", "backend", "--case", ONE], () => fake(true));
        expect(r.out).toContain("no result file written for backend: there is no results.json yet: run `aidw eval backend` for all cases once");
        expect(existsSync(file(root))).toBe(false);
        const old = JSON.stringify({ role: "backend", date: "2026-11-24T00:00:00.000Z", model: null, tier: "deep", runs: 3, digest: roleDigest(root, "backend"), cases: [] });
        writeFileSync(file(root), old);
        r = go(root, ["eval", "backend", "--case", ONE], () => fake(true));
        expect(r.out).toContain("no result file written for backend: results.json is the old format: run `aidw eval backend` for all cases once");
        expect(readFileSync(file(root), "utf8")).toBe(old);
      });

      it("is refused when the case was not graded, outside a source checkout, or on another model", () => {
        const root = full();
        const before = readFileSync(file(root), "utf8");
        const boom: Exec = () => {
          throw new Error("claude -p failed: flagged");
        };
        expect(go(root, ["eval", "backend", "--case", ONE], () => boom).out).toMatch(/no result file written for backend: no case was graded/);
        // backend's tier (deep) uses the session's model, so any --model is refused (M1)
        expect(go(root, ["eval", "backend", "--case", ONE, "--model", "haiku"], () => fake(true)).out).toContain(
          "no result file written for backend: its tier uses the session's model; run without --model",
        );
        expect(readFileSync(file(root), "utf8")).toBe(before);
        const plain = copy();
        expect(go(plain, ["eval", "backend", "--case", ONE], () => fake(true)).out).toContain(`no result file written: ${plain} is not a source checkout`);
      });

      it("keeps the top-level runs at the fewest any entry had, after a full --runs 1 run", () => {
        const root = gitCopy();
        expect(go(root, ["eval", "backend", "--runs", "1"], () => fake(true)).code).toBe(0);
        expect(results(root).runs).toBe(1);
        expect(go(root, ["eval", "backend", "--case", ONE], () => fake(true)).code).toBe(0);
        expect(results(root).runs).toBe(1); // OTHER still has 1 run
        expect(entry(root, ONE).runs.total).toBe(3);
        expect(go(root, ["eval", "backend", "--case", OTHER], () => fake(true)).code).toBe(0);
        expect(results(root).runs).toBe(3);
      });

      it("drops entries of deleted cases and malformed entries, and keeps the good ones", () => {
        const root = full();
        const rec = results(root);
        const other = rec.cases.find((c: { name: string }) => c.name === OTHER);
        writeFileSync(file(root), JSON.stringify({ ...rec, cases: [null, 7, { pass: true }, { ...other, name: "gone" }, other] }));
        const r = go(root, ["eval", "backend", "--case", ONE], () => fake(true));
        expect(r.code, r.out).toBe(0);
        expect(results(root).cases.map((c: { name: string }) => c.name)).toEqual([OTHER, ONE]);
        expect(entry(root, OTHER)).toEqual(other);
      });

      it("merges into each Role that has the case when no Role is named, refusing per Role", () => {
        const root = full();
        const dir = join(root, "roles", "fullstack", "evals");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${ONE}.md`), readFileSync(join(root, "roles", "backend", "evals", `${ONE}.md`), "utf8"));
        const r = go(root, ["eval", "--case", ONE, "--runs", "1"], () => fake(true));
        expect(r.out).toMatch(/wrote roles\/backend\/evals\/results\.json/);
        expect(r.out).toContain("no result file written for fullstack: there is no results.json yet");
        expect(existsSync(join(dir, "results.json"))).toBe(false);
      });

      it("reports the merged file in --json, and none when refused", () => {
        const root = full();
        let r = go(root, ["eval", "backend", "--case", ONE, "--json"], () => fake(true));
        expect(r.code, r.out).toBe(0);
        const json = (s: string) => JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
        expect(json(r.out).written).toEqual(["roles/backend/evals/results.json"]);
        const role = join(root, "roles", "backend", "role.md");
        writeFileSync(role, readFileSync(role, "utf8") + "\nmore\n");
        r = go(root, ["eval", "backend", "--case", ONE, "--json"], () => fake(true));
        expect(r.out).toContain("no result file written for backend: the Role's shared content changed");
        expect(json(r.out).written).toEqual([]);
      });

      it("writes nothing with --bare or --without, even into a format-2 file", () => {
        const root = full();
        const before = readFileSync(file(root), "utf8");
        expect(go(root, ["eval", "backend", "--case", ONE, "--bare", "--runs", "1"], () => fake(false)).out).toMatch(/no result file written: a run --bare/);
        expect(readFileSync(file(root), "utf8")).toBe(before);
      });
    });

    it("is not written outside a source checkout (an installed plugin)", () => {
      const root = copy();
      const r = go(root, ["eval", "backend"], () => fake(true));
      expect(r.code).toBe(0);
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);
      expect(r.out).toContain(`no result file written: ${root} is not a source checkout`);
    });

    it("answers with the model of the Role's tier, and records nothing when --model is another", () => {
      const root = gitCopy();
      const seen: (string | undefined)[] = [];
      expect(go(root, ["eval", "code-reviewer"], () => fake(true), seen).code).toBe(0);
      expect(seen).toEqual(["sonnet"]); // tier standard -> sonnet in tiers.yaml
      const file = join(root, "roles", "code-reviewer", "evals", "results.json");
      expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ model: "sonnet", tier: "standard" });
      rmSync(file);
      const r = go(root, ["eval", "code-reviewer", "--model", "haiku"], () => fake(true));
      expect(existsSync(file)).toBe(false);
      expect(r.out).toMatch(/no result file written for code-reviewer: --model haiku is not its tier's model \(sonnet\)/);
      seen.length = 0;
      go(root, ["eval", "backend", "--case", "entity-is-not-a-response"], () => fake(true), seen);
      expect(seen).toEqual([undefined]); // tier deep -> inherit: the claude CLI's default
    });

    it("is not written when no case was graded", () => {
      const root = gitCopy();
      const boom: Exec = () => {
        throw new Error("claude -p failed: flagged");
      };
      const r = go(root, ["eval", "backend"], () => boom);
      expect(r.code).toBe(1);
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);
      expect(r.out).toMatch(/no result file written for backend: no case was graded/);
    });
  });

  describe("a run without one rule or skill (C3, --without)", () => {
    /** backend with a rules table (B1, B2) and one skill; each case covers one of them. */
    const ablatable = () => {
      const root = gitCopy();
      const dir = join(root, "roles", "backend");
      writeFileSync(join(dir, "rules.md"), "| id | rule | applies when | checked by |\n|---|---|---|---|\n| B1 | RULE-ONE-TEXT | always | reviewer |\n| B2 | RULE-TWO-TEXT | always | reviewer |\n");
      const role = join(dir, "role.md");
      writeFileSync(role, readFileSync(role, "utf8").replace(/^access: (.*)$/m, "access: $1\nskills:\n  - effects-after-commit: when a write must also send something"));
      mkdirSync(join(dir, "skills"), { recursive: true });
      writeFileSync(join(dir, "skills", "effects-after-commit.md"), "---\nname: effects-after-commit\n---\nSKILL-BODY-TEXT\n");
      const cover = (name: string, list: string) => {
        const f = join(dir, "evals", `${name}.md`);
        writeFileSync(f, readFileSync(f, "utf8").replace(`case: ${name}\n`, `case: ${name}\ncovers: [${list}]\n`));
      };
      cover("entity-is-not-a-response", "B1, effects-after-commit");
      cover("validates-authorizes-and-does-not-leak", "B2");
      writeAgents(root);
      return root;
    };

    it("takes the rule row or the skill out of the instructions", () => {
      const root = ablatable();
      const full = roleSystem(root, "backend");
      expect(full).toContain("RULE-ONE-TEXT");
      expect(full).toContain("SKILL-BODY-TEXT");
      const noB1 = roleSystem(root, "backend", "B1");
      expect(noB1).not.toContain("RULE-ONE-TEXT");
      expect(noB1).toContain("RULE-TWO-TEXT");
      const noSkill = roleSystem(root, "backend", "effects-after-commit");
      expect(noSkill).not.toContain("SKILL-BODY-TEXT");
      expect(noSkill).not.toContain("plugin-path roles/backend/skills/effects-after-commit.md");
      expect(noSkill).toContain("RULE-ONE-TEXT");
    });

    it("runs only the cases that cover it, passes when they fail, and never writes the result file", () => {
      const root = ablatable();
      const prompts: string[] = [];
      const exec = (pass: boolean): Exec => (p, system) => {
        if (system) prompts.push(system);
        return fake(pass)(p, system);
      };
      let r = go(root, ["eval", "backend", "--without", "B2", "--runs", "1"], () => exec(false));
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/without B2: 1\/1 case\(s\) failed, as they should/);
      expect(r.out).toMatch(/FAIL {2}backend\/validates-authorizes-and-does-not-leak/);
      expect(r.out).not.toMatch(/entity-is-not-a-response/);
      expect(prompts.every((x) => !x.includes("RULE-TWO-TEXT"))).toBe(true);
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);

      r = go(root, ["eval", "backend", "--without", "effects-after-commit", "--runs", "1"], () => exec(true));
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/STILL PASSES backend\/entity-is-not-a-response: it does not test effects-after-commit/);
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);
    });

    it("refuses an id the Role does not have, and a run with no Role", () => {
      const root = ablatable();
      expect(go(root, ["eval", "backend", "--without", "B9"], () => fake(true)).out).toMatch(/--without: "B9" is not a rule id or a skill of backend/);
      expect(go(root, ["eval", "backend", "--without", "B1,B9"], () => fake(true)).out).toMatch(/--without: "B9" is not a rule id or a skill of backend/);
      expect(go(root, ["eval", "--without", "B1"], () => fake(true)).out).toMatch(/--without needs a Role/);
    });

    it("takes a list: drops every item and runs the cases covering any of them", () => {
      const root = ablatable();
      const s = roleSystem(root, "backend", ["B1", "effects-after-commit"]);
      expect(s).not.toContain("RULE-ONE-TEXT");
      expect(s).not.toContain("SKILL-BODY-TEXT");
      expect(s).toContain("RULE-TWO-TEXT");
      expect(roleSystem(root, "backend", "B1, B2")).not.toMatch(/RULE-(ONE|TWO)-TEXT/);
      const prompts: string[] = [];
      const r = go(root, ["eval", "backend", "--without", "B1,B2", "--runs", "1"], () => (p, system) => (system && prompts.push(system), fake(false)(p, system)));
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/without B1,B2: 2\/2 case\(s\) failed, as they should/);
      expect(prompts.every((x) => !x.includes("RULE-ONE-TEXT") && !x.includes("RULE-TWO-TEXT"))).toBe(true);
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);
    });

    it("with --case runs only that case, and prints every criterion's verdict", () => {
      const root = ablatable();
      let grade = 0;
      // the first criterion fails, the others pass
      const half: Exec = (p, system) => {
        if (system) return "ANSWER " + "x".repeat(400);
        const n = (p.match(/^\d+\. /gm) ?? []).length;
        grade++;
        return JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, pass: i > 0, reason: "why" })));
      };
      const r = go(root, ["eval", "backend", "--without", "B1,effects-after-commit", "--case", "entity-is-not-a-response", "--runs", "2"], () => half);
      expect(grade).toBe(4); // each run's failing grade is graded once more
      expect(r.out).toMatch(/FAIL {2}backend\/entity-is-not-a-response \(0\/2 runs\)/);
      expect(r.out).not.toMatch(/validates-authorizes/);
      expect(r.out).toMatch(/^ {6}FAIL .*\n {11}failed in 2 of 2 graded runs: failed both gradings: why$/m);
      expect(r.out).toMatch(/^ {6}ok {3}\S/m);
    });
  });

  describe("the bare baseline (C3, --bare)", () => {
    it("answers with only the shared procedures the Role includes, never its own text", () => {
      const root = gitCopy();
      const prompts: string[] = [];
      const r = go(root, ["eval", "backend", "--bare", "--runs", "1"], () => (p, system) => (system && prompts.push(system), fake(false)(p, system)));
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/bare \(no Role instructions\): \d+\/\d+ case\(s\) failed, as they should/);
      expect(prompts.length).toBeGreaterThan(0);
      const shared = readFileSync(join(root, "library", "implement-a-task.md"), "utf8").trim();
      const role = readFileSync(join(root, "roles", "backend", "role.md"), "utf8");
      const own = /## Responsibility\n\n(.+)/.exec(role)?.[1] ?? "no-such-text";
      expect(prompts.every((x) => x === shared)).toBe(true);
      expect(prompts.every((x) => !x.includes(own))).toBe(true);
      expect(existsSync(join(root, "roles", "backend", "evals", "results.json"))).toBe(false);
    });

    it("flags a case the bare model passes, and needs a Role", () => {
      const root = gitCopy();
      const r = go(root, ["eval", "backend", "--bare", "--runs", "1", "--case", "entity-is-not-a-response"], () => fake(true));
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/PASSES BARE backend\/entity-is-not-a-response: the model passes it with no Role; rewrite or drop it \(C3\)/);
      expect(go(root, ["eval", "--bare"], () => fake(true)).out).toMatch(/--bare needs a Role/);
      expect(go(root, ["eval", "backend", "--bare", "--without", "B1"], () => fake(true)).out).toMatch(/--bare and --without do not go together/);
    });
  });

  it("inlines a library skill the Role lists", () => {
    const root = copy();
    const role = join(root, "roles", "backend", "role.md");
    writeFileSync(role, readFileSync(role, "utf8").replace(/^access: (.*)$/m, "access: $1\nskills:\n  - library/api-design-rules: when designing a route"));
    const s = roleSystem(root, "backend");
    expect(s).toContain("### Skill: library/api-design-rules");
    expect(s).toContain("aidw plugin-path library/skills/api-design-rules/SKILL.md");
  });

  it("calls an empty or refusing reply to an expect: ask case an ERROR, not a FAIL", () => {
    const root = copy();
    const f = join(root, "roles", "backend", "evals", "validates-authorizes-and-does-not-leak.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("case: validates-authorizes-and-does-not-leak\n", "case: validates-authorizes-and-does-not-leak\nexpect: ask\n"));
    for (const reply of ["", "I can't help with that."]) {
      const [r] = runCases(root, "backend", "validates-authorizes-and-does-not-leak", (p, system) => (system ? reply : fake(true)(p, system)));
      expect(r!.error, reply).toMatch(/^no answer \(the model replied: /);
    }
  });
});

/** The repo's own backend result file, byte for byte (null when there is none): a test must leave it as it was. */
function repoResults(): Buffer | null {
  const f = join(plugin, "roles", "backend", "evals", "results.json");
  return existsSync(f) ? readFileSync(f) : null;
}

/** `aidw eval` on a plugin copy; `seen` collects the model each Role's runner was made for. */
function go(root: string, argv: string[], exec: (m?: string) => Exec, seen: (string | undefined)[] = []) {
  let out = "";
  const code = run(argv, { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s), modelExec: (m) => (seen.push(m), exec(m)) });
  return { code, out };
}

describe("review fixes for the result file", () => {
  const resultsPath = (root: string) => join(root, "roles", "backend", "evals", "results.json");

  it("refuses --model for a Role whose tier uses the session's model, full run or --case (M1)", () => {
    const root = gitCopy();
    const r = go(root, ["eval", "backend", "--model", "sonnet"], () => fake(true));
    expect(r.out).toContain("no result file written for backend: its tier uses the session's model; run without --model");
    expect(existsSync(resultsPath(root))).toBe(false);
  });

  it("leaves a dot file in skills/ out of the Role's system prompt (L1)", () => {
    const root = copy();
    const dir = join(root, "roles", "backend", "skills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".draft.md"), "---\nname: draft\n---\nHIDDEN-DRAFT-TEXT\n");
    writeFileSync(join(dir, "visible.md"), "---\nname: visible\n---\nVISIBLE-SKILL-TEXT\n");
    const s = roleSystem(root, "backend");
    expect(s).toContain("VISIBLE-SKILL-TEXT");
    expect(s).not.toContain("HIDDEN-DRAFT-TEXT");
  });

  it("takes the digests before the run, and writes nothing when the Role changes during it (L3)", () => {
    const root = gitCopy();
    const role = join(root, "roles", "backend", "role.md");
    let edited = false;
    const editing: Exec = (p, system) => {
      if (!edited) writeFileSync(role, readFileSync(role, "utf8") + "\nedited during the run\n");
      edited = true;
      return fake(true)(p, system);
    };
    const r = go(root, ["eval", "backend"], () => editing);
    expect(r.out).toContain("no result file written for backend: the Role changed during the run: run it again");
    expect(existsSync(resultsPath(root))).toBe(false);

    // A case file edited during the run: its entry keeps the digest of the file the run started from, so it shows stale.
    const root2 = gitCopy();
    const caseFile = "roles/backend/evals/entity-is-not-a-response.md";
    const start = caseDigest(root2, caseFile);
    let once = false;
    const editCase: Exec = (p, system) => {
      if (!once) writeFileSync(join(root2, caseFile), readFileSync(join(root2, caseFile), "utf8") + "\n- must also be edited\n");
      once = true;
      return fake(true)(p, system);
    };
    expect(go(root2, ["eval", "backend"], () => editCase).code).toBe(0);
    const rec = JSON.parse(readFileSync(resultsPath(root2), "utf8"));
    const entry = rec.cases.find((c: { name: string }) => c.name === "entity-is-not-a-response");
    expect(entry.digest).toBe(start);
    expect(entry.digest).not.toBe(caseDigest(root2, caseFile));
  });
});
