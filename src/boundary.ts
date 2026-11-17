import { join } from "node:path";
import { loadChange } from "./change.js";
import { touchesDatabase } from "./dbpaths.js";
import { readText, walkFiles, type Paths } from "./project.js";
import { parseTasks } from "./tasks.js";
import { loadWorkflow, type Boundary } from "./workflow.js";

/** How the plan of a Change exceeds the boundary of an automatically approved Workflow; empty when it stays inside. */
export function boundaryExceeded(p: Paths, id: string, b: Boundary): string[] {
  const change = loadChange(p, id);
  const tasks = parseTasks(readText(join(change.dir, "tasks.yaml")) ?? "").tasks.filter((t) => t.origin === undefined || t.origin === "plan");
  const out: string[] = [];
  if (tasks.length > b.max_tasks) out.push(`the plan has ${tasks.length} tasks (at most ${b.max_tasks})`);
  if (!b.migrations) {
    const m = tasks.filter((t) => touchesDatabase((Array.isArray(t.touches) ? t.touches : []).map(String)));
    if (m.length) out.push(`${m.map((t) => t.id).join(", ")} change the database schema or a migration`);
  }
  if (!b.spec_changes) {
    const specs = walkFiles(join(change.dir, "specs")).filter((f) => f.endsWith("spec.md"));
    if (specs.length) out.push(`it changes behavior written in a spec (${specs.length} delta spec file(s))`);
  }
  return out;
}

/** The approval-auto boundary of the Workflow a Change runs under, or null when that Workflow has none. */
export function boundaryOf(pluginRoot: string, workflow: string): Boundary | null {
  const w = loadWorkflow(pluginRoot, workflow);
  return w?.stages.find((s) => s.gate === "approval-auto")?.boundary ?? null;
}
