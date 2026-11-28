/**
 * Pre-approval look at the task graph's shape. A graph that is one long `depends_on` chain can never run a
 * parallel wave (slice S8), however disjoint the tasks' `touches` are, so the plan is where that is cheap to
 * fix. Everything here is advice (warnings): a dependency is often real.
 */
import { drivesBrowser, mustRunAlone, planWave } from "./parallel.js";
import { staticPrefix, touchesOverlap } from "./touches.js";
import { taskAccepts, type PlanWarningCode } from "./plancodes.js";
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

/** A task (and, for a pair, the task it depends on) a warning is about; the unit an `accept:` entry matches. */
export interface WarnRef {
  task: string;
  on?: string;
}

/** One plan warning: its stable code, what it is about and its text for a subset of those refs. */
export interface PlanWarning {
  code: PlanWarningCode;
  refs: WarnRef[];
  /** the text for those refs; `accepted` leaves out the advice, which an accepted warning does not follow */
  text: (refs: WarnRef[], accepted?: boolean) => string;
  /** large-task: each task's scenario count, which an accept entry pins */
  scenarios?: Map<string, number>;
}

/** The plan warnings with their codes; empty when the plan is fine as it is. */
export function planWarnings(all: Task[]): PlanWarning[] {
  const s = planShape(all);
  if (s.tasks < MIN_TASKS) return [];
  const out: PlanWarning[] = [];
  const pairRefs: WarnRef[] = s.independentPairs.map((p) => ({ task: p.task, on: p.on }));
  if (s.width === 1) {
    out.push({
      code: "one-chain",
      refs: pairRefs,
      text: (refs, accepted) => {
        const pairs = refs.slice(0, 4).map((p) => `${p.task} after ${p.on}`);
        const head = `the ${s.tasks} tasks form one dependency chain, so none can run side by side (a wave)`;
        if (accepted) return pairs.length ? `${head}. Their touches do not overlap for ${pairs.join(", ")}` : head;
        return (
          `${head}. ` +
          (pairs.length
            ? `Their touches do not overlap for ${pairs.join(", ")}: if the later task does not need the earlier one's output, drop its depends_on. `
            : "") +
          "Slice by vertical feature (API + UI + tests of one behavior) rather than by layer, so slices can be independent."
        );
      },
    });
  } else if (s.independentPairs.length && s.width < Math.ceil(s.tasks / 2)) {
    out.push({
      code: "depends-without-overlap",
      refs: pairRefs,
      text: (refs, accepted) =>
        `the plan runs at most ${s.width} task(s) at once; depends_on without overlapping touches: ${refs.slice(0, 4).map((p) => `${p.task} on ${p.on}`).join(", ")}` +
        (accepted ? "" : ". Drop each one the later task does not truly need."),
    });
  }
  if (s.width > 1 && s.width <= 2 && s.tasks >= 6 && !out.length) {
    out.push({
      code: "narrow-plan",
      refs: [],
      text: (_refs, accepted) => `the ${s.tasks} tasks run at most ${s.width} at once (stages: ${s.levels.map((l) => l.join("+")).join(" -> ")})${accepted ? "" : "."}` + (accepted ? "" : ` If a stage is a long single-task chain, check whether each depends_on is a real data dependency, and whether tasks share one big file (they then cannot overlap): slice by file ownership.`),
    });
  }
  // One heavy task is the critical path of its level: in trial-3A T05 had 15 of 48 scenarios and took 454 s while its
  // wave partner took 181 s, so the whole level waited. Splitting it (list / create / edit-delete) lets both halves overlap.
  const planned = all.filter(isPlanned);
  const counts = planned.map((t) => ({ id: t.id, n: list(t.scenarios).length }));
  const total = counts.reduce((n, c) => n + c.n, 0);
  const heavy = counts.filter((c) => total >= 8 && c.n >= 8 && c.n / total >= 0.3);
  if (heavy.length) {
    out.push({
      code: "large-task",
      refs: heavy.map((c) => ({ task: c.id })),
      scenarios: new Map(heavy.map((c) => [c.id, c.n])),
      text: (refs, accepted) =>
        `task(s) ${heavy.filter((c) => refs.some((r) => r.task === c.id)).map((c) => `${c.id} (${c.n} of ${total} scenarios)`).join(", ")} carry a third of the plan: they set the pace of their wave` +
        (accepted ? "" : ". Split each into slices that touch different files (for example list, create, edit and delete) so the pieces can run side by side."),
    });
  }
  if (s.catchAll.length) {
    out.push({
      code: "catch-all-touches",
      refs: s.catchAll.map((id) => ({ task: id })),
      text: (refs, accepted) => `task(s) ${refs.map((r) => r.task).join(", ")} touch "**", so they always run alone` + (accepted ? "" : "; list the folders they really change."),
    });
  }
  return out;
}

/** Advice lines for `aidw analyze`; empty when the plan is fine as it is. */
export function planAdvice(all: Task[]): string[] {
  return planWarnings(all).map((w) => w.text(w.refs));
}

export interface PlanAdviceResult {
  /** warnings nobody accepted */
  warnings: string[];
  /** `accepted: <warning>: <why>` for what a task's accept: entry covers */
  accepted: string[];
  /** accept entries that match no current warning */
  stale: string[];
}

/** Plan warnings split by the tasks' `accept:` entries: still a warning, accepted with its reason, or a stale entry. */
export function planAdviceAccepted(all: Task[]): PlanAdviceResult {
  const warnings: PlanWarning[] = planWarnings(all);
  const entries = all.filter(isPlanned).flatMap((t) => taskAccepts(t).map((a) => ({ task: t.id, ...a })));
  const used = new Set<(typeof entries)[number]>();
  const res: PlanAdviceResult = { warnings: [], accepted: [], stale: [] };
  const covers = (e: (typeof entries)[number], r: WarnRef) => e.task === r.task && (e.on === undefined || e.on === r.on);
  for (const w of warnings) {
    const mine = entries.filter((e) => e.warn === w.code);
    if (!w.refs.length) {
      if (mine.length) {
        mine.forEach((e) => used.add(e));
        res.accepted.push(`accepted: ${w.text([], true)}: ${mine.map((e) => e.why).join("; ")}`);
      } else res.warnings.push(w.text([]));
      continue;
    }
    const rest: WarnRef[] = [];
    const accepted: WarnRef[] = [];
    const whys: string[] = [];
    const grew: string[] = [];
    for (const r of w.refs) {
      const hit = mine.filter((e) => covers(e, r));
      const now = w.scenarios?.get(r.task);
      // an accept pins the size it was written for: a task that grew since is a warning again
      const outgrown = now !== undefined ? hit.filter((e) => e.scenarios !== undefined && now > e.scenarios) : [];
      if (outgrown.length) {
        hit.forEach((e) => used.add(e));
        rest.push(r);
        grew.push(`${r.task} grew from ${Math.max(...outgrown.map((e) => e.scenarios ?? 0))} to ${now} scenarios since it was accepted; update the accept only if its reason still holds`);
      } else if (!hit.length) rest.push(r);
      else {
        accepted.push(r);
        hit.forEach((e) => {
          used.add(e);
          if (!whys.includes(e.why)) whys.push(e.why);
        });
      }
    }
    if (accepted.length) res.accepted.push(`accepted: ${w.text(accepted, true)}: ${whys.join("; ")}`);
    if (rest.length) res.warnings.push(w.text(rest) + (grew.length ? ` (${grew.join("; ")})` : ""));
  }
  for (const e of entries) {
    if (!used.has(e)) res.stale.push(`accept on ${e.task} matches no warning (${e.warn}${e.on ? ` on ${e.on}` : ""}): remove it`);
  }
  return res;
}

const aloneWhy = (t: Task) => (t.risk === "high" ? "risk high" : t.sequential === true ? "sequential" : 'touches "**"');

/**
 * INFO lines for tasks the dependency graph lets run together but a wave cannot: simulates `planWave` over the
 * planned tasks (each wave done before the next) and names why each ready task was left for a later wave. Advice
 * only: it never changes when tasks run. Nothing at `max` 1, where every task is sequential by choice.
 */
export function planInfo(all: Task[], max: number): string[] {
  if (max < 2) return [];
  const sim = all.filter(isPlanned).map((t) => ({ ...t, status: "pending" }) as Task);
  const out: string[] = [];
  for (;;) {
    const done = new Set(sim.filter((t) => t.status === "done").map((t) => t.id));
    const ready = sim.filter((t) => t.status === "pending" && list(t.depends_on).every((d) => done.has(d)));
    const wave = planWave(sim, max);
    if (!wave.length) break;
    const inWave = new Set(wave.map((t) => t.id));
    const left = ready.filter((t) => !inWave.has(t.id));
    const first = wave[0] as Task;
    if (left.length && mustRunAlone(first)) {
      out.push(`${first.id} is ${aloneWhy(first)}: it runs alone, so ${first.id} and ${left.map((t) => t.id).join(", ")} run one after the other`);
    } else {
      const groups = new Map<string, string[]>();
      const add = (key: string, id: string) => groups.set(key, [...(groups.get(key) ?? []), id]);
      for (const t of left) {
        const other = wave.find((w) => touchesOverlap(list(w.touches), list(t.touches)));
        const browser = wave.find(drivesBrowser);
        if (mustRunAlone(t)) out.push(`${t.id} is ${aloneWhy(t)}: it runs alone, so ${t.id} and ${wave.map((w) => w.id).join(", ")} run one after the other`);
        else if (other) add(`for ${other.id}: they touch the same files`, t.id);
        else if (drivesBrowser(t) && browser) add(`for ${browser.id}: both drive the browser`, t.id);
        else add(`for the next wave: parallel.max is ${max}`, t.id);
      }
      for (const [why, ids] of groups) out.push(`${ids.join(", ")} ${ids.length > 1 ? "wait" : "waits"} ${why}`);
    }
    for (const t of sim) if (inWave.has(t.id)) t.status = "done";
  }
  return out;
}
