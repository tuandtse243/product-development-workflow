import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvalCases } from "../src/evals.js";

// The Research Role's source discipline (plan T4; R2, R6, R7, M12; ADR-0016): one shared reference holds the source
// ladder, the claim table with its Quote column, the search budget and the query patterns; every web Skill points to it.
const plugin = join(__dirname, "..", "plugins", "aidw");
const role = join(plugin, "roles", "research");
const SOURCES = "roles/research/references/sources.md";
const WEB_SKILLS = ["evidence-scan", "feasibility-spike", "world-scan"];
const read = (p: string) => readFileSync(join(plugin, p), "utf8");

describe("research source discipline", () => {
  it("keeps the ladder, the quote rule, the budget and the query patterns in one reference", () => {
    expect(existsSync(join(plugin, SOURCES))).toBe(true);
    const text = read(SOURCES);
    // R2, M12: four tiers in order, tier 3 capped at medium, tier 4 leads only, AI-written and copied pages excluded
    const tiers = ["official documentation", "changelogs", "named experts", "forums"].map((t) => text.toLowerCase().indexOf(t));
    expect(tiers.every((i) => i >= 0)).toBe(true);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
    expect(text).toMatch(/at most `medium`/i);
    expect(text).toMatch(/leads? only/i);
    expect(text).toMatch(/AI-written/);
    expect(text).toMatch(/copied/);
    // R5 stays true: "best practice" needs the official docs or two independent tier 1-3 sources, and pitfalls are searched
    expect(text).toMatch(/best practice/i);
    expect(text).toMatch(/two\s+independent\s+sources\s+of\s+tiers\s+1\s+to\s+3/);
    expect(text).toMatch(/pitfalls/i);
    // R6: Quote column, at most two sentences, a link to the section anchor
    expect(text).toMatch(/\| # \| Claim \| Quote \| Source[^|]*\| Tier \| Kind \| Confidence \|/);
    expect(text).toMatch(/at most two sentences/);
    expect(text).toMatch(/anchor/);
    // R7: budget and the four kinds of query, with site: for official domains
    expect(text).toMatch(/2 to 3 searches/);
    expect(text).toMatch(/3 to 5 pages/);
    expect(text).toMatch(/explain/i);
    for (const kind of ["API", "Best practice", "Error", "Comparison"]) expect(text).toMatch(new RegExp(`\\*\\*${kind}`));
    expect(text).toMatch(/`site:/);
  });

  it("an inference row has no tier and its confidence follows the rows it rests on; a world's tier 1 includes the trade's own documents", () => {
    const text = read(SOURCES);
    expect(text).toMatch(/none on an `inference` row/);
    expect(text).toMatch(/`inference` row's confidence is\s+never higher than the lowest of the rows it rests on/);
    expect(text).toMatch(/holds the object, or the trade's own documents/);
    expect(read("roles/research/skills/evidence-scan.md")).toMatch(/users' reports in issue trackers/);
  });

  it.each(WEB_SKILLS)("%s points to the shared reference instead of repeating it", (s) => {
    const text = read(`roles/research/skills/${s}.md`);
    expect(text).toContain(`\`aidw plugin-path ${SOURCES}\``);
    expect(text).not.toMatch(/2 to 3 searches/);
  });

  it("evidence-scan's claim table carries the Quote and Tier columns", () => {
    const text = read("roles/research/skills/evidence-scan.md");
    expect(text).toMatch(/\| # \| Claim \| Quote \| Source[^|]*\| Tier \| Kind \| Confidence \|/);
  });

  it("the Role lists the reference and asks for a tier and a quote for every claim", () => {
    const text = read("roles/research/role.md");
    expect(text).toContain(`\`aidw plugin-path ${SOURCES}\``);
    expect(text).toMatch(/quote/i);
    expect(text).toMatch(/tier/i);
  });

  it("the Research evals check the quote and the ladder", () => {
    const criteria = loadEvalCases(plugin, "research").cases.flatMap((c) => c.criteria).join("\n");
    expect(criteria).toMatch(/quote/i);
    expect(criteria).toMatch(/anchor/);
    expect(criteria).toMatch(/forum|blog/);
    expect(criteria).toMatch(/tier/i);
    expect(existsSync(join(role, "evals"))).toBe(true);
  });
});
