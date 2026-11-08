/**
 * `aidw stop-failure`: StopFailure hook (blueprint section 13). When a turn ends on an API error
 * (rate limit, overload, ...), every change that is actively running is paused with the error as
 * the reason, so `aidw status` shows why work stopped and `/aidw:resume` knows where to continue.
 * Never blocks and never throws: the hook output is ignored by Claude Code.
 */
import { listChangeIds, loadChange, stateOf, TRANSITIONS } from "./change.js";
import { transition } from "./ops.js";
import { findProject, pathsFor } from "./project.js";

export function runStopFailure(stdin: string, env: NodeJS.ProcessEnv): string[] {
  let input: { cwd?: string; error?: unknown; error_type?: unknown } = {};
  try {
    input = JSON.parse(stdin) as typeof input;
  } catch {
    // no input: still pause, with an unknown reason
  }
  const project = findProject({ cwd: input.cwd ?? process.cwd(), env });
  if (!project) return [];
  const p = pathsFor(project);
  const reason = String(input.error ?? input.error_type ?? "stop_failure").slice(0, 200);
  const paused: string[] = [];
  for (const id of listChangeIds(p)) {
    try {
      const state = stateOf(loadChange(p, id));
      if (state && TRANSITIONS[state].includes("paused")) {
        transition(p, id, "paused", { reason });
        paused.push(id);
      }
    } catch {
      // a change that cannot be paused (e.g. drift) is left as it is
    }
  }
  return paused;
}
