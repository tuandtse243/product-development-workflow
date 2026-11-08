import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { approvalStatus, computeApprovalHash } from "./approval.js";
import {
  CHANGE_ID,
  ChangeError,
  changeDir,
  listChangeIds,
  loadChange,
  POST_APPROVAL,
  saveChange,
  stateOf,
  TRANSITIONS,
  type State,
} from "./change.js";
import { analyzeChange, PLACEHOLDER } from "./analyze.js";
import { recordBaseline } from "./backstop.js";
import { checkChange, deltaFiles } from "./check.js";
import { Diags } from "./diag.js";
import { capabilityOf, isDir, pathsFor, readText, rel, walkFiles, type Paths } from "./project.js";
import { applyDelta, type MergeSummary } from "./spec/merge.js";
import { parseSpec } from "./spec/parse.js";
import { git, headCommit, isGitRepo } from "./git.js";
import { transitionGuard } from "./quality.js";
import { parseTasks } from "./tasks.js";
import { VERSION } from "./version.js";

export class OpError extends Error {
  constructor(
    message: string,
    readonly diags?: Diags,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

/** States a paused change can resume to (every state that can transition to "paused"). */
const RESUMABLE = (Object.keys(TRANSITIONS) as State[]).filter((s) => TRANSITIONS[s].includes("paused"));

// ---------------------------------------------------------------- init

const PROJECT_YAML = (name: string) => `# aidw project configuration
schema: 1
name: ${name}
stack:
  source: null # client | ai | fallback
  items: {}
  reason: null
design_mode: null # existing | claude_design | ai_design | hybrid
quality_profile: null
deploy:
  targets: []
engine_version: ${VERSION}
`;

const CONSTITUTION = `# Constitution

Project-wide engineering principles. Every agent reads this file before working.
It is part of the approved Analysis package: changing it after approval is drift.

## Principles

- <principle>

## Stack and conventions

- <stack profile, coding standards, folder conventions>
`;

const SKELETON_DIRS = ["requirements", "specs", "domain", "architecture", "decisions", "design", "changes", "archive", "run"];

export function initProject(projectDir: string): { created: string[]; paths: Paths } {
  const p = pathsFor(projectDir);
  if (existsSync(p.aidw)) throw new OpError(`${rel(p, p.aidw)}/ already exists; refusing to overwrite`);
  const created: string[] = [];
  const write = (file: string, content: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    created.push(rel(p, file));
  };
  write(p.projectYaml, PROJECT_YAML(basename(projectDir)));
  write(p.constitution, CONSTITUTION);
  write(join(p.aidw, ".gitignore"), "run/\n");
  for (const d of SKELETON_DIRS) {
    const keep = join(p.aidw, d, ".gitkeep");
    if (d !== "run") write(keep, "");
    else mkdirSync(join(p.aidw, d), { recursive: true });
  }
  return { created, paths: p };
}

// ---------------------------------------------------------------- change new

export const INPUT_TYPES = ["idea", "prd", "upwork_jd", "client_request", "codebase"] as const;

const INTAKE = (title: string) => `# Intake: ${title}

## Input type

<idea | prd | upwork_jd | client_request | codebase>

## Source

<paste or link the original request; keep the client's wording>

## Client constraints

- Stack required by the client: <none | ...>
- Deadline / budget / other: <...>
`;

export function newChange(p: Paths, id: string, opts: { title?: string; inputType?: string }): string {
  if (!CHANGE_ID.test(id)) throw new OpError(`change id "${id}" must be kebab-case (e.g. 2026-11-08-booking-app)`);
  if (opts.inputType && !(INPUT_TYPES as readonly string[]).includes(opts.inputType)) {
    throw new OpError(`unknown input type "${opts.inputType}" (expected ${INPUT_TYPES.join(", ")})`);
  }
  const dir = changeDir(p, id);
  if (existsSync(dir)) throw new OpError(`change "${id}" already exists`);
  const title = opts.title ?? id;
  mkdirSync(join(dir, "specs"), { recursive: true });
  writeFileSync(
    join(dir, "change.yaml"),
    [
      "schema: 1",
      `id: ${id}`,
      `title: ${JSON.stringify(title)}`,
      `input_type: ${opts.inputType ?? "null"}`,
      "state: draft",
      `created_at: ${now()}`,
      "skip_specs: false",
      "approval: null",
      "run:",
      "  paused: null",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "intake.md"), INTAKE(title));
  writeFileSync(join(dir, "analysis.md"), ANALYSIS(title));
  recordBaseline(p);
  return dir;
}

// Section names must match ANALYSIS_SECTIONS in analyze.ts; `aidw analyze` rejects leftover TODO(aidw).
const ANALYSIS = (title: string) => `# Analysis: ${title}

## Summary

${PLACEHOLDER}: one page the user can review in minutes - goal, scope, the 5-10 key decisions, and the risks and assumptions that need their attention.

## Requirements and scope

${PLACEHOLDER}: in scope, out of scope, assumptions. Link .aidw/requirements/<change>.md.

## Domain

${PLACEHOLDER}: key entities and business rules. Link .aidw/domain/model.md.

## Stack

Source: ${PLACEHOLDER} (client | ai | fallback)

${PLACEHOLDER}: chosen stack and why. If outside the familiar stack pool, say why.

## Design

Mode: ${PLACEHOLDER} (existing | claude_design | ai_design | hybrid)

${PLACEHOLDER}: design references, bundle, or AI design direction.

## Architecture

${PLACEHOLDER}: architecture overview and new ADRs. Link .aidw/architecture/overview.md.

## Specs

${PLACEHOLDER}: capabilities added or changed, number of requirements and scenarios.

## Plan

${PLACEHOLDER}: number of tasks and waves, what can run in parallel, which agents are needed.

## Quality profile

${PLACEHOLDER}: quality layers that run (code, unit, integration, e2e, ui-ux, a11y, security, performance, review) and their thresholds.

## Deploy strategy

${PLACEHOLDER}: local | preview | staging | production (production always asks first).

## Permissions

${PLACEHOLDER}: one bullet per tier-2 resource requested (free cloud resources, preview deploys), or "None".

## Risks and assumptions

${PLACEHOLDER}: what could go wrong and what was assumed.

## Appendix: discovery Q&A

${PLACEHOLDER}: the grilling rounds, questions and answers.
`;

// ---------------------------------------------------------------- full check

/** validate + analyze: what the gate requires before a package can be presented or approved. */
export function readinessCheck(p: Paths, id: string, asState?: string): Diags {
  const d = checkChange(p, id, asState ? { asState } : {});
  d.add(analyzeChange(p, id));
  return d;
}

// ---------------------------------------------------------------- approve

export function approve(p: Paths, id: string): { hash: string; files: string[] } {
  const change = loadChange(p, id);
  const state = stateOf(change);
  if (state !== "awaiting_approval") {
    throw new OpError(`change "${id}" is in state "${String(change.data.state)}"; only "awaiting_approval" can be approved`);
  }
  const d = readinessCheck(p, id);
  if (d.errors.length) throw new OpError(`change "${id}" has validation errors; fix them before approving`, d);
  const { hash, files } = computeApprovalHash(p, change);
  change.doc.set("approval", change.doc.createNode({ hash, at: now(), by: "user" }));
  change.doc.set("state", "approved");
  saveChange(change);
  return { hash, files };
}

// ---------------------------------------------------------------- transition

export function transition(p: Paths, id: string, to: string, opts: { reason?: string }): { from: State; to: State; commit?: string } {
  const change = loadChange(p, id);
  const from = stateOf(change);
  if (!from) throw new OpError(`change "${id}" has an unknown state "${String(change.data.state)}"`);

  let target: State;
  if (to === "resume") {
    if (from !== "paused") throw new OpError(`change "${id}" is not paused`);
    const back = (change.data.run as { paused?: { from?: string } } | undefined)?.paused?.from;
    if (!back || !(RESUMABLE as readonly string[]).includes(back)) {
      throw new OpError(`change "${id}" has no valid paused.from state to resume to`);
    }
    target = back as State;
  } else {
    if (to === "approved") throw new OpError("use `aidw approve` to approve a change");
    if (to === "archived") throw new OpError("use `aidw archive` to archive a change");
    if (!(TRANSITIONS[from] as readonly string[]).includes(to)) {
      const allowed = TRANSITIONS[from].join(", ") || "none";
      throw new OpError(`cannot go from "${from}" to "${to}" (allowed: ${allowed})`);
    }
    target = to as State;
  }

  // "escalated" is the escape hatch (e.g. after drift), so it is reachable without a valid approval.
  if (POST_APPROVAL.has(target) && target !== "escalated") {
    const a = approvalStatus(p, change);
    if (a.status !== "valid") {
      throw new OpError(
        a.status === "none"
          ? `"${target}" requires an approval`
          : "approval drift: the approved Analysis package changed; go back to analyzing (via escalated) and approve again",
      );
    }
  }

  if (from !== "paused") {
    const refused = transitionGuard(p, id, target);
    if (refused) throw new OpError(refused);
  }

  if (target === "awaiting_approval") {
    // Validate as if already in the target state, so the user is never asked to approve an incomplete package.
    const d = readinessCheck(p, id, target);
    if (d.errors.length) throw new OpError("Analysis package is not ready for approval", d);
  }

  if (target === "paused") {
    change.doc.setIn(["run", "paused"], change.doc.createNode({ from, reason: opts.reason ?? "unspecified", at: now() }));
  } else if (from === "paused") {
    change.doc.setIn(["run", "paused"], null);
  }
  if (target === "analyzing" && from !== "intake") {
    // Going back to analysis invalidates the previous approval.
    change.doc.set("approval", null);
  }
  change.doc.set("state", target);
  saveChange(change);
  if (target === "delivered") {
    // Quality and deploy evidence plus the final state belong in history; only .aidw/ is committed.
    const commit = commitAidw(p, `aidw: ${id} delivered\n\nQuality layer and deploy evidence: .aidw/changes/${id}/evidence/`);
    return { from, to: target, ...(commit ? { commit } : {}) };
  }
  return { from, to: target };
}

/** Commits pending changes under .aidw/ only. Returns the commit, or null outside git or when nothing changed. */
export function commitAidw(p: Paths, message: string): string | null {
  if (!isGitRepo(p.project)) return null;
  if (!git(p.project, ["add", "--", ".aidw"]).ok) return null;
  if (git(p.project, ["diff", "--cached", "--quiet", "--", ".aidw"]).ok) return null;
  return git(p.project, ["commit", "-q", "-m", message, "--", ".aidw"]).ok ? headCommit(p.project) : null;
}

// ---------------------------------------------------------------- merge / archive

export interface CapabilityMerge {
  capability: string;
  file: string;
  created: boolean;
  summary: MergeSummary;
  text: string;
}

/** Computes all merges for a change; throws if any delta fails (all-or-nothing). */
export function planMerge(p: Paths, id: string): CapabilityMerge[] {
  const change = loadChange(p, id);
  const d = new Diags();
  const files = deltaFiles(p, change, d);
  const results: CapabilityMerge[] = [];
  for (const df of files) {
    const r = applyDelta(readText(df.mainFile), readFileSync(df.file, "utf8"), df.capability);
    if (!r.ok || !r.text) {
      for (const e of r.errors) d.error(rel(p, df.file), e);
      continue;
    }
    results.push({ capability: df.capability, file: df.mainFile, created: r.created, summary: r.summary, text: r.text });
  }
  if (d.errors.length) throw new OpError(`merge of change "${id}" failed; nothing was written`, d);
  return results;
}

export function writeMerge(merges: CapabilityMerge[]): void {
  for (const m of merges) {
    mkdirSync(dirname(m.file), { recursive: true });
    writeFileSync(m.file, m.text);
  }
}

export function archiveChange(p: Paths, id: string): { target: string; merges: CapabilityMerge[] } {
  const change = loadChange(p, id);
  if (stateOf(change) !== "delivered") {
    throw new OpError(`change "${id}" is in state "${String(change.data.state)}"; only "delivered" changes can be archived`);
  }
  const d = checkChange(p, id);
  if (d.errors.length) throw new OpError(`change "${id}" has validation errors; nothing was archived`, d);
  const merges = planMerge(p, id);

  const date = now().slice(0, 10);
  const name = /^\d{4}-\d{2}-\d{2}-/.test(id) ? id : `${date}-${id}`;
  const target = join(p.archive, name);
  if (existsSync(target)) throw new OpError(`archive target ${rel(p, target)} already exists`);

  writeMerge(merges);
  change.doc.set("state", "archived");
  change.doc.set("archived_at", now());
  saveChange(change);
  mkdirSync(p.archive, { recursive: true });
  renameSync(change.dir, target);
  return { target, merges };
}

// ---------------------------------------------------------------- status

export interface ChangeStatus {
  id: string;
  title?: string;
  state: string;
  approval: "none" | "valid" | "drift";
  tasks: { total: number; done: number; byStatus: Record<string, number> } | null;
  paused: { from?: string; reason?: string; at?: string } | null;
  deltas: number;
  error?: string;
}

export interface ProjectStatus {
  project: string;
  engineVersion: string;
  specs: { capabilities: number; requirements: number };
  changes: ChangeStatus[];
}

export function projectStatus(p: Paths, only?: string): ProjectStatus {
  let capabilities = 0;
  let requirements = 0;
  for (const f of walkFiles(p.specs)) {
    if (!capabilityOf(p.specs, f)) continue;
    capabilities++;
    requirements += parseSpec(readFileSync(f, "utf8")).requirements.length;
  }
  const ids = only ? [only] : listChangeIds(p);
  const changes = ids.map((id): ChangeStatus => {
    try {
      const c = loadChange(p, id);
      const tasksText = readText(join(c.dir, "tasks.yaml"));
      let tasks: ChangeStatus["tasks"] = null;
      if (tasksText !== null) {
        const byStatus: Record<string, number> = {};
        const list = parseTasks(tasksText).tasks;
        for (const t of list) {
          const s = String(t?.status ?? "pending");
          byStatus[s] = (byStatus[s] ?? 0) + 1;
        }
        tasks = { total: list.length, done: byStatus.done ?? 0, byStatus };
      }
      const paused = ((c.data.run as { paused?: ChangeStatus["paused"] } | undefined)?.paused ?? null) as ChangeStatus["paused"];
      return {
        id,
        ...(typeof c.data.title === "string" ? { title: c.data.title } : {}),
        state: String(c.data.state),
        approval: approvalStatus(p, c).status,
        tasks,
        paused,
        deltas: deltaFiles(p, c, new Diags()).length,
      };
    } catch (e) {
      if (e instanceof ChangeError) {
        return { id, state: "?", approval: "none", tasks: null, paused: null, deltas: 0, error: e.message };
      }
      throw e;
    }
  });
  return { project: p.project, engineVersion: VERSION, specs: { capabilities, requirements }, changes };
}

export function assertProject(p: Paths): void {
  if (!isDir(p.aidw)) throw new OpError(`no .aidw/ in ${p.project}; run \`aidw init\``);
}
