import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { generateAgents, loadRole, loadRuleTable, parseRoleText, parseRulesTable, RULE_CHECKERS, skillFile } from "../src/roles.js";

// The fullstack Role to the frontend pattern (plan T20, fullstack design): seam rules X1-X7, two authored skills,
// contract-tests moved to the shared library, the five backend and five frontend scripts listed by condition.
const plugin = join(__dirname, "..", "plugins", "aidw");
const rulesFile = join(plugin, "roles", "fullstack", "rules.md");
const skillsDir = join(plugin, "roles", "fullstack", "skills");
const AUTHORED = ["seam-test", "server-to-client-data"];
const SKILLS = [...AUTHORED, "library/contract-tests", "library/react-rules", "library/external-api", "library/resilient-integration"];
const BACKEND_SCRIPTS = ["route-inventory", "env-names", "error-shape-probe", "query-count", "leak-and-timeout-scan"];
const FRONTEND_SCRIPTS = ["token-literals", "a11y-names", "public-env-scan", "fetch-waterfalls", "route-guard-inventory"];
const BACKEND_SKILLS = ["endpoint-test-matrix", "transactions-and-races", "repeat-safe-writes", "effects-after-commit", "server-logs-and-errors", "query-shape"];
const FRONTEND_SKILLS = ["screen-states", "accessible-interactions", "testing-through-the-user", "client-data-and-state", "forms-from-the-contract"];

describe("fullstack rules.md", () => {
  const rules = loadRuleTable(plugin, "fullstack") ?? [];

  it("parses as one table with no problems and ids X1 to X7 in order", () => {
    expect(parseRulesTable(readFileSync(rulesFile, "utf8")).problems).toEqual([]);
    expect(rules.map((r) => r.id)).toEqual(Array.from({ length: 7 }, (_, i) => `X${i + 1}`));
  });

  it("every row has a rule, an applies-when and only known checkers", () => {
    for (const r of rules) {
      expect(r.rule.length, r.id).toBeGreaterThan(20);
      expect(r.appliesWhen.length, r.id).toBeGreaterThan(5);
      expect(r.checkedBy.length, r.id).toBeGreaterThan(0);
      for (const c of r.checkedBy) expect(RULE_CHECKERS, `${r.id}: ${c}`).toContain(c);
    }
  });

  it("every Role a rule says to ask is one fullstack may consult", () => {
    const consults = loadRole(plugin, "fullstack")!.consults;
    const asked = rules.flatMap((r) => [...r.rule.matchAll(/ask `([a-z-]+)`/g)].map((m) => m[1]!));
    expect(new Set(asked)).toEqual(new Set(["api-designer"]));
    for (const a of asked) expect(consults, a).toContain(a);
  });

  it("says the backend and frontend tables bind through follows_rules and the X rules need both halves", () => {
    const text = readFileSync(rulesFile, "utf8");
    expect(text).toMatch(/B1 to B15/);
    expect(text).toMatch(/F1 to F16/);
    expect(text).toMatch(/follows_rules/);
    expect(text).toMatch(/both a server half and a client half/);
  });
});

describe("fullstack role.md", () => {
  const role = loadRole(plugin, "fullstack")!;

  it("consults and reads are the decided lists", () => {
    expect(role.consults).toEqual(["api-designer", "database-architect", "software-architect", "ui-ux-designer", "research"]);
    expect(parseRoleText(readFileSync(join(plugin, "roles", "fullstack", "role.md"), "utf8"))!.header.reads).toEqual(["tasks", "delta-specs", "constitution", "design-direction", "design-tokens"]);
    expect(role.follows_rules).toEqual(["backend", "frontend"]);
    expect(role.includes).toEqual(["library/implement-a-task.md"]);
  });

  it("indexes the two authored skills and four library skills, each with a condition and a file", () => {
    expect(role.skills.map((s) => s.name)).toEqual(SKILLS);
    for (const s of role.skills) {
      expect(s.when, s.name).toMatch(/^when /);
      expect(existsSync(join(plugin, skillFile("fullstack", s.name))), s.name).toBe(true);
    }
    expect(role.skills.find((s) => s.name === "library/react-rules")!.when).toBe(loadRole(plugin, "frontend")!.skills.find((s) => s.name === "library/react-rules")!.when);
  });

  it("has the sections in order, a 12-line report with a Seam and a Found line", () => {
    const headings = [...role.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings.slice(0, 8)).toEqual(["Responsibility", "Boundaries and hand-off", "Procedure", "Scaffold task", "Done when", "Report", "Whom to ask", "Scripts"]);
    const block = /^## Report[\s\S]*?```\n([\s\S]*?)```/m.exec(role.body)![1]!;
    expect(block.trim().split("\n").length).toBeLessThanOrEqual(12);
    for (const k of ["Works now", "Server", "Screens", "Seam", "Files", "Verify", "Rules", "Scripts", "Asked", "Owed", "Found"]) expect(block, k).toMatch(new RegExp(`^${k}: `, "m"));
    expect(role.body).toMatch(/at most 12 lines/);
  });

  it("works outside in: the seam test is written before the server half and the screen", () => {
    const proc = /## Procedure[\s\S]*?(?=\n## )/.exec(role.body)![0];
    const at = (re: RegExp) => proc.search(re);
    expect(at(/^4\. Write the seam test first/m)).toBeGreaterThan(-1);
    expect(at(/^4\. Write the seam test first/m)).toBeLessThan(at(/^5\. Build the server half/m));
    expect(at(/^5\. Build the server half/m)).toBeLessThan(at(/^6\. Build the screen/m));
    expect(proc).toMatch(/CONSULT <request path>/);
  });

  it("reads F11 and F14 through X5 in the boundaries table, and sends only a split Slice to integration", () => {
    const table = /## Boundaries and hand-off[\s\S]*?(?=\n## )/.exec(role.body)![0];
    expect(table).toMatch(/X5 reads F11 and F14/);
    expect(table).toMatch(/\| `integration` \|/);
    expect(table).toMatch(/Slice split into backend, frontend and `integration` tasks/);
    expect(table).toMatch(/ask `database-architect` \(B15\)/);
    expect(table).toMatch(/ask `ui-ux-designer` as a Consultation \(F2\)/);
  });

  it("lists the ten scripts by path with a condition, and every one exists", () => {
    expect(role.body).toContain("aidw plugin-path roles/<role>/scripts/<name>.mjs");
    const scripts = /## Scripts[\s\S]*?(?=\n## )/.exec(role.body)![0];
    for (const [r, names] of [["backend", BACKEND_SCRIPTS], ["frontend", FRONTEND_SCRIPTS]] as const) {
      expect(scripts, r).toContain(`roles/${r}/scripts/`);
      for (const n of names) {
        expect(scripts, n).toMatch(new RegExp(`^- \`${n}\`: when `, "m"));
        expect(existsSync(join(plugin, "roles", r, "scripts", `${n}.mjs`)), n).toBe(true);
      }
    }
  });

  it("keeps pointers to the six backend and five frontend skills", () => {
    for (const s of BACKEND_SKILLS) expect(role.body, s).toContain(`aidw plugin-path roles/backend/skills/${s}.md`);
    for (const s of FRONTEND_SKILLS) expect(role.body, s).toContain(`aidw plugin-path roles/frontend/skills/${s}.md`);
  });

  it("has a short scaffold section: one Verify for both halves, a harness each, env names, no feature code", () => {
    const s = /## Scaffold task[\s\S]*?(?=\n## )/.exec(role.body)![0];
    expect(s).toMatch(/one Verify command that runs the tests of both halves/);
    expect(s).toMatch(/\.env\.example/);
    expect(s).toMatch(/no feature code/);
  });

  it("the committed fullstack and integration agents are what role.md and rules.md generate", () => {
    const gen = generateAgents(plugin);
    for (const n of ["fullstack.md", "integration.md"]) expect(readFileSync(join(plugin, "agents", n), "utf8"), n).toBe(gen[n]);
    expect(gen["fullstack.md"]).toContain("| X7 |");
  });
});

describe("fullstack skills", () => {
  const parse = (file: string) => {
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
    if (!m) throw new Error(`${file}: no front matter`);
    return { meta: YAML.parse(m[1]!) as Record<string, unknown>, body: m[2]! };
  };

  it("ships exactly the two authored skills", () => {
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
    expect(body).toMatch(/Serves rules? X\d+/);
  });

  it("seam-test serves X1 and X6 and names the three stack families; the other serves X3, X4 and X7", () => {
    const seam = readFileSync(join(skillsDir, "seam-test.md"), "utf8");
    expect(seam).toMatch(/Serves rules X1 and X6/);
    for (const w of ["MSW", "Next.js", "SvelteKit and Nuxt"]) expect(seam, w).toContain(w);
    expect(readFileSync(join(skillsDir, "server-to-client-data.md"), "utf8")).toMatch(/Serves rules X3, X4 and X7/);
  });
});

describe("contract-tests in the shared library", () => {
  it("lives at library/skills/contract-tests/SKILL.md and the old path is gone", () => {
    expect(existsSync(join(plugin, "library", "skills", "contract-tests", "SKILL.md"))).toBe(true);
    expect(existsSync(join(plugin, "roles", "integration", "skills", "contract-tests.md"))).toBe(false);
    expect(skillFile("integration", "library/contract-tests")).toBe("library/skills/contract-tests/SKILL.md");
  });

  it("resolves for both integration and fullstack", () => {
    for (const id of ["integration", "fullstack"]) {
      const s = loadRole(plugin, id)!.skills.find((x) => x.name === "library/contract-tests");
      expect(s, id).toBeDefined();
      expect(s!.when, id).toMatch(/^when /);
      expect(existsSync(join(plugin, skillFile(id, "library/contract-tests"))), id).toBe(true);
    }
    expect(loadRole(plugin, "integration")!.skills.find((x) => x.name === "library/contract-tests")!.when).toBe("when the client and the server meet over an HTTP or RPC contract, to prove they agree");
  });
});
