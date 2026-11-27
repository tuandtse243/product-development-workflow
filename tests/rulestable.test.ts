import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { takeDigests, writeResults as writeRecord, type CaseResult } from "../src/evalrun.js";
import { caseDigest, checkEvals, loadEvalCases, roleDigest, sharedDigest, workingDigest } from "../src/evals.js";
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
    expect(loadRuleTable(plugin, "qa")).toBeNull(); // no rules.md at all
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
    // a case with neither key (a Role still in prose) covers nothing and expects a deliverable
    expect(loadEvalCases(plugin, "database").cases[0]).toMatchObject({ covers: [] });
    expect(loadEvalCases(plugin, "database").cases[0]?.expect).toBeUndefined();
    expect(loadEvalCases(plugin, "backend").cases.find((c) => c.name === "contract-has-a-hole")).toMatchObject({ covers: ["B1"], expect: "ask" });
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
    expect(out).toMatch(/OK: 0 error\(s\)/);
    // A result file that is missing, stale or records a case not passed is the Role's C6 status, a warning for whoever
    // changes the Role, not a unit-test failure. Any other warning is.
    const warns = out.split("\n").filter((l) => l.startsWith("WARN"));
    expect(warns.filter((l) => !/roles\/[a-z-]+\/evals\/(level2\/)?results\.json/.test(l))).toEqual([]);
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

describe("the per-case result file (format 2)", () => {
  const NAMES = ["entity-is-not-a-response", "validates-authorizes-and-does-not-leak"];
  const result = (name: string, pass = true, total = 3): CaseResult => ({ role: "backend", name, pass, criteria: [], answer: "", runs: { total, passed: pass ? total : 0, errors: 0 } });
  const evalsDir = (root: string) => join(root, "roles", "backend", "evals");
  const touch = (root: string, rel: string) => writeFileSync(join(root, rel), readFileSync(join(root, rel), "utf8") + "\nmore\n");
  const fresh = () => {
    const root = copy();
    tableRole(root);
    writeRecord(root, "backend", NAMES.map((n) => result(n)), { runs: 3 });
    return root;
  };

  it("leaves the case files out of the shared digest and gives each its own", () => {
    const root = copy();
    tableRole(root);
    const shared = sharedDigest(root, "backend");
    const one = caseDigest(root, `roles/backend/evals/${NAMES[0]}.md`);
    const other = caseDigest(root, `roles/backend/evals/${NAMES[1]}.md`);
    touch(root, `roles/backend/evals/${NAMES[0]}.md`);
    expect(sharedDigest(root, "backend")).toBe(shared);
    expect(caseDigest(root, `roles/backend/evals/${NAMES[0]}.md`)).not.toBe(one);
    expect(caseDigest(root, `roles/backend/evals/${NAMES[1]}.md`)).toBe(other);
    writeFileSync(join(evalsDir(root), "notes.txt"), "other files under evals/ are shared content\n");
    expect(sharedDigest(root, "backend")).not.toBe(shared);
  });

  it("leaves the Role's scripts out of level 1's shared digest but not out of level 2's working digest", () => {
    const root = copy();
    tableRole(root);
    const shared = sharedDigest(root, "backend");
    const working = workingDigest(root, "backend");
    mkdirSync(join(root, "roles", "backend", "scripts"), { recursive: true });
    writeFileSync(join(root, "roles", "backend", "scripts", "probe.mjs"), "console.log('{}');\n");
    expect(sharedDigest(root, "backend")).toBe(shared);
    expect(workingDigest(root, "backend")).not.toBe(working);
    touch(root, "roles/backend/role.md");
    expect(sharedDigest(root, "backend")).not.toBe(shared);
  });

  it("counts the script helpers in library/scripts/ in the working digest of a Role with scripts only", () => {
    const root = copy();
    tableRole(root);
    mkdirSync(join(root, "roles", "backend", "scripts"), { recursive: true });
    writeFileSync(join(root, "roles", "backend", "scripts", "probe.mjs"), "import '../../../library/scripts/_h.mjs';\n");
    rmSync(join(root, "roles", "frontend", "scripts"), { recursive: true, force: true });
    const shared = sharedDigest(root, "backend");
    const working = workingDigest(root, "backend");
    const other = workingDigest(root, "frontend");
    mkdirSync(join(root, "library", "scripts"), { recursive: true });
    writeFileSync(join(root, "library", "scripts", "_h.mjs"), "export const h = 1;\n");
    expect(sharedDigest(root, "backend")).toBe(shared);
    expect(workingDigest(root, "backend")).not.toBe(working);
    expect(workingDigest(root, "frontend")).toBe(other);
  });

  it("is fresh after a full write, and editing one case file makes only that entry stale", () => {
    const root = fresh();
    const rec = JSON.parse(readFileSync(join(evalsDir(root), "results.json"), "utf8"));
    expect(rec).toMatchObject({ format: 2, digest: sharedDigest(root, "backend"), runs: 3 });
    expect(rec.cases[0]).toMatchObject({ name: NAMES[0], digest: caseDigest(root, `roles/backend/evals/${NAMES[0]}.md`) });
    expect(Number.isNaN(Date.parse(rec.cases[0].date))).toBe(false);
    expect(warns(checkEvals(root))).toBe("");
    touch(root, `roles/backend/evals/${NAMES[0]}.md`);
    expect(warns(checkEvals(root))).toBe(
      `roles/backend/evals/results.json: made from another version of its case file roles/backend/evals/${NAMES[0]}.md: run \`aidw eval backend --case ${NAMES[0]}\``,
    );
  });

  it("is stale as a whole when the shared content changes (role.md)", () => {
    const root = fresh();
    touch(root, "roles/backend/role.md");
    const w = warns(checkEvals(root));
    expect(w).toMatch(/older than the Role's content/);
    expect(w).not.toMatch(/case file/);
  });

  it("warns about a case with no entry, and drops the entry of a deleted case on write", () => {
    const root = fresh();
    const f = join(evalsDir(root), "a-new-case.md");
    writeFileSync(f, readFileSync(join(evalsDir(root), `${NAMES[0]}.md`), "utf8").replace(`case: ${NAMES[0]}`, "case: a-new-case"));
    expect(warns(checkEvals(root))).toMatch(/no result for case\(s\): a-new-case: run `aidw eval backend --case <name>` for each/);
    rmSync(f);
    writeRecord(root, "backend", [...NAMES, "gone"].map((n) => result(n)), { runs: 3 });
    expect(JSON.parse(readFileSync(join(evalsDir(root), "results.json"), "utf8")).cases.map((c: { name: string }) => c.name)).toEqual(NAMES);
    expect(warns(checkEvals(root))).toBe("");
  });

  it("ignores an entry whose case was deleted", () => {
    const root = fresh();
    rmSync(join(evalsDir(root), `${NAMES[1]}.md`));
    // B2 lost its only case: put it on the remaining one so coverage holds.
    const f = join(evalsDir(root), `${NAMES[0]}.md`);
    writeFileSync(f, readFileSync(f, "utf8").replace("covers: [B1", "covers: [B1, B2"));
    writeRecord(root, "backend", [result(NAMES[0]!)], { runs: 3 });
    const rec = JSON.parse(readFileSync(join(evalsDir(root), "results.json"), "utf8"));
    rec.cases.push({ name: NAMES[1], pass: false, runs: { total: 1, passed: 0, errors: 0 }, failed: [], digest: "sha256:x", date: rec.date });
    writeFileSync(join(evalsDir(root), "results.json"), JSON.stringify(rec));
    expect(warns(checkEvals(root))).toBe("");
  });

  it("warns per case about fewer than 3 runs and a failed case", () => {
    const root = copy();
    tableRole(root);
    writeRecord(root, "backend", [result(NAMES[0]!, true, 1), result(NAMES[1]!, false)], { runs: 1 });
    const w = warns(checkEvals(root));
    expect(w).toContain(`1 case(s) last ran fewer than 3 times: ${NAMES[0]}; a case passes level 1 only with 3 of 3`);
    expect(w).toContain(`the last run did not pass 1 case(s): ${NAMES[1]}`);
  });

  it("gives a CRLF case file the digest of its LF form", () => {
    const root = copy();
    const rel = `roles/backend/evals/${NAMES[0]}.md`;
    const lf = caseDigest(root, rel);
    writeFileSync(join(root, rel), readFileSync(join(root, rel), "utf8").replace(/\n/g, "\r\n"));
    expect(caseDigest(root, rel)).toBe(lf);
  });

  it("counts subfolders of evals/, the agent file and the library skills the Role lists as shared content", () => {
    const root = copy();
    tableRole(root);
    const shared = sharedDigest(root, "backend");
    mkdirSync(join(evalsDir(root), "fixtures"));
    writeFileSync(join(evalsDir(root), "fixtures", "input.md"), "not a case: a file a case may point to\n");
    const withSub = sharedDigest(root, "backend");
    expect(withSub).not.toBe(shared);
    expect(loadEvalCases(root, "backend").cases.map((c) => c.name)).toEqual(NAMES);
    touch(root, "agents/backend.md");
    const withAgent = sharedDigest(root, "backend");
    expect(withAgent).not.toBe(withSub);
    const role = join(root, "roles", "backend", "role.md");
    writeFileSync(role, readFileSync(role, "utf8").replace(/^skills:\n/m, "skills:\n  - library/external-api: when the task calls a third-party service\n"));
    const withLib = sharedDigest(root, "backend");
    expect(withLib).not.toBe(withAgent);
    touch(root, "library/skills/external-api/SKILL.md");
    expect(sharedDigest(root, "backend")).not.toBe(withLib);
  });

  it("treats a renamed case as a new case with no entry", () => {
    const root = fresh();
    const from = join(evalsDir(root), `${NAMES[0]}.md`);
    writeFileSync(join(evalsDir(root), "renamed-case.md"), readFileSync(from, "utf8").replace(`case: ${NAMES[0]}`, "case: renamed-case"));
    rmSync(from);
    expect(warns(checkEvals(root))).toBe("roles/backend/evals/results.json: no result for case(s): renamed-case: run `aidw eval backend --case <name>` for each");
  });

  it("does not trip over a malformed format-2 file", () => {
    const root = fresh();
    const rf = join(evalsDir(root), "results.json");
    const rec = JSON.parse(readFileSync(rf, "utf8"));
    for (const cases of [[null, 5, "x", rec.cases[1]], "not a list", null]) {
      writeFileSync(rf, JSON.stringify({ ...rec, cases }));
      expect(warns(checkEvals(root))).toContain(`no result for case(s): ${NAMES[0]}`);
    }
    for (const bad of ["null", "5", "[]"]) {
      writeFileSync(rf, bad);
      expect(() => checkEvals(root), bad).not.toThrow();
      expect(warns(checkEvals(root)), bad).toMatch(/results\.json: /);
    }
  });

  it("still reads an old-format file against the whole Role's digest", () => {
    const root = copy();
    tableRole(root);
    const cases = NAMES.map((name) => ({ name, pass: true, runs: { total: 3, passed: 3, errors: 0 }, failed: [] }));
    const old = { role: "backend", date: "2026-11-24T00:00:00.000Z", model: null, tier: "deep", runs: 3, digest: roleDigest(root, "backend"), cases };
    writeFileSync(join(evalsDir(root), "results.json"), JSON.stringify(old));
    expect(warns(checkEvals(root))).toBe("");
    touch(root, `roles/backend/evals/${NAMES[0]}.md`);
    expect(warns(checkEvals(root))).toMatch(/older than the Role's content/);
  });
});

describe("review fixes: model and shared content of the result file", () => {
  const NAMES = ["entity-is-not-a-response", "validates-authorizes-and-does-not-leak"];
  const result = (name: string): CaseResult => ({ role: "backend", name, pass: true, criteria: [], answer: "", runs: { total: 3, passed: 3, errors: 0 } });
  const file = (root: string) => join(root, "roles", "backend", "evals", "results.json");

  it("warns when the file was made on a model other than its tier's, top level or per case (M1)", () => {
    const root = copy();
    tableRole(root);
    writeRecord(root, "backend", NAMES.map(result), { runs: 3, model: "sonnet" });
    expect(warns(checkEvals(root))).toContain("made with model sonnet, not its tier's model (default): run `aidw eval backend` again");
    writeRecord(root, "backend", NAMES.map(result), { runs: 3 });
    expect(warns(checkEvals(root))).toBe("");
    const rec = JSON.parse(readFileSync(file(root), "utf8"));
    rec.cases[0].model = "haiku";
    writeFileSync(file(root), JSON.stringify(rec));
    expect(warns(checkEvals(root))).toBe(
      `roles/backend/evals/results.json: case ${NAMES[0]} was made with model haiku, not its tier's model (default): run \`aidw eval backend --case ${NAMES[0]}\``,
    );
  });

  it("covers the included shared procedures and tiers.yaml directly, without regenerating the agent file (L2)", () => {
    const root = copy();
    tableRole(root);
    const shared = sharedDigest(root, "backend");
    const whole = roleDigest(root, "backend");
    const inc = join(root, "library", "implement-a-task.md");
    writeFileSync(inc, readFileSync(inc, "utf8") + "\nmore\n");
    expect(sharedDigest(root, "backend")).not.toBe(shared);
    expect(roleDigest(root, "backend")).not.toBe(whole);
    const again = sharedDigest(root, "backend");
    const tiers = join(root, "tiers.yaml");
    writeFileSync(tiers, readFileSync(tiers, "utf8") + "# a comment\n");
    expect(sharedDigest(root, "backend")).not.toBe(again);
  });

  it("refuses to write when the shared content differs from the digests taken at the start (L3)", () => {
    const root = copy();
    tableRole(root);
    const digests = takeDigests(root, "backend");
    const role = join(root, "roles", "backend", "role.md");
    writeFileSync(role, readFileSync(role, "utf8") + "\nmore\n");
    expect(writeRecord(root, "backend", NAMES.map(result), { runs: 3, digests })).toEqual({ refused: "the Role changed during the run: run it again" });
  });
});
