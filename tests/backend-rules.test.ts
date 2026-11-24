import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { generateAgents, loadRole, loadRuleTable, parseRulesTable, RULE_CHECKERS, skillFile } from "../src/roles.js";

// The backend Role's real rules table and profile (plan T13): B1-B15, the skills index T14 and T17 fill, the five
// measuring scripts T15 ships, and fullstack following backend's rules.
const plugin = join(__dirname, "..", "plugins", "aidw");
const rulesFile = join(plugin, "roles", "backend", "rules.md");
const SCRIPTS = ["route-inventory", "env-names", "error-shape-probe", "query-count", "leak-and-timeout-scan"];
const AUTHORED = ["endpoint-test-matrix", "transactions-and-races", "repeat-safe-writes", "effects-after-commit", "server-logs-and-errors", "query-shape"];
const LIBRARY = ["library/external-api", "library/resilient-integration"];
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

describe("backend rules.md (T13)", () => {
  const rules = loadRuleTable(plugin, "backend") ?? [];

  it("parses as one table with no problems and ids B1 to B15 in order", () => {
    expect(parseRulesTable(readFileSync(rulesFile, "utf8")).problems).toEqual([]);
    expect(rules.map((r) => r.id)).toEqual(Array.from({ length: 15 }, (_, i) => `B${i + 1}`));
    expect(new Set(rules.map((r) => r.id)).size).toBe(15);
  });

  it("every row has a rule, an applies-when and only known checkers", () => {
    for (const r of rules) {
      expect(r.rule.length, r.id).toBeGreaterThan(20);
      expect(r.appliesWhen.length, r.id).toBeGreaterThan(5);
      expect(r.checkedBy.length, r.id).toBeGreaterThan(0);
      for (const c of r.checkedBy) expect(RULE_CHECKERS, `${r.id}: ${c}`).toContain(c);
    }
  });

  it("a rule names a measuring script exactly when a script checks it, and only scripts T15 ships", () => {
    for (const r of rules) {
      const named = [...r.rule.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]!).filter((n) => !/^(api|database|software)-/.test(n));
      for (const n of named) expect(SCRIPTS, `${r.id} names ${n}`).toContain(n);
      expect(named.length > 0, `${r.id}: names a script <=> checked by script`).toBe(r.checkedBy.includes("script"));
    }
    const all = rules.flatMap((r) => [...r.rule.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]!)).filter((n) => SCRIPTS.includes(n));
    expect(new Set(all)).toEqual(new Set(SCRIPTS)); // every script has a rule it measures
  });

  it("every Role a rule says to ask is one backend may consult", () => {
    const consults = loadRole(plugin, "backend")!.consults;
    const asked = rules.flatMap((r) => [...r.rule.matchAll(/ask (?:its author \()?`([a-z-]+)`/g)].map((m) => m[1]!));
    expect(asked.length).toBeGreaterThan(0);
    for (const a of asked) expect(consults, a).toContain(a);
  });
});

describe("backend role.md (T13)", () => {
  const role = loadRole(plugin, "backend")!;

  it("indexes the six authored skills (T14) and the two library skills (T17), each with a condition", () => {
    expect(role.skills.map((s) => s.name)).toEqual([...AUTHORED, ...LIBRARY]);
    for (const s of role.skills) expect(s.when, s.name).toMatch(/^when /);
    expect(role.skills.map((s) => skillFile("backend", s.name))).toEqual([
      ...AUTHORED.map((n) => `roles/backend/skills/${n}.md`),
      "library/skills/external-api/SKILL.md",
      "library/skills/resilient-integration/SKILL.md",
    ]);
  });

  it("lists the five scripts, each with the rule it serves", () => {
    for (const s of SCRIPTS) expect(role.body, s).toMatch(new RegExp(`^- \`${s}\`: .*\\(B\\d+(, B\\d+)*\\)`, "m"));
    const scripts = /## Scripts[\s\S]*?(?=\n## )/.exec(role.body)?.[0] ?? role.body;
    for (const r of loadRuleTable(plugin, "backend")!.filter((x) => x.checkedBy.includes("script"))) expect(scripts, r.id).toContain(r.id);
  });

  it("fullstack follows backend's rules and points at its rules.md", () => {
    const fs = loadRole(plugin, "fullstack")!;
    expect(fs.follows_rules).toEqual(["backend"]);
    expect(fs.body).toMatch(/roles\/backend\/rules\.md/);
  });

  it("the committed backend and fullstack agents are what role.md and rules.md generate", () => {
    const gen = generateAgents(plugin);
    for (const n of ["backend.md", "fullstack.md"]) expect(readFileSync(join(plugin, "agents", n), "utf8"), n).toBe(gen[n]);
    expect(gen["backend.md"]).toContain("| B15 |");
    for (const n of [...AUTHORED, ...LIBRARY]) expect(gen["backend.md"]).toContain(`aidw plugin-path ${skillFile("backend", n)}`);
  });

  it("with every indexed skill and lessons.md present, roster's only errors are uncovered rules and skills", () => {
    const root = mkdtempSync(join(tmpdir(), "aidw-backend-"));
    temps.push(root);
    cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
    for (const s of role.skills) {
      const f = join(root, skillFile("backend", s.name));
      if (existsSync(f)) continue;
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, `---\nname: ${s.name.replace(/^library\//, "")}\ndescription: a stub standing in for the skill another task ships\n---\n\nStub.\n`);
    }
    const lessons = join(root, "roles", "backend", "lessons.md");
    if (!existsSync(lessons)) writeFileSync(lessons, "# Lessons\n");
    let out = "";
    run(["roster"], { AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s) });
    expect(out).not.toMatch(/has no file|out of date|is not a/);
    const errors = out.split("\n").filter((l) => l.startsWith("ERROR"));
    for (const e of errors) expect(e).toMatch(/^ERROR\s+roles\/backend\/evals\s+(rule B\d+|skill [a-z/-]+) has no case/);
  });
});
