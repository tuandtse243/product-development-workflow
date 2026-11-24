import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { type Exec } from "../src/evalrun.js";
import { checkEvals, roleDigest } from "../src/evals.js";
import { parseRulesTable, writeAgents } from "../src/roles.js";
import { bareBackend } from "./fixtures.js";

/** Edge cases of T12: the rules table, covers, the digest and the result file. Every test works on a temp copy of the plugin. */
const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-rules-probe-"));
  temps.push(root);
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  bareBackend(root);
  return root;
}

const HEAD = "| id | rule | applies when | checked by |\n|---|---|---|---|\n";
const TABLE = `Rules of the backend Role.\n\n${HEAD}| B1 | One. | the task adds a route | reviewer, CLI |\n| B2 | Two. | the route takes an id | reviewer, script |\n`;

/** backend as a table Role with one skill; its two cases cover B1 + the skill, and B2. */
function tableRole(root: string): string {
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
  cover("entity-is-not-a-response", "B1, effects-after-commit");
  cover("validates-authorizes-and-does-not-leak", "B2");
  writeAgents(root);
  return dir;
}

const errs = (d: ReturnType<typeof checkEvals>) => d.errors.map((e) => `${e.file}: ${e.message}`).join("\n");

describe("rules table edge cases (R2)", () => {
  it("reads a CRLF file like the LF one", () => {
    const lf = parseRulesTable(TABLE);
    const crlf = parseRulesTable(TABLE.replace(/\n/g, "\r\n"));
    expect(crlf).toEqual(lf);
    expect(crlf.problems).toEqual([]);
  });

  it("accepts a header in another case and trailing spaces after a row", () => {
    const t = parseRulesTable("| ID | Rule | Applies When | Checked By |\n| --- | :--- | --- | ---: |\n| B1 | One. | always | reviewer |   \n|B2|Two.|always|CLI|\t\n");
    expect(t.problems).toEqual([]);
    expect(t.rules.map((r) => r.id)).toEqual(["B1", "B2"]);
    expect(t.rules[1]).toMatchObject({ rule: "Two.", appliesWhen: "always", checkedBy: ["CLI"] });
  });

  it("reads a row without its closing pipe", () => {
    const t = parseRulesTable(`${HEAD}| B1 | One. | always | reviewer\n`);
    expect(t.problems).toEqual([]);
    expect(t.rules[0]?.checkedBy).toEqual(["reviewer"]);
  });

  it("reports an extra column in the header and in a row", () => {
    expect(parseRulesTable("| id | rule | applies when | checked by | note |\n|---|---|---|---|---|\n| B1 | One. | always | reviewer | x |\n").problems.join("\n")).toMatch(/header must be/);
    expect(parseRulesTable(`${HEAD}| B1 | One. | always | reviewer | extra |\n`).problems.join("\n")).toMatch(/B1: a row has 5 cells, expected 4/);
  });

  it("reports an unescaped pipe in a code span instead of reading a wrong rule (GFM splits it too)", () => {
    const t = parseRulesTable(`${HEAD}| B1 | \`a|b\` is one value | always | reviewer |\n`);
    expect(t.problems.join("\n")).toMatch(/B1: a row has 5 cells, expected 4/);
    expect(t.rules).toEqual([]);
  });

  it("reports a missing separator row", () => {
    expect(parseRulesTable("| id | rule | applies when | checked by |\n| B1 | One. | always | reviewer |\n").problems.join("\n")).toMatch(/separator row/);
  });

  it("ends the table at the first line that is not a row; a second, other table after it is left alone", () => {
    const t = parseRulesTable(`${TABLE}\nText after.\n\n| situation | do |\n|---|---|\n| a | b |\n`);
    expect(t.problems).toEqual([]);
    expect(t.rules.map((r) => r.id)).toEqual(["B1", "B2"]);
  });



  it("reports a trailing comma in checked by", () => {
    expect(parseRulesTable(`${HEAD}| B1 | One. | always | reviewer, |\n`).problems.length).toBeGreaterThan(0);
  });
});

describe("covers edge cases (C1)", () => {
  it("does not take a skill's file name for its index name", () => {
    const root = copy();
    const dir = tableRole(root);
    const f = join(dir, "evals", "entity-is-not-a-response.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("covers: [B1, effects-after-commit]", "covers: [B1, effects-after-commit.md]"));
    const out = errs(checkEvals(root));
    expect(out).toMatch(/covers "effects-after-commit\.md" is not a rule id or a skill of backend/);
    expect(out).toMatch(/skill effects-after-commit has no case/);
  });

  it("does not check coverage for a prose Role that has skills, nor warn about its result file", () => {
    const root = copy();
    // database has skills and a prose rules.md: no covers needed, no results.json asked for
    writeFileSync(join(root, "roles", "database", "rules.md"), "- Never drop a column in one step.\n- Index every foreign key.\n");
    const d = checkEvals(root);
    expect(d.errors.filter((e) => e.file.includes("roles/database"))).toEqual([]);
    expect(d.warnings.filter((e) => e.file.includes("roles/database"))).toEqual([]);
  });

  it("aidw roster exits 0 for a fully covered table Role and prints the missing result file warning", () => {
    const root = copy();
    tableRole(root);
    let out = "";
    const code = run(["roster"], { AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s) });
    expect(code, out).toBe(0);
    expect(out).toMatch(/roles\/backend\/evals\/results\.json/);
  });
});

describe("roleDigest stability (C6)", () => {
  it("does not depend on the order the files were made", () => {
    const a = copy();
    const b = copy();
    for (const [root, order] of [
      [a, ["zeta.md", "alpha.md"]],
      [b, ["alpha.md", "zeta.md"]],
    ] as const) {
      mkdirSync(join(root, "roles", "backend", "references"), { recursive: true });
      for (const n of order) writeFileSync(join(root, "roles", "backend", "references", n), `${n}\n`);
    }
    expect(roleDigest(a, "backend")).toBe(roleDigest(b, "backend"));
  });

  it("changes with a new case file or any other file of the Role, and not with results.json", () => {
    const root = copy();
    const before = roleDigest(root, "backend");
    writeFileSync(join(root, "roles", "backend", "evals", "results.json"), "{}\n");
    expect(roleDigest(root, "backend")).toBe(before);
    writeFileSync(join(root, "roles", "backend", "evals", "notes.txt"), "x\n");
    expect(roleDigest(root, "backend")).not.toBe(before); // every file of the Role counts, but the result file
    writeFileSync(join(root, "roles", "backend", "evals", "new-case.md"), "---\ncase: new-case\n---\n");
    expect(roleDigest(root, "backend")).not.toBe(before);
  });

  it("changes when a file moves between skills/ and references/ with the same content", () => {
    const a = copy();
    const b = copy();
    mkdirSync(join(a, "roles", "backend", "skills"), { recursive: true });
    mkdirSync(join(b, "roles", "backend", "references"), { recursive: true });
    writeFileSync(join(a, "roles", "backend", "skills", "x.md"), "x\n");
    writeFileSync(join(b, "roles", "backend", "references", "x.md"), "x\n");
    expect(roleDigest(a, "backend")).not.toBe(roleDigest(b, "backend"));
  });


});

describe("FLAKY through aidw eval (C2, C6)", () => {
  it("exits 1 and records the case as not passed with 2 of 3 runs", () => {
    const repoFile = join(plugin, "roles", "backend", "evals", "results.json");
    const before = existsSync(repoFile) ? readFileSync(repoFile) : null;
    const root = copy();
    execFileSync("git", ["init", "-q"], { cwd: root }); // a source checkout: only there is the result file written
    let grade = 0;
    // runs 1 of 3 of every case fails, the others pass
    const exec: Exec = (prompt, system) => {
      if (system) return "ANSWER " + "x".repeat(400);
      const pass = grade++ % 3 !== 0;
      const n = (prompt.match(/^\d+\. /gm) ?? []).length;
      return JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, pass, reason: "r" })));
    };
    let out = "";
    const code = run(["eval", "backend"], { ...process.env, AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (out += s), err: (s) => (out += s), modelExec: () => exec });
    expect(code, out).toBe(1);
    expect(out).toMatch(/FLAKY backend\//);
    const r = JSON.parse(readFileSync(join(root, "roles", "backend", "evals", "results.json"), "utf8"));
    expect(r.runs).toBe(3);
    for (const c of r.cases) expect(c).toMatchObject({ pass: false, runs: { total: 3, passed: 2, errors: 0 } });
    expect(existsSync(repoFile) ? readFileSync(repoFile) : null).toEqual(before); // the repo's own file is untouched
    // and roster then warns that the last run did not pass
    let ro = "";
    tableRole(root);
    run(["roster"], { AIDW_PLUGIN_ROOT: root }, process.cwd(), { out: (s) => (ro += s), err: (s) => (ro += s) });
    expect(ro).toMatch(/results\.json/);
  });
});
