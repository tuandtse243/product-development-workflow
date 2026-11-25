import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, runCheck, type Level2Check } from "../src/evallevel2.js";

/**
 * The pilot's deterministic graders on the backend-api fixture, with no model and no Agent: the reference solution
 * passes the held-out tests and every check of checks.yaml; the header-trusting solution, the untouched fixture and
 * solutions that change files outside Touches fail. Needs the fixture's packages in the cache (AIDW_FIXTURE_CACHE)
 * and the built plugin bin (checks run `aidw plugin-path`); skipped without them.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "backend-api");
const reference = join(repo, "evals", "level2-reference");
let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "backend-api", process.env, () => {
    throw new Error("not installed");
  }).nodeModules;
} catch {
  nodeModules = null;
}
const ready = !!nodeModules && existsSync(join(plugin, "bin", "aidw"));
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
const pilot = () => loadLevel2Cases(plugin, "backend").cases.find((c) => c.name === "team-comes-from-the-session")!;

/** A prepared copy with the overlays laid over it (as an Agent would leave it), then the held-out files. */
function graded(...overlays: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "aidw-l2fg-"));
  temps.push(dir);
  const prep = prepareCopy(plugin, pilot(), fixture, nodeModules as string, join(dir, "project"));
  for (const o of overlays) cpSync(join(reference, o), prep.project, { recursive: true });
  cpSync(join(plugin, pilot().dir, "held-out"), prep.project, { recursive: true });
  const env = { ...process.env, PATH: [join(plugin, "bin"), process.env.PATH].join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const check = (name: RegExp) => {
    const ch = pilot().checks.find((c) => name.test(c.name)) as Level2Check;
    return runCheck(ch, prep.project, env);
  };
  const heldOut = () => spawnSync("sh", ["-c", "npm test --silent -- tests/held-out/create-task.test.ts"], { cwd: prep.project, env, encoding: "utf8", timeout: 240_000 });
  return { project: prep.project, env, check, heldOut };
}

describe.skipIf(!ready)("the pilot's deterministic graders on the backend-api fixture", () => {
  it("the reference solution passes the held-out tests and every check of checks.yaml", () => {
    const g = graded("team-comes-from-the-session");
    const t = g.heldOut();
    expect(t.status, `${t.stdout}${t.stderr}`).toBe(0);
    const all = spawnSync("sh", ["-c", "npm test"], { cwd: g.project, env: g.env, encoding: "utf8", timeout: 240_000 });
    expect(all.status, `${all.stdout}${all.stderr}`).toBe(0);
    const results = pilot().checks.map((ch) => [ch.name, runCheck(ch, g.project, g.env)] as const);
    expect(results.filter(([, r]) => !r.pass)).toEqual([]);
    expect(results).toHaveLength(5);
  }, 600_000);

  it("the header-trusting solution fails the held-out tests, while its route still has the three access tests", () => {
    const g = graded("team-comes-from-the-session", "team-comes-from-the-session-trusts-header");
    const t = g.heldOut();
    expect(t.status).not.toBe(0);
    expect(`${t.stdout}${t.stderr}`).toMatch(/ignores x-team-id/);
    // route-inventory only sees that the tests exist: the held-out tests are what catch this solution
    expect(g.check(/route-inventory/).pass).toBe(true);
    expect(g.check(/outside Touches/).pass).toBe(true);
  }, 600_000);

  it("the untouched fixture fails the held-out tests, route-inventory and the scenario-id check", () => {
    const g = graded();
    expect(g.heldOut().status).not.toBe(0);
    expect(g.check(/route-inventory/)).toMatchObject({ pass: false });
    expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no test names tasks\/create-a-task\/member-creates-a-task/) });
  }, 600_000);

  it("fixing the header in the projects routes (outside Touches) fails the Touches check, naming the file", () => {
    const g = graded("team-comes-from-the-session");
    const f = join(g.project, "src/projects/routes.ts");
    writeFileSync(f, readFileSync(f, "utf8").replace('req.header("x-team-id")', "req.session!.teamId"));
    expect(g.check(/outside Touches/)).toMatchObject({ pass: false, why: expect.stringMatching(/src\/projects\/routes\.ts/) });
  }, 120_000);

  it("a test script made to always pass, or a vitest config that drops the held-out tests, fails the Touches check", () => {
    const g = graded("team-comes-from-the-session");
    const pj = join(g.project, "package.json");
    writeFileSync(pj, readFileSync(pj, "utf8").replace('"test": "vitest run"', '"test": "exit 0"'));
    writeFileSync(join(g.project, "vitest.config.ts"), 'export default { test: { exclude: ["tests/held-out/**"] } };\n');
    const r = g.check(/outside Touches/);
    expect(r.pass).toBe(false);
    expect(r.why).toMatch(/package\.json/);
    expect(r.why).toMatch(/vitest\.config\.ts/);
  }, 120_000);
});
