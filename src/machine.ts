import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { isState, STATES, type Change, type State } from "./change.js";
import { OpError } from "./diag.js";
import { bundledRoot } from "./plugin.js";
import { projectKind, type Paths } from "./project.js";

/**
 * The state machine of a Change belongs to its Workflow (workflows/<id>.yaml): which states exist, which step may
 * follow which, which states need a valid approval and which need the full Analysis package. `product`, `feature` and
 * `bugfix` walk the same machine; `audit` has its own, without approval or build.
 */
export interface Machine {
  workflow: string;
  /** from each state of the Workflow, the states `aidw transition` may move to */
  transitions: Partial<Record<State, readonly State[]>>;
  /** states in which the approved package must exist and match its hash */
  approvalRequired: ReadonlySet<State>;
  /** states in which intake, analysis, tasks and quality files must exist */
  analysisRequired: ReadonlySet<State>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `transitions:` as a table of known states, or null when it is not one (reported by `aidw roster`). */
export function parseTransitions(raw: unknown): Partial<Record<State, readonly State[]>> | null {
  if (!isRecord(raw) || Object.keys(raw).length === 0) return null;
  const out: Partial<Record<State, readonly State[]>> = {};
  for (const [from, to] of Object.entries(raw)) {
    if (!isState(from) || !Array.isArray(to) || !to.every(isState)) return null;
    out[from] = to as State[];
  }
  return out;
}

const stateList = (v: unknown): State[] | null => (Array.isArray(v) && v.every(isState) ? (v as State[]) : null);

/** The machine a Workflow file defines, or null when its `transitions`, `approval_required` or `analysis_required` is not valid. */
export function parseMachine(workflow: string, data: unknown): Machine | null {
  if (!isRecord(data)) return null;
  const transitions = parseTransitions(data.transitions);
  const approval = stateList(data.approval_required);
  const analysis = stateList(data.analysis_required);
  return transitions && approval && analysis ? { workflow, transitions, approvalRequired: new Set(approval), analysisRequired: new Set(analysis) } : null;
}

const cache = new Map<string, Machine>();

/** The machine of a Workflow shipped with this CLI (never an environment override: it defines the CLI's own behavior). */
export function machineById(workflow: string): Machine | null {
  const hit = cache.get(workflow);
  if (hit) return hit;
  const root = bundledRoot();
  const file = root && /^[a-z][a-z0-9-]*$/.test(workflow) ? join(root, "workflows", `${workflow}.yaml`) : "";
  if (!file || !existsSync(file)) return null;
  let data: unknown;
  try {
    data = YAML.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const m = parseMachine(workflow, data);
  if (m) cache.set(workflow, m);
  return m;
}

/** The Workflow a Change runs under: the one named in change.yaml, else the default of the project kind. */
export function workflowIdOf(p: Paths, change: Change): string {
  const named = change.data.workflow;
  if (typeof named === "string" && named) return named;
  return projectKind(p) === "brownfield" ? "feature" : "product";
}

/** The machine of a Change. Throws when its Workflow is unknown or broken: nothing can be decided without it. */
export function machineOf(p: Paths, change: Change): Machine {
  const id = workflowIdOf(p, change);
  const m = machineById(id);
  if (!m) throw new OpError(`the workflow "${id}" of change "${change.id}" has no valid state machine (workflows/${id}.yaml: transitions, approval_required, analysis_required)`);
  return m;
}

/** Every state a Workflow's machine mentions. */
export const statesOf = (m: Machine): State[] => STATES.filter((s) => s in m.transitions);
