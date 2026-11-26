import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { loadEvalCases } from "../src/evals.js";
import { generateAgents, loadRole } from "../src/roles.js";

// The html-pages Authored Skill and the two user commands /aidw:show-me and /aidw:html-pages (rpi-upgrades T2;
// Q8, Q8b; ADR-0017). html-pages says which of the 20 vendored html-effectiveness examples fits which kind of page and
// what to take from it; show-me (vendored) picks the View.
const plugin = join(__dirname, "..", "plugins", "aidw");
const libFile = join(plugin, "library", "skills", "html-pages", "SKILL.md");
const examples = join(plugin, "library", "vendor", "anthropics", "html-effectiveness");

function parse(file: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`${file}: no front matter`);
  return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
}
const section = (body: string, title: string) => {
  const at = body.indexOf(`## ${title}`);
  if (at < 0) return "";
  const next = body.indexOf("\n## ", at + 3);
  return body.slice(at, next < 0 ? undefined : next);
};
const cli = (args: string[]) => {
  let out = "";
  const code = run(args, {}, plugin, { out: (s) => (out += s), err: () => undefined });
  return { code, out: out.trim() };
};

describe("library/skills/html-pages (Q8, Q8b)", () => {
  const { meta, body } = parse(libFile);

  it("has a name, a description, Sources last, and stays near 150 lines", () => {
    expect(meta.name).toBe("html-pages");
    expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]!.trim());
    expect(headings.at(-1)).toBe("Sources");
    const lines = readFileSync(libFile, "utf8").split("\n").length;
    expect(lines).toBeGreaterThan(100);
    expect(lines).toBeLessThan(200);
  });

  it("maps every vendored example by number, each to a kind of page, once", () => {
    const vendored = readdirSync(examples).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, 2));
    expect(vendored).toHaveLength(20);
    const rows = [...body.matchAll(/^\| (\d\d(?:, \d\d)*) \|/gm)].flatMap((m) => m[1]!.split(", "));
    expect([...rows].sort()).toEqual([...vendored].sort());
  });

  it("each row says what to take and what to leave", () => {
    const table = body.split("\n").filter((l) => /^\| \d\d/.test(l));
    for (const row of table) expect(row.split("|").filter((c) => c.trim()).length, row).toBe(4);
    expect(body).toMatch(/\| Kind of page \| Take \| Leave \|/);
  });

  it("names the CLI layouts after examples 01, 04, 16 and 17 (Q8b)", () => {
    for (const [layout, n] of [["approaches", "01"], ["walkthrough", "04"], ["plan", "16"], ["before-after", "17"]] as const) {
      expect(body, layout).toMatch(new RegExp(`\`${layout}\`[^\\n|]*\\b${n}\\b|\\b${n}\\b[^\\n]*\`${layout}\``));
    }
  });

  it("covers both kinds of HTML: the CLI's layouts and the HTML an Agent writes", () => {
    for (const s of ["`html` slot", "Existing System Report", "pull request", "aidw page render"]) expect(body, s).toContain(s);
  });

  it("states the shared rules: static, no script, nothing from the network, escaped text, page rules win", () => {
    const rules = section(body, "Every page follows the page rules");
    expect(rules).toMatch(/<script>/);
    expect(rules).toMatch(/network/);
    expect(rules).toMatch(/escape/i);
    expect(rules).toMatch(/decision-pages\.md/);
    expect(rules).toMatch(/page rules win/);
    expect(rules).toMatch(/<details>/); // what replaces the examples' toggles
    expect(rules).toMatch(/dark/);
  });

  it("takes layout and components, never the examples' content, labels or colours", () => {
    expect(body).toMatch(/layout and components/);
    expect(body).toMatch(/Acme/);
  });

  it("points to show-me for the View and never opens a page itself", () => {
    expect(body).toContain("aidw vendor-path humanlayer/show-me");
    expect(body).toMatch(/link/);
    expect(body).not.toMatch(/Bash\(open/);
  });

  it("names the CLI page's palette, the one src/page.ts uses", () => {
    const page = readFileSync(join(__dirname, "..", "src", "page.ts"), "utf8");
    const hexes = [...section(body, "Every page follows the page rules").matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]);
    expect(hexes.length).toBeGreaterThanOrEqual(6);
    for (const h of hexes) expect(page, h).toContain(h);
  });

  it("names its sources: html-effectiveness and show-me", () => {
    const sources = section(body, "Sources");
    expect(sources).toMatch(/html-effectiveness/);
    expect(sources).toMatch(/show-me/);
    expect(sources).toMatch(/MIT/);
  });

  it("resolves through vendor-path and plugin-path", () => {
    expect(cli(["vendor-path", "aidw/html-pages"])).toEqual({ code: 0, out: libFile });
    expect(cli(["plugin-path", "library/skills/html-pages/SKILL.md"])).toEqual({ code: 0, out: libFile });
  });
});

describe("decision-pages.md", () => {
  it("sends the html slot to html-pages for its layout", () => {
    const guide = readFileSync(join(plugin, "library", "decision-pages.md"), "utf8");
    const slot = guide.slice(guide.indexOf("### The free slot"));
    expect(slot).toContain("aidw vendor-path aidw/html-pages");
  });
});

describe("the user commands /aidw:show-me and /aidw:html-pages (Q8)", () => {
  it.each([
    ["show-me", "aidw vendor-path humanlayer/show-me"],
    ["html-pages", "aidw vendor-path aidw/html-pages"],
  ])("%s is a user skill that loads its library file", (name, load) => {
    const { meta, body } = parse(join(plugin, "skills", name, "SKILL.md"));
    expect(meta.name).toBe(name);
    expect(String(meta.description)).toContain(`/aidw:${name}`);
    expect(String(meta["allowed-tools"])).toContain("Bash(aidw *)");
    expect(body).toContain(load);
    expect(body).toContain("${CLAUDE_PLUGIN_ROOT}/bin/aidw");
    expect(body).toContain("aidw plugin-path library/vendored-skill-notes.md");
    expect(body).not.toMatch(/Bash\(open/);
  });

  it("show-me shows the View in the chat and a page only as a link", () => {
    const { body } = parse(join(plugin, "skills", "show-me", "SKILL.md"));
    expect(body).toMatch(/fenced block/);
    expect(body).toContain("aidw vendor-path aidw/html-pages"); // a page it writes follows html-pages
    expect(body).toMatch(/link/);
  });

  it("html-pages also loads show-me for the Views on the page", () => {
    const { body } = parse(join(plugin, "skills", "html-pages", "SKILL.md"));
    expect(body).toContain("aidw vendor-path humanlayer/show-me");
    expect(body).toContain("aidw plugin-path library/decision-pages.md");
  });
});

describe("Roles that write HTML pages list html-pages", () => {
  it.each(["documentation", "research"])("%s indexes library/html-pages with a condition about HTML pages", (id) => {
    const s = loadRole(plugin, id)!.skills.find((x) => x.name === "library/html-pages");
    expect(s, id).toBeDefined();
    expect(s!.when).toMatch(/^when /);
    expect(s!.when).toMatch(/HTML page/);
  });

  it("the committed agents point at the library path", () => {
    const gen = generateAgents(plugin);
    for (const id of ["documentation", "research"]) {
      const agent = readFileSync(join(plugin, "agents", `${id}.md`), "utf8");
      expect(agent, id).toContain("aidw plugin-path library/skills/html-pages/SKILL.md");
      expect(agent, id).toBe(gen[`${id}.md`]);
    }
  });

  it("has a Role eval: an example picked by kind of page, no script, nothing from the network, escaped code (M7)", () => {
    const c = loadEvalCases(plugin, "documentation").cases.find((x) => x.covers.includes("library/html-pages"));
    expect(c).toBeDefined();
    const text = readFileSync(join(plugin, c!.file), "utf8");
    expect(text).toMatch(/\b0?4\b|\b14\b/);
    expect(text).toMatch(/<script>/);
    expect(text).toMatch(/network/);
    expect(text).toMatch(/escape/i);
    expect(text).toMatch(/Acme/);
  });
});
