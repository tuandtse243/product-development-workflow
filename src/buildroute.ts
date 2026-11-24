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
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
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

/**
 * The route for a Change with `tasks` tasks left; `aidw` is the CLI as the orchestrator should type it, `pluginDir` the
 * plugin directory when it is not installed.
 */
export function buildRoute(id: string, tasks: number, aidw = "aidw", pluginDir?: string): BuildRoute {
  if (tasks > RUNNER_THRESHOLD) {
    // A plugin loaded from a directory is passed on, so the runner's sessions have /aidw:resume and the gate.
    const command = `${aidw} run ${id} --detach --permission-mode auto${pluginDir ? ` -- --plugin-dir ${pluginDir}` : ""}`;
    return {
      mode: "runner",
      tasks,
      command,
      next: `NEXT: start the runner: ${command} (${tasks} tasks, more than ${RUNNER_THRESHOLD}: one fresh session per task; run it with the sandbox disabled, then tell the user how to follow it)`,
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

/** A path compared by what it points at: the real path when it exists, else the resolved one. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export interface DetachedStart {
  kind: "plain" | "other";
  /** the change id named on the command line, if any */
  id?: string;
}

/**
 * For a command that runs `aidw run`: `plain` when it is exactly the detached start the route prints, null when it is
 * not detached, `other` for every other detached form. Plain means: the CLI itself (bare `aidw`, or `<root>/bin/aidw`
 * for one of `roots`, the plugin this CLI belongs to), an optional change id, `--detach`, `--permission-mode auto`,
 * `--max-runs N` (N >= 1), and after `--` at most one `--plugin-dir` that is one of `roots`. Anything else (another
 * binary or plugin, another permission mode, a claude argument, a newline or other shell syntax) is `other`.
 *
 * The gate lets the main session run a `plain` start after approval without asking (D2). That allow also skips the
 * prompt for running it outside the sandbox, so nothing in it may load code the user did not approve.
 */
export function detachedStart(cmd: string, roots: string[]): DetachedStart | null {
  if (!/\s--detach(?:\s|$)/.test(cmd)) return null;
  const other: DetachedStart = { kind: "other" };
  if (/[;&|`<>\n\r'"\\]|\$/.test(cmd)) return other;
  const allowed = new Set(roots.filter(Boolean).map(canonical));
  const isRoot = (dir: string) => isAbsolute(dir) && allowed.has(canonical(dir));
  const words = cmd.trim().split(/\s+/);
  const bin = words[0] ?? "";
  if (words[1] !== "run") return other;
  if (bin !== "aidw" && !(basename(bin) === "aidw" && basename(dirname(bin)) === "bin" && isRoot(dirname(dirname(bin))))) return other;
  const args = words.slice(2);
  const dashdash = args.indexOf("--");
  const own = dashdash >= 0 ? args.slice(0, dashdash) : args;
  const passthrough = dashdash >= 0 ? args.slice(dashdash + 1) : [];
  let id: string | undefined;
  for (let i = 0; i < own.length; i++) {
    const a = own[i] as string;
    if (a === "--detach") continue;
    if (a === "--permission-mode" && own[i + 1] === "auto") i++;
    else if (a === "--max-runs" && /^[1-9]\d*$/.test(own[i + 1] ?? "")) i++;
    else if (i === 0 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a)) id = a;
    else return other;
  }
  if (passthrough.length && !(passthrough.length === 2 && passthrough[0] === "--plugin-dir" && isRoot(passthrough[1] as string))) return other;
  return { kind: "plain", ...(id ? { id } : {}) };
}

/** Whether the plugin at `root` is installed (Claude Code loads it by itself) rather than loaded with --plugin-dir. */
export function installedPlugin(root: string): boolean {
  return canonical(root).split(sep).join("/").includes("/.claude/plugins/");
}
