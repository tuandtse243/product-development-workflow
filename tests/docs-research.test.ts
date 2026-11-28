import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { checkArtifacts, loadArtifacts } from "../src/artifacts.js";
import { loadEvalCases } from "../src/evals.js";
import { generateAgents, loadRole, parseRoleText } from "../src/roles.js";

// The Research Role's docs-research Skill and the Docs Brief Artifact (plan T5; R1, R3, R4, R5, R9, Q-R2, Q-R3;
// ADR-0016), and the review notes T4 and T8 left for it.
const plugin = join(__dirname, "..", "plugins", "aidw");
const read = (p: string) => readFileSync(join(plugin, p), "utf8");
const SKILL = "roles/research/skills/docs-research.md";
const SOURCES = "roles/research/references/sources.md";

function parse(): { meta: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(read(SKILL));
  if (!m) throw new Error("docs-research.md: no front matter");
  return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
}
const section = (body: string, title: string) => {
  const at = body.indexOf(`## ${title}`);
  if (at < 0) return "";
  const next = body.indexOf("\n## ", at + 3);
  return body.slice(at, next < 0 ? undefined : next);
};

describe("docs-research skill", () => {
  it("has a name, a description, a right/wrong pair and Sources last", () => {
    const { meta, body } = parse();
    expect(meta.name).toBe("docs-research");
    expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]!.trim());
    expect(headings).toContain("Right and wrong");
    expect(headings.at(-1)).toBe("Sources");
    expect(section(body, "Sources")).toMatch(/web-search-researcher/);
  });

  it("writes the five sections of a Docs Brief, with front matter for the reuse rule (R1, R9)", () => {
    const { body } = parse();
    for (const s of ["## Question", "## Answer", "## Evidence", "## Pitfalls", "## Not found"]) expect(body).toContain(s);
    for (const k of ["lib:", "version:", "topic:", "date:"]) expect(body).toContain(k);
    expect(body).toContain(".aidw/research/docs/<lib>@<major.minor>-<topic>.md");
    expect(body).toMatch(/aidw docs-brief/);
    expect(body).toMatch(/90 days/);
  });

  it("reads the installed version first and names the version of each claim; newer docs go to Pitfalls (R3)", () => {
    const { body } = parse();
    expect(body).toMatch(/lockfile/);
    expect(body).toMatch(/architecture/);
    expect(body).toMatch(/Version/);
    expect(body).toMatch(/newer[\s\S]{0,200}Pitfalls/i);
  });

  it("points to the shared sources page for the ladder, the fetch order and best practice (R4, R5)", () => {
    const { body } = parse();
    expect(body).toContain(`\`aidw plugin-path ${SOURCES}\``);
    expect(body).toMatch(/pitfalls/i);
    expect(body).not.toMatch(/2 to 3 searches/);
  });

  it("is in the Research Role's index", () => {
    const role = loadRole(plugin, "research")!;
    expect(role.skills.find((s) => s.name === "docs-research")?.when).toMatch(/library|service/);
  });
});

describe("sources.md carries the fetch order and the docs citations (R4, Q-R2; T4 review notes)", () => {
  const text = read(SOURCES);

  it("orders a configured docs MCP server, then llms.txt and its Markdown pages, then HTML", () => {
    const order = ["MCP", "llms.txt", "HTML"].map((w) => text.indexOf(w));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toMatch(/WebFetch/);
    expect(text).toMatch(/never with `curl`/);
  });

  it("says how a docs MCP result is cited, and that the API query comes after the MCP and llms.txt steps", () => {
    expect(text).toMatch(/MCP[\s\S]{0,400}(cite|Source)/);
    const api = text.slice(text.indexOf("**API or library**"));
    expect(api.slice(0, 400)).toMatch(/llms\.txt|fetch order/);
  });

  it("lets a Docs Brief add a Version column to the shared claim table (R3)", () => {
    expect(text).toMatch(/Docs Brief[\s\S]{0,300}`Version`/);
  });
});

describe("the Docs Brief Artifact (R9)", () => {
  it("is in the registry, owned by Research, checked by aidw docs-brief, under research/docs/", () => {
    const e = loadArtifacts(plugin)!["docs-brief"];
    expect(e).toMatchObject({ path: "research/docs/<lib>@<major.minor>-<topic>.md", owner: "research", validate: "aidw docs-brief" });
    expect(checkArtifacts(plugin).errors).toEqual([]);
  });

  it("the Research Role writes it and says it is also consulted from the build, once per task (Q-R1)", () => {
    const text = read("roles/research/role.md");
    expect(parseRoleText(text)!.header.writes).toContain("docs-brief");
    expect(text).toMatch(/\.aidw\/research\/docs\//);
    expect(text).toMatch(/once per task/);
  });

  it("the generated agent matches the profile", () => {
    expect(read("agents/research.md")).toBe(generateAgents(plugin)["research.md"]);
  });

  it("has a Role eval that covers docs-research: installed version, Version column, newer docs as a pitfall", () => {
    const c = loadEvalCases(plugin, "research").cases.find((x) => x.covers.includes("docs-research"));
    expect(c).toBeDefined();
    const t = c!.criteria.join("\n");
    expect(t).toMatch(/lockfile|installed/);
    expect(t).toMatch(/Pitfalls/);
    expect(t).toMatch(/version/i);
    expect(t).toMatch(/Not found/);
  });
});

