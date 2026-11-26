import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvalCases } from "../src/evals.js";
import { generateAgents } from "../src/roles.js";

// Gaps left by research-skills.test.ts for plan T4 (R2, R6, R7, M12): the details of each rung, the "users report"
// exception, the confidence cap, each query pattern, each Skill's own wording and each updated eval on its own.
const plugin = join(__dirname, "..", "plugins", "aidw");
const read = (p: string) => readFileSync(join(plugin, p), "utf8");
const sources = read("roles/research/references/sources.md");
const section = (text: string, heading: string) => {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, next < 0 ? undefined : next);
};
const rung = (n: number) => {
  const m = sources.match(new RegExp(`\\n${n}\\. \\*\\*[\\s\\S]*?(?=\\n\\d\\. \\*\\*|\\n\\n)`));
  expect(m, `rung ${n}`).not.toBeNull();
  return m![0];
};

describe("source ladder rungs (R2, M12)", () => {
  it("rung 1 is the official documentation of the version in question", () => {
    expect(rung(1)).toMatch(/official documentation/i);
    expect(rung(1)).toMatch(/version/);
  });

  it("rung 2 names changelogs, migration guides, maintainers' issues and examples", () => {
    const r = rung(2);
    for (const w of [/changelogs/i, /migration guides/i, /maintainers' issues/i, /examples/i]) expect(r).toMatch(w);
  });

  it("rung 3 is named experts and organisations, capped at medium", () => {
    expect(rung(3)).toMatch(/named experts/i);
    expect(rung(3)).toMatch(/at most `medium`/i);
  });

  it("rung 4 is forums and blogs, leads only, cited from the page they lead to", () => {
    expect(rung(4)).toMatch(/forums/i);
    expect(rung(4)).toMatch(/blogs/i);
    expect(rung(4)).toMatch(/leads only/);
    expect(rung(4)).toMatch(/`Not found`/);
  });

  it("AI-written and copied pages are no source at any rung", () => {
    expect(sources).toMatch(/AI-written or copied[\s\S]{0,120}not sources at any rung/);
  });

  it("tier 3 alone never reaches high confidence; high needs tier 1 or two independent tier 2", () => {
    const conf = sources.match(/\*\*Confidence\*\*:[\s\S]*?(?=\n\n|\n- \*\*|\n## )/)![0];
    expect(conf).toMatch(/`high` \(tier 1, or two independent tier 2 sources\)/);
    expect(conf).not.toMatch(/`high`[^)]*tier 3/);
    expect(conf).toMatch(/`medium` \([^)]*tier 3/);
  });

  it("a rung 4 page is a record only as \"users report\", and such a row is always low (pending owner decision)", () => {
    expect(sources).toMatch(/"users report"/);
    expect(sources).toMatch(/never as proof of how the product works/);
    expect(sources).toMatch(/`4` only on a "users report" row/);
    expect(sources).toMatch(/`low`[\s\S]{0,120}"users report" row/);
  });
});

describe("claim table (R6)", () => {
  it("links to the section anchor, names the heading when there is none, and never cites a snippet", () => {
    const s = section(sources, "## Every claim carries a quote");
    expect(s).toMatch(/#anchor/);
    expect(s).toMatch(/section anchor/);
    expect(s).toMatch(/name the heading/);
    expect(s).toMatch(/never a search snippet/);
    expect(s).toMatch(/`inference` row quotes nothing/);
  });
});

describe("search budget and query patterns (R7)", () => {
  const budget = section(sources, "## The first pass is 2 to 3 searches and 3 to 5 pages");
  const pattern = (kind: string) => {
    const m = budget.match(new RegExp(`- \\*\\*${kind}[\\s\\S]*?(?=\\n- \\*\\*|\\n\\n|$)`));
    expect(m, kind).not.toBeNull();
    return m![0];
  };

  it("going past the budget is explained in the note, with how many searches and pages and why", () => {
    expect(budget).toMatch(/explain it\s+in the note/);
    expect(budget).toMatch(/how many searches and pages/);
    expect(budget).toMatch(/why/);
  });

  it("the API query uses site: on the official docs and then the version's changelog", () => {
    expect(pattern("API")).toMatch(/`site:<official docs domain>[^`]*<version>`/);
    expect(pattern("API")).toMatch(/changelog|release notes/);
  });

  it("the best-practice query always searches pitfalls or anti-patterns", () => {
    expect(pattern("Best practice")).toMatch(/always[\s\S]*pitfalls[\s\S]*anti-patterns/);
  });

  it("the error query quotes the exact message and goes to the maintainers' issues", () => {
    expect(pattern("Error")).toMatch(/exact message in quotes/);
    expect(pattern("Error")).toMatch(/site:github\.com\/<org>\/<repo>\/issues/);
  });

  it("the comparison query reads the migration guide and each limits page with site:", () => {
    expect(pattern("Comparison")).toMatch(/vs/);
    expect(pattern("Comparison")).toMatch(/migration guide/);
    expect(pattern("Comparison")).toMatch(/site:/);
  });

  it("site: is used for every known official domain", () => {
    expect(budget).toMatch(/Use `site:` for every official domain/);
  });
});

describe("each web Skill applies the discipline in its own words", () => {
  it("evidence-scan maps its source kinds to tiers and users' words to \"users report\"", () => {
    const t = read("roles/research/skills/evidence-scan.md");
    expect(t).toMatch(/tier 1 and 2/);
    expect(t).toMatch(/tier 3/);
    expect(t).toMatch(/"users report"/);
    expect(t).toMatch(/pitfalls/);
  });

  it("feasibility-spike quotes the deciding sentence, links its section and puts tier in the proof", () => {
    const t = read("roles/research/skills/feasibility-spike.md");
    expect(t).toMatch(/quoted/);
    expect(t).toMatch(/section/);
    expect(t).toMatch(/forum answer or a blog post\s+only tells you where to look/);
    expect(t).toMatch(/\*\*Proof\*\*: the quote with its tier and its link to the section/);
  });

  it("world-scan holds the budget per world, ranks archive records over blogs and quotes each trait", () => {
    const t = read("roles/research/skills/world-scan.md");
    expect(t).toMatch(/search budget holds\s+for each world/);
    expect(t).toMatch(/blog is a lead/);
    expect(t).toMatch(/\*\*Sources for the traits\*\*[\s\S]*at most two\s+sentences[\s\S]*tier/);
  });

  it("each Skill's Sources section credits the shared reference", () => {
    for (const s of ["evidence-scan", "feasibility-spike", "world-scan"]) {
      const t = read(`roles/research/skills/${s}.md`);
      const tail = t.slice(t.lastIndexOf("\n## "));
      expect(tail, s).toMatch(/sources\.md/);
    }
  });

  it("the shared reference ends with Sources taking ideas, not wording", () => {
    expect(sources.slice(sources.lastIndexOf("\n## "))).toMatch(/^\n## Sources\n\nIdeas, not wording/);
  });
});

describe("the Role and its generated agent", () => {
  it("Done-when asks for a tier and a quote of at most two sentences linked to the section", () => {
    const role = read("roles/research/role.md");
    expect(role).toMatch(/with its tier and a quote of at\s+most two sentences linked to the section/);
    expect(role).toMatch(/## References \(read only when the condition holds\)[\s\S]*before any web search/);
  });

  it("the generated research agent carries the References entry", () => {
    const agent = generateAgents(plugin)["research.md"];
    expect(agent).toContain("aidw plugin-path roles/research/references/sources.md");
    expect(read("agents/research.md")).toBe(agent);
  });
});

describe("each updated Research eval on its own", () => {
  const cases = loadEvalCases(plugin, "research").cases;
  const criteria = (name: string) => {
    const c = cases.find((x) => x.name === name);
    expect(c, name).toBeDefined();
    return c!.criteria.join("\n");
  };

  it("the-obvious-answer-is-wrong checks the quote, the anchor, the tier and the forum lead", () => {
    const t = criteria("the-obvious-answer-is-wrong");
    expect(t).toMatch(/quote[\s\S]*at most two sentences/);
    expect(t).toMatch(/anchor/);
    expect(t).toMatch(/tier/);
    expect(t).toMatch(/forum[\s\S]*blog[\s\S]*AI-written[\s\S]*lead/);
  });

  it("worlds-not-competitors checks the quote, the section link, the tier and the blog lead", () => {
    const t = criteria("worlds-not-competitors");
    expect(t).toMatch(/quote of at most two sentences/);
    expect(t).toMatch(/link to the section/);
    expect(t).toMatch(/tier/);
    expect(t).toMatch(/blog[\s\S]*lead/);
  });
});
