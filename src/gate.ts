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
 *   - tier 3 / `aidw approve`           -> ask (a human decides)
 *   - MCP tools that may write          -> deny before approval and for subagents, ask after approval
 *                                          (read-like names: get_, list_, search_... follow normal rules)
 * Fails closed inside an aidw project: an internal error denies the call.
 */
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { approvalStatus, baseSpecFiles, CHANGE_PACKAGE_FILES, FROZEN_PROJECT_DIRS } from "./approval.js";
import { listChangeIds, loadChange, stateOf, type State } from "./change.js";
import { AIDW_DIR, findProject, pathsFor, rel, type Paths } from "./project.js";
import {
  AIDW_COMMAND,
  APPROVE_COMMAND,
  ASK_COMMANDS,
  AIDW_STATE_COMMAND,
  FORBIDDEN_COMMANDS,
  firstMatch,
  SECRET_PATHS,
  SHELL_CHAINING,
  TIER2_COMMANDS,
  WRITE_COMMANDS,
  maskQuotedAngles,
  RUNNER_COMMAND,
} from "./policy.js";
import { grantedResources } from "./quality.js";
import { machineOf } from "./machine.js";
import { bundledRoot, pluginRoot } from "./plugin.js";
import { roleAccess } from "./roles.js";

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

function inside(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

function isFrozenPackageFile(p: Paths, file: string, frozen: string[]): boolean {
  if (file === p.constitution || FROZEN_PROJECT_DIRS(p).some((d) => inside(d, file))) return frozen.length > 0;
  for (const id of frozen) {
    try {
      if (baseSpecFiles(p, loadChange(p, id)).includes(file)) return true;
    } catch {
      // unreadable change: its package files are checked below
    }
    const dir = join(p.changes, id);
    if (!inside(dir, file)) continue;
    const r = relative(dir, file).split(sep).join("/");
    if ((CHANGE_PACKAGE_FILES as readonly string[]).includes(r) || r.startsWith("specs/")) return true;
  }
  return false;
}

/** MCP tool names (the part after `mcp__<server>__`) that only read. */
export const MCP_READ_TOOL = /^(?:get|list|search|read|fetch|find|query|show|view|describe|whoami)(?:_|$)/i;

/** The one aidw file an implementer may write besides screenshots: a note for the reviewer. */
const REPORT_FILE = /^report-[A-Za-z0-9._-]+\.md$/;

/** The only file a reviewer may write: its verdict, in .aidw/run/. */
const VERDICT_FILE = /^(?:layer-)?review-[A-Za-z0-9._-]+\.md$/;

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
    if (inside(worktrees, file)) {
      const parts = relative(worktrees, file).split(sep);
      if (parts.length < 3) return deny("write inside a task's worktree (.aidw/run/worktrees/<change>/<task>/...)");
      if (parts[2] === AIDW_DIR) return deny("the worktree's .aidw/ is a stale copy; aidw state lives in the main checkout and is the orchestrator's");
      const st = gateState(p);
      return st.open ? allow("analysis approved (task worktree)") : deny(closedReason(st));
    }
    if (role === "implementer" && dirname(file) === p.run && REPORT_FILE.test(basename(file))) return allow("implementer note for the reviewer");
    if (role === "implementer" && inside(p.aidw, file) && !inside(join(p.run, "shots"), file)) {
      return deny("implementers do not write .aidw/; the orchestrator records progress and evidence");
    }
    const st = gateState(p);
    if (inside(p.aidw, file)) {
      if (isFrozenPackageFile(p, file, st.frozen)) {
        return deny(
          "the approved Analysis package is frozen during execution. To change scope, transition the change to escalated and back to analyzing, then re-approve.",
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
    if (role && AIDW_STATE_COMMAND.test(cmd)) {
      return deny(`the ${role} does not change aidw state (no self-verification); report back to the orchestrator`);
    }
    if (RUNNER_COMMAND.test(cmd)) {
      return deny("`aidw run` starts Claude Code headless in a loop; the user runs it in their own terminal, not inside a session");
    }
    if (APPROVE_COMMAND.test(cmd)) {
      return ask("approving the Analysis package is the user's decision. Approve only if you (the user) reviewed analysis.md.");
    }
    const risky = firstMatch(ASK_COMMANDS, cmd);
    if (risky) return ask(`this command ${risky.why}; it needs your confirmation (tier 3)`);
    const tier2 = firstMatch(TIER2_COMMANDS, cmd);
    if (tier2) {
      if (role) return deny(`the ${role} does not touch cloud resources; deploys are the orchestrator's step`);
      const granted = grantedResources(p, listChangeIds(p), OPEN_STATES);
      if (granted.has(tier2.resource) && !SHELL_CHAINING.test(cmd)) {
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
    if (AIDW_COMMAND.test(cmd) && !SHELL_CHAINING.test(cmd)) return null;
    const writes = firstMatch(WRITE_COMMANDS, maskQuotedAngles(cmd));
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
