/**
 * `aidw backstop`: Stop-hook safety net (blueprint section 12, spike evidence c5).
 *
 * Shell commands can write files in ways no pattern catches (python -c, node -e, ...).
 * While the gate is closed, any working-tree change outside .aidw/ that was not already
 * present when the change was created is surfaced before the agent finishes its turn.
 * It never reverts anything: files may belong to the user.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateState } from "./gate.js";
import { AIDW_DIR, findProject, pathsFor, type Paths } from "./project.js";

export interface StopInput {
  cwd?: string;
  stop_hook_active?: boolean;
}

/** Paths with uncommitted changes (tracked or untracked), or null when git is unavailable. */
export function gitDirtyPaths(project: string): string[] | null {
  try {
    const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const paths: string[] = [];
    const entries = out.split("\0").filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] as string;
      const status = e.slice(0, 2);
      paths.push(e.slice(3));
      if (status.startsWith("R") || status.startsWith("C")) i++; // skip the rename source
    }
    return paths;
  } catch {
    return null;
  }
}

const baselineFile = (p: Paths) => join(p.run, "baseline.json");

/** Records pre-existing dirty paths so the backstop never blames the agent for them. */
export function recordBaseline(p: Paths, dirty: string[] | null = gitDirtyPaths(p.project)): void {
  if (dirty === null) return;
  mkdirSync(p.run, { recursive: true });
  const previous = readBaseline(p);
  const merged = [...new Set([...previous, ...dirty.filter((f) => !isAidw(f))])].sort();
  writeFileSync(baselineFile(p), `${JSON.stringify({ paths: merged }, null, 2)}\n`);
}

function readBaseline(p: Paths): string[] {
  const f = baselineFile(p);
  if (!existsSync(f)) return [];
  try {
    const data = JSON.parse(readFileSync(f, "utf8")) as { paths?: unknown };
    return Array.isArray(data.paths) ? data.paths.map(String) : [];
  } catch {
    return [];
  }
}

const isAidw = (f: string) => f === AIDW_DIR || f.startsWith(`${AIDW_DIR}/`);

/** Pure decision: which dirty paths are unexpected while the gate is closed. */
export function unexpectedChanges(dirty: string[], baseline: string[]): string[] {
  const base = new Set(baseline);
  return dirty.filter((f) => !isAidw(f) && !base.has(f)).sort();
}

export function runBackstop(stdin: string, env: NodeJS.ProcessEnv, dirtyProvider = gitDirtyPaths): string {
  let input: StopInput = {};
  try {
    input = JSON.parse(stdin || "{}") as StopInput;
  } catch {
    return "";
  }
  const project = findProject({ cwd: input.cwd ?? process.cwd(), env });
  if (!project) return "";
  const p = pathsFor(project);
  if (gateState(p).open) return ""; // in-scope checks against task `touches` arrive with the orchestrator (S3)

  const dirty = dirtyProvider(project);
  if (!dirty) return "";
  const unexpected = unexpectedChanges(dirty, readBaseline(p));
  if (!unexpected.length) return "";

  const list = unexpected.slice(0, 20).map((f) => `  - ${f}`).join("\n");
  const more = unexpected.length > 20 ? `\n  ... and ${unexpected.length - 20} more` : "";
  const reason =
    `AIDW backstop: the Analysis is not approved, yet these files outside ${AIDW_DIR}/ changed since the change was created:\n${list}${more}\n` +
    "Do not delete or revert anything yourself: some of these may be the user's own edits. " +
    "Tell the user which of these you created or modified in this session and ask how to proceed. " +
    "Until approval, write only inside .aidw/.";
  if (input.stop_hook_active) {
    // Already blocked once this turn: surface it without looping.
    return JSON.stringify({ systemMessage: reason });
  }
  return JSON.stringify({ decision: "block", reason });
}
