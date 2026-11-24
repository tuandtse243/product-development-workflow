/**
 * Parallel analysis stages and reviewers (D13): the CLI decides what may run at the same time, from what each
 * piece of work reads and writes, and offers it in one NEXT. The lead (main session) spawns one subagent per
 * piece, all in one message, and reports each back.
 *
 * Two pieces conflict when one reads an Artifact the other writes, or both write the same Artifact. A gate
 * stage runs alone. At most one piece of browser-driving work runs at a time (the project has one test browser),
 * and at most `parallel.max` of quality.yaml (3 until quality.yaml exists). When reviewers and analysis stages are
 * both ready, the reviewers are offered first.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { loadChange, stateOf, type Change, type State } from "./change.js";
import { workflowOfChange } from "./decisions.js";
import { OpError } from "./diag.js";
import type { Paths } from "./project.js";
import { DEFAULT_PARALLEL, parseQuality, qualityFile } from "./quality.js";
import type { Stage, Workflow } from "./workflow.js";

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
const ANALYSIS_STATES: readonly State[] = ["draft", "intake", "analyzing", "awaiting_scope_approval", "awaiting_approval"];
const isApprovalGate = (s: Stage) => s.gate === "approval" || s.gate === "approval-auto";

/** The stages up to the Approval Gate: the ones the lead steps through before the build loop takes over. */
export function analysisStages(w: Workflow): Stage[] {
  return w.stages.filter((s) => isApprovalGate(s) || (s.states.length > 0 && s.states.every((st) => ANALYSIS_STATES.includes(st))));
}

/** The earlier stage that keeps `s` from starting, or undefined when it may start. */
function blocker(stages: Stage[], s: Stage, done: ReadonlySet<string>): Stage | undefined {
  const i = stages.indexOf(s);
  return stages.slice(0, i).find((e) => !done.has(e.id) && (e.gate !== undefined || s.gate !== undefined || conflicts(e, s)));
}

/** Analysis stages not done whose inputs are written: no earlier unfinished stage conflicts with them, and no gate stands between. */
export function readyStages(w: Workflow, done: ReadonlySet<string>): Stage[] {
  const stages = analysisStages(w);
  return stages.filter((s) => !done.has(s.id) && !blocker(stages, s, done));
}

const STAGES_FILE = "stages.yaml";
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

/**
 * Stages done: the ones reported with `aidw stages --done`, every stage before the first one that covers the
 * current state, a passed scope gate, and every stage before a done gate. Past the Analysis all of them are done.
 */
export function doneStages(w: Workflow, change: Change): Set<string> {
  const stages = analysisStages(w);
  const state = stateOf(change);
  const done = new Set(recordedDone(change).filter((id) => stages.some((s) => s.id === id)));
  const at = state ? stages.findIndex((s) => s.states.includes(state)) : -1;
  if (state && !ANALYSIS_STATES.includes(state)) for (const s of stages) done.add(s.id);
  else if (at > 0) for (const s of stages.slice(0, at)) done.add(s.id);
  for (const s of stages) if (s.gate === "scope-approval" && change.data.scope_approval) done.add(s.id);
  const lastGate = stages.reduce((n, s, i) => (s.gate !== undefined && done.has(s.id) ? i : n), -1);
  if (lastGate > 0) for (const s of stages.slice(0, lastGate)) done.add(s.id);
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
}

/** `parallel.max` of quality.yaml, or the default while quality.yaml is missing or broken. */
function parallelMax(change: Change): number {
  const f = qualityFile(change);
  if (!existsSync(f)) return DEFAULT_PARALLEL.max;
  return parseQuality(readFileSync(f, "utf8"), f).config?.parallel.max ?? DEFAULT_PARALLEL.max;
}

export const stageWork = (s: Stage): Work => ({ id: s.id, kind: "stage", reads: s.reads, writes: s.writes, browser: s.browser === true });

export function stagesView(p: Paths, id: string, pluginRoot: string): StagesView {
  const change = loadChange(p, id);
  const w = workflowOfChange(p, change, pluginRoot);
  const done = doneStages(w, change);
  const ready = readyStages(w, done);
  const max = parallelMax(change);
  const picked = new Set(pickGroup(ready.map(stageWork), max).map((x) => x.id));
  return {
    change: id,
    workflow: w.id,
    state: String(change.data.state ?? ""),
    max,
    done: analysisStages(w).filter((s) => done.has(s.id)).map((s) => s.id),
    ready,
    group: ready.filter((s) => picked.has(s.id)),
  };
}

/** Records that the lead finished (or, by a Decision Point, skipped) an analysis stage. */
export function recordStageDone(p: Paths, id: string, stageId: string, pluginRoot: string): void {
  const change = loadChange(p, id);
  const w = workflowOfChange(p, change, pluginRoot);
  const stages = analysisStages(w);
  const s = stages.find((x) => x.id === stageId);
  if (!s) throw new OpError(`workflow "${w.id}" has no analysis stage "${stageId}" (it has: ${stages.map((x) => x.id).join(", ")})`);
  if (s.gate) throw new OpError(`stage "${stageId}" is a gate (${s.gate}): it is passed by \`aidw approve\`, not reported`);
  const done = doneStages(w, change);
  if (done.has(stageId)) return;
  const b = blocker(stages, s, done);
  if (b) throw new OpError(`stage "${stageId}" is not ready: it waits for ${b.id}`);
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
    return `NEXT: stage ${label(s)}: roles ${s.roles.join(", ") || "none"}${s.gate ? `; gate ${s.gate}` : `; when it is done run ${report(s.id)}`}`;
  }
  return `NEXT: run these ${v.group.length} stages in parallel, one subagent each, all in one message: ${v.group.map(label).join(", ")}. When each returns, run ${report("<stage>")} for it`;
}
