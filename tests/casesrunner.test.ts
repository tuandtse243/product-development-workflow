import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { buildGradePrompt, parseGrade, roleSystem, runCases, type Exec } from "../src/evalrun.js";
import { loadEvalCases } from "../src/evals.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const env = { ...process.env, CLAUDE_PLUGIN_ROOT: plugin };

/** A model that answers "ANSWER" and grades every criterion with `pass`. */
const fake = (pass: boolean, seen: string[] = []): Exec => (prompt, system) => {
  seen.push(system ? `answer:${prompt.slice(0, 20)}` : "grade");
  if (system) return "ANSWER";
  const n = (prompt.match(/^\d+\. /gm) ?? []).length;
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, pass, reason: "r" })));
};

describe("the Role case runner", () => {
  it("gives the Role's instructions as the system prompt, not the generated front matter", () => {
    const s = roleSystem(plugin, "backend");
    expect(s.length).toBeGreaterThan(100);
    expect(s.startsWith("---")).toBe(false);
  });

  it("passes a case when every criterion passes, and fails it otherwise", () => {
    const ok = runCases(plugin, "backend", undefined, fake(true));
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.every((r) => r.pass && r.answer === "ANSWER")).toBe(true);
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

  it("puts the situation, the answer and numbered criteria in the grading prompt", () => {
    const c = loadEvalCases(plugin, "backend").cases[0]!;
    const p = buildGradePrompt(c, "MY ANSWER");
    expect(p).toContain(c.input);
    expect(p).toContain("MY ANSWER");
    expect(p).toContain(`1. ${c.criteria[0]}`);
  });

  it("is the `aidw eval` command: exit 0 on pass, 1 on a failed case, JSON on request", () => {
    const go = (pass: boolean, extra: string[] = []) => {
      let out = "";
      const code = run(["eval", "backend", ...extra], env, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s), modelExec: () => fake(pass) });
      return { code, out };
    };
    expect(go(true).code).toBe(0);
    expect(go(true).out).toMatch(/PASS {2}backend\//);
    const bad = go(false);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/FAIL {2}backend\//);
    expect(JSON.parse(go(true, ["--json"]).out).ok).toBe(true);
  });
});
