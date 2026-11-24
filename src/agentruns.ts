/**
 * Agent runs of one Change and the cap the user set at the Approval Gate (plan D5, D10; ADR-0014).
 *
 * An Agent run is counted when the CLI prints the brief and the `SPAWN` line for it: the implementer of a task attempt
 * (`aidw task start`), the reviewer of a checkpointed attempt, the triage Agent, the author Role of an upstream round,
 * the integration Role of a merge conflict and the reviewer of its merge, a consulted Role and the resumed asker, and
 * the reviewer of a review layer. Each run has a key (what it is for, with its attempt, round or time), so printing the
 * same brief again (a new session, a lost reply) is the same run and is not counted twice. Only runs after approval
 * count: the cap belongs to the build the user approved.
 *
 * The record is `evidence/agent-runs.json` in the Change. At the cap no new task starts (src/run.ts); work already
 * running finishes, and the Change goes on to verify and delivery with what was not built listed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateOf, type Change } from "./change.js";
import { changeAgentRunCap } from "./grants.js";
import type { Paths } from "./project.js";

export type AgentRunKind = "implementer" | "reviewer" | "triage" | "author" | "integration" | "merge-reviewer" | "consulted" | "resumed" | "layer-reviewer";

export interface AgentRun {
  key: string;
  kind: AgentRunKind;
  at: string;
  task?: string;
}

/** States after the Approval Gate: the build the cap applies to. */
const BUILD_STATES = new Set(["approved", "executing", "verifying", "converging", "deploying", "paused"]);

const runsFile = (change: Change) => join(change.dir, "evidence", "agent-runs.json");

/** The runs recorded, or null when the record exists but cannot be read: then the count fails closed (the cap counts as reached). */
export function agentRuns(change: Change): AgentRun[] | null {
  const f = runsFile(change);
  if (!existsSync(f)) return [];
  try {
    const data = JSON.parse(readFileSync(f, "utf8")) as { runs?: unknown };
    return Array.isArray(data.runs) && data.runs.every((r) => r && typeof r === "object" && typeof (r as AgentRun).key === "string") ? (data.runs as AgentRun[]) : null;
  } catch {
    return null;
  }
}

export interface AgentRunStatus {
  used: number;
  cap: number;
  reached: boolean;
  /** evidence/agent-runs.json cannot be read: the cap counts as reached until it is repaired */
  unreadable?: boolean;
}

export function agentRunStatus(_p: Paths, change: Change): AgentRunStatus {
  const runs = agentRuns(change);
  const cap = changeAgentRunCap(change);
  if (runs === null) return { used: cap, cap, reached: true, unreadable: true };
  return { used: runs.length, cap, reached: runs.length >= cap };
}

/** Counts one Agent run under `key`, once. Returns true when it was new. Runs before approval are not counted. */
export function countAgentRun(change: Change, kind: AgentRunKind, key: string, task?: string): boolean {
  if (!BUILD_STATES.has(String(stateOf(change)))) return false;
  const runs = agentRuns(change);
  if (runs === null) return false; // never overwrite a record that cannot be read
  const full = `${kind}:${key}`;
  if (runs.some((r) => r.key === full)) return false;
  runs.push({ key: full, kind, at: new Date().toISOString(), ...(task ? { task } : {}) });
  mkdirSync(join(change.dir, "evidence"), { recursive: true });
  writeFileSync(runsFile(change), `${JSON.stringify({ runs }, null, 2)}\n`);
  return true;
}

export const capReason = (s: AgentRunStatus): string =>
  s.unreadable
    ? "the record of Agent runs (evidence/agent-runs.json) cannot be read, so the cap counts as reached"
    : `the cap of ${s.cap} Agent run${s.cap === 1 ? "" : "s"} set at the Approval Gate was reached (${s.used} used)`;
