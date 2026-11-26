import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { loadEvalCases } from "../src/evals.js";
import { loadRole } from "../src/roles.js";

// The Research Role's codebase-research Skill (plan T6; I2, I4, Q2; ADR-0016): four modes, describe only, how each part
// is tested with tests read kept apart from checks run, and a merge mode for the Agent that joins the parts.
const plugin = join(__dirname, "..", "plugins", "aidw");
const file = join(plugin, "roles", "research", "skills", "codebase-research.md");

function parse(): { meta: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error("codebase-research.md: no front matter");
  return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
}
const section = (body: string, title: string) => {
  const at = body.indexOf(`## ${title}`);
  if (at < 0) return "";
  const next = body.indexOf("\n## ", at + 3);
  return body.slice(at, next < 0 ? undefined : next);
};

describe("codebase-research skill", () => {
  it("has a name, a description, a right/wrong pair and Sources last", () => {
    const { meta, body } = parse();
    expect(meta.name).toBe("codebase-research");
    expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]!.trim());
    expect(headings).toContain("Right and wrong");
    expect(headings.at(-1)).toBe("Sources");
    const pair = section(body, "Right and wrong");
    expect(pair).toMatch(/^Right\b/m);
    expect(pair).toMatch(/^Wrong\b/m);
  });

  it("names the four modes, each with what it answers (I2)", () => {
    const { body } = parse();
    for (const mode of ["locate", "analyze", "patterns", "synthesize"]) expect(body, mode).toMatch(new RegExp(`\\*\\*${mode}\\*\\*`));
  });

  it("describes only: no critique and no proposals (I2)", () => {
    const { body } = parse();
    expect(body).toMatch(/no critique/i);
    expect(body).toMatch(/no proposals?/i);
    expect(body).toMatch(/file:line|file and line/);
  });

  it("records how each part is tested and keeps tests read apart from checks run (I4)", () => {
    const { body } = parse();
    expect(body).toMatch(/fixtures/);
    expect(body).toMatch(/mocks/);
    expect(body).toMatch(/Tests read/);
    expect(body).toMatch(/Checks run/);
    expect(body).toMatch(/command/);
    expect(body).toMatch(/output/);
  });

  it("serves the merging Agent: it re-checks the code only where parts disagree (M10)", () => {
    const { body } = parse();
    const merge = body.slice(body.indexOf("synthesize"));
    expect(merge).toMatch(/disagree/);
    expect(merge).toMatch(/Summary/);
  });

  it("names the rpi agents and research references it takes ideas from", () => {
    const sources = section(parse().body, "Sources");
    for (const s of ["codebase-locator", "codebase-analyzer", "codebase-pattern-finder", "iterate-research", "research-questions"]) expect(sources, s).toMatch(s);
  });

  it("is in the Research Role's index, which keeps the standard tier (Q2)", () => {
    const role = loadRole(plugin, "research")!;
    expect(role.tier).toBe("standard");
    expect(role.skills.map((s) => s.name)).toContain("codebase-research");
    expect(role.skills.find((s) => s.name === "codebase-research")!.when).toMatch(/existing code|code works/);
  });

  it("has a Role eval that covers it: file:line answers, tested-by, and no proposals", () => {
    const c = loadEvalCases(plugin, "research").cases.find((x) => x.covers.includes("codebase-research"));
    expect(c, "a research case with covers: [codebase-research]").toBeDefined();
    expect(c!.input).toMatch(/^\s*\d+\s/m); // the fixture's files are given with line numbers
    expect(c!.criteria.some((x) => /file and line/.test(x))).toBe(true);
    expect(c!.criteria.some((x) => /^must not .*(propose|recommend)/.test(x))).toBe(true);
    expect(c!.criteria.some((x) => /checks? run/.test(x))).toBe(true);
  });
});
