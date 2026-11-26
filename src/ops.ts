import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { approvalStatus, computeApprovalHash, PACKAGE_VERSION, packageVersionOf } from "./approval.js";
import { openDeviation } from "./deviationrecord.js";
import {
  CHANGE_ID,
  ChangeError,
  isState,
  changeDir,
  listChangeIds,
  loadChange,
  saveChange,
  stateOf,
  type State,
} from "./change.js";
import { analyzeChange, PLACEHOLDER } from "./analyze.js";
import { boundaryExceeded, boundaryOf } from "./boundary.js";
import { SCOPE_ROUND_HEADING } from "./scope.js";
import { recordBaseline } from "./backstop.js";
import { checkChange, deltaFiles } from "./check.js";
import { Diags, OpError } from "./diag.js";
import { aidwCommitMessage } from "./commit.js";
import { capabilityOf, findProject, isDir, KEBAB_SEGMENT, pathsFor, projectKind, readText, rel, walkFiles, type Paths } from "./project.js";
import { applyDelta, type MergeSummary } from "./spec/merge.js";
import { parseSpec } from "./spec/parse.js";
import { git, headCommit, isDefaultBranch, isGitRepo, junkMessage, stagedJunk } from "./git.js";
import { commitProblem, secretsMessage, stagedSecrets } from "./secrets.js";
import { agentRunCap, bindingProblem, bindPush, boundPush, changeAgentRunCap, GRANT_STATES, plannedAgentRuns, pushGrantReason, readGrants } from "./grants.js";
import { draftReason, nothingToFinish, reopenDraft } from "./draft.js";
import { checkDelivery } from "./deliver.js";
import { transitionGuard } from "./guards.js";
import { parseTasks } from "./tasks.js";
import { VERSION } from "./version.js";
import { detectProject, type Detection } from "./detect.js";
import YAML from "yaml";

export { OpError };

const now = () => new Date().toISOString();

import { machineOf, workflowIdOf } from "./machine.js";
import { carriedFindings, planReviewBlocker } from "./planreview.js";
import { stageConsultationsInFlight } from "./consult.js";
import { bundledRoot } from "./plugin.js";
import { loadWorkflow } from "./workflow.js";

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

/** project.yaml with the detection result: brownfield projects keep their stack (Q9, source client). */
function projectYaml(name: string, det: Detection): string {
  const base = PROJECT_YAML(name).replace("schema: 1\n", `schema: 1\nkind: ${det.kind} # greenfield | brownfield (aidw detect)\n`);
  if (det.kind === "greenfield") return base;
  const doc = YAML.parseDocument(base);
  doc.setIn(["stack", "source"], "client");
  doc.setIn(["stack", "items"], doc.createNode(det.stack));
  doc.setIn(["stack", "reason"], "existing project: aidw keeps the stack it finds and does not migrate it (Q9)");
  doc.set(
    "detected",
    doc.createNode({
      package_manager: det.packageManager,
      ...(det.pythonTool ? { python_tool: det.pythonTool } : {}),
      languages: det.languages,
      signals: det.signals,
      suggested_layers: Object.fromEntries(det.layers.map((l) => [l.name, l.run])),
    }),
  );
  return String(doc);
}

export function initProject(projectDir: string): { created: string[]; paths: Paths; detection: Detection } {
  const p = pathsFor(projectDir);
  if (existsSync(p.aidw)) throw new OpError(`${rel(p, p.aidw)}/ already exists; refusing to overwrite`);
  const detection = detectProject(projectDir);
  const created: string[] = [];
  const write = (file: string, content: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    created.push(rel(p, file));
  };
  write(p.projectYaml, projectYaml(basename(projectDir), detection));
  write(p.constitution, CONSTITUTION);
  write(join(p.aidw, ".gitignore"), "run/\n");
  for (const d of SKELETON_DIRS) {
    const keep = join(p.aidw, d, ".gitkeep");
    if (d !== "run") write(keep, "");
    else mkdirSync(join(p.aidw, d), { recursive: true });
  }
  return { created, paths: p, detection };
}

// ---------------------------------------------------------------- baseline (S10)

const PRE_APPROVAL = new Set(["draft", "intake", "analyzing"]);

/**
 * Lazy baseline spec (S10): before a brownfield change modifies a capability that has no spec yet, the current
 * behavior of the existing code is written down as `.aidw/specs/<capability>/spec.md`. Only capabilities a
 * change touches get one. The skeleton fails `aidw analyze` until every TODO(aidw) is replaced; the spec is
 * approved with the change (it is the base of its deltas) and frozen while the change runs.
 */
export function createBaseline(p: Paths, id: string, capability: string): string {
  if (!capability.split("/").every((s) => KEBAB_SEGMENT.test(s))) throw new OpError(`capability "${capability}" must be kebab-case segments (e.g. billing or billing/invoices)`);
  const change = loadChange(p, id);
  const state = String(change.data.state);
  if (!PRE_APPROVAL.has(state)) throw new OpError(`change "${id}" is "${state}"; baseline specs are written during the Analysis (draft, intake, analyzing)`);
  const file = join(p.specs, ...capability.split("/"), "spec.md");
  if (existsSync(file)) throw new OpError(`${rel(p, file)} already exists; a capability gets its baseline once`);
  const head = headCommit(p.project);
  const title = capability.split("/").at(-1)!.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `# ${title}

<!-- aidw:baseline: current behavior of the existing code${head ? ` at ${head.slice(0, 12)}` : ""}, written for change ${id}.
Describe what the code does TODAY (read the code and its tests), not what it should do. Changes go in the change's delta specs. -->

## Purpose

${PLACEHOLDER}: what this capability does today, in one or two sentences.

## Requirements

### Requirement: ${PLACEHOLDER} one current behavior
The system SHALL ${PLACEHOLDER}.

#### Scenario: ${PLACEHOLDER} observed case
- **WHEN** ${PLACEHOLDER}
- **THEN** ${PLACEHOLDER}
`,
  );
  return file;
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

export function newChange(p: Paths, id: string, opts: { title?: string; inputType?: string; workflow?: string; workflows?: string[]; skipSpecs?: boolean; scopeRound?: boolean }): string {
  if (!CHANGE_ID.test(id)) throw new OpError(`change id "${id}" must be kebab-case (e.g. 2026-11-08-booking-app)`);
  if (opts.inputType && !(INPUT_TYPES as readonly string[]).includes(opts.inputType)) {
    throw new OpError(`unknown input type "${opts.inputType}" (expected ${INPUT_TYPES.join(", ")})`);
  }
  if (opts.workflow && opts.workflows && !opts.workflows.includes(opts.workflow)) throw new OpError(`unknown workflow "${opts.workflow}" (expected ${opts.workflows.join(", ")})`);
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
      ...(opts.workflow ? [`workflow: ${opts.workflow}`] : []),
      "state: draft",
      `created_at: ${now()}`,
      `skip_specs: ${opts.skipSpecs === true}`,
      ...(opts.scopeRound ? ["scope_round: true"] : []),
      "approval: null",
      "run:",
      "  paused: null",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "intake.md"), INTAKE(title));
  // the analysis stages the lead reports done (src/stages.ts); its presence also turns off catching up from files
  writeFileSync(join(dir, "stages.yaml"), "done: []\n");
  writeFileSync(join(dir, "analysis.md"), ANALYSIS(title, projectKind(p) === "brownfield", opts.scopeRound === true));
  recordBaseline(p);
  return dir;
}

// Section names must match ANALYSIS_SECTIONS in analyze.ts; `aidw analyze` rejects leftover TODO(aidw).
const ANALYSIS = (title: string, brownfield = false, scopeRound = false) => `# Analysis: ${title}

## Summary

Size: normal (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

${PLACEHOLDER}: one page the user can review in minutes - goal, scope, the 5-10 key decisions, and the risks and assumptions that need their attention.

## Decisions to honor

${PLACEHOLDER}: the concrete choices the code must keep (names, keys, formats, tools, libraries, conventions,
limits), each as "- D1: <decision>" with two indented lines: "Why: <reason, with its evidence>" and
"Rejected: <option> (<why not>)", or "Rejected: none". Implementers stop and report instead of deviating; reviewers
check them. Write "None" only if there are none.

## Requirements and scope

${PLACEHOLDER}: in scope, out of scope, assumptions. Link .aidw/requirements/<change>.md.
${
  brownfield
    ? `
## Existing system

${PLACEHOLDER}: brownfield assessment. What exists (stack from project.yaml, structure, main flows), conventions
the change follows, the health baseline (which existing checks pass or fail today), the capabilities this change
touches and their baseline specs (aidw baseline <capability>), and what must not change.
`
    : ""
}
## Domain

${PLACEHOLDER}: key entities and business rules. Link .aidw/domain/model.md.

## Stack

Source: ${PLACEHOLDER} (client | ai | fallback)

${PLACEHOLDER}: chosen stack and why. If outside the familiar stack pool, say why.

## Design

Mode: ${PLACEHOLDER} (existing | claude_design | ai_design | hybrid)

${PLACEHOLDER}: design references, bundle, or AI design direction. UI work also needs .aidw/design/tokens.yaml.

## Architecture

${PLACEHOLDER}: architecture overview and new ADRs. Link .aidw/architecture/overview.md.

## Specs

${PLACEHOLDER}: capabilities added or changed, number of requirements and scenarios.

## Plan

${PLACEHOLDER}: number of tasks and waves, what can run in parallel, which agents are needed.

## Quality profile

${PLACEHOLDER}: quality layers that run (code, unit, integration, e2e, ui-ux, a11y, security, performance), their thresholds, and why any recommended layer is left out.

## Deploy strategy

${PLACEHOLDER}: local | preview | staging | production (production always asks first).

## Permissions

${PLACEHOLDER}: one bullet per tier-2 resource requested (free cloud resources, preview deploys), or "None".

## Risks and assumptions

${PLACEHOLDER}: what could go wrong and what was assumed.

## Appendix: discovery Q&A

${PLACEHOLDER}: the grilling rounds, questions and answers.
${
  scopeRound
    ? `
### ${SCOPE_ROUND_HEADING}

${PLACEHOLDER}: the checked answer of the \`scope\` Decision Page (vision, scope, mvp, out), word for word.
`
    : ""
}`;

// ---------------------------------------------------------------- full check

/** validate + analyze: what the gate requires before a package can be presented or approved. */
export function readinessCheck(p: Paths, id: string, asState?: string): Diags {
  const d = checkChange(p, id, asState ? { asState } : {});
  d.add(analyzeChange(p, id));
  return d;
}

// ---------------------------------------------------------------- approve

/**
 * The user approves. With `auto` (the Workflow of the Change has a stage with `gate: approval-auto`, e.g. bugfix) aidw
 * records the approval itself, but only while the plan stays inside the Workflow's boundary; beyond it the Change is
 * reclassified to the Workflow named there and waits for the user.
 */
export function approve(p: Paths, id: string, opts: { auto?: { pluginRoot: string } } = {}): { hash: string; files: string[]; by: string } {
  const change = loadChange(p, id);
  let by = "user";
  if (opts.auto) {
    const workflow = typeof change.data.workflow === "string" ? change.data.workflow : "";
    const boundary = workflow ? boundaryOf(opts.auto.pluginRoot, workflow) : null;
    if (!boundary) throw new OpError(`change "${id}" runs under ${workflow ? `the "${workflow}" workflow` : "no named workflow"}, which has no automatic approval: the user approves with /aidw:approve`);
  }
  // ADR-0013: a question in flight is part of the package's work; its answer may still change an Artifact.
  const asking = stageConsultationsInFlight(change);
  if (asking.length) throw new OpError(`change "${id}" has Consultation(s) in flight: ${asking.map((c) => `${c.id} (${c.status})`).join(", ")}; finish them first (\`aidw stages ${id}\` says the step)`);
  const state = stateOf(change);
  if (state !== "awaiting_approval") {
    throw new OpError(`change "${id}" is in state "${String(change.data.state)}"; only "awaiting_approval" can be approved`);
  }
  // ADR-0014: an open Deviation counts its files as they were; approving over it would hash a package nobody checked
  const deviating = openDeviation(change);
  if (deviating) throw new OpError(`Deviation ${deviating.id} of "${id}" is still open: \`aidw deviation close\` or \`aidw deviation abandon\` first`);
  const d = readinessCheck(p, id);
  if (d.errors.length) throw new OpError(`change "${id}" has validation errors; fix them before approving`, d);
  if (opts.auto) {
    const workflow = String(change.data.workflow);
    const boundary = boundaryOf(opts.auto.pluginRoot, workflow)!;
    const exceeded = boundaryExceeded(p, id, boundary);
    if (exceeded.length) {
      change.doc.set("workflow", boundary.reclassify_to);
      if (!boundary.spec_changes && walkFiles(join(change.dir, "specs")).some((f) => f.endsWith("spec.md"))) change.doc.set("skip_specs", false); // it has delta specs after all
      saveChange(change);
      throw new OpError(`change "${id}" is too big to approve itself (${exceeded.join("; ")}). It is now a "${boundary.reclassify_to}" change and waits for the user: present the package and ask for /aidw:approve`);
    }
    // D4: findings the review could not get fixed are the user's to accept, on the gate page that lists them
    const open = carriedFindings(p, change);
    if (open.length) throw new OpError(`the plan review ended with ${open.length} finding(s) still open: the user decides. Present the gate page (it lists them first) and ask for /aidw:approve`);
    by = `aidw (${workflow} boundary)`;
  }
  // ADR-0012: the push grant holds only for the branch, remote URL and base fixed here, hashed with the package.
  const push = bindPush(p, change).binding;
  // D5: the cap on Agent runs is fixed with the approval, so a Deviation that adds tasks does not move it; it is
  // hashed with the package (version 3), so only `aidw cap` moves it afterwards
  const agent_run_cap = agentRunCap(readGrants(change), plannedAgentRuns(change).runs);
  const { hash, files } = computeApprovalHash(p, change, push, { version: PACKAGE_VERSION, cap: { cap: agent_run_cap, raises: [] } });
  change.doc.set("approval", change.doc.createNode({ hash, at: now(), by, package: PACKAGE_VERSION, agent_run_cap, ...(push ? { push } : {}) }));
  change.doc.set("state", "approved");
  saveChange(change);
  return { hash, files, by };
}

// ---------------------------------------------------------------- transition

export function transition(p: Paths, id: string, to: string, opts: { reason?: string; pluginRoot?: string }): { from: State; to: State; commit?: string; notes?: string[] } {
  const change = loadChange(p, id);
  const from = stateOf(change);
  if (!from) throw new OpError(`change "${id}" has an unknown state "${String(change.data.state)}"`);

  const machine = machineOf(p, change);
  let target: State;
  if (to === "resume") {
    if (from !== "paused") throw new OpError(`change "${id}" is not paused`);
    const back = (change.data.run as { paused?: { from?: string } } | undefined)?.paused?.from;
    // a paused change resumes to a state that can pause (every state that can transition to "paused")
    if (!back || !isState(back) || !(machine.transitions[back] ?? []).includes("paused")) {
      throw new OpError(`change "${id}" has no valid paused.from state to resume to`);
    }
    target = back as State;
  } else {
    if (to === "approved") throw new OpError("use `aidw approve` to approve a change");
    if (to === "archived") throw new OpError("use `aidw archive` to archive a change");
    const next = machine.transitions[from] ?? [];
    if (!(next as readonly string[]).includes(to)) {
      const allowed = next.join(", ") || "none";
      throw new OpError(`cannot go from "${from}" to "${to}" (allowed: ${allowed})`);
    }
    target = to as State;
  }

  // "escalated" is the escape hatch (e.g. after drift), so it is reachable without a valid approval.
  if (machine.approvalRequired.has(target) && target !== "escalated") {
    const a = approvalStatus(p, change);
    if (a.status !== "valid") {
      throw new OpError(
        a.status === "none"
          ? `"${target}" requires an approval`
          : "approval drift: the approved Analysis package changed; go back to analyzing (via escalated) and approve again",
      );
    }
  }

  // D12: /aidw:resume finishes a draft pull request: back from delivered to executing, only when something is left
  const reopening = from === "delivered" && target === "executing";
  if (reopening) {
    const why = nothingToFinish(p, change);
    if (why) throw new OpError(why);
  }

  if (from !== "paused") {
    const refused = transitionGuard(p, id, target);
    if (refused) throw new OpError(refused);
  }

  // Re-opening the Analysis after execution: files the approved build already changed are known, not the
  // agent writing before approval, so the backstop must not report them while the package is revised.
  if (from === "escalated" && target === "analyzing") recordBaseline(p);

  if (target === "awaiting_approval") {
    // Validate as if already in the target state, so the user is never asked to approve an incomplete package.
    const d = readinessCheck(p, id, target);
    if (d.errors.length) throw new OpError("Analysis package is not ready for approval", d);
    // D4: after the CLI's own checks, the independent review of architecture and plan (src/planreview.ts).
    const root = opts.pluginRoot ?? bundledRoot();
    const w = root ? loadWorkflow(root, workflowIdOf(p, change)) : null;
    const why = w ? planReviewBlocker(p, change, w) : null;
    if (why) throw new OpError(`"awaiting_approval" needs ${why}`);
  }

  const notes: string[] = [];
  if (BUILD_STATES.has(target)) {
    const note = useChangeBranch(p, change, id);
    if (note) notes.push(note);
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
  if (reopening) notes.push(...reopenDraft(p, id));
  if (target === "delivered") {
    // Quality and deploy evidence plus the final state belong in history; only .aidw/ is committed.
    const commit = commitAidw(p, aidwCommitMessage(`${id} delivered`, `Evidence: .aidw/changes/${id}/evidence/`));
    return { from, to: target, ...(commit ? { commit } : {}), ...(notes.length ? { notes } : {}) };
  }
  return { from, to: target, ...(notes.length ? { notes } : {}) };
}

/** States in which aidw commits task work: HEAD must be on the change branch. */
const BUILD_STATES: ReadonlySet<State> = new Set<State>(["executing", "verifying", "converging", "deploying"]);

export const changeBranchName = (id: string): string => `aidw/${id}`;

/** cwd from a hook's stdin JSON, or the fallback. */
export function hookCwd(stdin: string, fallback: string): string {
  try {
    const c = (JSON.parse(stdin) as { cwd?: unknown }).cwd;
    return typeof c === "string" && c ? c : fallback;
  } catch {
    return fallback;
  }
}

/**
 * `.aidw/` is committed with the code, so a checkout that is not on an unmerged change branch reads stale
 * state. Returns a warning when such branches exist and HEAD is on none of them, else null.
 */
export function offBranchNote(cwd: string, env: NodeJS.ProcessEnv): string | null {
  const dir = findProject({ cwd, env });
  if (!dir || !isGitRepo(dir) || !headCommit(dir)) return null;
  const list = git(dir, ["branch", "--no-merged", "HEAD", "--format=%(refname:short)", "--list", "aidw/*"]);
  const open = list.ok ? list.out.split("\n").filter((b) => b && !b.includes(".")) : [];
  const current = git(dir, ["branch", "--show-current"]).out;
  if (!open.length || open.includes(current)) return null;
  return `AIDW: HEAD is on ${current || "a detached commit"}, but unmerged change branch(es) ${open.join(", ")} hold newer aidw state. Before /aidw:run, /aidw:resume or /aidw:status, run \`git switch ${open[0]}\` (or merge it).`;
}


/**
 * Keeps task commits off the default branch (permissions.md: "commit on the change branch"). The first time
 * the change builds, a default branch or detached HEAD moves to a new `aidw/<id>`; a feature branch the user
 * is already on is kept. The branch is recorded in change.yaml (`run.branch`, `run.base_branch`) and later
 * transitions switch back to it. Returns a note for the user, or null.
 */
function useChangeBranch(p: Paths, change: ReturnType<typeof loadChange>, id: string): string | null {
  if (!isGitRepo(p.project) || !headCommit(p.project)) return null;
  const current = git(p.project, ["branch", "--show-current"]).out;
  const recorded = (change.data.run as { branch?: unknown } | undefined)?.branch;
  if (typeof recorded === "string" && recorded) {
    if (current === recorded) return null;
    const sw = git(p.project, ["switch", "-q", recorded]);
    return sw.ok
      ? `switched to the change branch ${recorded}`
      : `HEAD is on ${current || "a detached commit"}, but this change commits on ${recorded} and switching failed (${sw.err.split("\n")[0]}); switch to ${recorded} before continuing`;
  }
  if (current && !isDefaultBranch(p.project, current)) {
    change.doc.setIn(["run", "branch"], current);
    change.doc.setIn(["run", "base_branch"], null);
    return `committing on your current branch ${current}`;
  }
  const want = changeBranchName(id);
  const exists = git(p.project, ["rev-parse", "--verify", "-q", `refs/heads/${want}`]).ok;
  const sw = git(p.project, exists ? ["switch", "-q", want] : ["switch", "-q", "-c", want]);
  if (!sw.ok) return `could not create the change branch ${want} (${sw.err.split("\n")[0]}); task commits go to ${current || "the detached HEAD"}`;
  change.doc.setIn(["run", "branch"], want);
  change.doc.setIn(["run", "base_branch"], current || null);
  return `task commits go to the new branch ${want} (from ${current || "a detached commit"})`;
}

/**
 * Commits pending changes under .aidw/ plus the delivery files the gate lets in after delivery (README.md,
 * .env.example, and .gitignore, which deploy CLIs edit, e.g. `.vercel`) and nothing else. Returns the commit, or null outside git or when nothing changed.
 */
export function commitAidw(p: Paths, message: string, opts: { delivery?: boolean; guard?: boolean } = {}): string | null {
  if (!isGitRepo(p.project)) return null;
  const paths = [".aidw", ...(opts.delivery ? ["README.md", ".env.example", ".gitignore"].filter((f) => existsSync(join(p.project, f))) : [])];
  if (!git(p.project, ["add", "--", ...paths]).ok) return null;
  if (opts.guard) {
    // T11: this commit is pushed (the pull request, the archive): the same checks as a task commit, before it exists
    const junk = stagedJunk(p.project, paths);
    const secrets = stagedSecrets(p.project, paths);
    if (junk.length || secrets.length) {
      git(p.project, ["reset", "-q", "--", ...paths]);
      throw new OpError(junk.length ? junkMessage(junk) : secretsMessage(secrets));
    }
  }
  if (git(p.project, ["diff", "--cached", "--quiet", "--", ...paths]).ok) return null;
  return git(p.project, ["commit", "-q", "-m", message, "--", ...paths]).ok ? headCommit(p.project) : null;
}

/**
 * `aidw cap <id> --raise <runs>`: the user raises the cap on Agent runs after the gate (D5, D10). The cap lives in the
 * approval record (fixed at `aidw approve`), not in the frozen quality.yaml, so raising it is no Deviation and no drift;
 * each raise is kept in `approval.history`. The gate asks for this command every time: it is the user's decision.
 */
export function raiseCap(p: Paths, id: string, by: number, env: NodeJS.ProcessEnv = process.env): { from: number; to: number } {
  if (env.AIDW_RUNNER === "1") throw new OpError("raising the cap on Agent runs is the user's decision: an unattended session never does it");
  if (!Number.isInteger(by) || by < 1) throw new OpError("--raise takes a positive whole number of Agent runs");
  let change = loadChange(p, id);
  const approval = change.data.approval as Record<string, unknown> | null | undefined;
  if (!approval || typeof approval.hash !== "string") throw new OpError(`change "${id}" is not approved: the cap is set at the Approval Gate (grants.agent_runs in quality.yaml)`);
  if (stateOf(change) === "archived") throw new OpError(`change "${id}" is archived`);
  // rehashing a package that already drifted would launder the drift: the approval must hold first
  if (approvalStatus(p, change).status !== "valid") throw new OpError(`approval drift in "${id}": the cap is raised only on a valid approval`);
  // a Deviation closes against the hash it opened from: raise the cap once it is closed
  if (openDeviation(change)) throw new OpError(`a Deviation of "${id}" is open: raise the cap once it is closed`);
  const from = changeAgentRunCap(change);
  const to = from + by;
  const history = Array.isArray(approval.history) ? (approval.history as unknown[]) : [];
  change.doc.setIn(["approval", "agent_run_cap"], to);
  change.doc.setIn(["approval", "history"], change.doc.createNode([...history, { cap: { from, to }, by: "user", at: now() }]));
  // a version 2 approval has the same files as version 3: it moves to 3, so the raised cap is bound from now on
  if (packageVersionOf(change) === 2) change.doc.setIn(["approval", "package"], 3);
  saveChange(change);
  change = loadChange(p, id);
  change.doc.setIn(["approval", "hash"], computeApprovalHash(p, change).hash);
  saveChange(change);
  return { from, to };
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

export function archiveChange(
  p: Paths,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  opts: { force?: boolean } = {},
): { target: string; merges: CapabilityMerge[]; commit?: string; pushed?: string; pushError?: string } {
  const change = loadChange(p, id);
  if (stateOf(change) !== "delivered") {
    throw new OpError(`change "${id}" is in state "${String(change.data.state)}"; only "delivered" changes can be archived`);
  }
  // the archive commit goes on the checked-out branch: it must be the Change's own
  const branch = (change.data.run as { branch?: unknown } | undefined)?.branch;
  if (typeof branch === "string" && branch && isGitRepo(p.project) && headCommit(p.project)) {
    const current = git(p.project, ["branch", "--show-current"]).out;
    if (current !== branch) throw new OpError(`HEAD is on ${current || "a detached commit"}, not the Change Branch ${branch}: switch to it (git switch ${branch}) and archive again`);
  }
  // D12: a draft stays open so /aidw:resume can finish it; archiving it anyway is the user's call
  const builds = "deploying" in machineOf(p, change).transitions;
  const draft = builds ? draftReason(p, change) : null;
  // archiving a draft as it is, or before the granted pull request opened, is the user's call: never an unattended one
  if (opts.force && env.AIDW_RUNNER === "1") throw new OpError("`aidw archive --force` is the user's decision: an unattended session never archives a Change as it is");
  if (draft && !opts.force) throw new OpError(`change "${id}" ends in a draft pull request (${draft}): /aidw:resume ${id} finishes it; archive it as it is with \`aidw archive ${id} --force\``);
  // with the push granted, the pull request opens before the archive (D12): after it, the grant no longer covers the Change
  const opened = (change.data.run as { pr?: { url?: unknown } } | undefined)?.pr?.url;
  if (builds && !opts.force && boundPush(p, change) && !(typeof opened === "string" && opened)) {
    throw new OpError(`the pull request of "${id}" is not open yet: run \`aidw pr ${id} --create\` first (granted at the Approval Gate; after the archive it asks), or archive without it with \`aidw archive ${id} --force\``);
  }
  const d = checkChange(p, id);
  if (d.errors.length) throw new OpError(`change "${id}" has validation errors; nothing was archived`, d);
  // A Workflow that never deploys (audit) has no delivery package.
  const delivery = builds ? checkDelivery(p, id) : new Diags();
  if (delivery.errors.length) throw new OpError(`the delivery package of "${id}" is incomplete; run \`aidw deliver\` and complete it`, delivery);
  const merges = planMerge(p, id);
  // D12: the pull request opened before the archive, while the push grant covered the Change; the archive commit
  // follows it to the same branch, decided now by the gate's own rule (after the move the Change is no longer covered).
  const pr = (change.data.run as { pr?: { url?: unknown } } | undefined)?.pr;
  const bound = boundPush(p, change);
  const follow = typeof pr?.url === "string" && pr.url && bound && pushGrantReason(p, `git push ${bound.remote} ${bound.branch}`, GRANT_STATES, p.project, env) ? bound : null;

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
  const commit = commitAidw(p, aidwCommitMessage(`archive ${id}`, `Moved-to: ${rel(p, target)}`), { delivery: true });
  if (commit && follow) {
    // checked again right before the push: the binding, the branch, and what this commit carries
    const why = bindingProblem(p, follow) ?? (git(p.project, ["branch", "--show-current"]).out !== follow.branch ? `HEAD is not on ${follow.branch}` : null) ?? commitProblem(p.project, commit);
    if (why) return { target, merges, commit, pushError: `the archive commit was not pushed: ${why}` };
    const r = git(p.project, ["push", follow.remote, follow.branch]);
    if (r.ok) return { target, merges, commit, pushed: `${follow.branch} to ${follow.remote}` };
    return { target, merges, commit, pushError: `pushing the archive commit failed (${(r.err || r.out).split("\n")[0]}); the pull request lacks it until \`git push ${follow.remote} ${follow.branch}\`` };
  }
  return { target, merges, ...(commit ? { commit } : {}) };
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
  /** an open Deviation (ADR-0014): its id, files and author Roles */
  deviation?: { id: string; files: string[]; roles: string[] };
  /** the pull request the run ended in (D12), as recorded: url null while only its body is written */
  pr?: { url: string | null; draft: boolean };
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
        ...((d) => (d ? { deviation: { id: d.id, files: d.files, roles: d.roles } } : {}))(openDeviation(c)),
        ...((r) => (r && typeof r === "object" ? { pr: { url: typeof r.url === "string" && r.url ? r.url : null, draft: r.draft === true } } : {}))((c.data.run as { pr?: { url?: unknown; draft?: unknown } } | undefined)?.pr),
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
