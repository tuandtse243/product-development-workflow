/**
 * `aidw run`: the headless auto-resume runner (slice S9, blueprint section 13 level 2, decision D-30).
 *
 * The user starts it in their own terminal, or the main session of an approved change starts it with `--detach` when
 * `aidw approve` routes the build to it (plan D2, src/buildroute.ts; the gate denies every other start). It
 * loops `claude -p "/aidw:resume <id>" --permission-mode <mode>` until the change is archived, needs the
 * user (escalated, before approval, tier-3 question), or stops making progress. After the Approval Gate the run
 * itself does not escalate (ADR-0014): a task that fails after Triage, an environment cause, a layer out of fix rounds
 * and the Agent-run cap all end in "not built" and the Change carries on towards its pull request, so the runner keeps
 * driving it until the pull request: archived after a ready one, or `draft` when it ended in a draft (or only its body,
 * when the push was not granted: a headless session cannot answer the push question, so it writes the body and the
 * user gets a NEXT, never a wait); `escalated` is left for what is never automatic (plan D14) and for a stop the user makes. When a session ends on a
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
import YAML from "yaml";
import { listChangeIds, loadChange, stateOf } from "./change.js";
import { prReadiness } from "./draft.js";
import { loadTasks } from "./run.js";
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
   * Before a deploy it goes to `deployBlocked` instead (T11): the deploy is recorded as failed and the run ends in a
   * draft pull request, not a stop.
   */
  preflight?: (state: string) => string | null;
  /**
   * The machine check failed right before a deploy: record a failed deploy carrying its message (the deploy command is
   * not run) and move the Change to delivered. A message means that failed too.
   */
  deployBlocked?: (problem: string) => string | null;
  /**
   * Host-side preparation, run by the runner itself before every session. The runner is the user's own process,
   * outside the sandbox that wraps each `claude -p` session, so it can do what a session cannot (launch Chrome).
   * A message means the preparation failed and the run needs the user. It runs before `preflight`, so the
   * machine check sees what it set up.
   */
  prepare?: (state: string) => string | null;
  /** called once with the final outcome, for cleanup (stopping what `prepare` started) */
  onFinish?: (outcome: RunnerOutcome) => void;
  maxRuns?: number;
  /** per-session limit; a hung session is killed and counts as a run */
  sessionTimeoutMs?: number;
  sleep?: (ms: number) => void;
  log?: (line: string) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

/** draft: the run ended in a draft pull request (or its body, when the push was not granted); /aidw:resume finishes it */
export type RunnerOutcome = "archived" | "draft" | "escalated" | "needs_user" | "no_progress" | "max_runs" | "claude_failed";

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

/** The pull request recorded for the Change (`run.pr`, src/pr.ts), read from the active or the archived change.yaml. */
function prOf(p: Paths, id: string): { url: string | null; draft: boolean } | null {
  const dirs = [join(p.changes, id), ...readdirNames(p.archive).filter((n) => n.endsWith(id)).map((n) => join(p.archive, n))];
  for (const dir of dirs) {
    const file = join(dir, "change.yaml");
    if (!existsSync(file)) continue;
    try {
      const pr = (YAML.parse(readFileSync(file, "utf8")) as { run?: { pr?: { url?: unknown; draft?: unknown } } } | null)?.run?.pr;
      return pr && typeof pr === "object" ? { url: typeof pr.url === "string" && pr.url ? pr.url : null, draft: pr.draft === true } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The end of the run in words, with the NEXT for the user (D12: the run always ends in a pull request). */
function prEnding(p: Paths, id: string, pr: { url: string | null; draft: boolean } | null): string {
  const body = `.aidw/run/pr-${id}.md`;
  if (!pr) return `no pull request was recorded: run \`aidw pr ${id}\` for its body`;
  const open = pr.url ? `pull request ${pr.url}${pr.draft ? " (draft)" : ""}` : `the pull request is not opened (the push was not granted at the Approval Gate); its body is in ${body}`;
  const create = pr.url ? "" : `open it with \`aidw pr ${id} --create${pr.draft ? " --draft" : ""}\` (it asks you); `;
  return pr.draft
    ? `${open}. NEXT: ${create}act on its "Needed from the user to finish", then \`/aidw:resume ${id}\` (or \`aidw run ${id}\`) finishes it and updates the same pull request`
    : `${open}${pr.url ? "" : `. NEXT: ${create}then \`aidw archive ${id}\``}`;
}

/** The delivered Change is ready now (computed again: a record written before a redelivery may be stale). */
function readyNow(p: Paths, id: string): boolean {
  try {
    const change = loadChange(p, id);
    return prReadiness(p, change, loadTasks(p, id).tasks).ready;
  } catch {
    return false;
  }
}

function readdirNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/** What counts as progress: state, task statuses, quality layers, converge and deploy evidence, Consultations. */
export function fingerprint(p: Paths, id: string): string {
  if (archived(p, id)) return "archived";
  try {
    const c = loadChange(p, id);
    // a Deviation opened or closed, and the package rehashed, are progress too
    const parts = [String(c.data.state), String((c.data.approval as { hash?: unknown } | null | undefined)?.hash ?? "-")];
    for (const f of ["tasks.yaml", "evidence/quality/summary.json", "evidence/converge.json", "evidence/deploy.json", "evidence/integration.json", "consultations.yaml", "deviations.yaml"]) {
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
  // the machine check runs once at the start (and again before every deploy session)
  let checked = false;
  let costUsd = 0;
  let costSessions = 0;
  let turns = 0;
  const result = (outcome: RunnerOutcome, state: string, message: string): RunnerResult => {
    if (runs > 0) record(`total: ${runs} session${runs === 1 ? "" : "s"}${costSessions ? `, ${money(costUsd)}${costSessions < runs ? ` (${costSessions} of ${runs} reported)` : ""}, ${turns} turns` : ", cost not reported"}`);
    if (env.AIDW_RUN_DETACHED === "1") rmSync(pidFile(p), { force: true });
    record(`stop: ${outcome}: ${message}`);
    try {
      opts.onFinish?.(outcome);
    } catch {
      /* cleanup must never hide the outcome */
    }
    return { outcome, runs, waits, state, message };
  };

  for (;;) {
    if (archived(p, id)) return result("archived", "archived", `change ${id} is archived; the delivery package is in .aidw/archive/; ${prEnding(p, id, prOf(p, id))}`);
    const change = loadChange(p, id);
    const state = stateOf(change) ?? String(change.data.state);
    // D12: a delivered Change whose pull request is a draft is where this run ends: the rest needs the user. A run
    // started on such a draft first resumes it (the session below), and ends here again once it is delivered.
    const pr = prOf(p, id);
    const ready = state === "delivered" && pr !== null && readyNow(p, id);
    if (state === "delivered" && pr && runs > 0) {
      if (!ready) return result("draft", state, `change ${id} is delivered as a draft; ${prEnding(p, id, { ...pr, draft: true })}`);
      // ready, but the push was not granted: the PR waits for the user, and so does the archive (it follows the PR)
      if (!pr.url) return result("needs_user", state, `change ${id} is delivered and ready; ${prEnding(p, id, { ...pr, draft: false })}`);
    }
    // Only what is never automatic (D14) or a stop the user made escalates after the gate: not-built work does not (ADR-0014).
    if (state === "escalated") return result("escalated", state, "the change is escalated and needs your decision: open Claude Code and run /aidw:status");
    if (!DRIVABLE.has(state)) return result("needs_user", state, `state "${state}" needs you (approval or analysis); the runner continues only approved work`);

    if (state === "paused") {
      const reason = String((change.data.run as { paused?: { reason?: string } } | undefined)?.paused?.reason ?? "");
      const w = waitMs(reason, backoff++, now());
      waits++;
      record(`paused (${reason || "no reason"}): waiting ${Math.round(w.ms / MINUTE)} min, ${w.why}`);
      sleep(w.ms);
    }
    if (opts.prepare) {
      const problem = opts.prepare(state);
      if (problem) return result("needs_user", state, problem);
    }
    if (opts.preflight && (!checked || state === "deploying")) {
      checked = true;
      const problem = opts.preflight(state);
      // D12, D14: a deploy that needs the user does not block the pull request: the session deploys, the deploy fails
      // with its hint, and the Change goes on to a draft that lists it under "Needed from the user to finish".
      if (problem && state === "deploying" && opts.deployBlocked) {
        // D12, D14: a deploy that needs the user does not block the pull request. No session is spent on a deploy that
        // cannot work: the runner records it as failed with the machine check's words and the Change is delivered;
        // the pull request opens as a draft that lists it under "Needed from the user to finish".
        const failed = opts.deployBlocked(problem);
        if (failed) return result("needs_user", state, `${problem} (${failed})`);
        record(`machine check before the deploy: ${problem}; recorded as a failed deploy, the Change goes on to a draft pull request`);
        continue;
      }
      if (problem) return result("needs_user", state, problem);
    }
    if (runs >= maxRuns) return result("max_runs", state, `${runs} sessions ran; raise --max-runs to continue`);

    const prompt = state === "delivered" && (!pr || ready) ? `/aidw:deliver ${id}` : `/aidw:resume ${id}`;
    const extra = opts.extraArgs ?? [];
    // json output carries the final message with the session's cost and turns; a caller's own --output-format wins
    const format = extra.some((x) => x === "--output-format" || x.startsWith("--output-format=")) ? [] : ["--output-format", "json"];
    const args = ["-p", prompt, "--permission-mode", mode, ...format, ...(opts.keepMcp ? [] : ["--strict-mcp-config"]), ...extra];
    record(`session ${runs + 1}: ${claude} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    const r = spawnSync(claude, args, {
      cwd: p.project,
      encoding: "utf8",
      env: { ...process.env, ...(opts.env ?? {}), AIDW_RUNNER: "1" },
      timeout: opts.sessionTimeoutMs ?? 6 * 60 * MINUTE,
      maxBuffer: 64 * 1024 * 1024,
    });
    runs++;
    const parsed = parseSessionJson(r.stdout ?? "");
    const output = parsed ? `${parsed.text}\n${r.stderr ?? ""}`.trim() : `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
    if (parsed?.cost != null) {
      costUsd += parsed.cost;
      costSessions++;
    }
    turns += parsed?.turns ?? 0;
    // the user's own settings warnings repeat in every session and bury the answer; the final message is kept whole
    const tail = output.split("\n").filter((l) => !NOISE.test(l)).join("\n").trim();
    const figures = [parsed?.cost != null ? money(parsed.cost) : "", parsed?.turns != null ? `${parsed.turns} turns` : ""].filter(Boolean).join(", ");
    record(`session ${runs} ended: exit ${r.status ?? r.error?.message ?? "?"}${figures ? `, ${figures}` : ""}${tail ? `\n${tail.replace(/^/gm, "  | ")}` : ""}`);
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

const money = (usd: number): string => `$${usd.toFixed(4)}`;

/** `claude -p --output-format json`: the final message, the cost and the turns; null when the output is not that JSON. */
export function parseSessionJson(stdout: string): { text: string; cost: number | null; turns: number | null } | null {
  try {
    const j = JSON.parse(stdout.trim()) as { result?: unknown; total_cost_usd?: unknown; num_turns?: unknown };
    if (!j || typeof j !== "object" || Array.isArray(j) || (j.result === undefined && j.total_cost_usd === undefined)) return null;
    return {
      text: typeof j.result === "string" ? j.result : "",
      cost: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null,
      turns: typeof j.num_turns === "number" ? j.num_turns : null,
    };
  } catch {
    return null;
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
