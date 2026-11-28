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
 *
 * The two later cases on the same fixture, invite-with-one-schema (X2, contract-tests: the invite rules sit in a server file
 * that imports the database client, and must live once in shared/) and owner-only-billing (X5: the billing route has no owner
 * check; the header's localStorage.role nav and a sibling route are Found, not fixed), get the same no-model proofs at the end
 * of this file: held-out fails untouched, passes the reference, each wrong solution fails what its flaw breaks, the checks run.
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
    expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no test names /) });
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
    const [r] = runLevel2({ root: plugin, role: "fullstack", runs: 1, agent: cheat, exec: () => "[]", install: noInstall, env: { ...process.env, AIDW_GRADE_SANDBOX: "off" }, runsDir: temp("aidw-l2fs-runs-") }, CASE);
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
    const [r] = runLevel2({ root: plugin, role: "fullstack", runs: 1, agent: overlayAgent(c), exec, install: noInstall, env: { ...process.env, AIDW_GRADE_SANDBOX: "off" }, runsDir: temp("aidw-l2fs-runs-") }, CASE);
    const x = r!.results[0]!;
    expect(x.error).toBeUndefined();
    expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
    expect(r!.pass).toBe(true);
    expect(prompts).toHaveLength(1);
  }, 600_000);
});

// ---------------------------------------------------------------- the later cases on the same fixture

const caseNamed = (name: string): Level2Case => loadLevel2Cases(plugin, "fullstack").cases.find((c) => c.name === name)!;
const tasksOf = (change: string) => readFileSync(join(fixture, ".aidw", "changes", change, "tasks.yaml"), "utf8");
const scenariosOf = (change: string, cap: string) => {
  const spec = readFileSync(join(fixture, ".aidw", "changes", change, "specs", cap, "spec.md"), "utf8");
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [...spec.matchAll(/^#### Scenario: (.+)$/gm)].map((m) => slug(m[1]!));
};
const reads = (c: Level2Case, i: { cwd: string; prompt: string; pluginRoot: string }) => {
  const brief = i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1");
  return [brief, ...c.mustRead.map((p) => (p.startsWith("plugin:") ? join(i.pluginRoot, p.slice(7)) : join(i.cwd, p)))];
};
/** A session that lays the case's reference solution over the copy and reads the case's must_read files. */
const overlayFor =
  (c: Level2Case, result: string): AgentRunner =>
  (i) => {
    cpSync(join(reference, c.name), i.cwd, { recursive: true });
    const lines = [
      ...reads(c, i).map((file_path, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: "Read", input: { file_path } }] } })),
      { type: "result", subtype: "success", result },
    ];
    writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
    return { exit: 0, timedOut: false, turnLimit: false, turns: lines.length - 1 };
  };
const touchesList = (g: G, files: string[]) => {
  const f = join(g.project, "..", "changed.txt");
  writeFileSync(f, files.join("\n") + "\n");
  return { ...g.env, AIDW_CHANGED: f };
};

interface Wrong {
  overlay: string;
  why: string;
  fails: RegExp[];
  passes: RegExp[];
}
/** The proofs every case on the fixture shares, with its own held-out titles, wrong solutions and reference. */
function proofs(name: string, held: Record<string, RegExp>, wrong: Wrong[], reworded: string, unbroken: RegExp[]) {
  const ALL_HELD = Object.values(held);
  const NUM = ALL_HELD.length;
  it(`the correct reference solution passes the held-out tests (${NUM} of ${NUM}) and every check of checks.yaml`, () => {
    const c = caseNamed(name);
    const g = graded(c, name);
    const t = g.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(t.out).toContain(`${NUM} passed`);
    const results = c.checks.map((ch) => [ch.name, runCheck(ch, g.project, g.env)] as const);
    expect(results.filter(([, r]) => !r.pass)).toEqual([]);
  }, 600_000);

  for (const w of wrong) {
    it(`the wrong solution ${w.overlay} (${w.why}) fails the held-out tests meant for it, and only the tests its flaw breaks`, () => {
      const g = graded(caseNamed(name), name, w.overlay);
      const t = g.heldOut();
      expect(t.status).not.toBe(0);
      const failed = failedTests(t.out).join("\n");
      for (const f of w.fails) expect(failed, t.out).toMatch(f);
      for (const p of w.passes) expect(failed, t.out).not.toMatch(p);
    }, 600_000);
  }

  it(`a reference worded differently (${reworded}) still passes the held-out tests`, () => {
    const g = graded(caseNamed(name), name, `${name}-${reworded}`);
    const t = g.heldOut();
    expect(t.status, t.out).toBe(0);
    expect(t.out).toContain(`${NUM} passed`);
  }, 600_000);

  it("the untouched fixture fails the held-out tests except the ones a missing change cannot break, and fails the scenario-id check", () => {
    const g = graded(caseNamed(name));
    const t = g.heldOut();
    expect(t.status).not.toBe(0);
    const failed = failedTests(t.out).join("\n");
    for (const re of ALL_HELD.filter((re) => !unbroken.includes(re))) expect(failed, t.out).toMatch(re);
    for (const re of unbroken) expect(failed, t.out).not.toMatch(re);
    expect(failedTests(t.out), t.out).toHaveLength(NUM - unbroken.length);
    expect(g.check(/scenario id/)).toMatchObject({ pass: false, why: expect.stringMatching(/no test names /) });
  }, 600_000);
}

const INVITE = "invite-with-one-schema";
const I = {
  webSends: /an owner types '  Dana White  ' and a valid email and sends/,
  web80: /a name of exactly 80 characters is sent and stored/,
  webLong: /an 81-character name is refused by the form before any request/,
  webEmail: /an email that is not an address is refused by the form before any request/,
  webFix: /after a refused name the person fixes it/,
  webMember: /a member who is not an owner: the server's 403/,
  graph: /the web entry's module graph reaches nothing of server\//,
  once: /the limit of 80 is written once/,
  routeOwner: /an owner invites: 201/,
  routeLimit: /a name of 80 characters is accepted, one of 81 is 422/,
  routeRequired: /a blank, missing or non-string name is 422 required/,
  routeEmail: /an email that is not an address is 422 invalid/,
  routeMember: /a member who is not an owner, and a user in no team, are 403/,
  routeSigned: /no session, an unknown cookie: 401/,
  routeBad: /a body that is not an object, has a field that is not listed/,
  routeNoLeak: /the error bodies carry no stack and no echo/,
};

describe.skipIf(!ready)("level 2 case invite-with-one-schema on the fullstack-app fixture (cached packages)", () => {
  it("loads, on the fixture's Change, with the contract and the contract-tests skill to read and one held-out file per project", () => {
    const { cases, diags } = loadLevel2Cases(plugin, "fullstack");
    expect(diags.errors).toEqual([]);
    const c = cases.find((x) => x.name === INVITE)!;
    expect(c).toMatchObject({ fixture: "fullstack-app", change: INVITE, task: "T01", covers: ["X2", "library/contract-tests"] });
    expect(c.restore).toEqual(expect.arrayContaining(["web/tests/setup.ts", "web/tests/msw/handlers.ts", "web/tests/backend.ts", "server/tests/helpers.ts", "server/tests/http.ts"]));
    expect(c.heldOut).toEqual(["server/tests/held-out/invite-with-one-schema.test.ts", "web/tests/held-out/invite-with-one-schema.test.tsx"]);
    expect(c.mustRead).toEqual([".aidw/changes/invite-with-one-schema/api-contract.md", "plugin:library/skills/contract-tests/SKILL.md"]);
    expect(c.checks).toHaveLength(5);
  });

  it("the Change is approved and valid with the CLI, one fullstack task holds both halves, and the pilot's approval still holds", () => {
    for (const id of [INVITE, CASE]) {
      const r = spawnSync("node", [join(plugin, "bin", "aidw"), "approval", "check", id], { cwd: fixture, encoding: "utf8" });
      expect(`${r.stdout}${r.stderr}`, id).toMatch(/approval valid/);
      expect(r.status, id).toBe(0);
    }
    const tasks = tasksOf(INVITE);
    expect(readFileSync(join(fixture, ".aidw", "changes", INVITE, "change.yaml"), "utf8")).toMatch(/state: executing[\s\S]*base_branch: main/);
    expect(tasks).toMatch(/role: fullstack/);
    expect(tasks.match(/^\s+- id: /gm)).toHaveLength(1);
    expect(tasks).toMatch(/touches: .*"shared\/invites\.ts".*"server\/invites\/\*\*".*"web\/team\/\*\*"/);
  });

  it("every scenario of the Change is on the task, named by the checks and by the reference's own tests; the spec states the limit for both halves", () => {
    const scenarios = scenariosOf(INVITE, "invites");
    expect(scenarios).toHaveLength(5);
    expect([...tasksOf(INVITE).matchAll(/^\s+- (invites\/\S+\/\S+)$/gm)].map((m) => m[1])).toEqual(scenarios.map((x) => `invites/invite-a-member/${x}`));
    const idCheck = caseNamed(INVITE).checks.find((ch) => /every scenario id/.test(ch.name))!.run;
    for (const x of scenarios) expect(idCheck, x).toContain(x);
    const refTests = ["server/tests/invites", "web/tests/team"].flatMap((d) => readdirSync(join(reference, INVITE, d)).map((f) => readFileSync(join(reference, INVITE, d, f), "utf8"))).join("\n");
    for (const x of scenarios) expect(refTests, x).toContain(`invites/invite-a-member/${x}`);
    const spec = readFileSync(join(fixture, ".aidw", "changes", INVITE, "specs", "invites", "spec.md"), "utf8");
    expect(spec).toMatch(/80 characters[\s\S]*both on the form[\s\S]*and at the\s+server, with the same limits/);
    expect(readFileSync(join(fixture, ".aidw", "changes", INVITE, "api-contract.md"), "utf8")).toMatch(/1 to 80 characters[\s\S]*same rules/);
  });

  it("the trap is in the fixture: the invite rules sit in a server file that imports the database client, and nothing of invites is in shared/ or web/, only a placeholder Team page, routed and linked", () => {
    const rules = readFileSync(join(fixture, "server", "invites", "rules.ts"), "utf8");
    expect(rules).toMatch(/from "\.\.\/db\/client\.ts"/);
    expect(rules).toMatch(/\.max\(80\)/);
    expect(existsSync(join(fixture, "shared", "invites.ts"))).toBe(false);
    expect(existsSync(join(fixture, "web", "invites"))).toBe(false);
    expect(readFileSync(join(fixture, "web", "team", "TeamPage.tsx"), "utf8")).not.toMatch(/button|dialog/i);
    expect(readFileSync(join(fixture, "web", "routes.tsx"), "utf8")).toMatch(/path: "team"/);
    expect(readFileSync(join(fixture, "web", "Layout.tsx"), "utf8")).toMatch(/to="\/team"/);
  });

  proofs(
    INVITE,
    I,
    [
      { overlay: `${INVITE}-server-import`, why: "the dialog imports the rules from server/invites/rules.ts, which imports the database client", fails: [I.graph, I.once], passes: [I.webSends, I.web80, I.webLong, I.webEmail, I.webFix, I.webMember, I.routeOwner, I.routeLimit, I.routeRequired, I.routeEmail, I.routeMember] },
      { overlay: `${INVITE}-copied-rules`, why: "the form has its own copy of the rules, with the same limit", fails: [I.once], passes: [I.graph, I.webSends, I.webLong, I.webEmail, I.routeLimit, I.routeEmail] },
      { overlay: `${INVITE}-server-no-limit`, why: "the limit is checked on the form only: the server takes an 81-character name", fails: [I.routeLimit, I.routeEmail], passes: [I.graph, I.once, I.webSends, I.web80, I.webLong, I.webEmail, I.webFix, I.webMember, I.routeOwner, I.routeRequired, I.routeMember, I.routeSigned, I.routeBad] },
      { overlay: `${INVITE}-send-first`, why: "the form checks nothing and sends: a refused name is a request and a generic failure", fails: [I.webLong, I.webEmail, I.webFix], passes: [I.graph, I.once, I.webSends, I.web80, I.webMember, I.routeOwner, I.routeLimit, I.routeEmail, I.routeMember] },
      { overlay: `${INVITE}-stays-open`, why: "the invite is stored but the dialog stays open", fails: [I.webSends, I.web80, I.webFix], passes: [I.graph, I.once, I.webLong, I.webEmail, I.webMember, I.routeOwner, I.routeLimit] },
      { overlay: `${INVITE}-member-allowed`, why: "the route has no owner check: a member invites", fails: [I.webMember, I.routeMember], passes: [I.graph, I.once, I.webSends, I.web80, I.webLong, I.webEmail, I.webFix, I.routeOwner, I.routeLimit, I.routeRequired, I.routeEmail, I.routeSigned, I.routeBad] },
    ],
    "reworded",
    [I.graph, I.routeNoLeak],
  );

  it("the a11y-names check fails an input with no label, and passes the correct reference", () => {
    const g = graded(caseNamed(INVITE), INVITE);
    expect(g.check(/a11y-names/)).toMatchObject({ pass: true });
    const p = join(g.project, "web", "team", "InviteDialog.tsx");
    writeFileSync(p, readFileSync(p, "utf8").replace("<label htmlFor={`${id}-${key}`}>{label}</label>", ""));
    expect(g.check(/a11y-names/)).toMatchObject({ pass: false, why: expect.stringMatching(/no-label/) });
  }, 300_000);

  it("the Touches check allows the task's files and .aidw/run, and fails the schema, the harness, the other server areas and the shared errors", () => {
    const g = graded(caseNamed(INVITE), INVITE);
    const ch = caseNamed(INVITE).checks.find((x) => /nothing outside Touches/.test(x.name))!;
    const ok = ["shared/invites.ts", "server/invites/routes.ts", "server/invites/rules.ts", "server/app.ts", "server/tests/invites/a.test.ts", "web/team/InviteDialog.tsx", "web/tests/team/a.test.tsx", ".aidw/run/report-T01.md", ".aidw/changes/invite-with-one-schema/tasks.yaml"];
    expect(runCheck(ch, g.project, touchesList(g, ok))).toMatchObject({ pass: true });
    for (const f of ["server/db/schema.sql", "shared/errors.ts", "server/http/errors.ts", "web/api/client.ts", "web/tests/msw/handlers.ts", "web/tests/setup.ts", "server/tests/http.ts", "server/projects/routes.ts", "web/billing/BillingPage.tsx", "web/routes.tsx", "web/Layout.tsx", ".aidw/constitution.md"]) {
      expect(runCheck(ch, g.project, touchesList(g, [f])), f).toMatchObject({ pass: false });
    }
  }, 300_000);

  it.skipIf(!existsSync(join(plugin, "roles", "fullstack", "skills", "seam-test.md")))("passes a whole run on the correct reference solution: tests, checks, reads, and no model to grade", () => {
    const c = caseNamed(INVITE);
    const prompts: string[] = [];
    const exec: Exec = (prompt) => {
      prompts.push(prompt);
      return "[]";
    };
    const [r] = runLevel2({ root: plugin, role: "fullstack", runs: 1, agent: overlayFor(c, "Works now: all scenarios. Found: none."), exec, install: noInstall, env: { ...process.env, AIDW_GRADE_SANDBOX: "off" }, runsDir: temp("aidw-l2fs-runs-") }, INVITE);
    const x = r!.results[0]!;
    expect(x.error).toBeUndefined();
    expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
    expect(r!.pass).toBe(true);
    expect(prompts).toHaveLength(0);
  }, 600_000);
});

const BILLING = "owner-only-billing";
const B = {
  webOwner: /an owner opens the billing page: the team's invoices are listed/,
  webOwnerRole: /an owner whose browser says role=member still sees the invoices/,
  webMember: /a member opens the billing page: it says billing is for owners only/,
  webMemberRole: /a member whose browser says role=owner gets the same/,
  routeOwner: /an owner reads the invoices of the team: 200/,
  routeMember: /a member who is not an owner is 403 forbidden, and nothing of an invoice/,
  routeNoTeam: /a user in no team is 403 forbidden too/,
  routeMixed: /a member of one team who owns another reads only/,
  routeSigned: /no session, an unknown cookie: 401 unauthenticated, no invoice/,
};

describe.skipIf(!ready)("level 2 case owner-only-billing on the fullstack-app fixture (cached packages)", () => {
  it("loads, on the fixture's Change, with the contract to read and one held-out file per project", () => {
    const { cases, diags } = loadLevel2Cases(plugin, "fullstack");
    expect(diags.errors).toEqual([]);
    const c = cases.find((x) => x.name === BILLING)!;
    expect(c).toMatchObject({ fixture: "fullstack-app", change: BILLING, task: "T01", covers: ["X5"] });
    expect(c.heldOut).toEqual(["server/tests/held-out/owner-only-billing.test.ts", "web/tests/held-out/owner-only-billing.test.tsx"]);
    expect(c.mustRead).toEqual([".aidw/changes/owner-only-billing/api-contract.md"]);
    expect(c.checks).toHaveLength(5);
    expect(c.criteria).toHaveLength(1);
    expect(c.criteria.join("\n")).toMatch(/localStorage\.role/);
  });

  it("the Change is approved and valid with the CLI, one fullstack task, and Touches that hold the route and the page but not the header or the sibling route", () => {
    const r = spawnSync("node", [join(plugin, "bin", "aidw"), "approval", "check", BILLING], { cwd: fixture, encoding: "utf8" });
    expect(`${r.stdout}${r.stderr}`).toMatch(/approval valid/);
    expect(r.status).toBe(0);
    const tasks = tasksOf(BILLING);
    expect(tasks).toMatch(/role: fullstack/);
    expect(tasks.match(/^\s+- id: /gm)).toHaveLength(1);
    expect(tasks).toMatch(/touches: .*"server\/billing\/\*\*".*"web\/billing\/\*\*"/);
    expect(tasks.match(/touches: .*/)![0]).not.toMatch(/Layout|server\/invoices|server\/teams/);
    const scenarios = scenariosOf(BILLING, "billing");
    expect(scenarios).toHaveLength(3);
    expect([...tasks.matchAll(/^\s+- (billing\/\S+\/\S+)$/gm)].map((m) => m[1])).toEqual(scenarios.map((x) => `billing/owner-only-billing/${x}`));
    const idCheck = caseNamed(BILLING).checks.find((ch) => /every scenario id/.test(ch.name))!.run;
    for (const x of scenarios) expect(idCheck, x).toContain(x);
    const refTests = ["server/tests/billing", "web/tests/billing"].flatMap((d) => readdirSync(join(reference, BILLING, d)).map((f) => readFileSync(join(reference, BILLING, d, f), "utf8"))).join("\n");
    for (const x of scenarios) expect(refTests, x).toContain(`billing/owner-only-billing/${x}`);
  });

  it("the traps are in the fixture: the billing route checks no role, the header hides the link by localStorage.role, a sibling route has the same hole", () => {
    const route = readFileSync(join(fixture, "server", "billing", "routes.ts"), "utf8");
    expect(route).toMatch(/requireSession/);
    expect(route).not.toMatch(/owner|403|forbidden/i);
    expect(readFileSync(join(fixture, "web", "Layout.tsx"), "utf8")).toMatch(/localStorage\.getItem\("role"\)[\s\S]*"owner"/);
    const sibling = readFileSync(join(fixture, "server", "invoices", "routes.ts"), "utf8");
    expect(sibling).toMatch(/roleOf\(/);
    expect(sibling).not.toMatch(/"owner"|forbidden/);
  });

  proofs(
    BILLING,
    B,
    [
      { overlay: `${BILLING}-client-only`, why: "the page hides the invoices by localStorage.role and the route is left as it was", fails: [B.webOwner, B.webOwnerRole, B.webMemberRole, B.routeMember, B.routeNoTeam, B.routeMixed], passes: [B.webMember, B.routeOwner, B.routeSigned] },
      { overlay: `${BILLING}-generic-error`, why: "the route answers 403 but the page shows its generic failure", fails: [B.webMember, B.webMemberRole], passes: [B.webOwner, B.webOwnerRole, B.routeOwner, B.routeMember, B.routeNoTeam, B.routeMixed, B.routeSigned] },
      { overlay: `${BILLING}-any-team-owner`, why: "an owner of one team reads the invoices of every team they belong to", fails: [B.routeMixed], passes: [B.webOwner, B.webOwnerRole, B.webMember, B.webMemberRole, B.routeOwner, B.routeMember, B.routeNoTeam, B.routeSigned] },
    ],
    "reworded",
    [B.webOwner, B.webOwnerRole, B.routeOwner, B.routeSigned],
  );

  it("the a11y-names check fails a save control that is a clickable div, and passes the correct reference", () => {
    const g = graded(caseNamed(BILLING), BILLING);
    expect(g.check(/a11y-names/)).toMatchObject({ pass: true });
    const p = join(g.project, "web", "billing", "BillingPage.tsx");
    writeFileSync(p, readFileSync(p, "utf8").replace('<h1 id="billing-title">Billing</h1>', '<h1 id="billing-title">Billing</h1>\n      <div onClick={() => undefined}>Refresh</div>'));
    expect(g.check(/a11y-names/)).toMatchObject({ pass: false, why: expect.stringMatching(/div-click/) });
  }, 300_000);

  it("the Touches check fails a solution that fixes the header or the sibling route (those are Found, not fixed), and allows the task's files and .aidw/run", () => {
    const g = graded(caseNamed(BILLING), BILLING);
    const ch = caseNamed(BILLING).checks.find((x) => /nothing outside Touches/.test(x.name))!;
    const ok = ["shared/billing.ts", "server/billing/routes.ts", "server/billing/repo.ts", "server/tests/billing/billing.test.ts", "web/billing/BillingPage.tsx", "web/tests/billing/billing-page.test.tsx", ".aidw/run/report-T01.md", ".aidw/changes/owner-only-billing/tasks.yaml"];
    expect(runCheck(ch, g.project, touchesList(g, ok))).toMatchObject({ pass: true });
    for (const f of ["web/Layout.tsx", "server/invoices/routes.ts", "web/routes.tsx", "server/db/schema.sql", "server/app.ts", "shared/errors.ts", "web/tests/msw/handlers.ts", "web/tests/setup.ts", "server/tests/helpers.ts", ".aidw/constitution.md"]) {
      expect(runCheck(ch, g.project, touchesList(g, [f])), f).toMatchObject({ pass: false });
    }
  }, 300_000);

  it.skipIf(!existsSync(join(plugin, "roles", "fullstack", "skills", "seam-test.md")))("passes a whole run on the correct reference solution: tests, checks, reads, and the grader of the Found criterion", () => {
    const c = caseNamed(BILLING);
    const prompts: string[] = [];
    const exec: Exec = (prompt) => {
      prompts.push(prompt);
      return JSON.stringify(c.criteria.map((_, n) => ({ n: n + 1, pass: true, reason: "it does" })));
    };
    const report = "Works now: all scenarios. Found: web/Layout.tsx shows the Billing link by localStorage.role (a convenience, not a check); GET /api/invoices/{invoiceId} in server/invoices/routes.ts lets any team member read an invoice. Neither fixed, outside Touches.";
    const [r] = runLevel2({ root: plugin, role: "fullstack", runs: 1, agent: overlayFor(c, report), exec, install: noInstall, env: { ...process.env, AIDW_GRADE_SANDBOX: "off" }, runsDir: temp("aidw-l2fs-runs-") }, BILLING);
    const x = r!.results[0]!;
    expect(x.error).toBeUndefined();
    expect(x.steps.filter((st) => !st.pass), JSON.stringify(x.steps.filter((st) => !st.pass))).toEqual([]);
    expect(r!.pass).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("localStorage.role");
  }, 600_000);
});

describe.skipIf(!ready)("the two later cases start as the harness starts them: a fresh copy, the task started, the brief rendered", () => {
  const list = (yaml: string, key: string) => JSON.parse(yaml.match(new RegExp(`^\\s+${key}: (\\[.*\\])$`, "m"))![1]!) as string[];

  for (const name of [INVITE, BILLING]) {
    it(`${name}: after the task is started, aidw analyze and the approval check pass in the copy, and T01's brief lists its Touches and Verify`, () => {
      const c = caseNamed(name);
      const g = commands(c, prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fs-start-"), "project")));
      const aidw = (...args: string[]) => {
        const r = spawnSync("node", [join(plugin, "bin", "aidw"), ...args], { cwd: g.project, env: g.env, encoding: "utf8" });
        return { status: r.status, out: `${r.stdout}${r.stderr}` };
      };
      const v = aidw("approval", "check", name);
      expect(v.out).toMatch(/approval valid/);
      expect(v.status, v.out).toBe(0);
      const tasks = tasksOf(name);
      const brief = g.prep.briefText;
      expect(brief).toMatch(/Touches/);
      expect(brief).toMatch(/Verify/);
      for (const t of list(tasks, "touches")) expect(brief, t).toContain(t);
      for (const cmd of list(tasks, "verify")) expect(brief, cmd).toContain(cmd);
      for (const s of [...tasks.matchAll(/^\s+- (\S+\/\S+\/\S+)$/gm)].map((m) => m[1]!)) expect(brief, s).toContain(s);
      // last: analyze holds a UI plan to design tokens and an a11y layer (or a reason to leave it out)
      const a = aidw("analyze", name);
      expect(a.out).toMatch(/OK: 0 error\(s\)/);
      expect(a.status, a.out).toBe(0);
    }, 120_000);

    it(`${name}: the whole fixture suite and its typecheck pass in the case's fresh copy with no socket opened or bound`, () => {
      const c = caseNamed(name);
      const g = commands(c, prepareCopy(plugin, c, fixture, nodeModules as string, join(temp("aidw-l2fs-own-"), "project")));
      expect(existsSync(join(g.project, "server", "tests", "held-out"))).toBe(false);
      const { env, log } = socketBan();
      const run = (args: string[]) => {
        const r = spawnSync(args[0]!, args.slice(1), { cwd: g.project, env: { ...g.env, ...env }, encoding: "utf8", timeout: 240_000 });
        return { status: r.status, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
      };
      const t = run([join(g.project, "node_modules", ".bin", "vitest"), "run"]);
      expect(t.status, t.out).toBe(0);
      expect(t.out).toMatch(/\|web\|/);
      expect(t.out).toMatch(/\|server\|/);
      if (name === BILLING) expect(t.out).toMatch(/billing/);
      const tc = run([join(g.project, "node_modules", ".bin", "tsc"), "--noEmit"]);
      expect(tc.status, tc.out).toBe(0);
      expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
    }, 300_000);
  }
});
