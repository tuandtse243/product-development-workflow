/**
 * Where an approved Change is built (plan D2, ADR-0003): the CLI decides, from the number of tasks left, whether the
 * main session builds it itself (`/aidw:run`) or starts the detached runner, so `/aidw:start` carries on from the
 * Approval Gate into the build without the user typing another command.
 *
 * Up to RUNNER_THRESHOLD tasks a session build is cheap enough; beyond it the runner's fresh session per task costs
 * about half the tokens (trial-3A against trial-3C). The runner's sessions run in auto mode: after the gate the run
 * never asks the user (ADR-0014).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** The route for a Change with `tasks` tasks left; `aidw` is the CLI as the orchestrator should type it. */
export function buildRoute(id: string, tasks: number, aidw = "aidw"): BuildRoute {
  if (tasks > RUNNER_THRESHOLD) {
    const command = `${aidw} run ${id} --detach --permission-mode auto`;
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

/**
 * For a command that runs `aidw run`: `plain` when it is the detached start the route prints (an optional change id,
 * `--detach`, `--permission-mode auto`, `--max-runs N`, and only `--plugin-dir <dir>` after `--`), `other` when it is
 * detached with anything else (another binary, permission mode, claude argument, or chained), null when not detached.
 * The gate lets the main session run a `plain` start after approval without asking (D2): it is the step the user
 * approved, and nothing in it widens what the runner's sessions may do.
 */
export function detachedStart(cmd: string): "plain" | "other" | null {
  if (!/\s--detach(?:\s|$)/.test(cmd)) return null;
  if (/[;&|`<>]|\$\(/.test(cmd)) return "other";
  const words = cmd.trim().split(/\s+/);
  const at = words.findIndex((w, i) => /^["']?(?:\S*\/)?aidw["']?$/.test(w) && words[i + 1] === "run");
  if (at !== 0) return "other";
  const args = words.slice(at + 2);
  const dashdash = args.indexOf("--");
  const own = dashdash >= 0 ? args.slice(0, dashdash) : args;
  const passthrough = dashdash >= 0 ? args.slice(dashdash + 1) : [];
  for (let i = 0; i < own.length; i++) {
    const a = own[i] as string;
    if (a === "--detach") continue;
    if (a === "--permission-mode" && own[i + 1] === "auto") i++;
    else if (a === "--max-runs" && /^\d+$/.test(own[i + 1] ?? "")) i++;
    else if (i === 0 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a)) continue;
    else return "other";
  }
  for (let i = 0; i < passthrough.length; i += 2) {
    if (passthrough[i] !== "--plugin-dir" || !passthrough[i + 1] || passthrough[i + 1]?.startsWith("-")) return "other";
  }
  return "plain";
}
