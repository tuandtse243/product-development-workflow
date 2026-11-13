/**
 * `aidw run`: the headless auto-resume runner (slice S9, blueprint section 13 level 2, decision D-30).
 *
 * The user starts it in their own terminal (never inside a Claude Code session; the gate denies that). It
 * loops `claude -p "/aidw:resume <id>" --permission-mode <mode>` until the change is archived, needs the
 * user (escalated, before approval, tier-3 question), or stops making progress. When a session ends on a
 * usage or rate limit (the StopFailure hook paused the change, or the output says so), it waits until the
 * stated reset time, or backs off (5, 10, 20, 40, 60 minutes), then resumes.
 *
 * Each session starts fresh: everything needed to continue lives in .aidw/ and git, so a new session costs
 * less than resuming a long one (`--resume <session>` would reload its whole context).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listChangeIds, loadChange, stateOf } from "./change.js";
import type { Paths } from "./project.js";

export interface RunnerOptions {
  claude?: string;
  permissionMode?: string;
  /** keep the user's MCP servers in the unattended sessions (default: drop them, their tool schemas cost tokens every turn) */
  keepMcp?: boolean;
  /** extra arguments for every claude call (after `--` on the aidw command line), e.g. --plugin-dir */
  extraArgs?: string[];
  /**
   * Machine check before the first session and before every deploy session: a message means the run needs the user
   * (a failed `aidw doctor` check), so no session is spent finding that out (trial-3C: six sessions at "deploying").
   */
  preflight?: (state: string) => string | null;
  maxRuns?: number;
  /** per-session limit; a hung session is killed and counts as a run */
  sessionTimeoutMs?: number;
  sleep?: (ms: number) => void;
  log?: (line: string) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export type RunnerOutcome = "archived" | "escalated" | "needs_user" | "no_progress" | "max_runs" | "claude_failed";

export interface RunnerResult {
  outcome: RunnerOutcome;
  runs: number;
  waits: number;
  state: string;
  message: string;
}

const MINUTE = 60_000;
export const BACKOFF_MINUTES = [5, 10, 20, 40, 60] as const;
const LIMIT_TEXT = /rate[ _-]?limit|usage limit|quota|overloaded|\b429\b|\b529\b|limit (?:will )?reset/i;
/** States the runner can drive; anything else needs the user. */
const DRIVABLE = new Set(["approved", "executing", "verifying", "converging", "deploying", "delivered", "paused"]);

const NOISE = /^Permission allow rule \(/;

const sleepSync = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const UNIT: Record<string, number> = { ms: 1, s: 1000, sec: 1000, second: 1000, seconds: 1000, m: MINUTE, min: MINUTE, minute: MINUTE, minutes: MINUTE, h: 60 * MINUTE, hour: 60 * MINUTE, hours: 60 * MINUTE };

/**
 * How long to wait before resuming, from an error text: "retry after 120 seconds", "try again in 5 minutes",
 * "resets at 3pm" / "resets 15:30", or a unix reset timestamp; otherwise exponential backoff. Adds a minute of margin.
 */
export function waitMs(reason: string, attempt: number, now: Date = new Date()): { ms: number; why: string } {
  const margin = MINUTE;
  const rel = /(?:retry[- ]after|try again in|again in|resets? in|wait)\D{0,4}(\d+(?:\.\d+)?)\s*(ms|s|sec|seconds?|m|min|minutes?|h|hours?)\b/i.exec(reason);
  if (rel) {
    const unit = UNIT[(rel[2] as string).toLowerCase()] ?? 1000;
    return { ms: Math.round(Number(rel[1]) * unit) + margin, why: `the error says ${rel[0].trim()}` };
  }
  const epoch = /reset\w*\D{0,20}(1\d{9})\b/i.exec(reason);
  if (epoch) {
    const ms = Number(epoch[1]) * 1000 - now.getTime();
    if (ms > 0) return { ms: ms + margin, why: `the limit resets at ${new Date(Number(epoch[1]) * 1000).toISOString()}` };
  }
  const clock = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(reason);
  if (clock && (clock[2] !== undefined || clock[3] !== undefined)) {
    let h = Number(clock[1]);
    const m = Number(clock[2] ?? 0);
    const ap = clock[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h < 24 && m < 60) {
      const at = new Date(now);
      at.setHours(h, m, 0, 0);
      if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
      return { ms: at.getTime() - now.getTime() + margin, why: `the limit resets at ${at.toLocaleTimeString()}` };
    }
  }
  const minutes = BACKOFF_MINUTES[Math.min(attempt, BACKOFF_MINUTES.length - 1)] as number;
  return { ms: minutes * MINUTE, why: `no reset time given: backoff ${minutes} min` };
}

function archived(p: Paths, id: string): boolean {
  return !listChangeIds(p).includes(id) && existsSync(p.archive) && readdirNames(p.archive).some((n) => n.endsWith(id));
}

function readdirNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/** What counts as progress: state, task statuses, quality layers, converge and deploy evidence. */
export function fingerprint(p: Paths, id: string): string {
  if (archived(p, id)) return "archived";
  try {
    const c = loadChange(p, id);
    const parts = [String(c.data.state)];
    for (const f of ["tasks.yaml", "evidence/quality/summary.json", "evidence/converge.json", "evidence/deploy.json", "evidence/integration.json"]) {
      const file = join(c.dir, f);
      // Timestamps alone are not progress: a session that only re-ran the same check changed nothing.
      parts.push(existsSync(file) ? createHash("sha1").update(readFileSync(file, "utf8").replace(ISO_TIME, "")).digest("hex").slice(0, 12) : "-");
    }
    return parts.join("|");
  } catch {
    return "?";
  }
}

export function runLoop(p: Paths, id: string, opts: RunnerOptions = {}): RunnerResult {
  const claude = opts.claude ?? "claude";
  const mode = opts.permissionMode ?? "auto";
  const maxRuns = opts.maxRuns ?? 20;
  const sleep = opts.sleep ?? sleepSync;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const env = opts.env ?? process.env;
  const logFile = join(p.run, "runner.log");
  mkdirSync(p.run, { recursive: true });
  const record = (line: string) => {
    log(line);
    appendFileSync(logFile, `${now().toISOString()} ${line}\n`);
  };

  let runs = 0;
  let waits = 0;
  let backoff = 0;
  let idle = 0;
  let last = fingerprint(p, id);
  const result = (outcome: RunnerOutcome, state: string, message: string): RunnerResult => {
    if (env.AIDW_RUN_DETACHED === "1") rmSync(pidFile(p), { force: true });
    record(`stop: ${outcome}: ${message}`);
    return { outcome, runs, waits, state, message };
  };

  for (;;) {
    if (archived(p, id)) return result("archived", "archived", `change ${id} is archived; the delivery package is in .aidw/archive/`);
    const change = loadChange(p, id);
    const state = stateOf(change) ?? String(change.data.state);
    if (state === "escalated") return result("escalated", state, "the change is escalated and needs your decision: open Claude Code and run /aidw:status");
    if (!DRIVABLE.has(state)) return result("needs_user", state, `state "${state}" needs you (approval or analysis); the runner continues only approved work`);

    if (state === "paused") {
      const reason = String((change.data.run as { paused?: { reason?: string } } | undefined)?.paused?.reason ?? "");
      const w = waitMs(reason, backoff++, now());
      waits++;
      record(`paused (${reason || "no reason"}): waiting ${Math.round(w.ms / MINUTE)} min, ${w.why}`);
      sleep(w.ms);
    }
    if (opts.preflight && (runs === 0 || state === "deploying")) {
      const problem = opts.preflight(state);
      if (problem) return result("needs_user", state, problem);
    }
    if (runs >= maxRuns) return result("max_runs", state, `${runs} sessions ran; raise --max-runs to continue`);

    const prompt = state === "delivered" ? `/aidw:deliver ${id}` : `/aidw:resume ${id}`;
    const args = ["-p", prompt, "--permission-mode", mode, ...(opts.keepMcp ? [] : ["--strict-mcp-config"]), ...(opts.extraArgs ?? [])];
    record(`session ${runs + 1}: ${claude} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    const r = spawnSync(claude, args, {
      cwd: p.project,
      encoding: "utf8",
      env: { ...process.env, ...(opts.env ?? {}), AIDW_RUNNER: "1" },
      timeout: opts.sessionTimeoutMs ?? 6 * 60 * MINUTE,
      maxBuffer: 64 * 1024 * 1024,
    });
    runs++;
    const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
    // the user's own settings warnings repeat in every session and bury the answer
    const tail = output.split("\n").filter((l) => !NOISE.test(l)).slice(-8).join("\n");
    record(`session ${runs} ended: exit ${r.status ?? r.error?.message ?? "?"}${tail ? `\n${tail.replace(/^/gm, "  | ")}` : ""}`);
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
      return result("claude_failed", state, `cannot run "${claude}": install Claude Code or pass --claude <path>`);
    }

    const after = loadChangeState(p, id);
    if (after !== "paused" && r.status !== 0 && LIMIT_TEXT.test(output)) {
      // The session hit a limit but nothing paused the change (e.g. the hook did not fire in -p mode).
      const w = waitMs(output, backoff++, now());
      waits++;
      record(`limit in the output: waiting ${Math.round(w.ms / MINUTE)} min, ${w.why}`);
      sleep(w.ms);
      continue;
    }
    const fp = fingerprint(p, id);
    if (after === "paused") {
      last = fp;
      continue;
    }
    if (fp === last) {
      idle++;
      if (idle >= 2) return result("no_progress", after, `two sessions in a row changed nothing (state ${after}); see .aidw/run/runner.log and run /aidw:status`);
    } else {
      idle = 0;
      backoff = 0;
    }
    last = fp;
  }
}

function loadChangeState(p: Paths, id: string): string {
  if (archived(p, id)) return "archived";
  try {
    return String(loadChange(p, id).data.state);
  } catch {
    return "?";
  }
}

const pidFile = (p: Paths): string => join(p.run, "runner.pid");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** pid of the background runner of this project, or null (a stale file is ignored). */
export function runnerPid(p: Paths): number | null {
  try {
    const pid = Number(readFileSync(pidFile(p), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * `aidw run --detach`: the same loop in a background process, so the user starts the unattended build with one line
 * in the window they are already in (`! aidw run <id> --detach`) and keeps the window. The child does not carry
 * CLAUDECODE: its headless sessions are real top-level Claude Code runs, outside the session that started it.
 */
export function detachRun(p: Paths, argv: string[], env: NodeJS.ProcessEnv): { pid: number; log: string } {
  const running = runnerPid(p);
  if (running) throw new Error(`a runner is already running here (pid ${running}); stop it with \`aidw run --stop\``);
  mkdirSync(p.run, { recursive: true });
  const log = join(p.run, "runner.log");
  const fd = openSync(log, "a");
  const clean = { ...env, AIDW_RUN_DETACHED: "1" } as NodeJS.ProcessEnv;
  delete clean.CLAUDECODE;
  const child = spawn(process.execPath, [process.argv[1] as string, ...argv], { cwd: p.project, detached: true, stdio: ["ignore", fd, fd], env: clean });
  child.unref();
  writeFileSync(pidFile(p), String(child.pid));
  return { pid: child.pid as number, log };
}

/** `aidw run --stop`: ends the background runner (a session in progress is killed; its task resumes later). */
export function stopRunner(p: Paths): number | null {
  const pid = runnerPid(p);
  if (!pid) return null;
  try {
    process.kill(-pid, "SIGTERM"); // the whole group: the runner and its claude session
  } catch {
    process.kill(pid, "SIGTERM");
  }
  rmSync(pidFile(p), { force: true });
  return pid;
}
