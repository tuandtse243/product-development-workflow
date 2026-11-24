/**
 * What the pull request of a Change says before anything else, and whether it is ready or a draft (D12, ADR-0014).
 *
 * After the Approval Gate the run never asks the user; the pull request is where they see what the run decided alone.
 * Its body opens with three fixed sections, in this order, each "Nothing." when empty:
 *   1. Differs from the approved package: every closed Deviation (deviations.yaml): reason, author Roles, summary,
 *      scenarios and requirements removed, added or changed, contract classes, tasks added, removed and run again.
 *   2. Not built and why: tasks (cause, reason, the dependants not built with them, where their discarded work is),
 *      quality layers, converge scenarios, and the Agent-run cap when it was reached.
 *   3. Needed from the user to finish: concrete actions derived from the causes (what to provide, what to do by hand,
 *      raising the cap, the failed deploy), plus the review findings and questions carried from the gate.
 * The pull request is ready when every layer of the approved quality profile passed, converge passed with nothing
 * left out, the deploy succeeded and every task is done; a draft otherwise.
 *
 * Discarded work: a task not built on the main checkout had its uncommitted work saved under `.aidw/run/evidence/`
 * (src/run.ts), which is machine-local and never committed. The pull request is read on another machine, usually by
 * someone else, so the saved files are copied into the Change folder (`delivery/not-built/`) and committed with the
 * delivery package; they then travel with the branch and survive the archive. They hold only files git would commit
 * anyway (ignored files, `.env` among them, are never saved).
 *
 * `/aidw:resume` finishes a draft: `aidw transition <id> executing` from `delivered` reopens it (reopenDraft).
 */
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { agentRunStatus, capReason } from "./agentruns.js";
import type { Change } from "./change.js";
import { loadConsultations, parseRequest } from "./consult.js";
import { lastConverge } from "./converge.js";
import { loadDeviations } from "./deviationrecord.js";
import { carriedFindings, readRecord } from "./planreview.js";
import { readText, rel, type Paths } from "./project.js";
import { forgetLayers, lastDeploy, notBuiltLayers, parseQuality, qualityFile, readSummary } from "./quality.js";
import { loadTasks, reviveNotBuilt } from "./run.js";
import type { Task } from "./tasks.js";

export const PR_SECTIONS = ["Differs from the approved package", "Not built and why", "Needed from the user to finish"] as const;

const NOTHING = "Nothing.";
const statusOf = (t: Task) => String(t.status ?? "pending");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const code = (s: string) => `\`${s}\``;
const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

export interface NotBuilt {
  cause: string;
  reason: string;
  discarded?: string[];
  saved?: string[];
}

export const notBuiltOf = (t: Task): NotBuilt | null => {
  const n = t.not_built as Partial<NotBuilt> | null | undefined;
  return statusOf(t) === "not_built" ? { cause: String(n?.cause ?? "unknown"), reason: oneLine(n?.reason), discarded: list(n?.discarded), saved: list(n?.saved) } : null;
};

export interface Readiness {
  ready: boolean;
  /** why it is a draft (empty when ready) */
  why: string[];
}

/** Ready when everything passed and nothing is not built; otherwise a draft, with the reasons. */
export function prReadiness(p: Paths, change: Change, tasks: Task[]): Readiness {
  const why: string[] = [];
  const nb = tasks.filter((t) => statusOf(t) === "not_built");
  if (nb.length) why.push(`not built: ${nb.map((t) => t.id).join(", ")}`);
  const open = tasks.filter((t) => !["done", "not_built"].includes(statusOf(t)));
  if (open.length) why.push(`not finished: ${open.map((t) => `${t.id} (${statusOf(t)})`).join(", ")}`);
  const text = readText(qualityFile(change));
  const layers = text === null ? [] : (parseQuality(text, "quality.yaml").config?.layers ?? []).map((l) => l.name);
  const summary = readSummary(change).layers;
  const notPassed = layers.filter((n) => summary[n]?.status !== "pass");
  if (notPassed.length) why.push(`quality layers not passing: ${notPassed.map((n) => `${n} (${summary[n]?.status ?? "not run"})`).join(", ")}`);
  const conv = lastConverge(change);
  if (!conv) why.push("converge did not run");
  else if (!conv.ok) why.push("converge found gaps");
  else if (conv.not_built?.length) why.push(`scenarios not built: ${conv.not_built.length}`);
  const d = lastDeploy(change);
  if (!d) why.push("the deploy did not run");
  else if (!d.ok) why.push("the deploy failed");
  return { ready: why.length === 0, why };
}

/** Where the discarded work of not-built tasks is kept in the Change (committed with the delivery package). */
export const notBuiltDir = (change: Change) => join(change.dir, "delivery", "not-built");

/**
 * Copies the work saved from not-built tasks (`.aidw/run/evidence/notbuilt-<T>.patch` and `notbuilt-<T>/`) into
 * `delivery/not-built/` (`<T>.patch`, `<T>/`). Returns the project-relative paths written.
 */
export function keepDiscardedWork(p: Paths, change: Change, tasks: Task[]): string[] {
  const out: string[] = [];
  for (const t of tasks) {
    for (const s of notBuiltOf(t)?.saved ?? []) {
      const from = join(p.project, s.replace(/\/$/, ""));
      if (!existsSync(from)) continue;
      const dir = statSync(from).isDirectory();
      const to = join(notBuiltDir(change), dir ? t.id : `${t.id}${basename(from).endsWith(".patch") ? ".patch" : `-${basename(from)}`}`);
      mkdirSync(notBuiltDir(change), { recursive: true });
      cpSync(from, to, { recursive: true });
      out.push(`${rel(p, to)}${dir ? "/" : ""}`);
    }
  }
  return out;
}

/** Where a not-built task's discarded work can be found: the copy in the Change, else the machine-local files. */
function savedWork(p: Paths, change: Change, t: Task, n: NotBuilt): string | null {
  if (!n.saved?.length) return null;
  const kept = [join(notBuiltDir(change), `${t.id}.patch`), join(notBuiltDir(change), t.id)].filter((f) => existsSync(f)).map((f) => code(rel(p, f) + (statSync(f).isDirectory() ? "/" : "")));
  if (kept.length) return `its discarded work is kept in ${kept.join(" and ")}`;
  return `its discarded work was saved on the machine that ran the build, in ${n.saved.map(code).join(" and ")} (not committed)`;
}

/** The not-built tasks that depend, directly or not, on `root` and were not built because of it. */
function dependantsOf(root: string, tasks: Task[]): string[] {
  const out: string[] = [];
  const queue = [root];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const t of tasks) {
      if (out.includes(t.id) || notBuiltOf(t)?.cause !== "dependency" || !list(t.depends_on).includes(id)) continue;
      out.push(t.id);
      queue.push(t.id);
    }
  }
  return out;
}

const withNothing = (lines: string[]) => (lines.length ? lines : [NOTHING]);

function differs(p: Paths, change: Change): string[] {
  const out: string[] = [];
  const closed = loadDeviations(change).filter((d) => d.status === "closed");
  for (const d of closed) {
    out.push(`- **${d.id}** (${(d.roles ?? []).join(", ") || "author Role unknown"}): ${oneLine(d.reason)}`);
    const sub = (label: string, items: string[]) => items.length && out.push(`  - ${label}: ${items.join(", ")}`);
    if (d.summary) out.push(`  - What changed: ${oneLine(d.summary)}`);
    sub("Scenarios removed", (d.scenarios?.removed ?? []).map((s) => `${code(s.scenario)} (reason: ${oneLine(s.reason)})`));
    sub("Scenarios added", (d.scenarios?.added ?? []).map(code));
    sub("Scenarios changed", (d.scenarios?.changed ?? []).map(code));
    sub("Requirements removed", (d.requirements?.removed ?? []).map(code));
    sub("Requirements added", (d.requirements?.added ?? []).map(code));
    sub("Requirements changed", (d.requirements?.changed ?? []).map(code));
    if (d.scope_reason) out.push(`  - Why a new requirement is not new scope: ${oneLine(d.scope_reason)}`);
    sub("Contracts", (d.contracts ?? []).filter((c) => c.class !== "none").map((c) => `${code(c.file)}: ${c.class}${c.changes?.length ? ` (${c.changes.slice(0, 5).join("; ")})` : ""}`));
    sub("Tasks added", d.tasks?.added ?? []);
    sub("Tasks removed", [...(d.tasks?.removed ?? []), ...(d.tasks?.removed_done ?? []).map((t) => `${t} (was done; its code stays)`)]);
    sub("Run again", d.rerun ?? []);
    if (!d.summary && !d.changed?.length) out.push(`  - Files: ${(d.files ?? []).map(code).join(", ")}`);
  }
  if (closed.length && readRecord(p, change).rounds?.length) {
    out.push("", "The independent review before the gate graded the package as it was approved, before these Deviations.");
  }
  return out;
}

function notBuilt(p: Paths, change: Change, tasks: Task[]): string[] {
  const out: string[] = [];
  const roots = tasks.filter((t) => notBuiltOf(t) && notBuiltOf(t)?.cause !== "dependency");
  const covered = new Set<string>();
  for (const t of roots) {
    const n = notBuiltOf(t) as NotBuilt;
    const deps = dependantsOf(t.id, tasks);
    deps.forEach((d) => covered.add(d));
    const saved = savedWork(p, change, t, n);
    out.push(
      `- **${t.id}** ${oneLine(t.title)}: cause ${n.cause}: ${n.reason}.${deps.length ? ` Not built with it (they depend on it): ${deps.join(", ")}.` : ""}${saved ? ` ${saved[0]?.toUpperCase()}${saved.slice(1)}.` : ""}`,
    );
  }
  for (const t of tasks.filter((x) => notBuiltOf(x)?.cause === "dependency" && !covered.has(x.id))) out.push(`- **${t.id}** ${oneLine(t.title)}: ${notBuiltOf(t)?.reason}.`);
  for (const l of notBuiltLayers(change)) out.push(`- Quality layer **${l.layer}**: ${oneLine(l.reason) || "not built"}.`);
  for (const s of lastConverge(change)?.not_built ?? []) out.push(`- Scenario ${code(s.scenario)}: ${oneLine(s.reason)}.`);
  const cap = agentRunStatus(p, change);
  if (cap.reached) out.push(`- Agent-run cap reached: ${cap.used} of ${cap.cap} runs used${cap.unreadable ? ` (${capReason(cap)})` : ""}; no new task started after it.`);
  return out;
}

function needed(p: Paths, change: Change, tasks: Task[]): string[] {
  const id = change.id;
  const resume = `\`/aidw:resume ${id}\``;
  const out: string[] = [];
  const byCause = (c: string) => tasks.filter((t) => notBuiltOf(t)?.cause === c);
  const again = (t: Task) => {
    const deps = dependantsOf(t.id, tasks);
    return `${t.id}${deps.length ? ` (and ${deps.join(", ")})` : ""}`;
  };
  for (const t of byCause("environment")) out.push(`- Provide what ${t.id} needs: ${notBuiltOf(t)?.reason}. Then ${resume} builds ${again(t)} again.`);
  for (const t of byCause("envelope")) {
    out.push(`- Do by hand, or grant in a new Change: ${t.id} needs work outside what was granted at the gate (never automatic: credentials outside \`.env\`, money, production deploys, deleting cloud data): ${notBuiltOf(t)?.reason}.`);
  }
  const capped = byCause("cap");
  const cap = agentRunStatus(p, change);
  if (capped.length || cap.reached) {
    out.push(`- Raise the cap on Agent runs (${cap.used} of ${cap.cap} used): run \`aidw cap ${id} --raise <runs>\` yourself, then ${resume}${capped.length ? ` builds ${capped.map(again).join(", ")}` : ""}.`);
  }
  for (const t of [...byCause("triage"), ...byCause("fix-rounds"), ...byCause("unknown")]) {
    out.push(`- Decide about ${t.id} (${notBuiltOf(t)?.cause}): ${notBuiltOf(t)?.reason}. Finish it by hand on this branch, or change what blocks it and run ${resume}, granting \`aidw task retry ${t.id}\` there.`);
  }
  for (const l of notBuiltLayers(change)) out.push(`- Quality layer ${l.layer}: ${oneLine(l.reason) || "not built"}. Provide what it needs (a service, a login), then ${resume} runs it again.`);
  const d = lastDeploy(change);
  if (!d) out.push(`- Deploy: it did not run. Run \`aidw deploy\` through ${resume}, or deploy by hand (a production deploy is always yours).`);
  else if (!d.ok) out.push(`- Deploy: ${oneLine(d.error) || "it failed"}. Fix that, then ${resume} deploys again; or deploy by hand (a production deploy is always yours).`);
  for (const f of carriedFindings(p, change)) out.push(`- Review finding carried from the gate (${f.target}): ${oneLine(f.text)}. Graded against the package as approved.`);
  for (const c of loadConsultations(change)) {
    const q = () => {
      try {
        return oneLine(parseRequest(readText(join(change.dir, c.request)) ?? "", c.request).question);
      } catch {
        return "(the request could not be read)";
      }
    };
    if (!c.after_gate && c.outcome === "cannot-answer") out.push(`- Question no Role could answer before the gate (${c.id}, ${c.from} asked ${c.to}): ${q()}`);
    if (c.route === "deviation" && c.deviation !== "recorded") out.push(`- Question left open after the gate (${c.id}, ${c.from} asked ${c.to}; no Deviation settled it): ${q()}`);
  }
  return out;
}

/** The three fixed sections that open the pull request body. */
export function prSections(p: Paths, change: Change, tasks: Task[]): string[] {
  return [
    `## ${PR_SECTIONS[0]}`,
    "",
    ...withNothing(differs(p, change)),
    "",
    `## ${PR_SECTIONS[1]}`,
    "",
    ...withNothing(notBuilt(p, change, tasks)),
    "",
    `## ${PR_SECTIONS[2]}`,
    "",
    ...withNothing(needed(p, change, tasks)),
    "",
  ];
}

/**
 * Why a delivered Change cannot be reopened by `/aidw:resume`, or null: nothing is left to finish, or what is left only
 * the user can do (work outside the grants, the cap still reached), so a run would verify and deliver for nothing.
 */
export function nothingToFinish(p: Paths, change: Change): string | null {
  const tasks = loadTasks(p, change.id).tasks;
  if (prReadiness(p, change, tasks).ready) return `change "${change.id}" has nothing to finish: everything passed and nothing is not built; archive it (\`aidw archive ${change.id}\`)`;
  const cap = agentRunStatus(p, change);
  const again = tasks.some((t) => {
    const c = notBuiltOf(t)?.cause;
    return c !== undefined && c !== "dependency" && c !== "envelope" && (c !== "cap" || !cap.reached);
  });
  const d = lastDeploy(change);
  const conv = lastConverge(change);
  if (again || notBuiltLayers(change).length || !d?.ok || !conv?.ok || conv.not_built?.length) return null;
  return `nothing in "${change.id}" can run again: what is left needs the user (its pull request lists it under "Needed from the user to finish": work outside what was granted${cap.reached ? `, or the cap: \`aidw cap ${change.id} --raise <runs>\`` : ""})`;
}

/**
 * `/aidw:resume` of a draft (delivered -> executing): the tasks not built for a cause the user can fix outside (the
 * environment, the cap once raised) run again with the tasks that depend on them, and the layers not built run again.
 * A task not built after Triage or its fix rounds, or outside the envelope, stays not built unless the user grants
 * `aidw task retry`. Returns notes for the transition's output.
 */
export function reopenDraft(p: Paths, id: string): string[] {
  const notes: string[] = [];
  let tf = loadTasks(p, id);
  const cap = agentRunStatus(p, tf.change);
  for (const t of tf.tasks) {
    const n = notBuiltOf(t);
    if (!n || !(n.cause === "environment" || (n.cause === "cap" && !cap.reached))) continue;
    tf = loadTasks(p, id);
    const revived = reviveNotBuilt(tf, t.id, `runs again on /aidw:resume (it was not built: ${n.cause})`);
    notes.push(`${revived.join(", ")} run${revived.length === 1 ? "s" : ""} again (not built before: ${n.cause})`);
  }
  tf = loadTasks(p, id);
  const left = tf.tasks.filter((t) => notBuiltOf(t) && notBuiltOf(t)?.cause !== "dependency");
  for (const t of left) {
    const n = notBuiltOf(t) as NotBuilt;
    notes.push(n.cause === "cap" ? `${t.id} stays not built: the cap is still reached (\`aidw cap ${id} --raise <runs>\`)` : `${t.id} stays not built (${n.cause}); \`aidw task retry ${t.id}\` builds it again when the user grants it`);
  }
  const layers = notBuiltLayers(tf.change).map((l) => l.layer);
  if (layers.length) {
    forgetLayers(tf.change, layers);
    notes.push(`quality layer${layers.length === 1 ? "" : "s"} ${layers.join(", ")} run${layers.length === 1 ? "s" : ""} again at verify`);
  }
  const d = lastDeploy(tf.change);
  if (d && !d.ok) notes.push("the deploy runs again at the end");
  return notes;
}
