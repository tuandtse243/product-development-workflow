import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Exec } from "../src/evalrun.js";
import {
  copyPluginForSession,
  gradingEnv,
  gradingSandbox,
  killLeftovers,
  removeTree,
  runCheck,
  runLevel2,
  trimmedEnv,
  type AgentRunInput,
  type AgentRunner,
  type Installer,
} from "../src/evallevel2.js";

/**
 * The re-review findings of T18 (N1 to N5, L1 to L3): the base is the harness's own snapshot, the session's .git and the
 * source checkout are out of reach, and the grading commands are confined. No model is reached.
 */
vi.setConfig({ testTimeout: 120_000 });
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const realFixture = join(repo, "evals", "fixtures", "backend-api");
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
const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "-c", "core.hooksPath=/dev/null", ...a], { cwd, encoding: "utf8" });

/** A plugin copy in a git repository of its own (as a source checkout is), with case `tiny` on a tiny fixture. */
function setup() {
  const root = temp("aidw-l2r-plugin-");
  cpSync(plugin, root, { recursive: true, filter: (src) => !src.startsWith(join(plugin, "bin")) });
  removeTree(join(root, L2));
  put(root, `${L2}/tiny/case.md`, ["---", "case: tiny", "covers: [B3]", "fixture: tiny-app", "task: T01", `must_read: [${JSON.stringify(contract)}]`, "---", "## Criteria", "", "- must say what it changed", ""].join("\n"));
  put(root, `${L2}/tiny/held-out/tests/value.test.mjs`, 'import { readFileSync } from "node:fs";\nif (readFileSync("src/value.txt", "utf8").trim() !== "new") { console.log("  × the value is new"); process.exit(1); }\nconsole.log("  ✓ the value is new");\n');
  execFileSync("git", ["init", "-q"], { cwd: root });
  const fixtures = temp("aidw-l2r-fixtures-");
  const fx = join(fixtures, "tiny-app");
  cpSync(join(realFixture, ".aidw"), join(fx, ".aidw"), { recursive: true });
  // only the pilot's Change: a case of the tiny fixture names none
  for (const id of readdirSync(join(fx, ".aidw", "changes"))) if (id !== "create-task" && id !== ".gitkeep") rmSync(join(fx, ".aidw", "changes", id), { recursive: true });
  put(fx, "package.json", JSON.stringify({ name: "tiny-app", private: true, scripts: { test: "node run-tests.mjs" } }));
  put(fx, "package-lock.json", JSON.stringify({ name: "tiny-app", lockfileVersion: 3, packages: {} }));
  put(fx, ".gitignore", "node_modules\n");
  put(fx, "src/value.txt", "old\n");
  put(fx, "run-tests.mjs", 'import { spawnSync } from "node:child_process";\nlet bad = 0;\nfor (const f of process.argv.slice(2)) { const r = spawnSync(process.execPath, [f], { encoding: "utf8" }); process.stdout.write(r.stdout); if (r.status !== 0) bad++; }\nprocess.exit(bad ? 1 : 0);\n');
  const env = { ...process.env, AIDW_FIXTURES_DIR: fixtures, AIDW_FIXTURE_CACHE: temp("aidw-l2r-cache-"), AIDW_GRADE_SANDBOX: "off" };
  const install: Installer = (dir) => put(dir, "node_modules/marker", "x");
  return { root, fixtures, env, install, runsDir: temp("aidw-l2r-runs-") };
}
type S = ReturnType<typeof setup>;

function agent(o: { value?: string; calls?: (i: AgentRunInput) => { name: string; input: Record<string, unknown> }[]; also?: (i: AgentRunInput) => void } = {}): AgentRunner {
  return (i) => {
    if (o.value !== undefined) writeFileSync(join(i.cwd, "src", "value.txt"), `${o.value}\n`);
    o.also?.(i);
    const calls = o.calls ? o.calls(i) : [{ name: "Read", input: { file_path: join(i.cwd, contract) } }];
    const lines = [...calls.map((c, n) => ({ type: "assistant", parent_tool_use_id: null, message: { id: `m${n}`, content: [{ type: "tool_use", name: c.name, input: c.input }] } })), { type: "result", subtype: "success", result: "done" }];
    writeFileSync(i.logFile, lines.map((l) => JSON.stringify(l)).join("\n"));
    return { exit: 0, timedOut: false, turnLimit: false, turns: calls.length };
  };
}
const grader: Exec = (prompt) => JSON.stringify(Array.from({ length: (prompt.match(/^\d+\. /gm) ?? []).length }, (_, k) => ({ n: k + 1, pass: true, reason: "ok" })));
const go = (s: S, a: AgentRunner) => runLevel2({ root: s.root, role: "backend", runs: 1, agent: a, exec: grader, install: s.install, env: s.env, runsDir: s.runsDir })[0]!.results[0]!;
const runFile = (r: { dir: string }, f: string) => readFileSync(join(r.dir, f), "utf8");

describe("N1: the base is the harness's own snapshot", () => {
  it("git replace and an overwritten object in the session's .git change neither the restore nor changed.txt", () => {
    const s = setup();
    const also = (i: AgentRunInput) => {
      const base = g(i.cwd, "rev-parse", "HEAD").trim();
      const blob = g(i.cwd, "rev-parse", `${base}:package.json`).trim();
      writeFileSync(join(i.cwd, "package.json"), JSON.stringify({ name: "tiny-app", scripts: { test: "exit 0" } }));
      g(i.cwd, "add", "-A");
      g(i.cwd, "commit", "-qm", "evil");
      const evil = g(i.cwd, "rev-parse", "HEAD").trim();
      g(i.cwd, "replace", "-f", base, evil);
      // the base's package.json blob made to hold the session's version
      const evilBlob = g(i.cwd, "rev-parse", `${evil}:package.json`).trim();
      const obj = (h: string) => join(i.cwd, ".git", "objects", h.slice(0, 2), h.slice(2));
      chmodSync(obj(blob), 0o644);
      cpSync(obj(evilBlob), obj(blob));
      expect(g(i.cwd, "show", `${base}:package.json`)).toMatch(/exit 0/); // the session's git is fooled
    };
    const r = go(s, agent({ value: "wrong", also }));
    expect(r.error).toBeUndefined();
    expect(r.steps.find((x) => x.step === "tests")).toMatchObject({ pass: false, failed: ["the value is new"] }); // package.json restored from the snapshot
    expect(runFile(r, "changed.txt").split("\n")).toEqual(expect.arrayContaining(["package.json", "src/value.txt"]));
    expect(runFile(r, "diff.patch")).toMatch(/\+.*exit 0/);
  });

  it("a snapshot changed during the session makes the run an ERROR", () => {
    const s = setup();
    const also = (i: AgentRunInput) => {
      const head = join(dirname(i.cwd), "base.git", "HEAD");
      chmodSync(dirname(head), 0o755);
      chmodSync(head, 0o644);
      writeFileSync(head, "ref: refs/heads/evil\n");
    };
    const r = go(s, agent({ value: "new", also }));
    expect(r.error).toMatch(/the snapshot of the base changed during the session/);
  });

  it("the settings keep the run folder's own files from the session: no read, edit or write", () => {
    const s = setup();
    let seen: AgentRunInput | undefined;
    go(s, (i) => ((seen = i), agent({ value: "new" })(i)));
    const dir = dirname(seen!.cwd);
    const deny: string[] = JSON.parse(readFileSync(seen!.settingsFile, "utf8")).permissions.deny;
    for (const f of [`${dir}/base.git/**`, `${dir}/settings.json`, `${dir}/prompt.txt`, `${dir}/session.jsonl`]) for (const t of ["Read", "Edit", "Write"]) expect(deny).toContain(`${t}(/${f})`);
    expect(deny).toEqual(expect.arrayContaining([`Edit(/${seen!.pluginRoot}/**)`, `Write(/${seen!.pluginRoot}/**)`]));
  });
});

describe("N2: the session's exclude and attributes rules are not read", () => {
  it("a file excluded in .git/info/exclude or .gitignore, and a -diff attribute, hide nothing", () => {
    const s = setup();
    const also = (i: AgentRunInput) => {
      put(i.cwd, ".git/info/exclude", "secret/\n");
      put(i.cwd, ".git/info/attributes", "* -diff\n");
      put(i.cwd, ".gitattributes", "* -diff\n");
      put(i.cwd, "secret/x.txt", "hidden\n");
    };
    const r = go(s, agent({ value: "new", also }));
    expect(runFile(r, "changed.txt").split("\n")).toEqual(expect.arrayContaining([".gitattributes", "secret/x.txt", "src/value.txt"]));
    const diff = runFile(r, "diff.patch");
    expect(diff).toMatch(/\+hidden/);
    expect(diff).toMatch(/-old\n\+new/);
    expect(diff).not.toMatch(/Binary files/);
  });
});

describe("N3: the source checkout is out of reach", () => {
  it("denies reads of the repo and its git dir, and flags a command that names them", () => {
    const s = setup();
    let seen: AgentRunInput | undefined;
    const calls = (i: AgentRunInput) => [
      { name: "Read", input: { file_path: join(i.cwd, contract) } },
      { name: "Bash", input: { command: `git -C ${s.root} show HEAD:${L2}/tiny/held-out/tests/value.test.mjs` } },
    ];
    const r = go(s, (i) => ((seen = i), agent({ value: "new", calls })(i)));
    const top = realpathSync(s.root);
    const deny: string[] = JSON.parse(readFileSync(seen!.settingsFile, "utf8")).permissions.deny;
    expect(deny).toEqual(expect.arrayContaining([`Read(/${top}/**)`, `Read(/${join(top, ".git")}/**)`]));
    const reads = r.steps.find((x) => x.step === "reads")!;
    expect(reads.pass).toBe(false);
    expect(reads.failed).toEqual(expect.arrayContaining([`named ${top}, which it must not`]));
  });
});

describe("N4, L2: what the grading commands get", () => {
  it("the grading environment has no keys or proxies; the session keeps its config dir and certificates", () => {
    const env = { PATH: "/bin", HOME: "/h", HTTPS_PROXY: "p", AWS_SECRET_ACCESS_KEY: "a", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_CONFIG_DIR: "/c", NODE_EXTRA_CA_CERTS: "/ca", SSL_CERT_FILE: "/s" };
    expect(gradingEnv(env)).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(trimmedEnv(env)).toEqual(env);
  });

  const scopeDirs = () => {
    const run = temp("aidw-l2r-scope-");
    for (const d of ["project", "scratch", "base.git"]) mkdirSync(join(run, d));
    return { run, project: join(run, "project"), scratch: join(run, "scratch"), snapshot: join(run, "base.git") };
  };
  const probe = gradingSandbox(process.env);
  // Only where the sandbox can be applied (not inside another sandbox, as in a Claude Code session).
  it.skipIf(probe.how === "none")("writes only in the project and its scratch folder, and reaches no Unix socket", () => {
    const sc = scopeDirs();
    const sb = gradingSandbox(process.env, { project: sc.project, scratch: sc.scratch });
    const home = join(process.env.HOME as string, `.aidw-l2r-${process.pid}`);
    const outside = temp("aidw-l2r-outside-");
    const ok = (run: string) => runCheck({ name: "x", run, expect: { exit: 0 } }, sc.project, gradingEnv(process.env), sb);
    expect(ok("echo a > inside.txt")).toEqual({ pass: true, why: "" });
    expect(ok(`echo a > ${join(sc.scratch, "out.json")}`)).toEqual({ pass: true, why: "" });
    expect(ok(`echo a > ${join(sc.run, "changed.txt")}`).pass).toBe(false); // the run folder
    expect(ok(`echo a > ${join(sc.snapshot, "HEAD")}`).pass).toBe(false);
    expect(ok(`echo a > ${join(outside, "x")}`).pass).toBe(false); // the temp dir
    expect(ok(`echo a > ${home}`).pass).toBe(false);
    expect(existsSync(home)).toBe(false);
    const unix = 'node -e \'require("net").connect("/var/run/syslog").on("connect",()=>process.exit(0)).on("error",()=>process.exit(7))\'';
    expect(runCheck({ name: "unix", run: unix, expect: { exit: 7 } }, sc.project, gradingEnv(process.env), sb)).toEqual({ pass: true, why: "" });
  });
});

describe("N6: code the session wrote cannot rewrite what the grading reads", () => {
  it("a module that rewrites the changed list, the index and the diff when imported changes nothing, and B15 still catches its edit", () => {
    const s = setup();
    // The held-out test imports the session's module, as a real held-out test imports the session's route.
    put(s.root, `${L2}/tiny/held-out/tests/value.test.mjs`, [
      'import { readFileSync } from "node:fs";',
      'await import("../src/mod.mjs");',
      'if (readFileSync("src/value.txt", "utf8").trim() !== "new") { console.log("  × the value is new"); process.exit(1); }',
      'console.log("  ✓ the value is new");',
      "",
    ].join("\n"));
    put(s.root, `${L2}/tiny/checks.yaml`, [
      "checks:",
      "  - name: nothing outside src/ changed",
      "    run: >-",
      "      out=$(grep -v '^src/' \"$AIDW_CHANGED\" | grep -v '^\\.aidw/' | grep -v '^$'); test -z \"$out\" || { echo \"$out\"; exit 1; }",
      "  - name: git through the snapshot sees the edit outside src/",
      '    run: git diff --name-only "$AIDW_BASE"; git ls-files --others --exclude-standard',
      "    expect: { matches: \"^outside\\\\.txt$\" }",
      "",
    ].join("\n"));
    const also = (i: AgentRunInput) => {
      put(i.cwd, "outside.txt", "an edit outside src/\n");
      // what the module does when imported: rewrite every record it can find beside the project
      put(i.cwd, "src/mod.mjs", [
        'import { readdirSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'const run = join(process.cwd(), "..");',
        "const hit = (f, text) => { try { writeFileSync(f, text); } catch {} };",
        'for (const v of ["AIDW_CHANGED", "GIT_INDEX_FILE"]) if (process.env[v]) hit(process.env[v], "");',
        'hit(join(run, "changed.txt"), "");',
        'hit(join(run, "grade.index"), "garbage");',
        'hit(join(run, "diff.patch"), "nothing changed");',
        'for (const n of readdirSync(run)) if (n.startsWith("inputs-")) hit(join(run, n, "changed.txt"), "");',
        "",
      ].join("\n"));
    };
    const r = go(s, agent({ value: "new", also }));
    expect(r.error).toBeUndefined();
    expect(r.steps.find((x) => x.step === "tests")!.pass).toBe(true);
    const checks = r.steps.find((x) => x.step === "checks")!;
    expect(checks.failed).toEqual([expect.stringMatching(/^nothing outside src\/ changed: exit 1, expected 0: outside\.txt/)]);
    expect(runFile(r, "changed.txt").split("\n")).toEqual(expect.arrayContaining(["outside.txt", "src/mod.mjs", "src/value.txt"]));
    expect(runFile(r, "diff.patch")).toMatch(/\+an edit outside src\//);
    expect(r.pass).toBe(false);
  });

  it("the checks see none of the held-out files", () => {
    const s = setup();
    put(s.root, `${L2}/tiny/checks.yaml`, "checks:\n  - name: no held-out file\n    run: test ! -e tests/value.test.mjs\n");
    const r = go(s, agent({ value: "new" }));
    expect(r.steps.find((x) => x.step === "tests")!.pass).toBe(true);
    expect(r.steps.find((x) => x.step === "checks")).toMatchObject({ pass: true, failed: [] });
  });
});

describe("L1: leftovers of the session", () => {
  it.skipIf(!existsSync("/usr/sbin/lsof"))("kills a process still working in the copy after the session", async () => {
    const dir = temp("aidw-l2r-left-");
    const child = spawn("sleep", ["30"], { cwd: dir, detached: true, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 300));
    const killed = killLeftovers(dir);
    if (!killed.length) {
      child.kill("SIGKILL"); // lsof could not see it here (a sandbox hides other processes): nothing to prove
      return;
    }
    expect(killed).toContain(child.pid);
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(child.pid as number, 0)).toThrow();
  });
});

describe("L3: the session's plugin copy", () => {
  it("holds the files a symlink points to, never the link", () => {
    const src = temp("aidw-l2r-psrc-");
    const target = temp("aidw-l2r-ptarget-");
    put(target, "secret.md", "from outside\n");
    put(src, "roles/backend/role.md", "role\n");
    put(src, "roles/backend/evals/x.md", "case\n");
    symlinkSync(join(target, "secret.md"), join(src, "link.md"));
    const into = join(temp("aidw-l2r-pinto-"), "plugin");
    copyPluginForSession(src, into);
    expect(readFileSync(join(into, "link.md"), "utf8")).toBe("from outside\n");
    expect(execFileSync("sh", ["-c", `test -L ${join(into, "link.md")} && echo link || echo file`], { encoding: "utf8" }).trim()).toBe("file");
    expect(existsSync(join(into, "roles/backend/evals"))).toBe(false);
  });
});
