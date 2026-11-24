/**
 * Where an approved Change is built (plan D2, ADR-0003): the CLI decides, from the number of tasks left, whether the
 * main session builds it itself (`/aidw:run`) or starts the detached runner, so `/aidw:start` carries on from the
 * Approval Gate into the build without the user typing another command.
 *
 * Up to RUNNER_THRESHOLD tasks a session build is cheap enough; beyond it the runner's fresh session per task costs
 * about half the tokens (trial-3A against trial-3C). The runner's sessions run in auto mode: after the gate the run
 * never asks the user (ADR-0014).
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { loadChange } from "./change.js";
import type { Paths } from "./project.js";
import { parseTasks } from "./tasks.js";

/** More tasks than this go to the detached runner; this many or fewer are built in the session. */
export const RUNNER_THRESHOLD = 3;

export interface BuildRoute {
  mode: "runner" | "session";
  /** tasks not done yet */
  tasks: number;
  /** the exact command that starts the runner (mode runner only) */
  command?: string;
  /** the `NEXT:` line the orchestrator follows */
  next: string;
}

/** The exact command that starts the detached runner for a Change: what the route prints and the gate compares. */
export function runnerCommand(id: string, aidw: string, pluginDir?: string): string {
  // A plugin loaded from a directory is passed on, so the runner's sessions have /aidw:resume and the gate.
  return `${aidw} run ${id} --detach --permission-mode auto${pluginDir ? ` -- --plugin-dir ${pluginDir}` : ""}`;
}

/**
 * The route for a Change with `tasks` tasks left; `aidw` is the CLI as the orchestrator should type it, `pluginDir` the
 * plugin directory when aidw is loaded from a folder rather than installed. Only the start of an installed plugin is
 * allowed by the gate without asking; from a folder the user confirms it at a prompt.
 */
export function buildRoute(id: string, tasks: number, aidw = "aidw", pluginDir?: string): BuildRoute {
  if (tasks > RUNNER_THRESHOLD) {
    const command = runnerCommand(id, aidw, pluginDir);
    const asks = pluginDir ? "; the start asks the user to confirm, because aidw is loaded from a folder" : "";
    return {
      mode: "runner",
      tasks,
      command,
      next: `NEXT: start the runner: ${command} (${tasks} tasks, more than ${RUNNER_THRESHOLD}: one fresh session per task; run exactly this, with the sandbox disabled${asks}; then tell the user how to follow it)`,
    };
  }
  return {
    mode: "session",
    tasks,
    next: `NEXT: build here: follow the /aidw:run steps for ${id} (${tasks} task${tasks === 1 ? "" : "s"}, ${RUNNER_THRESHOLD} or fewer)`,
  };
}

/** Tasks of the Change that are not done (an unreadable task list counts as none). */
export function tasksLeft(p: Paths, id: string): number {
  try {
    const { tasks } = parseTasks(readFileSync(join(loadChange(p, id).dir, "tasks.yaml"), "utf8"));
    return tasks.filter((t) => t.status !== "done").length;
  } catch {
    return 0;
  }
}

function inside(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

/**
 * Whether the gate may start the runner of the plugin at `root` without asking: the plugin is installed (under a
 * `.claude/plugins/` directory) and lies outside the project. A plugin loaded from a folder sits in a tree the session
 * may write, so what its start runs could be changed under it; that start asks the user. Only the plugin root, which
 * comes from the hook's own environment, is resolved here; nothing the command says is.
 */
export function installedOutside(root: string, project: string): boolean {
  let real: string;
  let proj: string;
  try {
    real = realpathSync(root);
    proj = realpathSync(project);
  } catch {
    return false;
  }
  return real.split(sep).join("/").includes("/.claude/plugins/") && !inside(proj, real);
}
