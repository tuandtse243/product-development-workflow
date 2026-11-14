import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { loadChange, type Change } from "./change.js";
import { Diags } from "./diag.js";
import { machineOf, workflowIdOf } from "./machine.js";
import { rel, type Paths } from "./project.js";
import { loadWorkflow, type DecisionPoint, type Workflow } from "./workflow.js";

/**
 * Decision Points (ADR-0003): the places a Workflow lets one Role pick an answer from a fixed set. The answer and the
 * reason are recorded in `decisions.yaml` of the Change; it is part of the approved package, so the user sees every
 * decision at the next Approval Gate and it is frozen after it.
 */
export const DECISIONS_FILE = "decisions.yaml";

export interface Recorded {
  answer: string | string[];
  reason: string;
  /** the Role the Workflow names as the decider */
  by: string;
  at: string;
}

export class DecisionError extends Error {}

export const decisionsPath = (change: Change) => join(change.dir, DECISIONS_FILE);

export function readDecisions(change: Change): Record<string, Recorded> {
  const file = decisionsPath(change);
  if (!existsSync(file)) return {};
  try {
    const data = YAML.parse(readFileSync(file, "utf8")) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Recorded>) : {};
  } catch {
    return {};
  }
}

const answersOf = (r: Recorded): string[] => (Array.isArray(r.answer) ? r.answer.map(String) : [String(r.answer)]);

/** The Workflow of a Change, or an error that says what is wrong with it. */
export function workflowOfChange(p: Paths, change: Change, pluginRoot: string): Workflow {
  const id = workflowIdOf(p, change);
  const w = loadWorkflow(pluginRoot, id);
  if (!w) throw new DecisionError(`the workflow "${id}" of change "${change.id}" was not found in the plugin`);
  return w;
}

/** Records one decision. Refuses an unknown decision, an answer outside its options, and a change whose package is approved. */
export function recordDecision(p: Paths, id: string, decisionId: string, raw: string, reason: string, pluginRoot: string): { decision: DecisionPoint; recorded: Recorded } {
  const change = loadChange(p, id);
  const w = workflowOfChange(p, change, pluginRoot);
  const decision = w.decisions.find((x) => x.id === decisionId);
  if (!decision) throw new DecisionError(`workflow "${w.id}" has no decision "${decisionId}" (it has: ${w.decisions.map((x) => x.id).join(", ") || "none"})`);
  const state = change.data.state;
  if (typeof state === "string" && machineOf(p, change).approvalRequired.has(state as never)) {
    throw new DecisionError(`the package of "${id}" is approved: decisions are frozen with it. Escalate and go back to analyzing to change one`);
  }
  if (!reason.trim()) throw new DecisionError("a decision needs a reason (--reason \"...\")");
  const answers = raw.split(",").map((a) => a.trim()).filter(Boolean);
  if (!answers.length) throw new DecisionError(`answer with one of: ${decision.options.join(", ")}`);
  if (!decision.multiple && answers.length > 1) throw new DecisionError(`"${decision.id}" takes exactly one answer; got ${answers.length}`);
  const bad = answers.filter((a) => !decision.options.includes(a));
  if (bad.length) throw new DecisionError(`"${bad.join(", ")}" is not an answer of "${decision.id}" (options: ${decision.options.join(", ")})`);
  const recorded: Recorded = { answer: decision.multiple ? [...new Set(answers)] : (answers[0] as string), reason: reason.trim(), by: decision.decide, at: new Date().toISOString() };
  const all = readDecisions(change);
  all[decision.id] = recorded;
  writeFileSync(decisionsPath(change), YAML.stringify(all));
  return { decision, recorded };
}

/** What `aidw analyze` checks: required decisions are recorded, and every recorded answer is still one of the options. */
export function checkDecisions(p: Paths, change: Change, pluginRoot: string): Diags {
  const d = new Diags();
  let w: Workflow;
  try {
    w = workflowOfChange(p, change, pluginRoot);
  } catch {
    return d; // a Change of an unknown workflow is reported by validate
  }
  const file = rel(p, decisionsPath(change));
  const all = readDecisions(change);
  for (const x of w.decisions) {
    const r = all[x.id];
    if (!r) {
      if (x.required) d.error(file, `decision "${x.id}" (${x.decide}) is required before approval: aidw decide ${x.id} <${x.options.join("|")}> --reason "..."`);
      continue;
    }
    const bad = answersOf(r).filter((a) => !x.options.includes(a));
    if (bad.length) d.error(file, `decision "${x.id}": "${bad.join(", ")}" is not one of ${x.options.join(", ")}`);
  }
  for (const k of Object.keys(all)) if (!w.decisions.some((x) => x.id === k)) d.warn(file, `decision "${k}" is not a decision of the "${w.id}" workflow`);
  return d;
}

export const answerOf = (change: Change, decisionId: string): string[] | null => {
  const r = readDecisions(change)[decisionId];
  return r ? answersOf(r) : null;
};
