/**
 * Parallel analysis stages and reviewers (D13): the CLI decides what may run at the same time, from what each
 * piece of work reads and writes, and offers it in one NEXT. The lead (main session) spawns one subagent per
 * piece, all in one message, and reports each back.
 *
 * Two pieces conflict when one reads a file the other writes, or both write the same file: each Artifact is compared
 * by its path in artifacts.yaml, so two sections of analysis.md conflict. Artifacts that are one of a family of files
 * (a path with a placeholder other than <id>) and the parts of decisions.yaml (only `aidw decide` writes it, one call
 * at a time, before the Agents are spawned) are compared by name; every ADR writer shares one key (the next
 * decisions/NNNN number). A gate
 * stage runs alone. At most one piece of browser-driving work runs at a time (the project has one test browser),
 * and at most `parallel.max` of quality.yaml (3 until quality.yaml exists). When reviewers and analysis stages are
 * both ready, the reviewers are offered first.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { loadChange, stateOf, type Change, type State } from "./change.js";
import { loadArtifacts, type ArtifactEntry } from "./artifacts.js";
import { readDecisions, workflowOfChange } from "./decisions.js";
import { OpError } from "./diag.js";
import { stageConsultationsInFlight } from "./consult.js";
import type { Paths } from "./project.js";
import { PLAN_REVIEW, planReviewBlocker } from "./planreview.js";
import { DEFAULT_PARALLEL, parseQuality, qualityFile } from "./quality.js";
import type { Stage, Workflow } from "./workflow.js";
import { BEFORE_AFTER, DEFERRED, owesBeforeAfter } from "./beforeafter.js";
import { owesProgramDesign, PROGRAM_DESIGN_ARTIFACT, programDesignBlocker, ROUND_ARTIFACT, roundAdvice, SYSTEM_DESIGN_ROUND, systemDesignRoundBlocker } from "./programdesign.js";
import { sizeOf } from "./analyze.js";
import { readText } from "./project.js";

/** One piece of work the lead may hand to a subagent. */
export interface Work {
  id: string;
  kind: "review" | "stage";
  reads: string[];
  writes: string[];
  /** drives the project's test browser (screenshots, the running app) */
  browser: boolean;
}

const overlaps = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** One reads what the other writes, or both write the same Artifact. */
export const conflicts = (a: Pick<Work, "reads" | "writes">, b: Pick<Work, "reads" | "writes">): boolean =>
  overlaps(a.reads, b.writes) || overlaps(b.reads, a.writes) || overlaps(a.writes, b.writes);

/** Maps an Artifact name to what is compared: its file, or its name (see the module comment). */
export type KeyOf = (artifact: string) => string;
const byName: KeyOf = (a) => a;

const DECISIONS_PATH = "changes/<id>/decisions.yaml";
const isFamily = (path: string) => /<(?!id>)[^>]+>|NNNN/.test(path);

/** The KeyOf of an Artifact registry: `file:<path>`, or `name:<artifact>` for families, decisions.yaml and unknown names. */
export function keyOfRegistry(registry: Record<string, ArtifactEntry> | null): KeyOf {
  return (a) => {
    const path = registry?.[a]?.path;
    if (typeof path !== "string" || path === DECISIONS_PATH) return `name:${a}`;
    // every ADR writer takes the next decisions/NNNN number: they share one key and never run together
    if (path.startsWith("decisions/NNNN")) return "file:decisions/NNNN";
    return isFamily(path) ? `name:${a}` : `file:${path}`;
  };
}

/** The KeyOf of the plugin's artifacts.yaml (by name when it cannot be read). */
export function pluginKeyOf(pluginRoot: string): KeyOf {
  try {
    return keyOfRegistry(loadArtifacts(pluginRoot));
  } catch {
    return byName;
  }
}

const keyed = <T extends Pick<Work, "reads" | "writes">>(x: T, keyOf: KeyOf): T => ({ ...x, reads: x.reads.map(keyOf), writes: x.writes.map(keyOf) });

/**
 * The group to offer now, from work that is ready (in its order of preference): reviewers when any is ready,
 * otherwise analysis stages; greedy, skipping a piece that conflicts with one already in, a second piece of
 * browser-driving work, and anything past `max`.
 */
export function pickGroup<T extends Work>(ready: T[], max: number): T[] {
  const kind = ready.some((x) => x.kind === "review") ? "review" : "stage";
  const out: T[] = [];
  for (const x of ready) {
    if (out.length >= Math.max(1, max)) break;
    if (x.kind !== kind) continue;
    if (x.browser && out.some((y) => y.browser)) continue;
    if (out.some((y) => conflicts(x, y))) continue;
    out.push(x);
  }
  return out;
}

/** States of the Analysis: a stage covering only these (and the approval gate itself) is an analysis stage. */
const ANALYSIS_STATES: readonly State[] = ["draft", "intake", "analyzing", "awaiting_approval"];
const isApprovalGate = (s: Stage) => s.gate === "approval" || s.gate === "approval-auto";

/** The stages up to the Approval Gate: the ones the lead steps through before the build loop takes over. */
export function analysisStages(w: Workflow): Stage[] {
  return w.stages.filter((s) => isApprovalGate(s) || (s.states.length > 0 && s.states.every((st) => ANALYSIS_STATES.includes(st))));
}

/** The earlier stage that keeps `s` from starting, or undefined when it may start. */
function blocker(stages: Stage[], s: Stage, done: ReadonlySet<string>, keyOf: KeyOf): Stage | undefined {
  const i = stages.indexOf(s);
  const ks = keyed(s, keyOf);
  return stages.slice(0, i).find((e) => !done.has(e.id) && (e.gate !== undefined || s.gate !== undefined || conflicts(keyed(e, keyOf), ks)));
}

/** Analysis stages not done whose inputs are written: no earlier unfinished stage conflicts with them, and no gate stands between. */
export function readyStages(w: Workflow, done: ReadonlySet<string>, keyOf: KeyOf = byName): Stage[] {
  const stages = analysisStages(w);
  return stages.filter((s) => !done.has(s.id) && !blocker(stages, s, done, keyOf));
}

export const STAGES_FILE = "stages.yaml";
const stagesFile = (change: Change) => join(change.dir, STAGES_FILE);

function recordedDone(change: Change): string[] {
  const f = stagesFile(change);
  if (!existsSync(f)) return [];
  try {
    const data = YAML.parse(readFileSync(f, "utf8")) as { done?: unknown } | null;
    return Array.isArray(data?.done) ? data.done.map(String) : [];
  } catch {
    return [];
  }
}

/** The body of a `## ` or `### ` section of a Markdown file, or null when the heading is missing. */
export function sectionBody(text: string, heading: string): string | null {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading.trim());
  if (at < 0) return null;
  // a `###` part ends at the next `##` or `###` heading; a `##` part at the next `##`
  const next = /^###\s/.test(heading.trim()) ? /^#{2,3} / : /^## /;
  const end = lines.findIndex((l, i) => i > at && next.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n");
}

const TEMPLATE_2_PARTS = new Set([`## ${BEFORE_AFTER}`, `### ${DEFERRED}`]);
const filled = (text: string | null) => text !== null && text.trim() !== "" && !text.includes("TODO(aidw)");

/**
 * Is one Artifact of this Change already on disk and filled in? A section of a shared file: its heading is there
 * and its body has text and no TODO(aidw); a part of decisions.yaml: that decision is recorded; a whole file: it
 * exists, has text and no TODO(aidw). null: it cannot be told (a family of files, an unknown Artifact).
 */
function artifactWritten(p: Paths, change: Change, entry: ArtifactEntry | undefined): boolean | null {
  if (!entry || typeof entry.path !== "string" || isFamily(entry.path)) return null;
  if (entry.path === DECISIONS_PATH) {
    const key = String(entry.part ?? "").split(":")[0]?.trim() ?? "";
    return key !== "" && key in readDecisions(change);
  }
  // A Change created before analysis_template 2 has no Before / After or Deferred to architecture to tell by.
  if (typeof entry.part === "string" && TEMPLATE_2_PARTS.has(entry.part) && !owesBeforeAfter(change)) return null;
  // Nor one created before analysis_template 3 a system design round or a Program Design.
  if ((entry.part === `### ${SYSTEM_DESIGN_ROUND}` || entry.path === "changes/<id>/program-design.md") && !owesProgramDesign(change)) return null;
  const file = join(p.aidw, ...entry.path.replace("<id>", change.id).split("/"));
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  return filled(entry.part ? sectionBody(text, entry.part) : text);
}

/**
 * A stage counts as done by its Artifacts (a Change started before stages.yaml existed) when everything it writes
 * that can be told is on disk and filled in, and at least one thing can be told.
 */
function writtenStages(p: Paths, change: Change, stages: Stage[], registry: Record<string, ArtifactEntry> | null): string[] {
  return stages
    .filter((s) => s.gate === undefined && s.writes.length > 0)
    .filter((s) => {
      const known = s.writes.map((a) => artifactWritten(p, change, registry?.[a])).filter((x): x is boolean => x !== null);
      return known.length > 0 && known.every(Boolean);
    })
    .map((s) => s.id);
}

/**
 * Stages done: the ones reported with `aidw stages --done`, every stage before the first one that covers the
 * current state, every stage before a done gate, and (while analyzing, when `p` is given) a stage whose Artifacts
 * are all written. Past the Analysis all of them are done.
 */
export function doneStages(w: Workflow, change: Change, p?: Paths, registry: Record<string, ArtifactEntry> | null = null): Set<string> {
  const stages = analysisStages(w);
  const state = stateOf(change);
  const done = new Set(recordedDone(change).filter((id) => stages.some((s) => s.id === id)));
  const at = state ? stages.findIndex((s) => s.states.includes(state)) : -1;
  if (state && !ANALYSIS_STATES.includes(state)) for (const s of stages) done.add(s.id);
  else if (at > 0) for (const s of stages.slice(0, at)) done.add(s.id);
  // only a Change started before stages.yaml existed (newChange writes it) is caught up from its files: on any other
  // a half-written Artifact of a running stage, or an Agent writing files, must not mark a stage done
  if (p && state === "analyzing" && !existsSync(stagesFile(change))) for (const id of writtenStages(p, change, stages, registry)) done.add(id);
  const lastGate = stages.reduce((n, s, i) => (s.gate !== undefined && done.has(s.id) ? i : n), -1);
  if (lastGate > 0) for (const s of stages.slice(0, lastGate)) done.add(s.id);
  // the review before the gate (D4) is done exactly while its recorded review counts (a changed plan reopens it)
  const review = stages.find((s) => s.writes.includes(PLAN_REVIEW));
  if (p && review && state === "analyzing") {
    let open: string | null;
    try {
      open = planReviewBlocker(p, change, w);
    } catch (e) {
      open = (e as Error).message;
    }
    if (open) done.delete(review.id);
    else done.add(review.id);
  }
  return done;
}

export interface StagesView {
  change: string;
  workflow: string;
  state: string;
  max: number;
  done: string[];
  ready: Stage[];
  /** the ready stages to run now, at the same time */
  group: Stage[];
  /** D3: what the system design round asks, when it is the stage to run now */
  round?: string;
}

/** `parallel.max` of quality.yaml, or the default while quality.yaml is missing or broken. */
function parallelMax(change: Change): number {
  const f = qualityFile(change);
  if (!existsSync(f)) return DEFAULT_PARALLEL.max;
  return parseQuality(readFileSync(f, "utf8"), f).config?.parallel.max ?? DEFAULT_PARALLEL.max;
}

export const stageWork = (s: Stage, keyOf: KeyOf = byName): Work => keyed({ id: s.id, kind: "stage", reads: s.reads, writes: s.writes, browser: s.browser === true }, keyOf);

function registryOf(pluginRoot: string): Record<string, ArtifactEntry> | null {
  try {
    return loadArtifacts(pluginRoot);
  } catch {
    return null;
  }
}

export function stagesView(p: Paths, id: string, pluginRoot: string): StagesView {
  const change = loadChange(p, id);
  const w = workflowOfChange(p, change, pluginRoot);
  const registry = registryOf(pluginRoot);
  const keyOf = keyOfRegistry(registry);
  const done = doneStages(w, change, p, registry);
  const ready = readyStages(w, done, keyOf);
  const max = parallelMax(change);
  const picked = new Set(pickGroup(ready.map((s) => stageWork(s, keyOf)), max).map((x) => x.id));
  return {
    change: id,
    workflow: w.id,
    state: String(change.data.state ?? ""),
    max,
    done: analysisStages(w).filter((s) => done.has(s.id)).map((s) => s.id),
    ready,
    group: ready.filter((s) => picked.has(s.id)),
    ...(ready.some((s) => picked.has(s.id) && isRound(s)) ? { round: roundNote(change) } : {}),
  };
}

const isRound = (s: Stage) => s.writes.includes(ROUND_ARTIFACT);
const isProgramDesign = (s: Stage) => s.writes.includes(PROGRAM_DESIGN_ARTIFACT);
const analysisOf = (change: Change) => readText(join(change.dir, "analysis.md"));
const isSmall = (change: Change) => sizeOf(analysisOf(change)) === "small";

/** D3, Q5: a small Change has no round; otherwise the open Design Questions, or the one question in the chat. */
function roundNote(change: Change): string {
  if (!owesProgramDesign(change)) return "";
  if (isSmall(change)) return "Size: small has no system design round: report the stage done";
  const advice = roundAdvice(analysisOf(change));
  if (!advice.startsWith("no Design Question is open")) return advice;
  // F5: the data model and the API contract are designed before the round, so its summary names them
  const d = readDecisions(change);
  const names = [d["data-model-needed"]?.answer === "design" ? "the data model" : "", ["openapi", "actions"].includes(String(d["api-contract-needed"]?.answer)) ? "the API contract" : ""].filter(Boolean);
  return names.length ? `${advice}; name ${names.join(" and ")} in the summary` : advice;
}

/** Records that the lead finished (or, by a Decision Point, skipped) an analysis stage. */
export function recordStageDone(p: Paths, id: string, stageId: string, pluginRoot: string): void {
  const change = loadChange(p, id);
  const w = workflowOfChange(p, change, pluginRoot);
  const stages = analysisStages(w);
  const s = stages.find((x) => x.id === stageId);
  if (!s) throw new OpError(`workflow "${w.id}" has no analysis stage "${stageId}" (it has: ${stages.map((x) => x.id).join(", ")})`);
  if (s.gate) throw new OpError(`stage "${stageId}" is a gate (${s.gate}): it is passed by \`aidw approve\`, not reported`);
  const registry = registryOf(pluginRoot);
  const done = doneStages(w, change, p, registry);
  if (done.has(stageId)) return;
  const asking = stageConsultationsInFlight(change, stageId);
  if (asking.length) throw new OpError(`stage "${stageId}" has Consultation(s) in flight: ${asking.map((c) => `${c.id} (${c.status})`).join(", ")}; the stage is done after its asker resumed and finished`);
  const b = blocker(stages, s, done, keyOfRegistry(registry));
  if (b) throw new OpError(`stage "${stageId}" is not ready: it waits for ${b.id}`);
  // the review before the gate (D4) is done by its recorded verdict, never by a report
  const open = s.writes.includes(PLAN_REVIEW) ? planReviewBlocker(p, change, w) : null;
  if (open) throw new OpError(`stage "${stageId}" is done when its verdict is recorded (\`aidw plan-review ${id}\`); it still needs ${open}`);
  // D3, I5: the round is done when its answer is recorded, the Program Design when it has its required parts
  if (owesProgramDesign(change) && isRound(s)) {
    const why = systemDesignRoundBlocker(analysisOf(change), isSmall(change));
    if (why) throw new OpError(`stage "${stageId}" is done when the system design round is recorded: ${why}`);
  }
  if (owesProgramDesign(change) && isProgramDesign(s)) {
    const why = programDesignBlocker(p, change, isSmall(change));
    if (why) throw new OpError(`stage "${stageId}" is done when the Program Design has its required parts: ${why}`);
  }
  const all = [...recordedDone(change), stageId];
  writeFileSync(stagesFile(change), YAML.stringify({ done: all }));
}

const label = (s: Stage) => `${s.id} (${s.title})`;

/** The NEXT line for the stages view: one stage, or a group to run in parallel. */
export function stagesNext(v: StagesView): string {
  const report = (what: string) => `\`aidw stages --done ${what} --change ${v.change}\``;
  if (v.group.length === 0) return v.ready.length === 0 && v.done.length ? "NEXT: every analysis stage is done; continue with the next step of the workflow" : "NEXT: no analysis stage is ready";
  if (v.group.length === 1) {
    const s = v.group[0] as Stage;
    if (s.writes.includes(PLAN_REVIEW)) return `NEXT: stage ${label(s)}: run \`aidw plan-review ${v.change} --brief\`, spawn aidw:${s.roles[0] ?? "code-reviewer"} with the brief, then record its verdict with \`aidw plan-review ${v.change}\` (it reports the stage)`;
    const round = v.round ? `; ${v.round}` : "";
    return `NEXT: stage ${label(s)}: roles ${s.roles.join(", ") || "none"}${round}${s.gate ? `; gate ${s.gate}` : `; when it is done run ${report(s.id)}`}`;
  }
  return `NEXT: run these ${v.group.length} stages in parallel, one subagent each, all in one message: ${v.group.map(label).join(", ")}. When each returns, run ${report("<stage>")} for it`;
}
