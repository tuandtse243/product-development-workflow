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
 *   aidw deviation close [<id>] [--remove-reason "..."] [--scope-reason "..."] [--summary "..."]
 *       checks: nothing else drifted; no contract or scenario is half written; the package still validates; the grants
 *       and the tier 2 permissions (the user's) are untouched; no approved scenario is gone without a recorded reason; no
 *       new requirement without a recorded reason; a new task serves an approved scenario; no task to run again is still
 *       running or in review. A contract difference is classified additive, breaking or unclassified. Then it records
 *       the closed Deviation and rehashes in one step (`approval.package: 2`; `approval.push` is kept, so the push grant
 *       still holds; `approval.history` grows), and only then resets the affected done tasks.
 *       "Keep the purpose" and "smallest change" are judgments: the author's and the reviewers', not the CLI's.
 *   aidw deviation abandon [<id>]      puts the files back as they were and records it abandoned
 *   aidw not-built <task> --reason R   D10: work outside the permission envelope is marked not built, never done
 *
 * The record is `changes/<id>/deviations.yaml` (src/deviationrecord.ts), beside the package and not in it; it is the
 * source of the pull request's "differs from the approved package" section.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { decisionsToHonor, reqId, scenarioId, specsAfterChange } from "./analyze.js";
import { approvalStatus, computeApprovalHash, fileDigest, isPackageRel, PACKAGE_VERSION, packageDigests } from "./approval.js";
import { loadArtifacts } from "./artifacts.js";
import { loadChange, saveChange, stateOf, type Change } from "./change.js";
import { deviationAbandoned, deviationRecorded, loadConsultations } from "./consult.js";
import { classifyDbml, classifyOpenApi, dbmlProblem } from "./contractdiff.js";
import { DEVIATIONS_DIR, loadDeviations, openDeviation, saveDeviations, type ContractDiff, type DeviationRecord } from "./deviationrecord.js";
import { OpError } from "./diag.js";
import { readinessCheck } from "./ops.js";
import { readText, rel, type Paths } from "./project.js";
import { loadTasks, rerunTasks, saveTasksDoc, setField } from "./run.js";
import { touchesUi } from "./skills.js";
import { parseSpec } from "./spec/parse.js";
import { defaultTaskRole } from "./roles.js";
import { ADDED_ORIGINS, parseTasks, planSha, RUNTIME_FIELDS, type Task } from "./tasks.js";

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

/** Whether a file is (or, when new, would be) part of the approved package of this Change, by its approval's version. */
export const isPackagePath = (p: Paths, change: Change, file: string): boolean => isPackageRel(p, change, rel(p, file));

/**
 * The path as it is on disk: each existing segment matched exactly, else without case (macOS and Windows take
 * `OPENAPI.yaml` for `openapi.yaml`, and two spellings would be two digest keys). Segments that do not exist yet (a new
 * file) stay as given.
 */
export function realPath(p: Paths, abs: string): string {
  const parts = relative(p.project, abs).split(sep).filter(Boolean);
  let cur = p.project;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i] as string;
    let names: string[] = [];
    try {
      names = readdirSync(cur);
    } catch {
      return join(cur, ...parts.slice(i));
    }
    const hit = names.includes(seg) ? seg : names.find((n) => n.toLowerCase() === seg.toLowerCase());
    if (!hit) return join(cur, ...parts.slice(i));
    cur = join(cur, hit);
  }
  return cur;
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
  /** scenarios without a WHEN or a THEN (a spec cut off while it is edited) */
  incomplete?: string[];
}

/** Scenario and requirement ids of the system after this Change, each with a digest of its text. */
export function specIndex(p: Paths, id: string): SpecIndex {
  const out: SpecIndex = { scenarios: {}, requirements: {}, incomplete: [] };
  for (const [cap, text] of specsAfterChange(p, id).specs) {
    for (const r of parseSpec(text).requirements) {
      out.requirements[reqId(cap, r.name)] = sha(r.raw.replace(/\s+/g, " ").trim());
      const parts = r.raw.split(/^####\s+Scenario:\s*/m).slice(1);
      r.scenarios.forEach((s, i) => {
        const sid = scenarioId(cap, r.name, s.name);
        out.scenarios[sid] = sha((parts[i] ?? s.name).replace(/\s+/g, " ").trim());
        if (!s.hasTrigger || !s.hasOutcome) out.incomplete?.push(sid);
      });
    }
  }
  return out;
}

const planned = (text: string | null): Task[] => (text === null ? [] : parseTasks(text).tasks.filter((t) => t && !ADDED_ORIGINS.includes(String(t.origin))));

/** What the user granted at the gate in quality.yaml: `grants` and the tier 2 `permissions`. */
function grantsOf(text: string | null): string {
  try {
    const data = text === null ? null : (YAML.parse(text) as { grants?: unknown; permissions?: unknown } | null);
    return JSON.stringify({ grants: data?.grants ?? null, permissions: data?.permissions ?? null });
  } catch {
    return "invalid";
  }
}

const roleOf = (t: Task): string => (typeof t.role === "string" && t.role ? t.role : defaultTaskRole());
const hasRole = (t: Task, roles: readonly string[]) => roles.some((r) => roleOf(t) === r || roleOf(t).startsWith(`${r}-`));
/** The implementing Roles that build against each kind of contract. */
const API_ROLES = ["backend", "frontend", "fullstack", "integration"];
const DATA_ROLES = ["database", "backend", "fullstack", "integration"];

/** `--remove-reason`: one reason for every removed scenario, or `id=reason` pairs separated by `;` or new lines. */
export function removeReasons(raw: string | undefined, removed: string[]): { reasons: Record<string, string>; missing: string[] } {
  const text = raw?.trim() ?? "";
  const reasons: Record<string, string> = {};
  if (text && !/^[^\s=;]+=/.test(text)) for (const s of removed) reasons[s] = text;
  else
    for (const part of text.split(/[;\n]/)) {
      const m = /^\s*([^=\s]+)\s*=\s*(\S.*?)\s*$/.exec(part);
      if (m) reasons[m[1] as string] = m[2] as string;
    }
  return { reasons, missing: removed.filter((s) => !reasons[s]) };
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
    const abs = realPath(p, resolve(o.cwd ?? p.project, raw));
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
    "3. **Add no new scope.** No new requirement; a new scenario only under an approved requirement; a new task or a contract addition only when it serves a scenario that was already approved (name that scenario in the task's `scenarios:`).",
    "",
    "The first two are your judgment and the reviewers'; the CLI checks what it can of the third.",
    "",
    "## What the CLI checks when the lead closes it",
    "",
    "- nothing outside these files changed;",
    "- every contract parses and every scenario has its WHEN and its THEN (nothing is left half written);",
    "- the package still passes `aidw validate` and `aidw analyze`;",
    "- no approved scenario is removed unless the lead records a reason (`--remove-reason`): say in your reply why each one had to go;",
    "- no new requirement unless the lead records why (`--scope-reason`);",
    "- `grants` and `permissions` in quality.yaml are the user's: never change them;",
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
  /** one reason for every removed approved scenario, or `id=reason` pairs */
  removeReason?: string;
  /** why a new requirement does not add scope */
  scopeReason?: string;
  /** the author's one-paragraph account, for the pull request */
  summary?: string;
  pluginRoot: string;
}

const RERUN_CLASSES = new Set(["breaking", "prose", "unclassified"]);

/**
 * Which tasks read a changed file (src/briefreads.ts): a predicate, or null for none. Contracts reach the Roles that
 * build against them; a contract change that is additive (or makes no difference) reruns nothing.
 */
function readersOf(p: Paths, change: Change, file: string, contracts: ContractDiff[], honorChanged: boolean): ((t: Task) => boolean) | null {
  const abs = join(p.project, file);
  const low = (x: string) => x.toLowerCase();
  const under = (dir: string) => low(abs).startsWith(low(dir) + sep);
  const contract = contracts.find((c) => c.file === file);
  if (contract) {
    if (!RERUN_CLASSES.has(contract.class)) return null;
    return contract.kind === "dbml" || basename(file) === "data-model.md" ? (t) => hasRole(t, DATA_ROLES) : (t) => hasRole(t, API_ROLES);
  }
  if (low(abs) === low(join(change.dir, "analysis.md"))) return honorChanged ? () => true : null;
  if (low(abs) === low(p.constitution) || under(p.domain) || under(p.architecture) || under(p.requirements)) return () => true;
  if (under(p.design) || low(abs) === low(join(change.dir, "design.md"))) return (t) => touchesUi(t);
  return null; // specs (by scenario and requirement), tasks.yaml (by task), quality.yaml, intake, decisions
}

/** A contract the CLI can read must parse: a file that does not is still being written. */
function contractProblem(name: string, text: string | null): string | null {
  if (text === null) return null;
  if (name === "openapi.yaml") {
    try {
      YAML.parse(text);
      return null;
    } catch (e) {
      return `not valid YAML (${(e as Error).message.split("\n")[0]})`;
    }
  }
  if (name === "data-model.dbml") return dbmlProblem(text);
  return null;
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
  const refuse = (why: string, diags?: ConstructorParameters<typeof OpError>[1]): never => {
    throw new OpError(`Deviation ${d.id}: ${why}`, diags);
  };

  // 2. nothing half written: a contract that does not parse, a scenario without its WHEN or THEN
  for (const f of changed) {
    const problem = contractProblem(basename(f), afterText(f));
    if (problem) refuse(`${f} is ${problem}: is it still being edited? ${d.roles.join(", ")} finish it before it closes`);
  }
  const after = specIndex(p, id);
  const incomplete = (after.incomplete ?? []).filter((s) => after.scenarios[s] !== approved.scenarios[s]);
  if (incomplete.length) refuse(`scenario(s) ${incomplete.join(", ")} lack a WHEN or a THEN: is the spec still being edited?`);

  // 3. the grants and the tier 2 permissions are the user's
  const qualityRel = rel(p, join(change.dir, "quality.yaml"));
  if (changed.includes(qualityRel) && grantsOf(beforeText(qualityRel)) !== grantsOf(afterText(qualityRel))) {
    refuse("`grants` and `permissions` in quality.yaml were granted by the user at the Approval Gate; no Role changes them");
  }

  // 4. the package still holds together
  const diags = readinessCheck(p, id);
  if (diags.errors.length) refuse(`the changed package does not validate; ${d.roles.join(", ")} fix it before it closes`, diags);

  // 5. scenarios and requirements: nothing approved gone without a reason, no new scope
  const removed = Object.keys(approved.scenarios).filter((s) => !(s in after.scenarios));
  const { reasons, missing } = removeReasons(o.removeReason, removed);
  if (missing.length) refuse(`removes approved scenario(s) ${missing.join(", ")} with no recorded reason: --remove-reason "..." (one for all, or "<scenario>=<why>; ..."), or the author keeps them`);
  const added = Object.keys(after.scenarios).filter((s) => !(s in approved.scenarios));
  const changedScenarios = Object.keys(approved.scenarios).filter((s) => s in after.scenarios && after.scenarios[s] !== approved.scenarios[s]);
  const requirements = {
    added: Object.keys(after.requirements).filter((r) => !(r in approved.requirements)),
    removed: Object.keys(approved.requirements).filter((r) => !(r in after.requirements)),
    changed: Object.keys(approved.requirements).filter((r) => r in after.requirements && after.requirements[r] !== approved.requirements[r]),
  };
  const scopeReason = o.scopeReason?.trim() ?? "";
  if (requirements.added.length && !scopeReason) {
    refuse(`adds requirement(s) ${requirements.added.join(", ")}: new scope is not a Deviation (ADR-0014). Record why it is not new scope with --scope-reason "...", or the author takes it out`);
  }
  const orphan = added.filter((s) => !(s.split("/").slice(0, -1).join("/") in approved.requirements));
  if (orphan.length && !scopeReason) refuse(`adds scenario(s) ${orphan.join(", ")} under no approved requirement`);
  const changedReqs = [...requirements.changed, ...requirements.removed];

  // 6. tasks: a new task serves an approved scenario
  const tasksRel = rel(p, join(change.dir, "tasks.yaml"));
  const tf = loadTasks(p, id);
  const taskDiff = { added: [] as string[], removed: [] as string[], removed_done: [] as string[], changed: [] as string[] };
  if (changed.includes(tasksRel)) {
    const was = new Map(planned(beforeText(tasksRel)).map((t) => [t.id, t]));
    const is = planned(afterText(tasksRel));
    for (const t of is) {
      const old = was.get(t.id);
      if (!old) {
        const serves = list(t.scenarios).filter((s) => s in approved.scenarios);
        if (!serves.length) refuse(`new task ${t.id} serves no approved scenario (its scenarios: ${list(t.scenarios).join(", ") || "none"}); a task that adds scope is not a Deviation (ADR-0014)`);
        taskDiff.added.push(t.id);
      } else if (planSha(old) !== planSha(t)) taskDiff.changed.push(t.id);
    }
    for (const [tid, old] of was) {
      if (is.some((t) => t.id === tid)) continue;
      taskDiff.removed.push(tid);
      if (statusOf(old) === "done") taskDiff.removed_done.push(tid);
    }
  }

  // 7. contracts: additive, breaking, prose or unclassified
  const contracts: ContractDiff[] = [];
  const has = (name: string) => existsSync(join(change.dir, name));
  for (const f of changed) {
    const name = basename(f);
    let c: ContractDiff | null = null;
    if (name === "openapi.yaml") c = { file: f, kind: "openapi", ...classifyOpenApi(beforeText(f), afterText(f)) };
    else if (name === "data-model.dbml") c = { file: f, kind: "dbml", ...classifyDbml(beforeText(f), afterText(f)) };
    else if (name === "api-contract.md" || name === "data-model.md") {
      // the machine-readable contract beside the notes decides; the notes alone are prose
      const decided = name === "api-contract.md" ? has("openapi.yaml") : has("data-model.dbml");
      c = decided
        ? { file: f, kind: "prose", class: "none", changes: [`notes changed; ${name === "api-contract.md" ? "openapi.yaml" : "data-model.dbml"} decides what the build must change`] }
        : { file: f, kind: "prose", class: "prose", changes: ["changed (prose: compared by the reviewers, not the CLI)"] };
    }
    if (!c) continue;
    if (c.class === "none" && c.kind !== "prose") c = { ...c, class: "unclassified", changes: ["the text changed with no difference the CLI can classify; the reviewers judge it"] };
    contracts.push(c);
  }

  // 8. the tasks to run again
  const live = tf.tasks.filter((t) => statusOf(t) !== "not_built");
  const analysisRel = rel(p, join(change.dir, "analysis.md"));
  const honorChanged = changed.includes(analysisRel) && JSON.stringify(decisionsToHonor(beforeText(analysisRel) ?? "")) !== JSON.stringify(decisionsToHonor(afterText(analysisRel) ?? ""));
  const readers = new Map(changed.map((f) => [f, readersOf(p, change, f, contracts, honorChanged)]));
  for (const c of contracts) {
    const kindRoles = c.kind === "dbml" || basename(c.file) === "data-model.md" ? DATA_ROLES : API_ROLES;
    c.readers = live.filter((t) => hasRole(t, kindRoles)).map((t) => t.id);
  }
  const rerun = new Set<string>();
  if (d.task && live.some((t) => t.id === d.task)) rerun.add(d.task);
  for (const t of live) {
    if (taskDiff.changed.includes(t.id)) rerun.add(t.id);
    if (list(t.scenarios).some((s) => removed.includes(s) || changedScenarios.includes(s))) rerun.add(t.id);
    if (list(t.specs).some((r) => changedReqs.includes(r))) rerun.add(t.id);
    for (const who of readers.values()) if (who?.(t)) rerun.add(t.id);
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
  // a task in flight would be recorded as rerun while it finishes on the old package: let it settle first
  const busy = live.filter((t) => order.includes(t.id) && t.id !== d.task && ["running", "review", "conflict"].includes(statusOf(t)));
  if (busy.length) refuse(`${busy.map((t) => `${t.id} (${statusOf(t)})`).join(", ")} must run again but ${busy.length > 1 ? "are" : "is"} still in flight: wait for ${busy.map((t) => t.id).join(", ")} to settle, then close`);
  const reset = order.filter((x) => statusOf(live.find((t) => t.id === x) as Task) === "done");

  // 9. one step: the closed record and the new hash together (`approval.push` is kept: the push grant holds); only then
  // the tasks, whose reset may move the Change back to executing, which needs the approval valid
  change = loadChange(p, id);
  const { hash } = computeApprovalHash(p, change, undefined, { version: PACKAGE_VERSION });
  const approval = (change.data.approval ?? {}) as Record<string, unknown>;
  const history = Array.isArray(approval.history) ? (approval.history as unknown[]) : [];
  const at2 = now();
  const entry = { deviation: d.id, previous: String(approval.hash), hash, reason: d.reason, roles: d.roles, files: changed, at: at2 };
  const closed: DeviationRecord = {
    ...d,
    status: "closed",
    closed_at: at2,
    hash,
    changed,
    ...(o.summary?.trim() ? { summary: o.summary.trim() } : {}),
    scenarios: { removed: removed.map((s) => ({ scenario: s, reason: reasons[s] as string })), added, changed: changedScenarios },
    requirements,
    ...(scopeReason ? { scope_reason: scopeReason } : {}),
    contracts,
    tasks: taskDiff,
    rerun: order,
    reset,
  };
  const list2 = loadDeviations(change);
  list2[list2.findIndex((x) => x.id === d.id)] = closed;
  saveDeviations(change, list2);
  change.doc.setIn(["approval", "hash"], hash);
  change.doc.setIn(["approval", "package"], PACKAGE_VERSION);
  change.doc.setIn(["approval", "history"], change.doc.createNode([...history, entry]));
  saveChange(change);

  rerunTasks(p, id, reset, `Deviation ${d.id} (${d.roles.join(", ")}) changed ${changed.join(", ")}; runs again`);
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
  const tasksRel = rel(p, join(change.dir, "tasks.yaml"));
  for (const f of d.files) {
    const abs = join(p.project, f);
    const copy = join(dir, "files", f);
    if (d.before[f] === null) rmSync(abs, { force: true });
    else if (f === tasksRel && existsSync(copy)) writeFileSync(abs, restorePlanned(readFileSync(copy, "utf8"), readText(abs)));
    else if (existsSync(copy)) {
      mkdirSync(dirname(abs), { recursive: true });
      copyFileSync(copy, abs);
    }
  }
  const done: DeviationRecord = { ...d, status: "abandoned", closed_at: now() };
  all[at] = done;
  saveDeviations(change, all);
  if (d.consultation) deviationAbandoned(p, id, d.consultation, d.id);
  return done;
}

/**
 * tasks.yaml put back as approved without losing the progress the CLI recorded while the Deviation was open: the planned
 * fields of each approved task, its runtime fields as they are now, and the tasks the run added meanwhile.
 */
function restorePlanned(approvedText: string, currentText: string | null): string {
  const approvedTasks = parseTasks(approvedText).tasks;
  const current = currentText === null ? [] : parseTasks(currentText).tasks;
  const byId = new Map(current.filter((t) => t && typeof t.id === "string").map((t) => [t.id, t]));
  const out = approvedTasks.map((t) => {
    const now0 = byId.get(t.id);
    const copy: Record<string, unknown> = { ...t };
    if (now0) for (const k of RUNTIME_FIELDS) (k in now0 ? (copy[k] = now0[k]) : delete copy[k]);
    return copy;
  });
  const ids = new Set(approvedTasks.map((t) => t.id));
  for (const t of current) if (t && !ids.has(t.id) && ADDED_ORIGINS.includes(String(t.origin))) out.push(t);
  let top: Record<string, unknown> = {};
  try {
    const data = YAML.parse(currentText ?? approvedText) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) top = data as Record<string, unknown>;
  } catch {
    top = {};
  }
  return YAML.stringify({ ...top, tasks: out });
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
