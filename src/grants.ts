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
 *     agent_runs: 30                         cap on Agent runs for the Change (default 3 times the planned Agent runs)
 *
 * Only the push grant is enforced here, by the gate hook: it is the one tier 3 action that can be granted ahead of
 * time, for one branch and one remote. The envelope cannot be told apart from other actions by a pattern, so it is
 * written into the briefs and the gate page for the Agents and the run to read; the cap is enforced by the run.
 * Never automatic, whatever is granted: see NEVER_AUTOMATIC.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { approvalStatus } from "./approval.js";
import { approvedText } from "./deviationrecord.js";
import { listChangeIds, loadChange, stateOf, type Change } from "./change.js";
import { Diags } from "./diag.js";
import { git, isDefaultBranch, isGitRepo } from "./git.js";
import { bundledRoot, pluginRoot } from "./plugin.js";
import { ODD_CHARACTER } from "./policy.js";
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
/** D5: the default cap is this many times the Agent runs the plan needs (plannedAgentRuns). */
export const AGENT_RUNS_FACTOR = 3;

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
    // while a Deviation has quality.yaml open, the grants are the approved ones (src/deviationrecord.ts)
    const text = approvedText(change, join(change.dir, "quality.yaml"));
    if (text === null) return { ...NO_GRANTS };
    data = YAML.parse(text);
  } catch {
    return { ...NO_GRANTS };
  }
  const d = new Diags();
  const g = parseGrants(isGrantMap(data) ? data.grants : undefined, "quality.yaml", d);
  return d.errors.length ? { ...NO_GRANTS } : g;
}

export const agentRunCap = (g: Grants, plannedRuns: number): number => g.agentRuns ?? AGENT_RUNS_FACTOR * Math.max(1, plannedRuns);

/**
 * The Agent runs the approved plan needs (D5), what the default cap is measured against: an implementer and a reviewer
 * per planned task, and one reviewer per review layer of quality.yaml. The plan review is not counted: it runs before
 * the gate.
 */
export function plannedAgentRuns(change: Change): { tasks: number; reviewLayers: number; runs: number } {
  const tasks = plannedTaskCount(change);
  let reviewLayers = 0;
  try {
    // the approved text: a Deviation that has quality.yaml open does not move the count meanwhile
    const data = YAML.parse(approvedText(change, join(change.dir, "quality.yaml")) ?? "") as { layers?: unknown } | null;
    if (Array.isArray(data?.layers)) reviewLayers = data.layers.filter((l) => isGrantMap(l) && typeof l.review === "string" && l.review).length;
  } catch {
    reviewLayers = 0;
  }
  return { tasks, reviewLayers, runs: tasks * 2 + reviewLayers };
}

/** The cap of a Change: as fixed in the approval record at `aidw approve` (a Deviation adding tasks does not move it), else computed. */
export function changeAgentRunCap(change: Change): number {
  const fixed = (change.data.approval as { agent_run_cap?: unknown } | null | undefined)?.agent_run_cap;
  return Number.isInteger(fixed) && Number(fixed) >= 1 ? Number(fixed) : agentRunCap(readGrants(change), plannedAgentRuns(change).runs);
}

/** What `aidw approve` fixes for the push grant, hashed with the package: the gate matches only these values. */
export interface PushBinding {
  branch: string;
  remote: string;
  /** the remote's URL at approval (null: no such remote then); a different URL at push time asks again */
  url: string | null;
  base: string;
}

/** A Task Worktree branch (`aidw/<change>.<task>`, src/parallel.ts): never pushed (ADR-0012). */
const TASK_BRANCH = /\.T\d+$/;

/** The URL `git push <remote>` sends to (pushurl and pushInsteadOf included); null when there is no such remote. */
const remoteUrl = (p: Paths, remote: string): string | null => {
  const r = git(p.project, ["remote", "get-url", "--push", remote]);
  return r.ok && r.out ? r.out : null;
};

/**
 * Why git could send `git push <remote> <branch>` somewhere the binding does not say, or null: a configured push
 * refspec or mirror for the remote maps the branch elsewhere, and a pushInsteadOf rewrite changes the URL.
 */
function pushConfigProblem(p: Paths, remote: string): string | null {
  if (git(p.project, ["config", "--get-all", `remote.${remote}.push`]).out) return `remote.${remote}.push is set`;
  if (git(p.project, ["config", "--get", `remote.${remote}.mirror`]).out) return `remote.${remote}.mirror is set`;
  if (git(p.project, ["config", "--get-regexp", "^url\\..*\\.pushinsteadof$"]).out) return "a url.<base>.pushInsteadOf rewrite is set";
  return null;
}

/** Why a name cannot be the Change Branch the push grant covers, or null. Checked at approval and again at push time. */
function branchProblem(p: Paths, branch: string, base: string): string | null {
  if (!BRANCH_NAME.test(branch) || branch.startsWith("refs/") || branch === "HEAD" || branch === "@" || branch.endsWith(".lock") || branch.includes("..")) return `"${branch}" is not a plain branch name`;
  if (TASK_BRANCH.test(branch)) return `"${branch}" is a Task Worktree branch, never pushed`;
  if (branch === base) return `the Change Branch "${branch}" is the base itself`;
  if (isDefaultBranch(p.project, branch)) return `"${branch}" is the project's default branch`;
  return null;
}

/** `owner/repo` of a GitHub remote URL, for `gh pr create --repo`; null for any other host. */
export function githubSlug(url: string | null): string | null {
  const m = url ? /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url) : null;
  return m ? (m[1] as string) : null;
}

/**
 * The Change Branch the build will commit on, as `useChangeBranch` (src/ops.ts) picks it: the one already recorded,
 * else the feature branch the project is on, else `aidw/<id>`.
 */
function plannedBranch(p: Paths, change: Change): string {
  const b = (change.data.run as { branch?: unknown } | undefined)?.branch;
  if (typeof b === "string" && b) return b;
  const current = isGitRepo(p.project) ? git(p.project, ["branch", "--show-current"]).out : "";
  return current && !isDefaultBranch(p.project, current) ? current : `aidw/${change.id}`;
}

/** The push binding `aidw approve` records, or why the push grant cannot hold (null binding, no grant: no problem). */
export function bindPush(p: Paths, change: Change): { binding: PushBinding | null; problem: string | null } {
  const grant = readGrants(change).push;
  if (!grant) return { binding: null, problem: null };
  const branch = plannedBranch(p, change);
  const problem = branchProblem(p, branch, grant.base);
  if (problem) return { binding: null, problem };
  return { binding: { branch, remote: grant.remote, url: remoteUrl(p, grant.remote), base: grant.base }, problem: null };
}

/** The binding recorded at approval, when it still agrees with the frozen grant and the branch rules (checked again here). */
export function boundPush(p: Paths, change: Change): PushBinding | null {
  const grant = readGrants(change).push;
  const b = (change.data.approval as { push?: Partial<PushBinding> } | null | undefined)?.push;
  if (!grant || !b || typeof b.branch !== "string" || b.remote !== grant.remote || b.base !== grant.base) return null;
  if (branchProblem(p, b.branch, b.base)) return null;
  return { branch: b.branch, remote: b.remote, url: typeof b.url === "string" ? b.url : null, base: b.base };
}

const plannedTaskCount = (change: Change): number => {
  try {
    return parseTasks(approvedText(change, join(change.dir, "tasks.yaml")) ?? "").tasks.filter((t) => !t.origin).length;
  } catch {
    return 0;
  }
};

/** One line per grant, for the gate Decision Page. */
export function grantLines(g: Grants, push: { binding: PushBinding | null; problem: string | null }, planned: { tasks: number; reviewLayers: number; runs: number }): string[] {
  const b = push.binding;
  return [
    g.push && b
      ? `**Push and pull request**: push \`${b.branch}\` to remote \`${b.remote}\`${b.url ? ` (${b.url})` : ""} and open one pull request (a draft when something is not built) against base \`${b.base}\`, without asking. No other branch or remote; Task Worktree branches are never pushed.`
      : g.push
        ? `**Push and pull request**: granted in quality.yaml but it cannot hold: ${push.problem ?? "no Change Branch"}; the push and the pull request will ask.`
        : "**Push and pull request**: not granted; the push and the pull request ask at the end of the run.",
    g.envelope
      ? `**Permission envelope**: ${ENVELOPE.join("; ")}. Work outside it is marked not built.`
      : "**Permission envelope**: not granted; only the tier 2 resources listed under Permissions.",
    `**Cap**: ${agentRunCap(g, planned.runs)} Agent runs${g.agentRuns === null ? ` (default: ${AGENT_RUNS_FACTOR} × ${planned.runs} planned = ${planned.tasks} tasks × 2 + ${planned.reviewLayers} review layers)` : ""}; at the cap no new task starts, running work finishes and the run ends cleanly in a pull request.`,
    `**Never automatic**, whatever is granted: ${NEVER_AUTOMATIC.join(", ")}.`,
  ];
}

/** The Grants section the CLI adds to a gate Decision Page; null without a quality.yaml. */
export function grantsSection(p: Paths, change: Change): { id: string; title: string; body: string; points: string[]; html: string } | null {
  try {
    readFileSync(join(change.dir, "quality.yaml"));
  } catch {
    return null;
  }
  const bound = boundPush(p, change);
  return {
    id: "grants",
    title: "Grants for this Change",
    body: "Recorded in quality.yaml `grants` and approved with the package; the branch and the remote's URL are fixed when you approve. Mark it for a change to grant or withdraw any of them.",
    points: grantLines(readGrants(change), bound ? { binding: bound, problem: null } : bindPush(p, change), plannedAgentRuns(change)),
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
  // the shell splits only on space and tab: other whitespace (NBSP, \v, U+3000) and control or format characters,
  // which JS `\s` would split on or the eye misses, are refused rather than split on
  if (/[\n\r`$\\]/.test(cmd) || ODD_CHARACTER.test(cmd)) return null;
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
    } else if (c === " " || c === "\t") {
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

type Request =
  | { kind: "push"; remote: string; ref: string }
  | { kind: "pr"; base: string; head: string; repo: string | null; bodyFile: string | null }
  | { kind: "aidw-pr"; id: string; base: string | null };

/** The aidw CLI the gate trusts with a grant: bare `aidw` on PATH, or the plugin's own bin/aidw. */
export function aidwBinPaths(env: NodeJS.ProcessEnv): string[] {
  return ["aidw", join(bundledRoot() ?? pluginRoot(env), "bin", "aidw"), ...(env.CLAUDE_PLUGIN_ROOT ? [join(env.CLAUDE_PLUGIN_ROOT, "bin", "aidw")] : [])];
}

/** The push or pull request a command asks for, in the only forms the grant covers; null for anything else. */
function requestOf(cmd: string, env: NodeJS.ProcessEnv): Request | null {
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
      { "--base": "base", "-B": "base", "--head": "head", "-H": "head", "--title": "title", "-t": "title", "--body": "body", "-b": "body", "--body-file": "bodyFile", "-F": "bodyFile", "--repo": "repo", "-R": "repo" },
      { "--draft": "draft", "-d": "draft", "--fill": "fill", "-f": "fill" },
    );
    if (!o || o.args.length || typeof o.flags.base !== "string" || typeof o.flags.head !== "string") return null;
    const str = (v: string | true | undefined) => (typeof v === "string" ? v : null);
    return { kind: "pr", base: o.flags.base, head: o.flags.head, repo: str(o.flags.repo), bodyFile: str(o.flags.bodyFile) };
  }
  if (w[0] && aidwBinPaths(env).includes(w[0]) && w[1] === "pr") {
    const o = splitFlags(w.slice(2), { "--change": "change", "--base": "base" }, { "--create": "create", "--draft": "draft", "--json": "json" });
    if (!o || o.flags.create !== true || o.args.length > 1) return null;
    const id = typeof o.flags.change === "string" ? o.flags.change : o.args[0];
    if (!id || (o.args.length && typeof o.flags.change === "string")) return null;
    return { kind: "aidw-pr", id, base: typeof o.flags.base === "string" ? o.flags.base : null };
  }
  return null;
}

/** `git push <remote> <ref>` names exactly the branch: `b`, `b:b`, with `refs/heads/b` allowed on either side. HEAD is not: it may be a Task Worktree's. */
function refIsBranch(ref: string, branch: string): boolean {
  const is = (x: string) => x === branch || x === `refs/heads/${branch}`;
  const i = ref.indexOf(":");
  return i < 0 ? is(ref) : is(ref.slice(0, i)) && is(ref.slice(i + 1));
}

const TASK_BRANCH_REF = /(?:^|[\s:+'"=])(?:refs\/heads\/)?aidw\/[\w.-]+\.T\d+(?=$|[\s:'";&|])/;

/** A push or pull request of a Task Worktree branch: denied for everyone, granted or not (ADR-0012). */
export function taskBranchPush(cmd: string): string | null {
  if (!/\bgit\b[^;&|]*\spush\b|\bgh\s+pr\s+create\b/.test(cmd) || !TASK_BRANCH_REF.test(cmd)) return null;
  return "a Task Worktree branch is merged into the Change Branch and never pushed (ADR-0012)";
}

const real = (f: string): string | null => {
  try {
    return realpathSync(f);
  } catch {
    return null;
  }
};

const insideDir = (parent: string, child: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

/**
 * The command runs in the project's own repository and not in a Task Worktree: the cwd is inside the project (the
 * hook finds the project from CLAUDE_PROJECT_DIR whatever the cwd), and git resolves it to the project's toplevel,
 * not another or a nested repository. Every git question the grant asks is then about the project.
 */
function runsInProject(p: Paths, cwd: string): boolean {
  const project = real(p.project);
  const here = real(resolve(cwd));
  if (!project || !here || !insideDir(project, here)) return false;
  const run = real(join(p.run, "worktrees"));
  if (run && insideDir(run, here)) return false;
  const top = (dir: string) => {
    const r = git(dir, ["rev-parse", "--show-toplevel"]);
    return r.ok && r.out ? real(r.out) : null;
  };
  return top(here) === top(project);
}

/** `aidw pr`'s own body file: a regular file (not a symlink) whose real path is `.aidw/run/pr-<id>.md`. */
function isPrBodyFile(p: Paths, id: string, file: string): boolean {
  const want = join(p.run, `pr-${id}.md`);
  try {
    if (!lstatSync(file).isFile() || !lstatSync(want).isFile()) return false;
  } catch {
    return false;
  }
  return real(file) !== null && real(file) === real(want);
}

/**
 * The reason a push or pull-request command passes without asking, or null. It passes only when a Change with a
 * valid approval, in one of `states`, grants push and its approval fixed the branch, remote (with its URL) and base,
 * and the command names exactly those, from outside any Task Worktree. Callers check tier x before and run this
 * only for the Orchestrator (no agent_type).
 */
export function pushGrantReason(p: Paths, cmd: string, states: ReadonlySet<string>, cwd: string, env: NodeJS.ProcessEnv): string | null {
  const req = requestOf(cmd, env);
  if (!req || !runsInProject(p, cwd)) return null;
  for (const id of listChangeIds(p)) {
    try {
      const c = loadChange(p, id);
      const state = stateOf(c);
      if (!state || !states.has(state) || approvalStatus(p, c).status !== "valid") continue;
      const b = boundPush(p, c);
      if (!b || remoteUrl(p, b.remote) !== b.url || pushConfigProblem(p, b.remote)) continue;
      const by = `granted at the Approval Gate of ${id}`;
      if (req.kind === "push" && req.remote === b.remote && refIsBranch(req.ref, b.branch)) return `push of the Change Branch ${b.branch} to ${b.remote} was ${by}`;
      if (
        req.kind === "pr" &&
        req.head === b.branch &&
        req.base === b.base &&
        (req.repo === null || req.repo === githubSlug(b.url)) &&
        (req.bodyFile === null || isPrBodyFile(p, id, resolve(cwd, req.bodyFile)))
      ) {
        return `the pull request of ${b.branch} against ${b.base} was ${by}`;
      }
      // `aidw pr` pushes what planPr names: the binding, and only while change.yaml still says the same branch
      const recorded = (c.data.run as { branch?: unknown } | undefined)?.branch;
      if (req.kind === "aidw-pr" && req.id === id && (req.base ?? b.base) === b.base && (recorded === undefined || recorded === null || recorded === b.branch)) return `pushing ${b.branch} to ${b.remote} and its pull request against ${b.base} were ${by}`;
    } catch {
      // an unreadable change grants nothing
    }
  }
  return null;
}
