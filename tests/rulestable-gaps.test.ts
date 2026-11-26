import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { type Exec } from "../src/evalrun.js";
import { checkEvals, roleDigest } from "../src/evals.js";
import { parseRulesTable, writeAgents } from "../src/roles.js";
import { bareBackend } from "./fixtures.js";

/** Gaps found probing T12, fixed after the review: the rules table, covers, the digest and the result file. Every test works on a temp copy of the plugin. */
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

describe("T12 gaps", () => {
  it("does not silently drop the rules of a second rules table", () => {
    const t = parseRulesTable(`${TABLE}\n## More rules\n\n${HEAD}| B3 | Three. | always | reviewer |\n`);
    // either B3 is read (and so checked for a case) or the file is reported: a rule nobody checks must not pass unseen
    expect(t.rules.some((r) => r.id === "B3") || t.problems.length > 0).toBe(true);
  });

  it("treats B01 and B1 as the same id", () => {
    const t = parseRulesTable(`${HEAD}| B1 | One. | always | reviewer |\n| B01 | Again. | always | reviewer |\n`);
    // a case covering B1 would leave B01 uncovered, or the reverse: two spellings of one number are one id twice
    expect(t.problems.join("\n")).toMatch(/B01|B1/);
  });

  it("is the same for a checkout with CRLF line endings (git autocrlf)", () => {
    const root = copy();
    const dir = tableRole(root);
    const before = roleDigest(root, "backend");
    for (const f of ["rules.md", "role.md", "evals/entity-is-not-a-response.md"]) writeFileSync(join(dir, f), readFileSync(join(dir, f), "utf8").replace(/\n/g, "\r\n"));
    expect(roleDigest(root, "backend")).toBe(before);
  });

  it("ignores a .DS_Store the Finder drops into skills/", () => {
    const root = copy();
    const dir = tableRole(root);
    const before = roleDigest(root, "backend");
    writeFileSync(join(dir, "skills", ".DS_Store"), "\0\0\0\x01Bud1");
    expect(roleDigest(root, "backend")).toBe(before);
  });
});
