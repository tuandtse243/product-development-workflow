import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { caseEntries, digestOf, RESULTS_FORMAT, sharedDigest, type CaseRecord, type RunRecord } from "./evals.js";
import { parseGrade, type CriterionResult, type Exec } from "./evalrun.js";
import { pathsFor } from "./project.js";
import { loadRole, loadRuleTable, roleDir } from "./roles.js";
import { buildBrief, startTask } from "./run.js";

/**
 * Level 2 Role cases (plan C4, docs/factory-architecture.md section 11): a real task with tools. A case names a fixture
 * repo (`evals/fixtures/<name>`) and a task of the aidw Change inside it. Each run copies the fixture to a fresh temp
 * dir, links its cached packages, builds the task's brief with the CLI's own code (`aidw task start`), and runs one
 * Agent session of the Role on it (`claude -p`, no network). Then, in order: the held-out tests are copied in and run
 * (1), the case's checks run (2), the tool log is read for what the Agent read (3), and a model grades only the
 * criteria left (4). A run passes only when all four pass; a case passes with every run (3 of 3 by default).
 *
 *   roles/<id>/evals/level2/<case>/case.md      front matter + "## Criteria"
 *   roles/<id>/evals/level2/<case>/checks.yaml  optional machine checks
 *   roles/<id>/evals/level2/<case>/held-out/    files laid over the copy after the run, at the same relative path
 *   roles/<id>/evals/level2/results.json        the record of the last runs (C6)
 *
 * The Agent session and the grader are injected (AgentRunner, Exec), so tests never reach a model.
 */

export const LEVEL2_DIR = "level2";
export const DEFAULT_TIMEOUT_MIN = 25;
export const DEFAULT_MAX_TURNS = 60;

export interface Level2Check {
  name: string;
  run: string;
  expect: { exit: number; json?: unknown; matches?: string };
}

export interface Level2Case {
  name: string;
  /** plugin-relative case dir, `roles/<id>/evals/level2/<case>` */
  dir: string;
  covers: string[];
  fixture: string;
  task: string;
  /** the Change in the fixture; absent: its only one */
  change?: string;
  /** `plugin:<plugin-relative path>` or a path relative to the project */
  mustRead: string[];
  mustNotRead: string[];
  timeoutMin: number;
  maxTurns: number;
  checks: Level2Check[];
  criteria: string[];
  /** files under held-out/, relative to it (= their path in the project) */
  heldOut: string[];
}

const CASE_KEYS = ["case", "covers", "fixture", "task", "change", "must_read", "must_not_read", "timeout_min", "max_turns"];
const KEBAB = /^[a-z0-9-]+$/;

export const level2Dir = (root: string, id: string) => join(roleDir(root, id), "evals", LEVEL2_DIR);
export const level2ResultsFile = (root: string, id: string) => join(level2Dir(root, id), "results.json");

/** Every file under `dir` (relative to it), sorted; dotfiles are kept, `skip` names are left out at any depth. */
function filesUnder(dir: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = rel ? join(dir, rel) : dir;
    for (const n of readdirSync(abs).sort()) {
      if (skip.includes(n)) continue;
      const r = rel ? `${rel}/${n}` : n;
      const st = lstatSync(join(abs, n));
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push(r);
    }
  };
  if (existsSync(dir)) walk("");
  return out;
}

const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");

function parseChecks(text: string, file: string, d: Diags): Level2Check[] {
  let v: unknown;
  try {
    v = YAML.parse(text);
  } catch (e) {
    d.error(file, `not YAML: ${(e as Error).message.split("\n")[0]}`);
    return [];
  }
  const list = v && typeof v === "object" && !Array.isArray(v) ? (v as { checks?: unknown }).checks : undefined;
  if (!Array.isArray(list)) {
    d.error(file, "a list `checks:` of { name, run, expect? }");
    return [];
  }
  const out: Level2Check[] = [];
  list.forEach((c, i) => {
    const e = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
    const ex = e?.expect === undefined ? {} : e.expect && typeof e.expect === "object" && !Array.isArray(e.expect) ? (e.expect as Record<string, unknown>) : null;
    if (!e || typeof e.name !== "string" || !e.name.trim() || typeof e.run !== "string" || !e.run.trim() || !ex) {
      d.error(file, `check ${i + 1}: needs a name, a run command and, optionally, an expect map`);
      return;
    }
    for (const k of Object.keys(ex)) if (!["exit", "json", "matches"].includes(k)) d.error(file, `check "${e.name}": unknown expect key "${k}" (exit, json, matches)`);
    if (ex.exit !== undefined && !Number.isInteger(ex.exit)) d.error(file, `check "${e.name}": expect.exit is a whole number`);
    if (ex.matches !== undefined && typeof ex.matches !== "string") d.error(file, `check "${e.name}": expect.matches is a regular expression`);
    out.push({
      name: e.name.trim(),
      run: e.run,
      expect: { exit: Number.isInteger(ex.exit) ? (ex.exit as number) : 0, ...(ex.json !== undefined ? { json: ex.json } : {}), ...(typeof ex.matches === "string" ? { matches: ex.matches } : {}) },
    });
  });
  return out;
}

/** The level 2 cases of a Role: each subfolder of `roles/<id>/evals/level2/` is one (see the module comment). */
export function loadLevel2Cases(root: string, id: string): { cases: Level2Case[]; diags: Diags } {
  const d = new Diags();
  const base = level2Dir(root, id);
  const cases: Level2Case[] = [];
  if (!existsSync(base)) return { cases, diags: d };
  for (const n of readdirSync(base).sort()) {
    if (n.startsWith(".") || !statSync(join(base, n)).isDirectory()) continue;
    const dir = `roles/${id}/evals/${LEVEL2_DIR}/${n}`;
    const file = `${dir}/case.md`;
    if (!existsSync(join(root, file))) {
      d.error(dir, "a level 2 case folder holds a case.md");
      continue;
    }
    const text = readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    let head: Record<string, unknown> | null = null;
    try {
      const v = fm ? (YAML.parse(fm[1] ?? "") as unknown) : null;
      head = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      head = null;
    }
    if (!head || typeof head.case !== "string" || !KEBAB.test(head.case)) {
      d.error(file, "a case starts with a front matter `case: <name>` (kebab-case)");
      continue;
    }
    const name = head.case;
    if (name !== n) d.error(file, `case "${name}" must equal its folder name "${n}"`);
    for (const k of Object.keys(head)) if (!CASE_KEYS.includes(k)) d.error(file, `unknown key "${k}" in the front matter (${CASE_KEYS.join(", ")})`);
    if (typeof head.fixture !== "string" || !KEBAB.test(head.fixture)) d.error(file, "fixture: <name> of a folder in evals/fixtures/ (kebab-case)");
    if (typeof head.task !== "string" || !/^[A-Za-z0-9._-]+$/.test(head.task)) d.error(file, "task: <id> of a task in the fixture's Change (e.g. T01)");
    if (head.change !== undefined && (typeof head.change !== "string" || !KEBAB.test(head.change))) d.error(file, "change: <id> of the fixture's Change (kebab-case), or left out when it has one");
    const lists: Record<string, string[]> = {};
    for (const k of ["covers", "must_read", "must_not_read"]) {
      if (head[k] === undefined) lists[k] = [];
      else if (strList(head[k])) lists[k] = head[k] as string[];
      else {
        d.error(file, `${k} must be a list of strings`);
        lists[k] = [];
      }
    }
    for (const p of [...(lists.must_read ?? []), ...(lists.must_not_read ?? [])]) {
      const path = p.replace(/^plugin:/, "");
      if (isAbsolute(path) || path.split("/").includes("..")) d.error(file, `"${p}": a path relative to the project, or plugin:<path in the plugin>`);
    }
    const num = (k: string, def: number, max: number) => {
      const v = head?.[k];
      if (v === undefined) return def;
      if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) {
        d.error(file, `${k} is a whole number from 1 to ${max}`);
        return def;
      }
      return v as number;
    };
    const section = /^## Criteria\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(text);
    const bullets = (section?.[1] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    for (const l of bullets.filter((x) => !/^- must( not)? \S/.test(x))) d.error(file, `criterion "${l.slice(0, 50)}" must be a bullet starting "- must" or "- must not"`);
    const heldOut = filesUnder(join(root, dir, "held-out"), [".DS_Store"]);
    if (!heldOut.length) d.error(dir, "a level 2 case needs held-out tests in held-out/ (laid over the project after the run)");
    const checksFile = join(root, dir, "checks.yaml");
    cases.push({
      name,
      dir,
      covers: lists.covers ?? [],
      fixture: typeof head.fixture === "string" ? head.fixture : "",
      task: typeof head.task === "string" ? head.task : "",
      ...(typeof head.change === "string" ? { change: head.change } : {}),
      mustRead: lists.must_read ?? [],
      mustNotRead: lists.must_not_read ?? [],
      timeoutMin: num("timeout_min", DEFAULT_TIMEOUT_MIN, 120),
      maxTurns: num("max_turns", DEFAULT_MAX_TURNS, 500),
      checks: existsSync(checksFile) ? parseChecks(readFileSync(checksFile, "utf8"), `${dir}/checks.yaml`, d) : [],
      criteria: bullets.filter((l) => /^- must( not)? \S/.test(l)).map((l) => l.slice(2)),
      heldOut,
    });
  }
  return { cases, diags: d };
}

// ---------------------------------------------------------------- fixtures and the package cache

/** `evals/fixtures/` of the source checkout the plugin sits in (`AIDW_FIXTURES_DIR` overrides it). */
export function fixturesDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.AIDW_FIXTURES_DIR || resolve(root, "..", "..", "evals", "fixtures");
}

/** Where installed packages are kept: `AIDW_FIXTURE_CACHE`, else `$XDG_CACHE_HOME/aidw/fixtures`, else `~/.cache/aidw/fixtures`. */
export function fixtureCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIDW_FIXTURE_CACHE || join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "aidw", "fixtures");
}

const FIXTURE_SKIP = ["node_modules", ".cache", ".DS_Store"];

/** The digest of a fixture: every file but node_modules/ and .cache/ (dotfiles count: the Change lives in .aidw/). */
export function fixtureDigest(dir: string): string {
  return digestOf(dir, filesUnder(dir, FIXTURE_SKIP));
}

/** The digest of a level 2 case folder: case.md, checks.yaml and the held-out files, with their paths. */
export function level2CaseDigest(root: string, c: Pick<Level2Case, "dir">): string {
  return digestOf(root, filesUnder(join(root, c.dir), [".DS_Store"]).map((f) => `${c.dir}/${f}`));
}

/** Installs the packages of a folder holding package.json and its lockfile. Needs the network; a case run never does. */
export type Installer = (dir: string) => void;

export const npmInstaller: Installer = (dir) => {
  const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`npm ci failed in ${dir}: ${r.error?.message ?? (r.stderr || r.stdout || "").trim().slice(-800)}`);
};

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"];

/**
 * The fixture's packages, installed once per lockfile: `<cache>/<name>-<hash of the lockfile>/node_modules`. A missing
 * or half-written entry is installed into a temp folder beside it and renamed into place, so two runs never share a
 * half-installed one. Returns the node_modules folder and whether it was installed now.
 */
export function ensureFixturePackages(fixture: string, name: string, env: NodeJS.ProcessEnv = process.env, install: Installer = npmInstaller): { nodeModules: string; installed: boolean; key: string } {
  const lock = LOCKFILES.map((f) => join(fixture, f)).find(existsSync);
  if (!lock) throw new Error(`fixture ${name} has no package-lock.json: commit one, so every run gets the same packages`);
  const hash = createHash("sha256").update(readFileSync(lock)).update("\0").update(readFileSync(join(fixture, "package.json"))).digest("hex").slice(0, 16);
  const key = `${name}-${hash}`;
  const root = fixtureCacheRoot(env);
  const entry = join(root, key);
  const done = join(entry, ".complete");
  if (existsSync(done) && existsSync(join(entry, "node_modules"))) return { nodeModules: join(entry, "node_modules"), installed: false, key };
  mkdirSync(root, { recursive: true });
  const tmp = join(root, `${key}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
  mkdirSync(tmp);
  try {
    for (const f of ["package.json", ...LOCKFILES, ".npmrc"]) if (existsSync(join(fixture, f))) cpSync(join(fixture, f), join(tmp, f));
    install(tmp);
    if (!existsSync(join(tmp, "node_modules"))) throw new Error(`installing the packages of fixture ${name} made no node_modules`);
    writeFileSync(join(tmp, ".complete"), `${new Date().toISOString()}\n`);
    rmSync(entry, { recursive: true, force: true }); // a half-written entry from a run that died
    try {
      renameSync(tmp, entry);
    } catch (e) {
      // Another run finished first: use its entry.
      if (!existsSync(done)) throw e;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { nodeModules: join(entry, "node_modules"), installed: true, key };
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "aidw eval",
  GIT_AUTHOR_EMAIL: "eval@aidw.invalid",
  GIT_COMMITTER_NAME: "aidw eval",
  GIT_COMMITTER_EMAIL: "eval@aidw.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args[0]} failed in ${cwd}: ${r.error?.message ?? (r.stderr || "").trim().slice(0, 400)}`);
  return r.stdout;
}

/** The Change of the fixture the case's task belongs to: the one named, or the only one. */
function changeOf(project: string, c: Level2Case): string {
  if (c.change) return c.change;
  const dir = join(project, ".aidw", "changes");
  const ids = existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(join(dir, n, "change.yaml"))) : [];
  if (ids.length !== 1) throw new Error(`fixture ${c.fixture} has ${ids.length} Changes: name one with change: in ${c.dir}/case.md`);
  return ids[0] as string;
}

export interface PreparedCopy {
  project: string;
  base: string;
  change: string;
  brief: string;
  briefText: string;
}

/**
 * A fresh copy of the fixture in `into`: its files (no node_modules), a link to the cached packages, a git repository
 * with one commit on the Change's branch, and the task started and its brief written by the CLI's own code, as
 * `aidw task start <task>` does in a real run.
 */
export function prepareCopy(root: string, c: Level2Case, fixture: string, nodeModules: string, into: string): PreparedCopy {
  mkdirSync(into, { recursive: true });
  for (const f of filesUnder(fixture, FIXTURE_SKIP)) {
    mkdirSync(dirname(join(into, f)), { recursive: true });
    cpSync(join(fixture, f), join(into, f));
  }
  symlinkSync(nodeModules, join(into, "node_modules"), "dir");
  const change = changeOf(into, c);
  let branch = "main";
  try {
    const cy = YAML.parse(readFileSync(join(into, ".aidw", "changes", change, "change.yaml"), "utf8")) as { run?: { branch?: unknown } };
    if (typeof cy?.run?.branch === "string" && /^[A-Za-z0-9._/-]+$/.test(cy.run.branch)) branch = cy.run.branch;
  } catch {
    /* main */
  }
  git(into, ["init", "-q", "-b", branch]);
  git(into, ["add", "-A"]);
  git(into, ["commit", "-q", "-m", `fixture ${c.fixture}`]);
  const base = git(into, ["rev-parse", "HEAD"]).trim();
  const p = pathsFor(into);
  startTask(p, change, c.task);
  const b = buildBrief(p, change, c.task, "implement", join(root, "library", "vendor"));
  return { project: into, base, change, brief: b.path, briefText: b.text };
}

// ---------------------------------------------------------------- the Agent session

export interface AgentRunInput {
  /** the temp copy: the session's working directory */
  cwd: string;
  prompt: string;
  /** no Role: no plugin, no agent, only the brief */
  bare: boolean;
  /** the plugin root (`--plugin-dir`) */
  pluginRoot: string;
  /** `aidw:<role>` */
  agent: string;
  model?: string;
  timeoutMs: number;
  maxTurns: number;
  /** the raw stream-json log goes here */
  logFile: string;
  /** the session's settings (sandbox, permissions) */
  settingsFile: string;
}
export interface AgentRunOutput {
  /** exit code of the session; null when it was killed or never started */
  exit: number | null;
  timedOut: boolean;
  turnLimit: boolean;
  /** assistant turns seen */
  turns: number;
  /** set when the session could not run at all (no claude on PATH, a crash with no result) */
  error?: string;
}
export type AgentRunner = (i: AgentRunInput) => AgentRunOutput;

export const AGENT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

/**
 * The session's settings. No network: Bash runs only in Claude Code's sandbox (`sandbox.enabled`, no allowed hosts),
 * the sandbox's escape hatch is off (`allowUnsandboxedCommands: false`), and Bash is allowed only because it is
 * sandboxed (`autoAllowBashIfSandboxed`), never by an allow rule: where the sandbox cannot run, Bash asks, and with
 * `--permission-prompts none` that is a denial. WebFetch and WebSearch are not among `--tools` and are denied besides.
 * Reads of the plugin are allowed (the brief points at its skills); edits stay inside the copy (`acceptEdits`).
 */
export function sessionSettings(pluginRoot: string): Record<string, unknown> {
  return {
    permissions: {
      allow: ["Read", "Glob", "Grep", `Read(/${resolve(pluginRoot)}/**)`],
      deny: ["WebFetch", "WebSearch"],
    },
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [] },
    },
  };
}

/** The `claude` arguments of a level 2 session (stdin carries the prompt). */
export function agentArgs(i: Omit<AgentRunInput, "prompt" | "timeoutMs" | "maxTurns" | "logFile">): string[] {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    ...(i.bare ? [] : ["--plugin-dir", i.pluginRoot, "--agent", i.agent]),
    "--tools", AGENT_TOOLS.join(","),
    "--permission-mode", "acceptEdits",
    "--permission-prompts", "none",
    "--setting-sources", "project",
    "--settings", i.settingsFile,
    "--strict-mcp-config",
    "--no-session-persistence",
    ...(i.model ? ["--model", i.model] : []),
  ];
}

/**
 * Runs the session through a small Node watcher, so this CLI stays synchronous and the limits still hold: the watcher
 * pipes the prompt in, writes every stdout line to the log as it arrives, counts assistant turns (distinct message ids
 * of the main thread), and stops the session (SIGTERM, then SIGKILL) at the wall-clock limit or past the turn limit.
 */
const WATCHER = String.raw`
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const cfg = JSON.parse(process.env.AIDW_L2_WATCH);
delete process.env.AIDW_L2_WATCH;
const out = fs.openSync(cfg.log, "w");
const ids = new Set();
let killed = null, buf = "", errTail = "";
const child = spawn(cfg.cmd[0], cfg.cmd.slice(1), { cwd: cfg.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
const kill = (why) => { if (killed) return; killed = why; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); };
const timer = setTimeout(() => kill("timeout"), cfg.timeoutMs);
child.stdout.on("data", (d) => {
  fs.writeSync(out, d);
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e && e.type === "assistant" && !e.parent_tool_use_id) {
      ids.add((e.message && e.message.id) || line);
      if (ids.size > cfg.maxTurns) kill("turns");
    }
  }
});
child.stderr.on("data", (d) => { errTail = (errTail + d.toString("utf8")).slice(-4000); });
child.stdin.on("error", () => {});
child.on("error", (e) => { clearTimeout(timer); process.stdout.write(JSON.stringify({ exit: null, killed, turns: ids.size, error: e.message })); process.exit(0); });
child.on("close", (code) => { clearTimeout(timer); fs.closeSync(out); process.stdout.write(JSON.stringify({ exit: code, killed, turns: ids.size, stderr: errTail })); });
child.stdin.end(fs.readFileSync(0));
`;

/** The real session: `claude` (or `command`, for tests of the limits) run through the watcher. */
export const claudeAgentRunner =
  (command: string[] = ["claude"], env: NodeJS.ProcessEnv = process.env): AgentRunner =>
  (i) => {
    const args = agentArgs(i);
    // The plugin's bin/ first on PATH, as its SessionStart hook does in a real session: the Role runs `aidw plugin-path`.
    const path = i.bare ? env.PATH : [join(i.pluginRoot, "bin"), env.PATH].filter(Boolean).join(":");
    const cfg = { cmd: [...command, ...args], cwd: i.cwd, log: i.logFile, timeoutMs: i.timeoutMs, maxTurns: i.maxTurns };
    const r = spawnSync(process.execPath, ["-e", WATCHER], {
      input: i.prompt,
      encoding: "utf8",
      env: { ...env, PATH: path, AIDW_L2_WATCH: JSON.stringify(cfg) },
      timeout: i.timeoutMs + 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    let s: { exit?: number | null; killed?: string | null; turns?: number; error?: string; stderr?: string } = {};
    try {
      s = JSON.parse(r.stdout || "{}");
    } catch {
      s = {};
    }
    if (r.error || s.exit === undefined) return { exit: null, timedOut: !!r.error, turnLimit: false, turns: s.turns ?? 0, error: r.error?.message ?? ((r.stderr || "").trim().slice(-400) || "the watcher gave no result") };
    return {
      exit: s.exit ?? null,
      timedOut: s.killed === "timeout",
      turnLimit: s.killed === "turns",
      turns: s.turns ?? 0,
      ...(s.error ? { error: `${command[0]} did not start: ${s.error}` } : s.exit !== 0 && !s.killed && s.stderr ? { error: s.stderr.trim().slice(-400) } : {}),
    };
  };

// ---------------------------------------------------------------- the tool log

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}
export interface SessionLog {
  calls: ToolCall[];
  turns: number;
  /** the session's final reply (the result event, else the last assistant text) */
  finalText: string;
  /** the result event's subtype, e.g. success or error_max_turns */
  resultSubtype?: string;
  isError: boolean;
}

/** Reads a `--output-format stream-json` log; lines that are not JSON are skipped. */
export function parseStreamLog(text: string): SessionLog {
  const calls: ToolCall[] = [];
  const ids = new Set<string>();
  let lastText = "";
  let finalText: string | null = null;
  let resultSubtype: string | undefined;
  let isError = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e.type === "assistant") {
      const msg = (e.message ?? {}) as { id?: unknown; content?: unknown };
      if (!e.parent_tool_use_id) ids.add(typeof msg.id === "string" ? msg.id : line);
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        const block = b as { type?: unknown; name?: unknown; input?: unknown; text?: unknown };
        if (block.type === "tool_use" && typeof block.name === "string") calls.push({ name: block.name, input: block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {} });
        if (block.type === "text" && typeof block.text === "string" && !e.parent_tool_use_id) lastText = block.text;
      }
    } else if (e.type === "result") {
      if (typeof e.result === "string") finalText = e.result;
      if (typeof e.subtype === "string") resultSubtype = e.subtype;
      isError = e.is_error === true;
    }
  }
  return { calls, turns: ids.size, finalText: finalText ?? lastText, ...(resultSubtype ? { resultSubtype } : {}), isError };
}

/** A shell command that reads a file's content (not one that only names it). */
const READ_VERB = /(^|[\s;&|(`$])(cat|head|tail|less|more|sed|awk|nl|bat|view)\b/;

/** macOS reaches the temp dir as /var/... and /private/var/...: one form for both. */
const norm = (p: string) => resolve(p).replace(/^\/private(?=\/(?:var|tmp)\/)/, "");

/**
 * Whether the session read a file. It counts: the Read tool on it; the Grep tool with it as `path`; a Bash command that
 * runs a reading command (cat, head, tail, less, more, sed, awk, nl) and names the file by its absolute path, its path
 * in the project, or, for a plugin file, its path in the plugin (`cat "$(aidw plugin-path roles/...)"`).
 */
export function wasRead(calls: ToolCall[], ref: string, ctx: { project: string; pluginRoot: string }): boolean {
  const plugin = ref.startsWith("plugin:");
  const rel = ref.replace(/^plugin:/, "");
  const abs = norm(join(plugin ? ctx.pluginRoot : ctx.project, rel));
  const names = [abs, resolve(join(plugin ? ctx.pluginRoot : ctx.project, rel)), rel];
  return calls.some((c) => {
    if (c.name === "Read" && typeof c.input.file_path === "string") return norm(resolve(ctx.project, c.input.file_path)) === abs;
    if (c.name === "Grep" && typeof c.input.path === "string") return norm(resolve(ctx.project, c.input.path)) === abs;
    if (c.name === "Bash" && typeof c.input.command === "string") {
      const cmd = c.input.command;
      return READ_VERB.test(cmd) && names.some((n) => cmd.includes(n));
    }
    return false;
  });
}

// ---------------------------------------------------------------- grading

export type StepName = "agent" | "tests" | "checks" | "reads" | "criteria";
export interface StepResult {
  step: StepName;
  pass: boolean;
  /** what failed, one line each */
  failed: string[];
  /** not run (an earlier step failed, or nothing to grade) */
  skipped?: string;
}
export interface RunResult {
  pass: boolean;
  steps: StepResult[];
  /** the run's folder: the copy, the log, the diff, result.json */
  dir: string;
  log: string;
  turns: number;
  /** the run could not be graded (no session, a broken fixture): an ERROR, not a FAIL */
  error?: string;
  criteria: CriterionResult[];
}
export interface Level2Result {
  role: string;
  name: string;
  pass: boolean;
  runs: { total: number; passed: number; errors: number };
  /** what failed, with the number of runs it failed in */
  failed: string[];
  results: RunResult[];
  bare: boolean;
}

function sh(command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 10 * 60 * 1000): { exit: number; out: string } {
  const r = spawnSync("sh", ["-c", command], { cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  return { exit: r.error ? -1 : (r.status ?? -1), out: out.replace(/\x1b\[[0-9;]*m/g, "") };
}
const tail = (s: string, n = 1500) => (s.length > n ? `...${s.slice(-n)}` : s).trim();

/** Whether `actual` holds `expected`: maps by their keys, lists element by element (each expected one matches some actual one), a string "/re/" as a regex. */
export function jsonContains(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "string" && /^\/.*\/$/s.test(expected) && expected.length > 1) return typeof actual === "string" && new RegExp(expected.slice(1, -1)).test(actual);
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((e) => actual.some((a) => jsonContains(a, e)));
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) => jsonContains((actual as Record<string, unknown>)[k], v));
  }
  return actual === expected;
}

export function runCheck(ch: Level2Check, cwd: string, env: NodeJS.ProcessEnv): { pass: boolean; why: string } {
  const r = sh(ch.run, cwd, env);
  if (r.exit !== ch.expect.exit) return { pass: false, why: `exit ${r.exit}, expected ${ch.expect.exit}: ${tail(r.out, 300).replace(/\s+/g, " ")}` };
  if (ch.expect.matches !== undefined && !new RegExp(ch.expect.matches, "m").test(r.out)) return { pass: false, why: `output does not match /${ch.expect.matches}/` };
  if (ch.expect.json !== undefined) {
    const first = r.out.indexOf("{");
    const firstArr = r.out.indexOf("[");
    const start = [first, firstArr].filter((x) => x >= 0).sort((a, b) => a - b)[0];
    let v: unknown;
    try {
      v = JSON.parse(start === undefined ? "" : r.out.slice(start));
    } catch {
      return { pass: false, why: "output is not JSON" };
    }
    if (!jsonContains(v, ch.expect.json)) return { pass: false, why: "output does not hold the expected JSON" };
  }
  return { pass: true, why: "" };
}

/** The changes of the run, before the held-out tests are laid over: the diff from the base, untracked files included. */
function captureDiff(project: string, base: string): string {
  // .aidw/run/ is ignored by .aidw/.gitignore; the task's start changed .aidw/changes/, which is not the Agent's work.
  git(project, ["add", "-A", "--", ".", ":(exclude).aidw/changes"]);
  return git(project, ["diff", "--cached", base, "--", ".", ":(exclude).aidw/changes"]);
}

export function buildLevel2GradePrompt(c: Level2Case, briefText: string, diff: string, reply: string, report: string | null): string {
  const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[... cut at ${n} characters]` : s);
  return [
    "You grade the work of an AI coding Agent on one task in a real repository. Machines already checked the tests, the scripts",
    "and which files it read; judge only the criteria below, from the diff of its changes, its final reply and its report file.",
    "Judge what the diff and the texts show; do not reward length or confidence.",
    "",
    "## The task brief it was given",
    cap(briefText, 30_000),
    "",
    "## Its changes (git diff from the commit it started from)",
    "```diff",
    cap(diff, 120_000),
    "```",
    "",
    "## Its final reply",
    reply.trim() || "(empty)",
    "",
    "## Its report file",
    report?.trim() || "(none written)",
    "",
    "## Criteria",
    ...c.criteria.map((x, i) => `${i + 1}. ${x}`),
    "",
    "Reply with ONLY a JSON array, one object per criterion in order: " +
      '[{"n":1,"pass":true,"reason":"one short sentence"}]. A "must not" criterion passes when the work avoids it.',
  ].join("\n");
}

export interface Level2Options {
  root: string;
  role: string;
  runs?: number;
  bare?: boolean;
  model?: string;
  agent: AgentRunner;
  /** the grader of step 4 */
  exec: Exec;
  install?: Installer;
  env?: NodeJS.ProcessEnv;
  /** where run folders go (default: the system temp dir) */
  runsDir?: string;
  onRun?: (c: Level2Case, n: number, r: RunResult) => void;
}

/** One run of a case: a fresh copy, one session, the four graders. Never throws: a broken run is an `error` result. */
export function runLevel2Once(c: Level2Case, n: number, o: Level2Options, nodeModules: string): RunResult {
  const env = o.env ?? process.env;
  const dir = mkdtempSync(join(o.runsDir ?? tmpdir(), `aidw-l2-${o.role}-${c.name}-${n}-`));
  const log = join(dir, "session.jsonl");
  const steps: StepResult[] = [];
  const result = (extra: Partial<RunResult> = {}): RunResult => {
    const r: RunResult = { pass: !extra.error && steps.length > 0 && steps.every((s) => s.pass), steps, dir, log, turns: 0, criteria: [], ...extra };
    writeFileSync(join(dir, "result.json"), `${JSON.stringify({ case: c.name, run: n, bare: !!o.bare, ...r }, null, 2)}\n`);
    return r;
  };
  let prep: PreparedCopy;
  try {
    prep = prepareCopy(o.root, c, join(fixturesDir(o.root, env), c.fixture), nodeModules, join(dir, "project"));
  } catch (e) {
    return result({ error: `the copy could not be prepared: ${(e as Error).message}` });
  }
  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, `${JSON.stringify(sessionSettings(o.root), null, 2)}\n`);
  // The prompt the orchestrator sends a task's Agent (the SPAWN line of `aidw task start`).
  const prompt = `Task brief: ${prep.brief}. Read it and implement the task.`;
  writeFileSync(join(dir, "prompt.txt"), `${prompt}\n`);
  const ag = o.agent({
    cwd: prep.project,
    prompt,
    bare: !!o.bare,
    pluginRoot: resolve(o.root),
    agent: `aidw:${o.role}`,
    ...(o.model ? { model: o.model } : {}),
    timeoutMs: c.timeoutMin * 60_000,
    maxTurns: c.maxTurns,
    logFile: log,
    settingsFile,
  });
  const session = parseStreamLog(existsSync(log) ? readFileSync(log, "utf8") : "");
  const turns = Math.max(ag.turns, session.turns);
  if (ag.error && !session.calls.length && !session.finalText) return result({ error: `the session did not run: ${ag.error}`, turns });
  const limits: string[] = [];
  if (ag.timedOut) limits.push(`stopped at the time limit (${c.timeoutMin} min)`);
  if (ag.turnLimit || turns > c.maxTurns) limits.push(`stopped past the turn limit (${c.maxTurns} turns)`);
  if (!limits.length && ag.exit !== 0) limits.push(`the session ended with exit ${String(ag.exit)}${session.resultSubtype ? ` (${session.resultSubtype})` : ""}`);
  steps.push({ step: "agent", pass: limits.length === 0, failed: limits });

  let diff = "";
  try {
    diff = captureDiff(prep.project, prep.base);
  } catch (e) {
    return result({ error: `the diff could not be taken: ${(e as Error).message}`, turns });
  }
  writeFileSync(join(dir, "diff.patch"), diff);
  const reportFile = join(prep.project, ".aidw", "run", `report-${c.task}.md`);
  const report = existsSync(reportFile) ? readFileSync(reportFile, "utf8") : null;

  // 1. Held-out tests, laid over the copy only now, run with the fixture's test command.
  const caseDir = join(o.root, c.dir, "held-out");
  for (const f of c.heldOut) {
    mkdirSync(dirname(join(prep.project, f)), { recursive: true });
    cpSync(join(caseDir, f), join(prep.project, f));
  }
  const testFiles = c.heldOut.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
  const cmdEnv: NodeJS.ProcessEnv = { ...env, PATH: [join(o.root, "bin"), env.PATH].filter(Boolean).join(":"), AIDW_BASE: prep.base, AIDW_PROJECT: prep.project, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const t = sh(`npm test --silent -- ${testFiles.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(" ")}`, prep.project, cmdEnv);
  writeFileSync(join(dir, "held-out.txt"), t.out);
  const failedTests = [...new Set(t.out.split("\n").map((l) => /^\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?\s*$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x))];
  steps.push({ step: "tests", pass: t.exit === 0, failed: t.exit === 0 ? [] : failedTests.length ? failedTests.slice(0, 20) : [`npm test exited ${t.exit}: ${tail(t.out, 200).replace(/\s+/g, " ")}`] });

  // 2. The case's checks (the Role's scripts and the like).
  const checkFails: string[] = [];
  const checkOut: string[] = [];
  for (const ch of c.checks) {
    const r = runCheck(ch, prep.project, cmdEnv);
    checkOut.push(`${r.pass ? "ok  " : "FAIL"} ${ch.name}${r.pass ? "" : `: ${r.why}`}`);
    if (!r.pass) checkFails.push(`${ch.name}: ${r.why}`);
  }
  writeFileSync(join(dir, "checks.txt"), `${checkOut.join("\n")}\n`);
  steps.push({ step: "checks", pass: checkFails.length === 0, failed: checkFails });

  // 3. The tool log: what the Agent read.
  const ctx = { project: prep.project, pluginRoot: resolve(o.root) };
  const readFails = [
    ...c.mustRead.filter((f) => !wasRead(session.calls, f, ctx)).map((f) => `did not read ${f}`),
    ...c.mustNotRead.filter((f) => wasRead(session.calls, f, ctx)).map((f) => `read ${f}, which it must not`),
  ];
  steps.push({ step: "reads", pass: readFails.length === 0, failed: readFails });

  // 4. The model grades only the criteria no machine can check, and only a run the machines passed: it would fail anyway.
  let criteria: CriterionResult[] = [];
  if (o.bare) steps.push({ step: "criteria", pass: true, failed: [], skipped: "bare: the machine graders decide" });
  else if (!c.criteria.length) steps.push({ step: "criteria", pass: true, failed: [], skipped: "the case has no criteria" });
  else if (!steps.every((s) => s.pass)) steps.push({ step: "criteria", pass: false, failed: [], skipped: "a machine grader failed" });
  else {
    try {
      criteria = parseGrade(o.exec(buildLevel2GradePrompt(c, prep.briefText, diff, session.finalText, report)), c.criteria);
    } catch (e) {
      return result({ error: `the grader failed: ${(e as Error).message}`, turns });
    }
    steps.push({ step: "criteria", pass: criteria.every((x) => x.pass), failed: criteria.filter((x) => !x.pass).map((x) => `${x.criterion}: ${x.reason}`) });
  }
  return result({ turns, criteria });
}

/**
 * Bare (plan C3 at level 2): the run is judged on the held-out tests and the checks alone; the tool log names Role files
 * a session without the Role cannot be expected to read, so it is shown and not counted.
 */
const machinePass = (r: RunResult, bare: boolean) => !r.error && r.steps.filter((s) => s.step !== "criteria" && (!bare || s.step !== "reads")).every((s) => s.pass);

/** Runs the level 2 cases of one Role (or only `caseName`), `runs` times each. */
export function runLevel2(o: Level2Options, caseName?: string): Level2Result[] {
  const env = o.env ?? process.env;
  const { cases, diags } = loadLevel2Cases(o.root, o.role);
  if (diags.errors.length) throw new Error(`level 2 cases of ${o.role} are malformed:\n${diags.errors.map((x) => `  ${x.file}: ${x.message}`).join("\n")}`);
  const picked = cases.filter((c) => !caseName || c.name === caseName);
  if (caseName && !picked.length) throw new Error(`no level 2 case "${caseName}" for ${o.role}`);
  if (!picked.length) throw new Error(`${o.role} has no level 2 cases (roles/${o.role}/evals/${LEVEL2_DIR}/<case>/case.md)`);
  const runs = o.runs ?? 3;
  const out: Level2Result[] = [];
  for (const c of picked) {
    const fixture = join(fixturesDir(o.root, env), c.fixture);
    if (!existsSync(join(fixture, "package.json"))) throw new Error(`fixture ${c.fixture} not found at ${fixture}: level 2 runs from a source checkout`);
    const { nodeModules } = ensureFixturePackages(fixture, c.fixture, env, o.install);
    const results: RunResult[] = [];
    for (let n = 1; n <= runs; n++) {
      const r = runLevel2Once(c, n, o, nodeModules);
      if (o.bare) r.pass = machinePass(r, true);
      results.push(r);
      o.onRun?.(c, n, r);
    }
    const graded = results.filter((r) => !r.error);
    const counts = new Map<string, number>();
    for (const r of graded) for (const s of r.steps) for (const f of s.failed) counts.set(`${s.step}: ${f}`, (counts.get(`${s.step}: ${f}`) ?? 0) + 1);
    const passed = results.filter((r) => r.pass).length;
    out.push({
      role: o.role,
      name: c.name,
      pass: passed === runs,
      runs: { total: runs, passed, errors: results.length - graded.length },
      failed: [...counts].map(([f, k]) => (runs > 1 ? `${f} (${k} of ${graded.length} runs)` : f)),
      results,
      bare: !!o.bare,
    });
  }
  return out;
}

export function printLevel2(rs: Level2Result[]): string {
  const lines: string[] = [];
  for (const r of rs) {
    const word = r.runs.errors === r.runs.total ? "ERROR" : r.pass ? "PASS" : r.runs.passed > 0 ? "FLAKY" : "FAIL";
    lines.push(`${word} ${r.role}/${r.name} level 2${r.bare ? " bare" : ""} (${r.runs.passed}/${r.runs.total} runs${r.runs.errors ? `, ${r.runs.errors} error` : ""})`.replace(/^(PASS|FAIL) /, "$1  "));
    r.results.forEach((x, i) => {
      const status = x.error ? `ERROR ${x.error.split("\n")[0]?.slice(0, 200)}` : x.steps.map((s) => `${s.step} ${s.skipped ? "-" : s.pass ? "ok" : "FAIL"}`).join(", ");
      lines.push(`      run ${i + 1}: ${status} (${x.turns} turns) ${x.dir}`);
    });
    for (const f of r.failed) lines.push(`      - ${f}`);
  }
  const bad = rs.filter((r) => !r.pass).length;
  lines.push(`${rs.length - bad}/${rs.length} level 2 case(s) passed`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- the result file (C6)

/** A level 2 entry also records the digest of its fixture (`fixture`), which lives outside the plugin. */
export interface Level2CaseRecord extends CaseRecord {
  fixture?: string;
}
export interface Level2RunRecord extends Omit<RunRecord, "cases"> {
  level: 2;
  cases: Level2CaseRecord[];
}

export interface Level2Digests {
  shared: string;
  cases: Map<string, { digest: string; fixture: string | null }>;
}

/** The Role's shared digest (as level 1's) and each case's folder and fixture digests, taken before a run starts. */
export function takeLevel2Digests(root: string, id: string, env: NodeJS.ProcessEnv = process.env): Level2Digests {
  const fx = fixturesDir(root, env);
  return {
    shared: sharedDigest(root, id),
    cases: new Map(
      loadLevel2Cases(root, id).cases.map((c) => [c.name, { digest: level2CaseDigest(root, c), fixture: existsSync(join(fx, c.fixture)) ? fixtureDigest(join(fx, c.fixture)) : null }]),
    ),
  };
}

type Level2Meta = { model?: string; date?: Date; digests: Level2Digests; env?: NodeJS.ProcessEnv };

function level2Records(root: string, id: string, rs: Level2Result[], date: string, model: string | null, digests: Level2Digests): Level2CaseRecord[] {
  return rs
    .filter((r) => r.role === id && !r.bare && digests.cases.has(r.name))
    .map((r) => {
      const d = digests.cases.get(r.name)!;
      return {
        name: r.name,
        pass: r.pass,
        runs: r.runs,
        failed: r.failed,
        ...(r.runs.errors === r.runs.total ? { error: r.results[0]?.error ?? "error" } : {}),
        digest: d.digest,
        ...(d.fixture ? { fixture: d.fixture } : {}),
        date,
        model,
      };
    });
}

function saveLevel2(root: string, id: string, model: string | null, date: string, shared: string, cases: Level2CaseRecord[]): string {
  const rec: Level2RunRecord = {
    format: RESULTS_FORMAT,
    level: 2,
    role: id,
    date,
    model,
    tier: loadRole(root, id)?.tier ?? "",
    runs: cases.length ? Math.min(...cases.map((c) => c.runs.total)) : 0,
    digest: shared,
    cases,
  };
  const file = level2ResultsFile(root, id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  return file;
}

const CHANGED = "the Role or a case changed during the run: run it again";

function changedDuring(root: string, id: string, digests: Level2Digests, env?: NodeJS.ProcessEnv): boolean {
  const now = takeLevel2Digests(root, id, env);
  if (now.shared !== digests.shared) return true;
  for (const [name, d] of digests.cases) {
    const n = now.cases.get(name);
    if (!n || n.digest !== d.digest || n.fixture !== d.fixture) return true;
  }
  return false;
}

/** A run of all the level 2 cases of a Role: `roles/<id>/evals/level2/results.json` afresh. */
export function writeLevel2Results(root: string, id: string, rs: Level2Result[], meta: Level2Meta): { file: string } | { refused: string } {
  if (changedDuring(root, id, meta.digests, meta.env)) return { refused: CHANGED };
  const date = (meta.date ?? new Date()).toISOString();
  const model = meta.model ?? null;
  return { file: saveLevel2(root, id, model, date, meta.digests.shared, level2Records(root, id, rs, date, model, meta.digests)) };
}

/** A `--case` run merged into the file: only into one of the same shared content and model (as level 1's mergeResults). */
export function mergeLevel2Results(root: string, id: string, rs: Level2Result[], meta: Level2Meta): { file: string } | { refused: string } {
  const file = level2ResultsFile(root, id);
  const all = `run \`aidw eval ${id} --level 2\` for all cases`;
  if (!existsSync(file)) return { refused: `there is no level 2 results.json yet: ${all} once` };
  let old: Level2RunRecord;
  try {
    old = JSON.parse(readFileSync(file, "utf8")) as Level2RunRecord;
  } catch {
    return { refused: `level 2 results.json is not readable: ${all}` };
  }
  if (old?.format !== RESULTS_FORMAT || old.level !== 2 || !Array.isArray(old.cases)) return { refused: `level 2 results.json is not a level 2 file of format ${RESULTS_FORMAT}: ${all} once` };
  if (changedDuring(root, id, meta.digests, meta.env)) return { refused: CHANGED };
  if (old.digest !== meta.digests.shared) return { refused: `the Role's shared content changed since the last full run: ${all}` };
  const model = meta.model ?? null;
  if ((old.model ?? null) !== model) return { refused: `level 2 results.json was made with model ${old.model ?? "default"}, this run with ${model ?? "default"}: ${all}` };
  const date = (meta.date ?? new Date()).toISOString();
  const fresh = new Map(level2Records(root, id, rs, date, model, meta.digests).map((c) => [c.name, c]));
  const kept = new Map(caseEntries(old.cases).map((c) => [c.name, c as Level2CaseRecord]));
  const cases = loadLevel2Cases(root, id)
    .cases.map((c) => fresh.get(c.name) ?? kept.get(c.name))
    .filter((c): c is Level2CaseRecord => c !== undefined);
  return { file: saveLevel2(root, id, model, date, meta.digests.shared, cases) };
}

// ---------------------------------------------------------------- aidw roster

/**
 * For `aidw roster`: level 2 cases are well formed (errors), their `covers` name the Role's rules and skills, and their
 * result file is there, of the tier's model, of the Role's content and of each case's folder and fixture, from 3 runs
 * that passed (warnings only).
 */
export function checkLevel2(root: string, id: string, tierModel: string | null, d: Diags, env: NodeJS.ProcessEnv = process.env): void {
  const { cases, diags } = loadLevel2Cases(root, id);
  d.add(diags);
  if (!cases.length) return;
  const known = new Set([...(loadRuleTable(root, id) ?? []).map((r) => r.id), ...(loadRole(root, id)?.skills ?? []).map((s) => s.name)]);
  for (const c of cases) for (const x of c.covers) if (!known.has(x)) d.error(`${c.dir}/case.md`, `covers "${x}" is not a rule id or a skill of ${id}`);
  const rf = relative(root, level2ResultsFile(root, id));
  const run = `aidw eval ${id} --level 2`;
  const file = level2ResultsFile(root, id);
  if (!existsSync(file)) return d.warn(rf, `missing: run \`${run}\` and commit the file`);
  let rec: Level2RunRecord;
  try {
    rec = JSON.parse(readFileSync(file, "utf8")) as Level2RunRecord;
  } catch {
    return d.warn(rf, `not readable: run \`${run}\` again`);
  }
  if (!rec || typeof rec !== "object" || rec.format !== RESULTS_FORMAT || rec.level !== 2) return d.warn(rf, `not a level 2 result file: run \`${run}\` again`);
  const name = (m: unknown) => (typeof m === "string" ? m : "default");
  if ((rec.model ?? null) !== tierModel) d.warn(rf, `made with model ${name(rec.model)}, not its tier's model (${name(tierModel)}): run \`${run}\` again`);
  if (rec.digest !== sharedDigest(root, id)) return d.warn(rf, `older than the Role's content (it changed after ${rec.date}): run \`${run}\` again`);
  const entries = new Map(caseEntries(rec.cases).map((c) => [c.name, c as Level2CaseRecord]));
  const fx = fixturesDir(root, env);
  const missing: string[] = [];
  const fresh: Level2CaseRecord[] = [];
  for (const c of cases) {
    const e = entries.get(c.name);
    if (!e) missing.push(c.name);
    else if (e.digest !== level2CaseDigest(root, c)) d.warn(rf, `case ${c.name} was run from another version of ${c.dir}: run \`${run} --case ${c.name}\``);
    // The fixture lives outside the plugin: checked only where it exists (a source checkout).
    else if (existsSync(join(fx, c.fixture)) && e.fixture !== fixtureDigest(join(fx, c.fixture))) d.warn(rf, `case ${c.name} was run on another version of fixture ${c.fixture}: run \`${run} --case ${c.name}\``);
    else fresh.push(e);
  }
  if (missing.length) d.warn(rf, `no level 2 result for case(s): ${missing.join(", ")}: run \`${run} --case <name>\` for each`);
  const few = fresh.filter((c) => !(Number(c.runs?.total) >= 3)).map((c) => c.name);
  if (few.length) d.warn(rf, `${few.length} level 2 case(s) last ran fewer than 3 times: ${few.join(", ")}; a case passes only with 3 of 3`);
  const failed = fresh.filter((c) => !c.pass).map((c) => c.name);
  if (failed.length) d.warn(rf, `the last level 2 run did not pass ${failed.length} case(s): ${failed.join(", ")}`);
}
