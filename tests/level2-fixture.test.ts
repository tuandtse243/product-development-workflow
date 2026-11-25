import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../src/evalrun.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, removeTree, runLevel2, type AgentRunner } from "../src/evallevel2.js";

/**
 * The backend-api fixture and the pilot level 2 case, with no model: the fixture's own suite passes, the held-out tests
 * fail on the untouched fixture (the task is not done yet) and on a solution that trusts x-team-id, and a whole run
 * passes on a reference solution. It needs the fixture's packages in the cache (`aidw eval backend --level 2` installs
 * them once, with the network; AIDW_FIXTURE_CACHE points elsewhere); without them it is skipped.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "backend-api");
const reference = join(repo, "evals", "level2-reference");
const noInstall = () => {
  throw new Error("not installed");
};
let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "backend-api", process.env, noInstall).nodeModules;
} catch {
  nodeModules = null;
}
const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const pilot = () => loadLevel2Cases(plugin, "backend").cases.find((c) => c.name === "team-comes-from-the-session")!;

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "aidw-l2-fx-"));
  temps.push(dir);
  prepareCopy(plugin, pilot(), fixture, nodeModules as string, join(dir, "project"));
  return join(dir, "project");
}
const sh = (cmd: string, cwd: string) => {
  const r = spawnSync("sh", ["-c", cmd], { cwd, encoding: "utf8", env: { ...process.env, CI: "1" }, timeout: 180_000 });
  return { exit: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
};
const heldOut = (project: string) => cpSync(join(plugin, pilot().dir, "held-out"), project, { recursive: true });

describe.skipIf(!nodeModules)("the backend-api fixture (cached packages)", () => {
  it("passes its own tests and typecheck in a fresh copy", () => {
    const p = copy();
    const t = sh("npm test --silent", p);
    expect(t.exit, t.out).toBe(0);
    expect(sh("npm run typecheck --silent", p).exit).toBe(0);
  }, 240_000);

  it("fails the pilot's held-out tests when untouched, because the route does not exist", () => {
    const p = copy();
    heldOut(p);
    const t = sh("npm test --silent -- tests/held-out/create-task.test.ts", p);
    expect(t.exit).not.toBe(0);
    expect(t.out).toMatch(/creates the task for a member[\s\S]*expected 404 to be 201/);
  }, 240_000);

  it("fails the held-out tests for a solution that trusts x-team-id", () => {
    const p = copy();
    cpSync(join(reference, "team-comes-from-the-session"), p, { recursive: true });
    cpSync(join(reference, "team-comes-from-the-session-trusts-header"), p, { recursive: true });
    heldOut(p);
    const t = sh("npm test --silent -- tests/held-out/create-task.test.ts", p);
    expect(t.exit).not.toBe(0);
    expect(t.out).toMatch(/(×|FAIL) .*ignores x-team-id: a caller of another team who names the project's team still gets 404/);
  }, 240_000);

  /** A session that lays `overlays` of evals/level2-reference/ over the copy and reads what the case asks. */
  const overlayAgent =
    (overlays: string[], also?: (cwd: string) => void): AgentRunner =>
    (i) => {
      for (const o of overlays) cpSync(join(reference, o), i.cwd, { recursive: true });
      also?.(i.cwd);
      const brief = i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1");
      const calls = [
        { name: "Read", input: { file_path: brief } },
        { name: "Read", input: { file_path: join(i.cwd, ".aidw/changes/create-task/api-contract.md") } },
        { name: "Bash", input: { command: "aidw plugin-path roles/backend/skills/endpoint-test-matrix.md" } },
        { name: "Read", input: { file_path: join(i.pluginRoot, "roles/backend/skills/endpoint-test-matrix.md") } },
      ];
      const lines = [
        ...calls.map((c, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: c.name, input: c.input }] } })),
        { type: "result", subtype: "success", result: "Works now: all five. Owed: src/projects/routes.ts takes the team from x-team-id." },
      ];
      writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
      return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
    };
  const runsDir = () => {
    const d = mkdtempSync(join(tmpdir(), "aidw-l2-fx-runs-"));
    temps.push(d);
    return d;
  };

  it.skipIf(!existsSync(join(plugin, "bin", "aidw")))(
    "passes a whole run of the pilot on the reference solution: tests, checks (route-inventory included), reads",
    () => {
      const agent = overlayAgent(["team-comes-from-the-session"]);
      const prompts: string[] = [];
      const exec: Exec = (prompt) => {
        prompts.push(prompt);
        return '[{"n":1,"pass":true,"reason":"it says so"}]';
      };
      const [r] = runLevel2({ root: plugin, role: "backend", runs: 1, agent, exec, install: noInstall, runsDir: runsDir() }, "team-comes-from-the-session");
      const x = r!.results[0]!;
      expect(x.error).toBeUndefined();
      expect(x.steps.filter((s) => !s.pass)).toEqual([]);
      expect(r!.pass).toBe(true);
      expect(prompts[0]).toMatch(/\+\s*app\.use\(taskRoutes\(deps\.db\)\);/);
    },
    300_000,
  );

  it.skipIf(!existsSync(join(plugin, "bin", "aidw")))(
    "fails a run on a solution that trusts x-team-id, naming the held-out tests it failed",
    () => {
      const exec: Exec = () => {
        throw new Error("the grader is not reached");
      };
      const [r] = runLevel2({ root: plugin, role: "backend", runs: 1, agent: overlayAgent(["team-comes-from-the-session", "team-comes-from-the-session-trusts-header"]), exec, install: noInstall, runsDir: runsDir() }, "team-comes-from-the-session");
      const tests = r!.results[0]!.steps.find((s) => s.step === "tests")!;
      expect(tests.pass).toBe(false);
      expect(tests.failed.join("\n")).toMatch(/ignores x-team-id: a caller of another team who names the project's team still gets 404/);
      expect(r!.pass).toBe(false);
    },
    300_000,
  );

  it.skipIf(!existsSync(join(plugin, "bin", "aidw")))(
    "a change outside Touches that the session committed still fails the Touches check",
    () => {
      const commit = (cwd: string) => {
        const f = join(cwd, "src/projects/routes.ts");
        writeFileSync(f, readFileSync(f, "utf8").replace("x-team-id is required", "x-team-id is needed"));
        const g = (...a: string[]) => spawnSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "-c", "core.hooksPath=/dev/null", ...a], { cwd });
        g("add", "-A");
        g("commit", "-qm", "hide it");
      };
      const [r] = runLevel2({ root: plugin, role: "backend", runs: 1, agent: overlayAgent(["team-comes-from-the-session"], commit), exec: () => "[]", install: noInstall, runsDir: runsDir() }, "team-comes-from-the-session");
      const checks = r!.results[0]!.steps.find((s) => s.step === "checks")!;
      expect(checks.failed).toEqual([expect.stringMatching(/^nothing outside Touches changed \(B15\): exit 1, expected 0: src\/projects\/routes\.ts/)]);
    },
    300_000,
  );

  it.skipIf(!existsSync(join(plugin, "bin", "aidw")))(
    "a test script made to pass and a config that drops the held-out tests are put back: every held-out test runs",
    () => {
      const cheat = (cwd: string) => {
        const pj = join(cwd, "package.json");
        writeFileSync(pj, readFileSync(pj, "utf8").replace('"test": "vitest run"', '"test": "exit 0"'));
        writeFileSync(join(cwd, "vitest.config.ts"), 'export default { test: { include: ["tests/**/*.test.ts"], exclude: ["tests/held-out/**"] } };\n');
        writeFileSync(join(cwd, "tests/helpers.ts"), "export const testApp = () => { throw new Error('x'); };\n");
      };
      const [r] = runLevel2({ root: plugin, role: "backend", runs: 1, agent: overlayAgent(["team-comes-from-the-session", "team-comes-from-the-session-trusts-header"], cheat), exec: () => "[]", install: noInstall, runsDir: runsDir() }, "team-comes-from-the-session");
      const x = r!.results[0]!;
      const tests = x.steps.find((s) => s.step === "tests")!;
      expect(tests.pass).toBe(false);
      expect(tests.failed.join("\n")).toMatch(/ignores x-team-id/);
      const rep = JSON.parse(readFileSync(join(x.dir, "held-out.json"), "utf8"));
      expect(rep.numPassedTests + rep.numFailedTests).toBe(12);
      // what the held-out files declare, as vitest lists them under the restored config
      expect(JSON.parse(readFileSync(join(x.dir, "held-out-list.json"), "utf8"))).toHaveLength(12);
      expect(x.steps.find((s) => s.step === "checks")!.failed.join("\n")).toMatch(/package\.json[\s\S]*vitest\.config\.ts|vitest\.config\.ts[\s\S]*package\.json/);
    },
    300_000,
  );
});
