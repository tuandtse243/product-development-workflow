/**
 * Per-Role statistics from real Changes (plan T19, criterion C5): how often a Role's task ends done on its first
 * implementer run, which rules its fix reviews cite, and why its tasks were triaged. Read-only: it reads every Change
 * of the project, active (`.aidw/changes/`) and archived (`.aidw/archive/`), and writes nothing.
 *
 * Sources, per task: tasks.yaml (`role`, `status`, `runs`, `origin`, and for records before T19 `triage`, `upstream`,
 * `not_built`) and `evidence/<task>.json` (checkpoints, reviews and, since T19, an append-only `triage` list and the
 * run number and Agent on each checkpoint and review).
 *
 * First attempt (decision A, 2026-11-28): the task ended done after one implementer run; that run's checkpoint passed
 * and its review passed; no Triage and no upstream round. A checkpoint the machine refused is not a run. Tasks the
 * workflow adds itself (converge, quality, integration) are left out of the first-attempt figures, and their
 * auto-passed reviews are never counted.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { isDir, readText, type Paths } from "./project.js";
import { defaultTaskRole, implementerOf, loadRole, loadRuleTable } from "./roles.js";
import { ENVIRONMENT_FAILURE, type CheckpointRecord, type Evidence, type ReviewRecord, type TriageRecord } from "./run.js";
import { ADDED_ORIGINS, parseTasks, type Task } from "./tasks.js";

/** A rate is shown only from this many ended tasks of a Role up (decision A: always counts, a rate from 5). */
export const MIN_TASKS_FOR_RATE = 5;

export const STATS_TRIAGE_CAUSES = ["implementation", "environment", "plan", "spec", "architecture", "unclear"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const RULE_TOKEN = /\b[A-Z]+[1-9][0-9]*\b/g;

// ---------------------------------------------------------------- rule ids

/**
 * The rule tables that bind a task of `role`: those of the Role itself, of the Role whose Agent builds it, and of the
 * Roles either follows (`follows_rules`). Maps each rule id to the Role that owns the table.
 */
export function boundRules(pluginHome: string, role: string | undefined): Map<string, string> {
  const ids = new Map<string, string>();
  let builder: string;
  try {
    builder = implementerOf(pluginHome, role) ?? defaultTaskRole();
  } catch {
    builder = role ?? "";
  }
  const seen = new Set<string>();
  const add = (r: string | undefined) => {
    if (!r || seen.has(r)) return;
    seen.add(r);
    for (const rule of safe(() => loadRuleTable(pluginHome, r)) ?? []) if (!ids.has(rule.id)) ids.set(rule.id, r);
  };
  for (const r of [role, builder]) {
    if (!r) continue;
    add(r);
    for (const f of safe(() => loadRole(pluginHome, r))?.follows_rules ?? []) add(f);
  }
  return ids;
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/**
 * The blocking part of a review: everything before its `Non-blocking:` heading (code-reviewer's format), written as
 * `Non-blocking:`, `**Non-blocking:**` or a Markdown heading. A line that only starts with the word ("Non-blocking I/O
 * in the handler…") is part of a finding, not the heading.
 */
export function blockingPart(notes: string): string {
  const m = /^(?:[ \t>*_-]*Non-blocking[*_]*[ \t]*:|[ \t]*#{1,6}[ \t]*Non-blocking\b)/im.exec(notes);
  return m ? notes.slice(0, m.index) : notes;
}

/**
 * The known rule ids the blocking part of a review cites, each once, with the Role that owns it; ids not in a bound
 * table, and ids named only under `Non-blocking:`, are ignored.
 */
export function citedRules(notes: string, rules: Map<string, string>): { id: string; owner: string }[] {
  const out: { id: string; owner: string }[] = [];
  for (const m of blockingPart(notes).matchAll(RULE_TOKEN)) {
    const owner = rules.get(m[0]);
    if (owner && !out.some((x) => x.id === m[0])) out.push({ id: m[0], owner });
  }
  return out;
}

/**
 * `aidw verdict`: a fix review whose blocking part cites no known rule id, for a task whose Role, or the Role that
 * builds it, owns a rule table itself. A table followed through `follows_rules` does not count (a fullstack review
 * about UI owes no backend id), nor does a task with no Role or an unknown one. Null when there is nothing to warn
 * about. Never throws.
 */
export function ruleIdWarning(pluginHome: string, role: string | undefined, notes: string): string | null {
  if (!role) return null;
  const builder = safe(() => implementerOf(pluginHome, role));
  if (!builder) return null;
  const rules = new Map<string, string>();
  for (const r of new Set([role, builder])) for (const rule of safe(() => loadRuleTable(pluginHome, r)) ?? []) if (!rules.has(rule.id)) rules.set(rule.id, r);
  if (rules.size === 0) return null;
  const bound = safe(() => boundRules(pluginHome, role)) ?? rules;
  if (citedRules(notes, bound).length) return null;
  const owners = [...new Set(bound.values())];
  const example = owners.length > 1 ? [...bound].find(([, o]) => o === owners[1])![0] : [...bound.keys()][0];
  return `the fix review cites no rule id of ${owners.join(", ")} (for example \`1. ${example}: <file>: <problem>\`); \`aidw stats\` counts broken rules from these ids`;
}

// ---------------------------------------------------------------- reading Changes

export interface ChangeRef {
  id: string;
  dir: string;
  archived: boolean;
  /** no checkpoint of this Change carries a run number: its records predate T19 */
  predates: boolean;
}

interface TaskData {
  change: ChangeRef;
  task: Task;
  ev: Evidence | null;
}

function readEvidenceFile(dir: string, taskId: string): Evidence | null {
  const file = join(dir, "evidence", `${taskId}.json`);
  if (!existsSync(file)) return null;
  try {
    const ev = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!isRecord(ev)) return null;
    // entries that are not records (a hand edit, a damaged file) are dropped, never read
    const records = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(isRecord) as T[]) : []);
    return {
      ...(ev as unknown as Evidence),
      checkpoints: records<CheckpointRecord>(ev.checkpoints).map((c) => ({ ...c, verify: records(c.verify) })),
      reviews: records<ReviewRecord>(ev.reviews),
      ...(Array.isArray(ev.triage) ? { triage: records<TriageRecord>(ev.triage) } : {}),
    };
  } catch {
    return null;
  }
}

function changeIdOf(dir: string, fallback: string): string {
  const text = readText(join(dir, "change.yaml"));
  if (text === null) return fallback;
  try {
    const data = YAML.parse(text) as unknown;
    return isRecord(data) && typeof data.id === "string" && data.id ? data.id : fallback;
  } catch {
    return fallback;
  }
}

/** Every Change of the project with a tasks.yaml, active and archived, and its tasks with their evidence. */
export function readChanges(p: Paths): { changes: ChangeRef[]; tasks: TaskData[] } {
  const changes: ChangeRef[] = [];
  const tasks: TaskData[] = [];
  for (const [base, archived] of [[p.changes, false], [p.archive, true]] as const) {
    if (!isDir(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const dir = join(base, name);
      if (name.startsWith(".") || !isDir(dir)) continue;
      const text = readText(join(dir, "tasks.yaml"));
      if (text === null) continue;
      const list = parseTasks(text).tasks.filter((t) => isRecord(t) && typeof t.id === "string");
      const change: ChangeRef = { id: changeIdOf(dir, name), dir, archived, predates: false };
      const mine = list.map((task) => ({ change, task, ev: readEvidenceFile(dir, task.id) }));
      const cps = mine.flatMap((x) => x.ev?.checkpoints ?? []);
      change.predates = cps.length > 0 && !cps.some((c) => Number.isInteger(c.run));
      changes.push(change);
      tasks.push(...mine);
    }
  }
  return { changes, tasks };
}

// ---------------------------------------------------------------- one task

/** A checkpoint the machine refused: recorded, but no attempt was used and it is not a run. */
export function isBlocked(c: CheckpointRecord): boolean {
  if (c.blocked === true) return true;
  if (c.ok) return false;
  const failed = Array.isArray(c.verify) ? c.verify.find((v) => isRecord(v) && v.exit !== 0) : undefined;
  return !!failed && !failed.timedOut && ENVIRONMENT_FAILURE.test(String(failed.tail ?? ""));
}

const isAutoReview = (r: ReviewRecord): boolean => r.auto === true || /^auto-reviewed:/.test(String(r.notes ?? "").trim());

export interface UpstreamRound {
  round: number;
  cause: string;
  /** the author Role the round went to */
  role: string;
  /** fixed: the author changed its Artifact and the task ran again; cannot: it found no fix; open: still running */
  outcome: "fixed" | "cannot" | "open";
}

export interface TaskStats {
  change: string;
  task: string;
  title: string;
  role: string;
  status: string;
  origin?: string;
  /** it ran at least once (a task not built only because of a dependency may never have) */
  ran: boolean;
  /**
   * effective implementer runs: tasks.yaml `runs` counted from the first checkpoint that was not refused (so runs lost
   * to a machine outage before it do not count), or the checkpoints that were not refused for records before T19
   */
  runs: number;
  /** true/false for a planned task that ended; null when it has not ended, was added by the workflow or is `excluded` */
  first_attempt: boolean | null;
  /** an ended task left out of the first-attempt base: the machine refused every check, or its evidence is missing or unreadable */
  excluded?: "refused" | "no evidence";
  /** rule ids cited by its fix reviews, with the Role that owns each */
  rules: { id: string; owner: string }[];
  triage: string[];
  upstream: UpstreamRound[];
  not_built?: { cause: string; reason: string };
  /** its Triage figures come from tasks.yaml, not from the T19 evidence list */
  fallback: boolean;
  /** the implementer Agents that ran it, when recorded (another Role's Agent when the task's Role is carried) */
  agents: string[];
  started?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function ran(t: Task, ev: Evidence | null): boolean {
  return Boolean(t.started_at) || Number(t.runs) > 0 || Number(t.attempts) > 0 || (ev?.checkpoints.length ?? 0) > 0 || t.status === "done";
}

function startedOf(t: Task, ev: Evidence | null): string | undefined {
  const dates = [str(t.started_at), ...(ev?.checkpoints ?? []).map((c) => str(c.at)), ...(ev?.reviews ?? []).map((r) => str(r.at))].filter(Boolean).sort();
  return dates[0];
}

export function taskStats(d: TaskData, pluginHome: string, rulesOf: (role: string | undefined) => Map<string, string> = (r) => safe(() => boundRules(pluginHome, r)) ?? new Map()): TaskStats | null {
  const { task: t, ev } = d;
  const role = str(t.role) || "(none)";
  const status = str(t.status) || "pending";
  const nb = isRecord(t.not_built) ? { cause: str(t.not_built.cause), reason: str(t.not_built.reason) } : undefined;
  const didRun = ran(t, ev);
  if (!didRun && !nb) return null;
  const checkpoints = (ev?.checkpoints ?? []).filter((c) => !isBlocked(c));
  const reviews = (ev?.reviews ?? []).filter((r) => !isAutoReview(r));
  // A task revived after the machine refused its checks keeps its first-attempt chance: runs count from the first
  // checkpoint that was not refused.
  const firstRun = Number.isInteger(checkpoints[0]?.run) ? Number(checkpoints[0]?.run) : 1;
  const runs = Number.isInteger(t.runs) ? Math.max(0, Number(t.runs) - firstRun + 1) : checkpoints.length;
  const added = ADDED_ORIGINS.includes(str(t.origin));

  // Triage: the T19 list; for records before it, what tasks.yaml still holds
  const entries: TriageRecord[] = Array.isArray(ev?.triage) ? (ev?.triage as TriageRecord[]) : [];
  const triage = entries.map((e) => String(e.cause));
  const upstream: Omit<UpstreamRound, "outcome">[] = entries.filter((e) => e.outcome === "upstream").map((e) => ({ round: Number(e.round ?? 0), cause: String(e.cause), role: str(e.role) }));
  let fallback = false;
  if (!entries.length) {
    if (isRecord(t.triage) && str(t.triage.cause)) triage.push(str(t.triage.cause));
    if (isRecord(t.upstream)) {
      const u = t.upstream;
      upstream.push({ round: Number(u.round ?? 1), cause: str(u.cause), role: str(u.role) });
      // recordUpstream clears `triage`: the round still says which cause sent it upstream
      if (!triage.includes(str(u.cause)) && str(u.cause)) triage.push(str(u.cause));
    }
    if (nb && /^triage: environment/.test(nb.reason) && !triage.includes("environment")) triage.push("environment");
    fallback = triage.length > 0 || upstream.length > 0;
  } else if (isRecord(t.upstream) && !upstream.length) {
    upstream.push({ round: Number(t.upstream.round ?? 1), cause: str(t.upstream.cause), role: str(t.upstream.role) });
  }

  const rules = rulesOf(str(t.role) || undefined);
  const cited: { id: string; owner: string }[] = [];
  // a merge review judges the integration Role's merge, not the task's rules
  for (const r of reviews) if (r.verdict === "fix" && r.merge !== true) cited.push(...citedRules(String(r.notes ?? ""), rules));

  let first: boolean | null = null;
  let excluded: TaskStats["excluded"];
  const ended = !added && didRun && (status === "done" || status === "not_built");
  const refusedOnly = checkpoints.length === 0 && ((ev?.checkpoints.length ?? 0) > 0 || (status === "not_built" && nb?.cause === "environment"));
  if (ended && refusedOnly) excluded = "refused";
  else if (ended && ev === null) excluded = "no evidence";
  else if (ended) {
    const oneRun = Number.isInteger(t.runs) ? runs === 1 : checkpoints.length === 1;
    const thisRun = (x: { run?: number }) => !Number.isInteger(x.run) || x.run === firstRun;
    const own = reviews.filter((r) => r.merge !== true && thisRun(r));
    first =
      status === "done" &&
      oneRun &&
      checkpoints.length > 0 &&
      checkpoints.filter(thisRun).every((c) => c.ok) &&
      checkpoints.some((c) => c.ok && thisRun(c)) &&
      own.length > 0 &&
      own.every((r) => r.verdict === "pass") &&
      triage.length === 0 &&
      upstream.length === 0 &&
      !isRecord(t.triage) &&
      !isRecord(t.upstream);
  }
  const last = Math.max(0, ...upstream.map((u) => u.round));
  const phase = isRecord(t.upstream) ? str(t.upstream.phase) : "";
  const rounds: UpstreamRound[] = upstream.map((u) => ({
    ...u,
    outcome: u.round < last || phase === "fixed" ? "fixed" : nb && /could not fix/.test(nb.reason) ? "cannot" : status === "done" ? "fixed" : "open",
  }));
  const agents = [...new Set((ev?.checkpoints ?? []).map((c) => str(c.agent)).filter(Boolean))];
  const started = startedOf(t, ev);
  return {
    change: d.change.id,
    task: t.id,
    title: str(t.title),
    role,
    status,
    ...(t.origin ? { origin: str(t.origin) } : {}),
    ran: didRun,
    runs,
    first_attempt: first,
    ...(excluded ? { excluded } : {}),
    rules: cited,
    triage,
    upstream: rounds,
    ...(nb ? { not_built: nb } : {}),
    fallback,
    agents,
    ...(started ? { started } : {}),
  };
}

// ---------------------------------------------------------------- per Role

export interface RoleStats {
  role: string;
  /** tasks of this Role that ran */
  tasks: number;
  /** planned tasks that ended (done or not built): the base of the first-attempt figure */
  ended: number;
  first_attempt: number;
  /** first_attempt / ended, only from MIN_TASKS_FOR_RATE ended tasks up; null below that */
  rate: number | null;
  /** tasks the workflow added (converge, quality, integration): counted, but not in the first-attempt figure */
  added: number;
  /** rule ids of this Role's tables cited by fix reviews (of any task bound by them), most cited first */
  rule_ids: { id: string; count: number }[];
  /** Triage causes of this Role's tasks */
  triage: Record<string, number>;
  upstream_rounds: number;
  not_built: Record<string, number>;
  /** ended tasks left out of the first-attempt base because their evidence is missing or unreadable */
  no_evidence: number;
  /** ended tasks left out of the first-attempt base because the machine refused every check */
  refused: number;
}

export interface StatsOptions {
  role?: string;
  change?: string;
  /** YYYY-MM-DD (UTC): only tasks that started on or after that day */
  since?: string;
}

export interface StatsReport {
  changes: { id: string; archived: boolean; predates: boolean }[];
  /** some counted Change predates T19: its Triage figures come from tasks.yaml */
  partial: boolean;
  roles: RoleStats[];
  /** --role: the tasks of that Role */
  tasks?: TaskStats[];
}

const SINCE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar day as YYYY-MM-DD (2026-02-30 is not one). */
export function validSince(s: string): boolean {
  const m = SINCE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

export function computeStats(p: Paths, pluginHome: string, opts: StatsOptions = {}): StatsReport {
  const { changes, tasks } = readChanges(p);
  // the rule tables of a Role are read once per run, not once per task
  const cache = new Map<string, Map<string, string>>();
  const rulesOf = (role: string | undefined): Map<string, string> => {
    const key = role ?? "";
    let m = cache.get(key);
    if (!m) {
      m = safe(() => boundRules(pluginHome, role)) ?? new Map<string, string>();
      cache.set(key, m);
    }
    return m;
  };
  const inChange = (c: ChangeRef) => !opts.change || c.id === opts.change || c.dir.endsWith(`/${opts.change}`) || c.dir.endsWith(`\\${opts.change}`);
  const all = tasks
    .filter((d) => inChange(d.change))
    .map((d) => taskStats(d, pluginHome, rulesOf))
    .filter((x): x is TaskStats => x !== null)
    .filter((x) => !opts.since || (x.started !== undefined && x.started.slice(0, 10) >= (opts.since as string)));
  const counted = changes.filter(inChange).filter((c) => all.some((x) => x.change === c.id));

  const roles = new Map<string, RoleStats>();
  const row = (role: string): RoleStats => {
    let r = roles.get(role);
    if (!r) {
      r = { role, tasks: 0, ended: 0, first_attempt: 0, rate: null, added: 0, rule_ids: [], triage: {}, upstream_rounds: 0, not_built: {}, no_evidence: 0, refused: 0 };
      roles.set(role, r);
    }
    return r;
  };
  const ruleCounts = new Map<string, Map<string, number>>();
  for (const x of all) {
    const r = row(x.role);
    if (x.ran) r.tasks++;
    if (x.origin && ADDED_ORIGINS.includes(x.origin)) r.added++;
    if (x.excluded === "no evidence") r.no_evidence++;
    if (x.excluded === "refused") r.refused++;
    if (x.first_attempt !== null) {
      r.ended++;
      if (x.first_attempt) r.first_attempt++;
    }
    for (const c of x.triage) r.triage[c] = (r.triage[c] ?? 0) + 1;
    r.upstream_rounds += x.upstream.length;
    if (x.not_built) r.not_built[x.not_built.cause || "unknown"] = (r.not_built[x.not_built.cause || "unknown"] ?? 0) + 1;
    for (const c of x.rules) {
      const m = ruleCounts.get(c.owner) ?? new Map<string, number>();
      m.set(c.id, (m.get(c.id) ?? 0) + 1);
      ruleCounts.set(c.owner, m);
    }
  }
  for (const [owner, m] of ruleCounts) {
    row(owner).rule_ids = [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || ruleOrder(a.id, b.id));
  }
  for (const r of roles.values()) r.rate = r.ended >= MIN_TASKS_FOR_RATE ? r.first_attempt / r.ended : null;
  let list = [...roles.values()].sort((a, b) => b.tasks - a.tasks || a.role.localeCompare(b.role));
  if (opts.role) list = list.filter((r) => r.role === opts.role);
  const partial = counted.some((c) => c.predates) || all.some((x) => x.fallback);
  return {
    changes: counted.map((c) => ({ id: c.id, archived: c.archived, predates: c.predates })),
    partial,
    roles: list,
    ...(opts.role ? { tasks: all.filter((x) => x.role === opts.role) } : {}),
  };
}

/** B2 before B10: letters, then the number. */
function ruleOrder(a: string, b: string): number {
  const [, la = "", na = "0"] = /^([A-Z]+)(\d+)$/.exec(a) ?? [];
  const [, lb = "", nb = "0"] = /^([A-Z]+)(\d+)$/.exec(b) ?? [];
  return la.localeCompare(lb) || Number(na) - Number(nb);
}

// ---------------------------------------------------------------- text

const firstAttemptText = (r: { first_attempt: number; ended: number; rate: number | null }): string =>
  r.ended === 0 ? "-" : `${r.first_attempt} of ${r.ended}${r.rate === null ? "" : ` (${Math.round(r.rate * 100)}%)`}`;

const countsText = (m: Record<string, number>): string =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ${n}`)
    .join(", ") || "-";

const TOP_RULES = 5;

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i] as number))).join("  ").trimEnd()).join("\n");
}

/** The footer names the Changes only up to this many, unless --change or --role narrowed the report. */
export const MAX_LISTED_CHANGES = 10;

function footer(s: StatsReport, names: boolean): string[] {
  const active = s.changes.filter((c) => !c.archived).length;
  const lines = [
    s.changes.length
      ? `Changes counted: ${s.changes.length} (${active} active, ${s.changes.length - active} archived)${names ? `: ${s.changes.map((c) => `${c.id}${c.archived ? " (archived)" : ""}`).join(", ")}` : ""}`
      : "Changes counted: none",
  ];
  const old = s.changes.filter((c) => c.predates).map((c) => c.id);
  if (s.partial) {
    lines.push(
      `Triage figures are partial: ${old.length ? `${old.length} Change(s) predate the T19 records${names ? ` (${old.join(", ")})` : ""}; ` : ""}for tasks without a Triage list in their evidence they come from tasks.yaml (the last Triage, the last upstream round and the not-built cause), which a retry or an upstream round clears.`,
    );
  }
  lines.push(`First attempt: done after one implementer run, its checkpoint and review passed, no Triage, no upstream round; a rate is shown from ${MIN_TASKS_FOR_RATE} ended tasks of a Role up. Tasks the workflow added, tasks whose every check the machine refused and tasks with no readable evidence are left out.`);
  const noEv = s.roles.reduce((n, r) => n + r.no_evidence, 0);
  const refused = s.roles.reduce((n, r) => n + r.refused, 0);
  if (noEv || refused) lines.push(`Left out: ${[noEv ? `${noEv} ended task(s) with no evidence (missing or unreadable)` : "", refused ? `${refused} whose every check the machine refused` : ""].filter(Boolean).join(", ")}.`);
  return lines;
}

/** `listChanges`: name each Change in the footer (--change or --role given); otherwise only up to MAX_LISTED_CHANGES. */
export function statsText(s: StatsReport, listChanges = false): string {
  const out: string[] = [];
  if (!s.roles.length) out.push("No tasks to count.");
  else {
    out.push(
      table([
        ["role", "tasks", "first attempt", "triage", "top rule ids (fix reviews)"],
        ...s.roles.map((r) => [
          r.role,
          String(r.tasks),
          firstAttemptText(r),
          countsText(r.triage),
          r.rule_ids.slice(0, TOP_RULES).map((x) => `${x.id} x${x.count}`).join(", ") || "-",
        ]),
      ]),
    );
  }
  if (s.tasks) {
    const r = s.roles[0];
    out.push("");
    if (r) {
      out.push(
        `${r.role}: ${r.tasks} task(s), first attempt ${firstAttemptText(r)}${r.added ? `, ${r.added} added by the workflow` : ""}; upstream rounds ${r.upstream_rounds}; not built: ${countsText(r.not_built)}`,
      );
      if (r.rule_ids.length) out.push(`  rule ids of ${r.role} cited: ${r.rule_ids.map((x) => `${x.id} x${x.count}`).join(", ")}`);
    }
    for (const t of s.tasks) {
      const fa =
        t.first_attempt === null
          ? t.origin && ADDED_ORIGINS.includes(t.origin)
            ? `added (${t.origin})`
            : t.excluded === "no evidence"
              ? "left out: no evidence"
              : t.excluded === "refused"
                ? "left out: the machine refused every check"
                : "not ended"
          : t.first_attempt
            ? "first attempt"
            : "not first attempt";
      out.push(`  ${t.change}/${t.task}  ${t.status}  runs ${t.runs}  ${fa}`);
      if (t.agents.length && t.agents.some((a) => a !== `aidw:${t.role}`)) out.push(`    built by: ${t.agents.join(", ")}`);
      if (t.rules.length) out.push(`    rules: ${t.rules.map((x) => (x.owner === t.role ? x.id : `${x.id} (${x.owner})`)).join(", ")}`);
      if (t.triage.length) out.push(`    triage: ${t.triage.join(", ")}${t.fallback ? " (from tasks.yaml)" : ""}`);
      for (const u of t.upstream) {
        const what = u.outcome === "fixed" ? "fixed" : u.outcome === "cannot" ? "could not fix" : "is fixing";
        out.push(`    upstream round ${u.round}: the ${u.role || "?"} ${what} the ${u.cause || "?"}`);
      }
      if (t.not_built) out.push(`    not built (${t.not_built.cause}): ${t.not_built.reason.split("\n")[0]?.slice(0, 200) ?? ""}`);
    }
  }
  out.push("", ...footer(s, listChanges || s.changes.length <= MAX_LISTED_CHANGES));
  return `${out.join("\n")}\n`;
}
