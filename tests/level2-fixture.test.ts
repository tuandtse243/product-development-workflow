import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../src/evalrun.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, runLevel2, type AgentRunner } from "../src/evallevel2.js";

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
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
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
    (...overlays: string[]): AgentRunner =>
    (i) => {
      for (const o of overlays) cpSync(join(reference, o), i.cwd, { recursive: true });
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
      const agent = overlayAgent("team-comes-from-the-session");
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
      const [r] = runLevel2({ root: plugin, role: "backend", runs: 1, agent: overlayAgent("team-comes-from-the-session", "team-comes-from-the-session-trusts-header"), exec, install: noInstall, runsDir: runsDir() }, "team-comes-from-the-session");
      const tests = r!.results[0]!.steps.find((s) => s.step === "tests")!;
      expect(tests.pass).toBe(false);
      expect(tests.failed.join("\n")).toMatch(/ignores x-team-id: a caller of another team who names the project's team still gets 404/);
      expect(r!.pass).toBe(false);
    },
    300_000,
  );
});
