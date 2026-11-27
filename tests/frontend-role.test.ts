import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { generateAgents, loadRole, loadRuleTable, parseRulesTable, RULE_CHECKERS, skillFile } from "../src/roles.js";

// The frontend Role to the backend pattern (plan T20): rules F1-F16, five authored skills, the library's react-rules,
// the vendored lookup material as references, and fullstack following frontend's rules too.
const plugin = join(__dirname, "..", "plugins", "aidw");
const rulesFile = join(plugin, "roles", "frontend", "rules.md");
const skillsDir = join(plugin, "roles", "frontend", "skills");
const SCRIPTS = ["token-literals", "a11y-names", "public-env-scan"];
const AUTHORED = ["screen-states", "accessible-interactions", "testing-through-the-user", "client-data-and-state", "forms-from-the-contract"];
const LIBRARY = ["library/react-rules"];
const REFERENCES = ["library/vendor/vercel/command.md", "library/vendor/impeccable/harden.md", "library/vendor/impeccable/clarify.md"];

describe("frontend rules.md (T20)", () => {
  const rules = loadRuleTable(plugin, "frontend") ?? [];

  it("parses as one table with no problems and ids F1 to F16 in order", () => {
    expect(parseRulesTable(readFileSync(rulesFile, "utf8")).problems).toEqual([]);
    expect(rules.map((r) => r.id)).toEqual(Array.from({ length: 16 }, (_, i) => `F${i + 1}`));
  });

  it("every row has a rule, an applies-when and only known checkers", () => {
    for (const r of rules) {
      expect(r.rule.length, r.id).toBeGreaterThan(20);
      expect(r.appliesWhen.length, r.id).toBeGreaterThan(5);
      expect(r.checkedBy.length, r.id).toBeGreaterThan(0);
      for (const c of r.checkedBy) expect(RULE_CHECKERS, `${r.id}: ${c}`).toContain(c);
    }
  });

  it("a rule names a measuring script exactly when a script checks it, and only the scripts that ship first", () => {
    for (const r of rules) {
      const named = [...r.rule.matchAll(/`([a-z0-9]+(?:-[a-z]+)+)`/g)].map((m) => m[1]!).filter((n) => !/^(api|ui|software|aria|color|v)-/.test(n)); // Roles, attributes, CSS and template syntax are not scripts
      for (const n of named) expect(SCRIPTS, `${r.id} names ${n}`).toContain(n);
      expect(named.length > 0, `${r.id}: names a script <=> checked by script`).toBe(r.checkedBy.includes("script"));
    }
  });

  it("every Role a rule says to ask is one frontend may consult", () => {
    const consults = loadRole(plugin, "frontend")!.consults;
    expect(consults).toEqual(["api-designer", "ui-ux-designer", "software-architect"]);
    const asked = rules.flatMap((r) => [...r.rule.matchAll(/ask `([a-z-]+)`/g)].map((m) => m[1]!));
    expect(new Set(asked)).toEqual(new Set(["api-designer", "ui-ux-designer"]));
    for (const a of asked) expect(consults, a).toContain(a);
  });
});

describe("frontend role.md (T20)", () => {
  const role = loadRole(plugin, "frontend")!;

  it("indexes the five authored skills and react-rules, each with a condition and a file", () => {
    expect(role.skills.map((s) => s.name)).toEqual([...AUTHORED, ...LIBRARY]);
    for (const s of role.skills) {
      expect(s.when, s.name).toMatch(/^when /);
      expect(existsSync(join(plugin, skillFile("frontend", s.name))), s.name).toBe(true);
    }
    expect(role.includes).toEqual(["library/implement-a-task.md"]);
  });

  it("has the backend pattern's sections and a report with a Found line", () => {
    const headings = [...role.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    for (const h of ["Responsibility", "Boundaries and hand-off", "Procedure", "Done when", "Report", "Whom to ask", "Scripts"]) expect(headings, h).toContain(h);
    expect(role.body).toMatch(/^Found: /m);
  });

  it("asks ui-ux-designer about a hole in the design and builds the rest meanwhile", () => {
    const ask = /## Whom to ask[\s\S]*?(?=\n## )/.exec(role.body)![0];
    expect(ask).toMatch(/\*\*`ui-ux-designer`\*\*: the design has a hole/);
    expect(role.body).toMatch(/ask `ui-ux-designer` as a Consultation \(F2\) and build the rest of the task meanwhile/);
    expect(loadRuleTable(plugin, "frontend")!.find((r) => r.id === "F2")!.rule).toMatch(/ask `ui-ux-designer` as a Consultation and build the rest of the task meanwhile/);
  });

  it("carries the tokens in six lines of its Procedure", () => {
    const step = /^4\. Apply the design tokens[\s\S]*?(?=\n5\. )/m.exec(role.body)![0];
    expect(step.split("\n").filter((l) => /^ {3}- /.test(l))).toHaveLength(6);
  });

  it("lists the scripts with the rules they serve, and points at the vendored lookup material", () => {
    for (const s of SCRIPTS) expect(role.body, s).toMatch(new RegExp(`^- \`${s}\`: [\\s\\S]*?\\(F\\d+(, F\\d+)*\\)`, "m"));
    for (const r of REFERENCES) {
      expect(role.body, r).toContain(`aidw plugin-path ${r}`);
      expect(existsSync(join(plugin, r)), r).toBe(true);
    }
  });

  it("the committed frontend and fullstack agents are what role.md and rules.md generate", () => {
    const gen = generateAgents(plugin);
    for (const n of ["frontend.md", "fullstack.md"]) expect(readFileSync(join(plugin, "agents", n), "utf8"), n).toBe(gen[n]);
    expect(gen["frontend.md"]).toContain("| F16 |");
  });

  it("fullstack follows frontend's rules too, and no longer points at a section frontend dropped", () => {
    const fs = loadRole(plugin, "fullstack")!;
    expect(fs.follows_rules).toEqual(["backend", "frontend"]);
    expect(fs.body).toMatch(/roles\/frontend\/rules\.md/);
    expect(fs.body).not.toMatch(/What this Role knows/);
    for (const s of AUTHORED) expect(fs.body, s).toContain(`aidw plugin-path roles/frontend/skills/${s}.md`);
  });
});

describe("frontend skills (T20)", () => {
  const parse = (file: string) => {
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
    if (!m) throw new Error(`${file}: no front matter`);
    return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
  };

  it("ships the five skills the frontend Role lists", () => {
    expect(readdirSync(skillsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort()).toEqual([...AUTHORED].sort());
  });

  it.each(AUTHORED)("%s has a name, a description, Steps, a right/wrong pair and Sources last", (name) => {
    const { meta, body } = parse(join(skillsDir, `${name}.md`));
    expect(meta.name).toBe(name);
    expect(typeof meta.description === "string" && meta.description.length > 20).toBe(true);
    const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]!.trim());
    expect(headings).toEqual(["Steps", "Right and wrong", "Sources"]);
    const pair = body.slice(body.indexOf("## Right and wrong"), body.indexOf("## Sources"));
    expect(pair).toMatch(/^Right\b/m);
    expect(pair).toMatch(/^Wrong\b/m);
    expect(body).toMatch(/Serves rules? F\d+/);
  });

  it("client-data-and-state points at react-rules instead of restating it", () => {
    expect(readFileSync(join(skillsDir, "client-data-and-state.md"), "utf8")).toMatch(/`aidw\/react-rules`/);
  });
});
