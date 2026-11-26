import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { stringify as toYaml } from "yaml";
import { answersText, PAGE_NAME, pageDataFile, pageHtmlFile, pagesDir, pageSummary, parseAnswers, parsePage, picksData, renderPage, triageData, type PageSection } from "./page.js";
import { coverageReport, diffCoverage, trunkBase } from "./diffcover.js";
import { loadTasks } from "./run.js";
import { skillPath } from "./skills.js";
import { analyzeChange, idsAfterChange, mainSpecIds } from "./analyze.js";
import { beforeAfterSection } from "./beforeafter.js";
import { PROGRAM_DESIGN_FILE, programDesignSection } from "./programdesign.js";
import { approvalStatus, computeApprovalHash } from "./approval.js";
import { runBackstop } from "./backstop.js";
import { ChangeError, isState, listChangeIds, loadChange, resolveChangeId, stateOf, STATES } from "./change.js";
import { runGate } from "./gate.js";
import { pluginRoot, resolvePluginFile } from "./plugin.js";
import { installRunner } from "./installcheck.js";
import { BrowserError, browserEnv, browserStatus, startBrowser, stopBrowser, usesOwnBrowser } from "./browser.js";
import { checkArtifacts } from "./artifacts.js";
import { checkDocsBrief, parseDocsRef } from "./docsbrief.js";
import { fetchFont, runShotsWorker, SHOTS_WORKER, takeShots } from "./mock.js";
import { boundaryOf } from "./boundary.js";
import { buildAuditBrief, chosenLenses, compileReport, lensRoles, pickFindings } from "./audit.js";
import { DecisionError, readDecisions, recordDecision, workflowOfChange } from "./decisions.js";
import { defaultWorkflowId, machineOf } from "./machine.js";
import { packsFor } from "./stackpacks.js";
import { git } from "./git.js";
import { checkEvals, loadEvalCases } from "./evals.js";
import { claudeExec, mergeResults, printResults, runCases, takeDigests, writeResults, type CaseResult, type Exec, type RunDigests } from "./evalrun.js";
import { checkWorkflows, loadWorkflow, workflowIds } from "./workflow.js";
import { agentForTask, AGENTS, checkRoster, loadRoster, rosterTable, tierModel, writeAgents } from "./roles.js";
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
  raiseCap,
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
import { createPr, planPr, prNext, writePrBody } from "./pr.js";
import { grantsSection } from "./grants.js";
import { planAdvice, planShape, planSummary } from "./plan.js";
import { buildRoute, installedOutside, tasksLeft } from "./buildroute.js";
import { detachRun, runLoop, runnerPid, stopRunner } from "./runner.js";
import { deliver } from "./deliver.js";
import { deploy, parseQuality, qualityFile, recordBlockedDeploy, recordLayerReview, verify } from "./quality.js";
import { firstDeploy } from "./firstdeploy.js";
import { markNotBuilt, recordBlocked, reconcileDoneTasks, reopenTask, settleChange } from "./run.js";
import { autoReview, buildBrief, buildTriageBrief, buildUpstreamBrief, checkpoint, integrateChange, MAX_UPSTREAM_ROUNDS, nextAction, parseVerdict, recordReview, recordTriage, recordUpstream, retryTask, startTask, triageFile, type ConsultAction, type DeviationAction, type NextAction } from "./run.js";
import { agentRunStatus, countAgentRun, type AgentRunKind } from "./agentruns.js";
import { recordStageDone, stagesNext, stagesView } from "./stages.js";
import { changeOfRequest, consultNextText, unansweredSection, pendingConsultation, recordAnswer, requestConsultation, resumeConsultation } from "./consult.js";
import { abandonDeviation, closeDeviation, finishDeviations, openDeviationFor } from "./deviation.js";
import { loadDeviations } from "./deviationrecord.js";
import { buildPlanReviewBrief, MAX_FIX_ROUNDS, openFindingsSection, recordPlanReview } from "./planreview.js";
import { buildConflictBrief, buildMergeReviewBrief, resolveConflict } from "./conflict.js";
import { VERSION } from "./version.js";

function reviewLine(r: { task: string; verdict: string; status: string; commit: string | null; warning?: string; conflict?: string }, verdict: string, notes: string): string {
  return `${r.task}: review ${r.verdict} -> ${r.status}${r.commit ? ` (commit ${r.commit.slice(0, 8)})` : ""}${r.warning ? `\n  warning: ${r.warning}` : ""}${
    r.conflict ? `\n  merge conflict (${r.conflict}): ${r.status === "conflict" ? "the integration Role resolves it" : "the task reruns sequentially"}` : ""
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

/** A Consultation in flight, and what the rest of the Change does meanwhile, in the same message (ADR-0013). */
function consultText(n: ConsultAction): string {
  const asker = `${n.from} (${n.task ?? `stage ${n.stage}`})`;
  const step =
    n.step === "answer"
      ? `consultation ${n.consultation}: ${asker} asks ${n.to}; spawn aidw:${n.to} with: Consultation brief: ${n.brief}. Read it and answer as it says. (If you already spawned it and it has not replied, wait for it.) Then \`aidw consult answer ${n.consultation}\``
      : n.step === "record"
        ? `consultation ${n.consultation}: ${n.to} wrote its answer; run \`aidw consult answer ${n.consultation}\` (do not spawn it again)`
        : n.step === "deviation"
          ? `consultation ${n.consultation} needs a Deviation: ${n.to} could not answer without changing what was approved. Read its answer, then \`aidw deviation open --role <the Role that wrote the file> --files <the approved files it names> --reason "<why>" --consultation ${n.consultation}\` (ADR-0014; the user is not asked). If nothing approved has to change after all, resume the asker: \`aidw consult resume ${n.consultation}\``
        : `consultation ${n.consultation} is ${n.status}: resume ${asker} with \`aidw consult resume ${n.consultation}\``;
  return n.meanwhile ? `${step}. Meanwhile, in the same message: ${nextText(n.meanwhile)}` : step;
}

/** An open Deviation, and the work already in flight beside it. */
function deviationText(n: DeviationAction): string {
  const roles = [...new Set(Object.values(n.authors))];
  const step = `Deviation ${n.deviation} is open (${Object.entries(n.authors).map(([f, r]) => `${f}: ${r}`).join(", ")}): spawn ${roles.map((r) => `aidw:${r}`).join(" and ")} with: Deviation brief: ${n.brief}. Read it and change only your files under its three rules. (If you already spawned it and it has not replied, wait.) Then \`aidw deviation close\` (add --remove-reason "..." when an approved scenario was removed and the author said why)`;
  return n.meanwhile ? `${step}. Meanwhile, in the same message: ${nextText(n.meanwhile)}` : step;
}

function nextText(n: NextAction): string {
  if (n.action === "deviation") return deviationText(n);
  return n.action === "implement"
    ? `implement ${n.task} (${n.reason}): ${n.title}${n.reason === "interrupted" ? " (if an implementer you spawned for it has not reported yet, it is still running: wait for it, do not spawn another)" : ""}`
    : n.action === "review"
      ? `review ${n.task}: ${n.title}`
      : n.action === "resolve"
        ? `resolve the merge conflict of ${n.task} with ${n.with.join(", ") || "the change branch"} (${n.files.join(", ")}): \`aidw brief ${n.task} --for conflict\`, spawn aidw:integration with the brief, then \`aidw resolve ${n.task}\``
      : n.action === "review-merge"
        ? `review the merge of ${n.task} with ${n.with.join(", ") || "the change branch"}: \`aidw brief ${n.task} --for merge-review\`, spawn ${AGENTS.taskReview} with the brief, then \`aidw verdict ${n.task}\``
      : n.action === "consult"
        ? consultText(n)
      : n.action === "triage"
        ? `triage ${n.task} (${n.reason}): \`aidw brief ${n.task} --for triage\`, spawn ${AGENTS.triage} with the brief, then \`aidw triage ${n.task}\``
      : n.action === "upstream"
        ? n.step === "author"
          ? `upstream round ${n.round} of ${MAX_UPSTREAM_ROUNDS} for ${n.task}: Deviation ${n.deviation} is open for the ${n.role}; spawn aidw:${n.role} with: Upstream brief: ${n.brief}. Read it and fix your Artifact as it says. (If you already spawned it and it has not replied, wait.) Then \`aidw deviation close\` and \`aidw upstream ${n.task}\` (CANNOT FIX: \`aidw upstream ${n.task} --cannot "<its reason>"\`)`
          : `upstream round ${n.round} of ${MAX_UPSTREAM_ROUNDS} for ${n.task} (Triage cause: ${n.cause}): \`aidw brief ${n.task} --for upstream\` opens the Deviation and prints the brief; spawn aidw:${n.role} with it, then \`aidw deviation close\` and \`aidw upstream ${n.task}\``
        : n.action === "escalate"
        ? `escalate: ${n.reason}`
        : n.action === "wave"
          ? `wave of ${n.tasks.length}: ${n.tasks.map((x) => `${x.task} (${x.title})`).join(", ")}`
          : n.action === "integrate"
            ? `integrate ${n.tasks.join(", ")}: run \`aidw integrate\` on the merged code`
            : n.not_built?.length
              ? `complete: ${n.done} task(s) done, not built: ${n.not_built.join(", ")} (the reasons are in tasks.yaml; the pull request lists them). Go on to verify.`
              : `complete: all ${n.done} task(s) done`;
}

/** D10: one Agent run the CLI is about to print a SPAWN line for (src/agentruns.ts); the same key is counted once. */
function spawned(p: Paths, id: string, kind: AgentRunKind, key: string, task?: string): void {
  try {
    countAgentRun(loadChange(p, id), kind, key, task);
  } catch {
    // counting never blocks the run
  }
}

/** A task's runtime field, for the key of an Agent run. */
function taskField(p: Paths, id: string, taskId: string, field: string): string {
  try {
    const v = loadTasks(p, id).tasks.find((t) => t.id === taskId)?.[field];
    return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return "";
  }
}

/** After a state change: what the run decides by itself first (not built, the cap: src/run.ts settleChange), then nextLine. */
function settledNextLine(p: Paths, id: string): string {
  try {
    settleChange(p, id);
  } catch {
    // not executing, or nothing to settle
  }
  return nextLine(p, id);
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
  mock font "<family>" [--weights 400,700] [--italic] [--to DIR]
                                         download an OFL font from Fontsource into DIR (default .aidw/design/mock/fonts):
                                         woff2 per weight and subset (latin, latin-ext, vietnamese), <id>.css, SOURCE.md
  mock shots <dir> [--full]              screenshot every .html in a mock folder at 1440 and 390 px, light and dark, in
                                         the test browser (aidw browser start); PNGs go to <dir>/shots/
  doctor [<id>] [--fresh]                check the machine for the run: binaries of the quality commands, package store, registry,
                                         a real test install (retried; --fresh ignores a recent pass), Chrome CDP, Vercel login and
                                         link; exit 1 on a blocking problem
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
  stages [<id>] [--done <stage>]         the Analysis stages: done, ready, and the group that may run in parallel now
                                         (no read/write overlap, one browser user, parallel.max); --done reports one finished
  page render <name> [--stdin]           a Decision Page from .aidw/run/pages/<name>.yaml (questions | picks | gate): prints its link
  page answers <name> [--text T]         check the text the user copied from the page (or on stdin) before recording it
  page audit [--lang vi]                 the audit findings as a pick list; its answer feeds \`aidw audit picks\`
  page triage <task> [--lang vi]         the decision an escalated task asks of the user, from its triage diagnosis
  approve <id> [--auto]                  approve the Analysis package (hashes it); --auto: aidw approves a small change of
                                         a workflow with an automatic approval (bugfix), or reclassifies one that is too big
  approval check <id>                    exit 1 when the approved package drifted
  transition <id> <state|resume> [--reason R]
  merge <id> [--write]                   merge delta specs into .aidw/specs (dry run by default)
  archive <id> [--force]                 merge deltas and move a delivered change to archive/; when its pull request
                                         was opened with the push grant, the archive commit is pushed to it too. A
                                         draft (something not built, a failed deploy) is kept open for /aidw:resume;
                                         --force archives it as it is
  pr [<id>] [--create [--draft]] [--base B]
                                         the pull request the run ends in (D12): ready when everything passed, a draft
                                         otherwise; the body opens with what differs from the approved package, what
                                         was not built and why, and what is needed from the user. Without --create it
                                         writes the body (.aidw/run/pr-<id>.md); --create pushes the Change Branch and
                                         opens it, or updates the one already opened (body, ready). Open it before
                                         archiving: the push grant covers a delivered Change, not an archived one
  cap <id> --raise <runs>                the user raises the cap on Agent runs after the gate (asks; recorded in the
                                         approval record), then /aidw:resume builds what the cap left not built
  analyze [<id>]                         pre-gate consistency checks (analysis.md, task coverage)
  plan-review [<id>] [--brief]           the independent review of architecture and plan before the gate: --brief writes the
                                         code-reviewer's brief; without it, record its verdict (at most ${MAX_FIX_ROUNDS} fix rounds)
  consult <request> [--change <id>]      an Agent that lacks information asks another Role (ADR-0013): check the request
                                         the Agent wrote (.aidw/changes/<id>/consult/<name>.request.md) against the Role's
                                         consults, depth 1, at most 2 per Agent run and, in the build, the authors of the
                                         contracts the task reads; record it and brief the consulted Role
  consult answer <C01>                   read the answer (STATUS: answered|cannot-answer|changes-approved) and write the resume brief
  consult resume <C01>                   continue the asker: SendMessage to it while it runs, else a fresh Agent of its Role
  deviation open [<id>] --role R --files a,b --reason R [--consultation C01] [--task T]
                                         after the gate, something approved must change (ADR-0014): only Role R, the
                                         author of every file named, may edit those files until it closes
  deviation close [<id>] [--remove-reason R] [--scope-reason R] [--summary S]
                                         check the change (no other drift, still valid, no approved scenario removed
                                         without a reason, grants untouched, new tasks serve an approved scenario,
                                         contracts additive or breaking), rehash the package, rerun the affected tasks
  deviation abandon [<id>] | list [<id>] put the files back as they were | the Deviations of a change
  not-built <task> --reason R [--cause envelope|environment]
                                         work outside what the user granted (the permission envelope) or blocked by the
                                         environment: the task and the tasks that depend on it are marked not built
  ids [<id>]                             requirement and scenario ids (after applying the change)
  vendor-path <upstream>/<skill>         absolute path of a vendored SKILL.md (e.g. pocock/grilling)
  diff-coverage <lcov> [--min 80] [--base <ref>]  coverage of the lines added since the change's first task started
  plugin-path <path>                     absolute path of a plugin file (e.g. roles/software-architect/references/stack-pool.md)
  docs-brief <lib>@<version> <topic>     whether a fresh Docs Brief exists (.aidw/research/docs/<lib>@<major.minor>-<topic>.md,
                                         same major.minor, at most 90 days old): FRESH exits 0; MISSING, STALE or INVALID
                                         exit 1 with the path Research writes it to (docs-research)
  eval [<role>] [--case <name>] [--model <m>] [--runs <n>] [--without <id,...> | --bare] [--answers]
                                         run a Role's cases with claude -p (no tools) and grade each answer against its
                                         criteria; without a Role, every active Role. Costs tokens; exits 1 when a case fails.
                                         The model is the one the Role's tier maps to in tiers.yaml (--model overrides it).
                                         --runs <n> runs each case n times (1-10, default 3): a case passes only when every run
                                         passes; one that passes only some runs is FLAKY and not passed
                                         --without <id>[,<id>...] drops those rule rows and skills and runs the cases covering any
                                         of them (with --case, that case): each must fail (exits 1 when one still passes)
                                         --bare answers with none of the Role's instructions (only the shared procedures it
                                         includes): each case must fail (exits 1 when one passes)
                                         both print every criterion's verdict and never write the result file
                                         --answers also prints each answer, to see why a case failed
                                         A full run from a source checkout on the tier's model writes
                                         roles/<id>/evals/results.json (commit it with the Role's change); --model is
                                         refused for a tier that uses the session's model. --case updates only that
                                         case's entry, and needs an existing format-2 file from a full run, the same
                                         shared content (all of the Role but its case files) and the same model
  roster [--write] [--strict]            the factory's Roles; checks roster.yaml, role profiles, rules.md tables, artifacts.yaml
                                         (one owner per artifact, reads/writes of each Role), workflows/*.yaml, the cases (a Role
                                         whose rules.md is a table covers every rule and skill), and the generated agent files;
                                         warns when such a Role's results.json is missing, stale or not 3 of 3
                                         (--write regenerates agents/; --strict fails on warnings too)

Execution (state executing; add --change <id> when several changes are active):
  next                                   what the orchestrator does next (implement | review | triage | upstream | complete ...);
                                         at the Agent-run cap it marks the tasks that have not started not built
  task start <task> [--worktree]         mark a task running (counts attempts, records the base commit);
                                         --worktree: a wave task in its own git worktree
  integrate                              after a wave: verify the merged code; a failure adds a fix task
  brief <task> --for conflict            a wave task's merge conflicted: start the merge in its worktree and brief the
                                         integration Role with both tasks; --for merge-review briefs the reviewer of the merge
  resolve <task>                         check the integration Role's resolution, commit it and rerun both tasks' checks;
                                         a failure drops the task, which reruns sequentially

Unattended (in your own terminal, not inside Claude Code):
  run [<id>] [--detach] [--permission-mode M] [--max-runs N] [--claude BIN] [--keep-mcp] [-- <claude args>]
  run --status | --stop                  the background runner started with --detach
                                         loop \`claude -p "/aidw:resume <id>"\` until archived; waits out usage
                                         limits (stated reset time or 5-60 min backoff); stops on escalation
  triage <task> [--notes-file F|--unclear] a task out of attempts: record the architect's diagnosis from .aidw/run/triage-<task>.md
                                         (implementation -> one more attempt; plan, spec, architecture -> the author Role fixes
                                         it, at most ${MAX_UPSTREAM_ROUNDS} rounds; environment, or past the rounds -> not built with its dependants)
  brief <task> --for upstream            the author Role's brief for an upstream round, and the Deviation to open first
  upstream <task> [--cannot "<why>"]     the author fixed its Artifact: the task runs again (--cannot: it is not built)
  task retry <task>                      user-granted fresh attempt budget for an escalated, failed or not-built task
                                         (a not-built one comes back with the tasks not built because they depend on it)
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

const VALUE_FLAGS = new Set(["role", "files", "consultation", "remove-reason", "scope-reason", "summary", "cause", "task", "session", "last", "root", "title", "input-type", "workflow", "reason", "change", "for", "notes", "notes-file", "timeout", "layer", "permission-mode", "max-runs", "claude", "model", "case", "runs", "without", "text", "lang", "weights", "to", "done", "cannot", "raise", "base"]);

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
  /** Test seam: the model calls of the case runner. */
  modelExec?: (model?: string) => Exec;
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
    // ADR-0014: a Deviation's close that a crash interrupted is finished before anything reads the Change
    for (const id of listChangeIds(p)) {
      try {
        finishDeviations(p, id);
      } catch {
        // an unreadable Change is reported by the command itself
      }
    }
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
        settleChange(p, id);
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
          // a retry is the user's go-ahead (ADR-0014): an unattended session never grants one
          if (env.AIDW_RUNNER === "1") throw new OpError("a retry is granted by the user: an unattended session never runs `aidw task retry`");
          const r = retryTask(p, id, need(rest[1], "task id"));
          emit({ ok: true, change: id, ...r }, `${r.task}: retry granted (fresh attempt budget)${r.revived && r.revived.length > 1 ? `; back with it: ${r.revived.slice(1).join(", ")}` : ""}\n`);
          return 0;
        }
        const r = startTask(p, id, need(rest[1], "task id"), { worktree: args.flags.worktree === true });
        const brief = buildBrief(p, id, r.task, "implement", join(pluginRoot(env), "library", "vendor"));
        spawned(p, id, "implementer", `${r.task}:r${taskField(p, id, r.task, "runs")}`, r.task);
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
          spawned(p, id, "triage", `${taskId}:${taskField(p, id, taskId, "runs")}`, taskId);
          emit({ change: id, task: taskId, for: kind, path: tb.path }, `${tb.path}\nSPAWN ${AGENTS.triage} with: Triage brief: ${tb.path}. Read it and write your answer as it says.\nThen: aidw triage ${taskId}\n`);
          return 0;
        }
        if (kind === "upstream" && cmd === "brief") {
          const ub = buildUpstreamBrief(p, id, taskId, { pluginHome: pluginRoot(env) });
          spawned(p, id, "author", `${taskId}:${ub.deviation}`, taskId);
          emit(
            { change: id, task: taskId, for: kind, path: ub.path, role: ub.role, cause: ub.cause, round: ub.round, files: ub.files, deviation: ub.deviation, deviation_brief: ub.deviationBrief },
            `${ub.path}\nDeviation ${ub.deviation} is open for the ${ub.role}: ${ub.files.join(", ")}\nSPAWN aidw:${ub.role} with: Upstream brief: ${ub.path}. Read it and fix your Artifact as it says.\nThen: aidw deviation close, and aidw upstream ${taskId} (or, when it replies CANNOT FIX, aidw upstream ${taskId} --cannot "<its reason>")\n`,
          );
          return 0;
        }
        if (kind === "conflict" && cmd === "brief") {
          const cb = buildConflictBrief(p, id, taskId);
          spawned(p, id, "integration", `${taskId}:${taskField(p, id, taskId, "conflict")}`, taskId);
          emit({ change: id, task: taskId, for: kind, path: cb.path }, `${cb.path}\nSPAWN aidw:integration with: Conflict brief: ${cb.path}. Read it and resolve the conflict.\nThen: aidw resolve ${taskId}\n`);
          return 0;
        }
        if (kind === "merge-review" && cmd === "brief") {
          const mb = buildMergeReviewBrief(p, id, taskId);
          spawned(p, id, "merge-reviewer", `${taskId}:${taskField(p, id, taskId, "conflict")}`, taskId);
          emit({ change: id, task: taskId, for: kind, path: mb.path }, `${mb.path}\nSPAWN ${AGENTS.taskReview} with: Merge review brief: ${mb.path}. Review the merge and reply with the verdict.\nThen: aidw verdict ${taskId}\n`);
          return 0;
        }
        if (kind !== "implement" && kind !== "review") throw new UsageError('--for must be "implement" or "review" (or "triage", "upstream", "conflict", "merge-review" for brief)');
        const b = buildBrief(p, id, taskId, kind, join(pluginRoot(env), "library", "vendor"));
        if (kind === "review" && cmd === "brief") spawned(p, id, "reviewer", `${taskId}:r${taskField(p, id, taskId, "runs")}`, taskId);
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
          `${r.ok ? "PASS" : r.status === "blocked" ? "BLOCKED (environment)" : r.status === "not_built" ? "NOT BUILT (environment)" : "FAIL"} ${r.task} -> ${r.status === "blocked" ? "running, no attempt used" : r.status === "not_built" ? `not built, with ${(r.not_built ?? []).join(", ")}; the rest carries on` : r.status}  (evidence ${r.evidence})`,
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
            after = `review ${auto.task}: auto-passed (converge tests, or a layer fix its own reviewer judges again)${auto.commit ? ` (commit ${auto.commit.slice(0, 8)})` : ""}\n${settledNextLine(p, id)}${sessionEnd(env, p, id)}`;
          } else {
            reviewBrief = buildBrief(p, id, r.task, "review", join(pluginRoot(env), "library", "vendor")).path;
            spawned(p, id, "reviewer", `${r.task}:r${taskField(p, id, r.task, "runs")}`, r.task);
            after = `review brief ${reviewBrief}\nSPAWN ${AGENTS.taskReview} with: ${REVIEWER_PROMPT(reviewBrief)}\nThen: aidw verdict ${r.task}\n`;
          }
        } else if (r.status === "blocked") {
          after = `NEXT: the machine refused a check, not the code. Run \`aidw checkpoint ${r.task} --change ${id}\` once more outside the sandbox (dangerouslyDisableSandbox: true); if it is refused again, the task is not built (environment) and the run carries on. Do not start a new attempt or spawn the implementer again.\n`;
        } else {
          after = `${r.status === "not_built" ? "Tell the user in one line what the machine refused; nothing waits for them (ADR-0014).\n" : ""}${settledNextLine(p, id)}`;
        }
        emit({ change: id, ...r, ...(reviewBrief ? { review_brief: reviewBrief } : {}) }, `${lines.join("\n")}\n${failed ? `\n--- ${failed.command} (tail)\n${failed.tail}\n` : ""}${after}`);
        return r.ok || r.status === "not_built" ? 0 : 1;
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
          const mark = l.status === "pass" ? "ok     " : l.status === "fail" ? "FAILED " : l.status === "review" ? "REVIEW " : l.status === "not_built" ? "NOT BUILT" : l.reused ? "ok     " : "skipped";
          return `  ${mark} ${l.name}${l.reused ? "  (passed earlier on this commit; --fresh reruns it)" : ""}${bad ? `  (${bad.command}${bad.timedOut ? ", timed out" : `, exit ${bad.exit}`})` : ""}`;
        });
        const failed = r.layers.find((l) => l.status === "fail")?.runs.find((x) => x.exit !== 0);
        const a = r.awaitingReview;
        const group = r.awaitingReviews ?? (a ? [a] : []);
        if (group.length) {
          const rounds = (layer: string) => loadTasks(p, id).tasks.filter((t) => t.origin === "quality" && t.layer === layer).length;
          for (const x of group) spawned(p, id, "layer-reviewer", `${x.layer}:${rounds(x.layer)}:${git(p.project, ["rev-parse", "HEAD"]).out}`);
        }
        const reviewer = (x: typeof group[number]) => `\n${group.length > 1 ? `  layer  ${x.layer}\n` : ""}  agent  ${x.agent}\n  brief  ${x.brief}\n  prompt Layer review brief: ${x.brief}. Review the layer and reply with the verdict.\n`;
        emit(
          { change: id, ...r },
          `${r.ok ? "PASS" : a ? "REVIEW" : "FAIL"}: ${r.summary}\n${lines.join("\n")}\n${failed ? `\n--- ${failed.command} (tail)\n${failed.tail}\n` : ""}${group.map(reviewer).join("")}${
            group.length > 1 ? `\nNEXT: spawn these ${group.length} reviewers in one message, one subagent each with its prompt; when each returns, run \`aidw layer-review <layer> --change ${id}\` for it, then \`aidw verify\` again\n` : ""
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
          { ok: true, change: id, ...r },
          `${r.layer}: ${r.kind} review ${r.verdict} -> ${r.summary}${
            verdict === "pass" && !notes.trim() ? "\n  note: no reviewer reply recorded; pass it with --notes-file so its non-blocking remarks reach the handoff" : ""
          }\n`,
        );
        return 0;
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
            // The user's own browser is a URL that is not the one aidw recorded (project() copies the recorded one into the environment).
            if (usesOwnBrowser(env, p)) return null;
            const qtext = readText(qualityFile(loadChange(p, id)));
            const config = qtext === null ? null : parseQuality(qtext, "quality.yaml").config;
            if (!config || !drivesBrowser(config)) return null;
            try {
              const b = startBrowser(p, { env });
              if (env === process.env) Object.assign(process.env, browserEnv(p)); // a stale URL copied earlier must not win
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
            if (startedBrowser && (outcome === "archived" || outcome === "draft")) stopBrowser(p); // "denied" cannot happen here: the runner started it
          },
          preflight: () => {
            const bad = doctor(p, id, env, undefined, { run: installRunner() }).filter((c) => c.status === "fail");
            return bad.length ? `fix this first, then run the same command again: ${bad.map((c) => `${c.name}: ${c.detail}`).join("; ")}` : null;
          },
          deployBlocked: (problem) => {
            try {
              recordBlockedDeploy(p, id, problem);
              transition(p, id, "delivered", { pluginRoot: pluginRoot(env) });
              return null;
            } catch (e) {
              return (e as Error).message;
            }
          },
          extraArgs: passthrough,
          env,
          // Detached: stdout already is runner.log, and the runner appends each line with a timestamp itself.
          log: json || env.AIDW_RUN_DETACHED === "1" ? () => {} : (line) => io.out(`[aidw run] ${line}\n`),
        });
        emit({ change: id, ...r }, `${r.outcome === "archived" ? "DONE" : "STOPPED"} (${r.outcome}) after ${r.runs} session(s), ${r.waits} wait(s): ${r.message}\n`);
        return r.outcome === "archived" ? 0 : r.outcome === "draft" || r.outcome === "escalated" || r.outcome === "needs_user" ? 2 : 1;
      }

      case "integrate": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const r = integrateChange(p, id);
        const failed = r.runs.find((x) => x.exit !== 0);
        emit(
          { change: id, ...r },
          `${r.ok ? "PASS" : r.notBuilt ? "NOT BUILT" : "FAIL"}: ${r.summary}\n${r.runs.map((x) => `  ${x.exit === 0 ? "ok     " : "FAILED "} ${x.command}`).join("\n")}\n${failed ? `\n--- ${failed.command} (tail)\n${failed.tail}\n` : ""}${r.notBuilt ? settledNextLine(p, id) : ""}`,
        );
        return r.ok || r.notBuilt ? 0 : 1;
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
          `${reviewLine(r, verdict, notes)}${settledNextLine(p, id)}${r.status === "done" ? sessionEnd(env, p, id) : ""}`,
        );
        return 0;
      }

      case "resolve": {
        // T7: the integration Role resolved a Wave's merge conflict in the task's worktree; check it and rerun both tasks' checks.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const r = resolveConflict(p, id, taskId);
        const lines = r.checks.flatMap((c) => [
          ...c.missing_scenarios.map((s) => `  MISSING ${c.task} ${s}`),
          ...c.runs.map((x) => `  ${x.exit === 0 ? "ok     " : "FAILED "} ${c.task} ${x.command}`),
        ]);
        const marked = r.blocked ? recordBlocked(p, id, taskId, r.reason ?? "a check was refused by the machine") : null;
        let after = settledNextLine(p, id);
        if (r.blocked && !marked) after = `NEXT: the machine refused a check, not the code. Run \`aidw resolve ${taskId} --change ${id}\` once more outside the sandbox (dangerouslyDisableSandbox: true); if it is refused again, the task is not built (environment) and the run carries on.\n`;
        if (r.ok) {
          const mb = buildMergeReviewBrief(p, id, taskId);
          spawned(p, id, "merge-reviewer", `${taskId}:${taskField(p, id, taskId, "conflict")}`, taskId);
          after = `review brief ${mb.path}\nSPAWN ${AGENTS.taskReview} with: Merge review brief: ${mb.path}. Review the merge and reply with the verdict.\nThen: aidw verdict ${taskId}\n`;
        }
        emit(
          { change: id, ...r },
          `${r.ok ? "RESOLVED" : marked ? "NOT BUILT (environment)" : r.blocked ? "BLOCKED (environment)" : "DROPPED"} ${taskId}: ${r.ok ? `merge ${String(r.resolution).slice(0, 8)}; both tasks' checks pass` : marked ? `${r.reason}; refused a second time: not built, with ${marked.join(", ")}; the rest carries on` : r.blocked ? `${r.reason}; nothing dropped, the conflict stays open` : `${r.reason}; the task reruns sequentially on the latest code`}\n${lines.length ? `${lines.join("\n")}\n` : ""}${after}`,
        );
        return r.ok || marked ? 0 : 1;
      }

      case "triage": {
        // The triage Agent wrote its answer to .aidw/run/triage-<task>.md; the rule of its cause is applied here.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const file = str(args.flags["notes-file"]) ?? triageFile(p, taskId);
        const unclear = args.flags.unclear === true;
        if (!unclear && !existsSync(file)) throw new OpError(`no triage answer at ${file}: the Agent did not write it. Spawn it once more with \`aidw brief ${taskId} --for triage\``);
        const r = recordTriage(p, id, taskId, unclear ? "" : readFileSync(file, "utf8"), { pluginHome: pluginRoot(env), unclear });
        const first = r.diagnosis.split("\n").find((l) => l.trim()) ?? "";
        const others = (r.not_built ?? []).filter((t) => t !== r.task);
        const along = others.length ? ` Not built with it (they depend on it): ${others.join(", ")}.` : "";
        const line = r.unclear
          ? `${r.task}: Triage gave no clear cause, so it is not built; the rest carries on.${along}\n`
          : r.outcome === "retry"
            ? `${r.task} triaged: the cause is the implementation. One further attempt is granted with the diagnosis in its brief: ${first}\n`
            : r.outcome === "upstream"
              ? `${r.task} triaged: the cause is the ${r.cause}, so it goes back to the ${r.role}, who wrote it: upstream round ${r.round} of ${MAX_UPSTREAM_ROUNDS}. ${first}\n(full diagnosis: ${rel(p, file)})\n`
              : r.cause === "environment"
                ? `${r.task} triaged: the cause is the environment, which nothing inside the factory fixes, so it is not built; the rest carries on.${along} What the user must fix to finish it: ${first}\n(full diagnosis: ${rel(p, file)})\n`
                : `${r.task} triaged: the cause is the ${r.cause} again after ${MAX_UPSTREAM_ROUNDS} upstream rounds, so it is not built; the rest carries on.${along} ${first}\n(full diagnosis: ${rel(p, file)})\n`;
        emit({ ok: true, change: id, ...r }, `${line}${settledNextLine(p, id)}`);
        return 0;
      }

      case "upstream": {
        // ADR-0014: the author Role fixed its Artifact (through a Deviation) after a Triage; the task runs again.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const taskId = need(rest[0], "task id");
        const cannot = str(args.flags.cannot);
        const r = recordUpstream(p, id, taskId, cannot === undefined ? {} : { cannot });
        const others = (r.not_built ?? []).filter((t) => t !== r.task);
        const line =
          r.outcome === "rerun"
            ? `${r.task}: the ${r.role} fixed the ${r.cause} (upstream round ${r.round} of ${MAX_UPSTREAM_ROUNDS}); the task runs again with a fresh attempt budget\n`
            : `${r.task}: the ${r.role} could not fix the ${r.cause}, so it is not built; the rest carries on${others.length ? `. Not built with it: ${others.join(", ")}` : ""}\n`;
        emit({ ok: true, change: id, ...r }, `${line}${settledNextLine(p, id)}`);
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
          `${reviewLine(r, verdict, notes)}${settledNextLine(p, id)}${r.status === "done" ? sessionEnd(env, p, id) : ""}`,
        );
        return 0;
      }

      case "vendor-path": {
        const ref = need(rest[0], "<upstream>/<skill>");
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(ref)) throw new UsageError(`invalid vendored skill "${ref}"`);
        const file = skillPath(join(pluginRoot(env), "library", "vendor"), ref);
        if (!existsSync(file)) throw new OpError(`skill "${ref}" not found at ${file}`);
        emit({ path: file }, `${file}\n`);
        return 0;
      }

      case "diff-coverage": {
        const p = project();
        const report = need(rest[0], "LCOV report file (e.g. coverage/lcov.info)");
        const min = args.flags.min === undefined ? 80 : Number(args.flags.min);
        if (!Number.isFinite(min) || min < 0 || min > 100) throw new UsageError("--min must be a number from 0 to 100");
        const file = resolve(p.project, report);
        if (!existsSync(file)) throw new OpError(`no coverage report at ${report}: run the tests with an lcov reporter first`);
        const open = listChangeIds(p).flatMap((id) => loadTasks(p, id).tasks.map((t) => (typeof t.base === "string" ? t.base : null)));
        const base = typeof args.flags.base === "string" ? args.flags.base : (open.find((b) => b) ?? trunkBase(p.project));
        if (!base) throw new OpError("no base commit to compare with: pass --base <ref>");
        const c = diffCoverage(p.project, base, readFileSync(file, "utf8"));
        emit(c, `${coverageReport(c, min)}\n`);
        return c.percent >= min ? 0 : 1;
      }

      case "plugin-path": {
        const ref = need(rest[0], "relative path inside the plugin");
        if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(ref) || ref.split("/").includes("..")) {
          throw new UsageError(`invalid plugin path "${ref}"`);
        }
        const found = resolvePluginFile(pluginRoot(env), ref);
        if (!("file" in found)) {
          const hint = found.suggestions.length ? ` Did you mean: ${found.suggestions.map((s) => `\`aidw plugin-path ${s}\``).join(", ")}?` : "";
          throw new OpError(`"${ref}" not found in the plugin (${found.tried}).${hint}`);
        }
        const file = found.file;
        emit({ path: file }, `${file}\n`);
        return 0;
      }

      case "docs-brief": {
        // ADR-0016, R9: a Docs Brief is reused while the installed major.minor matches and it is at most 90 days old.
        const p = project();
        let c;
        try {
          c = checkDocsBrief(p.aidw, parseDocsRef(`${need(rest[0], "<lib>@<version>")} ${rest.slice(1).join(" ")}`));
        } catch (e) {
          throw new UsageError((e as Error).message);
        }
        const tail = c.status === "fresh" ? "" : `Research writes it with docs-research, to ${c.rel}\n`;
        emit({ ok: c.status === "fresh", ...c }, `${c.status.toUpperCase()} ${c.rel}: ${c.reasons.join("; ")}\n${tail}`);
        return c.status === "fresh" ? 0 : 1;
      }

      case "eval": {
        const root = pluginRoot(env);
        // Level 1 (plan C2): a case passes only when it passes 3 runs of 3; a FLAKY case is not passed.
        const runs = args.flags.runs === undefined ? 3 : Number(args.flags.runs);
        if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new OpError("--runs takes a whole number from 1 to 10");
        const caseName = str(args.flags.case);
        const without = str(args.flags.without);
        const bare = args.flags.bare === true;
        const asked = str(args.flags.model);
        const progress = (r: CaseResult) => io.err(`  ... ${r.role}/${r.name}: ${r.error ? "ERROR" : r.pass ? "pass" : "fail"}${r.runs ? ` (${r.runs.passed}/${r.runs.total})` : ""}\n`);
        // One Role at a time: each answers with the model its tier maps to, unless --model names one.
        const results: CaseResult[] = [];
        const modelOf = new Map<string, string | undefined>();
        const digestsOf = new Map<string, RunDigests>();
        try {
          if (without !== undefined && !rest[0]) throw new Error("--without needs a Role: rule ids and skills belong to one Role");
          if (bare && !rest[0]) throw new Error("--bare needs a Role: it runs that Role's cases with none of its instructions");
          const roster = loadRoster(root);
          let ids = rest[0] ? [rest[0]] : Object.entries(roster.roles).filter(([, e]) => e?.status === "active").map(([k]) => k);
          if (caseName && !rest[0]) ids = ids.filter((id) => loadEvalCases(root, id).cases.some((c) => c.name === caseName));
          if (caseName && !ids.length) throw new Error(`no case "${caseName}"`);
          for (const id of ids) {
            const model = asked ?? (roster.roles[id] ? tierModel(root, id) : undefined);
            modelOf.set(id, model);
            // The digests the result file records are those of the content the run started from.
            if (roster.roles[id] && !without && !bare) digestsOf.set(id, takeDigests(root, id));
            results.push(...runCases(root, id, caseName, (io.modelExec ?? claudeExec)(model), progress, runs, without, bare));
          }
        } catch (e) {
          throw new OpError((e as Error).message);
        }
        const ok = results.every((r) => r.pass);
        const written: string[] = [];
        if (without || bare) {
          // C3: each case must fail without what it covers, and with no Role at all; one that still passes does not test it.
          const what = bare ? "bare (no Role instructions)" : `without ${without}`;
          const still = results.filter((r) => r.pass);
          const text =
            `${what}: ${results.length - still.length}/${results.length} case(s) failed, as they should\n` +
            still
              .map((r) => `  ${bare ? "PASSES BARE" : "STILL PASSES"} ${r.role}/${r.name}: ${bare ? "the model passes it with no Role" : `it does not test ${without}`}; rewrite or drop it (C3)\n`)
              .join("") +
            `  no result file written: a run ${bare ? "--bare" : "--without"} is not the Role\n`;
          emit({ ok: still.length === 0, ...(bare ? { bare } : { without }), results }, printResults(results, args.flags.answers === true, true) + text);
          return still.length === 0 ? 0 : 1;
        }
        // The record of the run (C6): only on the Role's tier model, from a source checkout. A full run writes the file
        // afresh; a --case run merges its entry into a file of the same shared content (mergeResults says when not).
        const inGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" }).stdout?.trim() === "true";
        if (!inGit) io.err(`  no result file written: ${root} is not a source checkout\n`);
        else {
          for (const id of [...new Set(results.map((r) => r.role))]) {
            const tm = tierModel(root, id);
            const mine = results.filter((r) => r.role === id);
            const digests = digestsOf.get(id);
            const meta = { runs, ...(modelOf.get(id) ? { model: modelOf.get(id) as string } : {}), ...(digests ? { digests } : {}) };
            if (asked && !tm) io.err(`  no result file written for ${id}: its tier uses the session's model; run without --model\n`);
            else if (asked && asked !== tm) io.err(`  no result file written for ${id}: --model ${asked} is not its tier's model (${tm})\n`);
            else if (mine.every((r) => r.error)) io.err(`  no result file written for ${id}: no case was graded\n`);
            else {
              const m = caseName ? mergeResults(root, id, results, meta) : writeResults(root, id, results, meta);
              if ("refused" in m) io.err(`  no result file written for ${id}: ${m.refused}\n`);
              else written.push(relative(root, m.file));
            }
          }
        }
        emit({ ok, results, written }, printResults(results, args.flags.answers === true) + written.map((f) => `wrote ${f}\n`).join(""));
        return ok ? 0 : 1;
      }

      case "roster": {
        const root = pluginRoot(env);
        const written = args.flags.write === true ? writeAgents(root) : [];
        const d = checkRoster(root);
        d.add(checkArtifacts(root));
        d.add(checkWorkflows(root));
        d.add(checkEvals(root));
        const table = d.errors.length ? "" : rosterTable(root);
        const strict = args.flags.strict === true;
        const failed = d.failed(strict);
        const summary = `${failed ? "FAILED" : "OK"}: ${d.errors.length} error(s), ${d.warnings.length} warning(s)${strict ? " (strict)" : ""}\n`;
        emit(
          { ok: !failed, strict, written, ...diagsJson(d) },
          `${table}${written.length ? `wrote agents/: ${written.join(", ")}\n` : ""}${printDiags(d)}${summary}`,
        );
        return failed ? 1 : 0;
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
          const r = createPr(p, id, { ...(base ? { base } : {}), draft: args.flags.draft === true, env });
          emit(
            { ok: true, change: id, url: r.url, title: r.plan.title, draft: r.draft, updated: r.updated, why: r.plan.why },
            `pull request ${r.updated ? "updated" : "opened"}${r.draft ? " (draft)" : " (ready for review)"}: ${r.url}\n${r.draft ? `draft because: ${r.plan.why.join("; ")}\nNEXT: the Change stays delivered; /aidw:resume ${id} finishes it after the user acted on "Needed from the user to finish"\n` : `NEXT: aidw archive ${id}\n`}`,
          );
          return 0;
        }
        // delivered (or archived): the body is written for the user, and a delivered Change records that it is
        const st = (() => {
          try {
            return stateOf(loadChange(p, id));
          } catch {
            return "archived";
          }
        })();
        const plan = st === "delivered" || st === "archived" ? writePrBody(p, id, { ...(base ? { base } : {}), env }) : planPr(p, id, { ...(base ? { base } : {}), env });
        const next = prNext(p, id, plan, env.AIDW_RUNNER === "1");
        emit(
          { ok: true, change: id, title: plan.title, head: plan.head, base: plan.base, ready: plan.ready, why: plan.why, granted: plan.granted, url: plan.record?.url ?? null, body: plan.body, body_file: rel(p, plan.bodyFile), commands: plan.commands, warnings: plan.warnings, next },
          `title: ${plan.title}\n${plan.ready ? "ready for review" : `draft: ${plan.why.join("; ")}`}\npush: ${plan.granted ? "granted at the Approval Gate" : "not granted (the gate asks)"}\nbody: ${rel(p, plan.bodyFile)}\n\n${plan.body}\n${plan.warnings.map((w) => `WARNING ${w}\n`).join("")}${next}\n`,
        );
        return 0;
      }

      case "cap": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const raw = str(args.flags.raise);
        if (raw === undefined) throw new UsageError("usage: aidw cap <id> --raise <runs>");
        if (!/^\d+$/.test(raw)) throw new OpError("--raise takes a positive whole number of Agent runs");
        const r = raiseCap(p, id, Number(raw), env);
        const used = agentRunStatus(p, loadChange(p, id)).used;
        emit({ ok: true, change: id, ...r, used }, `cap on Agent runs raised: ${r.from} -> ${r.to} (${used} used); recorded in the approval record\nNEXT: /aidw:resume ${id}\n`);
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

      case "mock": {
        const sub = rest[0];
        if (sub === "font") {
          const family = need(rest.slice(1).join(" ").trim() || undefined, "font family");
          const weights = str(args.flags.weights)?.split(",").map((w) => Number(w.trim()));
          if (weights?.some((w) => !Number.isInteger(w))) throw new UsageError("--weights takes numbers, for example 400,700");
          const to = resolve(cwd, str(args.flags.to) ?? join(project().design, "mock", "fonts"));
          const f = fetchFont(family, { weights, italic: args.flags.italic === true, to });
          emit({ ok: true, ...f, dir: to }, `${f.family} ${f.version} (${f.license}): ${f.files.length} file(s) in ${to}${f.cached ? `, ${f.cached} from cache` : ""}\nlink ${f.css} from the mock's CSS (@import url("fonts/${f.css}")) and use font-family: "${f.family}"\n`);
          return 0;
        }
        if (sub === "shots") {
          const dir = resolve(cwd, need(rest[1], "mock folder"));
          const s = browserStatus(project());
          if (!s.running || !s.record) throw new OpError("mock shots need the test browser: run `aidw browser start` (outside the sandbox if it is refused)");
          const self = typeof __filename !== "undefined" ? __filename : join(pluginRoot(env), "bin", "aidw");
          const r = takeShots({ dir, cdp: s.record.url, full: args.flags.full === true }, self);
          emit({ ok: r.errors.length === 0, dir, ...r }, `${r.written.length} screenshot(s) in ${join(dir, "shots")}\n${r.errors.map((e) => `failed: ${e}\n`).join("")}`);
          return r.errors.length ? 1 : 0;
        }
        throw new UsageError("mock needs font or shots");
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
        const checks = doctor(p, id, env, undefined, { run: installRunner(), fresh: args.flags.fresh === true });
        emit({ ok: !checks.some((c) => c.status === "fail"), change: id, checks }, doctorText(checks));
        return checks.some((c) => c.status === "fail") ? 1 : 0;
      }

      case "detect": {
        const dir = findProject({ root: str(args.flags.root), cwd, env }) ?? str(args.flags.root) ?? cwd;
        const d = detectProject(dir);
        const text = [
          `${d.kind}${d.packageManager || d.pythonTool ? ` (${d.packageManager ?? d.pythonTool})` : ""}${d.languages.length ? `, ${d.languages.join(", ")}` : ""}`,
          ...d.signals.map((s) => `  signal  ${s}`),
          ...Object.entries(d.stack).map(([k, v]) => `  stack   ${k}: ${v}`),
          ...packsFor(pluginRoot(env), d.stack, "fullstack").concat(packsFor(pluginRoot(env), d.stack, "frontend"), packsFor(pluginRoot(env), d.stack, "backend")).filter((k, i, a) => a.findIndex((x) => x.id === k.id) === i).map((k) => `  pack    ${k.id} (read by ${k.roles.join(", ")})`),
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
        const dir = newChange(p, id, { title: str(args.flags.title), inputType: str(args.flags["input-type"]), scopeRound: loadWorkflow(pluginRoot(env), wf ?? defaultWorkflowId(p))?.scope_round === true, ...(wf ? { workflow: wf, workflows: workflowIds(pluginRoot(env)), skipSpecs: boundaryOf(pluginRoot(env), wf)?.spec_changes === false } : {}) });
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
            const dev = c.deviation ? `\n    Deviation ${c.deviation.id} open (${c.deviation.roles.join(", ")}): ${c.deviation.files.join(", ")}` : "";
            const pr = c.pr ? `\n    pull request ${c.pr.url ?? `not opened (body in .aidw/run/pr-${c.id}.md)`}${c.pr.draft ? " (draft: /aidw:resume finishes it)" : ""}` : "";
            return `  ${c.id}  [${c.state}]  ${appr}  ${tasks}  deltas ${c.deltas}${paused}${dev}${pr}`;
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

      case "page": {
        // Decision Pages (ADR-0007): a view of one round of questions, a pick list or a gate. Nothing is recorded here.
        const p = project();
        const sub = need(rest[0], "render | answers | audit | triage");
        const lang = str(args.flags.lang);
        const gateExtras = (id: string): PageSection[] => {
          const c = loadChange(p, id);
          const all = readDecisions(c);
          const points = workflowOfChange(p, c, pluginRoot(env)).decisions.map((x) => {
            const r = all[x.id];
            return r ? `**${x.id}**: ${[r.answer].flat().join(", ")} (${r.reason || "no reason recorded"})` : `**${x.id}**: open (${x.options.join(" | ")})`;
          });
          const tasks = parseTasks(readText(join(c.dir, "tasks.yaml")) ?? "").tasks;
          return [
            ...(points.length ? [{ id: "decision-points", title: "Decision Points", body: "", points, html: "" }] : []),
            ...(tasks.length ? [{ id: "plan", title: "Plan", body: planSummary(tasks), points: [], html: "" }] : []),
            ...[grantsSection(p, c)].filter((x): x is PageSection => x !== null),
          ];
        };
        const load = (name: string) => {
          if (!PAGE_NAME.test(name)) throw new UsageError(`invalid page name "${name}": lowercase letters, digits and "-"`);
          const source = readText(pageDataFile(p, name));
          if (source === null) throw new OpError(`no page data at ${rel(p, pageDataFile(p, name))}: write it first (aidw plugin-path library/decision-pages.md says how)`);
          const first = parsePage(name, source);
          const gateId = first.page.layout === "gate" && first.page.change ? resolveChangeId(p, first.page.change) : null;
          const lead = (id: string): PageSection[] => {
            const c = loadChange(p, id);
            // D1: the Before / After of analysis.md, unless the page writes its own.
            const beforeAfter = first.page.sections.some((s) => s.id === "before-after") ? null : beforeAfterSection(readText(join(c.dir, "analysis.md")) ?? "");
            return [beforeAfter, openFindingsSection(p, c, workflowOfChange(p, c, pluginRoot(env))), unansweredSection(c)].filter((x): x is PageSection => x !== null);
          };
          // Q4: the Program Design is approved at the gate, so the gate shows it, unless the page writes its own.
          const programDesign = (id: string): PageSection[] =>
            first.page.sections.some((s) => s.id === "program-design") ? [] : [programDesignSection(readText(join(loadChange(p, id).dir, PROGRAM_DESIGN_FILE)), id)].filter((x): x is PageSection => x !== null);
          const r = gateId ? parsePage(name, source, [...programDesign(gateId), ...gateExtras(gateId)], lead(gateId)) : first;
          if (r.problems.length) throw new OpError(`the data of page "${name}" (${rel(p, pageDataFile(p, name))}) has ${r.problems.length} problem(s):\n${r.problems.map((x) => `  - ${x}`).join("\n")}\nFix the file and render again.`);
          return r.page;
        };
        const save = (name: string, data: unknown) => {
          mkdirSync(pagesDir(p), { recursive: true });
          writeFileSync(pageDataFile(p, name), typeof data === "string" ? data : toYaml(data));
        };
        const show = (name: string): number => {
          const page = load(name);
          const file = pageHtmlFile(p, name);
          writeFileSync(file, renderPage(page));
          const url = pathToFileURL(file).href;
          emit(
            { ok: true, page: name, version: page.version, layout: page.layout, file, url },
            `Decision Page: ${url}\n${pageSummary(page)}\nSHOW the user that link and one or two lines on what the page asks, nothing more: they choose on the page, press the copy button and paste the text here.\nNEXT: when they paste it, run \`aidw page answers ${name} --text "<the pasted text>"\` before recording anything.\n`,
          );
          return 0;
        };
        if (sub === "render") {
          const name = need(rest[1], "page name");
          if (args.flags.stdin === true) {
            if (!PAGE_NAME.test(name)) throw new UsageError(`invalid page name "${name}": lowercase letters, digits and "-"`);
            save(name, io.stdin?.() ?? "");
          }
          return show(name);
        }
        if (sub === "answers") {
          const name = need(rest[1], "page name");
          const page = load(name);
          const pasted = str(args.flags.text) ?? io.stdin?.() ?? "";
          const a = parseAnswers(page, pasted);
          emit(
            { page: name, ...a },
            a.ok
              ? `OK ${name}: the answer matches the page. Record it word for word:\n${answersText(page, a)}`
              : `REFUSED ${name}: ${a.problems.length} problem(s)\n${a.problems.map((x) => `  - ${x}`).join("\n")}\nAsk the user about exactly these; do not guess an answer for them.\n`,
          );
          return a.ok ? 0 : 1;
        }
        if (sub === "audit") {
          const id = resolveChangeId(p, str(args.flags.change));
          const r = compileReport(p, id, false);
          if (r.diags.errors.length) throw new OpError("the audit report is not complete: run `aidw audit report` first", r.diags);
          if (!r.findings.length) throw new OpError("the audit has no findings: there is nothing to pick");
          const name = `audit-${id}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64);
          save(
            name,
            picksData({
              title: lang === "vi" ? `Audit ${id}: chọn phát hiện cần sửa` : `Audit ${id}: pick the findings to fix`,
              intro: lang === "vi" ? `Báo cáo đầy đủ: ${rel(p, r.path)}. Các phát hiện được chọn sẽ thành một yêu cầu sửa.` : `Full report: ${rel(p, r.path)}. The findings you pick become one fix request.`,
              ...(lang ? { lang } : {}),
              kind: "audit",
              items: r.findings.map((f) => {
                const [head, ...more] = f.text.trim().split("\n");
                return { key: f.id, title: (head ?? "").slice(0, 200), group: f.severity, tag: f.lens, detail: more.join("\n").trim().slice(0, 1200), recommend: f.severity === "critical" || f.severity === "high" };
              }),
            }),
          );
          return show(name);
        }
        if (sub === "triage") {
          const taskId = need(rest[1], "task id");
          const file = str(args.flags["notes-file"]) ?? triageFile(p, taskId);
          const diagnosis = readText(file);
          if (diagnosis === null) throw new OpError(`no triage diagnosis at ${rel(p, file)}: this task was not triaged, so put the decision to the user in the chat`);
          const cause = /^CAUSE:\s*(\S+)/m.exec(diagnosis)?.[1] ?? "unknown";
          const name = `triage-${taskId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
          save(name, triageData({ task: taskId, cause, diagnosis, ...(lang ? { lang } : {}) }));
          return show(name);
        }
        throw new UsageError("usage: aidw page render <name> [--stdin] | answers <name> [--text T] | audit | triage <task>");
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

      case "plan-review": {
        // D4: the independent review of architecture and plan before the Approval Gate (src/planreview.ts).
        const p = project();
        const id = resolveChangeId(p, rest[0] ?? str(args.flags.change));
        if (args.flags.brief === true) {
          const b = buildPlanReviewBrief(p, id, pluginRoot(env));
          emit({ change: id, round: b.round, agent: "aidw:code-reviewer", brief: b.path }, `${b.path}\nSPAWN aidw:code-reviewer with: Plan review brief: ${b.path}. Read it and write your verdict as it says.\nNEXT: when it replies, \`aidw plan-review ${id}\`\n`);
          return 0;
        }
        const r = recordPlanReview(p, id, pluginRoot(env));
        const findings = r.round.findings.map((f, i) => `  ${i + 1}. [item ${f.item}] ${f.target}: ${f.text} -> ${r.fixers[i]}\n`).join("");
        const head =
          r.outcome === "pass"
            ? `plan review round ${r.round.round}: pass\n`
            : r.outcome === "carried"
              ? `plan review round ${r.round.round}: fix; the ${MAX_FIX_ROUNDS} fix rounds are used up: ${r.round.findings.length} finding(s) stay open and go to the top of the gate page\n${findings}`
              : `plan review round ${r.round.round}: fix (${r.round.findings.length} finding(s)); fix round ${r.round.round} of ${MAX_FIX_ROUNDS}\n${findings}`;
        const next =
          r.outcome === "fix"
            ? `NEXT: give each finding to the Role named after it (spawn it again with its findings; do it yourself for what you wrote), run \`aidw analyze ${id}\` until it is clean, then \`aidw plan-review ${id} --brief\` and spawn aidw:code-reviewer again\n`
            : `NEXT: \`aidw transition ${id} awaiting_approval\`, then present the gate page\n`;
        emit({ ok: true, change: id, round: r.round.round, verdict: r.round.verdict, outcome: r.outcome, findings: r.round.findings.map((f, i) => ({ ...f, fixer: r.fixers[i] })) }, head + next);
        return 0;
      }

      case "stages": {
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[0]);
        const finished = str(args.flags.done);
        if (finished) recordStageDone(p, id, finished, pluginRoot(env));
        const v = stagesView(p, id, pluginRoot(env));
        const pending = pendingConsultation(loadChange(p, id));
        const asking = pending ? `NEXT: ${consultNextText(p, id, pending)}; the other stages carry on meanwhile\n` : "";
        const rows = v.ready.length || v.done.length ? [...v.done.map((s) => `  done   ${s}`), ...v.ready.map((s) => `  ${v.group.includes(s) ? "now  " : "ready"}  ${s.id}`)] : [];
        emit(
          { ...v, ...(finished ? { recorded: finished } : {}), ...(pending ? { consultation: pending } : {}), ready: v.ready.map((s) => ({ id: s.id, title: s.title, roles: s.roles })), group: v.group.map((s) => ({ id: s.id, title: s.title, roles: s.roles, reads: s.reads, writes: s.writes, ...(s.gate ? { gate: s.gate } : {}), ...(s.browser ? { browser: true } : {}) })) },
          `${finished ? `recorded ${finished} as done\n` : ""}${v.workflow} (${v.state}), parallel.max ${v.max}\n${rows.join("\n")}${rows.length ? "\n" : ""}${asking}${stagesNext(v)}\n`,
        );
        return 0;
      }

      case "consult": {
        // ADR-0013: the asker wrote a request and ended its turn; the Orchestrator checks it, gets the answer and resumes the asker.
        const p = project();
        const sub = rest[0];
        if (sub === "answer" || sub === "resume") {
          const id = resolveChangeId(p, str(args.flags.change));
          const cid = need(rest[1], "consultation id (C01)");
          if (sub === "answer") {
            const r = recordAnswer(p, id, cid, pluginRoot(env));
            const c = r.consultation;
            const route =
              c.status === "needs-deviation"
                ? `ROUTE: after the Approval Gate this goes to the Role that wrote the approved Artifact, as a Deviation (ADR-0014); the user is not asked. Read the answer, then: aidw deviation open --role <author> --files <approved files> --reason "<why>" --consultation ${cid}\n`
                : c.status === "unanswered"
                  ? `ROUTE: before the gate the asker records it as an open question in its Artifact, which the Approval Gate shows.\n`
                  : "";
            emit({ ok: true, change: id, ...r }, `${cid} ${c.outcome} -> ${c.status}\nresume brief ${r.resume}\n${route}${c.status === "needs-deviation" ? "Then, once the Deviation is closed" : "Then"}: aidw consult resume ${cid}\n`);
            return 0;
          }
          const r = resumeConsultation(p, id, cid);
          const c = r.consultation;
          spawned(p, id, "resumed", cid, c.task);
          const after = c.task ? `Then, when it reports: aidw checkpoint ${c.task}` : `Then, when it reports: continue stage ${c.stage} (\`aidw stages\`)`;
          emit(
            { ok: true, change: id, ...r },
            `${cid} resumed: ${c.from} continues ${c.task ?? `stage ${c.stage}`}\nresume brief ${r.resume}\nIf the Agent that asked is still running in this session, continue it with SendMessage: "Consultation ${cid} is answered: ${join(p.changes, id, c.answer)}. Read it and continue." Otherwise:\nSPAWN ${r.agent} with: Resume brief: ${r.resume}. Read it and continue the work.\n${after}\n`,
          );
          return 0;
        }
        const file = need(sub, "request file (.aidw/changes/<id>/consult/<name>.request.md)");
        const abs = resolve(cwd, file);
        const id = resolveChangeId(p, changeOfRequest(p, abs, str(args.flags.change)));
        const r = requestConsultation(p, id, abs, pluginRoot(env));
        const c = r.consultation;
        spawned(p, id, "consulted", c.id, c.task);
        emit(
          { ok: true, change: id, ...r },
          `${c.id} recorded: ${c.from} (${c.task ?? `stage ${c.stage}`}) asks ${c.to}\nbrief ${r.brief}\nSPAWN ${r.agent} with: Consultation brief: ${r.brief}. Read it and answer as it says.\nThen: aidw consult answer ${c.id}\nMeanwhile the other tasks or stages carry on.\n`,
        );
        return 0;
      }

      case "deviation": {
        // ADR-0014: after the gate the author Role changes what it wrote; the lead opens and closes it (a state command).
        const p = project();
        const sub = rest[0];
        const id = resolveChangeId(p, str(args.flags.change) ?? rest[1]);
        if (sub === "open") {
          const files = (str(args.flags.files) ?? "").split(",").map((f) => f.trim()).filter(Boolean);
          const consultation = str(args.flags.consultation);
          const task = str(args.flags.task);
          const r = openDeviationFor(p, id, {
            role: need(str(args.flags.role), "--role <the Role that wrote the files>[,<another>]"),
            files,
            reason: str(args.flags.reason) ?? "",
            ...(consultation ? { consultation } : {}),
            ...(task ? { task } : {}),
            pluginRoot: pluginRoot(env),
            cwd,
          });
          const d = r.deviation;
          emit(
            { ok: true, change: id, deviation: d, brief: r.brief },
            `${d.id} open: ${d.files.map((f) => `${f} (${d.authors[f]})`).join(", ")}\nbrief ${r.brief}\n${d.roles.map((role) => `SPAWN aidw:${role} with: Deviation brief: ${r.brief}. Read it and change only your files under its three rules.`).join("\n")}\nThen: aidw deviation close\n`,
          );
          return 0;
        }
        if (sub === "close") {
          const removeReason = str(args.flags["remove-reason"]);
          const scopeReason = str(args.flags["scope-reason"]);
          const summary = str(args.flags.summary);
          const d = closeDeviation(p, id, { ...(removeReason ? { removeReason } : {}), ...(scopeReason ? { scopeReason } : {}), ...(summary ? { summary } : {}), pluginRoot: pluginRoot(env) });
          const lines = [
            `${d.id} recorded: ${d.roles.join(", ")} changed ${(d.changed ?? []).join(", ")}`,
            `  approval ${d.previous} -> ${d.hash}`,
            ...(d.scenarios?.removed.length ? [`  approved scenario(s) removed: ${d.scenarios.removed.map((x) => `${x.scenario} (${x.reason})`).join(", ")}`] : []),
            ...(d.requirements?.added.length ? [`  requirement(s) added: ${d.requirements.added.join(", ")} (${d.scope_reason})`] : []),
            ...(d.scenarios?.added.length ? [`  scenario(s) added: ${d.scenarios.added.join(", ")}`] : []),
            ...(d.contracts ?? []).map((c) => `  ${c.file}: ${c.class}${c.changes.length ? ` (${c.changes.slice(0, 5).join("; ")}${c.changes.length > 5 ? `; and ${c.changes.length - 5} more` : ""})` : ""}`),
            ...(d.tasks?.added.length ? [`  task(s) added: ${d.tasks.added.join(", ")}`] : []),
            `  run again: ${d.rerun?.length ? d.rerun.join(", ") : "none"}${d.reset?.length ? ` (reset to pending: ${d.reset.join(", ")})` : ""}`,
            ...(d.consultation ? [`  ${d.consultation}: deviation recorded; resume the asker: aidw consult resume ${d.consultation}`] : []),
          ];
          emit({ ok: true, change: id, deviation: d }, `${lines.join("\n")}\n${settledNextLine(p, id)}`);
          return 0;
        }
        if (sub === "abandon") {
          const d = abandonDeviation(p, id);
          emit({ ok: true, change: id, deviation: d }, `${d.id} abandoned: ${d.files.join(", ")} put back as approved\n${settledNextLine(p, id)}`);
          return 0;
        }
        if (sub === "list") {
          const all = loadDeviations(loadChange(p, id));
          emit({ change: id, deviations: all }, all.length ? `${all.map((d) => `${d.id} ${d.status} ${d.roles.join(", ")}: ${d.files.join(", ")} (${d.reason})`).join("\n")}\n` : `no Deviations in ${id}\n`);
          return 0;
        }
        throw new UsageError("usage: aidw deviation open|close|abandon|list [<id>]");
      }

      case "not-built": {
        // D10: work outside the permission envelope is marked not built, never done.
        const p = project();
        const id = resolveChangeId(p, str(args.flags.change));
        const cause = str(args.flags.cause) ?? "envelope";
        if (cause !== "envelope" && cause !== "environment") throw new UsageError("--cause is envelope (outside what the user granted) or environment (a missing key, the network)");
        const taskId = need(rest[0], "task id");
        const reason = (str(args.flags.reason) ?? "").trim();
        if (!reason) throw new OpError('say why it is not built (--reason "...")');
        const tf = loadTasks(p, id);
        const t = tf.tasks.find((x) => x.id === taskId);
        if (!t) throw new OpError(`change "${id}" has no task ${taskId}`);
        if (String(t.status ?? "pending") === "done") throw new OpError(`task ${taskId} is done; reopen it first if what it built lies outside the grants`);
        if (String(t.status ?? "pending") === "not_built") throw new OpError(`task ${taskId} is already not built`);
        const marked = markNotBuilt(p, tf, taskId, reason, cause);
        emit({ ok: true, change: id, not_built: marked }, `not built: ${marked.join(", ")}\n${settledNextLine(p, id)}`);
        return 0;
      }

      case "approve": {
        const p = project();
        const id = resolveChangeId(p, rest[0]);
        const auto = args.flags.auto === true;
        const { hash, files, by } = approve(p, id, auto ? { auto: { pluginRoot: pluginRoot(env) } } : {});
        const { kept, reopened } = reconcileDoneTasks(p, id);
        // D2: the CLI, not the session, decides where the build runs.
        const root = pluginRoot(env);
        const route = buildRoute(id, tasksLeft(p, id), join(root, "bin", "aidw"), installedOutside(root, p.project) ? undefined : root);
        emit(
          { ok: true, id, hash, files, kept, reopened, route },
          `approved ${id}${by === "user" ? "" : ` by ${by}`}\n  ${hash}\n  covers ${files.length} file(s)\n${kept.length ? `  done work kept: ${kept.join(", ")}\n` : ""}${reopened.length ? `  edited tasks run again: ${reopened.join(", ")}\n` : ""}${route.next}\n`,
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
        const r = transition(p, id, to, { reason: str(args.flags.reason), pluginRoot: pluginRoot(env) });
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
        const { target, merges, commit, pushed, pushError } = archiveChange(p, id, env, { force: args.flags.force === true });
        // The archive commit also carries the project files the delivery wrote (README.md, .env.example): say so, they are not left uncommitted.
        const alsoCommitted = commit ? git(p.project, ["show", "--name-only", "--format=", commit]).out.split("\n").filter((f) => f && !f.startsWith(".aidw/")) : [];
        emit(
          { ok: true, id, archived: rel(p, target), capabilities: merges.map((m) => m.capability), commit: commit ?? null, also_committed: alsoCommitted, pushed: pushed ?? null, ...(pushError ? { push_error: pushError } : {}) },
          `archived ${id} -> ${rel(p, target)} (${merges.length} capability spec(s) updated)${commit ? `, committed ${commit.slice(0, 8)}` : ""}\n${alsoCommitted.length ? `also committed with it: ${alsoCommitted.join(", ")}\n` : ""}${pushed ? `pushed ${pushed}: the pull request carries the archive commit\n` : ""}${pushError ? `WARNING: ${pushError}\n` : ""}`,
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
if (typeof require !== "undefined" && require.main === module && process.argv[2] === SHOTS_WORKER) {
  runShotsWorker(JSON.parse(process.argv[3] ?? "{}"))
    .then((r) => process.stdout.write(`${JSON.stringify(r)}\n`))
    .catch((e: Error) => {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 1;
    });
} else if (typeof require !== "undefined" && require.main === module) {
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
