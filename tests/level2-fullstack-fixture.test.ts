import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Exec } from "../src/evalrun.js";
import { ensureFixturePackages, fixturesDir, loadLevel2Cases, prepareCopy, removeTree, runCheck, runLevel2, type AgentRunner, type Level2Case } from "../src/evallevel2.js";

/**
 * The fullstack-app fixture (Express 5 + PGlite server, Vite + React 19 web app, shared zod schemas; Vitest with a jsdom
 * project and a node project; MSW forwards every /api/* request of the web tests to the real Express app in process) and
 * the fullstack pilot level 2 case rename-a-project, with no model: the fixture's own suite passes, its Change is approved
 * and valid, the correct reference solution passes the held-out tests and every check, each wrong one (a copy of one
 * planted trap) fails the held-out tests meant for it and not the others, a reworded correct one passes, the untouched
 * fixture fails, and a session that edits the test harness gets nothing from it. Needs the fixture's packages in the
 * cache (AIDW_FIXTURE_CACHE) and the built plugin bin; skipped without them. The whole-run test also needs the Role's
 * skill seam-test, which another task writes: it runs once the file is in the plugin.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "fullstack-app");
const reference = join(repo, "evals", "level2-reference");
const CASE = "rename-a-project";
const noInstall = () => {
  throw new Error("not installed");
};
let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "fullstack-app", process.env, noInstall).nodeModules;
} catch {
  nodeModules = null;
}
const ready = !!nodeModules && existsSync(join(plugin, "bin", "aidw"));
const seamTestSkill = existsSync(join(plugin, "roles", "fullstack", "skills", "seam-test.md"));

const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};
const pilot = (): Level2Case => loadLevel2Cases(plugin, "fullstack").cases.find((c) => c.name === CASE)!;

type Prep = ReturnType<typeof prepareCopy>;

function commands(c: Level2Case, prep: Prep) {
  const env = { ...process.env, PATH: [join(plugin, "bin"), process.env.PATH].join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const check = (name: RegExp) => runCheck(c.checks.find((ch) => name.test(ch.name))!, prep.project, env);
  const sh = (cmd: string) => {
    const r = spawnSync("sh", ["-c", cmd], { cwd: prep.project, env, encoding: "utf8", timeout: 240_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
  };
  const heldOut = () => sh(`npm test --silent -- ${c.heldOut.join(" ")}`);
  return { prep, project: prep.project, env, check, sh, heldOut };
}
type G = ReturnType<typeof commands>;

/** A prepared copy of the case's Change with the overlays laid over it (as an Agent would leave it), then the held-out files. */
function graded(c: Level2Case, ...overlays: string[]): G {
  const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fs-"), "project"));
  for (const o of overlays) cpSync(join(reference, o), prep.project, { recursive: true });
  cpSync(join(plugin, c.dir, "held-out"), prep.project, { recursive: true });
  return commands(c, prep);
}

/** The held-out tests a run reports as failed, by the words of their names. */
const failedTests = (out: string) => [...new Set([...out.matchAll(/(?:×|FAIL) .*?> ([^\n]+)$/gm)].map((m) => m[1]!.split(" > ").pop()!.replace(/\s+\d+ms\s*$/, "").trim()))];
const put = (g: G, rel: string, text: string) => {
  mkdirSync(dirname(join(g.project, rel)), { recursive: true });
  writeFileSync(join(g.project, rel), text);
};

/** The held-out tests of the case, by the words of their titles. */
const T = {
  webRenames: /an owner types '  Apollo  ' and saves/,
  webList: /the list shows Apollo, and no longer Website/,
  webTaken: /aria-invalid with text under it that says taken/,
  webBlank: /a blank name: the field is aria-invalid/,
  webMember: /a member who is not an owner: the server's 403/,
  webAgain: /after a refused save the owner can still rename/,
  routeOwner: /an owner renames: 200, the trimmed name/,
  routeList: /after a rename the list and the project say/,
  routeTaken: /is 422 with exactly the contract's body/,
  routeFree: /a name taken in another team is free/,
  routeRequired: /a blank, missing or non-string name/,
  routeMember: /a member who is not an owner is 403 forbidden, before the body/,
  routeSignedOut: /no session, an unknown cookie/,
  routeOutsider: /a user outside the team, and an id nobody has/,
  routeBadRequest: /an id that is not a uuid/,
  routeNoLeak: /the error bodies carry no stack/,
};
const ALL = Object.values(T);
const HELD_OUT = ALL.length;

describe.skipIf(!ready)("the fullstack-app fixture and level 2 case rename-a-project (cached packages)", () => {
  it("loads, on the fixture's Change, the test harness restored and one held-out file per project", () => {
    const { cases, diags } = loadLevel2Cases(plugin, "fullstack");
    expect(diags.errors).toEqual([]);
    const c = cases.find((x) => x.name === CASE)!;
    expect(c).toMatchObject({ fixture: "fullstack-app", change: "rename-a-project", task: "T01", covers: ["X1", "X6", "X7", "seam-test"] });
    expect(c.restore).toEqual(
      expect.arrayContaining(["web/tests/setup.ts", "web/tests/environment.ts", "web/tests/render.tsx", "web/tests/backend.ts", "web/tests/msw/handlers.ts", "web/tests/msw/server.ts", "server/tests/helpers.ts", "server/tests/http.ts"]),
    );
    expect(c.heldOut).toEqual(["server/tests/held-out/rename-a-project.test.ts", "web/tests/held-out/rename-a-project.test.tsx"]);
    expect(c.mustRead).toEqual([".aidw/changes/rename-a-project/api-contract.md", "plugin:roles/fullstack/skills/seam-test.md"]);
    expect(c.checks).toHaveLength(5);
    expect(c.criteria).toHaveLength(2);
  });

  it("the Change is approved and valid with the CLI, in state executing on base main, with one fullstack task that holds both halves in Touches", () => {
    const r = spawnSync("node", [join(plugin, "bin", "aidw"), "approval", "check", "rename-a-project"], { cwd: fixture, encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`).toMatch(/approval valid/);
    expect(r.status).toBe(0);
    const dir = join(fixture, ".aidw", "changes", "rename-a-project");
    expect(readFileSync(join(dir, "change.yaml"), "utf8")).toMatch(/state: executing[\s\S]*base_branch: main/);
    const tasks = readFileSync(join(dir, "tasks.yaml"), "utf8");
    expect(tasks).toMatch(/role: fullstack/);
    expect(tasks.match(/^\s+- id: /gm)).toHaveLength(1);
    expect(tasks).toMatch(/touches: .*"server\/projects\/\*\*".*"web\/projects\/\*\*"/);
  });

  it("every scenario of the Change is on the task, named by the checks and by the reference's own tests", () => {
    const spec = readFileSync(join(fixture, ".aidw", "changes", CASE, "specs", "projects", "spec.md"), "utf8");
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const scenarios = [...spec.matchAll(/^#### Scenario: (.+)$/gm)].map((m) => slug(m[1]!));
    expect(scenarios).toHaveLength(6);
    const tasks = readFileSync(join(fixture, ".aidw", "changes", CASE, "tasks.yaml"), "utf8");
    expect([...tasks.matchAll(/^\s+- (projects\/\S+\/\S+)$/gm)].map((m) => m[1])).toEqual(scenarios.map((s) => `projects/rename-a-project/${s}`));
    const idCheck = pilot().checks.find((ch) => /every scenario id/.test(ch.name))!.run;
    for (const s of scenarios) expect(idCheck, s).toContain(s);
    const refTests = ["server/tests/projects", "web/tests/projects"].flatMap((d) => readdirSync(join(reference, CASE, d)).map((f) => readFileSync(join(reference, CASE, d, f), "utf8"))).join("\n");
    for (const s of scenarios) expect(refTests, s).toContain(`projects/rename-a-project/${s}`);
  });

  it("passes its own tests (both projects) and typecheck in a fresh copy: the web tests reach the real server", () => {
    const g = graded(pilot());
    const t = g.sh("npm test --silent -- web/tests/forwarding.test.ts web/tests/projects server/tests/projects server/tests/teams.test.ts server/tests/sessions.test.ts");
    expect(t.status, t.out).toBe(0);
    expect(t.out).toMatch(/Tests\s+\d+ passed/);
    const tc = g.sh("npm run typecheck --silent");
    expect(tc.status, tc.out).toBe(0);
  }, 300_000);

  /** A preload that refuses and records every socket a process tries to open or bind: net connects and listens. */
  function socketBan(): { env: NodeJS.ProcessEnv; log: string } {
    const dir = temp("aidw-l2fs-ban-");
    const log = join(dir, "sockets.log");
    const ban = join(dir, "ban.cjs");
    writeFileSync(
      ban,
      [
        'const net = require("node:net"), fs = require("node:fs");',
        `const LOG = ${JSON.stringify(log)};`,
        "const refuse = (what) => function (...a) { fs.appendFileSync(LOG, `${process.pid} ${what} ${JSON.stringify(a[0] ?? null)}\\n`); throw new Error(`socket refused: ${what}`); };",
        'net.Socket.prototype.connect = refuse("connect");',
        'net.Server.prototype.listen = refuse("listen");',
      ].join("\n"),
    );
    return { env: { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${ban}`].filter(Boolean).join(" "), npm_config_offline: "true", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9" }, log };
  }

  it("the ban refuses and records a socket (so an empty log below means none was opened)", () => {
    const { env, log } = socketBan();
    const r = spawnSync("node", ["-e", 'try { require("node:net").connect(9, "127.0.0.1") } catch (e) { console.log(e.message) }'], { env: { ...process.env, ...env }, encoding: "utf8" });
    expect(r.stdout).toMatch(/socket refused: connect/);
    expect(readFileSync(log, "utf8")).toMatch(/connect/);
  });

  it("the whole fixture suite and its typecheck pass in a fresh copy with no socket opened or bound (no network, no port)", () => {
    const g = commands(pilot(), prepareCopy(plugin, pilot(), fixture, nodeModules as string, join(temp("aidw-l2fs-own-"), "project")));
    expect(existsSync(join(g.project, "web", "tests", "held-out"))).toBe(false);
    const { env, log } = socketBan();
    const run = (args: string[]) => {
      const r = spawnSync(args[0]!, args.slice(1), { cwd: g.project, env: { ...g.env, ...env }, encoding: "utf8", timeout: 240_000 });
      return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
    };
    const t = run([join(g.project, "node_modules", ".bin", "vitest"), "run"]);
    expect(t.status, t.out).toBe(0);
    expect(t.out).toMatch(/Test Files\s+\d+ passed/);
    expect(t.out).toMatch(/\|web\|/);
    expect(t.out).toMatch(/\|server\|/);
    const tc = run([join(g.project, "node_modules", ".bin", "tsc"), "--noEmit"]);
    expect(tc.status, tc.out).toBe(0);
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
    // The ban reaches the test workers: a fixture test that opens a socket is refused and recorded.
    put(g, "server/tests/opens-a-socket.test.ts", 'import { connect } from "node:net";\nimport { expect, it } from "vitest";\nit("opens a socket", () => { expect(() => connect(9, "127.0.0.1")).toThrow(/socket refused/); });\n');
    const s = run([join(g.project, "node_modules", ".bin", "vitest"), "run", "server/tests/opens-a-socket.test.ts"]);
    expect(s.status, s.out).toBe(0);
    expect(readFileSync(log, "utf8")).toMatch(/connect/);
  }, 300_000);

  it("briefs the task for the fullstack Role with both halves in Touches, no screenshot lines, and the contract and skill to read", () => {
    const c = pilot();
    const prep = prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fs-brief-"), "project"));
    expect(prep.briefText).toContain("rename-a-project");
    expect(prep.briefText).toContain("server/projects/**");
    expect(prep.briefText).toContain("web/projects/**");
    expect(prep.briefText).not.toMatch(/Screenshots\*\*|Playwright|PNG/);
    expect(readFileSync(prep.brief, "utf8")).toBe(prep.briefText);
    expect(prep.briefText).toMatch(/role: fullstack|fullstack/);
  });

  it(`the correct reference solution passes the held-out tests (${HELD_OUT} of ${HELD_OUT}) and every check of checks.yaml`, () => {
    const c = pilot();
    const g = graded(c, CASE);
    const t = g.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(t.out).toContain(`${HELD_OUT} passed`);
    const results = c.checks.map((ch) => [ch.name, runCheck(ch, g.project, g.env)] as const);
    expect(results.filter(([, r]) => !r.pass)).toEqual([]);
  }, 600_000);

  const WRONG: { overlay: string; why: string; fails: RegExp[]; passes: RegExp[] }[] = [
    {
      overlay: `${CASE}-stale-client`,
      why: "builds the form on the client helper as it is (reads body.message, keeps no code or fields): a taken or blank name is a generic failure",
      fails: [T.webTaken, T.webBlank, T.webAgain],
      passes: [T.webRenames, T.webList, T.webMember, T.routeOwner, T.routeTaken, T.routeMember],
    },
    {
      overlay: `${CASE}-stale-list`,
      why: "does not refresh the list kept in the module-level store after a write",
      fails: [T.webList],
      passes: [T.webRenames, T.webTaken, T.webBlank, T.webMember, T.webAgain, T.routeOwner, T.routeList],
    },
    {
      overlay: `${CASE}-typed-name`,
      why: "shows what was typed after a save, not the name the server stored",
      fails: [T.webRenames, T.webList],
      passes: [T.webTaken, T.webBlank, T.webMember, T.webAgain, T.routeOwner],
    },
    {
      overlay: `${CASE}-member-allowed`,
      why: "the route has no owner check: a member renames",
      fails: [T.webMember, T.routeMember],
      passes: [T.webRenames, T.webList, T.webTaken, T.routeOwner, T.routeTaken, T.routeSignedOut],
    },
    {
      overlay: `${CASE}-no-trim`,
      why: "the route stores the name as it was typed",
      fails: [T.webRenames, T.routeOwner, T.routeTaken, T.routeRequired],
      passes: [T.webMember, T.routeMember, T.routeSignedOut, T.routeOutsider, T.routeBadRequest],
    },
    {
      overlay: `${CASE}-plain-error`,
      why: "a taken name is a 422 with a message and no `fields`",
      fails: [T.webTaken, T.webAgain, T.routeTaken, T.routeRequired],
      passes: [T.webRenames, T.webList, T.webMember, T.routeOwner, T.routeMember, T.routeSignedOut],
    },
  ];
  for (const w of WRONG) {
    it(`the wrong solution ${w.overlay} (${w.why}) fails the held-out tests meant for it, and only the tests its flaw breaks`, () => {
      const g = graded(pilot(), CASE, w.overlay);
      const t = g.heldOut();
      expect(t.status).not.toBe(0);
      const failed = failedTests(t.out).join("\n");
      for (const f of w.fails) expect(failed, t.out).toMatch(f);
      for (const p of w.passes) expect(failed, t.out).not.toMatch(p);
    }, 600_000);
  }

  it("a reference that hides the field behind an Edit button and words the labels and messages differently still passes the held-out tests", () => {
    const g = graded(pilot(), CASE, `${CASE}-reworded`);
    const t = g.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(t.out).toContain(`${HELD_OUT} passed`);
  }, 600_000);

  it("the a11y-names check fails a save control that is a clickable div (the held-out tests alone pass it), and passes the correct one", () => {
    const bad = graded(pilot(), CASE, `${CASE}-div-save`);
    expect(bad.check(/a11y-names/)).toMatchObject({ pass: false, why: expect.stringMatching(/div-click/) });
    const t = bad.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(graded(pilot(), CASE).check(/a11y-names/)).toMatchObject({ pass: true });
  }, 600_000);

  it("the a11y-names check fails an input with no label", () => {
    const g = graded(pilot(), CASE);
    const p = join(g.project, "web", "projects", "RenameForm.tsx");
    writeFileSync(p, readFileSync(p, "utf8").replace("<label htmlFor={fieldId}>Name</label>", ""));
    expect(g.check(/a11y-names/)).toMatchObject({ pass: false, why: expect.stringMatching(/no-label/) });
  }, 300_000);

  it("the untouched fixture fails the held-out tests except the two a missing route cannot break, and fails the scenario-id check", () => {
    const g = graded(pilot());
    const t = g.heldOut();
    expect(t.status).not.toBe(0);
    const failed = failedTests(t.out).join("\n");
    for (const re of ALL.filter((re) => re !== T.routeSignedOut && re !== T.routeNoLeak)) expect(failed, t.out).toMatch(re);
    expect(failedTests(t.out), t.out).toHaveLength(HELD_OUT - 2);
    expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no web test names /) });
  }, 600_000);

  it("the Touches check fails a solution that changes a file outside the task, and allows .aidw/run and .aidw/changes", () => {
    const g = graded(pilot(), CASE);
    const list = (files: string[]) => {
      const f = join(g.project, "..", "changed.txt");
      writeFileSync(f, files.join("\n") + "\n");
      return { ...g.env, AIDW_CHANGED: f };
    };
    const ch = pilot().checks.find((x) => /nothing outside Touches/.test(x.name))!;
    const ok = ["shared/projects.ts", "server/projects/routes.ts", "server/tests/projects/rename.test.ts", "web/projects/RenameForm.tsx", "web/api/client.ts", "web/tests/projects/rename-a-project.test.tsx", ".aidw/run/report-T01.md", ".aidw/changes/rename-a-project/tasks.yaml"];
    expect(runCheck(ch, g.project, list(ok))).toMatchObject({ pass: true });
    for (const f of ["server/http/errors.ts", "server/db/schema.sql", "shared/errors.ts", "web/routes.tsx", "web/tests/msw/handlers.ts", "web/tests/setup.ts", "server/tests/http.ts", "server/tests/helpers.ts", ".aidw/constitution.md"]) {
      expect(runCheck(ch, g.project, list([f])), f).toMatchObject({ pass: false });
    }
  }, 300_000);

  /** A session that lays the reference solution over the copy and reads the case's must_read files. */
  const overlayAgent =
    (c: Level2Case): AgentRunner =>
    (i) => {
      cpSync(join(reference, CASE), i.cwd, { recursive: true });
      const brief = i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1");
      const reads = [brief, ...c.mustRead.map((p) => (p.startsWith("plugin:") ? join(i.pluginRoot, p.slice(7)) : join(i.cwd, p)))];
      const lines = [
        ...reads.map((file_path, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: "Read", input: { file_path } }] } })),
        { type: "result", subtype: "success", result: "Works now: all scenarios. Found: web/api/client.ts read body.message, which the server never sends; the list store was not refreshed after a write. Fixed both." },
      ];
      writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
      return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
    };

  it("a session that edits the forwarding handler to fake the answer gets nothing from it: the handler is restored, and the edit is outside Touches", () => {
    const c = pilot();
    expect(c.restore).toContain("web/tests/msw/handlers.ts");
    const cheat: AgentRunner = (i) => {
      cpSync(join(reference, CASE), i.cwd, { recursive: true });
      cpSync(join(reference, `${CASE}-no-trim`), i.cwd, { recursive: true }); // a server that does not trim: only the real handler shows it
      const h = join(i.cwd, "web", "tests", "msw", "handlers.ts");
      writeFileSync(h, readFileSync(h, "utf8").replace("export const handlers = [", 'export const handlers = [\n  http.patch("/api/projects/:id", async ({ request }) => HttpResponse.json({ id: "x", teamId: "t", name: String(((await request.json()) as { name: string }).name).trim(), createdAt: "2026-01-01T00:00:00.000Z" })),'));
      writeFileSync(i.logFile, JSON.stringify({ type: "result", subtype: "success", result: "done" }));
      return { exit: 0, timedOut: false, turnLimit: false, turns: 1 };
    };
    const [r] = runLevel2({ root: plugin, role: "fullstack", runs: 1, agent: cheat, exec: () => "[]", install: noInstall, runsDir: temp("aidw-l2fs-runs-") }, CASE);
    const steps = r!.results[0]!.steps;
    expect(steps.find((st) => st.step === "tests")!.pass).toBe(false);
    expect(steps.find((st) => st.step === "checks")!.failed.join("\n")).toMatch(/nothing outside Touches[\s\S]*web\/tests\/msw\/handlers\.ts/);
  }, 600_000);

  it.skipIf(!seamTestSkill)("passes a whole run on the correct reference solution: tests, checks, reads, and the grader", () => {
    const c = pilot();
    const prompts: string[] = [];
    const exec: Exec = (prompt) => {
      prompts.push(prompt);
      return JSON.stringify(c.criteria.map((_, n) => ({ n: n + 1, pass: true, reason: "it does" })));
    };
    const [r] = runLevel2({ root: plugin, role: "fullstack", runs: 1, agent: overlayAgent(c), exec, install: noInstall, runsDir: temp("aidw-l2fs-runs-") }, CASE);
    const x = r!.results[0]!;
    expect(x.error).toBeUndefined();
    expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
    expect(r!.pass).toBe(true);
    expect(prompts).toHaveLength(1);
  }, 600_000);
});
