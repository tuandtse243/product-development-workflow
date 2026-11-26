/**
 * `aidw analyze`: consistency checks that run before the approval gate (blueprint step 9,
 * Spec Kit "analyze"). The user should never be asked to approve a package whose parts
 * contradict each other.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadChange, type Change } from "./change.js";
import { deltaFiles } from "./check.js";
import { Diags } from "./diag.js";
import { capabilityOf, projectKind, readText, rel, walkFiles, type Paths } from "./project.js";
import { applyDelta } from "./spec/merge.js";
import { parseDelta, parseSpec, sections, slugify } from "./spec/parse.js";
import { parseQuality } from "./quality.js";
import { loadTokens, tokensFile } from "./design.js";
import { isDatabasePath, touchesDatabase } from "./dbpaths.js";
import { touchesApi, touchesUi } from "./skills.js";
import { planAdvice } from "./plan.js";
import { pluginRoot } from "./plugin.js";
import { defaultTaskRole, implementerOf } from "./roles.js";
import { answerOf, checkDecisions, workflowOfChange } from "./decisions.js";
import { checkScopeRound } from "./scope.js";
import { checkBeforeAfter, EXISTING_SYSTEM_FILE, owesBeforeAfter } from "./beforeafter.js";
import { checkProgramDesign, checkSystemDesign, PROGRAM_DESIGN_FILE, programDesignDue } from "./programdesign.js";
import type { Workflow } from "./workflow.js";
import { checkExistingSystem } from "./existingsystem.js";
import { workflowIdOf } from "./machine.js";
import { checkPlanRefs } from "./planrefs.js";

const TITLE_ADVISED = 60;
const isPlanned = (t: { origin?: unknown }): boolean => t.origin === undefined || t.origin === "plan";
import { parseTasks, type Task } from "./tasks.js";

/** Sections every Analysis package must contain (headings are matched case-insensitively). */
export const ANALYSIS_SECTIONS = [
  "Summary",
  "Decisions to honor",
  "Requirements and scope",
  "Domain",
  "Stack",
  "Design",
  "Architecture",
  "Specs",
  "Plan",
  "Quality profile",
  "Deploy strategy",
  "Permissions",
  "Risks and assumptions",
] as const;

export const PLACEHOLDER = "TODO(aidw)";

/** `- D1: ...` bullets of "## Decisions to honor": concrete approved choices the code must keep. */
const DECISION = /^\s*[-*]\s+\**(D\d+)\**\s*:\s*(\S.*)$/;

interface Decision {
  id: string;
  /** The bullet and its indented `Why:` / `Rejected:` lines, joined into one line. */
  text: string;
}

/**
 * The decisions of "## Decisions to honor". Since D6 a decision records what was chosen, why, and why the other
 * options were not: indented lines under the bullet (`  Why: ...`, `  Rejected: ...`) belong to it. The old
 * one-line form (`- D1: <decision>`) is read the same way and only lacks the reasons.
 */
function decisionRecords(body: string): Decision[] {
  const out: { id: string; parts: string[] }[] = [];
  let cur: { id: string; parts: string[] } | null = null;
  for (const l of body.split(/\r?\n/)) {
    const m = DECISION.exec(l);
    if (m) out.push((cur = { id: m[1] as string, parts: [(m[2] as string).trim()] }));
    else if (cur && /^\s+\S/.test(l) && !/^\s*[-*]\s/.test(l)) cur.parts.push(l.trim());
    else if (!/^\s*$/.test(l)) cur = null; // a blank line keeps the decision open for its indented reasons
  }
  return out.map((d) => ({ id: d.id, text: d.parts.join(" ") }));
}

/** The approved decisions every implementer and reviewer must honor (empty when the section says None). */
export function decisionsToHonor(analysis: string): string[] {
  const s = sections(analysis).find((x) => x.name.toLowerCase() === "decisions to honor");
  if (!s) return [];
  return decisionRecords(s.body).map((d) => `${d.id}: ${d.text}`);
}
export const STACK_SOURCES = ["client", "ai", "fallback"] as const;
export const DESIGN_MODES = ["existing", "claude_design", "ai_design", "hybrid"] as const;

export const reqId = (capability: string, name: string) => `${capability}/${slugify(name)}`;
export const scenarioId = (capability: string, req: string, scenario: string) => `${reqId(capability, req)}/${slugify(scenario)}`;

export interface IdIndex {
  requirements: Set<string>;
  scenarios: Set<string>;
}

function indexSpec(capability: string, text: string, into: IdIndex): void {
  for (const r of parseSpec(text).requirements) {
    into.requirements.add(reqId(capability, r.name));
    for (const s of r.scenarios) into.scenarios.add(scenarioId(capability, r.name, s.name));
  }
}

/** Requirement and scenario ids of the current main specs. */
export function mainSpecIds(p: Paths): IdIndex {
  const ids: IdIndex = { requirements: new Set(), scenarios: new Set() };
  for (const f of walkFiles(p.specs)) {
    const cap = capabilityOf(p.specs, f);
    if (cap) indexSpec(cap, readFileSync(f, "utf8"), ids);
  }
  return ids;
}

/**
 * Requirement and scenario ids of the system as it will be after this change:
 * main specs with every delta applied in memory.
 */
export function idsAfterChange(p: Paths, id: string): { ids: IdIndex; changed: IdIndex } {
  const ids: IdIndex = { requirements: new Set(), scenarios: new Set() };
  const changed: IdIndex = { requirements: new Set(), scenarios: new Set() };
  const { specs, deltas } = specsAfterChange(p, id);
  for (const [cap, text] of specs) indexSpec(cap, text, ids);
  for (const [cap, deltaText] of deltas) {
    const delta = parseDelta(deltaText);
    for (const r of [...delta.added, ...delta.modified]) {
      changed.requirements.add(reqId(cap, r.name));
      for (const s of r.scenarios) changed.scenarios.add(scenarioId(cap, r.name, s.name));
    }
  }
  return { ids, changed };
}

/** Spec text per capability as it will be after this change (deltas applied in memory). */
export function specsAfterChange(p: Paths, id: string): { specs: Map<string, string>; deltas: Map<string, string> } {
  const change = loadChange(p, id);
  const specs = new Map<string, string>();
  const deltas = new Map<string, string>();
  const files = deltaFiles(p, change, new Diags());
  const touched = new Set(files.map((d) => d.capability));
  for (const f of walkFiles(p.specs)) {
    const cap = capabilityOf(p.specs, f);
    if (cap && !touched.has(cap)) specs.set(cap, readFileSync(f, "utf8"));
  }
  for (const df of files) {
    const deltaText = readFileSync(df.file, "utf8");
    deltas.set(df.capability, deltaText);
    const merged = applyDelta(readText(df.mainFile), deltaText, df.capability);
    specs.set(df.capability, merged.ok && merged.text ? merged.text : (readText(df.mainFile) ?? ""));
  }
  return { specs, deltas };
}

/** Requirement blocks by id (`<capability>/<requirement>`) after this change. */
export function requirementsAfterChange(p: Paths, id: string): Map<string, { capability: string; raw: string; scenarios: string[] }> {
  const out = new Map<string, { capability: string; raw: string; scenarios: string[] }>();
  for (const [cap, text] of specsAfterChange(p, id).specs) {
    for (const r of parseSpec(text).requirements) {
      out.set(reqId(cap, r.name), { capability: cap, raw: r.raw, scenarios: r.scenarios.map((s) => scenarioId(cap, r.name, s.name)) });
    }
  }
  return out;
}

function checkAnalysisDoc(text: string, file: string, d: Diags): void {
  const secs = sections(text);
  const byName = new Map(secs.map((s) => [s.name.toLowerCase(), s]));
  for (const name of ANALYSIS_SECTIONS) {
    const s = byName.get(name.toLowerCase());
    if (!s) d.error(file, `missing section "## ${name}"`);
    else if (!s.body) d.error(file, `section "## ${name}" is empty`, s.line);
  }
  text.split(/\r?\n/).forEach((l, i) => {
    if (l.includes(PLACEHOLDER)) d.error(file, `unresolved ${PLACEHOLDER} placeholder`, i + 1);
  });

  const stack = byName.get("stack");
  if (stack && !new RegExp(`^Source:\\s*(${STACK_SOURCES.join("|")})\\b`, "im").test(stack.body)) {
    d.error(file, `"## Stack" must declare "Source: ${STACK_SOURCES.join(" | ")}"`, stack.line);
  }
  const design = byName.get("design");
  if (design && !new RegExp(`^Mode:\\s*(${DESIGN_MODES.join("|")})\\b`, "im").test(design.body)) {
    d.error(file, `"## Design" must declare "Mode: ${DESIGN_MODES.join(" | ")}"`, design.line);
  }
  const honor = byName.get("decisions to honor");
  if (honor && honor.body && !/^\s*none\b/im.test(honor.body)) {
    const bullets = honor.body.split(/\r?\n/).filter((l) => /^\s*[-*]\s+\S/.test(l));
    const ids = new Set<string>();
    for (const l of bullets) {
      const m = DECISION.exec(l);
      if (!m) d.error(file, `"## Decisions to honor": "${l.trim().slice(0, 60)}" must be "- D<n>: <decision>"`, honor.line);
      else if (ids.has(m[1] as string)) d.error(file, `"## Decisions to honor": duplicate ${m[1]}`, honor.line);
      else ids.add(m[1] as string);
    }
    if (!bullets.length) d.error(file, '"## Decisions to honor" must list "- D<n>: <decision>" bullets, or say "None"', honor.line);
    // D6: a warning, not an error, so a Change written before the rule (one line per decision) still passes
    for (const r of decisionRecords(honor.body)) {
      const missing = [/\bWhy:/i.test(r.text) ? "" : '"Why:"', /\bRejected:/i.test(r.text) ? "" : '"Rejected:"'].filter(Boolean);
      if (missing.length)
        d.warn(file, `"## Decisions to honor": ${r.id} says no ${missing.join(" and no ")}: add indented lines "Why: <reason>" and "Rejected: <option> (<why not>)", or "Rejected: none"`, honor.line);
    }
  }
  const perms = byName.get("permissions");
  if (perms && !/^\s*[-*]\s+\S/m.test(perms.body) && !/^\s*none\b/im.test(perms.body)) {
    d.error(file, '"## Permissions" must list each tier-2 resource as a bullet, or say "None"', perms.line);
  }
}

export const SIZES = ["small", "normal"] as const;
export type Size = (typeof SIZES)[number];
/** Layers a small change may run: code and unit always, e2e when it touches UI. */
const SMALL_LAYERS = new Set(["code", "unit", "integration", "e2e", "a11y"]);
export const SMALL_MAX_TASKS = 3;

/** `Size: small | normal` in the Analysis (default normal); the user confirms it at the gate with the rest of the file. */
export function sizeOf(analysis: string | null): Size | "invalid" {
  const m = analysis === null ? null : /^Size:\s*(\S+)/im.exec(analysis);
  if (!m) return "normal";
  const v = (m[1] as string).toLowerCase().replace(/[.,;]$/, "");
  return (SIZES as readonly string[]).includes(v) ? (v as Size) : "invalid";
}

/**
 * Whether a Change owes a scope round is recorded on the Change when it is created (`scope_round: true`, from its
 * Workflow), or `scope_gate: true` for one started under the old gate. Deciding it from the Workflow at analyze time
 * would refuse older Changes whose approved analysis.md can no longer change.
 */
const scopeRoundOf = (change: Change): boolean => change.data.scope_round === true || change.data.scope_gate === true;

/** The Workflow of the Change, or null when the plugin cannot say (no roster, an unknown Workflow). */
function workflowOrNull(p: Paths, change: Change): Workflow | null {
  const root = pluginRoot(process.env);
  if (!existsSync(join(root, "roster.yaml"))) return null;
  try {
    return workflowOfChange(p, change, root);
  } catch {
    return null;
  }
}

/** Runs every pre-gate consistency check for one change. */
export function analyzeChange(p: Paths, id: string): Diags {
  const d = new Diags();
  const change = loadChange(p, id);

  const analysisFile = join(change.dir, "analysis.md");
  const analysis = readText(analysisFile);
  const due = programDesignDue(change, workflowOrNull(p, change), sizeOf(analysis) === "small");
  if (analysis === null) d.error(rel(p, analysisFile), "analysis.md is missing");
  else {
    checkAnalysisDoc(analysis, rel(p, analysisFile), d);
    // ADR-0011: a Workflow with a scope round (product) records it in the discovery appendix before the gate.
    if (scopeRoundOf(change)) d.add(checkScopeRound(change, analysis, rel(p, analysisFile)));
    // D1, I9: Before / After as the user sees it, and the technical questions deferred to the Software Architect.
    if (owesBeforeAfter(change)) checkBeforeAfter(analysis, rel(p, analysisFile), { existingSystem: existsSync(join(change.dir, EXISTING_SYSTEM_FILE)) }, d);
    // D2, D3, Q5: the Design Questions are settled, and a normal Change records its system design round.
    if (due.programDesign || due.round) checkSystemDesign(analysis, rel(p, analysisFile), { round: due.round }, d);
    // S10: a brownfield change states what exists and what it must not break.
    if (projectKind(p) === "brownfield") {
      const existing = sections(analysis).find((s) => s.name.toLowerCase() === "existing system");
      if (!existing) d.error(rel(p, analysisFile), 'brownfield project: missing section "## Existing system" (assessment of the current code)');
      else if (!existing.body) d.error(rel(p, analysisFile), 'section "## Existing system" is empty', existing.line);
      // I1, Q3, M2 (ADR-0016): the Existing System Report, its questions and parts; older Changes are not judged again.
      if (owesBeforeAfter(change)) {
        const opts = { dir: change.dir, shown: rel(p, change.dir), analysisFile: rel(p, analysisFile), bugfix: workflowIdOf(p, change) === "bugfix", small: sizeOf(analysis) === "small" };
        checkExistingSystem(analysis, opts, d);
      }
    }
  }
  // I5, Q2, Q5: the Program Design has its required parts (the short one of a small Change too).
  if (due.programDesign) checkProgramDesign(p, change, { small: sizeOf(analysis) === "small" }, d);
  // Baseline specs (aidw baseline) start as skeletons; an unfinished one must not reach the gate.
  for (const f of walkFiles(p.specs)) {
    if (!f.endsWith(".md")) continue;
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .forEach((l, i) => {
        if (l.includes(PLACEHOLDER)) d.error(rel(p, f), `unfinished baseline spec: unresolved ${PLACEHOLDER} placeholder`, i + 1);
      });
  }

  // Every tier-2 resource in quality.yaml must be named in the human-readable "## Permissions".
  const qText = readText(join(change.dir, "quality.yaml"));
  const quality = qText === null ? null : parseQuality(qText, "quality.yaml").config;
  if (quality && analysis !== null) {
    const perms = sections(analysis).find((s) => s.name.toLowerCase() === "permissions");
    for (const key of quality.permissions) {
      if (perms && !perms.body.includes(key)) {
        d.error(rel(p, analysisFile), `"## Permissions" must name the tier-2 resource "${key}" that quality.yaml requests`, perms.line);
      }
    }
    if (perms && quality.permissions.length === 0 && /^\s*[-*]\s+\S/m.test(perms.body) && !/^\s*none\b/im.test(perms.body)) {
      d.warn(rel(p, analysisFile), '"## Permissions" lists resources but quality.yaml requests none; add their keys to quality.yaml permissions or write "None"', perms.line);
    }
  }

  const tasksFile = join(change.dir, "tasks.yaml");
  const tasksText = readText(tasksFile);
  if (tasksText === null) {
    d.error(rel(p, tasksFile), "tasks.yaml is missing");
    return d;
  }
  const { tasks, error } = parseTasks(tasksText);
  if (error) return d; // structural errors are reported by validate

  // Decision Points of the Workflow (ADR-0003): required ones recorded, answers inside their options, consistent with the plan.
  if (existsSync(join(pluginRoot(process.env), "roster.yaml"))) {
    d.add(checkDecisions(p, change, pluginRoot(process.env)));
    const design = answerOf(change, "design-needed");
    const uiTasks = tasks.filter((t: Task) => touchesUi(t)).map((t) => t.id);
    if (design?.[0] === "no-ui" && uiTasks.length) {
      d.error(rel(p, join(change.dir, "decisions.yaml")), `decision "design-needed" is no-ui, but task(s) ${uiTasks.join(", ")} change UI`);
    }
  }

  // UI work is reviewed against machine-readable design tokens, so a UI plan needs them before approval.
  const tokens = loadTokens(p);
  d.add(tokens.diags);
  const ui = tasks.filter((t: Task) => touchesUi(t)).map((t) => t.id);
  if (ui.length && !tokens.exists) {
    d.error(rel(p, tokensFile(p)), `missing: task(s) ${ui.join(", ")} change UI, so the design needs tokens with use rules (see /aidw:start step 5)`);
  }

  // Every planned task is run by the Agent of its Role: an unknown Role, or one that cannot write code, falls back to fullstack.
  const root = pluginRoot(process.env);
  if (existsSync(join(root, "roster.yaml"))) {
    for (const t of tasks) {
      if (isPlanned(t) && typeof t.role === "string" && implementerOf(root, t.role) === null) {
        d.warn(rel(p, tasksFile), `task ${t.id}: role "${t.role}" cannot run a task (use fullstack, frontend or backend, or a Planned Role that one of them carries); fullstack will run it`);
      }
    }
  }

  const { ids, changed } = idsAfterChange(p, id);
  const coveredReqs = new Set<string>();
  const coveredScenarios = new Set<string>();
  const tf = rel(p, tasksFile);
  for (const t of tasks) {
    const specs = Array.isArray(t.specs) ? (t.specs as unknown[]).map(String) : [];
    const scenarios = Array.isArray(t.scenarios) ? (t.scenarios as unknown[]).map(String) : [];
    for (const s of specs) {
      if (!ids.requirements.has(s)) d.error(tf, `task ${t.id} references unknown requirement "${s}" (see \`aidw ids ${id}\`)`);
      coveredReqs.add(s);
    }
    for (const s of scenarios) {
      if (!ids.scenarios.has(s)) d.error(tf, `task ${t.id} references unknown scenario "${s}" (see \`aidw ids ${id}\`)`);
      coveredScenarios.add(s);
      coveredReqs.add(s.split("/").slice(0, -1).join("/"));
    }
  }
  for (const r of changed.requirements) {
    if (!coveredReqs.has(r)) d.error(tf, `requirement "${r}" changed by this change is not covered by any task`);
  }
  for (const s of changed.scenarios) {
    if (!coveredScenarios.has(s)) d.error(tf, `scenario "${s}" has no task that implements and verifies it`);
  }
  uiScenarioAdvice(p, id, tasks, d, tf);
  for (const t of tasks) {
    if (isPlanned(t) && String(t.title ?? "").length > TITLE_ADVISED) {
      d.warn(tf, `task ${t.id} title is ${String(t.title).length} characters: it becomes the commit subject (72 characters with the prefix). Keep it under ${TITLE_ADVISED}`);
    }
    const globs = Array.isArray(t.touches) ? (t.touches as unknown[]).map(String) : [];
    if (isPlanned(t) && touchesDatabase(globs)) {
      // The schema and its migrations are one task, owned by the Role that writes migrations, never folded into a scaffold
      // or a feature (the notes-app run did: its scaffold task made the tables). The pieces around it depend on it.
      const role = String(t.role ?? defaultTaskRole());
      const root = pluginRoot(process.env);
      const owned = globs.filter((g) => isDatabasePath(g)).slice(0, 3).map((g) => `"${g}"`).join(", ");
      if (role !== "database" && implementerOf(root, "database") !== null) {
        d.error(tf, `task ${t.id} changes the database schema or migrations (touches ${owned}) but its role is "${role}": a migration is always its own task, owned by "database" with "risk: high". Move those files into a database task and make the tasks that use the new tables depend on it (roles/technical-planner/skills/migration-tasks.md)`);
      }
      if (role === "database" && (touchesUi(t) || touchesApi(t))) {
        d.error(tf, `task ${t.id} is owned by "database" but also touches UI or API files: a database task changes only the schema, migrations, seeds and their tests. Put the rest in its own task`);
      }
      if (t.risk !== "high") {
        d.warn(tf, `task ${t.id} touches database migrations but is not "risk: high": migrations run alone, must be reversible and tested against a seeded database (roles/qa/references/quality-layers.md)`);
      }
    }
  }
  // A change with UI gets the a11y layer (axe) by default; leaving it out needs a reason in "## Quality profile".
  if (quality && ui.length && !quality.layers.some((l) => l.name === "a11y")) {
    const profile = sections(analysis ?? "").find((s) => s.name.toLowerCase() === "quality profile")?.body ?? "";
    if (!/a11y|accessib/i.test(profile)) {
      d.error(rel(p, join(change.dir, "quality.yaml")), `task(s) ${ui.join(", ")} change UI but there is no a11y layer: add it (axe through Playwright, see roles/qa/references/quality-layers.md) or say in "## Quality profile" why a11y is left out`);
    }
  }
  const size = sizeOf(analysis);
  if (size === "invalid") d.error(rel(p, analysisFile), 'invalid "Size:" line: write "Size: small" or "Size: normal"');
  if (size === "small") {
    if (tasks.length > SMALL_MAX_TASKS) d.error(tf, `Size: small allows at most ${SMALL_MAX_TASKS} tasks (${tasks.length} planned): make it Size: normal or cut the scope`);
    for (const l of quality?.layers ?? []) {
      if (!SMALL_LAYERS.has(l.name)) d.warn(rel(p, analysisFile), `Size: small normally runs only code, unit, e2e and a11y (UI); layer "${l.name}" was added: say why in "## Quality profile" or drop it`);
    }
    if (quality && quality.deploy.target !== "none") d.warn(rel(p, analysisFile), "Size: small does not deploy unless the user asked for it; set the deploy target to none");
  }
  for (const advice of planAdvice(tasks)) d.warn(tf, advice);
  // I3, R8, OP3: patterns point at code that exists, each docs entry has a fresh Docs Brief, new libraries are researched.
  checkPlanRefs(p, change, tasks, tf, d, { programDesign: due.programDesign ? readText(join(change.dir, PROGRAM_DESIGN_FILE)) : null });
  return d;
}

/** A scenario whose WHEN is a user gesture (click, tap, "bấm"...). */
const UI_GESTURE = /\b(clicks?|taps?|presses|pressed|selects?|opens?|toggles?|button|dialog|screen|page)\b|bấm|nhấn|chạm|chọn|nút\b|màn hình|màn\b/i;
const BROWSER_VERIFY_RE = /\b(playwright|cypress|e2e)\b/i;

/** WHEN line of each scenario of a requirement block, by scenario name. */
function scenarioWhens(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  let name = "";
  for (const line of raw.split("\n")) {
    const h = /^####\s+Scenario:\s*(.+?)\s*$/.exec(line);
    if (h) name = h[1] as string;
    else if (name && /\*\*WHEN\*\*/.test(line)) out.set(name, line);
  }
  return out;
}

/**
 * Trial-3A: a spec said "the user clicks Export CSV on the list screen" but the only task for it touched the API,
 * so the plan shipped without the button and every check still passed. A scenario triggered from the UI needs a task
 * that touches UI files (or drives a browser) among those that implement it.
 */
function uiScenarioAdvice(p: Paths, id: string, tasks: Task[], d: Diags, tf: string): void {
  const { deltas } = specsAfterChange(p, id);
  for (const [cap, text] of deltas) {
    const delta = parseDelta(text);
    for (const r of [...delta.added, ...delta.modified]) {
      for (const [name, when] of scenarioWhens(r.raw)) {
        if (!UI_GESTURE.test(when)) continue;
        const sid = scenarioId(cap, r.name, name);
        const owners = tasks.filter((t) => Array.isArray(t.scenarios) && (t.scenarios as unknown[]).map(String).includes(sid));
        const reachesUi = owners.some((t) => touchesUi(t) || (Array.isArray(t.verify) && (t.verify as unknown[]).some((v) => BROWSER_VERIFY_RE.test(String(v)))));
        if (owners.length && !reachesUi) {
          d.warn(tf, `scenario "${sid}" is triggered from the UI ("${when.replace(/^[-*\s]*\*\*WHEN\*\*\s*/, "").slice(0, 80)}") but task(s) ${owners.map((t) => t.id).join(", ")} touch no UI files and run no browser test: add the UI work to a task`);
        }
      }
    }
  }
}
