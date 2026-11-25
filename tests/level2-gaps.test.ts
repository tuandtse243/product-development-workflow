import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli.js";
import type { Exec } from "../src/evalrun.js";
import {
  agentArgs,
  claudeAgentRunner,
  fixtureDigest,
  level2CaseDigest,
  level2ResultsFile,
  loadLevel2Cases,
  mergeLevel2Results,
  parseStreamLog,
  removeTree,
  runCheck,
  runLevel2,
  takeLevel2Digests,
  type AgentRunInput,
  type AgentRunner,
  type Installer,
} from "../src/evallevel2.js";
import { roleDigest, sharedDigest } from "../src/evals.js";

/**
 * Gaps and edge cases of the level 2 harness (T18), found by the test agent. No model is reached: the Agent session
 * is a fake AgentRunner or a fake `claude` script, the grader a fake Exec. Tests once named "BUG:" showed a
 * defect in src/evallevel2.ts; each is fixed and the test now guards it.
 */

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
const contract = ".aidw/changes/create-task/api-contract.md";
const L2 = "roles/backend/evals/level2";

function tinyFixture(): string {
  const dir = temp("aidw-l2g-fixtures-");
  const fx = join(dir, "tiny-app");
  cpSync(join(realFixture, ".aidw"), join(fx, ".aidw"), { recursive: true });
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

const caseMd = (name: string, extra = "") =>
  [
    "---",
    `case: ${name}`,
    "covers: [B3]",
    "fixture: tiny-app",
    "task: T01",
    extra,
    `must_read: [${JSON.stringify(contract)}]`,
    "---",
    "## Criteria",
    "",
    "- must say what it changed",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n")
    .replace("## Criteria", "## Criteria\n");
const heldOutTest = 'import { readFileSync } from "node:fs";\nif (readFileSync("src/value.txt", "utf8").trim() !== "new") { console.log("  × the value is new"); process.exit(1); }\nconsole.log("  ✓ the value is new");\n';

/** A plugin copy whose backend has the level 2 cases named (each on the tiny fixture). */
function pluginWithCases(names: string[] = ["tiny"], opts: { checks?: string; tiers?: string } = {}): string {
  const root = temp("aidw-l2g-plugin-");
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  rmSync(join(root, L2), { recursive: true, force: true });
  for (const n of names) {
    put(root, `${L2}/${n}/case.md`, caseMd(n));
    put(root, `${L2}/${n}/held-out/tests/value.test.mjs`, heldOutTest);
    if (opts.checks !== undefined) put(root, `${L2}/${n}/checks.yaml`, opts.checks);
  }
  if (opts.tiers !== undefined) writeFileSync(join(root, "tiers.yaml"), opts.tiers);
  return root;
}

function fakeAgent(o: { value?: string; out?: Partial<ReturnType<AgentRunner>>; writeLog?: boolean; also?: (i: AgentRunInput) => void; seen?: AgentRunInput[] } = {}): AgentRunner {
  return (i) => {
    o.seen?.push(i);
    if (o.value !== undefined) writeFileSync(join(i.cwd, "src", "value.txt"), `${o.value}\n`);
    o.also?.(i);
    const lines = [
      { type: "assistant", parent_tool_use_id: null, message: { id: "m0", content: [{ type: "tool_use", name: "Read", input: { file_path: join(i.cwd, contract) } }] } },
      { type: "result", subtype: "success", is_error: false, result: "Works now: all." },
    ];
    if (o.writeLog !== false) writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return { exit: 0, timedOut: false, turnLimit: false, turns: 1, ...o.out };
  };
}
const grader = (pass: boolean, seen: string[] = []): Exec => (prompt) => {
  seen.push(prompt);
  const n = (prompt.match(/^\d+\. /gm) ?? []).length;
  return JSON.stringify(Array.from({ length: n }, (_, k) => ({ n: k + 1, pass, reason: pass ? "ok" : "not said" })));
};

function setup(names?: string[], opts: Parameters<typeof pluginWithCases>[1] = {}) {
  const root = pluginWithCases(names, opts);
  const fixtures = tinyFixture();
  const env = { ...process.env, AIDW_GRADE_SANDBOX: "off", AIDW_FIXTURES_DIR: fixtures, AIDW_FIXTURE_CACHE: temp("aidw-l2g-cache-") };
  const install: Installer = (dir) => {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "marker"), "x");
  };
  return { root, fixtures, env, install, runsDir: temp("aidw-l2g-runs-") };
}
type S = ReturnType<typeof setup>;
const go = (s: S, agent: AgentRunner, o: { runs?: number; bare?: boolean; exec?: Exec; caseName?: string } = {}) =>
  runLevel2({ root: s.root, role: "backend", runs: o.runs ?? 1, bare: !!o.bare, agent, exec: o.exec ?? grader(true), install: s.install, env: s.env, runsDir: s.runsDir }, o.caseName);

function cli(s: S, argv: string[], o: { agent?: AgentRunner; exec?: (m: string | undefined) => Exec; models?: (string | undefined)[] } = {}) {
  let out = "";
  let err = "";
  const code = run(argv, { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), {
    out: (x) => (out += x),
    err: (x) => (err += x),
    agentRunner: o.agent ?? fakeAgent({ value: "new" }),
    modelExec: (m) => {
      o.models?.push(m);
      return o.exec ? o.exec(m) : grader(true);
    },
    installer: s.install,
  });
  return { code, out, err };
}
const gitSetup = (names?: string[], opts: Parameters<typeof pluginWithCases>[1] = {}) => {
  const s = setup(names, opts);
  execFileSync("git", ["init", "-q"], { cwd: s.root });
  return s;
};
const readRec = (s: S) => JSON.parse(readFileSync(level2ResultsFile(s.root, "backend"), "utf8"));

// ---------------------------------------------------------------- the case files

describe("level 2 gaps: malformed checks.yaml and held-out/", () => {
  const errs = (root: string) => loadLevel2Cases(root, "backend").diags.errors.map((x) => `${x.file}: ${x.message}`);

  it("reports a checks.yaml that is not YAML, or has no list `checks:`", () => {
    expect(errs(pluginWithCases(["tiny"], { checks: "checks: [unclosed\n  - : :" }))).toEqual([expect.stringMatching(/tiny\/checks\.yaml: not YAML/)]);
    expect(errs(pluginWithCases(["tiny"], { checks: "checks: { name: x }\n" }))).toEqual([expect.stringMatching(/tiny\/checks\.yaml: a list `checks:`/)]);
    expect(errs(pluginWithCases(["tiny"], { checks: "- name: x\n  run: \"true\"\n" }))).toEqual([expect.stringMatching(/a list `checks:`/)]);
    expect(errs(pluginWithCases(["tiny"], { checks: "" }))).toEqual([expect.stringMatching(/a list `checks:`/)]);
  });

  it("reports each bad check: no run, expect not a map, an unknown expect key, a fractional exit, a non-string matches", () => {
    const checks = [
      "checks:",
      "  - name: no run",
      "  - name: expect is a list",
      "    run: \"true\"",
      "    expect: [1]",
      "  - name: odd key",
      "    run: \"true\"",
      "    expect: { exitcode: 0 }",
      "  - name: half exit",
      "    run: \"true\"",
      "    expect: { exit: 1.5 }",
      "  - name: number matches",
      "    run: \"true\"",
      "    expect: { matches: 3 }",
      "  - just a string",
    ].join("\n");
    const e = errs(pluginWithCases(["tiny"], { checks }));
    expect(e).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/check 1: needs a name, a run command/),
        expect.stringMatching(/check 2: needs a name, a run command/),
        expect.stringMatching(/check "odd key": unknown expect key "exitcode"/),
        expect.stringMatching(/check "half exit": expect\.exit is a whole number/),
        expect.stringMatching(/check "number matches": expect\.matches is a regular expression/),
        expect.stringMatching(/check 6: needs a name/),
      ]),
    );
  });

  it("an empty checks list is fine, and expect left out means exit 0", () => {
    expect(errs(pluginWithCases(["tiny"], { checks: "checks: []\n" }))).toEqual([]);
    const c = loadLevel2Cases(pluginWithCases(["tiny"], { checks: "checks:\n  - name: a\n    run: \"true\"\n" }), "backend").cases[0]!;
    expect(c.checks).toEqual([{ name: "a", run: "true", expect: { exit: 0 } }]);
  });

  it("refuses to run any case while one is malformed: a missing held-out/, or one holding only .DS_Store", () => {
    const s = setup(["tiny", "other"]);
    rmSync(join(s.root, L2, "other", "held-out"), { recursive: true });
    let ran = 0;
    const agent: AgentRunner = (i) => (ran++, fakeAgent({ value: "new" })(i));
    expect(() => go(s, agent)).toThrow(/level 2 cases of backend are malformed:[\s\S]*other: a level 2 case needs held-out tests/);
    put(s.root, `${L2}/other/held-out/.DS_Store`, "x");
    expect(() => go(s, agent, { caseName: "tiny" })).toThrow(/malformed/);
    expect(ran).toBe(0);
  });

  it("an invalid regex in expect.matches is reported when the case loads, not thrown in the middle of a run", () => {
    const checks = 'checks:\n  - name: bad regex\n    run: echo x\n    expect: { matches: "(" }\n';
    const s = setup(["tiny"], { checks });
    expect(errs(s.root)).toEqual([expect.stringMatching(/bad regex.*regular expression/)]);
  });

  it("runLevel2 never throws on a check whose expected JSON holds an invalid /regex/ (a run is an error result at worst)", () => {
    const checks = "checks:\n  - name: bad json regex\n    run: echo '{\"a\":\"x\"}'\n    expect: { json: { a: \"/(/\" } }\n";
    const s = setup(["tiny"], { checks });
    let r: ReturnType<typeof go> | undefined;
    expect(() => (r = go(s, fakeAgent({ value: "new" })))).not.toThrow();
    expect(r![0]!.pass).toBe(false);
  });
});

// ---------------------------------------------------------------- the checks

describe("level 2 gaps: a check's JSON", () => {
  const env = { ...process.env };
  const cwd = tmpdir();

  it("parses stdout as JSON as checks.yaml documents, so a warning on stderr does not fail the check", () => {
    const r = runCheck({ name: "j", run: `echo '{"a":1}'; echo "(node:1) ExperimentalWarning: x" >&2`, expect: { exit: 0, json: { a: 1 } } }, cwd, env);
    expect(r).toEqual({ pass: true, why: "" });
  });

  it("finds the JSON after a plain log line, and fails on output with no JSON", () => {
    expect(runCheck({ name: "j", run: `echo scanning; echo '{"a":1}'`, expect: { exit: 0, json: { a: 1 } } }, cwd, env).pass).toBe(true);
    expect(runCheck({ name: "j", run: "echo nothing here", expect: { exit: 0, json: { a: 1 } } }, cwd, env)).toEqual({ pass: false, why: "output is not JSON" });
    expect(runCheck({ name: "j", run: `echo '[{"a":1},{"a":2}]'`, expect: { exit: 0, json: [{ a: 2 }] } }, cwd, env).pass).toBe(true);
  });

  it("checks the exit before the regex and the JSON, and a command that cannot run is exit 127", () => {
    expect(runCheck({ name: "x", run: `echo '{"a":1}'; exit 2`, expect: { exit: 0, json: { a: 1 } } }, cwd, env).why).toMatch(/^exit 2, expected 0/);
    expect(runCheck({ name: "x", run: "no-such-command-aidw", expect: { exit: 0 } }, cwd, env).why).toMatch(/^exit 127/);
    expect(runCheck({ name: "x", run: "echo hello", expect: { exit: 0, matches: "^bye" } }, cwd, env).why).toBe("output does not match /^bye/");
  });
});

// ---------------------------------------------------------------- the stream-json log

describe("level 2 gaps: a malformed stream-json log", () => {
  const ok = { type: "assistant", parent_tool_use_id: null, message: { id: "a", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x" } }] } };

  it("skips a truncated last line, a message with no content, a tool_use with no name, and input that is not an object", () => {
    const text = [
      JSON.stringify(ok),
      JSON.stringify({ type: "assistant", message: null }),
      JSON.stringify({ type: "assistant", message: { id: "b", content: "text, not blocks" } }),
      JSON.stringify({ type: "assistant", message: { id: "c", content: [{ type: "tool_use", input: {} }, { type: "tool_use", name: "Bash", input: "ls" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: 42 }),
      '{"type":"assistant","message":{"id":"d","content":[{"type":"tool_u',
    ].join("\r\n");
    const s = parseStreamLog(text);
    expect(s.calls).toEqual([{ name: "Read", input: { file_path: "/x" } }, { name: "Bash", input: {} }]);
    expect(s.resultSubtype).toBe("success");
    expect(s.finalText).toBe("");
  });

  it("a line that is valid JSON but not an object (null, a number) is skipped, not a crash", () => {
    const text = [JSON.stringify(ok), "null", "42", JSON.stringify({ type: "result", subtype: "success", result: "done" })].join("\n");
    expect(() => parseStreamLog(text)).not.toThrow();
  });

  it("a null content block is skipped, not a crash", () => {
    const text = JSON.stringify({ type: "assistant", message: { id: "a", content: [null, { type: "text", text: "hi" }] } });
    expect(() => parseStreamLog(text)).not.toThrow();
  });

  it("a run whose session log holds a `null` line is graded, and runLevel2 does not throw", () => {
    const s = setup();
    const agent: AgentRunner = (i) => {
      writeFileSync(join(i.cwd, "src", "value.txt"), "new\n");
      writeFileSync(i.logFile, `null\n${JSON.stringify({ type: "assistant", message: { id: "a", content: [{ type: "tool_use", name: "Read", input: { file_path: join(i.cwd, contract) } }] } })}\n`);
      return { exit: 0, timedOut: false, turnLimit: false, turns: 1 };
    };
    expect(() => go(s, agent)).not.toThrow();
  });
});

// ---------------------------------------------------------------- the real runner, with a fake claude

describe("level 2 gaps: the session runner with a fake claude", () => {
  function fakeClaude(body: string[]): string[] {
    const dir = temp("aidw-l2g-claude-");
    const script = join(dir, "claude.mjs");
    writeFileSync(script, ['import { spawn } from "node:child_process";', 'import { readFileSync } from "node:fs";', 'readFileSync(0, "utf8");', ...body, ""].join("\n"));
    chmodSync(script, 0o755);
    return [process.execPath, script];
  }
  const turn = (n: number) => `console.log(JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { id: "m${n}", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x" } }] } }));`;
  const input = (over: Partial<AgentRunInput> = {}): AgentRunInput => {
    const dir = temp("aidw-l2g-session-");
    return { cwd: dir, bare: false, pluginRoot: "/p/aidw", agent: "aidw:backend", settingsFile: join(dir, "s.json"), prompt: "Task brief: b.md. Read it and implement the task.", logFile: join(dir, "log.jsonl"), timeoutMs: 20_000, maxTurns: 10, ...over };
  };

  it("a crash (exit 3, stderr) is the exit and the stderr tail, with the log kept up to the crash", () => {
    const i = input();
    const r = claudeAgentRunner(fakeClaude([turn(0), 'process.stderr.write("TypeError: boom\\n");', "process.exit(3);"]))(i);
    expect(r).toMatchObject({ exit: 3, timedOut: false, turnLimit: false, turns: 1, error: "TypeError: boom" });
    expect(parseStreamLog(readFileSync(i.logFile, "utf8")).calls).toHaveLength(1);
  });

  it("a session killed by a signal it was not sent is exit null, neither timed out nor at the turn limit", () => {
    const r = claudeAgentRunner(fakeClaude([turn(0), 'process.kill(process.pid, "SIGKILL");']))(input());
    expect(r).toMatchObject({ exit: null, timedOut: false, turnLimit: false, turns: 1 });
  });

  it("a session that ignores SIGTERM is killed with SIGKILL after the grace period", () => {
    const t0 = Date.now();
    const r = claudeAgentRunner(fakeClaude(['process.on("SIGTERM", () => {});', turn(0), "setInterval(() => {}, 1000);"]))(input({ timeoutMs: 500 }));
    const took = Date.now() - t0;
    expect(r).toMatchObject({ timedOut: true, exit: null });
    expect(took).toBeGreaterThanOrEqual(5000);
    expect(took).toBeLessThan(12_000);
  }, 30_000);

  it("a background process the session left holding stdout does not keep the run past the time limit", () => {
    // The session starts a long command that inherits its stdout (as `cmd &` in a Bash tool call would), then hangs.
    const t0 = Date.now();
    const r = claudeAgentRunner(fakeClaude(['spawn("sleep", ["10"], { stdio: ["ignore", "inherit", "inherit"] });', turn(0), "setInterval(() => {}, 1000);"]))(input({ timeoutMs: 500 }));
    const took = Date.now() - t0;
    expect(r.timedOut).toBe(true);
    expect(took).toBeLessThan(9000); // the limit (0.5 s) plus the SIGKILL grace (5 s), not the 10 s of the orphan
  }, 40_000);

  it("bare: no --plugin-dir, no --agent, and the plugin's bin is not put on PATH", () => {
    const i = input({ bare: true, model: "haiku" });
    const r = claudeAgentRunner(fakeClaude(["console.log(JSON.stringify({ type: \"system\", args: process.argv.slice(2), path: process.env.PATH }));"]), { ...process.env, PATH: "/usr/bin:/bin" })(i);
    expect(r.exit).toBe(0);
    const first = JSON.parse(readFileSync(i.logFile, "utf8").split("\n")[0]!);
    expect(first.args).toEqual(agentArgs(i));
    expect(first.args).not.toContain("--plugin-dir");
    expect(first.args).not.toContain("--agent");
    expect(first.args.slice(-2)).toEqual(["--model", "haiku"]);
    expect(first.path).toBe("/usr/bin:/bin");
  });

  it("does not leak its watcher config into the session's environment", () => {
    const i = input();
    claudeAgentRunner(fakeClaude(['console.log(JSON.stringify({ type: "system", watch: process.env.AIDW_L2_WATCH ?? null }));']))(i);
    expect(JSON.parse(readFileSync(i.logFile, "utf8").split("\n")[0]!).watch).toBeNull();
  });

  it("through runLevel2: a crash after tool calls is a FAIL of the agent step; a crash with no output is an ERROR", () => {
    const s = setup();
    const crashLate = claudeAgentRunner(
      fakeClaude([`console.log(JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { id: "m0", content: [{ type: "tool_use", name: "Read", input: { file_path: process.cwd() + "/${contract}" } }] } }));`, 'process.stderr.write("panic\\n");', "process.exit(3);"]),
    );
    const [late] = go(s, crashLate);
    expect(late!.results[0]!.error).toBeUndefined();
    expect(late!.results[0]!.steps[0]).toMatchObject({ step: "agent", pass: false, failed: ["the session ended with exit 3"] });
    expect(late!.pass).toBe(false);
    const [early] = go(s, claudeAgentRunner(fakeClaude(['process.stderr.write("cannot load config\\n");', "process.exit(1);"])));
    expect(early!.results[0]!.error).toBe("the session did not run: cannot load config");
    expect(early!.runs).toEqual({ total: 1, passed: 0, errors: 1 });
  });
});

// ---------------------------------------------------------------- the run folder and safety

describe("level 2 gaps: the run folder", () => {
  it("keeps each run in its own folder under runsDir, with result.json as returned, and never touches the fixture", () => {
    const s = setup();
    const before = fixtureDigest(join(s.fixtures, "tiny-app"));
    const [r] = go(s, fakeAgent({ value: "new", also: (i) => put(i.cwd, "src/added.txt", "x") }), { runs: 2 });
    const dirs = r!.results.map((x) => x.dir);
    expect(new Set(dirs).size).toBe(2);
    expect(readdirSync(s.runsDir).sort()).toEqual(dirs.map((d) => d.slice(s.runsDir.length + 1)).sort());
    for (const x of r!.results) {
      expect(existsSync(join(x.dir, "project", "src", "added.txt"))).toBe(true);
      const saved = JSON.parse(readFileSync(join(x.dir, "result.json"), "utf8"));
      expect(saved).toMatchObject({ case: "tiny", bare: false, pass: x.pass, steps: x.steps, dir: x.dir });
      expect(lstatSync(join(x.dir, "project", "node_modules", "marker")).isSymbolicLink()).toBe(true); // links into the cache
    }
    expect(fixtureDigest(join(s.fixtures, "tiny-app"))).toBe(before);
    expect(existsSync(join(s.fixtures, "tiny-app", "src", "added.txt"))).toBe(false);
  });

  it("a copy that cannot be prepared (a task not in the Change) is an ERROR kept on disk, and no session runs", () => {
    const s = setup();
    put(s.root, `${L2}/tiny/case.md`, caseMd("tiny").replace("task: T01", "task: T99"));
    let ran = 0;
    const [r] = go(s, (i) => (ran++, fakeAgent()(i)));
    expect(ran).toBe(0);
    expect(r!.results[0]!.error).toMatch(/^the copy could not be prepared/);
    expect(JSON.parse(readFileSync(join(r!.results[0]!.dir, "result.json"), "utf8")).error).toMatch(/could not be prepared/);
  });

  it("the diff for the grader leaves out .aidw/changes and the held-out files, and lists new files", () => {
    const s = setup();
    const prompts: string[] = [];
    const [r] = go(s, fakeAgent({ value: "new", also: (i) => put(i.cwd, "src/new-file.txt", "brand new\n") }), { exec: grader(true, prompts) });
    const diff = readFileSync(join(r!.results[0]!.dir, "diff.patch"), "utf8");
    expect(diff).toMatch(/src\/new-file\.txt/);
    expect(diff).not.toMatch(/\.aidw\/changes/);
    expect(diff).not.toMatch(/value\.test\.mjs/);
    expect(prompts[0]).toMatch(/brand new/);
  });

  it("a planted file at a held-out path is overwritten by the held-out test before it runs", () => {
    const s = setup();
    const [r] = go(s, fakeAgent({ value: "wrong", also: (i) => put(i.cwd, "tests/value.test.mjs", 'console.log("  ✓ the value is new");\n') }));
    expect(r!.results[0]!.steps.find((x) => x.step === "tests")).toMatchObject({ pass: false, failed: ["the value is new"] });
  });

  it("the held-out files are never written outside the run folder through a symlink the session made", () => {
    const s = setup();
    const outside = temp("aidw-l2g-outside-");
    const [r] = go(s, fakeAgent({ value: "new", also: (i) => symlinkSync(outside, join(i.cwd, "tests"), "dir") }));
    expect(r).toBeDefined();
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses must_read paths that climb out with .., also behind plugin: or ./", () => {
    const root = pluginWithCases(["tiny"]);
    put(root, `${L2}/tiny/case.md`, caseMd("tiny").replace(`must_read: [${JSON.stringify(contract)}]`, 'must_read: ["plugin:../../etc/passwd", "./a/../../b", "ok/file.md"]\nmust_not_read: ["/abs"]'));
    const e = loadLevel2Cases(root, "backend").diags.errors.map((x) => x.message);
    expect(e.filter((m) => /a path relative to the project/.test(m))).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- digests

describe("level 2 gaps: digests", () => {
  it("level 2 changes leave level 1's roleDigest (old format) unchanged too", () => {
    const s = setup();
    const before = roleDigest(s.root, "backend");
    put(s.root, `${L2}/tiny/checks.yaml`, "checks: []\n");
    put(s.root, `${L2}/new-case/case.md`, caseMd("new-case"));
    expect(roleDigest(s.root, "backend")).toBe(before);
  });

  it("a case digest follows checks.yaml and held-out files, not .DS_Store; a fixture digest ignores node_modules and .cache, not .aidw", () => {
    const s = setup();
    const c = loadLevel2Cases(s.root, "backend").cases[0]!;
    const d0 = level2CaseDigest(s.root, c);
    put(s.root, `${L2}/tiny/.DS_Store`, "x");
    put(s.root, `${L2}/tiny/held-out/.DS_Store`, "x");
    expect(level2CaseDigest(s.root, c)).toBe(d0);
    put(s.root, `${L2}/tiny/checks.yaml`, "checks: []\n");
    expect(level2CaseDigest(s.root, c)).not.toBe(d0);
    const fx = join(s.fixtures, "tiny-app");
    const f0 = fixtureDigest(fx);
    put(fx, "node_modules/x/index.js", "1");
    put(fx, ".cache/y", "1");
    expect(fixtureDigest(fx)).toBe(f0);
    put(fx, ".aidw/changes/create-task/notes.md", "x");
    expect(fixtureDigest(fx)).not.toBe(f0);
  });

  it("takeLevel2Digests gives a missing fixture null, and roster then does not check it", () => {
    const s = setup();
    const d = takeLevel2Digests(s.root, "backend", { ...s.env, AIDW_FIXTURES_DIR: temp("aidw-l2g-nofx-") });
    expect(d.cases.get("tiny")).toMatchObject({ fixture: null });
    expect(d.shared).toBe(sharedDigest(s.root, "backend"));
  });
});

// ---------------------------------------------------------------- results and merging

describe("level 2 gaps: writing and merging results", () => {
  it("refuses to write when the case folder or the fixture changed during the run", () => {
    const s = gitSetup();
    const touchCase = fakeAgent({ value: "new", also: () => put(s.root, `${L2}/tiny/held-out/tests/late.txt`, "x") });
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: touchCase }).err).toMatch(/the Role or a case changed during the run/);
    rmSync(join(s.root, `${L2}/tiny/held-out/tests/late.txt`));
    const touchFx = fakeAgent({ value: "new", also: () => put(join(s.fixtures, "tiny-app"), "src/late.txt", "x") });
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: touchFx }).err).toMatch(/changed during the run/);
    expect(existsSync(level2ResultsFile(s.root, "backend"))).toBe(false);
  });

  it("a --case run replaces only its case and keeps the others; a removed case is dropped", () => {
    const s = gitSetup(["one", "two"]);
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1"]).code).toBe(0);
    const first = readRec(s);
    expect(first.cases.map((c: { name: string }) => c.name)).toEqual(["one", "two"]);
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--case", "two"], { agent: fakeAgent({ value: "wrong" }) }).code).toBe(1);
    const merged = readRec(s);
    expect(merged.cases[0]).toEqual(first.cases[0]);
    expect(merged.cases[1]).toMatchObject({ name: "two", pass: false });
    rmSync(join(s.root, L2, "two"), { recursive: true });
    cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--case", "one"]);
    expect(readRec(s).cases.map((c: { name: string }) => c.name)).toEqual(["one"]);
  });

  it("a --case merge refuses a file of another model, an unreadable file and a level 1 file", () => {
    const s = gitSetup();
    cli(s, ["eval", "backend", "--level", "2", "--runs", "1"]);
    const f = level2ResultsFile(s.root, "backend");
    const rec = readRec(s);
    writeFileSync(f, JSON.stringify({ ...rec, model: "haiku" }));
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--case", "tiny"]).err).toMatch(/made with model haiku, this run with default/);
    writeFileSync(f, "{ not json");
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--case", "tiny"]).err).toMatch(/level 2 results\.json is not readable/);
    writeFileSync(f, JSON.stringify({ ...rec, level: 1 }));
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--case", "tiny"]).err).toMatch(/is not a level 2 file of format/);
  });

  it("records an error for a case whose every run erred, beside a graded one, and runs as the smallest total", () => {
    const s = gitSetup(["one", "two"]);
    const agent: AgentRunner = (i) => (i.cwd.includes("-two-") ? fakeAgent({ writeLog: false, out: { exit: null, error: "spawn claude ENOENT" } })(i) : fakeAgent({ value: "new" })(i));
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "2"], { agent }).code).toBe(1);
    const rec = readRec(s);
    expect(rec.runs).toBe(2);
    expect(rec.cases[0]).toMatchObject({ name: "one", pass: true });
    expect(rec.cases[0].error).toBeUndefined();
    expect(rec.cases[1]).toMatchObject({ name: "two", pass: false, runs: { total: 2, passed: 0, errors: 2 }, error: "the session did not run: spawn claude ENOENT" });
  });

  it("mergeLevel2Results ignores bare results and results of another Role", () => {
    const s = gitSetup();
    cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: fakeAgent({ value: "wrong" }) });
    const digests = takeLevel2Digests(s.root, "backend", s.env);
    const bare = go(s, fakeAgent({ value: "new" }), { bare: true });
    const m = mergeLevel2Results(s.root, "backend", [...bare, { ...bare[0]!, bare: false, role: "frontend" }], { digests, env: s.env });
    expect("file" in m).toBe(true);
    expect(readRec(s).cases[0]).toMatchObject({ name: "tiny", pass: false });
  });
});

// ---------------------------------------------------------------- --model and tiers

describe("level 2 gaps: --model and the tier's model", () => {
  const tiers = "claude-code:\n  deep: opus\n  standard: sonnet\n  fast: haiku\n";

  it("a tier with a model: the session and the grader get it, and the record names it", () => {
    const s = gitSetup(["tiny"], { tiers });
    const seen: AgentRunInput[] = [];
    const models: (string | undefined)[] = [];
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: fakeAgent({ value: "new", seen }), models }).code).toBe(0);
    expect(seen[0]!.model).toBe("opus");
    expect(models).toEqual(["opus"]);
    expect(readRec(s)).toMatchObject({ model: "opus", tier: "deep" });
  });

  it("--model of the tier's own model writes; another model runs but writes nothing", () => {
    const s = gitSetup(["tiny"], { tiers });
    const seen: AgentRunInput[] = [];
    const other = cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--model", "sonnet"], { agent: fakeAgent({ value: "new", seen }) });
    expect(seen[0]!.model).toBe("sonnet");
    expect(other.err).toMatch(/--model sonnet is not its tier's model \(opus\)/);
    expect(existsSync(level2ResultsFile(s.root, "backend"))).toBe(false);
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--model", "opus"]).out).toMatch(/wrote roles\/backend\/evals\/level2\/results\.json/);
  });

  it("an inherit tier: no --model reaches the session, and --model runs with it but writes nothing", () => {
    const s = gitSetup();
    const seen: AgentRunInput[] = [];
    cli(s, ["eval", "backend", "--level", "2", "--runs", "1"], { agent: fakeAgent({ value: "new", seen }) });
    expect(seen[0]!.model).toBeUndefined();
    rmSync(level2ResultsFile(s.root, "backend"));
    const r = cli(s, ["eval", "backend", "--level", "2", "--runs", "1", "--model", "sonnet"], { agent: fakeAgent({ value: "new", seen }) });
    expect(seen[1]!.model).toBe("sonnet");
    expect(r.err).toMatch(/tier uses the session's model/);
    expect(existsSync(level2ResultsFile(s.root, "backend"))).toBe(false);
  });

  it("refuses --runs out of range and an unknown Role", () => {
    const s = gitSetup();
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "0"]).err).toMatch(/--runs takes a whole number from 1 to 10/);
    expect(cli(s, ["eval", "backend", "--level", "2", "--runs", "11"]).err).toMatch(/--runs takes/);
    expect(cli(s, ["eval", "nobody", "--level", "2"]).err).toMatch(/"nobody" is not a Role in roster\.yaml/);
  });
});

// ---------------------------------------------------------------- roster

describe("level 2 gaps: roster warnings", () => {
  const roster = (s: S) => {
    let out = "";
    const code = run(["roster"], { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), { out: (x) => (out += x), err: (x) => (out += x) });
    // graded with AIDW_GRADE_SANDBOX=off on purpose: that warning is tested in level2.test.ts
    return { code, lines: out.split("\n").filter((l) => l.includes("level2/results.json") && !/graded with no sandbox/.test(l)) };
  };

  it("warns on an unreadable file, a level 1 file, another model, fewer than 3 runs and a case with no entry, never failing", () => {
    const s = gitSetup(["tiny"]);
    cli(s, ["eval", "backend", "--level", "2", "--runs", "1"]);
    let r = roster(s);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([expect.stringMatching(/1 level 2 case\(s\) last ran fewer than 3 times: tiny/)]);
    const f = level2ResultsFile(s.root, "backend");
    const rec = readRec(s);
    writeFileSync(f, JSON.stringify({ ...rec, cases: rec.cases.map((c: object) => ({ ...c, runs: { total: 3, passed: 3, errors: 0 } })) }));
    expect(roster(s).lines).toEqual([]);
    const good = readFileSync(f, "utf8");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(good), model: "haiku" }));
    expect(roster(s).lines).toEqual([expect.stringMatching(/WARN .*made with model haiku, not its tier's model \(default\)/)]);
    writeFileSync(f, "{");
    expect(roster(s).lines).toEqual([expect.stringMatching(/not readable/)]);
    writeFileSync(f, JSON.stringify({ ...JSON.parse(good), level: 1 }));
    expect(roster(s).lines).toEqual([expect.stringMatching(/not a level 2 result file/)]);
    writeFileSync(f, good);
    put(s.root, `${L2}/second/case.md`, caseMd("second"));
    put(s.root, `${L2}/second/held-out/tests/value.test.mjs`, heldOutTest);
    r = roster(s);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([expect.stringMatching(/no level 2 result for case\(s\): second/)]);
  });

  it("errors (exit 1) on a malformed level 2 case", () => {
    const s = setup(["tiny"], { checks: "checks: nope\n" });
    const r = run(["roster"], { ...s.env, AIDW_PLUGIN_ROOT: s.root }, process.cwd(), { out: () => undefined, err: () => undefined });
    expect(r).toBe(1);
  });
});
