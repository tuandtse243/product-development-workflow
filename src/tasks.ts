import { createHash } from "node:crypto";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { typeProblem } from "./commit.js";

/**
 * pending -> running -> review -> done        (implement, checkpoint, independent review)
 *              ^   \-> failed --/             (checkpoint or review asked for fixes; retried)
 *              \------ escalated              (attempts exhausted; needs the user)
 */
export const TASK_STATUSES = ["pending", "running", "review", "done", "failed", "blocked", "escalated"] as const;

/** Fields the orchestrator updates during execution; excluded from the approval hash. */
export const RUNTIME_FIELDS = [
  "status",
  "attempts",
  "evidence",
  "started_at",
  "finished_at",
  "notes",
  "base",
  // S8 parallel waves: the task's git worktree and branch, its merge time, and the fallback to sequential
  "worktree",
  "branch",
  "merged_at",
  "sequential",
  // re-approval keeps done work: the plan the task was finished against
  "plan_sha",
  // the one triage of a task that ran out of attempts: { cause, at }
  "triage",
] as const;

export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Tasks the workflow adds after approval: converge gaps (S5) and quality-layer fixes (S4). They are not
 * part of the approved plan, so they are excluded from the approval hash; their verify commands come
 * from approved sources (quality.yaml layers, spec scenarios).
 */
export const ADDED_ORIGINS: readonly string[] = ["converge", "quality", "integration"];

export interface Task {
  id: string;
  title?: string;
  role?: string;
  depends_on?: string[];
  touches?: string[];
  verify?: string[];
  status?: string;
  origin?: string;
  [k: string]: unknown;
}

export function parseTasks(text: string): { tasks: Task[]; error?: string } {
  let data: unknown;
  try {
    data = YAML.parse(text);
  } catch (e) {
    return { tasks: [], error: `not valid YAML: ${(e as Error).message}` };
  }
  const list = (data as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(list)) return { tasks: [], error: 'expected a top-level "tasks:" list' };
  return { tasks: list as Task[] };
}

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Structural validation of tasks.yaml: unique ids, known dependencies, no cycles, required contract fields. */
export function validateTasksText(text: string, file: string): Diags {
  const d = new Diags();
  const { tasks, error } = parseTasks(text);
  if (error) {
    d.error(file, error);
    return d;
  }
  if (tasks.length === 0) d.error(file, "tasks list is empty");

  const ids = new Set<string>();
  for (const [i, t] of tasks.entries()) {
    const where = typeof t?.id === "string" ? `task ${t.id}` : `task #${i + 1}`;
    if (!t || typeof t !== "object") {
      d.error(file, `${where} is not a mapping`);
      continue;
    }
    if (typeof t.id !== "string" || !t.id) d.error(file, `${where} has no id`);
    else if (ids.has(t.id)) d.error(file, `duplicate task id "${t.id}"`);
    else ids.add(t.id);
    if (typeof t.title !== "string" || !t.title) d.error(file, `${where} has no title`);
    if (typeof t.role !== "string" || !t.role) d.error(file, `${where} has no role`);
    if (!isStrList(t.touches) || t.touches.length === 0) d.error(file, `${where} needs a non-empty "touches" list of file globs`);
    if (!isStrList(t.verify) || t.verify.length === 0) d.error(file, `${where} needs a non-empty "verify" list`);
    if (t.depends_on !== undefined && !isStrList(t.depends_on)) d.error(file, `${where}: "depends_on" must be a list of task ids`);
    if (t.skills !== undefined && !isStrList(t.skills)) d.error(file, `${where}: "skills" must be a list of vendored skill names`);
    if (t.removes_tests !== undefined && typeof t.removes_tests !== "boolean") d.error(file, `${where}: "removes_tests" must be true or false`);
    if (t.max_attempts !== undefined && !(Number.isInteger(t.max_attempts) && Number(t.max_attempts) >= 1)) {
      d.error(file, `${where}: "max_attempts" must be a positive integer`);
    }
    if (t.scope !== undefined && !(typeof t.scope === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.scope))) d.error(file, `${where}: "scope" must be a kebab-case capability name (the scope of the commit)`);
    const tp = typeProblem(t);
    if (tp) d.error(file, `${where} ${tp}`);
    if (t.risk !== undefined && t.risk !== "normal" && t.risk !== "high") d.error(file, `${where}: "risk" must be normal or high`);
    if (t.status !== undefined && !(TASK_STATUSES as readonly string[]).includes(String(t.status))) {
      d.error(file, `${where}: unknown status "${String(t.status)}" (expected ${TASK_STATUSES.join(", ")})`);
    }
  }

  for (const t of tasks) {
    for (const dep of isStrList(t?.depends_on) ? t.depends_on : []) {
      if (!ids.has(dep)) d.error(file, `task ${t.id} depends on unknown task "${dep}"`);
      if (dep === t.id) d.error(file, `task ${t.id} depends on itself`);
    }
  }

  const cycle = findCycle(tasks);
  if (cycle) d.error(file, `dependency cycle: ${cycle.join(" -> ")}`);
  return d;
}

function findCycle(tasks: Task[]): string[] | null {
  const deps = new Map<string, string[]>();
  for (const t of tasks) if (typeof t?.id === "string") deps.set(t.id, isStrList(t.depends_on) ? t.depends_on : []);
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue;
      const c = visit(dep);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of deps.keys()) {
    const c = visit(id);
    if (c) return c;
  }
  return null;
}

/**
 * Canonical form of the approved plan: runtime fields are dropped and tasks added by
 * converge (origin: converge) are excluded, so execution progress does not count as drift.
 */
export function canonicalTasks(text: string): string {
  const { tasks, error } = parseTasks(text);
  if (error) return text.replace(/\r\n?/g, "\n");
  const planned = tasks
    .filter((t) => !ADDED_ORIGINS.includes(String(t?.origin)))
    .map((t) => {
      const copy: Record<string, unknown> = { ...t };
      for (const f of RUNTIME_FIELDS) delete copy[f];
      return copy;
    });
  return stableStringify(planned);
}

/** Hash of a task's planned fields (everything the user approved about it), to tell an edited task from a finished one. */
export function planSha(t: Task): string {
  const copy: Record<string, unknown> = { ...t };
  for (const f of RUNTIME_FIELDS) delete copy[f];
  return createHash("sha256").update(stableStringify(copy)).digest("hex").slice(0, 16);
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
