/**
 * `aidw analyze`: consistency checks that run before the approval gate (blueprint step 9,
 * Spec Kit "analyze"). The user should never be asked to approve a package whose parts
 * contradict each other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadChange } from "./change.js";
import { deltaFiles } from "./check.js";
import { Diags } from "./diag.js";
import { capabilityOf, projectKind, readText, rel, walkFiles, type Paths } from "./project.js";
import { applyDelta } from "./spec/merge.js";
import { parseDelta, parseSpec, sections, slugify } from "./spec/parse.js";
import { parseQuality } from "./quality.js";
import { loadTokens, tokensFile } from "./design.js";
import { touchesUi } from "./skills.js";
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

/** The approved decisions every implementer and reviewer must honor (empty when the section says None). */
export function decisionsToHonor(analysis: string): string[] {
  const s = sections(analysis).find((x) => x.name.toLowerCase() === "decisions to honor");
  if (!s) return [];
  return s.body
    .split(/\r?\n/)
    .map((l) => DECISION.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}: ${(m[2] as string).trim()}`);
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
  }
  const perms = byName.get("permissions");
  if (perms && !/^\s*[-*]\s+\S/m.test(perms.body) && !/^\s*none\b/im.test(perms.body)) {
    d.error(file, '"## Permissions" must list each tier-2 resource as a bullet, or say "None"', perms.line);
  }
}

/** Runs every pre-gate consistency check for one change. */
export function analyzeChange(p: Paths, id: string): Diags {
  const d = new Diags();
  const change = loadChange(p, id);

  const analysisFile = join(change.dir, "analysis.md");
  const analysis = readText(analysisFile);
  if (analysis === null) d.error(rel(p, analysisFile), "analysis.md is missing");
  else {
    checkAnalysisDoc(analysis, rel(p, analysisFile), d);
    // S10: a brownfield change states what exists and what it must not break.
    if (projectKind(p) === "brownfield") {
      const existing = sections(analysis).find((s) => s.name.toLowerCase() === "existing system");
      if (!existing) d.error(rel(p, analysisFile), 'brownfield project: missing section "## Existing system" (assessment of the current code)');
      else if (!existing.body) d.error(rel(p, analysisFile), 'section "## Existing system" is empty', existing.line);
    }
  }
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

  // UI work is reviewed against machine-readable design tokens, so a UI plan needs them before approval.
  const tokens = loadTokens(p);
  d.add(tokens.diags);
  const ui = tasks.filter((t: Task) => touchesUi(t)).map((t) => t.id);
  if (ui.length && !tokens.exists) {
    d.error(rel(p, tokensFile(p)), `missing: task(s) ${ui.join(", ")} change UI, so the design needs tokens with use rules (see /aidw:start step 5)`);
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
  return d;
}
