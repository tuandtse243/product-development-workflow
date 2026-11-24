/**
 * `aidw gate`: PreToolUse hook entry point (blueprint section 12, spike evidence c1-c5).
 *
 * Reads the hook JSON from stdin and answers with a permission decision:
 *   - not an aidw project               -> no decision (the plugin is installed user-wide)
 *   - tier x                            -> deny
 *   - writes inside .aidw/              -> allow (state must be writable in headless runs),
 *                                          except the frozen approved package after approval
 *   - project writes before approval    -> deny
 *   - project writes after approval     -> allow
 *   - tier 3 / `aidw approve`           -> ask (a human decides), except the push of the Change Branch and
 *                                          its pull request when granted at the Approval Gate (src/grants.ts)
 *   - MCP tools that may write          -> deny before approval and for subagents, ask after approval
 *                                          (read-like names: get_, list_, search_... follow normal rules)
 * Fails closed inside an aidw project: an internal error denies the call.
 */
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { approvalStatus, baseSpecFiles, FROZEN_PROJECT_DIRS, PACKAGE_VERSION, packageFilesFor, packageVersionOf } from "./approval.js";
import { listChangeIds, loadChange, stateOf, type State } from "./change.js";
import { AIDW_DIR, findProject, pathsFor, rel, type Paths } from "./project.js";
import {
  AIDW_COMMAND,
  APPROVE_COMMAND,
  ASK_COMMANDS,
  AIDW_STATE_COMMAND,
  FORBIDDEN_COMMANDS,
  firstMatch,
  IMPLEMENTER_PROTECTED,
  INLINE_CODE,
  ODD_CHARACTER,
  SECRET_PATHS,
  SHELL_CHAINING,
  TIER2_COMMANDS,
  WRITE_COMMANDS,
  maskQuoted,
  writeTargets,
  RUNNER_COMMAND,
} from "./policy.js";
import { installedOutside, runnerCommand } from "./buildroute.js";
import { pushGrantReason, taskBranchPush } from "./grants.js";
import { grantedResources } from "./quality.js";
import { machineOf } from "./machine.js";
import { bundledRoot, pluginRoot } from "./plugin.js";
import { roleAccess } from "./roles.js";
import { consultWrite } from "./consult.js";
import { DEVIATIONS_DIR, DEVIATIONS_FILE, openDeviation } from "./deviationrecord.js";

export interface HookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  agent_type?: string;
}

export type Decision = { decision: "allow" | "deny" | "ask"; reason: string } | null;

/** States in which code may be written: approved and actively executing. */
export const OPEN_STATES: ReadonlySet<State> = new Set<State>(["approved", "executing", "verifying", "converging", "deploying"]);

/** States in which a push granted at the Approval Gate holds: open, or delivered (the pull request is opened then). */
const GRANT_STATES: ReadonlySet<State> = new Set<State>([...OPEN_STATES, "delivered"]);

export interface GateState {
  open: boolean;
  drift: string[];
  /** ids of changes whose approved package is frozen */
  frozen: string[];
  /** a change is delivered with a valid approval (delivery package being written) */
  delivered: boolean;
  summary: string;
}

export function gateState(p: Paths): GateState {
  const st: GateState = { open: false, drift: [], frozen: [], delivered: false, summary: "" };
  const parts: string[] = [];
  for (const id of listChangeIds(p)) {
    let state: State | null = null;
    try {
      const c = loadChange(p, id);
      state = stateOf(c);
      const machine = machineOf(p, c);
      if (state && machine.approvalRequired.has(state)) {
        const a = approvalStatus(p, c).status;
        if (a === "drift") st.drift.push(id);
        if (a === "valid" && OPEN_STATES.has(state)) st.open = true;
        if (a === "valid" && state === "delivered") st.delivered = true;
        // the approved package is frozen against edits in every approved state but escalated
        if (state !== "escalated") st.frozen.push(id);
      }
    } catch {
      // an unreadable change never opens the gate
    }
    parts.push(`${id}=${state ?? "?"}`);
  }
  st.summary = parts.length ? parts.join(", ") : "no changes";
  return st;
}

/** Whether a Change has a valid approval and is in a state that builds: the runner allowance of D2 is per Change. */
function approvedForBuild(p: Paths, id: string): boolean {
  try {
    const c = loadChange(p, id);
    const state = stateOf(c);
    return !!state && OPEN_STATES.has(state) && approvalStatus(p, c).status === "valid";
  } catch {
    return false;
  }
}

function inside(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

/**
 * `inside` without case, for the checks that protect a path: macOS and Windows file systems take `.AIDW/Run` for
 * `.aidw/run`. An allow keeps the exact `inside`, so a case variant never gains what the exact path is given.
 */
const lower = (f: string) => f.toLowerCase();
const insideAnyCase = (parent: string, child: string) => inside(lower(parent), lower(child));

function isFrozenPackageFile(p: Paths, file: string, frozen: string[]): boolean {
  const f = lower(file);
  if (f === lower(p.constitution) || FROZEN_PROJECT_DIRS(p).some((d) => insideAnyCase(d, file))) return frozen.length > 0;
  for (const id of frozen) {
    try {
      if (baseSpecFiles(p, loadChange(p, id)).some((b) => lower(b) === f)) return true;
    } catch {
      // unreadable change: its package files are checked below
    }
    const dir = lower(join(p.changes, id));
    if (!inside(dir, f)) continue;
    const r = relative(dir, f).split(sep).join("/");
    let version = 1;
    try {
      version = packageVersionOf(loadChange(p, id));
    } catch {
      version = PACKAGE_VERSION; // unreadable: freeze the widest list
    }
    if (packageFilesFor(version).some((x) => x.toLowerCase() === r) || r.startsWith("specs/")) return true;
  }
  return false;
}

/**
 * ADR-0014: while a Deviation is open, exactly its author Role may edit exactly its files (src/deviation.ts). Null when
 * the file is not in an open Deviation, so the frozen package rule applies.
 */
function deviationEdit(p: Paths, file: string, agent: string, frozen: string[]): Decision {
  for (const id of frozen) {
    let d: ReturnType<typeof openDeviation> = null;
    try {
      d = openDeviation(loadChange(p, id));
    } catch {
      d = null;
    }
    if (!d || !d.files.some((f) => lower(join(p.project, f)) === lower(file))) continue;
    const f = d.files.find((x) => lower(join(p.project, x)) === lower(file));
    const author = f ? d.authors?.[f] : undefined;
    // found without case, allowed only at the exact path: a case variant never gains what the exact path is given
    if (author && agent === author && f && join(p.project, f) === file) return allow(`Deviation ${d.id}: ${author} changes what it wrote`);
    return deny(`Deviation ${d.id} of ${id} lets only ${author ?? "its author Role"} edit ${rel(p, file)}: no other Agent and not the Orchestrator edits it while it is open`);
  }
  return null;
}

/**
 * ADR-0014: a Bash command that could write a file an open Deviation names (in any case, by its path inside `.aidw/` or
 * from the project): only the author Role edits it, and the Orchestrator's edit would close as the author's change.
 * Best effort, like the inline-code rule (H1): the path is matched as text, so a path relative to another `cd`, a glob
 * or a variable is not caught.
 */
function deviationBashWrite(p: Paths, cmd: string, frozen: string[]): string | null {
  const text = lower(cmd);
  if (!text.includes(".aidw") && !text.includes("changes/") && !/(?:architecture|domain|design|requirements|specs)\//.test(text) && !text.includes("constitution")) return null;
  for (const id of frozen) {
    let d: ReturnType<typeof openDeviation> = null;
    try {
      d = openDeviation(loadChange(p, id));
    } catch {
      d = null;
    }
    if (!d) continue;
    const hit = d.files.find((f) => text.includes(lower(relative(p.aidw, join(p.project, f)).split(sep).join("/"))));
    if (!hit) continue;
    const masked = maskQuoted(cmd);
    // also what puts a file back or rewrites it in place: git checkout -- / git restore, a formatter's --write or --fix
    const rewrites = /\bgit\s+(?:checkout|restore)\b/.test(masked) || /(?:^|\s)--(?:write|fix)\b/.test(masked);
    if (rewrites || firstMatch(WRITE_COMMANDS, masked) || firstMatch(INLINE_CODE, masked) || firstMatch(WRITE_COMMANDS, cmd)) {
      return `Deviation ${d.id} of ${id} is open: only ${d.authors?.[hit] ?? "its author Role"} edits ${hit}, with the Write tool; no Bash write by the Orchestrator or any Agent`;
    }
  }
  return null;
}

/** MCP tool names (the part after `mcp__<server>__`) that only read. */
export const MCP_READ_TOOL = /^(?:get|list|search|read|fetch|find|query|show|view|describe|whoami)(?:_|$)/i;

/** The one aidw file an implementer may write besides screenshots: a note for the reviewer. */
const REPORT_FILE = /^report-[A-Za-z0-9._-]+\.md$/;

/** The only file a reviewer may write: its verdict, in .aidw/run/. */
const VERDICT_FILE = /^(?:layer-)?review-[A-Za-z0-9._-]+\.md$/;

/** The plan review's verdict (D4): only the code-reviewer writes it. */
const PLAN_REVIEW_FILE = /^review-plan-[A-Za-z0-9._-]+\.md$/i;
/** The CLI's record of the plan review's rounds: no Agent writes it. */
const PLAN_REVIEW_RECORD = "plan-review.yaml";

/** The CLI's record of Consultations (ADR-0013): no Agent writes it. */
const CONSULT_RECORD = "consultations.yaml";

/** An audit reviewer's answer: .aidw/run/audit-<lens>.md. */
const AUDIT_FILE = /^audit-[a-z0-9-]+\.md$/;

/**
 * What an aidw subagent may do, from the hook's agent_type ("aidw:code-reviewer", "fullstack", ...). The name is a
 * Role id and the Role's profile declares its access: `write` -> "implementer", `read-only` -> "reviewer".
 * `artifacts` -> "author": it drafts Artifacts under `.aidw/` and never touches project files, before or after approval.
 * An unknown name ending in "reviewer" is still treated as read-only, so a renamed reviewer never gains write access.
 */
export function agentRole(agentType: string | undefined, env: NodeJS.ProcessEnv = process.env): "implementer" | "reviewer" | "author" | null {
  const name = (agentType ?? "").split(":").pop() ?? "";
  if (!name) return null;
  // A Role's access is what keeps a reviewer read-only: it comes from the bundled plugin, never from an environment override.
  const access = roleAccess(bundledRoot() ?? pluginRoot(env), name);
  if (access === "write") return "implementer";
  if (access === "read-only") return "reviewer";
  if (access === "artifacts") return "author";
  return name === "reviewer" || name.endsWith("-reviewer") ? "reviewer" : null;
}

const deny = (reason: string): Decision => ({ decision: "deny", reason: `AIDW: ${reason}` });
const ask = (reason: string): Decision => ({ decision: "ask", reason: `AIDW: ${reason}` });
const allow = (reason: string): Decision => ({ decision: "allow", reason: `AIDW: ${reason}` });

export function closedReason(st: GateState): string {
  if (st.drift.length) {
    return `approval drift in ${st.drift.join(", ")}: the approved Analysis package changed. Escalate and re-approve before writing project files.`;
  }
  if (st.delivered) {
    return `the change is delivered (${st.summary}): only .aidw/, .env.example and README.md may be written. Write temporary output under $TMPDIR.`;
  }
  if (/=(?:escalated|paused)\b/.test(st.summary)) {
    return `the run is stopped (${st.summary}): project files stay frozen until the user decides how to continue (/aidw:status). Only .aidw/ may be written.`;
  }
  if (st.summary === "no changes") {
    return "no aidw change is open (the last one is archived, or none was started): an agent writes project files only through an approved change. Start one (/aidw:start, or the bugfix workflow for a defect); the user may still edit files themselves. Only .aidw/ may be written.";
  }
  return `Analysis is not approved yet (${st.summary}). Only .aidw/ may be written before approval.`;
}

export function decide(input: HookInput, env: NodeJS.ProcessEnv): Decision {
  const cwd = input.cwd ?? process.cwd();
  const project = findProject({ cwd, env });
  if (!project) return null;
  const p = pathsFor(project);
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};

  if (tool === "Read") {
    const file = String(ti.file_path ?? "");
    const secret = firstMatch(SECRET_PATHS, file);
    return secret && !inside(project, resolve(cwd, file)) ? deny(`reading ${secret.why} is forbidden (tier x)`) : null;
  }

  const role = agentRole(input.agent_type, env);

  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const raw = String(ti.file_path ?? ti.notebook_path ?? "");
    if (!raw) return null;
    const file = resolve(cwd, raw);
    const secret = firstMatch(SECRET_PATHS, file);
    if (secret && !inside(project, file)) return deny(`writing ${secret.why} is forbidden (tier x)`);
    if (!inside(project, file)) return null; // outside the project: normal permission rules apply

    // D4: an author of the package must not forge the review of it, and no Agent writes the CLI's record of rounds
    if (input.agent_type) {
      const name = input.agent_type.split(":").pop() ?? "";
      // compared without case: macOS and Windows file systems take Plan-Review.yaml for plan-review.yaml
      const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      if (same(basename(file), PLAN_REVIEW_RECORD) && same(dirname(dirname(file)), p.changes)) {
        return deny("plan-review.yaml is the CLI's record of the plan review; only `aidw plan-review` writes it");
      }
      if (same(basename(file), CONSULT_RECORD) && same(dirname(dirname(file)), p.changes)) {
        return deny("consultations.yaml is the CLI's record of Consultations; only `aidw consult` writes it");
      }
      if (same(basename(file), "agent-runs.json") && same(basename(dirname(file)), "evidence") && same(dirname(dirname(dirname(file))), p.changes)) {
        return deny("evidence/agent-runs.json is the CLI's count of Agent runs against the cap (D10); no Agent writes it");
      }
      // ADR-0014: the record of Deviations and the copies of what was approved are the CLI's
      const parts = relative(lower(p.changes), lower(file)).split(sep);
      if (insideAnyCase(p.changes, file) && (same(parts[1] ?? "", DEVIATIONS_FILE) || same(parts[1] ?? "", DEVIATIONS_DIR)) && parts.length >= 2) {
        return deny("deviations.yaml and deviations/ are the CLI's record of Deviations; only `aidw deviation` writes them");
      }
      // ADR-0013: the request of the Agent running a task, the answer of the consulted Role, nothing else
      const consult = role === "reviewer" ? null : consultWrite(p, file, name, role);
      if (consult) return consult.allow ? allow(consult.reason) : deny(consult.reason);
      if (same(dirname(file), p.run) && PLAN_REVIEW_FILE.test(basename(file)) && name !== "code-reviewer") {
        return deny("the plan review's verdict is written only by the code-reviewer that the orchestrator spawned with its brief");
      }
    }
    if (role === "author" && !inside(p.aidw, file)) {
      return deny("an authoring role drafts Artifacts under .aidw/ only; project files are written by the implementing roles after approval");
    }

    if (role === "reviewer") {
      // The one thing a reviewer writes is its verdict file: the orchestrator reads it from disk instead of
      // carrying the whole reply in its context.
      if (dirname(file) === p.run && (VERDICT_FILE.test(basename(file)) || AUDIT_FILE.test(basename(file)))) return allow("reviewer verdict file");
      return deny("the reviewer is read-only; report issues in the verdict instead of fixing them (it may write only .aidw/run/review-<task>.md or layer-review-<layer>.md)");
    }
    // S8: a wave task's git worktree is project code, not aidw state; its own .aidw/ is a stale copy.
    const worktrees = join(p.run, "worktrees");
    if (insideAnyCase(worktrees, file)) {
      const parts = relative(lower(worktrees), lower(file)).split(sep);
      if (parts.length < 3) return deny("write inside a task's worktree (.aidw/run/worktrees/<change>/<task>/...)");
      if (parts[2] === AIDW_DIR) return deny("the worktree's .aidw/ is a stale copy; aidw state lives in the main checkout and is the orchestrator's");
      const st = gateState(p);
      return st.open ? allow("analysis approved (task worktree)") : deny(closedReason(st));
    }
    if (role === "implementer" && dirname(file) === p.run && REPORT_FILE.test(basename(file))) return allow("implementer note for the reviewer");
    if (role === "implementer" && insideAnyCase(p.aidw, file) && !inside(join(p.run, "shots"), file)) {
      return deny("implementers do not write .aidw/; the orchestrator records progress and evidence");
    }
    const st = gateState(p);
    if (insideAnyCase(p.aidw, file)) {
      // ADR-0014: a file named by an open Deviation (frozen, or the task list) is its author Role's alone until it closes
      const dev = deviationEdit(p, file, (input.agent_type ?? "").split(":").pop() ?? "", st.frozen);
      if (dev) return dev;
      if (isFrozenPackageFile(p, file, st.frozen)) {
        return deny(
          "the approved Analysis package is frozen during execution. A change to something approved is a Deviation by the Role that wrote it (`aidw deviation open`, ADR-0014); the user's own change of scope goes through escalated and back to analyzing, then re-approval.",
        );
      }
      return allow("aidw state directory");
    }
    if (st.open) return allow("analysis approved");
    // The delivery package may add the env template after the code is final; nothing else.
    if (st.delivered && rel(p, file) === ".env.example") return allow("environment template for the delivery package");
    if (st.delivered && rel(p, file) === "README.md") return allow("project README brought up to date at delivery");
    return deny(closedReason(st));
  }

  if (tool.startsWith("mcp__")) {
    // MCP servers (Vercel, GitHub, Supabase...) reach the outside world directly, around the Bash tiers.
    // Read-like tools follow the normal permission rules; anything else is a human decision.
    if (MCP_READ_TOOL.test(tool.split("__").pop() ?? "")) return null;
    if (role) return deny(`the ${role} does not call external services that change state (${tool}); report the need to the orchestrator`);
    const st = gateState(p);
    if (!st.open) return deny(`${tool} may change an external service. ${closedReason(st)}`);
    return ask(`${tool} may change an external service; it needs your confirmation (tier 3)`);
  }

  if (tool === "Bash") {
    const cmd = String(ti.command ?? "");
    const forbidden = firstMatch(FORBIDDEN_COMMANDS, cmd) ?? firstMatch(SECRET_PATHS, cmd);
    if (forbidden) return deny(`command ${forbidden.why}; forbidden (tier x)`);
    const taskPush = taskBranchPush(cmd);
    if (taskPush) return deny(taskPush);
    if (!AIDW_COMMAND.test(cmd) || SHELL_CHAINING.test(cmd)) {
      const devWrite = deviationBashWrite(p, cmd, gateState(p).frozen);
      if (devWrite) return deny(devWrite);
    }
    if (role && AIDW_STATE_COMMAND.test(cmd)) {
      return deny(`the ${role} does not change aidw state (no self-verification); report back to the orchestrator`);
    }
    if (RUNNER_COMMAND.test(cmd)) {
      // D2: after approval the main session starts the detached runner itself; its sessions run in auto mode (ADR-0014).
      // An allow here also skips the prompt for running it outside the sandbox, so only the exact command the CLI
      // prints for an approved Change is allowed, and only for an installed plugin outside the project.
      if (!input.agent_type && env.AIDW_RUNNER !== "1") {
        const root = pluginRoot(env);
        const silent = installedOutside(root, p.project);
        const approved = listChangeIds(p).filter((id) => approvedForBuild(p, id));
        const plain = cmd.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
        if (silent && !ODD_CHARACTER.test(plain) && approved.some((id) => plain === runnerCommand(id, join(root, "bin", "aidw")))) {
          return allow("the change is approved: the detached runner builds it (`aidw approve` printed this exact command)");
        }
        // A start that names no approved Change is denied, not asked: the allowance is per Change.
        const names = cmd.trim().split(/[ \t]+/);
        if (approved.some((id) => names.includes(id)) && /(?:^|\s)--detach(?:\s|$)/.test(cmd)) {
          return ask(
            silent
              ? "this starts the runner, outside the sandbox, with other words than the command `aidw approve` printed; it needs your confirmation"
              : "this starts the runner outside the sandbox, and aidw is loaded from a folder rather than installed; it needs your confirmation",
          );
        }
      }
      return deny(
        "`aidw run` starts Claude Code headless in a loop: only the main session of an approved change starts it, in the background (`aidw run <id> --detach --permission-mode auto`); otherwise the user runs it in their own terminal",
      );
    }
    if (APPROVE_COMMAND.test(cmd)) {
      return ask("approving the Analysis package is the user's decision. Approve only if you (the user) reviewed analysis.md.");
    }
    // ADR-0012: the push of the Change Branch and its pull request, granted at the Approval Gate, for the Orchestrator
    // only: any agent (an aidw Role or not) still asks.
    const pushGranted = input.agent_type ? null : pushGrantReason(p, cmd, GRANT_STATES, cwd, env);
    if (pushGranted) return allow(pushGranted);
    const risky = firstMatch(ASK_COMMANDS, cmd);
    if (risky) return ask(`this command ${risky.why}; it needs your confirmation (tier 3)`);
    const tier2 = firstMatch(TIER2_COMMANDS, cmd);
    if (tier2) {
      if (role) return deny(`the ${role} does not touch cloud resources; deploys are the orchestrator's step`);
      const granted = grantedResources(p, listChangeIds(p), OPEN_STATES);
      if (granted.has(tier2.resource) && !SHELL_CHAINING.test(cmd) && !ODD_CHARACTER.test(cmd)) {
        return allow(`tier 2 "${tier2.resource}" is in the approved allowlist`);
      }
      return ask(
        `this command ${tier2.why} (tier 2 "${tier2.resource}"), which is not in an approved, active allowlist${SHELL_CHAINING.test(cmd) ? " or is chained with other commands" : ""}; it needs your confirmation`,
      );
    }
    if (role && /\bgit\s+(?:commit|merge|rebase|reset|tag|cherry-pick|revert)\b/.test(cmd)) {
      return deny(`the ${role} does not commit; the orchestrator commits each task after review`);
    }
    if (/\bgit\s+(?:commit|merge|push)\b[^|;&]*\s--no-verify(?:\s|$)|\bgit\s+commit\b[^|;&]*\s-[a-mo-zA-Z]*n[a-zA-Z]*(?:\s|$)|\bHUSKY=0\b/.test(cmd)) {
      return deny("skipping the git hooks (--no-verify, HUSKY=0) is not allowed: fix what the hook reports");
    }
    // H1: code handed to an interpreter inline is a write the gate cannot see; a Role denied Bash writes may not run it.
    // Quoted text (a commit message, a grep pattern) is masked first, so it is never read as a command.
    const masked = maskQuoted(cmd);
    const code = role === "reviewer" || role === "author" ? firstMatch(INLINE_CODE, masked) : undefined;
    if (code) return deny(`the ${role} may not write by Bash, and this command ${code.why} that could write; use Read, Grep and the project's own scripts`);
    if (AIDW_COMMAND.test(cmd) && !SHELL_CHAINING.test(masked) && !ODD_CHARACTER.test(masked)) return null;
    const writes = firstMatch(WRITE_COMMANDS, masked);
    if (role === "implementer" && writeTargets(cmd).some((t) => IMPLEMENTER_PROTECTED.test(t))) {
      return deny("implementers do not write .aidw/ or a verdict, by Bash either; the orchestrator records progress and evidence");
    }
    if (writes) {
      if (role === "reviewer") return deny(`the reviewer is read-only (this command ${writes.why})`);
      if (role === "author") return deny(`an authoring role writes its files with the Write tool, inside ${AIDW_DIR}/ (this command ${writes.why})`);
      const st = gateState(p);
      if (!st.open) return deny(`this command ${writes.why}. ${closedReason(st)} Use the Write tool for files in ${AIDW_DIR}/.`);
    }
    return null;
  }
  return null;
}

/** Hook wire format for a PreToolUse decision. */
export function toHookOutput(d: Decision): string {
  if (!d) return "";
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d.decision, permissionDecisionReason: d.reason },
  });
}

/** Runs the gate for raw stdin text. Never throws. */
export function runGate(stdin: string, env: NodeJS.ProcessEnv): string {
  let input: HookInput;
  try {
    input = JSON.parse(stdin) as HookInput;
  } catch {
    return "";
  }
  try {
    return toHookOutput(decide(input, env));
  } catch (e) {
    const project = findProject({ cwd: input.cwd ?? process.cwd(), env });
    return project ? toHookOutput(deny(`gate error, failing closed: ${(e as Error).message}`)) : "";
  }
}
