/**
 * What the user grants at the Approval Gate for one Change (ADR-0012, ADR-0014; plan D5, D14). The grants live in
 * the Change's `quality.yaml` under `grants:`, so they are part of the approved package: hashed by `aidw approve`,
 * frozen by the gate hook, and a later edit is approval drift.
 *
 *   grants:
 *     push: { remote: origin, base: main }   push the Change Branch to `remote` and open one pull request
 *                                            (draft included) against `base`, without asking
 *     envelope: true                         any free resource of a provider already in use; data-changing
 *                                            migrations on local and dev databases, reversible, tried on seed data
 *     agent_runs: 30                         cap on Agent runs for the Change (default 3 per planned task)
 *
 * Only the push grant is enforced here, by the gate hook: it is the one tier 3 action that can be granted ahead of
 * time, for one branch and one remote. The envelope cannot be told apart from other actions by a pattern, so it is
 * written into the briefs and the gate page for the Agents and the run to read; the cap is enforced by the run.
 * Never automatic, whatever is granted: see NEVER_AUTOMATIC.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import YAML from "yaml";
import { approvalStatus } from "./approval.js";
import { listChangeIds, loadChange, stateOf, type Change } from "./change.js";
import { Diags } from "./diag.js";
import type { Paths } from "./project.js";
import { parseTasks } from "./tasks.js";

export interface PushGrant {
  remote: string;
  base: string;
}

export interface Grants {
  push: PushGrant | null;
  envelope: boolean;
  /** the cap the user set; null means the default (AGENT_RUNS_PER_TASK per planned task) */
  agentRuns: number | null;
}

export const NO_GRANTS: Grants = { push: null, envelope: false, agentRuns: null };
export const AGENT_RUNS_PER_TASK = 3;

export const ENVELOPE = [
  "any free resource of a provider the project already uses",
  "migrations that change data on local and dev databases, when they are reversible and were tried on seed data first",
];

/** D14: never automatic, whatever else is granted. None of them lies on the way to a pull request. */
export const NEVER_AUTOMATIC = ["credentials outside the project's own `.env`", "anything that costs money", "production deploys", "deleting cloud data"];

const REMOTE_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const BRANCH_NAME = /^(?![-/])(?!.*(?:\.\.|\/\/|@\{))[\w./-]{1,200}(?<![./])$/;
const GRANT_KEYS = new Set(["push", "envelope", "agent_runs"]);

const isGrantMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates the `grants:` mapping of quality.yaml. Problems go to `d`; what is valid is returned. */
export function parseGrants(raw: unknown, file: string, d: Diags): Grants {
  if (raw === undefined || raw === null) return { ...NO_GRANTS };
  if (!isGrantMap(raw)) {
    d.error(file, '"grants" must be a mapping with "push", "envelope" and "agent_runs"');
    return { ...NO_GRANTS };
  }
  for (const k of Object.keys(raw)) if (!GRANT_KEYS.has(k)) d.error(file, `unknown grant "${k}" (known: push, envelope, agent_runs); production deploys, spending and deleting cloud data are never granted`);
  let push: PushGrant | null = null;
  if (raw.push !== undefined && raw.push !== null) {
    const p = isGrantMap(raw.push) ? raw.push : {};
    const remote = typeof p.remote === "string" ? p.remote : "";
    const base = typeof p.base === "string" ? p.base : "";
    if (!REMOTE_NAME.test(remote)) d.error(file, '"grants.push.remote" must name a git remote, e.g. origin');
    if (!BRANCH_NAME.test(base)) d.error(file, '"grants.push.base" must name the branch the pull request targets, e.g. main');
    if (REMOTE_NAME.test(remote) && BRANCH_NAME.test(base)) push = { remote, base };
  }
  if (raw.envelope !== undefined && typeof raw.envelope !== "boolean") d.error(file, '"grants.envelope" must be true or false');
  const runs = raw.agent_runs;
  if (runs !== undefined && runs !== null && !(Number.isInteger(runs) && Number(runs) >= 1)) d.error(file, '"grants.agent_runs" must be a positive integer (leave it out for 3 per planned task)');
  return { push, envelope: raw.envelope === true, agentRuns: Number.isInteger(runs) && Number(runs) >= 1 ? Number(runs) : null };
}

/** The grants of a Change as written in its quality.yaml; none when the file is missing or the block is invalid. */
export function readGrants(change: Change): Grants {
  let data: unknown;
  try {
    data = YAML.parse(readFileSync(join(change.dir, "quality.yaml"), "utf8"));
  } catch {
    return { ...NO_GRANTS };
  }
  const d = new Diags();
  const g = parseGrants(isGrantMap(data) ? data.grants : undefined, "quality.yaml", d);
  return d.errors.length ? { ...NO_GRANTS } : g;
}

export const agentRunCap = (g: Grants, plannedTasks: number): number => g.agentRuns ?? AGENT_RUNS_PER_TASK * Math.max(1, plannedTasks);

/** The Change Branch: recorded when the build starts, `aidw/<id>` before that (as `aidw pr` names it). */
export function changeBranchOf(change: Change): string {
  const b = (change.data.run as { branch?: unknown } | undefined)?.branch;
  return typeof b === "string" && b ? b : `aidw/${change.id}`;
}

const plannedTaskCount = (change: Change): number => {
  try {
    return parseTasks(readFileSync(join(change.dir, "tasks.yaml"), "utf8")).tasks.filter((t) => !t.origin).length;
  } catch {
    return 0;
  }
};

/** One line per grant, for the gate Decision Page. */
export function grantLines(g: Grants, branch: string, plannedTasks: number): string[] {
  return [
    g.push
      ? `**Push and pull request**: push \`${branch}\` to remote \`${g.push.remote}\` and open one pull request (a draft when something is not built) against base \`${g.push.base}\`, without asking. No other branch or remote; Task Worktree branches are never pushed.`
      : "**Push and pull request**: not granted; the push and the pull request ask at the end of the run.",
    g.envelope
      ? `**Permission envelope**: ${ENVELOPE.join("; ")}. Work outside it is marked not built.`
      : "**Permission envelope**: not granted; only the tier 2 resources listed under Permissions.",
    `**Cap**: ${agentRunCap(g, plannedTasks)} Agent runs${g.agentRuns === null ? ` (default: ${AGENT_RUNS_PER_TASK} per planned task)` : ""}; at the cap no new task starts and the run ends cleanly.`,
    `**Never automatic**, whatever is granted: ${NEVER_AUTOMATIC.join(", ")}.`,
  ];
}

/** The Grants section the CLI adds to a gate Decision Page; null without a quality.yaml. */
export function grantsSection(change: Change): { id: string; title: string; body: string; points: string[]; html: string } | null {
  try {
    readFileSync(join(change.dir, "quality.yaml"));
  } catch {
    return null;
  }
  return {
    id: "grants",
    title: "Grants for this Change",
    body: "Recorded in quality.yaml `grants` and approved with the package. Mark it for a change to grant or withdraw any of them.",
    points: grantLines(readGrants(change), changeBranchOf(change), plannedTaskCount(change)),
    html: "",
  };
}

/** The envelope as the task brief states it; empty when it was not granted. */
export function envelopeBrief(change: Change): string[] {
  if (!readGrants(change).envelope) return [];
  return [
    "Granted for this Change at the Approval Gate:",
    ...ENVELOPE.map((x) => `- ${x};`),
    "Work that needs more than this is not built: say so in your report, never do it.",
    `Never automatic, whatever is granted: ${NEVER_AUTOMATIC.join(", ")}.`,
  ];
}

// ---------------------------------------------------------------- the gate hook

/**
 * Splits a command into words the way the shell would, or returns null when the shell could expand, substitute,
 * redirect or chain anything (`$`, backticks, `;`, `&`, `|`, `<`, `>`, globs, `~`, backslashes, newlines). A command
 * that is not one plain list of words is never granted.
 */
export function shellWords(cmd: string): string[] | null {
  if (/[\n\r`$\\]/.test(cmd)) return null;
  const words: string[] = [];
  let cur = "";
  let has = false;
  let quote: string | null = null;
  for (const c of cmd) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) words.push(cur);
      cur = "";
      has = false;
    } else if (/[;&|<>(){}*?[\]~!#]/.test(c)) return null;
    else {
      cur += c;
      has = true;
    }
  }
  if (quote) return null;
  if (has) words.push(cur);
  return words;
}

/** Splits flags (with the names in `valued` taking a value, `--x=v` or `--x v`) from positional words; null on an unknown flag. */
function splitFlags(words: string[], valued: Record<string, string>, bool: Record<string, string>): { flags: Record<string, string | true>; args: string[] } | null {
  const flags: Record<string, string | true> = {};
  const args: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (!w.startsWith("-")) {
      args.push(w);
      continue;
    }
    const eq = w.indexOf("=");
    const name = eq > 0 ? w.slice(0, eq) : w;
    if (valued[name]) {
      const v = eq > 0 ? w.slice(eq + 1) : words[++i];
      if (v === undefined || flags[valued[name]] !== undefined) return null;
      flags[valued[name]] = v;
    } else if (bool[name] && eq < 0) flags[bool[name]] = true;
    else return null;
  }
  return { flags, args };
}

type Request = { kind: "push"; remote: string; ref: string } | { kind: "pr"; base: string | null; head: string } | { kind: "aidw-pr"; id: string; base: string | null };

/** The push or pull request a command asks for, in the only forms the grant covers; null for anything else. */
function requestOf(cmd: string): Request | null {
  const w = shellWords(cmd);
  if (!w) return null;
  if (w[0] === "git" && w[1] === "push") {
    const o = splitFlags(w.slice(2), {}, { "-u": "u", "--set-upstream": "u" });
    if (!o || o.args.length !== 2) return null;
    return { kind: "push", remote: o.args[0] as string, ref: o.args[1] as string };
  }
  if (w[0] === "gh" && w[1] === "pr" && w[2] === "create") {
    const o = splitFlags(
      w.slice(3),
      { "--base": "base", "-B": "base", "--head": "head", "-H": "head", "--title": "title", "-t": "title", "--body": "body", "-b": "body", "--body-file": "bodyFile", "-F": "bodyFile" },
      { "--draft": "draft", "-d": "draft", "--fill": "fill", "-f": "fill" },
    );
    if (!o || o.args.length || typeof o.flags.base !== "string" || typeof o.flags.head !== "string") return null;
    return { kind: "pr", base: o.flags.base, head: o.flags.head };
  }
  if (w[0] && basename(w[0]) === "aidw" && w[1] === "pr") {
    const o = splitFlags(w.slice(2), { "--change": "change", "--base": "base" }, { "--create": "create", "--draft": "draft", "--json": "json" });
    if (!o || o.flags.create !== true || o.args.length > 1) return null;
    const id = typeof o.flags.change === "string" ? o.flags.change : o.args[0];
    if (!id || (o.args.length && typeof o.flags.change === "string")) return null;
    return { kind: "aidw-pr", id, base: typeof o.flags.base === "string" ? o.flags.base : null };
  }
  return null;
}

/** `git push <remote> <ref>` names exactly the branch: `b`, `b:b`, `HEAD:b`, with `refs/heads/b` allowed as the destination. */
function refIsBranch(ref: string, branch: string): boolean {
  const i = ref.indexOf(":");
  if (i < 0) return ref === branch || ref === `refs/heads/${branch}`;
  const src = ref.slice(0, i);
  const dst = ref.slice(i + 1);
  return (src === branch || src === "HEAD" || src === `refs/heads/${branch}`) && (dst === branch || dst === `refs/heads/${branch}`);
}

/**
 * The reason a push or pull-request command passes without asking, or null. It passes only when a Change with a
 * valid approval, in one of `states`, grants push, and the command names that Change's branch, the granted remote
 * and (for the pull request) the granted base. Callers check tier x before and run this only for the Orchestrator.
 */
export function pushGrantReason(p: Paths, cmd: string, states: ReadonlySet<string>): string | null {
  const req = requestOf(cmd);
  if (!req) return null;
  for (const id of listChangeIds(p)) {
    try {
      const c = loadChange(p, id);
      const state = stateOf(c);
      if (!state || !states.has(state) || approvalStatus(p, c).status !== "valid") continue;
      const grant = readGrants(c).push;
      if (!grant) continue;
      const branch = changeBranchOf(c);
      if (branch === grant.base) continue;
      const by = `granted at the Approval Gate of ${id}`;
      if (req.kind === "push" && req.remote === grant.remote && refIsBranch(req.ref, branch)) return `push of the Change Branch ${branch} to ${grant.remote} was ${by}`;
      if (req.kind === "pr" && req.head === branch && req.base === grant.base) return `the pull request of ${branch} against ${grant.base} was ${by}`;
      if (req.kind === "aidw-pr" && req.id === id && (req.base ?? grant.base) === grant.base) return `pushing ${branch} to ${grant.remote} and its pull request against ${grant.base} were ${by}`;
    } catch {
      // an unreadable change grants nothing
    }
  }
  return null;
}
