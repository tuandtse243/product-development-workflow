/**
 * Pre-approval look at the task graph's shape. A graph that is one long `depends_on` chain can never run a
 * parallel wave (slice S8), however disjoint the tasks' `touches` are, so the plan is where that is cheap to
 * fix. Everything here is advice (warnings): a dependency is often real.
 */
import { staticPrefix, touchesOverlap } from "./touches.js";
import type { Task } from "./tasks.js";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export interface PlanShape {
  /** planned tasks (fix tasks added by aidw itself are not part of the plan) */
  tasks: number;
  /** tasks per dependency level: level 0 has no dependencies */
  levels: string[][];
  /** the most tasks that could run side by side */
  width: number;
  /** `B depends on A` pairs whose touches do not overlap: the dependency may be unnecessary */
  independentPairs: { task: string; on: string }[];
  /** tasks whose touches include a catch-all glob: they always run alone */
  catchAll: string[];
  /** risk: high tasks: they always run alone */
  highRisk: string[];
}

const isPlanned = (t: Task) => t.origin === undefined || t.origin === "plan";

export function planShape(all: Task[]): PlanShape {
  const tasks = all.filter(isPlanned);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const level = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0; // a cycle is reported by validate; do not loop here
    seen.add(id);
    const deps = list(byId.get(id)?.depends_on).filter((d) => byId.has(d));
    const l = deps.length ? 1 + Math.max(...deps.map((d) => depth(d, seen))) : 0;
    level.set(id, l);
    return l;
  };
  for (const t of tasks) depth(t.id, new Set());
  const levels: string[][] = [];
  for (const t of tasks) (levels[level.get(t.id) ?? 0] ??= []).push(t.id);

  const independentPairs: { task: string; on: string }[] = [];
  for (const t of tasks) {
    for (const dep of list(t.depends_on)) {
      const a = byId.get(dep);
      if (!a) continue;
      const ta = list(a.touches);
      const tb = list(t.touches);
      if (ta.length && tb.length && !touchesOverlap(ta, tb)) independentPairs.push({ task: t.id, on: dep });
    }
  }
  return {
    tasks: tasks.length,
    levels,
    width: Math.max(0, ...levels.map((l) => l.length)),
    independentPairs,
    catchAll: tasks.filter((t) => list(t.touches).some((g) => staticPrefix(g).length === 0)).map((t) => t.id),
    highRisk: tasks.filter((t) => t.risk === "high").map((t) => t.id),
  };
}

/** One line for the user at the gate: how long the plan is when run in waves. */
export function planSummary(all: Task[]): string {
  const s = planShape(all);
  return `${s.tasks} task(s) in ${s.levels.length} stage(s), widest stage ${s.width}: ${s.levels.map((l) => l.join("+")).join(" -> ")}`;
}

/** Plans smaller than this have nothing worth parallelizing. */
const MIN_TASKS = 4;

/** Advice lines for `aidw analyze`; empty when the plan is fine as it is. */
export function planAdvice(all: Task[]): string[] {
  const s = planShape(all);
  if (s.tasks < MIN_TASKS) return [];
  const out: string[] = [];
  if (s.width === 1) {
    const pairs = s.independentPairs.slice(0, 4).map((p) => `${p.task} after ${p.on}`);
    out.push(
      `the ${s.tasks} tasks form one dependency chain, so none can run side by side (a wave). ` +
        (pairs.length
          ? `Their touches do not overlap for ${pairs.join(", ")}: if the later task does not need the earlier one's output, drop its depends_on. `
          : "") +
        "Slice by vertical feature (API + UI + tests of one behavior) rather than by layer, so slices can be independent.",
    );
  } else if (s.independentPairs.length && s.width < Math.ceil(s.tasks / 2)) {
    const pairs = s.independentPairs.slice(0, 4).map((p) => `${p.task} on ${p.on}`);
    out.push(`the plan runs at most ${s.width} task(s) at once; depends_on without overlapping touches: ${pairs.join(", ")}. Drop each one the later task does not truly need.`);
  }
  if (s.width > 1 && s.width <= 2 && s.tasks >= 6 && !out.length) {
    out.push(`the ${s.tasks} tasks run at most ${s.width} at once (stages: ${s.levels.map((l) => l.join("+")).join(" -> ")}). If a stage is a long single-task chain, check whether each depends_on is a real data dependency, and whether tasks share one big file (they then cannot overlap): slice by file ownership.`);
  }
  // One heavy task is the critical path of its level: in trial-3A T05 had 15 of 48 scenarios and took 454 s while its
  // wave partner took 181 s, so the whole level waited. Splitting it (list / create / edit-delete) lets both halves overlap.
  const planned = all.filter(isPlanned);
  const counts = planned.map((t) => ({ id: t.id, n: list(t.scenarios).length }));
  const total = counts.reduce((n, c) => n + c.n, 0);
  const heavy = counts.filter((c) => total >= 8 && c.n >= 8 && c.n / total >= 0.3);
  if (heavy.length) out.push(`task(s) ${heavy.map((c) => `${c.id} (${c.n} of ${total} scenarios)`).join(", ")} carry a third of the plan: they set the pace of their wave. Split each into slices that touch different files (for example list, create, edit and delete) so the pieces can run side by side.`);
  if (s.catchAll.length) out.push(`task(s) ${s.catchAll.join(", ")} touch "**", so they always run alone; list the folders they really change.`);
  return out;
}
