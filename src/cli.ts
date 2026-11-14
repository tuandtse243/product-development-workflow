import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeChange, idsAfterChange, mainSpecIds } from "./analyze.js";
import { approvalStatus, computeApprovalHash } from "./approval.js";
import { runBackstop } from "./backstop.js";
import { ChangeError, isState, listChangeIds, loadChange, resolveChangeId, stateOf, STATES } from "./change.js";
import { runGate } from "./gate.js";
import { pluginRoot } from "./plugin.js";
import { BrowserError, browserEnv, browserStatus, startBrowser, stopBrowser } from "./browser.js";
import { checkArtifacts } from "./artifacts.js";
import { boundaryOf } from "./boundary.js";
import { buildAuditBrief, chosenLenses, compileReport, lensRoles, pickFindings } from "./audit.js";
import { DecisionError, readDecisions, recordDecision, workflowOfChange } from "./decisions.js";
import { machineOf } from "./machine.js";
import { checkWorkflows, workflowIds } from "./workflow.js";
import { agentForTask, AGENTS, checkRoster, rosterTable, writeAgents } from "./roles.js";
import { checkChange, checkSpecs } from "./check.js";
import { Diags, type Diagnostic } from "./diag.js";
import {
  approve,
  archiveChange,
  createBaseline,
  hookCwd,
  offBranchNote,
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
import { findProject, pathsFor, readText, rel, type Paths } from "./project.js";
import { parseTasks, type Task } from "./tasks.js";
import { converge } from "./converge.js";
import { formatCost, parallelSavings, readSessions } from "./cost.js";
import { detectProject } from "./detect.js";
import { doctor, doctorText, drivesBrowser } from "./doctor.js";
import { createPr, planPr } from "./pr.js";
import { planAdvice, planShape, planSummary } from "./plan.js";
import { detachRun, runLoop, runnerPid, stopRunner } from "./runner.js";
import { deliver } from "./deliver.js";
import { deploy, parseQuality, qualityFile, recordLayerReview, verify } from "./quality.js";
import { firstDeploy } from "./firstdeploy.js";
import { reconcileDoneTasks, reopenTask } from "./run.js";
import { autoReview, buildBrief, buildTriageBrief, checkpoint, integrateChange, nextAction, parseVerdict, recordReview, recordTriage, retryTask, startTask, triageFile, type NextAction } from "./run.js";
import { VERSION } from "./version.js";

function reviewLine(r: { task: string; verdict: string; status: string; commit: string | null; warning?: string; conflict?: string }, verdict: string, notes: string): string {
  return `${r.task}: review ${r.verdict} -> ${r.status}${r.commit ? ` (commit ${r.commit.slice(0, 8)})` : ""}${r.warning ? `\n  warning: ${r.warning}` : ""}${
    r.conflict ? `\n  merge conflict (${r.conflict}): the task reruns sequentially` : ""
  }${verdict === "pass" && !notes.trim() ? "\n  note: no reviewer reply recorded; pass it with --notes-file so its non-blocking remarks reach the handoff" : ""}\n`;
}

/**
 * After a compaction the session forgets which change it was running. SessionStart with source "compact" is the
 * hook event whose stdout becomes context (PostCompact cannot inject any), so name the active change and the
 * orchestrator's next step. Null when nothing is in flight.
 */
function compactNote(cwd: string, env: NodeJS.ProcessEnv): string | null {
  const dir = findProject({ cwd, env });
  if (!dir) return null;
  const p = pathsFor(dir);
  const active: string[] = [];
  for (const id of listChangeIds(p)) {
    try {
      const st = stateOf(loadChange(p, id));
      if (st && !["draft", "delivered", "archived"].includes(st)) active.push(`${id}=${st}`);
    } catch {
      // unreadable change: skipped
    }
  }
  if (!active.length) return null;
  let next = "";
  try {
    const id = active[0]!.split("=")[0]!;
    next = ` Next: ${nextText(nextAction(p, id))}.`;
  } catch {
    // not in an execution state: status is enough
  }
  return `AIDW (context was compacted): ${active.join(", ")}.${next} All progress is in .aidw/ and git; run \`aidw status\` before acting, and \`/aidw:resume\` if the run was interrupted.`;
}

/** tasks.yaml of every change, active or archived. */
function changeTasks(p: Paths): Task[][] {
  const out: Task[][] = [];
  for (const base of [p.changes, p.archive]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) {
      const text = readText(join(base, d, "tasks.yaml"));
      if (text !== null) out.push(parseTasks(text).tasks);
    }
  }
  return out;
}

function nextText(n: NextAction): string {
  return n.action === "implement"
    ? `implement ${n.task} (${n.reason}): ${n.title}${n.reason === "interrupted" ? " (if an implementer you spawned for it has not reported yet, it is still running: wait for it, do not spawn another)" : ""}`
    : n.action === "review"
      ? `review ${n.task}: ${n.title}`
      : n.action === "triage"
        ? `triage ${n.task} (${n.reason}): \`aidw brief ${n.task} --for triage\`, spawn ${AGENTS.triage} with the brief, then \`aidw triage ${n.task}\``
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
  plan [<id>]                            shape of the task graph: stages and widest wave, advice to widen it
  pr [<id>] [--base B] [--create] [--draft]
                                         after delivery: print the pull request (title, summary, evidence, merge danger);
                                         --create pushes the change branch and opens it with gh (asks first)
  browser start [--headed] | status | url | stop
                                         the project's own test browser for the e2e, a11y, ui-ux and performance layers:
                                         Chrome on a free port it picks itself, one profile per project; layers get it
                                         as E2E_CDP_URL and E2E_CDP_PORT (no fixed 9222)
  doctor [<id>]                          check the machine for the run: binaries of the quality commands, package store, registry,
                                         Chrome CDP, Vercel login and link; exit 1 on a blocking problem
  detect                                 what the existing code uses (stack, package manager, suggested layers)
  baseline <capability> [--change <id>]  brownfield: skeleton spec of a capability's current behavior
  change new <id> [--title T] [--input-type ${INPUT_TYPES.join("|")}] [--workflow W]
  status [<id>]                          project and change status
  validate [<id>] [--strict]             validate specs and changes (all when no id)
  decide <decision> <answer> --reason R  record a Decision Point of the Workflow (the answer must be one of its options;
                                         several answers separated by commas where the decision allows)
  audit brief <lens> | report | picks <F-01,..>   the audit workflow: a brief for the reviewer of one lens, the report
                                         assembled from their answers, the picked findings as the request of a new change
  decisions [<id>]                       the Workflow's Decision Points of a change and their answers
  approve <id> [--auto]                  approve the Analysis package (hashes it); --auto: aidw approves a small change of
                                         a workflow with an automatic approval (bugfix), or reclassifies one that is too big
  approval check <id>                    exit 1 when the approved package drifted
  transition <id> <state|resume> [--reason R]
  merge <id> [--write]                   merge delta specs into .aidw/specs (dry run by default)
  archive <id>                           merge deltas and move a delivered change to archive/
  analyze [<id>]                         pre-gate consistency checks (analysis.md, task coverage)
  ids [<id>]                             requirement and scenario ids (after applying the change)
  vendor-path <upstream>/<skill>         absolute path of a vendored SKILL.md (e.g. pocock/grilling)
  plugin-path <path>                     absolute path of a plugin file (e.g. roles/software-architect/references/stack-pool.md)
  roster [--write]                       the factory's Roles; checks roster.yaml, role profiles, artifacts.yaml (one owner
                                         per artifact, reads/writes of each Role), workflows/*.yaml and the generated agent files
                                         (--write regenerates agents/ from roles/)

Execution (state executing; add --change <id> when several changes are active):
  next                                   what the orchestrator does next (implement | review | escalate | complete)
  task start <task> [--worktree]         mark a task running (counts attempts, records the base commit);
                                         --worktree: a wave task in its own git worktree
  integrate                              after a wave: verify the merged code; a failure adds a fix task

Unattended (in your own terminal, not inside Claude Code):
  run [<id>] [--detach] [--permission-mode M] [--max-runs N] [--claude BIN] [--keep-mcp] [-- <claude args>]
  run --status | --stop                  the background runner started with --detach
                                         loop \`claude -p "/aidw:resume <id>"\` until archived; waits out usage
                                         limits (stated reset time or 5-60 min backoff); stops on escalation
  triage <task> [--notes-file F]         a task out of attempts: record the architect's diagnosis from .aidw/run/triage-<task>.md
                                         (CAUSE: implementation -> one more attempt; anything else escalates with the diagnosis)
  task retry <task>                      user-granted fresh attempt budget for an escalated/failed task
  task reopen <task> [--revert]          a done task was wrong: back to pending (and git revert its commit with --revert)
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
  first-deploy [<id>] [--yes]            once per new Vercel project: the first deployment must be Production; you run it
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

const VALUE_FLAGS = new Set(["session", "last", "root", "title", "input-type", "workflow", "reason", "change", "for", "notes", "notes-file", "timeout", "layer", "permission-mode", "max-runs", "claude"]);

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

export { pluginRoot };

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
    // The commands that run layer or verify commands pass the project's test browser on to them (no fixed port).
    if (env === process.env) for (const [k, v] of Object.entries(browserEnv(p))) if (!process.env[k]) process.env[k] = v;
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
        try {
          // The one exception to printing nothing: a session opened off an unmerged change branch would read stale
          // .aidw/ state, so it gets told where the change lives.
          const stdin = io.stdin?.() ?? "";
          const where = hookCwd(stdin, cwd);
          let source = "";
          try {
            source = String((JSON.parse(stdin) as { source?: unknown }).source ?? "");
          } catch {
            // no hook JSON: not a compact
          }
          const notes = [offBranchNote(where, env), source === "compact" ? compactNote(where, env) : null].filter(Boolean);
          if (notes.length) io.out(`${notes.join("\n")}\n`);
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
        if (rest[0] !== "start" && rest[0] !== "retry" && rest[0] !== "reopen") throw new UsageError("usage: aidw task start|retry|reopen <task>");
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        if (rest[0] === "reopen") {
          const r = reopenTask(p, id, need(rest[1], "task id"), { revert: args.flags.revert === true });
          emit(
            { ok: true, change: id, ...r },
            `${r.task} reopened (pending, fresh attempt budget; quality results dropped)${r.reverted ? `; its commit ${r.reverted.slice(0, 8)} was reverted` : ""}\n${r.dependents.length ? `WARNING: done task(s) ${r.dependents.join(", ")} depend on it; reopen them too if they relied on the old code\n` : ""}`,
          );
          return 0;
        }
        if (rest[0] === "retry") {
          const r = retryTask(p, id, need(rest[1], "task id"));
          emit({ ok: true, change: id, ...r }, `${r.task}: retry granted (fresh attempt budget)\n`);
          return 0;
        }
        const r = startTask(p, id, need(rest[1], "task id"), { worktree: args.flags.worktree === true });
        const brief = buildBrief(p, id, r.task, "implement", join(pluginRoot(env), "library", "vendor"));
        const agent = agentForTask(pluginRoot(env), r.role);
        emit(
          { ok: true, change: id, ...r, agent, brief: brief.path },
          `${r.task} running: attempt ${r.attempt} of ${r.maxAttempts}${r.resumed ? " (resumed)" : ""}${r.base ? `, base ${r.base.slice(0, 8)}` : ""}${r.worktree ? `, worktree ${r.worktree}` : ""}\nbrief ${brief.path}\nSPAWN ${agent} with: Task brief: ${brief.path}. Read it and implement the task.\n`,
        );
        return 0;
      }

      case "brief":
      case "skills": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const kind = str(args.flags.for) ?? "implement";
        if (kind === "triage" && cmd === "brief") {
          const tb = buildTriageBrief(p, id, taskId);
          emit({ change: id, task: taskId, for: kind, path: tb.path }, `${tb.path}\nSPAWN ${AGENTS.triage} with: Triage brief: ${tb.path}. Read it and write your answer as it says.\nThen: aidw triage ${taskId}\n`);
          return 0;
        }
        if (kind !== "implement" && kind !== "review") throw new UsageError('--for must be "implement" or "review" (or "triage" for brief)');
        const b = buildBrief(p, id, taskId, kind, join(pluginRoot(env), "library", "vendor"));
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
            after = `review ${auto.task}: auto-passed (converge tests, or a layer fix its own reviewer judges again)${auto.commit ? ` (commit ${auto.commit.slice(0, 8)})` : ""}\n${nextLine(p, id)}${sessionEnd(env, p, id)}`;
          } else {
            reviewBrief = buildBrief(p, id, r.task, "review", join(pluginRoot(env), "library", "vendor")).path;
            after = `review brief ${reviewBrief}\nSPAWN ${AGENTS.taskReview} with: ${REVIEWER_PROMPT(reviewBrief)}\nThen: aidw verdict ${r.task}\n`;
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
          vendorDir: join(pluginRoot(env), "library", "vendor"),
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
        const saved = changeTasks(p).map((t) => parallelSavings(t)).filter((x): x is NonNullable<typeof x> => x !== null);
        const serial = saved.reduce((n, s) => n + s.serialMs, 0);
        const wall = saved.reduce((n, s) => n + s.wallMs, 0);
        const parallel = saved.length ? `\nparallel waves: ${saved.reduce((n, s) => n + s.wave, 0)} task(s) took ${Math.round(wall / 60000)} min of wall time instead of ${Math.round(serial / 60000)} min one after another (${serial ? Math.round((1 - wall / serial) * 100) : 0}% faster); tokens per task are the same\n` : "";
        emit({ project: p.project, sessions, parallel: saved }, formatCost(sessions) + parallel);
        return 0;
      }

      case "run": {
        const background = args.flags.detach === true || args.flags.stop === true || args.flags.status === true;
        if (env.CLAUDECODE === "1" && env.AIDW_RUNNER !== "1" && !background) {
          throw new OpError("`aidw run` starts Claude Code headless in a loop; run it in your own terminal, or in the background from here with `! aidw run <id> --detach`");
        }
        const p = project();
        if (args.flags.stop === true) {
          const pid = stopRunner(p);
          emit({ stopped: pid }, pid ? `stopped the background runner (pid ${pid}); run the same command again to continue\n` : "no background runner is running here\n");
          return 0;
        }
        if (args.flags.status === true) {
          const pid = runnerPid(p);
          emit({ running: pid }, pid ? `runner running (pid ${pid}); follow it: tail -f .aidw/run/runner.log\n` : "no background runner is running here\n");
          return 0;
        }
        const id = resolveChangeId(p, rest[0]);
        if (args.flags.detach === true) {
          const strip = argv.filter((a) => a !== "--detach");
          const d = detachRun(p, [...strip, ...(dashdash >= 0 ? ["--", ...passthrough] : [])], env);
          emit({ change: id, ...d }, `runner started in the background (pid ${d.pid}) for ${id}.\nFollow it: tail -f ${d.log}\nStatus: aidw run --status   Stop: aidw run --stop   (it also stops by itself when it needs you)\n`);
          return 0;
        }
        const maxRuns = str(args.flags["max-runs"]);
        if (maxRuns !== undefined && !(Number.isInteger(Number(maxRuns)) && Number(maxRuns) >= 1)) throw new UsageError("--max-runs must be a positive integer");
        let startedBrowser = false;
        const r = runLoop(p, id, {
          ...(str(args.flags.claude) ? { claude: str(args.flags.claude) as string } : {}),
          ...(str(args.flags["permission-mode"]) ? { permissionMode: str(args.flags["permission-mode"]) as string } : {}),
          ...(maxRuns ? { maxRuns: Number(maxRuns) } : {}),
          ...(args.flags["keep-mcp"] === true ? { keepMcp: true } : {}),
          // The runner runs outside the sandbox that wraps each session, so it hosts the test browser for them.
          prepare: () => {
            if (env.E2E_CDP_URL) return null; // the user's own browser
            const qtext = readText(qualityFile(loadChange(p, id)));
            const config = qtext === null ? null : parseQuality(qtext, "quality.yaml").config;
            if (!config || !drivesBrowser(config)) return null;
            try {
              const b = startBrowser(p, { env });
              if (b.started) {
                startedBrowser = true;
                if (!json) io.out(`[aidw run] test browser started at ${b.record?.url} for the sessions to connect to\n`);
              }
              return null;
            } catch (e) {
              return `the test browser could not start, even outside a session: ${(e as Error).message}`;
            }
          },
          onFinish: (outcome) => {
            if (startedBrowser && outcome === "archived") stopBrowser(p); // "denied" cannot happen here: the runner started it
          },
          preflight: () => {
            const bad = doctor(p, id, env).filter((c) => c.status === "fail");
            return bad.length ? `fix this first, then run the same command again: ${bad.map((c) => `${c.name}: ${c.detail}`).join("; ")}` : null;
          },
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

      case "first-deploy": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const r = firstDeploy(p, id, args.flags.yes === true);
        emit({ change: id, ...r }, `${r.ran ? `${r.ok ? "DEPLOYED" : "FAILED"} (${r.command})\n` : ""}${r.output}\n${r.ok && r.ran ? "Previews work from now on: run aidw deploy.\n" : ""}`);
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

      case "triage": {
        // The triage Agent wrote its answer to .aidw/run/triage-<task>.md; the rule of its cause is applied here.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const file = str(args.flags["notes-file"]) ?? triageFile(p, taskId);
        if (!existsSync(file)) throw new OpError(`no triage answer at ${file}: the Agent did not write it. Spawn it once more with \`aidw brief ${taskId} --for triage\``);
        const r = recordTriage(p, id, taskId, readFileSync(file, "utf8"));
        const first = r.diagnosis.split("\n").find((l) => l.trim()) ?? "";
        const line =
          r.outcome === "retry"
            ? `${r.task} triaged: the cause is the implementation. One further attempt is granted with the diagnosis in its brief: ${first}\n`
            : r.cause === "environment"
              ? `${r.task} triaged: the cause is the environment, so it escalated. What the user must fix: ${first}\n(full diagnosis: ${rel(p, file)})\n`
              : `${r.task} triaged: the cause is the ${r.cause}, so it escalated: the approved package would change and the user decides. ${first}\n(full diagnosis: ${rel(p, file)})\n`;
        emit({ ok: true, change: id, ...r }, `${line}${nextLine(p, id)}`);
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
        const file = join(pluginRoot(env), "library", "vendor", ...ref.split("/"), "SKILL.md");
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

      case "roster": {
        const root = pluginRoot(env);
        const written = args.flags.write === true ? writeAgents(root) : [];
        const d = checkRoster(root);
        d.add(checkArtifacts(root));
        d.add(checkWorkflows(root));
        const table = d.errors.length ? "" : rosterTable(root);
        const summary = `${d.errors.length ? "FAILED" : "OK"}: ${d.errors.length} error(s), ${d.warnings.length} warning(s)\n`;
        emit(
          { ok: d.errors.length === 0, written, ...diagsJson(d) },
          `${table}${written.length ? `wrote agents/: ${written.join(", ")}\n` : ""}${printDiags(d)}${summary}`,
        );
        return d.errors.length ? 1 : 0;
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

      case "plan": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const tasks = parseTasks(readText(join(loadChange(p, id).dir, "tasks.yaml")) ?? "").tasks;
        const shape = planShape(tasks);
        emit({ change: id, ...shape, summary: planSummary(tasks), advice: planAdvice(tasks) }, `${planSummary(tasks)}\n${planAdvice(tasks).map((a) => `  advice: ${a}\n`).join("")}`);
        return 0;
      }

      case "pr": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const base = str(args.flags.base);
        if (args.flags.create === true) {
          const r = createPr(p, id, { ...(base ? { base } : {}), draft: args.flags.draft === true });
          emit({ ok: true, change: id, url: r.url, title: r.plan.title }, `pull request opened: ${r.url}\n`);
          return 0;
        }
        const plan = planPr(p, id, base ? { base } : {});
        emit({ ok: true, change: id, title: plan.title, head: plan.head, base: plan.base, body: plan.body, commands: plan.commands }, `title: ${plan.title}\n\n${plan.body}\nTo open it (asks first): aidw pr --create [--base <branch>] [--draft]\n`);
        return 0;
      }

      case "browser": {
        const p = project();
        const sub = rest[0];
        if (sub === "start") {
          const r = startBrowser(p, { headed: args.flags.headed === true, env });
          emit({ ok: true, started: r.started, ...r.record }, `${r.started ? "started" : "already running"}: ${r.record?.url} (${r.browser}, pid ${r.record?.pid}, ${r.record?.headless ? "headless" : "headed"})\nlayers get it as E2E_CDP_URL and E2E_CDP_PORT; for your own shell: export E2E_CDP_URL=$(aidw browser url)\n`);
          return 0;
        }
        if (sub === "status") {
          const s = browserStatus(p);
          emit({ ok: s.running, ...s }, s.running ? `running: ${s.record?.url} (${s.browser}, pid ${s.record?.pid})\n` : s.record ? `not running: ${s.stale}\n` : "no test browser: run `aidw browser start`\n");
          return s.running ? 0 : 1;
        }
        if (sub === "url") {
          const s = browserStatus(p);
          if (!s.running || !s.record) throw new OpError("no test browser is running: run `aidw browser start`");
          emit({ url: s.record.url, port: s.record.port }, `${s.record.url}\n`);
          return 0;
        }
        if (sub === "stop") {
          const result = stopBrowser(p);
          if (result === "denied") throw new OpError("the test browser is running but this session may not stop it (the sandbox blocks signalling it): run `aidw browser stop` in your own terminal");
          emit({ ok: true, stopped: result === "stopped" }, result === "stopped" ? "test browser stopped\n" : "no test browser was running\n");
          return 0;
        }
        throw new UsageError("browser needs start, status, url or stop");
      }

      case "doctor": {
        const p = project();
        let id: string | null = rest[0] ?? null;
        if (!id) {
          try {
            id = resolveChangeId(p, undefined);
          } catch {
            id = null; // no change yet: machine checks only
          }
        }
        const checks = doctor(p, id, env);
        emit({ ok: !checks.some((c) => c.status === "fail"), change: id, checks }, doctorText(checks));
        return checks.some((c) => c.status === "fail") ? 1 : 0;
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
        const wf = str(args.flags.workflow);
        const dir = newChange(p, id, { title: str(args.flags.title), inputType: str(args.flags["input-type"]), ...(wf ? { workflow: wf, workflows: workflowIds(pluginRoot(env)), skipSpecs: boundaryOf(pluginRoot(env), wf)?.spec_changes === false } : {}) });
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
            const c = loadChange(p, id);
            if (isState(c.data.state) && machineOf(p, c).analysisRequired.has(c.data.state)) d.add(analyzeChange(p, id));
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

      case "decide": {
        // A Decision Point of the Workflow: the answer must be one of its options; the reason is shown at the next gate.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const name = need(rest[0], "decision id");
        try {
          const r = recordDecision(p, id, name, need(rest[1], "answer"), str(args.flags.reason) ?? "", pluginRoot(env));
          emit({ ok: true, change: id, decision: name, ...r.recorded }, `${id}: ${name} = ${[r.recorded.answer].flat().join(", ")} (${r.decision.decide}): ${r.recorded.reason}\n`);
          return 0;
        } catch (e) {
          if (e instanceof DecisionError) throw new OpError(e.message);
          throw e;
        }
      }

      case "audit": {
        // The audit Workflow: one brief per lens for its read-only reviewer, one report assembled from their answers.
        const p = project();
        const sub = need(rest[0], "brief | report | picks");
        const id = resolveChangeId(p, str(args.flags.change));
        const c = loadChange(p, id);
        const w = workflowOfChange(p, c, pluginRoot(env));
        const roles = lensRoles(w);
        if (!Object.keys(roles).length) throw new OpError(`change "${id}" runs under the "${w.id}" workflow, which is not an audit`);
        if (sub === "brief") {
          const lens = need(rest[1], "lens");
          const chosen = chosenLenses(p, id);
          if (!chosen) throw new OpError('no lenses decided: run `aidw decide audit-lenses <lens,lens> --reason "..."` first');
          if (!chosen.includes(lens)) throw new OpError(`lens "${lens}" was not decided for this audit (decided: ${chosen.join(", ")})`);
          const role = roles[lens] as string;
          const b = buildAuditBrief(p, id, lens, role);
          emit({ change: id, lens, agent: `aidw:${role}`, brief: b.path }, `${b.path}\nSPAWN aidw:${role} with: Audit brief: ${b.path}. Read it and write your answer as it says.\n`);
          return 0;
        }
        if (sub === "report") {
          const r = compileReport(p, id);
          const ok = r.diags.errors.length === 0;
          emit({ ok, change: id, report: ok ? rel(p, r.path) : null, findings: r.findings, ...diagsJson(r.diags) }, ok ? `${rel(p, r.path)}: ${r.findings.length} finding(s)\n` : `${printDiags(r.diags)}INCOMPLETE: every decided lens must answer\n`);
          return ok ? 0 : 1;
        }
        if (sub === "picks") {
          const picks = need(rest[1], "finding ids, e.g. F-01,F-03").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
          const r = pickFindings(p, id, picks);
          if (r.missing.length) throw new OpError(`no such finding: ${r.missing.join(", ")} (see the report: aidw audit report)`);
          emit({ ok: true, change: id, picks, request: r.text }, r.text);
          return 0;
        }
        throw new UsageError("usage: aidw audit brief <lens> | report | picks <F-01,F-02>");
      }

      case "decisions": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const c = loadChange(p, id);
        const w = workflowOfChange(p, c, pluginRoot(env));
        const all = readDecisions(c);
        const rows = w.decisions.map((x) => ({ id: x.id, decide: x.decide, options: x.options, required: x.required, recorded: all[x.id] ?? null }));
        emit(
          { change: id, workflow: w.id, decisions: rows },
          rows.length
            ? `${rows.map((r) => `${r.id.padEnd(20)} ${r.recorded ? `${[r.recorded.answer].flat().join(", ")}: ${r.recorded.reason}` : `(open: ${r.options.join(" | ")}${r.required ? ", required" : ""})`}`).join("\n")}\n`
            : `workflow ${w.id} has no decision points\n`,
        );
        return 0;
      }

      case "approve": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const auto = args.flags.auto === true;
        const { hash, files, by } = approve(p, id, auto ? { auto: { pluginRoot: pluginRoot(env) } } : {});
        const { kept, reopened } = reconcileDoneTasks(p, id);
        emit(
          { ok: true, id, hash, files, kept, reopened },
          `approved ${id}${by === "user" ? "" : ` by ${by}`}\n  ${hash}\n  covers ${files.length} file(s)\n${kept.length ? `  done work kept: ${kept.join(", ")}\n` : ""}${reopened.length ? `  edited tasks run again: ${reopened.join(", ")}\n` : ""}  cheapest build (about a quarter of the tokens): in your own terminal, ${join(pluginRoot(env), "bin", "aidw")} run ${id} --permission-mode auto\n`,
        );
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
        emit({ ok: true, id, ...r }, `${id}: ${r.from} -> ${r.to}${r.commit ? ` (committed .aidw/ ${r.commit.slice(0, 8)})` : ""}\n${(r.notes ?? []).map((n) => `  ${n}\n`).join("")}`);
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
    if (e instanceof OpError || e instanceof ChangeError || e instanceof BrowserError) {
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
