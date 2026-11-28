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

// Test-agent additions (plan T6): the parts of I2, I4 and Q2 the first tests leave unchecked.
describe("codebase-research skill, decision details", () => {
  const modeRows = (body: string) =>
    new Map(
      [...body.matchAll(/^\| \*\*(\w+)\*\* \| (.+?) \| (.+?) \|$/gm)].map((m) => [m[1]!, { answers: m[2]!, gives: m[3]! }]),
    );

  it("gives each of the four modes a row with what it answers and what it hands back (I2)", () => {
    const rows = modeRows(parse().body);
    expect([...rows.keys()].sort()).toEqual(["analyze", "locate", "patterns", "synthesize"]);
    expect(rows.get("locate")!.answers).toMatch(/where/);
    expect(rows.get("analyze")!.answers).toMatch(/how it runs/);
    expect(rows.get("analyze")!.gives).toMatch(/file:line/);
    expect(rows.get("patterns")!.answers).toMatch(/imitate/);
    expect(rows.get("patterns")!.gives).toMatch(/test/);
    expect(rows.get("synthesize")!.answers).toMatch(/several parts/);
  });

  it("names the judgment and proposal words to leave out, and drops a proposal when merging (I2)", () => {
    const { body } = parse();
    const rules = section(body, "Describe what exists: no critique, no proposals");
    for (const w of ["fragile", "a bug", "a risk", "should", "consider"]) expect(rules, w).toContain(`"${w}"`);
    expect(rules).toMatch(/a fix, a refactoring/);
    expect(rules).toMatch(/Open questions/); // an untraced claim is not stated as a finding
    expect(section(body, "6. Synthesize: merge the parts into one report")).toMatch(/proposal .*dropped/);
  });

  it("per capability records test files, fixtures, mocks, the command and what is not tested (I4)", () => {
    const tested = section(parse().body, "4. How each part is tested");
    expect(tested).toMatch(/test files/);
    expect(tested).toMatch(/fixtures/);
    expect(tested).toMatch(/mocks/);
    expect(tested).toMatch(/command that runs them/);
    expect(tested).toMatch(/what is not tested/);
  });

  it("a check run carries its command, exit status and output; reading a test proves nothing (I4)", () => {
    const tested = section(parse().body, "4. How each part is tested");
    const checks = tested.slice(tested.indexOf("**Checks run**"));
    expect(checks).toMatch(/exact\s+command/);
    expect(checks).toMatch(/exit status/);
    expect(checks).toMatch(/output lines/);
    expect(tested).toMatch(/Reading a test does not tell you it passes/);
    expect(tested).toMatch(/Never write "the tests pass" without a check run/);
  });

  it("each part has a Tested by block, and the merge keeps tests read and checks run in separate columns (I4)", () => {
    const { body } = parse();
    const part = body.slice(body.indexOf("## 5. Write your part"), body.indexOf("## 6. Synthesize")); // the part's shape holds "## " headings
    expect(part).toMatch(/^#### Tested by$/m);
    expect(section(body, "6. Synthesize: merge the parts into one report")).toMatch(/capability, tests read, checks run, not tested/);
  });

  it("the Research Role sends code questions to the Skill and reads the project's code (Q2)", () => {
    const role = readFileSync(join(plugin, "roles", "research", "role.md"), "utf8");
    const procedure = role.slice(role.indexOf("## Procedure"));
    expect(procedure).toMatch(/follow `codebase-research`/);
    expect(procedure).toMatch(/read the project's code and its tests/);
    expect(procedure).toMatch(/without proposing/);
    expect(role).toMatch(/^description: .*existing code/m);
    const agent = readFileSync(join(plugin, "agents", "research.md"), "utf8");
    expect(agent).toMatch(/`codebase-research`/);
    expect(agent).toMatch(/^model: /m);
  });

  it("the eval asks a neutral question and gives the fixture with gapless line numbers", () => {
    const c = loadEvalCases(plugin, "research").cases.find((x) => x.covers.includes("codebase-research"))!;
    expect(c.input).toMatch(/not told what the Change is/);
    const question = /^> ([\s\S]*?)\n\n/m.exec(c.input)![1]!.replace(/\n> /g, " ");
    expect(question).not.toMatch(/\b(should|fix|improve|refactor|add|change|bug|better)\b/i);
    const blocks = [...c.input.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!.trimEnd().split("\n"));
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const lines of blocks) lines.forEach((l, i) => expect(l).toMatch(new RegExp(`^\\s*${i + 1}( |$)`)));
  });

  it("the eval fails an answer that claims a passing test or misses the untested paths", () => {
    const c = loadEvalCases(plugin, "research").cases.find((x) => x.covers.includes("codebase-research"))!;
    expect(c.criteria.some((x) => /not claim that any test passes/.test(x))).toBe(true);
    expect(c.criteria.some((x) => /no test calls the route/.test(x) && /email send fail/.test(x))).toBe(true);
    expect(c.criteria.some((x) => /headings that state what is true/.test(x))).toBe(true);
  });
});
