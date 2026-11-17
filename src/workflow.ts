import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { loadArtifacts } from "./artifacts.js";
import { isState, type State } from "./change.js";
import { parseMachine, statesOf, type Machine } from "./machine.js";
import { Diags } from "./diag.js";
import { AGENTS, loadRoster } from "./roles.js";

/**
 * Workflows as data (docs/factory-architecture.md, section 8): `workflows/<id>.yaml`, one per kind of request.
 * Today there are two, `product` (greenfield) and `feature` (brownfield); each describes the flow aidw already
 * runs, so the check below ties the file to the Change state machine, the Roster, the Artifact registry and the
 * Agents the CLI spawns.
 */

/** scope-approval: the user approves the product brief before any requirement is written. approval: only the user passes it. approval-auto: aidw records the approval itself while the plan stays inside the stage's `boundary`. */
export const GATES = ["approval", "approval-auto", "scope-approval", "production-deploy"] as const;
/** The project kinds a Workflow is the default for, or `request`: chosen for one request (a bug report, an audit) and confirmed by the user. */
export const PROJECT_KINDS = ["greenfield", "brownfield", "request"] as const;

/** What a small, automatically approved change may not exceed; beyond it the Change is reclassified to `reclassify_to`. */
export interface Boundary {
  max_tasks: number;
  migrations: boolean;
  spec_changes: boolean;
  reclassify_to: string;
}

export interface Stage {
  id: string;
  title: string;
  states: State[];
  roles: string[];
  reads: string[];
  writes: string[];
  gate?: (typeof GATES)[number];
  boundary?: Boundary;
  /** audit: lens -> the Role whose Agent reviews through it */
  lenses?: Record<string, string>;
  agents?: { implement?: string; review?: string; triage?: string; "layer-review"?: Record<string, string> };
}

/** A place the Workflow lets one Role choose from a fixed set (ADR-0003); `aidw decide` rejects an answer outside `options`. */
export interface DecisionPoint {
  id: string;
  /** the Role that decides; it is the owner of the Artifact `decision-<id>` */
  decide: string;
  options: string[];
  /** more than one option may be chosen */
  multiple: boolean;
  /** the stage that needs the answer */
  stage: string;
  /** `aidw analyze` refuses a package without it */
  required: boolean;
}

export interface Workflow {
  id: string;
  description: string;
  applies_to: (typeof PROJECT_KINDS)[number];
  existing: string[];
  /** a Change of this Workflow needs the scope approved (a stage has gate: scope-approval) before the final approval */
  scope_gate: boolean;
  interrupts: State[];
  /** the state machine of its Changes; null when `transitions`, `approval_required` or `analysis_required` is not valid */
  machine: Machine | null;
  decisions: DecisionPoint[];
  stages: Stage[];
}

/**
 * Transitions that happen through their own command, not `aidw transition` (change.ts): `aidw approve` and
 * `aidw archive`. They are the only steps between two states that TRANSITIONS does not list.
 */
const COMMAND_TRANSITIONS: readonly (readonly [State, State])[] = [
  ["awaiting_approval", "approved"],
  ["awaiting_scope_approval", "analyzing"], // `aidw approve` approves the scope
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
      ...(isRecord(s.boundary) ? { boundary: s.boundary as unknown as Boundary } : {}),
      ...(isRecord(s.lenses) ? { lenses: Object.fromEntries(Object.entries(s.lenses).map(([k, v]) => [k, String(v)])) } : {}),
      ...(isRecord(s.agents) ? { agents: s.agents as Stage["agents"] } : {}),
    }),
  );
  return {
    id: String(data.id ?? ""),
    description: String(data.description ?? ""),
    applies_to: data.applies_to as Workflow["applies_to"],
    existing: strings(data.existing),
    scope_gate: data.scope_gate === true,
    interrupts: strings(data.interrupts) as State[],
    machine: parseMachine(String(data.id ?? ""), data),
    decisions: (Array.isArray(data.decisions) ? data.decisions : []).filter(isRecord).map(
      (x): DecisionPoint => ({
        id: String(x.id ?? ""),
        decide: String(x.decide ?? ""),
        options: strings(x.options),
        multiple: x.multiple === true,
        stage: String(x.stage ?? ""),
        required: x.required === true,
      }),
    ),
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
    else if (w.applies_to !== "request" && kinds.has(w.applies_to)) d.error(file, `${kinds.get(w.applies_to)} already serves ${w.applies_to} projects: one Workflow per project kind`);
    else kinds.set(w.applies_to, id);
    if (!w.machine) d.error(file, '"transitions:" (state -> states it may move to), "approval_required:" and "analysis_required:" (lists of states) are required');
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
      if (s.gate === "approval" || s.gate === "approval-auto") {
        approvals++;
        approvalAt = i;
      }
      if (s.gate === "approval-auto") checkBoundary(d, file, at, s, ids);
      else if (s.boundary) d.error(file, `${at}: boundary belongs to a stage with gate: approval-auto`);
      if (s.agents) checkAgents(d, file, at, s, roster.roles);
      if (s.lenses) {
        const lensDecision = w.decisions.find((x) => x.id === "audit-lenses");
        if (!lensDecision) d.error(file, `${at}: lenses need a decision "audit-lenses" whose options are the lenses`);
        else if (JSON.stringify(Object.keys(s.lenses).sort()) !== JSON.stringify([...lensDecision.options].sort())) d.error(file, `${at}: lenses (${Object.keys(s.lenses).join(", ")}) must be exactly the options of the decision audit-lenses (${lensDecision.options.join(", ")})`);
        for (const [lens, role] of Object.entries(s.lenses)) if (!s.roles.includes(role)) d.error(file, `${at}: lens ${lens} is reviewed by ${role}, who is not one of the stage's roles`);
      }
    });

    const m = w.machine;
    const seenDecisions = new Set<string>();
    for (const x of w.decisions) {
      const where = `${file}: decision ${x.id || "?"}`;
      if (!KEBAB.test(x.id)) d.error(file, `decision id "${x.id}" must be lower-case kebab-case`);
      else if (seenDecisions.has(x.id)) d.error(file, `decision id "${x.id}" appears twice`);
      seenDecisions.add(x.id);
      if (!(x.decide in roster.roles)) d.error(file, `${where}: decide "${x.decide}" is not a role in roster.yaml`);
      else if (registry[`decision-${x.id}`]?.owner !== x.decide) d.error(file, `${where}: the artifact "decision-${x.id}" must exist in artifacts.yaml and be owned by ${x.decide}`);
      if (x.options.length < 2 || new Set(x.options).size !== x.options.length || !x.options.every((o) => KEBAB.test(o))) d.error(file, `${where}: options must be at least two distinct kebab-case answers`);
      if (!w.stages.some((s) => s.id === x.stage)) d.error(file, `${where}: stage "${x.stage}" is not a stage of this workflow`);
    }
    const scopeStages = w.stages.filter((s) => s.gate === "scope-approval");
    if (scopeStages.length > 1) d.error(file, "at most one stage has gate: scope-approval");
    if (w.scope_gate !== (scopeStages.length === 1)) d.error(file, "scope_gate: true and a stage with gate: scope-approval go together");
    if (approvals > 1) d.error(file, `at most one stage has gate: approval or approval-auto (found ${approvals})`);
    if (m) {
      // Approval is required exactly from the gate on; a Workflow with no gate (audit) never needs one.
      if (approvals === 0 && m.approvalRequired.size) d.error(file, "approval_required lists states, but no stage has gate: approval or approval-auto");
      if (approvals === 1 && !m.approvalRequired.size) d.error(file, "a stage has an approval gate, so approval_required must list the states that need it");
      const fromGate = new Set<string>(w.interrupts);
      w.stages.forEach((s, i) => i >= approvalAt && approvalAt >= 0 && s.states.forEach((st) => fromGate.add(st)));
      for (const st of m.approvalRequired) if (!fromGate.has(st)) d.error(file, `approval_required: "${st}" is a state before the approval stage, or no stage covers it`);
      const mentioned = new Set<string>(statesOf(m));
      for (const st of m.analysisRequired) if (!mentioned.has(st)) d.error(file, `analysis_required: "${st}" is not a state of this workflow's transitions`);
      for (const [from, to] of Object.entries(m.transitions)) for (const x of to ?? []) if (!mentioned.has(x)) d.error(file, `transitions: "${from}" -> "${x}", but "${x}" has no entry of its own`);
      // The workflow's states are exactly the states its stages (and interrupts) cover.
      for (const st of mentioned) if (!covered.has(st)) d.error(file, `no stage covers the state "${st}"`);
      for (const st of covered) if (!mentioned.has(st)) d.error(file, `a stage covers the state "${st}", which is not in the transitions`);
    }

    // The stages walk the state machine: every step from one state to the next is one the table allows.
    const path = w.stages.flatMap((s) => s.states);
    for (let i = 1; w.machine && i < path.length; i++) {
      const from = path[i - 1] as State;
      const to = path[i] as State;
      if (from === to || !isState(from) || !isState(to)) continue;
      const allowed = ((w.machine!.transitions[from] ?? []) as readonly string[]).includes(to) || COMMAND_TRANSITIONS.some(([a, b]) => a === from && b === to);
      if (!allowed) d.error(file, `the stages go from state "${from}" to "${to}", which its transitions do not allow`);
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
    performance: AGENTS.layerReview.performance.replace(/^aidw:/, ""),
  };
  const got = { implement: a.implement, review: a.review, triage: a.triage, ui: a["layer-review"]?.ui, security: a["layer-review"]?.security, performance: a["layer-review"]?.performance };
  for (const k of Object.keys(expect) as (keyof typeof expect)[]) {
    if (got[k] !== expect[k]) d.error(file, `${at}: agents ${k} is "${String(got[k])}" but the CLI spawns "${expect[k]}" (the build stage of workflows/product.yaml)`);
    else if (!(expect[k] in roles)) d.error(file, `${at}: agent "${expect[k]}" is not in roster.yaml`);
  }
}

function checkBoundary(d: Diags, file: string, at: string, s: Stage, workflows: string[]): void {
  const b = s.boundary;
  if (!b) return void d.error(file, `${at}: gate approval-auto needs a boundary (max_tasks, migrations, spec_changes, reclassify_to)`);
  if (!Number.isInteger(b.max_tasks) || b.max_tasks < 1) d.error(file, `${at}: boundary.max_tasks must be a positive integer`);
  if (typeof b.migrations !== "boolean" || typeof b.spec_changes !== "boolean") d.error(file, `${at}: boundary.migrations and boundary.spec_changes must be true (allowed) or false`);
  if (typeof b.reclassify_to !== "string" || !workflows.includes(b.reclassify_to)) d.error(file, `${at}: boundary.reclassify_to must name a workflow file (${workflows.join(", ")})`);
}
