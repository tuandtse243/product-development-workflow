import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkEvals, loadEvalCases } from "../src/evals.js";
import { loadRoster } from "../src/roles.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-evals-"));
  temps.push(root);
  for (const f of ["roster.yaml", "roles"]) cpSync(join(plugin, f), join(root, f), { recursive: true });
  return root;
}
const errors = (root: string) => checkEvals(root).errors.map((e) => `${e.file}: ${e.message}`).join("\n");

describe("role evals", () => {
  it("every active Role ships at least one well-formed case", () => {
    expect(checkEvals(plugin).errors).toEqual([]);
    for (const [id, e] of Object.entries(loadRoster(plugin).roles)) {
      if (e.status === "active") expect(loadEvalCases(plugin, id).cases.length, id).toBeGreaterThan(0);
    }
  });

  it("each case states its situation and criteria that say must or must not", () => {
    const c = loadEvalCases(plugin, "code-reviewer").cases[0]!;
    expect(c.name).toBe("placeholder-test-is-not-a-pass");
    expect(c.input).toMatch(/expect\(true\)/);
    expect(c.criteria[0]).toMatch(/^must start the verdict file with exactly `VERDICT: fix`/);
    expect(c.criteria.some((x) => x.startsWith("must not edit"))).toBe(true);
  });

  it("rejects an active Role without a case", () => {
    const root = copy();
    rmSync(join(root, "roles", "security", "evals"), { recursive: true });
    expect(errors(root)).toMatch(/roles\/security\/evals: an active Role ships at least one eval case/);
  });

  it("rejects a malformed case", () => {
    const root = copy();
    const f = join(root, "roles", "security", "evals", "missing-ownership-check.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("- must not edit code", "- do not edit code").replace("## Input", "## Situation"));
    const out = errors(root);
    expect(out).toMatch(/criterion "- do not edit code[^"]*" must be a bullet starting "- must" or "- must not"/);
    expect(out).toMatch(/missing or empty "## Input"/);
  });

  it("rejects a case whose name differs from its file", () => {
    const root = copy();
    const f = join(root, "roles", "security", "evals", "missing-ownership-check.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("case: missing-ownership-check", "case: other"));
    expect(errors(root)).toMatch(/case "other" must equal the file name "missing-ownership-check"/);
  });
});
