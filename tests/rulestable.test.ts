import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { checkEvals, loadEvalCases, roleDigest } from "../src/evals.js";
import { checkRoster, loadRuleTable, parseRulesTable, writeAgents } from "../src/roles.js";
import { bareBackend } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-rules-"));
  temps.push(root);
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  bareBackend(root);
  return root;
}

const TABLE = `Rules of the backend Role. Each is answered pass or fail.

| id | rule | applies when | checked by |
|---|---|---|---|
| B1 | Every route the diff adds is one the contract names. | the task adds or changes a route | reviewer, CLI |
| B2 | A route that takes a record id has three access tests. | the route takes a record id | reviewer, script |
`;

/** Makes backend a table-format Role: two rules, one skill, and its two cases covering all three. */
function tableRole(root: string, opts: { coverB2?: boolean; coverSkill?: boolean } = {}): void {
  const dir = join(root, "roles", "backend");
  writeFileSync(join(dir, "rules.md"), TABLE);
  const role = join(dir, "role.md");
  writeFileSync(role, readFileSync(role, "utf8").replace(/^access: (.*)$/m, "access: $1\nskills:\n  - effects-after-commit: when a write must also send something"));
  mkdirSync(join(dir, "skills"), { recursive: true });
  writeFileSync(join(dir, "skills", "effects-after-commit.md"), "---\nname: effects-after-commit\n---\nSend after commit.\n");
  const cover = (name: string, list: string) => {
    const f = join(dir, "evals", `${name}.md`);
    writeFileSync(f, readFileSync(f, "utf8").replace(`case: ${name}\n`, `case: ${name}\ncovers: [${list}]\n`));
  };
  cover("entity-is-not-a-response", ["B1", ...(opts.coverSkill === false ? [] : ["effects-after-commit"])].join(", "));
  cover("validates-authorizes-and-does-not-leak", opts.coverB2 === false ? "B1" : "B2");
  writeAgents(root);
}

const errs = (d: ReturnType<typeof checkEvals>) => d.errors.map((e) => `${e.file}: ${e.message}`).join("\n");
const warns = (d: ReturnType<typeof checkEvals>) => d.warnings.map((e) => `${e.file}: ${e.message}`).join("\n");

describe("rules.md as a table (R2)", () => {
  it("parses id, rule, applies when and who checks", () => {
    const t = parseRulesTable(TABLE);
    expect(t.table).toBe(true);
    expect(t.problems).toEqual([]);
    expect(t.rules).toEqual([
      { id: "B1", rule: "Every route the diff adds is one the contract names.", appliesWhen: "the task adds or changes a route", checkedBy: ["reviewer", "CLI"] },
      { id: "B2", rule: "A route that takes a record id has three access tests.", appliesWhen: "the route takes a record id", checkedBy: ["reviewer", "script"] },
    ]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    const t = parseRulesTable("| id | rule | applies when | checked by |\n|---|---|---|---|\n| B1 | `a \\| b` is one value | always | reviewer |\n");
    expect(t.rules[0]?.rule).toBe("`a | b` is one value");
  });

  it("leaves a prose rules.md alone", () => {
    const prose = readFileSync(join(plugin, "roles", "code-reviewer", "rules.md"), "utf8");
    expect(parseRulesTable(prose)).toEqual({ table: false, rules: [], problems: [] });
    expect(loadRuleTable(plugin, "code-reviewer")).toBeNull();
    expect(loadRuleTable(plugin, "frontend")).toBeNull(); // no rules.md at all
  });

  it("reports a duplicate id, an empty field, a bad id, an unknown checker and a bad header", () => {
    const bad = parseRulesTable(
      "| id | rule | applies when | checked by |\n|---|---|---|---|\n" +
        "| B1 | One. | always | reviewer |\n| B1 | Two. | always | reviewer |\n| B3 |  | always | reviewer |\n" +
        "| b4 | Four. | always | reviewer |\n| B5 | Five. | always | linter |\n| B6 | Six. |  |  |\n| B7 | Seven. | always |\n",
    ).problems.join("\n");
    expect(bad).toMatch(/id "B1" is used twice/);
    expect(bad).toMatch(/B3: the rule is empty/);
    expect(bad).toMatch(/id "b4" must be capital letters then a number/);
    expect(bad).toMatch(/B5: checked by "linter" is not one of reviewer, script, CLI/);
    expect(bad).toMatch(/B6: "applies when" is empty/);
    expect(bad).toMatch(/B6: "checked by" is empty/);
    expect(bad).toMatch(/B7: a row has 3 cells, expected 4/);
    expect(parseRulesTable("| id | rule | when |\n|---|---|---|\n| B1 | x | y |\n").problems.join("\n")).toMatch(/header must be \| id \| rule \| applies when \| checked by \|/);
    expect(parseRulesTable("| id | rule | applies when | checked by |\n|---|---|---|---|\n").problems.join("\n")).toMatch(/has no rules/);
  });

  it("aidw roster reports a broken table in rules.md", () => {
    const root = copy();
    tableRole(root);
    writeFileSync(join(root, "roles", "backend", "rules.md"), TABLE.replace("| B2 |", "| B1 |"));
    expect(checkRoster(root).errors.map((e) => `${e.file}: ${e.message}`).join("\n")).toMatch(/roles\/backend\/rules\.md: id "B1" is used twice/);
  });
});

describe("cases cover rules and skills (C1)", () => {
  it("parses covers and expect from the case front matter", () => {
    const root = copy();
    tableRole(root);
    const f = join(root, "roles", "backend", "evals", "validates-authorizes-and-does-not-leak.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("covers: [B2]\n", "covers: [B2]\nexpect: ask\n"));
    const cases = loadEvalCases(root, "backend").cases;
    expect(cases.find((c) => c.name === "entity-is-not-a-response")).toMatchObject({ covers: ["B1", "effects-after-commit"] });
    expect(cases.find((c) => c.name === "validates-authorizes-and-does-not-leak")).toMatchObject({ covers: ["B2"], expect: "ask" });
    expect(loadEvalCases(plugin, "backend").cases[0]).toMatchObject({ covers: [] });
    expect(loadEvalCases(plugin, "backend").cases[0]?.expect).toBeUndefined();
  });

  it("rejects a bad expect, a covers that is not a list and an unknown key", () => {
    const root = copy();
    const f = join(root, "roles", "backend", "evals", "entity-is-not-a-response.md");
    const text = readFileSync(f, "utf8");
    writeFileSync(f, text.replace("case: entity-is-not-a-response\n", "case: entity-is-not-a-response\nexpect: stop\ncovers: B1\ncover: [B1]\n"));
    const out = errs(checkEvals(root));
    expect(out).toMatch(/expect must be "ask"/);
    expect(out).toMatch(/covers must be a list/);
    expect(out).toMatch(/unknown key "cover"/);
  });

  it("passes when every rule and skill of a table Role has a case", () => {
    const root = copy();
    tableRole(root);
    expect(errs(checkEvals(root))).toBe("");
  });

  it("fails on a rule or a skill no case covers, only for a table Role", () => {
    let root = copy();
    tableRole(root, { coverB2: false });
    expect(errs(checkEvals(root))).toMatch(/roles\/backend\/evals: rule B2 has no case \(add it to a case's covers:\)/);
    root = copy();
    tableRole(root, { coverSkill: false });
    expect(errs(checkEvals(root))).toMatch(/roles\/backend\/evals: skill effects-after-commit has no case/);
    // a Role still in prose is not checked: database has skills and no covers
    expect(errs(checkEvals(root))).not.toMatch(/roles\/database\//);
    expect(errs(checkEvals(plugin))).toBe("");
  });

  it("fails on covers naming an id the Role does not have", () => {
    const root = copy();
    tableRole(root);
    const f = join(root, "roles", "backend", "evals", "entity-is-not-a-response.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("covers: [B1, effects-after-commit]", "covers: [B1, B9, effects-after-commit]"));
    expect(errs(checkEvals(root))).toMatch(/roles\/backend\/evals\/entity-is-not-a-response\.md: covers "B9" is not a rule id or a skill of backend/);
    // also on a Role still in prose: nothing there can be covered by a rule id
    const g = join(root, "roles", "database", "evals", "not-null-column-on-a-table-with-rows.md");
    writeFileSync(g, readFileSync(g, "utf8").replace(/^(case: .*)$/m, "$1\ncovers: [expand-contract, D1]"));
    const out = errs(checkEvals(root));
    expect(out).toMatch(/covers "D1" is not a rule id or a skill of database/);
    expect(out).not.toMatch(/covers "expand-contract"/);
  });

  it("aidw roster fails on an uncovered rule and stays OK for the plugin as it is", () => {
    const root = copy();
    tableRole(root, { coverB2: false });
    let out = "";
    const code = run(["roster"], { AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s) });
    expect(code).toBe(1);
    expect(out).toMatch(/rule B2 has no case/);
    out = "";
    expect(run(["roster"], { AIDW_PLUGIN_ROOT: plugin }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s) }), out).toBe(0);
    expect(out).not.toMatch(/results\.json/); // no Role is in table format yet: no staleness warning
  });
});

describe("the result file of a Role's cases (C6)", () => {
  const writeResults = (root: string, digest: string, pass = true, runs = 3) =>
    writeFileSync(
      join(root, "roles", "backend", "evals", "results.json"),
      JSON.stringify({ role: "backend", date: "2026-11-24T00:00:00.000Z", model: null, tier: "standard", runs, digest, cases: [{ name: "x", pass, runs: { total: 3, passed: pass ? 3 : 2, errors: 0 } }] }),
    );

  it("the digest covers the Role's content and not the result file", () => {
    const root = copy();
    tableRole(root);
    const a = roleDigest(root, "backend");
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    writeResults(root, a);
    expect(roleDigest(root, "backend")).toBe(a);
    for (const f of ["rules.md", "role.md", "skills/effects-after-commit.md", "evals/entity-is-not-a-response.md"]) {
      const r = copy();
      tableRole(r);
      const before = roleDigest(r, "backend");
      writeFileSync(join(r, "roles", "backend", f), readFileSync(join(r, "roles", "backend", f), "utf8") + "\nmore\n");
      expect(roleDigest(r, "backend"), f).not.toBe(before);
    }
    const r = copy();
    tableRole(r);
    const before = roleDigest(r, "backend");
    mkdirSync(join(r, "roles", "backend", "scripts"), { recursive: true });
    writeFileSync(join(r, "roles", "backend", "scripts", "env-names.mjs"), "export {};\n");
    expect(roleDigest(r, "backend")).not.toBe(before);
  });

  it("aidw roster warns, not fails, when the file is missing, stale or records a failed case", () => {
    const root = copy();
    tableRole(root);
    let d = checkEvals(root);
    expect(d.errors).toEqual([]);
    expect(warns(d)).toMatch(/roles\/backend\/evals\/results\.json: missing: run `aidw eval backend` and commit the file/);
    writeResults(root, "sha256:old");
    expect(warns(checkEvals(root))).toMatch(/older than the Role's content/);
    writeResults(root, roleDigest(root, "backend"));
    expect(warns(checkEvals(root))).toBe("");
    writeResults(root, roleDigest(root, "backend"), false);
    expect(warns(checkEvals(root))).toMatch(/the last run did not pass 1 case\(s\): x/);
    writeFileSync(join(root, "roles", "backend", "evals", "results.json"), "{ nope");
    d = checkEvals(root);
    expect(d.errors).toEqual([]);
    expect(warns(d)).toMatch(/not readable/);
    writeResults(root, roleDigest(root, "backend"), true, 1);
    expect(warns(checkEvals(root))).toMatch(/the last run had 1 run\(s\) per case; a case passes level 1 only with 3 of 3/);
  });

  it("the digest also covers the generated agent file and a library skill the Role lists, and any other file of the Role", () => {
    const root = copy();
    tableRole(root);
    let before = roleDigest(root, "backend");
    writeFileSync(join(root, "agents", "backend.md"), readFileSync(join(root, "agents", "backend.md"), "utf8") + "\nchanged include\n");
    expect(roleDigest(root, "backend")).not.toBe(before);
    before = roleDigest(root, "backend");
    writeFileSync(join(root, "roles", "backend", "lessons.md"), "a lesson\n");
    expect(roleDigest(root, "backend")).not.toBe(before);
    const role = join(root, "roles", "backend", "role.md");
    writeFileSync(role, readFileSync(role, "utf8").replace("skills:\n", "skills:\n  - library/api-design-rules: when designing a route\n"));
    before = roleDigest(root, "backend");
    const lib = join(root, "library", "skills", "api-design-rules", "SKILL.md");
    writeFileSync(lib, readFileSync(lib, "utf8") + "\nmore\n");
    expect(roleDigest(root, "backend")).not.toBe(before);
  });

  it("aidw roster --strict fails on a warning", () => {
    const root = copy();
    tableRole(root);
    const go = (argv: string[]) => {
      let out = "";
      const code = run(argv, { AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s) });
      return { code, out };
    };
    expect(go(["roster"]).code).toBe(0); // results.json missing: a warning
    const strict = go(["roster", "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.out).toMatch(/FAILED: 0 error\(s\), 1 warning\(s\) \(strict\)/);
  });
});

describe("library skills in a Role's index (R5)", () => {
  const listLib = (root: string, entry: string) => {
    const role = join(root, "roles", "backend", "role.md");
    writeFileSync(role, readFileSync(role, "utf8").replace(/^access: (.*)$/m, `access: $1\nskills:\n  - ${entry}`));
  };

  it("resolves library/<name> to library/skills/<name>/SKILL.md and refuses one that does not exist", () => {
    let root = copy();
    listLib(root, "library/api-design-rules: when designing a route");
    writeAgents(root);
    expect(checkRoster(root).errors.map((e) => e.message)).toEqual([]);
    expect(readFileSync(join(root, "agents", "backend.md"), "utf8")).toContain("aidw plugin-path library/skills/api-design-rules/SKILL.md");
    root = copy();
    listLib(root, "library/nope: never");
    expect(checkRoster(root).errors.map((e) => e.message).join("\n")).toMatch(/skill "library\/nope" has no file library\/skills\/nope\/SKILL\.md/);
  });

  it("counts for coverage and for covers:", () => {
    const root = copy();
    tableRole(root);
    const role = join(root, "roles", "backend", "role.md");
    writeFileSync(role, readFileSync(role, "utf8").replace("skills:\n", "skills:\n  - library/api-design-rules: when designing a route\n"));
    expect(errs(checkEvals(root))).toMatch(/skill library\/api-design-rules has no case/);
    const f = join(root, "roles", "backend", "evals", "validates-authorizes-and-does-not-leak.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("covers: [B2]", "covers: [B2, library/api-design-rules]"));
    expect(errs(checkEvals(root))).toBe("");
  });
});

describe("follows_rules in role.md", () => {
  const follows = (root: string, role: string, list: string) => {
    const file = join(root, "roles", role, "role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^access: (.*)$/m, `access: $1\nfollows_rules: ${list}`));
  };
  const rosterErrs = (root: string) => checkRoster(root).errors.map((e) => `${e.file}: ${e.message}`).join("\n");

  it("accepts a Role with a rules.md and refuses the Role itself, an unknown Role, one without rules.md, a twice-listed one and a non-list", () => {
    let root = copy();
    tableRole(root);
    follows(root, "fullstack", "[backend]");
    writeAgents(root);
    expect(rosterErrs(root)).toBe("");
    root = copy();
    follows(root, "fullstack", "[backend]");
    expect(rosterErrs(root)).toMatch(/roles\/fullstack\/role\.md: follows_rules: "backend" has no rules\.md/);
    root = copy();
    follows(root, "fullstack", "[fullstack, nobody]");
    expect(rosterErrs(root)).toMatch(/follows_rules: a role does not list itself/);
    expect(rosterErrs(root)).toMatch(/follows_rules: "nobody" is not a role in roster\.yaml/);
    root = copy();
    tableRole(root);
    follows(root, "fullstack", "[backend, backend]");
    expect(rosterErrs(root)).toMatch(/follows_rules lists a role twice/);
    root = copy();
    follows(root, "fullstack", "backend");
    expect(rosterErrs(root)).toMatch(/follows_rules must be a list of role ids/);
  });
});
