import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import type { Exec } from "../src/evalrun.js";
import {
  agentArgs,
  claudeAgentRunner,
  ensureFixturePackages,
  jsonContains,
  level2ResultsFile,
  loadLevel2Cases,
  noScreenshotsBrief,
  parseStreamLog,
  removeTree,
  runLevel2,
  sessionSettings,
  wasRead,
  type AgentRunInput,
  type AgentRunner,
  type Installer,
} from "../src/evallevel2.js";
import { loadEvalCases, sharedDigest, workingDigest } from "../src/evals.js";

const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const realFixture = join(repo, "evals", "fixtures", "backend-api");
// Each run copies a plugin and a fixture and runs real commands: slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 120_000 });
const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  temps.push(d);
  return d;
};
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

/**
 * A tiny fixture with no packages to fetch: the Change of the real backend-api fixture (task T01), a value the Agent
 * must change, and a test runner of plain Node. Its "install" is a fake that writes node_modules/marker.
 */
function tinyFixture(): string {
  const dir = temp("aidw-l2-fixtures-");
  const fx = join(dir, "tiny-app");
  cpSync(join(realFixture, ".aidw"), join(fx, ".aidw"), { recursive: true });
  // only the pilot's Change: a case of the tiny fixture names none
  for (const id of readdirSync(join(fx, ".aidw", "changes"))) if (id !== "create-task" && id !== ".gitkeep") rmSync(join(fx, ".aidw", "changes", id), { recursive: true });
  put(fx, "package.json", JSON.stringify({ name: "tiny-app", private: true, scripts: { test: "node run-tests.mjs" } }));
  put(fx, "package-lock.json", JSON.stringify({ name: "tiny-app", lockfileVersion: 3, packages: {} }));
  put(fx, ".gitignore", "node_modules\n");
  put(fx, "src/value.txt", "old\n");
  put(
    fx,
    "run-tests.mjs",
    [
      'import { spawnSync } from "node:child_process";',
      "const files = process.argv.slice(2);",
      "let bad = 0;",
      'for (const f of files) { const r = spawnSync(process.execPath, [f], { encoding: "utf8" }); process.stdout.write(r.stdout); if (r.status !== 0) bad++; }',
      "process.exit(bad ? 1 : 0);",
      "",
    ].join("\n"),
  );
  return dir;
}

/** A plugin copy with one level 2 case of backend, `tiny`, on the tiny fixture. */
function pluginWithCase(opts: { checks?: string; criteria?: string; mustRead?: string[]; mustNotRead?: string[] } = {}): string {
  const root = temp("aidw-l2-plugin-");
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  const l2 = join(root, "roles", "backend", "evals", "level2");
  rmSync(l2, { recursive: true, force: true });
  const dir = join(l2, "tiny");
  const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  put(
    dir,
    "case.md",
    [
      "---",
      "case: tiny",
      "covers: [B3]",
      "fixture: tiny-app",
      "task: T01",
      `must_read: ${list(opts.mustRead ?? [".aidw/changes/create-task/api-contract.md", "plugin:roles/backend/skills/endpoint-test-matrix.md"])}`,
      `must_not_read: ${list(opts.mustNotRead ?? ["plugin:roles/backend/skills/effects-after-commit.md"])}`,
      "---",
      "## Criteria",
      "",
      opts.criteria ?? "- must say what it changed",
      "",
    ].join("\n"),
  );
  put(dir, "held-out/tests/value.test.mjs", 'import { readFileSync } from "node:fs";\nif (readFileSync("src/value.txt", "utf8").trim() !== "new") { console.log("  × the value is new"); process.exit(1); }\nconsole.log("  ✓ the value is new");\n');
  if (opts.checks !== undefined) put(dir, "checks.yaml", opts.checks);
  return root;
}

const contract = ".aidw/changes/create-task/api-contract.md";

/** A fake session: optional edit of the copy, a stream-json log of the given tool calls, and the given end. */
function fakeAgent(o: { value?: string; reads?: (i: AgentRunInput) => { name: string; input: Record<string, unknown> }[]; out?: Partial<ReturnType<AgentRunner>>; reply?: string; seen?: AgentRunInput[]; writeLog?: boolean } = {}): AgentRunner {
  return (i) => {
    o.seen?.push(i);
    if (o.value !== undefined) writeFileSync(join(i.cwd, "src", "value.txt"), `${o.value}\n`);
    const calls = o.reads ? o.reads(i) : [
      { name: "Read", input: { file_path: i.prompt.replace(/^Task brief: (.*)\. Read it.*$/, "$1") } },
      { name: "Read", input: { file_path: join(i.cwd, contract) } },
      { name: "Bash", input: { command: 'cat "$(aidw plugin-path roles/backend/skills/endpoint-test-matrix.md)"' } },
      { name: "Edit", input: { file_path: join(i.cwd, "src/value.txt") } },
    ];
    const lines = [
      { type: "system", subtype: "init" },
      ...calls.map((c, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", id: `t${n}`, name: c.name, input: c.input }] } })),
      { type: "assistant", parent_tool_use_id: null, message: { id: "last", content: [{ type: "text", text: o.reply ?? "Works now: all. Files: src/value.txt" }] } },
      { type: "result", subtype: "success", is_error: false, result: o.reply ?? "Works now: all. Files: src/value.txt", num_turns: calls.length + 1 },
    ];
    if (o.writeLog !== false) writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return { exit: 0, timedOut: false, turnLimit: false, turns: calls.length + 1, ...o.out };
  };
}

/** The grader: every criterion passes (or fails), and each prompt it was given is kept. */
const grader = (pass: boolean, seen: string[] = []): Exec => (prompt) => {
  seen.push(prompt);
  const n = (prompt.match(/^\d+\. /gm) ?? []).length;
  return JSON.stringify(Array.from({ length: n }, (_, k) => ({ n: k + 1, pass, reason: pass ? "ok" : "not said" })));
};

function setup(caseOpts: Parameters<typeof pluginWithCase>[0] = {}) {
  const root = pluginWithCase(caseOpts);
  const fixtures = tinyFixture();
  const env = { ...process.env, AIDW_GRADE_SANDBOX: "off", AIDW_FIXTURES_DIR: fixtures, AIDW_FIXTURE_CACHE: temp("aidw-l2-cache-") };
  const installs: string[] = [];
  const install: Installer = (dir) => {
    installs.push(dir);
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "marker"), "x");
  };
  const runsDir = temp("aidw-l2-runs-");
  return { root, fixtures, env, install, installs, runsDir };
}

describe("level 2 cases: the files", () => {
  it("reads the pilot case of backend, and level 1 does not see it", () => {
    const { cases, diags } = loadLevel2Cases(plugin, "backend");
    expect(diags.items).toEqual([]);
    const c = cases.find((x) => x.name === "team-comes-from-the-session");
    expect(c).toMatchObject({ fixture: "backend-api", task: "T01", timeoutMin: 25, maxTurns: 60, covers: ["B2", "B3", "endpoint-test-matrix"] });
    expect(c?.mustRead).toContain("plugin:roles/backend/skills/endpoint-test-matrix.md");
    expect(c?.heldOut).toEqual(["tests/held-out/create-task.test.ts"]);
    expect(c?.checks.map((x) => x.name)).toContain("the route has its three access tests (B2, route-inventory)");
    expect(c?.criteria).toHaveLength(1);
    // level 1 has a case of the same name (its answer-only form); only its .md is a level 1 case
    expect(loadEvalCases(plugin, "backend").cases.filter((x) => x.file.includes("level2"))).toEqual([]);
  });

  it("keeps level 2 out of level 1's shared digest", () => {
    const { root } = setup();
    const before = sharedDigest(root, "backend");
    put(root, "roles/backend/evals/level2/tiny/case.md", readFileSync(join(root, "roles/backend/evals/level2/tiny/case.md"), "utf8") + "\nmore\n");
    put(root, "roles/backend/evals/level2/results.json", "{}");
    expect(sharedDigest(root, "backend")).toBe(before);
  });

  it("reports a malformed case", () => {
    const root = pluginWithCase({ checks: "checks:\n  - name: x\n    expect: { exit: one, other: 1 }\n", criteria: "- should do it" });
    const dir = join(root, "roles", "backend", "evals", "level2");
    put(dir, "wrong-name/case.md", "---\ncase: other\nfixture: tiny-app\ntask: T01\nmust_read: [/etc/passwd]\nmax_turns: 0\ncolour: red\n---\n");
    put(dir, "no-case-file/notes.md", "x");
    const msgs = loadLevel2Cases(root, "backend").diags.errors.map((x) => `${x.file}: ${x.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tiny\/checks\.yaml: check 1: needs a name, a run command/),
        expect.stringMatching(/tiny\/case\.md: criterion "- should do it"/),
        expect.stringMatching(/wrong-name\/case\.md: case "other" must equal its folder name/),
        expect.stringMatching(/wrong-name\/case\.md: unknown key "colour"/),
        expect.stringMatching(/wrong-name\/case\.md: "\/etc\/passwd": a path relative to the project/),
        expect.stringMatching(/wrong-name\/case\.md: max_turns is a whole number/),
        expect.stringMatching(/wrong-name: a level 2 case needs held-out tests/),
        expect.stringMatching(/no-case-file: a level 2 case folder holds a case\.md/),
      ]),
    );
  });
});

describe("level 2: the package cache", () => {
  it("installs once per lockfile and reuses it, and installs again for a new lockfile", () => {
    const { fixtures, env, install, installs } = setup();
    const fx = join(fixtures, "tiny-app");
    const a = ensureFixturePackages(fx, "tiny-app", env, install);
    expect(a.installed).toBe(true);
    expect(a.nodeModules.startsWith(env.AIDW_FIXTURE_CACHE)).toBe(true);
    expect(existsSync(join(a.nodeModules, "marker"))).toBe(true);
    const b = ensureFixturePackages(fx, "tiny-app", env, install);
    expect(b).toMatchObject({ installed: false, nodeModules: a.nodeModules });
    expect(installs).toHaveLength(1);
    writeFileSync(join(fx, "package-lock.json"), JSON.stringify({ name: "tiny-app", lockfileVersion: 3, packages: { x: {} } }));
    const c = ensureFixturePackages(fx, "tiny-app", env, install);
    expect(c.installed).toBe(true);
    expect(c.key).not.toBe(a.key);
    expect(installs).toHaveLength(2);
  });

  it("installs again over an entry a dead run left half-written, and refuses a fixture without a lockfile", () => {
    const { fixtures, env, install, installs } = setup();
    const fx = join(fixtures, "tiny-app");
    const a = ensureFixturePackages(fx, "tiny-app", env, install);
    rmSync(join(dirname(a.nodeModules), ".complete"));
    expect(ensureFixturePackages(fx, "tiny-app", env, install).installed).toBe(true);
    expect(installs).toHaveLength(2);
    rmSync(join(fx, "package-lock.json"));
    expect(() => ensureFixturePackages(fx, "tiny-app", env, install)).toThrow(/no package-lock\.json/);
  });

  it("uses XDG_CACHE_HOME when no cache is named", () => {
    const { fixtures, install } = setup();
    const xdg = temp("aidw-l2-xdg-");
    const r = ensureFixturePackages(join(fixtures, "tiny-app"), "tiny-app", { XDG_CACHE_HOME: xdg }, install);
    expect(r.nodeModules.startsWith(join(xdg, "aidw", "fixtures", "tiny-app-"))).toBe(true);
  });
});

describe("level 2 cases: screenshots: off", () => {
  const brief = [
    "## Rules",
    "",
    "- **Design**: style through the tokens below (CSS variables or theme), never hard-coded colors.",
    "- **Screenshots**: when it works, save at most 6 PNG screenshots of the screens into `/x/shots` (create it).",
    "- Take screenshots with Playwright through the project's `webServer` config (it starts and stops the app).",
    "- Report in at most 10 lines.",
    "",
    "## Design tokens (approved; binding for UI)",
    "",
    "| Token | Kind | Value | Dark | Use |",
    "",
  ].join("\n");

  it("drops the two screenshot lines of the brief and keeps the tokens and the design rule", () => {
    const b = noScreenshotsBrief(brief);
    expect(b).not.toMatch(/Screenshots\*\*|Playwright|\/x\/shots/);
    expect(b).toMatch(/- \*\*Design\*\*: style through the tokens/);
    expect(b).toMatch(/## Design tokens \(approved; binding for UI\)\n\n\| Token/);
    expect(b).toMatch(/- Report in at most 10 lines\./);
    expect(b.split("\n")).toHaveLength(brief.split("\n").length - 2);
  });

  it("refuses a brief with no screenshot line: the case's task builds no screen with tokens, or the wording changed", () => {
    expect(() => noScreenshotsBrief("## Rules\n\n- Report in at most 10 lines.\n")).toThrow(/no screenshot line to drop/);
  });

  it("refuses a brief where one screenshot line, or more than two, would be dropped", () => {
    const one = brief.split("\n").filter((l) => !/^- Take screenshots with Playwright\b/.test(l)).join("\n");
    expect(() => noScreenshotsBrief(one)).toThrow(/exactly the two screenshot lines.*1 lines match/);
    expect(() => noScreenshotsBrief(`${brief}\n- Take screenshots with Playwright again.\n`)).toThrow(/exactly the two screenshot lines.*3 lines match/);
  });

  it("reads the key: off drops the lines, on or none keeps them, anything else is an error", () => {
    const root = pluginWithCase();
    const file = join(root, "roles", "backend", "evals", "level2", "tiny", "case.md");
    const text = readFileSync(file, "utf8");
    const withKey = (v: string) => {
      writeFileSync(file, text.replace("task: T01\n", `task: T01\nscreenshots: ${v}\n`));
      return loadLevel2Cases(root, "backend");
    };
    expect(loadLevel2Cases(root, "backend").cases[0]!.screenshots).toBe(true);
    expect(withKey("off").cases[0]!.screenshots).toBe(false);
    expect(withKey("false").cases[0]!.screenshots).toBe(false);
    expect(withKey("on").cases[0]!.screenshots).toBe(true);
    const bad = withKey("never");
    expect(bad.diags.errors.map((e) => e.message)).toEqual([expect.stringMatching(/screenshots: on or off/)]);
  });

  it("a run of a case with screenshots: off whose task has no screenshot lines is an ERROR that says why", () => {
    const s = setup();
    const file = join(s.root, "roles", "backend", "evals", "level2", "tiny", "case.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("task: T01\n", "task: T01\nscreenshots: off\n"));
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new" }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(r!.results[0]!.error).toMatch(/no screenshot line to drop/);
  });
});

describe("level 2: a run", () => {
  it("passes when the tests, the checks, the reads and the criteria pass, and keeps the run's files", () => {
    const s = setup({ checks: 'checks:\n  - name: the value file is tracked\n    run: git ls-files src/value.txt\n    expect: { matches: "value" }\n' });
    const seen: AgentRunInput[] = [];
    const prompts: string[] = [];
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new", seen }), exec: grader(true, prompts), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(r!.results[0]!.error).toBeUndefined();
    expect(r).toMatchObject({ name: "tiny", pass: true, runs: { total: 1, passed: 1, errors: 0 }, failed: [] });
    const x = r!.results[0]!;
    expect(x.steps.map((st) => [st.step, st.pass])).toEqual([["agent", true], ["tests", true], ["checks", true], ["reads", true], ["criteria", true]]);
    // the session ran in a fresh copy, with the brief the CLI wrote, the plugin, the agent and the limits
    const i = seen[0]!;
    expect(i.cwd.startsWith(x.dir)).toBe(true);
    expect(i.prompt).toMatch(/^Task brief: .*\.aidw\/run\/briefs\/create-task\/T01\.implement\.md\. Read it and implement the task\.$/);
    expect(readFileSync(join(i.cwd, ".aidw/run/briefs/create-task/T01.implement.md"), "utf8")).toMatch(/^# Task brief: T01/);
    expect(i).toMatchObject({ bare: false, agent: "aidw:backend", timeoutMs: 25 * 60_000, maxTurns: 60 });
    expect(readFileSync(join(i.cwd, "node_modules", "marker"), "utf8")).toBe("x"); // the cached packages, linked
    for (const f of ["session.jsonl", "diff.patch", "result.json", "held-out.txt", "checks.txt", "settings.json", "prompt.txt"]) expect(existsSync(join(x.dir, f)), f).toBe(true);
    // the grader saw the diff (taken before the held-out tests were laid over) and the final reply
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/\+new/);
    expect(prompts[0]).not.toMatch(/value\.test\.mjs/);
    expect(prompts[0]).toMatch(/Works now: all/);
  });

  it("fails on a held-out test, and does not ask the grader", () => {
    const s = setup();
    const prompts: string[] = [];
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "wrong" }), exec: grader(true, prompts), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(r!.pass).toBe(false);
    const steps = r!.results[0]!.steps;
    expect(steps.find((x) => x.step === "tests")).toMatchObject({ pass: false, failed: ["the value is new"] });
    expect(steps.find((x) => x.step === "criteria")).toMatchObject({ skipped: "a machine grader failed" });
    expect(prompts).toEqual([]);
    expect(r!.failed).toEqual(["tests: the value is new"]);
  });

  it("fails on a check: exit code, a JSON subset, a regex", () => {
    const checks = [
      "checks:",
      "  - name: exits 3",
      "    run: exit 3",
      "    expect: { exit: 3 }",
      "  - name: json holds it",
      `    run: echo '{"routes":[{"method":"GET","path":"/a"},{"method":"POST","path":"/api/projects/:id/tasks","ok":true}]}'`,
      "    expect:",
      '      json: { routes: [{ method: POST, path: "/tasks$/", ok: true }] }',
      "  - name: json lacks it",
      `    run: echo '{"routes":[]}'`,
      "    expect: { json: { routes: [{ method: POST }] } }",
      "  - name: wrong exit",
      "    run: echo nope; exit 1",
    ].join("\n");
    const s = setup({ checks });
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new" }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    const step = r!.results[0]!.steps.find((x) => x.step === "checks")!;
    expect(step.pass).toBe(false);
    expect(step.failed).toEqual(["json lacks it: output does not hold the expected JSON", "wrong exit: exit 1, expected 0: nope"]);
  });

  it("fails when a must_read file was not read, or a must_not_read one was", () => {
    const s = setup();
    const reads = (i: AgentRunInput) => [
      { name: "Read", input: { file_path: join(i.cwd, contract) } },
      { name: "Read", input: { file_path: join(i.pluginRoot, "roles/backend/skills/effects-after-commit.md") } },
    ];
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new", reads }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(r!.results[0]!.steps.find((x) => x.step === "reads")).toMatchObject({
      pass: false,
      failed: ["did not read plugin:roles/backend/skills/endpoint-test-matrix.md", "read plugin:roles/backend/skills/effects-after-commit.md, which it must not"],
    });
  });

  it("fails a run stopped at the time or turn limit, with the case's own limits", () => {
    const s = setup();
    put(s.root, "roles/backend/evals/level2/tiny/case.md", readFileSync(join(s.root, "roles/backend/evals/level2/tiny/case.md"), "utf8").replace("task: T01\n", "task: T01\ntimeout_min: 2\nmax_turns: 3\n"));
    const seen: AgentRunInput[] = [];
    const [t] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new", seen, reads: () => [], out: { exit: null, timedOut: true } }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(seen[0]).toMatchObject({ timeoutMs: 120_000, maxTurns: 3 });
    expect(t!.results[0]!.steps[0]).toMatchObject({ step: "agent", pass: false, failed: ["stopped at the time limit (2 min)"] });
    expect(t!.pass).toBe(false);
    const [n] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new", reads: () => [], out: { exit: null, turnLimit: true } }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(n!.results[0]!.steps[0]!.failed).toEqual(["stopped past the turn limit (3 turns)"]);
    // more turns in the log than the limit counts too, even when the runner did not stop it
    const many = (i: AgentRunInput) => Array.from({ length: 5 }, () => ({ name: "Read", input: { file_path: join(i.cwd, contract) } }));
    const [m] = runLevel2({ root: s.root, role: "backend", runs: 1, agent: fakeAgent({ value: "new", reads: many, out: { turns: 0 } }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(m!.results[0]!.steps[0]!.failed).toEqual(["stopped past the turn limit (3 turns)"]);
  });

  it("is an ERROR, not a FAIL, when the session never ran", () => {
    const s = setup();
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 2, agent: fakeAgent({ writeLog: false, out: { exit: null, error: "spawn claude ENOENT" } }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(r).toMatchObject({ pass: false, runs: { total: 2, passed: 0, errors: 2 } });
    expect(r!.results[0]!.error).toMatch(/the session did not run: spawn claude ENOENT/);
  });

  it("fails on a criterion the grader fails, and counts failures over runs", () => {
    const s = setup();
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 3, agent: fakeAgent({ value: "new" }), exec: grader(false), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(r).toMatchObject({ pass: false, runs: { total: 3, passed: 0, errors: 0 } });
    expect(r!.failed).toEqual(["criteria: must say what it changed: not said (3 of 3 runs)"]);
    expect(s.installs).toHaveLength(1); // three runs, one install
  });

  it("bare: no plugin and no agent, judged by the tests and the checks only, with no grader", () => {
    const s = setup();
    const seen: AgentRunInput[] = [];
    const prompts: string[] = [];
    // reads nothing of the Role, and does the task right: it passes bare
    const [r] = runLevel2({ root: s.root, role: "backend", runs: 1, bare: true, agent: fakeAgent({ value: "new", seen, reads: () => [] }), exec: grader(true, prompts), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(seen[0]!.bare).toBe(true);
    expect(r!.pass).toBe(true);
    expect(r!.results[0]!.steps.find((x) => x.step === "reads")!.pass).toBe(false); // shown, not counted
    expect(prompts).toEqual([]);
    const [w] = runLevel2({ root: s.root, role: "backend", runs: 1, bare: true, agent: fakeAgent({ value: "wrong", reads: () => [] }), exec: grader(true), install: s.install, env: s.env, runsDir: s.runsDir });
    expect(w!.pass).toBe(false);
  });
});

describe("level 2: the session", () => {
  const base = { cwd: "/w/copy", bare: false, pluginRoot: "/p/aidw", agent: "aidw:backend", settingsFile: "/w/settings.json", maxTurns: 60 };

  it("builds the claude command line, with the plugin and agent only when not bare", () => {
    expect(agentArgs(base)).toEqual([
      "-p", "--output-format", "stream-json", "--verbose",
      "--plugin-dir", "/p/aidw", "--agent", "aidw:backend",
      "--tools", "Read,Write,Edit,Glob,Grep,Bash",
      "--permission-mode", "acceptEdits", "--permission-prompts", "none",
      "--setting-sources", "project", "--settings", "/w/settings.json",
      "--strict-mcp-config", "--no-session-persistence",
      "--max-turns", "60",
    ]);
    const bare = agentArgs({ ...base, bare: true, model: "sonnet" });
    expect(bare).not.toContain("--plugin-dir");
    expect(bare).not.toContain("--agent");
    expect(bare.slice(-2)).toEqual(["--model", "sonnet"]);
  });

  it("sandboxes Bash with no network, no way out of the sandbox, and no start without it", () => {
    const st = sessionSettings({ pluginRoot: "/p/aidw", project: "/w/copy", denyRead: ["/repo/evals/**", "/real/roles/*/evals/**"] }) as { permissions: { allow: string[]; deny: string[] }; sandbox: Record<string, unknown> };
    expect(st.sandbox).toEqual({ enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, network: { allowedDomains: [] } });
    // no bare Read: reads outside the copy only in the session's plugin copy
    // Bash by a rule too (sandboxed loops and $(…) asked for approval); it can still run only sandboxed
    expect(st.permissions.allow).toEqual(["Bash", "Read(//p/aidw/**)"]);
    expect(st.permissions.deny).toEqual(["WebFetch", "WebSearch", "Read(//repo/evals/**)", "Read(//real/roles/*/evals/**)", "Edit(//p/aidw/**)", "Write(//p/aidw/**)", "Edit(//w/copy/.claude/**)", "Write(//w/copy/.claude/**)"]);
    const bare = sessionSettings({ pluginRoot: "/p/aidw", project: "/w/copy", bare: true }) as { permissions: { allow: string[]; deny: string[] } };
    expect(bare.permissions.allow).toEqual(["Bash"]);
    expect(bare.permissions.deny).toContain("Read(//p/aidw/**)");
  });

  /** A stand-in for claude: prints `turns` assistant messages, `gap` ms apart, then a result; echoes its args and stdin. */
  function fakeClaude(turns: number, gap: number): string[] {
    const dir = temp("aidw-l2-claude-");
    const script = join(dir, "claude.mjs");
    writeFileSync(
      script,
      [
        'import { readFileSync } from "node:fs";',
        'const input = readFileSync(0, "utf8");',
        "const sleep = (ms) => new Promise((r) => setTimeout(r, ms));",
        `console.log(JSON.stringify({ type: "system", args: process.argv.slice(2), input, path: process.env.PATH }));`,
        `for (let i = 0; i < ${turns}; i++) { console.log(JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { id: "m" + i, content: [{ type: "tool_use", name: "Read", input: { file_path: "x" } }] } })); await sleep(${gap}); }`,
        'console.log(JSON.stringify({ type: "result", subtype: "success", result: "done" }));',
        "",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    return [process.execPath, script];
  }
  const input = (over: Partial<AgentRunInput> = {}): AgentRunInput => {
    const dir = temp("aidw-l2-session-");
    return { ...base, cwd: dir, prompt: "Task brief: b.md. Read it and implement the task.", logFile: join(dir, "log.jsonl"), timeoutMs: 20_000, maxTurns: 10, ...over };
  };

  it("runs the command with the prompt on stdin, keeps the raw log, and puts the plugin's bin first on PATH", () => {
    const i = input();
    const r = claudeAgentRunner(fakeClaude(3, 0))(i);
    expect(r).toMatchObject({ exit: 0, timedOut: false, turnLimit: false, turns: 3 });
    const log = readFileSync(i.logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log[0].input).toBe(i.prompt);
    expect(log[0].args).toEqual(agentArgs(i));
    expect(log[0].path.split(":")[0]).toBe("/p/aidw/bin");
    expect(parseStreamLog(readFileSync(i.logFile, "utf8"))).toMatchObject({ turns: 3, finalText: "done", resultSubtype: "success" });
  });

  it("stops the session past the turn limit and at the time limit", () => {
    const turns = claudeAgentRunner(fakeClaude(50, 20))(input({ maxTurns: 4 }));
    expect(turns).toMatchObject({ turnLimit: true, timedOut: false, exit: null });
    expect(turns.turns).toBe(5);
    const time = claudeAgentRunner(fakeClaude(50, 200))(input({ timeoutMs: 700 }));
    expect(time).toMatchObject({ timedOut: true, turnLimit: false, exit: null });
    expect(time.turns).toBeLessThan(50);
  });

  it("reports a command that does not exist", () => {
    const r = claudeAgentRunner([join(tmpdir(), "no-such-claude-binary")])(input());
    expect(r.exit).toBeNull();
    expect(r.error).toMatch(/did not start/);
  });
});

describe("level 2: the tool log", () => {
  const ctx = { project: "/private/var/folders/x/copy", pluginRoot: "/p/aidw" };
  const log = [
    { type: "assistant", parent_tool_use_id: null, message: { id: "a", content: [{ type: "text", text: "start" }, { type: "tool_use", name: "Read", input: { file_path: "/var/folders/x/copy/.aidw/c.md" } }] } },
    { type: "assistant", parent_tool_use_id: null, message: { id: "a", content: [{ type: "tool_use", name: "Bash", input: { command: 'cat "$(aidw plugin-path roles/backend/skills/s.md)"' } }] } },
    { type: "assistant", parent_tool_use_id: null, message: { id: "b", content: [{ type: "tool_use", name: "Bash", input: { command: "aidw plugin-path roles/backend/skills/t.md" } }] } },
    { type: "assistant", parent_tool_use_id: null, message: { id: "c", content: [{ type: "tool_use", name: "Grep", input: { pattern: "x", path: "src/app.ts" } }] } },
    { type: "assistant", parent_tool_use_id: "sub", message: { id: "d", content: [{ type: "tool_use", name: "Read", input: { file_path: "/p/aidw/library/skills/u/SKILL.md" } }] } },
    "not json",
    { type: "result", subtype: "error_max_turns", is_error: true },
  ].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");

  it("lists the tool calls and counts the main thread's turns by message id", () => {
    const s = parseStreamLog(log);
    expect(s.calls.map((c) => c.name)).toEqual(["Read", "Bash", "Bash", "Grep", "Read"]);
    expect(s).toMatchObject({ turns: 3, finalText: "start", resultSubtype: "error_max_turns", isError: true });
  });

  it("counts a Read, a reading Bash command and a Grep of the file, not a command that only names it", () => {
    const calls = parseStreamLog(log).calls;
    expect(wasRead(calls, ".aidw/c.md", ctx)).toBe(true); // /var and /private/var are one place
    expect(wasRead(calls, "plugin:roles/backend/skills/s.md", ctx)).toBe(true);
    expect(wasRead(calls, "plugin:roles/backend/skills/t.md", ctx)).toBe(false);
    expect(wasRead(calls, "src/app.ts", ctx)).toBe(true);
    expect(wasRead(calls, "plugin:library/skills/u/SKILL.md", ctx)).toBe(true);
    expect(wasRead(calls, "src/other.ts", ctx)).toBe(false);
  });

  it("matches JSON by subset, lists by any element, strings by /regex/", () => {
    expect(jsonContains({ a: [{ b: 1, c: 2 }, { b: 3 }], d: "x" }, { a: [{ b: 3 }, { c: 2 }] })).toBe(true);
    expect(jsonContains({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe(false);
    expect(jsonContains({ p: "/api/projects/:projectId/tasks" }, { p: "/^\\/api\\/projects\\/:[A-Za-z]+\\/tasks$/" })).toBe(true);
    expect(jsonContains({ p: "/" }, { p: "/tasks$/" })).toBe(false);
    expect(jsonContains(null, { a: 1 })).toBe(false);
  });
});

describe("aidw eval --level 2", () => {
  function cli(s: ReturnType<typeof setup>, argv: string[], o: { agent?: AgentRunner; exec?: Exec } = {}) {
    let out = "";
    let err = "";
    const code = run(argv, { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), {
      out: (x) => (out += x),
      err: (x) => (err += x),
      agentRunner: o.agent ?? fakeAgent({ value: "new" }),
      modelExec: () => o.exec ?? grader(true),
      installer: s.install,
    });
    return { code, out, err };
  }
  const gitSetup = (caseOpts: Parameters<typeof pluginWithCase>[0] = {}) => {
    const s = setup(caseOpts);
    execFileSync("git", ["init", "-q"], { cwd: s.root });
    return s;
  };

  it("runs the cases 3 times, prints each run's folder, and writes level2/results.json", () => {
    const s = gitSetup();
    const r = cli(s, ["eval", "backend", "--level", "2"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^PASS  backend\/tiny level 2 \(3\/3 runs\)/m);
    expect(r.out.match(/run \d: agent ok, tests ok, checks ok, reads ok, criteria ok \(\d+ turns\) \S+aidw-l2-backend-tiny-\d-/g)).toHaveLength(3);
    expect(r.out).toMatch(/wrote roles\/backend\/evals\/level2\/results\.json/);
    const rec = JSON.parse(readFileSync(level2ResultsFile(s.root, "backend"), "utf8"));
    expect(rec).toMatchObject({ format: 2, level: 2, role: "backend", model: null, tier: "deep", runs: 3, digest: workingDigest(s.root, "backend") });
    expect(rec.cases).toEqual([expect.objectContaining({ name: "tiny", pass: true, runs: { total: 3, passed: 3, errors: 0 }, failed: [], model: null })]);
    expect(rec.cases[0].digest).toMatch(/^sha256:/);
    expect(rec.cases[0].fixture).toMatch(/^sha256:/);
    // level 1's file is untouched
    expect(readFileSync(join(s.root, "roles/backend/evals/results.json"), "utf8")).toBe(readFileSync(join(plugin, "roles/backend/evals/results.json"), "utf8"));
  });

  it("exits 1 and still writes the record when a case fails", () => {
    const s = gitSetup();
    const r = cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: fakeAgent({ value: "wrong" }) });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^FAIL  backend\/tiny level 2 \(0\/1 runs\)/m);
    expect(JSON.parse(readFileSync(level2ResultsFile(s.root, "backend"), "utf8")).cases[0]).toMatchObject({ pass: false, failed: ["tests: the value is new"] });
  });

  it("merges a --case run into a file of the same content and model, and refuses otherwise", () => {
    const s = gitSetup();
    expect(cli(s, ["eval", "backend", "--level", "2", "--case", "tiny"]).err).toMatch(/no result file written for backend: there is no level 2 results\.json yet/);
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: fakeAgent({ value: "wrong" }) }).code).toBe(1);
    const r = cli(s, ["eval", "backend", "--level", "2", "--case", "tiny"]);
    expect(r.out).toMatch(/wrote roles\/backend\/evals\/level2\/results\.json/);
    expect(JSON.parse(readFileSync(level2ResultsFile(s.root, "backend"), "utf8")).cases[0]).toMatchObject({ pass: true, runs: { total: 3 } });
    // the Role changed since: a --case run does not merge
    put(s.root, "roles/backend/lessons.md", "a new lesson\n");
    expect(cli(s, ["eval", "backend", "--level", "2", "--case", "tiny"]).err).toMatch(/shared content changed since the last full run/);
  });

  it("writes nothing with --model on a tier that uses the session's model, outside a source checkout, or when every run errs", () => {
    const g = gitSetup();
    expect(cli(g, ["eval", "backend", "--level", "2", "--runs", "1", "--model", "sonnet"]).err).toMatch(/its tier uses the session's model; run without --model/);
    expect(cli(g, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: fakeAgent({ writeLog: false, out: { exit: null, error: "boom" } }) }).err).toMatch(/no case was graded/);
    expect(existsSync(level2ResultsFile(g.root, "backend"))).toBe(false);
    const n = setup();
    expect(cli(n, ["eval", "backend", "--level", "2", "--runs", "1"]).err).toMatch(/is not a source checkout/);
  });

  it("--bare: exits 0 when the case fails without the Role, 1 with PASSES BARE, and never writes the file", () => {
    const s = gitSetup();
    const fails = cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--bare"], { agent: fakeAgent({ value: "wrong", reads: () => [] }) });
    expect(fails.code).toBe(0);
    expect(fails.out).toMatch(/bare \(no Role instructions\): 1\/1 case\(s\) failed the tests or the checks, as they should/);
    const passes = cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--bare"], { agent: fakeAgent({ value: "new", reads: () => [] }) });
    expect(passes.code).toBe(1);
    expect(passes.out).toMatch(/PASSES BARE backend\/tiny/);
    expect(existsSync(level2ResultsFile(s.root, "backend"))).toBe(false);
  });

  it("refuses --level 2 with no Role, with --without, and an unknown case or level", () => {
    const s = gitSetup();
    expect(cli(s, ["eval", "--level", "2"]).err).toMatch(/--level 2 needs a Role/);
    expect(cli(s, ["eval", "backend", "--level", "2", "--without", "B3"]).err).toMatch(/--without is level 1 only/);
    expect(cli(s, ["eval", "backend", "--level", "2", "--case", "nope"]).err).toMatch(/no level 2 case "nope" for backend/);
    expect(cli(s, ["eval", "backend", "--level", "3"]).err).toMatch(/--level takes 1 or 2/);
  });
});

describe("aidw roster and level 2", () => {
  const roster = (s: ReturnType<typeof setup>) => {
    let out = "";
    const code = run(["roster"], { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), { out: (x) => (out += x), err: (x) => (out += x) });
    return { code, out };
  };
  // These runs grade with AIDW_GRADE_SANDBOX=off (no sandbox can be applied inside a Claude Code session): that
  // warning is tested on its own below, and left out here.
  const NO_SANDBOX = /graded with no sandbox/;
  // backend's file only: the plugin's other Roles with level 2 cases (frontend) warn about their own
  const l2 = (out: string) => out.split("\n").filter((l) => l.includes("backend/evals/level2/results.json") && !NO_SANDBOX.test(l));

  it("warns, never fails, when the results are missing, stale or failing", () => {
    const s = setup();
    execFileSync("git", ["init", "-q"], { cwd: s.root });
    let r = roster(s);
    expect(r.code).toBe(0);
    expect(l2(r.out)).toEqual([expect.stringMatching(/WARN .*missing: run `aidw eval backend --level 2` and commit the file/)]);
    const go = (agent: AgentRunner) =>
      run(["eval", "backend", "--level", "2"], { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), { out: () => undefined, err: () => undefined, agentRunner: agent, modelExec: () => grader(true), installer: s.install });
    go(fakeAgent({ value: "new" }));
    expect(l2(roster(s).out)).toEqual([]);
    // the case folder changed
    put(s.root, "roles/backend/evals/level2/tiny/held-out/tests/extra.test.mjs", "");
    expect(l2(roster(s).out)).toEqual([expect.stringMatching(/case tiny was run from another version of roles\/backend\/evals\/level2\/tiny/)]);
    rmSync(join(s.root, "roles/backend/evals/level2/tiny/held-out/tests/extra.test.mjs"));
    // the fixture changed
    put(join(s.fixtures, "tiny-app"), "src/other.txt", "x");
    expect(l2(roster(s).out)).toEqual([expect.stringMatching(/case tiny was run on another version of fixture tiny-app/)]);
    rmSync(join(s.fixtures, "tiny-app", "src/other.txt"));
    // a failing run
    go(fakeAgent({ value: "wrong" }));
    r = roster(s);
    expect(r.code).toBe(0);
    expect(l2(r.out)).toEqual([expect.stringMatching(/the last level 2 run did not pass 1 case\(s\): tiny/)]);
    // the Role changed
    put(s.root, "roles/backend/lessons.md", "a new lesson\n");
    expect(l2(roster(s).out)).toEqual([expect.stringMatching(/older than the Role's content/)]);
  });

  it("warns when the grading ran with no sandbox", () => {
    const s = setup();
    execFileSync("git", ["init", "-q"], { cwd: s.root });
    run(["eval", "backend", "--level", "2", "--runs", "3"], { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), { out: () => undefined, err: () => undefined, agentRunner: fakeAgent({ value: "new" }), modelExec: () => grader(true), installer: s.install });
    expect(JSON.parse(readFileSync(level2ResultsFile(s.root, "backend"), "utf8")).cases[0].gradingSandbox).toBe("none");
    const r = roster(s);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/WARN .*level2\/results\.json .*1 level 2 case\(s\) were graded with no sandbox around the grading commands: tiny/);
  });

  it("reports a level 2 case whose covers names nothing of the Role", () => {
    const s = setup();
    const f = join(s.root, "roles/backend/evals/level2/tiny/case.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("covers: [B3]", "covers: [B99]"));
    const r = roster(s);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/level2\/tiny\/case\.md {2}covers "B99" is not a rule id or a skill of backend/);
  });
});
