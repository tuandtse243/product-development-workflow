/**
 * Stable codes of the plan-level warnings of `aidw analyze` (src/plan.ts), and the check of a task's `accept:` list:
 * `accept: [{ warn: <code>, on?: <task id>, scenarios?: <count>, why: <reason> }]` records that the planner saw the warning and states why
 * the plan keeps what it warns about.
 */
export const PLAN_WARNING_CODES = ["one-chain", "depends-without-overlap", "narrow-plan", "large-task", "catch-all-touches"] as const;
export type PlanWarningCode = (typeof PLAN_WARNING_CODES)[number];

export interface Accept {
  warn: string;
  on?: string;
  why: string;
  /** large-task: the task's scenario count when the warning was accepted */
  scenarios?: number;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** The well-formed accept entries of a task (malformed ones are left to `acceptProblems`). */
export function taskAccepts(t: object): Accept[] {
  const acc = (t as { accept?: unknown }).accept;
  if (!Array.isArray(acc)) return [];
  const out: Accept[] = [];
  for (const e of acc as unknown[]) {
    const r = e as Record<string, unknown> | null;
    if (r && typeof r === "object" && typeof r.warn === "string" && typeof r.why === "string" && r.why.trim()) {
      out.push({
        warn: r.warn,
        why: r.why.trim(),
        ...(typeof r.on === "string" ? { on: r.on } : {}),
        ...(isCount(r.scenarios) ? { scenarios: r.scenarios } : {}),
      });
    }
  }
  return out;
}

/** Problems with a task's `accept:` list, each starting with ": " for the caller to prefix with the task. */
export function acceptProblems(t: object, ids: ReadonlySet<string>): string[] {
  const acc = (t as { accept?: unknown }).accept;
  if (acc === undefined) return [];
  if (!Array.isArray(acc)) return [': "accept" must be a list of { warn, on?, why } entries'];
  const out: string[] = [];
  acc.forEach((e: unknown, i: number) => {
    const r = e as Record<string, unknown> | null;
    const at = `: accept #${i + 1}`;
    if (!r || typeof r !== "object" || Array.isArray(r)) return void out.push(`${at} is not a mapping with warn and why`);
    if (typeof r.warn !== "string" || !(PLAN_WARNING_CODES as readonly string[]).includes(r.warn)) {
      out.push(`${at} has unknown warning code "${String(r.warn)}" (expected ${PLAN_WARNING_CODES.join(", ")})`);
    }
    if (typeof r.why !== "string" || !r.why.trim()) out.push(`${at} needs a "why": the reason the plan keeps what the warning names`);
    if (r.on !== undefined && !(typeof r.on === "string" && ids.has(r.on))) out.push(`${at} names unknown task "${String(r.on)}" in "on"`);
    // a pair warning accepted without its other task would cover every pair of the task
    if (r.warn === "depends-without-overlap" && r.on === undefined) out.push(`${at} needs "on": the task this depends_on names`);
    // a large task accepted without its size would stay accepted however much it grew
    if (r.warn === "large-task" && !isCount(r.scenarios)) out.push(`${at} needs "scenarios": the task's scenario count the reason was written for`);
  });
  return out;
}
