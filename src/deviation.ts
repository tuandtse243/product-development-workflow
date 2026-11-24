/**
 * Deviation (ADR-0014, plan D8): after the Approval Gate the run does not ask the user. When something approved must
 * change, the Role that wrote it changes its Artifact under three rules (keep the purpose of the requirement, make the
 * smallest change, add no new scope), and the CLI checks what it can, rehashes the approved package with the reason,
 * lists the tasks to run again and records the Deviation for the pull request.
 *
 *   aidw deviation open [<id>] --role R[,R2] --files a,b --reason "..." [--consultation C01] [--task T03]
 *       the lead (a state command; no Agent runs it). Refused unless the Change builds with a valid approval, no other
 *       Deviation is open, every file belongs to the approved package and a named Role owns it in artifacts.yaml. It
 *       copies the files as they are into `deviations/D<NN>/`; from then on the gate hook lets each file be edited by
 *       its author Role only, and the approval hash reads them as they were, so an edit anywhere else is still drift.
 *       Several Roles only when one change spans their Artifacts (a scenario renamed in the delta spec and in the task
 *       that verifies it): the package must still validate when it closes.
 *   aidw deviation close [<id>] [--remove-reason "..."]
 *       checks: nothing else drifted; the package still validates; no approved scenario is gone without a recorded
 *       reason; the grants (the user's) are untouched; a new task serves an approved scenario; a contract difference is
 *       classified additive or breaking. Then it rehashes (`approval.push` is kept, so the push grant still holds),
 *       appends to `approval.history`, resets the affected done tasks and records the Deviation.
 *   aidw deviation abandon [<id>]      puts the files back as they were and records it abandoned
 *   aidw not-built <task> --reason R   D10: work outside the permission envelope is marked not built, never done
 *
 * The record is `changes/<id>/deviations.yaml` (src/deviationrecord.ts), beside the package and not in it; it is the
 * source of the pull request's "differs from the approved package" section.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { decisionsToHonor, reqId, scenarioId, specsAfterChange } from "./analyze.js";
import { approvalStatus, baseSpecFiles, CHANGE_PACKAGE_FILES, computeApprovalHash, fileDigest, FROZEN_PROJECT_DIRS, packageDigests } from "./approval.js";
import { loadArtifacts } from "./artifacts.js";
import { loadChange, saveChange, stateOf, type Change } from "./change.js";
import { loadConsultations, deviationRecorded } from "./consult.js";
import { classifyDbml, classifyOpenApi } from "./contractdiff.js";
import { DEVIATIONS_DIR, loadDeviations, openDeviation, saveDeviations, type ContractDiff, type DeviationRecord } from "./deviationrecord.js";
import { OpError } from "./diag.js";
import { readinessCheck } from "./ops.js";
import { readText, rel, type Paths } from "./project.js";
import { loadTasks, rerunTasks, saveTasksDoc, setField } from "./run.js";
import { touchesUi } from "./skills.js";
import { parseSpec } from "./spec/parse.js";
import { ADDED_ORIGINS, parseTasks, planSha, type Task } from "./tasks.js";

/** The states a Deviation may open in: the build is under way and the package is approved. */
export const DEVIATION_STATES = ["executing", "verifying", "converging"] as const;

const now = () => new Date().toISOString();
/** A short digest of a requirement's or a scenario's text, to tell a changed one from an unchanged one. */
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const statusOf = (t: Task) => String(t.status ?? "pending");
const snapshotDir = (change: Change, did: string) => join(change.dir, DEVIATIONS_DIR, did);
export const deviationBriefPath = (p: Paths, id: string, did: string) => join(p.run, "briefs", id, `${did}.deviation.md`);

// ---------------------------------------------------------------- what may change, and who

/** Whether a file is (or, when new, would be) part of the approved package of this Change. */
export function isPackagePath(p: Paths, change: Change, file: string): boolean {
  const low = (x: string) => x.toLowerCase();
  const inside = (parent: string, child: string) => {
    const r = relative(low(parent), low(child));
    return r !== "" && r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
  };
  if (low(file) === low(p.constitution) || FROZEN_PROJECT_DIRS(p).some((d) => inside(d, file))) return true;
  if (baseSpecFiles(p, change).some((b) => low(b) === low(file))) return true;
  if (!inside(change.dir, file)) return false;
  const r = relative(change.dir, file).split(sep).join("/");
  return r === "tasks.yaml" || (CHANGE_PACKAGE_FILES as readonly string[]).includes(r) || (r.startsWith("specs/") && r.endsWith(".md"));
}

/** A registry path (`changes/<id>/specs/<capability>/spec.md`, `decisions/NNNN-<slug>.md`) as a pattern for one Change. */
function registryPattern(path: string, id: string): RegExp {
  const esc = path
    .replace(/<id>/g, "\u0000ID\u0000")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\u0000ID\u0000/g, id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .replace(/<capability>/g, "[^/]+(?:/[^/]+)*")
    .replace(/NNNN-<slug>/g, "\\d{4}-[^/]+")
    .replace(/<[^>]+>/g, "[^/]+");
  return new RegExp(`^${esc}$`, "i");
}

/**
 * The Roles that own a file of the package in artifacts.yaml (the file's path inside `.aidw/`): every owner of a part
 * of a shared file (analysis.md), and for a file the registry does not name, the owners of the files beside it in the
 * same project folder (an asset under `design/`).
 */
export function authorsOf(pluginRoot: string, id: string, fromAidw: string): string[] {
  let registry: ReturnType<typeof loadArtifacts> = null;
  try {
    registry = loadArtifacts(pluginRoot);
  } catch {
    registry = null;
  }
  const entries = Object.values(registry ?? {}).filter((e) => typeof e?.path === "string" && typeof e?.owner === "string");
  const exact = entries.filter((e) => registryPattern(e.path, id).test(fromAidw));
  if (exact.length) return [...new Set(exact.map((e) => e.owner))].sort();
  const top = fromAidw.split("/")[0] ?? "";
  if (top === "changes") return [];
  return [...new Set(entries.filter((e) => e.path.split("/")[0] === top && e.path.includes("/")).map((e) => e.owner))].sort();
}

// ---------------------------------------------------------------- what the package says

interface SpecIndex {
  scenarios: Record<string, string>;
  requirements: Record<string, string>;
}

/** Scenario and requirement ids of the system after this Change, each with a digest of its text. */
export function specIndex(p: Paths, id: string): SpecIndex {
  const out: SpecIndex = { scenarios: {}, requirements: {} };
  for (const [cap, text] of specsAfterChange(p, id).specs) {
    for (const r of parseSpec(text).requirements) {
      out.requirements[reqId(cap, r.name)] = sha(r.raw.replace(/\s+/g, " ").trim());
      const parts = r.raw.split(/^####\s+Scenario:\s*/m).slice(1);
      r.scenarios.forEach((s, i) => (out.scenarios[scenarioId(cap, r.name, s.name)] = sha((parts[i] ?? s.name).replace(/\s+/g, " ").trim())));
    }
  }
  return out;
}

const planned = (text: string | null): Task[] => (text === null ? [] : parseTasks(text).tasks.filter((t) => t && !ADDED_ORIGINS.includes(String(t.origin))));

function grantsOf(text: string | null): string {
  try {
    const data = text === null ? null : (YAML.parse(text) as { grants?: unknown } | null);
    return JSON.stringify(data?.grants ?? null);
  } catch {
    return "invalid";
  }
}

// ---------------------------------------------------------------- open

export interface OpenOptions {
  role: string;
  files: string[];
  reason: string;
  consultation?: string;
  task?: string;
  pluginRoot: string;
  /** where relative `files` are resolved from (default: the project) */
  cwd?: string;
}

export function openDeviationFor(p: Paths, id: string, o: OpenOptions): { deviation: DeviationRecord; brief: string } {
  const change = loadChange(p, id);
  const state = stateOf(change);
  if (!state || !(DEVIATION_STATES as readonly string[]).includes(state)) {
    throw new OpError(`change "${id}" is "${String(change.data.state)}": a Deviation changes an approved package while it is built (${DEVIATION_STATES.join(", ")}); before the gate the package is simply edited`);
  }
  const open = openDeviation(change);
  if (open) throw new OpError(`Deviation ${open.id} of "${id}" is still open (${open.files.join(", ")}); close or abandon it first`);
  if (approvalStatus(p, change).status !== "valid") throw new OpError(`approval drift in "${id}": an approved file changed with no recorded decision; a Deviation starts only from a valid approval`);
  const roles = [...new Set(o.role.split(",").map((r) => r.trim()).filter(Boolean))];
  const reason = o.reason.trim();
  if (!roles.length) throw new OpError("a Deviation names the Role that wrote what changes (--role <role>)");
  if (!reason) throw new OpError('a Deviation needs a reason (--reason "...")');
  if (!o.files.length) throw new OpError("a Deviation names the files the author changes (--files a,b)");
  const files: string[] = [];
  const authors: Record<string, string> = {};
  for (const raw of o.files) {
    const abs = resolve(o.cwd ?? p.project, raw);
    const fromAidw = relative(p.aidw, abs).split(sep).join("/");
    if (!isPackagePath(p, change, abs)) throw new OpError(`${rel(p, abs)} is not part of the approved package of "${id}": only approved Artifacts change by Deviation`);
    const owners = authorsOf(o.pluginRoot, id, fromAidw);
    const author = roles.find((r) => owners.includes(r));
    if (!author) {
      throw new OpError(`${rel(p, abs)} is written by ${owners.join(", ") || "no Role of artifacts.yaml"}, not ${roles.join(", ")}: the Role that wrote an Artifact is the one that changes it (ADR-0014)`);
    }
    if (!files.includes(rel(p, abs))) files.push(rel(p, abs));
    authors[rel(p, abs)] = author;
  }
  const idle = roles.filter((r) => !Object.values(authors).includes(r));
  if (idle.length) throw new OpError(`${idle.join(", ")} wrote none of ${files.join(", ")}: name only the Roles whose Artifacts change`);
  const consultations = loadConsultations(change);
  if (o.consultation) {
    const c = consultations.find((x) => x.id === o.consultation);
    if (!c) throw new OpError(`no Consultation ${o.consultation} in "${id}"`);
    if (c.status !== "needs-deviation" || c.deviation !== "pending") throw new OpError(`${c.id} is ${c.status}${c.deviation ? ` (deviation ${c.deviation})` : ""}: only a Consultation that needs a Deviation routes here`);
  }
  const c = o.consultation ? consultations.find((x) => x.id === o.consultation) : undefined;
  const task = o.task ?? c?.task;
  if (task && !loadTasks(p, id).tasks.some((t) => t.id === task)) throw new OpError(`change "${id}" has no task ${task}`);

  const all = loadDeviations(change);
  const did = `D${String(all.length + 1).padStart(2, "0")}`;
  const dir = snapshotDir(change, did);
  rmSync(dir, { recursive: true, force: true });
  const before: Record<string, string | null> = {};
  for (const f of files) {
    const abs = join(p.project, f);
    before[f] = fileDigest(p, change, abs);
    if (existsSync(abs)) {
      mkdirSync(dirname(join(dir, "files", f)), { recursive: true });
      copyFileSync(abs, join(dir, "files", f));
    }
  }
  mkdirSync(dir, { recursive: true });
  // what was approved, file by file and scenario by scenario: close names what drifted and what the author changed
  writeFileSync(join(dir, "approved.json"), `${JSON.stringify({ files: Object.fromEntries(packageDigests(p, change)), ...specIndex(p, id) }, null, 2)}\n`);
  const record: DeviationRecord = {
    id: did,
    status: "open",
    roles,
    files,
    authors,
    reason,
    ...(o.consultation ? { consultation: o.consultation } : {}),
    ...(task ? { task } : {}),
    opened_at: now(),
    previous: String((change.data.approval as { hash?: unknown }).hash),
    before,
  };
  all.push(record);
  saveDeviations(change, all);
  return { deviation: record, brief: writeBrief(p, change, record, c ? join(change.dir, c.answer) : null) };
}

function writeBrief(p: Paths, change: Change, d: DeviationRecord, answer: string | null): string {
  const lines = [
    `# Deviation brief: ${d.id} of change ${change.id}, for ${d.roles.length > 1 ? `the ${d.roles.join(" and ")} Roles` : `the ${d.roles[0]} Role`}`,
    "",
    "The user approved this Change's package at the Approval Gate and does not answer questions after it (ADR-0014). Something you wrote must change, and you decide how. The CLI checks your change, records it as a Deviation and has the affected tasks run again; the pull request lists it.",
    "",
    "## Why",
    "",
    d.reason,
    ...(answer ? ["", `It comes from Consultation ${d.consultation}: read the answer \`${answer}\` and the request beside it first.`] : []),
    ...(d.task ? ["", `The task that needs it: ${d.task} (\`${join(change.dir, "tasks.yaml")}\`).`] : []),
    "",
    "## The files you may change",
    "",
    ...d.files.map((f) => `- \`${join(p.project, f)}\` (${d.authors[f]})`),
    "",
    "Only the files beside your Role's name, and only you: the gate hook refuses every other file and every other Agent until the lead closes the Deviation.",
    ...(d.roles.length > 1 ? ["", `The change spans the Artifacts of ${d.roles.join(" and ")}: each changes its own files, and together the package must still validate.`] : []),
    "",
    "## Three rules",
    "",
    "1. **Keep the purpose** of every requirement. Change how it is met, not what it is for.",
    "2. **Make the smallest change** that lets the work go on. Rewrite nothing that does not have to move.",
    "3. **Add no new scope.** A new task or a contract addition is allowed only when it serves a scenario that was already approved; name that scenario in the task's `scenarios:`.",
    "",
    "## What the CLI checks when the lead closes it",
    "",
    "- nothing outside these files changed;",
    "- the package still passes `aidw validate` and `aidw analyze`;",
    "- no approved scenario is removed unless the lead records a reason (`--remove-reason`): say in your reply why one had to go;",
    "- the grants in quality.yaml are the user's: never change them;",
    "- a new task in tasks.yaml lists at least one approved scenario under `scenarios:`;",
    "- a change to openapi.yaml or data-model.dbml is classified additive or breaking; prefer additive.",
    "",
    "## Reply",
    "",
    "One short paragraph: what you changed in which file, why that is the smallest change, and any approved scenario you had to remove with its reason.",
    "",
  ];
  const path = deviationBriefPath(p, change.id, d.id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n"));
  return path;
}

// ---------------------------------------------------------------- close

export interface CloseOptions {
  removeReason?: string;
  pluginRoot: string;
}

/** What a changed file means for the tasks that read it (src/briefreads.ts): all of them, the UI ones, or none. */
function readersOf(p: Paths, change: Change, file: string, contract: ContractDiff | undefined, honorChanged: boolean): "all" | "ui" | "none" {
  const abs = join(p.project, file);
  const low = (x: string) => x.toLowerCase();
  const under = (dir: string) => low(abs).startsWith(low(dir) + sep);
  if (contract) return contract.class === "additive" || contract.class === "none" ? "none" : "all";
  if (low(abs) === low(join(change.dir, "analysis.md"))) return honorChanged ? "all" : "none";
  if (low(abs) === low(p.constitution) || under(p.domain) || under(p.architecture) || under(p.requirements)) return "all";
  if (under(p.design) || low(abs) === low(join(change.dir, "design.md"))) return "ui";
  return "none"; // specs (by scenario and requirement), tasks.yaml (by task), quality.yaml, intake, decisions
}

export function closeDeviation(p: Paths, id: string, o: CloseOptions): DeviationRecord {
  let change = loadChange(p, id);
  const all = loadDeviations(change);
  const at = all.findIndex((d) => d.status === "open");
  if (at < 0) throw new OpError(`change "${id}" has no open Deviation`);
  const d = all[at] as DeviationRecord;
  const dir = snapshotDir(change, d.id);
  const approved = JSON.parse(readFileSync(join(dir, "approved.json"), "utf8")) as { files: Record<string, string> } & SpecIndex;

  // 1. drift outside the Deviation is still drift
  if (approvalStatus(p, change).status !== "valid") {
    const nowDigests = packageDigests(p, change, new Map(Object.entries(d.before)));
    const drifted = [...new Set([...Object.keys(approved.files), ...nowDigests.keys()])].filter((f) => approved.files[f] !== nowDigests.get(f));
    throw new OpError(`approval drift outside Deviation ${d.id}: ${drifted.join(", ") || "the approved package"} changed with no recorded decision. Put it back; only ${d.files.join(", ")} may change by this Deviation`);
  }
  const changed = d.files.filter((f) => fileDigest(p, change, join(p.project, f)) !== d.before[f]);
  if (!changed.length) throw new OpError(`Deviation ${d.id}: ${d.roles.join(", ")} changed none of ${d.files.join(", ")}; spawn it with the brief, or \`aidw deviation abandon\` when nothing needs to change`);
  const beforeText = (f: string): string | null => readText(join(dir, "files", f));
  const afterText = (f: string): string | null => readText(join(p.project, f));

  // 2. the package still holds together
  const diags = readinessCheck(p, id);
  if (diags.errors.length) throw new OpError(`Deviation ${d.id}: the changed package does not validate; ${d.roles.join(", ")} fix it before it closes`, diags);

  // 3. the grants are the user's
  const qualityRel = rel(p, join(change.dir, "quality.yaml"));
  if (changed.includes(qualityRel) && grantsOf(beforeText(qualityRel)) !== grantsOf(afterText(qualityRel))) {
    throw new OpError(`Deviation ${d.id}: the grants in quality.yaml were granted by the user at the Approval Gate; no Role changes them`);
  }

  // 4. scenarios: none removed without a recorded reason
  const after = specIndex(p, id);
  const removed = Object.keys(approved.scenarios).filter((s) => !(s in after.scenarios));
  const removeReason = o.removeReason?.trim() ?? "";
  if (removed.length && !removeReason) {
    throw new OpError(`Deviation ${d.id} removes approved scenario(s) ${removed.join(", ")}: record why with --remove-reason "...", or the author keeps them`);
  }
  const added = Object.keys(after.scenarios).filter((s) => !(s in approved.scenarios));
  const changedScenarios = Object.keys(approved.scenarios).filter((s) => s in after.scenarios && after.scenarios[s] !== approved.scenarios[s]);
  const changedReqs = Object.keys(approved.requirements).filter((r) => after.requirements[r] !== approved.requirements[r]);

  // 5. tasks: a new task serves an approved scenario
  const tasksRel = rel(p, join(change.dir, "tasks.yaml"));
  const taskDiff = { added: [] as string[], removed: [] as string[], changed: [] as string[] };
  if (changed.includes(tasksRel)) {
    const was = new Map(planned(beforeText(tasksRel)).map((t) => [t.id, t]));
    const is = planned(afterText(tasksRel));
    for (const t of is) {
      const old = was.get(t.id);
      if (!old) {
        const serves = list(t.scenarios).filter((s) => s in approved.scenarios);
        if (!serves.length) {
          throw new OpError(`Deviation ${d.id}: new task ${t.id} serves no approved scenario (its scenarios: ${list(t.scenarios).join(", ") || "none"}); a task that adds scope is not a Deviation (ADR-0014)`);
        }
        taskDiff.added.push(t.id);
      } else if (planSha(old) !== planSha(t)) taskDiff.changed.push(t.id);
    }
    for (const id0 of was.keys()) if (!is.some((t) => t.id === id0)) taskDiff.removed.push(id0);
  }

  // 6. contracts: additive or breaking
  const contracts: ContractDiff[] = [];
  for (const f of changed) {
    const name = basename(f);
    if (name === "openapi.yaml") contracts.push({ file: f, kind: "openapi", ...classifyOpenApi(beforeText(f), afterText(f)) });
    else if (name === "data-model.dbml") contracts.push({ file: f, kind: "dbml", ...classifyDbml(beforeText(f), afterText(f)) });
    else if (name === "api-contract.md" || name === "data-model.md") contracts.push({ file: f, kind: "prose", class: "prose", changes: ["changed (prose: compared by the reviewers, not the CLI)"] });
  }

  // 7. the tasks to run again
  const tf = loadTasks(p, id);
  const live = tf.tasks.filter((t) => statusOf(t) !== "not_built");
  const analysisRel = rel(p, join(change.dir, "analysis.md"));
  const honorChanged = changed.includes(analysisRel) && JSON.stringify(decisionsToHonor(beforeText(analysisRel) ?? "")) !== JSON.stringify(decisionsToHonor(afterText(analysisRel) ?? ""));
  const rerun = new Set<string>();
  if (d.task && live.some((t) => t.id === d.task)) rerun.add(d.task);
  for (const t of live) {
    if (taskDiff.changed.includes(t.id)) rerun.add(t.id);
    if (list(t.scenarios).some((s) => removed.includes(s) || changedScenarios.includes(s))) rerun.add(t.id);
    if (list(t.specs).some((r) => changedReqs.includes(r))) rerun.add(t.id);
    for (const f of changed) {
      const who = readersOf(p, change, f, contracts.find((c) => c.file === f), honorChanged);
      if (who === "all" || (who === "ui" && touchesUi(t))) rerun.add(t.id);
    }
  }
  // what was built on top of a task that runs again runs again too
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of live) {
      if (rerun.has(t.id) || !list(t.depends_on).some((x) => rerun.has(x))) continue;
      rerun.add(t.id);
      grew = true;
    }
  }
  const order = live.map((t) => t.id).filter((x) => rerun.has(x) && !taskDiff.added.includes(x));

  // 8. rehash, keeping the push binding: the push grant holds for the moved package
  change = loadChange(p, id);
  const { hash } = computeApprovalHash(p, change);
  const approval = (change.data.approval ?? {}) as Record<string, unknown>;
  const history = Array.isArray(approval.history) ? (approval.history as unknown[]) : [];
  const entry = { deviation: d.id, previous: String(approval.hash), hash, reason: d.reason, roles: d.roles, files: changed, at: now() };
  change.doc.setIn(["approval", "hash"], hash);
  change.doc.setIn(["approval", "history"], change.doc.createNode([...history, entry]));
  saveChange(change);

  const reset = rerunTasks(p, id, order, `Deviation ${d.id} (${d.roles.join(", ")}) changed ${changed.join(", ")}; runs again`);
  const closed: DeviationRecord = {
    ...d,
    status: "closed",
    closed_at: now(),
    hash,
    changed,
    scenarios: { removed: removed.map((s) => ({ scenario: s, reason: removeReason })), added, changed: changedScenarios },
    contracts,
    tasks: taskDiff,
    rerun: order,
    reset,
  };
  const fresh = loadChange(p, id);
  const list2 = loadDeviations(fresh);
  list2[list2.findIndex((x) => x.id === d.id)] = closed;
  saveDeviations(fresh, list2);
  if (d.consultation) deviationRecorded(p, id, d.consultation, closed);
  return closed;
}

// ---------------------------------------------------------------- abandon

/** Nothing needs to change after all, or the author cannot meet the rules: the files go back as they were. */
export function abandonDeviation(p: Paths, id: string): DeviationRecord {
  const change = loadChange(p, id);
  const all = loadDeviations(change);
  const at = all.findIndex((d) => d.status === "open");
  if (at < 0) throw new OpError(`change "${id}" has no open Deviation`);
  const d = all[at] as DeviationRecord;
  const dir = snapshotDir(change, d.id);
  for (const f of d.files) {
    const abs = join(p.project, f);
    const copy = join(dir, "files", f);
    if (d.before[f] === null) rmSync(abs, { force: true });
    else if (existsSync(copy)) {
      mkdirSync(dirname(abs), { recursive: true });
      copyFileSync(copy, abs);
    }
  }
  const done: DeviationRecord = { ...d, status: "abandoned", closed_at: now() };
  all[at] = done;
  saveDeviations(change, all);
  return done;
}

// ---------------------------------------------------------------- not built (D10)

/**
 * D10: work that needs more than the user granted (the permission envelope, src/grants.ts) is marked not built, never
 * done: the task and every open task that depends on it. The rest carries on; the pull request lists them.
 */
export function markNotBuilt(p: Paths, id: string, taskId: string, reason: string, cause = "envelope"): string[] {
  if (!reason.trim()) throw new OpError('say why it is not built (--reason "...")');
  const tf = loadTasks(p, id);
  const i = tf.tasks.findIndex((t) => t.id === taskId);
  if (i < 0) throw new OpError(`change "${id}" has no task ${taskId}`);
  const t = tf.tasks[i] as Task;
  if (statusOf(t) === "done") throw new OpError(`task ${taskId} is done; reopen it first if what it built lies outside the grants`);
  if (statusOf(t) === "not_built") throw new OpError(`task ${taskId} is already not built`);
  const marked: string[] = [];
  const mark = (j: number, why: string, c: string) => {
    setField(tf, j, "status", "not_built");
    setField(tf, j, "not_built", tf.doc.createNode({ cause: c, reason: why, at: now() }));
    setField(tf, j, "notes", why);
    marked.push((tf.tasks[j] as Task).id);
  };
  mark(i, reason.trim(), cause);
  for (let grew = true; grew; ) {
    grew = false;
    tf.tasks.forEach((x, j) => {
      if (marked.includes(x.id) || ["done", "not_built"].includes(statusOf(x))) return;
      const dep = list(x.depends_on).find((y) => marked.includes(y));
      if (!dep) return;
      mark(j, `depends on ${dep}, which is not built`, "dependency");
      grew = true;
    });
  }
  saveTasksDoc(tf);
  return marked;
}
