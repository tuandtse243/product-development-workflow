import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChange, idsAfterChange, mainSpecIds } from "./analyze.js";
import { approvalStatus, computeApprovalHash } from "./approval.js";
import { runBackstop } from "./backstop.js";
import { ChangeError, isState, listChangeIds, loadChange, NEEDS_ANALYSIS, resolveChangeId, STATES } from "./change.js";
import { runGate } from "./gate.js";
import { checkChange, checkSpecs } from "./check.js";
import { Diags, type Diagnostic } from "./diag.js";
import {
  approve,
  archiveChange,
  createBaseline,
  assertProject,
  initProject,
  INPUT_TYPES,
  newChange,
  OpError,
  planMerge,
  projectStatus,
  transition,
  writeMerge,
} from "./ops.js";
import { runStopFailure } from "./pause.js";
import { findProject, pathsFor, rel, type Paths } from "./project.js";
import { converge } from "./converge.js";
import { formatCost, readSessions } from "./cost.js";
import { detectProject } from "./detect.js";
import { runLoop } from "./runner.js";
import { deliver } from "./deliver.js";
import { deploy, recordLayerReview, verify } from "./quality.js";
import { autoReview, buildBrief, checkpoint, integrateChange, nextAction, parseVerdict, recordReview, retryTask, startTask, type NextAction } from "./run.js";
import { VERSION } from "./version.js";

function reviewLine(r: { task: string; verdict: string; status: string; commit: string | null; warning?: string; conflict?: string }, verdict: string, notes: string): string {
  return `${r.task}: review ${r.verdict} -> ${r.status}${r.commit ? ` (commit ${r.commit.slice(0, 8)})` : ""}${r.warning ? `\n  warning: ${r.warning}` : ""}${
    r.conflict ? `\n  merge conflict (${r.conflict}): the task reruns sequentially` : ""
  }${verdict === "pass" && !notes.trim() ? "\n  note: no reviewer reply recorded; pass it with --notes-file so its non-blocking remarks reach the handoff" : ""}\n`;
}

function nextText(n: NextAction): string {
  return n.action === "implement"
    ? `implement ${n.task} (${n.reason}): ${n.title}`
    : n.action === "review"
      ? `review ${n.task}: ${n.title}`
      : n.action === "escalate"
        ? `escalate: ${n.reason}`
        : n.action === "wave"
          ? `wave of ${n.tasks.length}: ${n.tasks.map((x) => `${x.task} (${x.title})`).join(", ")}`
          : n.action === "integrate"
            ? `integrate ${n.tasks.join(", ")}: run \`aidw integrate\` on the merged code`
            : `complete: all ${n.done} task(s) done`;
}

/** What to do next, printed after a state change so the orchestrator needs no separate `aidw next` turn. */
function nextLine(p: Paths, id: string): string {
  try {
    return `NEXT: ${nextText(nextAction(p, id))}\n`;
  } catch {
    return "";
  }
}

const REVIEWER_PROMPT = (path: string) => `Review brief: ${path}. Review the task and reply with the verdict.`;

/** Under `aidw run` every task gets a fresh session: the runner restarts claude, so the long context is dropped. */
const sessionEnd = (env: NodeJS.ProcessEnv, p: Paths, id: string): string => {
  if (env.AIDW_RUNNER !== "1") return "";
  try {
    if (nextAction(p, id).action === "complete") return "";
  } catch {
    return "";
  }
  return "END THIS SESSION: one task is done and committed. The runner (`aidw run`) starts a fresh session for the next one, which costs far less than carrying this context on. Reply with one line and stop; call no more tools.\n";
};

const HELP = `aidw ${VERSION} - deterministic core of the AI Fullstack Autonomous Development Workflow

Usage: aidw <command> [args] [--json] [--root <dir>]

  init                                   create .aidw/ in the current directory (or --root); detects brownfield
  detect                                 what the existing code uses (stack, package manager, suggested layers)
  baseline <capability> [--change <id>]  brownfield: skeleton spec of a capability's current behavior
  change new <id> [--title T] [--input-type ${INPUT_TYPES.join("|")}]
  status [<id>]                          project and change status
  validate [<id>] [--strict]             validate specs and changes (all when no id)
  approve <id>                           approve the Analysis package (hashes it)
  approval check <id>                    exit 1 when the approved package drifted
  transition <id> <state|resume> [--reason R]
  merge <id> [--write]                   merge delta specs into .aidw/specs (dry run by default)
  archive <id>                           merge deltas and move a delivered change to archive/
  analyze [<id>]                         pre-gate consistency checks (analysis.md, task coverage)
  ids [<id>]                             requirement and scenario ids (after applying the change)
  vendor-path <upstream>/<skill>         absolute path of a vendored SKILL.md (e.g. pocock/grilling)
  plugin-path <path>                     absolute path of a plugin file (e.g. profiles/stack-pool.md)

Execution (state executing; add --change <id> when several changes are active):
  next                                   what the orchestrator does next (implement | review | escalate | complete)
  task start <task> [--worktree]         mark a task running (counts attempts, records the base commit);
                                         --worktree: a wave task in its own git worktree
  integrate                              after a wave: verify the merged code; a failure adds a fix task

Unattended (in your own terminal, not inside Claude Code):
  run [<id>] [--permission-mode M] [--max-runs N] [--claude BIN] [-- <claude args>]
                                         loop \`claude -p "/aidw:resume <id>"\` until archived; waits out usage
                                         limits (stated reset time or 5-60 min backoff); stops on escalation
  task retry <task>                      user-granted fresh attempt budget for an escalated/failed task
  brief <task> [--for implement|review]  write the context packet for a fresh subagent; prints its path
  skills <task> [--for implement|review] vendored skills selected for the task
  checkpoint <task> [--timeout <sec>]    evidence: a test per scenario id + every verify command passes
  verdict <task> [--notes-file F]        record the reviewer's verdict from .aidw/run/review-<task>.md (first line VERDICT: pass|fix)
  review <task> pass|fix [--notes-file F | --notes T] [--no-commit]
                                         record the independent review; pass marks done and commits
  verify [--layer L] [--fresh]           (verifying) run quality layers not yet passing on the current code;
                                         a failing layer adds a fix task and returns the change to executing;
                                         a review layer (review: ui|security) stops with a brief for its reviewer
  layer-review <layer> [pass|fix] [--notes-file F | --notes T]   no verdict: read .aidw/run/layer-review-<layer>.md
                                         (verifying) record the layer reviewer's verdict; fix adds a fix task
  converge                               (converging) every changed scenario has a passing test; gaps become tasks
  deploy                                 (deploying) approved preview deploy + smoke checks, or record target none/local
  deliver [--check]                      (delivered) write the delivery package and check its checklist

Hooks:
  gate                                   PreToolUse hook: reads hook JSON on stdin
  backstop                               Stop hook: reads hook JSON on stdin
  stop-failure                           StopFailure hook: pauses running changes
  session-start                          SessionStart hook: appends the plugin bin/ to PATH via CLAUDE_ENV_FILE
  cost [--session <id prefix>] [--last N]  where the tokens of this project's Claude Code sessions went (orchestrator vs subagents)
  version

States: ${STATES.join(", ")}
Exit codes: 0 ok, 1 failed check or refused operation, 2 usage error
`;

interface Args {
  pos: string[];
  flags: Record<string, string | true>;
}

const VALUE_FLAGS = new Set(["session", "last", "root", "title", "input-type", "reason", "change", "for", "notes", "notes-file", "timeout", "layer", "permission-mode", "max-runs", "claude"]);

export function parseArgs(argv: string[]): Args {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq > 0) flags[name] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      flags[name] = v;
      i++;
    } else flags[name] = true;
  }
  return { pos, flags };
}

class UsageError extends Error {}

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  stdin?: () => string;
}

/** Root of the installed plugin (bin/ lives in it). */
export function pluginRoot(env: NodeJS.ProcessEnv): string {
  if (env.AIDW_PLUGIN_ROOT) return env.AIDW_PLUGIN_ROOT;
  if (typeof __dirname !== "undefined") return join(__dirname, "..");
  if (env.CLAUDE_PLUGIN_ROOT) return env.CLAUDE_PLUGIN_ROOT;
  return join(process.cwd(), "plugins", "aidw");
}

/**
 * Appends the plugin bin/ to the END of PATH via $CLAUDE_ENV_FILE, once. Appending keeps any shims the user puts
 * first (e.g. supply-chain guards); the name `aidw` collides with nothing. Exported for tests.
 */
export function addBinToPath(env: NodeJS.ProcessEnv): boolean {
  const file = env.CLAUDE_ENV_FILE;
  if (!file) return false;
  const bin = join(pluginRoot(env), "bin");
  if (bin.includes("'")) return false;
  const line = `export PATH="$PATH":'${bin}'`;
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split("\n").includes(line)) return false;
  appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`);
  return true;
}

/**
 * Opt-in hook trace for debugging real Claude Code runs: with AIDW_HOOK_LOG=<absolute file>, every hook call
 * appends one JSON line {at, hook, input, output}. Never throws: a hook must not fail because of its log.
 */
function logHook(env: NodeJS.ProcessEnv, hook: string, input: string, output: string): void {
  const file = env.AIDW_HOOK_LOG;
  if (!file) return;
  try {
    let parsed: unknown = input;
    try {
      parsed = JSON.parse(input);
    } catch {
      // keep the raw text
    }
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), hook, input: parsed, output: output || null })}\n`);
  } catch {
    // ignore
  }
}

function fmtDiag(d: Diagnostic): string {
  const where = d.line ? `${d.file}:${d.line}` : d.file;
  return `${d.level === "error" ? "ERROR" : "WARN "}  ${where}  ${d.message}`;
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function run(argv: string[], env: NodeJS.ProcessEnv, cwd: string, io: Io): number {
  let args: Args;
  // `aidw run <id> -- <claude args>`: everything after `--` goes to claude untouched.
  const dashdash = argv.indexOf("--");
  const passthrough = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
  if (dashdash >= 0) argv = argv.slice(0, dashdash);
  try {
    args = parseArgs(argv);
  } catch (e) {
    io.err(`aidw: ${(e as Error).message}\n`);
    return 2;
  }
  const json = args.flags.json === true;
  const [cmd, ...rest] = args.pos;
  const emit = (data: unknown, text: string) => io.out(json ? `${JSON.stringify(data, null, 2)}\n` : text);
  const diagsJson = (d: Diags) => ({ errors: d.errors, warnings: d.warnings });
  const printDiags = (d: Diags) => d.items.map(fmtDiag).join("\n") + (d.items.length ? "\n" : "");

  const project = (): Paths => {
    const dir = findProject({ root: str(args.flags.root), cwd, env });
    if (!dir) throw new OpError("no .aidw/ found in this directory or its parents; run `aidw init`");
    const p = pathsFor(dir);
    assertProject(p);
    return p;
  };
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new UsageError(`missing ${what}`);
    return v;
  };

  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "--help":
        io.out(HELP);
        return args.pos.length === 0 && !args.flags.help ? 2 : 0;

      case "session-start": {
        // SessionStart hook: append the plugin's bin/ to the PATH of Bash commands through CLAUDE_ENV_FILE, in
        // case Claude Code did not add it. Prints nothing: SessionStart stdout would become session context.
        try {
          addBinToPath(env);
        } catch {
          // never fail the hook
        }
        return 0;
      }

      case "version":
        emit({ version: VERSION }, `${VERSION}\n`);
        return 0;

      case "gate": {
        const input = io.stdin?.() ?? "";
        const out = runGate(input, env);
        logHook(env, cmd, input, out);
        io.out(out);
        return 0;
      }

      case "backstop": {
        const input = io.stdin?.() ?? "";
        const out = runBackstop(input, env);
        logHook(env, cmd, input, out);
        io.out(out);
        return 0;
      }

      case "stop-failure": {
        const input = io.stdin?.() ?? "";
        logHook(env, cmd, input, "");
        try {
          runStopFailure(input, env);
        } catch {
          // hook output is ignored; never fail the hook
        }
        return 0;
      }

      case "next": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const n = nextAction(p, id);
        emit({ change: id, ...n }, `${nextText(n)}\n`);
        return 0;
      }

      case "task": {
        if (rest[0] !== "start" && rest[0] !== "retry") throw new UsageError("usage: aidw task start|retry <task>");
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        if (rest[0] === "retry") {
          const r = retryTask(p, id, need(rest[1], "task id"));
          emit({ ok: true, change: id, ...r }, `${r.task}: retry granted (fresh attempt budget)\n`);
          return 0;
        }
        const r = startTask(p, id, need(rest[1], "task id"), { worktree: args.flags.worktree === true });
        const brief = buildBrief(p, id, r.task, "implement", join(pluginRoot(env), "vendor"));
        emit(
          { ok: true, change: id, ...r, brief: brief.path },
          `${r.task} running: attempt ${r.attempt} of ${r.maxAttempts}${r.resumed ? " (resumed)" : ""}${r.base ? `, base ${r.base.slice(0, 8)}` : ""}${r.worktree ? `, worktree ${r.worktree}` : ""}\nbrief ${brief.path}\nSPAWN aidw:implementer with: Task brief: ${brief.path}. Read it and implement the task.\n`,
        );
        return 0;
      }

      case "brief":
      case "skills": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const kind = str(args.flags.for) ?? "implement";
        if (kind !== "implement" && kind !== "review") throw new UsageError('--for must be "implement" or "review"');
        const b = buildBrief(p, id, taskId, kind, join(pluginRoot(env), "vendor"));
        if (cmd === "skills") {
          emit({ change: id, task: taskId, for: kind, skills: b.skills }, b.skills.map((s) => `${s.path}  # ${s.reason}\n`).join(""));
        } else {
          emit({ change: id, task: taskId, for: kind, path: b.path, skills: b.skills }, `${b.path}\n`);
        }
        return 0;
      }

      case "checkpoint": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const timeout = str(args.flags.timeout);
        if (timeout !== undefined && !(Number(timeout) > 0)) throw new UsageError("--timeout must be a number of seconds");
        const r = checkpoint(p, id, need(rest[0], "task id"), timeout ? { timeoutMs: Number(timeout) * 1000 } : {});
        const lines = [
          `${r.ok ? "PASS" : "FAIL"} ${r.task} -> ${r.status}  (evidence ${r.evidence})`,
          ...Object.entries(r.scenarios).map(([s, locs]) => `  ${locs.length ? "ok     " : "MISSING"} ${s}${locs.length ? `  ${locs[0]}` : ""}`),
          ...r.verify.map((v) => `  ${v.exit === 0 ? "ok     " : "FAILED "} ${v.command}  (${Math.round(v.ms / 1000)}s${v.timedOut ? ", timed out" : ""})`),
          ...(r.outside_touches.length ? [`  outside touches: ${r.outside_touches.join(", ")}`] : []),
          ...(r.design ? [`  design: ${r.design.screenshots.length} fresh screenshot(s), ${r.design.hardcoded_colors.length} stray color(s)`] : []),
          ...r.problems.map((x) => `  PROBLEM ${x}`),
        ];
        const failed = r.verify.find((v) => v.exit !== 0);
        let after = "";
        let reviewBrief: string | undefined;
        if (r.ok) {
          const auto = autoReview(p, id, r.task, r.changed_files);
          if (auto) {
            after = `review ${auto.task}: auto-passed (converge task, tests only)${auto.commit ? ` (commit ${auto.commit.slice(0, 8)})` : ""}\n${nextLine(p, id)}${sessionEnd(env, p, id)}`;
          } else {
            reviewBrief = buildBrief(p, id, r.task, "review", join(pluginRoot(env), "vendor")).path;
            after = `review brief ${reviewBrief}\nSPAWN aidw:reviewer with: ${REVIEWER_PROMPT(reviewBrief)}\nThen: aidw verdict ${r.task}\n`;
          }
        } else {
          after = nextLine(p, id);
        }
        emit({ change: id, ...r, ...(reviewBrief ? { review_brief: reviewBrief } : {}) }, `${lines.join("\n")}\n${failed ? `\n--- ${failed.command} (tail)\n${failed.tail}\n` : ""}${after}`);
        return r.ok ? 0 : 1;
      }

      case "verify": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const timeout = str(args.flags.timeout);
        if (timeout !== undefined && !(Number(timeout) > 0)) throw new UsageError("--timeout must be a number of seconds");
        const r = verify(p, id, {
          ...(str(args.flags.layer) ? { layer: str(args.flags.layer) as string } : {}),
          fresh: args.flags.fresh === true,
          ...(timeout ? { timeoutMs: Number(timeout) * 1000 } : {}),
          vendorDir: join(pluginRoot(env), "vendor"),
        });
        const lines = r.layers.map((l) => {
          const bad = l.runs.find((x) => x.exit !== 0);
          const mark = l.status === "pass" ? "ok     " : l.status === "fail" ? "FAILED " : l.status === "review" ? "REVIEW " : l.reused ? "ok     " : "skipped";
          return `  ${mark} ${l.name}${l.reused ? "  (passed earlier on this commit; --fresh reruns it)" : ""}${bad ? `  (${bad.command}${bad.timedOut ? ", timed out" : `, exit ${bad.exit}`})` : ""}`;
        });
        const failed = r.layers.find((l) => l.status === "fail")?.runs.find((x) => x.exit !== 0);
        const a = r.awaitingReview;
        emit(
          { change: id, ...r },
          `${r.ok ? "PASS" : a ? "REVIEW" : "FAIL"}: ${r.summary}\n${lines.join("\n")}\n${failed ? `\n--- ${failed.command} (tail)\n${failed.tail}\n` : ""}${
            a ? `\n  agent  ${a.agent}\n  brief  ${a.brief}\n  prompt Layer review brief: ${a.brief}. Review the layer and reply with the verdict.\n` : ""
          }`,
        );
        return r.ok ? 0 : 1;
      }

      case "layer-review": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const layer = need(rest[0], "layer name");
        let verdict = rest[1];
        let notesFile = str(args.flags["notes-file"]);
        if (verdict === undefined || verdict === "auto") {
          // The layer reviewer wrote its verdict to .aidw/run/layer-review-<layer>.md; read the verdict from it.
          notesFile = notesFile ?? join(p.run, `layer-review-${layer}.md`);
          if (!existsSync(notesFile)) throw new OpError(`no verdict file at ${notesFile}: the reviewer did not write it. Spawn a fresh reviewer, or save its reply there and run this again`);
          const parsed = parseVerdict(readFileSync(notesFile, "utf8"));
          if (!parsed) throw new OpError(`${notesFile} does not start with "VERDICT: pass" or "VERDICT: fix"; spawn a fresh reviewer once more`);
          verdict = parsed;
        }
        if (verdict !== "pass" && verdict !== "fix") throw new UsageError('verdict must be "pass" or "fix"');
        const notes = notesFile ? readFileSync(notesFile, "utf8") : (str(args.flags.notes) ?? "");
        if (verdict === "fix" && !notes.trim()) throw new UsageError("a fix verdict needs --notes or --notes-file");
        const r = recordLayerReview(p, id, layer, verdict, notes);
        emit(
          { ok: !r.escalated, change: id, ...r },
          `${r.layer}: ${r.kind} review ${r.verdict} -> ${r.summary}${
            verdict === "pass" && !notes.trim() ? "\n  note: no reviewer reply recorded; pass it with --notes-file so its non-blocking remarks reach the handoff" : ""
          }\n`,
        );
        return r.escalated ? 1 : 0;
      }

      case "cost": {
        const p = project();
        const prefix = str(args.flags.session);
        const last = str(args.flags.last);
        if (last !== undefined && !(Number.isInteger(Number(last)) && Number(last) >= 1)) throw new UsageError("--last must be a positive integer");
        let sessions = readSessions(p.project, env);
        if (prefix) sessions = sessions.filter((s) => s.id.startsWith(prefix));
        if (last) sessions = sessions.slice(-Number(last));
        emit({ project: p.project, sessions }, formatCost(sessions));
        return 0;
      }

      case "run": {
        if (env.CLAUDECODE === "1" && env.AIDW_RUNNER !== "1") {
          throw new OpError("`aidw run` starts Claude Code headless in a loop; run it in your own terminal, outside a Claude Code session");
        }
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const maxRuns = str(args.flags["max-runs"]);
        if (maxRuns !== undefined && !(Number.isInteger(Number(maxRuns)) && Number(maxRuns) >= 1)) throw new UsageError("--max-runs must be a positive integer");
        const r = runLoop(p, id, {
          ...(str(args.flags.claude) ? { claude: str(args.flags.claude) as string } : {}),
          ...(str(args.flags["permission-mode"]) ? { permissionMode: str(args.flags["permission-mode"]) as string } : {}),
          ...(maxRuns ? { maxRuns: Number(maxRuns) } : {}),
          extraArgs: passthrough,
          env,
          log: json ? () => {} : (line) => io.out(`[aidw run] ${line}\n`),
        });
        emit({ change: id, ...r }, `${r.outcome === "archived" ? "DONE" : "STOPPED"} (${r.outcome}) after ${r.runs} session(s), ${r.waits} wait(s): ${r.message}\n`);
        return r.outcome === "archived" ? 0 : r.outcome === "escalated" || r.outcome === "needs_user" ? 2 : 1;
      }

      case "integrate": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const r = integrateChange(p, id);
        const failed = r.runs.find((x) => x.exit !== 0);
        emit(
          { change: id, ...r },
          `${r.ok ? "PASS" : "FAIL"}: ${r.summary}\n${r.runs.map((x) => `  ${x.exit === 0 ? "ok     " : "FAILED "} ${x.command}`).join("\n")}\n${failed ? `\n--- ${failed.command} (tail)\n${failed.tail}\n` : ""}`,
        );
        return r.ok ? 0 : 1;
      }

      case "converge": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const r = converge(p, id);
        const lines = Object.entries(r.scenarios).map(([s, x]) => `  ${x.status === "pass" ? "ok     " : x.status.toUpperCase().padEnd(7)} ${s}${x.where[0] ? `  ${x.where[0]}` : ""}`);
        emit({ change: id, ...r }, `${r.ok ? "PASS" : "GAPS"} (${r.mode}): ${r.summary}\n${lines.join("\n")}\n`);
        return r.ok ? 0 : 1;
      }

      case "deliver": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const r = deliver(p, id, { check: args.flags.check === true });
        const ok = r.diags.errors.length === 0;
        const head = args.flags.check === true ? "" : `${r.dir}: wrote ${r.written.length} file(s)${r.created_handoff ? ", created handoff.md skeleton" : ""}, ${r.screenshots} screenshot(s)\n`;
        emit(
          { ok, change: id, dir: r.dir, written: r.written, created_handoff: r.created_handoff, screenshots: r.screenshots, ...diagsJson(r.diags) },
          `${head}${printDiags(r.diags)}${ok ? "delivery package complete" : "INCOMPLETE: fix the items above"}\n`,
        );
        return ok ? 0 : 1;
      }

      case "deploy": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const r = deploy(p, id);
        const text = r.skipped
          ? `deploy skipped: target "${r.target}" (recorded)\n`
          : r.ok
            ? `deployed ${r.url}\n${r.smoke.map((s) => `  ok      smoke ${s.command}`).join("\n")}\n`
            : `DEPLOY FAILED: ${r.error}\n${r.url ? `  url ${r.url}\n` : ""}\n${[...r.runs, ...r.smoke].find((x) => x.exit !== 0)?.tail ?? r.runs[0]?.tail ?? ""}\n`;
        emit({ change: id, ...r }, text);
        return r.ok ? 0 : 1;
      }

      case "review": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const verdict = need(rest[1], "verdict (pass|fix)");
        if (verdict !== "pass" && verdict !== "fix") throw new UsageError('verdict must be "pass" or "fix"');
        const notesFile = str(args.flags["notes-file"]);
        const notes = notesFile ? readFileSync(notesFile, "utf8") : (str(args.flags.notes) ?? "");
        if (verdict === "fix" && !notes.trim()) throw new UsageError("a fix verdict needs --notes or --notes-file");
        const r = recordReview(p, id, taskId, verdict, notes, { commit: args.flags["no-commit"] !== true });
        emit(
          { ok: true, change: id, ...r },
          `${reviewLine(r, verdict, notes)}${nextLine(p, id)}${r.status === "done" ? sessionEnd(env, p, id) : ""}`,
        );
        return 0;
      }

      case "verdict": {
        // The reviewer wrote its verdict to .aidw/run/review-<task>.md; read it from there.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const file = str(args.flags["notes-file"]) ?? join(p.run, `review-${taskId}.md`);
        if (!existsSync(file)) throw new OpError(`no verdict file at ${file}: the reviewer did not write it. Spawn a fresh reviewer, or save its reply there and run this again`);
        const notes = readFileSync(file, "utf8");
        const verdict = parseVerdict(notes);
        if (!verdict) throw new OpError(`${file} does not start with "VERDICT: pass" or "VERDICT: fix"; spawn a fresh reviewer once more, and if it is still unclear record it with \`aidw review ${taskId} fix --notes-file\``);
        const r = recordReview(p, id, taskId, verdict, notes, { commit: args.flags["no-commit"] !== true });
        emit(
          { ok: true, change: id, ...r },
          `${reviewLine(r, verdict, notes)}${nextLine(p, id)}${r.status === "done" ? sessionEnd(env, p, id) : ""}`,
        );
        return 0;
      }

      case "vendor-path": {
        const ref = need(rest[0], "<upstream>/<skill>");
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(ref)) throw new UsageError(`invalid vendored skill "${ref}"`);
        const file = join(pluginRoot(env), "vendor", ...ref.split("/"), "SKILL.md");
        if (!existsSync(file)) throw new OpError(`vendored skill "${ref}" not found at ${file}`);
        emit({ path: file }, `${file}\n`);
        return 0;
      }

      case "plugin-path": {
        const ref = need(rest[0], "relative path inside the plugin");
        if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(ref) || ref.split("/").includes("..")) {
          throw new UsageError(`invalid plugin path "${ref}"`);
        }
        const file = join(pluginRoot(env), ...ref.split("/"));
        if (!existsSync(file)) throw new OpError(`"${ref}" not found in the plugin (${file})`);
        emit({ path: file }, `${file}\n`);
        return 0;
      }

      case "analyze": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const d = analyzeChange(p, id);
        const summary = `${d.errors.length ? "FAILED" : "OK"}: ${d.errors.length} error(s), ${d.warnings.length} warning(s)\n`;
        emit({ ok: d.errors.length === 0, id, ...diagsJson(d) }, printDiags(d) + summary);
        return d.errors.length ? 1 : 0;
      }

      case "ids": {
        const p = project();
        const id = rest[0] ?? (listChangeIds(p).length === 1 ? listChangeIds(p)[0] : undefined);
        let requirements: string[];
        let scenarios: string[];
        let changed: { requirements: string[]; scenarios: string[] } | undefined;
        if (id) {
          const r = idsAfterChange(p, id);
          requirements = [...r.ids.requirements].sort();
          scenarios = [...r.ids.scenarios].sort();
          changed = { requirements: [...r.changed.requirements].sort(), scenarios: [...r.changed.scenarios].sort() };
        } else {
          const all = mainSpecIds(p);
          requirements = [...all.requirements].sort();
          scenarios = [...all.scenarios].sort();
        }
        const mark = (x: string, set?: string[]) => (set?.includes(x) ? "* " : "  ");
        const text = [
          `requirements${id ? ` (after ${id}; * = changed)` : ""}`,
          ...requirements.map((r) => `${mark(r, changed?.requirements)}${r}`),
          "scenarios",
          ...scenarios.map((s) => `${mark(s, changed?.scenarios)}${s}`),
        ].join("\n");
        emit({ change: id ?? null, requirements, scenarios, changed: changed ?? null }, `${text}\n`);
        return 0;
      }

      case "init": {
        const dir = str(args.flags.root) ?? cwd;
        const { created, detection: d } = initProject(dir);
        emit(
          { ok: true, created, detection: d },
          `initialized .aidw/ (${created.length} files): ${d.kind}\n${
            d.kind === "brownfield"
              ? `${d.signals.map((s) => `  signal  ${s}\n`).join("")}${Object.entries(d.stack).map(([k, v]) => `  stack   ${k}: ${v}\n`).join("")}  (recorded in .aidw/project.yaml; the existing stack is kept)\n`
              : ""
          }${d.warnings.map((w) => `  WARNING ${w}\n`).join("")}`,
        );
        return 0;
      }

      case "detect": {
        const dir = findProject({ root: str(args.flags.root), cwd, env }) ?? str(args.flags.root) ?? cwd;
        const d = detectProject(dir);
        const text = [
          `${d.kind}${d.packageManager ? ` (${d.packageManager})` : ""}${d.languages.length ? `, ${d.languages.join(", ")}` : ""}`,
          ...d.signals.map((s) => `  signal  ${s}`),
          ...Object.entries(d.stack).map(([k, v]) => `  stack   ${k}: ${v}`),
          ...d.layers.map((l) => `  layer   ${l.name}: ${l.run.join(" && ")}`),
          ...d.warnings.map((w) => `  WARNING ${w}`),
        ];
        emit(d, `${text.join("\n")}\n`);
        return 0;
      }

      case "baseline": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const file = createBaseline(p, id, need(rest[0], "capability"));
        emit({ ok: true, change: id, file: rel(p, file) }, `wrote baseline skeleton ${rel(p, file)}: describe the current behavior, then aidw analyze ${id}\n`);
        return 0;
      }

      case "change": {
        if (rest[0] !== "new") throw new UsageError("usage: aidw change new <id>");
        const p = project();
        const id = need(rest[1], "change id");
        const dir = newChange(p, id, { title: str(args.flags.title), inputType: str(args.flags["input-type"]) });
        emit({ ok: true, id, dir: rel(p, dir) }, `created change ${id} at ${rel(p, dir)}\n`);
        return 0;
      }

      case "status": {
        const p = project();
        const s = projectStatus(p, rest[0]);
        const lines = [
          `project  ${s.project}`,
          `specs    ${s.specs.capabilities} capabilities, ${s.specs.requirements} requirements`,
          s.changes.length ? "changes" : "changes  (none)",
          ...s.changes.map((c) => {
            if (c.error) return `  ${c.id}  ERROR ${c.error}`;
            const tasks = c.tasks ? `tasks ${c.tasks.done}/${c.tasks.total}` : "no tasks";
            const paused = c.paused ? `  paused(${c.paused.reason ?? "?"})` : "";
            const appr = c.approval === "drift" ? "APPROVAL DRIFT" : `approval ${c.approval}`;
            return `  ${c.id}  [${c.state}]  ${appr}  ${tasks}  deltas ${c.deltas}${paused}`;
          }),
        ];
        emit(s, `${lines.join("\n")}\n`);
        return 0;
      }

      case "validate": {
        const p = project();
        const d = new Diags();
        const checkOne = (id: string) => {
          d.add(checkChange(p, id));
          // Once the package is presented for approval, analyze findings are validation errors too.
          try {
            const state = loadChange(p, id).data.state;
            if (isState(state) && NEEDS_ANALYSIS.has(state)) d.add(analyzeChange(p, id));
          } catch {
            // load errors are already reported by checkChange
          }
        };
        if (rest[0]) checkOne(rest[0]);
        else {
          d.add(checkSpecs(p));
          for (const id of listChangeIds(p)) checkOne(id);
        }
        const strict = args.flags.strict === true;
        const failed = d.failed(strict);
        const summary = `${failed ? "FAILED" : "OK"}: ${d.errors.length} error(s), ${d.warnings.length} warning(s)${strict ? " (strict)" : ""}\n`;
        emit({ ok: !failed, strict, ...diagsJson(d) }, printDiags(d) + summary);
        return failed ? 1 : 0;
      }

      case "approve": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const { hash, files } = approve(p, id);
        emit({ ok: true, id, hash, files }, `approved ${id}\n  ${hash}\n  covers ${files.length} file(s)\n`);
        return 0;
      }

      case "approval": {
        if (rest[0] !== "check") throw new UsageError("usage: aidw approval check <id>");
        const p = project();
        const id = resolveChangeId(p, rest[1]);
        const c = loadChange(p, id);
        const a = approvalStatus(p, c);
        const files = computeApprovalHash(p, c).files;
        emit(
          { ok: a.status === "valid", id, ...a, files },
          a.status === "valid"
            ? `approval valid for ${id}\n`
            : a.status === "none"
              ? `${id} has no approval\n`
              : `APPROVAL DRIFT for ${id}\n  approved ${a.expected}\n  current  ${a.actual}\n`,
        );
        return a.status === "valid" ? 0 : 1;
      }

      case "transition": {
        const p = project();
        const id = need(rest[0], "change id");
        const to = need(rest[1], "target state");
        const r = transition(p, id, to, { reason: str(args.flags.reason) });
        emit({ ok: true, id, ...r }, `${id}: ${r.from} -> ${r.to}${r.commit ? ` (committed .aidw/ ${r.commit.slice(0, 8)})` : ""}\n`);
        return 0;
      }

      case "merge": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const merges = planMerge(p, id);
        const write = args.flags.write === true;
        if (write) writeMerge(merges);
        const lines = merges.map((m) => {
          const s = m.summary;
          const parts = [
            s.added.length && `+${s.added.length} added`,
            s.modified.length && `~${s.modified.length} modified`,
            s.removed.length && `-${s.removed.length} removed`,
            s.renamed.length && `${s.renamed.length} renamed`,
          ].filter(Boolean);
          return `  ${m.capability}${m.created ? " (new)" : ""}: ${parts.join(", ") || "no changes"}`;
        });
        emit(
          { ok: true, id, written: write, merges: merges.map(({ text: _t, file, ...m }) => ({ ...m, file: rel(p, file) })) },
          `${write ? "merged" : "dry run (use --write to apply)"}: ${id}\n${lines.join("\n")}\n`,
        );
        return 0;
      }

      case "archive": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const { target, merges, commit } = archiveChange(p, id);
        emit(
          { ok: true, id, archived: rel(p, target), capabilities: merges.map((m) => m.capability), commit: commit ?? null },
          `archived ${id} -> ${rel(p, target)} (${merges.length} capability spec(s) updated)${commit ? `, committed ${commit.slice(0, 8)}` : ""}\n`,
        );
        return 0;
      }

      default:
        throw new UsageError(`unknown command "${cmd}"`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`aidw: ${e.message}\n\n${HELP}`);
      return 2;
    }
    if (e instanceof OpError || e instanceof ChangeError) {
      const d = e instanceof OpError ? e.diags : undefined;
      if (json) io.out(`${JSON.stringify({ ok: false, error: e.message, ...(d ? diagsJson(d) : {}) }, null, 2)}\n`);
      else io.err(`aidw: ${e.message}\n${d ? printDiags(d) : ""}`);
      return 1;
    }
    throw e;
  }
}

// Entry point when executed as the bundled bin (not when imported by tests).
if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = run(process.argv.slice(2), process.env, process.cwd(), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    stdin: () => {
      try {
        return readFileSync(0, "utf8");
      } catch {
        return "";
      }
    },
  });
}
