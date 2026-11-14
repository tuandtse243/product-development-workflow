import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { loadArtifacts } from "./artifacts.js";
import { isState, parseTransitions, POST_APPROVAL, STATES, TRANSITIONS, type State } from "./change.js";
import { Diags } from "./diag.js";
import { AGENTS, loadRoster } from "./roles.js";

/**
 * Workflows as data (docs/factory-architecture.md, section 8): `workflows/<id>.yaml`, one per kind of request.
 * Today there are two, `product` (greenfield) and `feature` (brownfield); each describes the flow aidw already
 * runs, so the check below ties the file to the Change state machine, the Roster, the Artifact registry and the
 * Agents the CLI spawns.
 */

export const GATES = ["approval", "production-deploy"] as const;
export const PROJECT_KINDS = ["greenfield", "brownfield"] as const;

export interface Stage {
  id: string;
  title: string;
  states: State[];
  roles: string[];
  reads: string[];
  writes: string[];
  gate?: (typeof GATES)[number];
  agents?: { implement?: string; review?: string; triage?: string; "layer-review"?: Record<string, string> };
}

export interface Workflow {
  id: string;
  description: string;
  applies_to: (typeof PROJECT_KINDS)[number];
  existing: string[];
  interrupts: State[];
  /** the Change state machine this Workflow lists; null when it is not a complete table */
  transitions: Record<State, readonly State[]> | null;
  stages: Stage[];
}

/**
 * Transitions that happen through their own command, not `aidw transition` (change.ts): `aidw approve` and
 * `aidw archive`. They are the only steps between two states that TRANSITIONS does not list.
 */
const COMMAND_TRANSITIONS: readonly (readonly [State, State])[] = [
  ["awaiting_approval", "approved"],
  ["delivered", "archived"],
];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const workflowsDir = (root: string) => join(root, "workflows");

/** Ids of the Workflow files, sorted. */
export function workflowIds(root: string): string[] {
  const dir = workflowsDir(root);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".yaml")).map((n) => n.slice(0, -5)).sort() : [];
}

/** A Workflow as written (no validation: `checkWorkflows` reports problems), or null when the file is missing or broken. */
export function loadWorkflow(root: string, id: string): Workflow | null {
  const file = join(workflowsDir(root), `${id}.yaml`);
  if (!existsSync(file)) return null;
  let data: unknown;
  try {
    data = YAML.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const stages = (Array.isArray(data.stages) ? data.stages : []).filter(isRecord).map(
    (s): Stage => ({
      id: String(s.id ?? ""),
      title: String(s.title ?? ""),
      states: strings(s.states) as State[],
      roles: strings(s.roles),
      reads: strings(s.reads),
      writes: strings(s.writes),
      ...(typeof s.gate === "string" ? { gate: s.gate as Stage["gate"] } : {}),
      ...(isRecord(s.agents) ? { agents: s.agents as Stage["agents"] } : {}),
    }),
  );
  return {
    id: String(data.id ?? ""),
    description: String(data.description ?? ""),
    applies_to: data.applies_to as Workflow["applies_to"],
    existing: strings(data.existing),
    interrupts: strings(data.interrupts) as State[],
    transitions: parseTransitions(data.transitions),
    stages,
  };
}

/** The Workflow that serves a project kind. */
export function workflowFor(root: string, kind: "greenfield" | "brownfield"): Workflow | null {
  for (const id of workflowIds(root)) {
    const w = loadWorkflow(root, id);
    if (w?.applies_to === kind) return w;
  }
  return null;
}

/** Validates every Workflow file against the Roster, the Artifact registry, the state machine and the Agents. */
export function checkWorkflows(root: string): Diags {
  const d = new Diags();
  const ids = workflowIds(root);
  if (!ids.length) {
    d.error("workflows/", "no workflow files");
    return d;
  }
  if (!existsSync(join(root, "roster.yaml")) || !existsSync(join(root, "artifacts.yaml"))) return d; // reported by their own checks
  let registry: ReturnType<typeof loadArtifacts> = null;
  try {
    registry = loadArtifacts(root);
  } catch {
    return d;
  }
  if (!registry) return d;
  const roster = loadRoster(root);
  const written = new Set<string>();
  const kinds = new Map<string, string>();

  for (const id of ids) {
    const file = `workflows/${id}.yaml`;
    const w = loadWorkflow(root, id);
    if (!w) {
      d.error(file, "not valid YAML or not a mapping");
      continue;
    }
    if (w.id !== id) d.error(file, `id "${w.id}" must equal the file name "${id}"`);
    if (!w.description.trim()) d.error(file, "description is required");
    if (!(PROJECT_KINDS as readonly string[]).includes(w.applies_to)) d.error(file, `applies_to must be ${PROJECT_KINDS.join(" or ")}`);
    else if (kinds.has(w.applies_to)) d.error(file, `${kinds.get(w.applies_to)} already serves ${w.applies_to} projects: one Workflow per project kind`);
    else kinds.set(w.applies_to, id);
    if (!w.transitions) d.error(file, '"transitions:" must list every state with the states it may move to');
    else if (JSON.stringify(w.transitions) !== JSON.stringify(TRANSITIONS)) d.error(file, 'its "transitions:" differ from the table the CLI runs (the one in workflows/product.yaml): every Workflow must list the same state machine');
    if (!w.stages.length) {
      d.error(file, "no stages");
      continue;
    }
    for (const a of w.existing) if (!(a in registry)) d.error(file, `existing: "${a}" is not an artifact in artifacts.yaml`);
    for (const s of w.interrupts) if (!isState(s)) d.error(file, `interrupts: "${String(s)}" is not a state`);

    // Artifacts available to a stage: what existed before, plus what this and earlier stages write.
    const available = new Set(w.existing);
    const seen = new Set<string>();
    const covered = new Set<string>(w.interrupts);
    let approvals = 0;
    let approvalAt = -1;

    w.stages.forEach((s, i) => {
      const at = `${file}: stage ${s.id || `#${i + 1}`}`;
      if (!KEBAB.test(s.id)) d.error(file, `stage #${i + 1}: id "${s.id}" must be lower-case kebab-case`);
      else if (seen.has(s.id)) d.error(file, `stage id "${s.id}" appears twice`);
      seen.add(s.id);
      if (!s.title.trim()) d.error(file, `${at}: title is required`);
      if (!s.states.length) d.error(file, `${at}: states is required`);
      for (const st of s.states) {
        if (!isState(st)) d.error(file, `${at}: "${String(st)}" is not a state`);
        else covered.add(st);
      }
      for (const r of s.roles) if (!(r in roster.roles)) d.error(file, `${at}: role "${r}" is not in roster.yaml`);
      for (const a of s.writes) {
        const owner = registry[a]?.owner;
        if (!registry[a]) d.error(file, `${at}: writes "${a}", which is not an artifact in artifacts.yaml`);
        else if (!s.roles.includes(owner as string)) d.error(file, `${at}: writes "${a}", owned by ${String(owner)}, who is not one of the stage's roles`);
        written.add(a);
      }
      for (const a of s.writes) available.add(a);
      for (const a of s.reads) {
        if (!registry[a]) d.error(file, `${at}: reads "${a}", which is not an artifact in artifacts.yaml`);
        else if (!available.has(a)) d.error(file, `${at}: reads "${a}", which no earlier stage writes`);
      }
      if (s.gate !== undefined && !(GATES as readonly string[]).includes(s.gate)) d.error(file, `${at}: gate must be ${GATES.join(" or ")}`);
      if (s.gate === "approval") {
        approvals++;
        approvalAt = i;
      }
      if (s.agents) checkAgents(d, file, at, s, roster.roles);
    });

    if (approvals !== 1) d.error(file, `exactly one stage has gate: approval (found ${approvals})`);
    w.stages.forEach((s, i) => {
      if (s.states.some((st) => POST_APPROVAL.has(st) && st !== "approved") && approvalAt >= 0 && i <= approvalAt) {
        d.error(file, `stage ${s.id}: covers a state that needs the approval, but it is not after the approval stage`);
      }
    });
    for (const st of STATES) if (!covered.has(st)) d.error(file, `no stage covers the state "${st}"`);

    // The stages walk the state machine: every step from one state to the next is one the table allows.
    const path = w.stages.flatMap((s) => s.states);
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1] as State;
      const to = path[i] as State;
      if (from === to || !isState(from) || !isState(to)) continue;
      const allowed = (TRANSITIONS[from] as readonly string[]).includes(to) || COMMAND_TRANSITIONS.some(([a, b]) => a === from && b === to);
      if (!allowed) d.error(file, `the stages go from state "${from}" to "${to}", which aidw does not allow`);
    }
  }

  for (const a of Object.keys(registry)) {
    if (!written.has(a)) d.warn("artifacts.yaml", `artifact "${a}" is written by no workflow stage`);
  }
  return d;
}

/** The build stage's Agents are the ones the CLI spawns (AGENTS in roles.ts, read from workflows/product.yaml): every Workflow says the same. */
function checkAgents(d: Diags, file: string, at: string, s: Stage, roles: Record<string, unknown>): void {
  const a = s.agents ?? {};
  const expect = {
    implement: AGENTS.implement.replace(/^aidw:/, ""),
    review: AGENTS.taskReview.replace(/^aidw:/, ""),
    triage: AGENTS.triage.replace(/^aidw:/, ""),
    ui: AGENTS.layerReview.ui.replace(/^aidw:/, ""),
    security: AGENTS.layerReview.security.replace(/^aidw:/, ""),
  };
  const got = { implement: a.implement, review: a.review, triage: a.triage, ui: a["layer-review"]?.ui, security: a["layer-review"]?.security };
  for (const k of Object.keys(expect) as (keyof typeof expect)[]) {
    if (got[k] !== expect[k]) d.error(file, `${at}: agents ${k} is "${String(got[k])}" but the CLI spawns "${expect[k]}" (the build stage of workflows/product.yaml)`);
    else if (!(expect[k] in roles)) d.error(file, `${at}: agent "${expect[k]}" is not in roster.yaml`);
  }
}
