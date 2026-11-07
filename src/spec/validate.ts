import { Diags } from "../diag.js";
import { applyDelta } from "./merge.js";
import { parseDelta, parseSpec, type RequirementBlock } from "./parse.js";

export const MAX_DESCRIPTION = 500;
export const MIN_PURPOSE = 50;

function checkRequirement(r: RequirementBlock, file: string, d: Diags): void {
  for (const i of r.issues) {
    if (i.level === "error") d.error(file, i.message, i.line);
    else d.warn(file, i.message, i.line);
  }
  if (!r.name) d.error(file, "Requirement heading has no name", r.line);
  if (!r.description) {
    d.warn(file, `Requirement "${r.name}" has no description before its first scenario`, r.line);
  } else {
    if (!/\b(SHALL|MUST)\b/.test(r.description)) {
      d.warn(file, `Requirement "${r.name}" should state its behavior with SHALL or MUST`, r.line);
    }
    if (r.description.length > MAX_DESCRIPTION) {
      d.warn(
        file,
        `Requirement "${r.name}" description is ${r.description.length} characters (max ${MAX_DESCRIPTION}); state one behavior per requirement`,
        r.line,
      );
    }
  }
  if (r.scenarios.length === 0) {
    d.error(file, `Requirement "${r.name}" must have at least one "#### Scenario:"`, r.line);
  }
  const seen = new Set<string>();
  for (const s of r.scenarios) {
    if (seen.has(s.name)) d.error(file, `Requirement "${r.name}" has duplicate scenario "${s.name}"`, s.line);
    seen.add(s.name);
    if (!s.hasTrigger) d.warn(file, `Scenario "${s.name}" has no **WHEN** or **GIVEN** step`, s.line);
    if (!s.hasOutcome) d.warn(file, `Scenario "${s.name}" has no **THEN** step`, s.line);
  }
}

/** Validates a main spec (.aidw/specs/<capability>/spec.md). */
export function validateSpecText(text: string, file: string): Diags {
  const d = new Diags();
  const spec = parseSpec(text);
  if (!spec.title) d.error(file, 'Spec is missing a "# <Title>" heading');
  if (!spec.hasPurpose) d.warn(file, 'Spec is missing a "## Purpose" section');
  else if ((spec.purpose ?? "").length < MIN_PURPOSE || /^TBD\b/i.test(spec.purpose ?? "")) {
    d.warn(file, `Purpose is too brief or a placeholder (min ${MIN_PURPOSE} characters)`);
  }
  if (!spec.hasRequirementsSection) d.error(file, 'Spec is missing a "## Requirements" section');
  else if (spec.requirements.length === 0) d.warn(file, "Spec has no requirements");

  const seen = new Map<string, number>();
  for (const r of spec.requirements) {
    const prev = seen.get(r.key);
    if (prev !== undefined) d.error(file, `Duplicate requirement "${r.key}" (first at line ${prev})`, r.line);
    else seen.set(r.key, r.line);
    checkRequirement(r, file, d);
  }
  return d;
}

/**
 * Validates a delta spec and runs the archive merge against the current main spec
 * without writing anything, so a change that cannot archive fails validation early.
 */
export function validateDeltaText(text: string, file: string, mainText: string | null, capability: string): Diags {
  const d = new Diags();
  const delta = parseDelta(text);
  const ops = delta.added.length + delta.modified.length + delta.removed.length + delta.renamed.length;
  if (ops === 0) {
    d.error(file, "Delta spec has no ADDED, MODIFIED, REMOVED or RENAMED requirements");
  }
  for (const s of delta.unknownSections) {
    d.warn(file, `Unknown section "## ${s.name}" is ignored by merge`, s.line);
  }
  for (const r of [...delta.added, ...delta.modified]) checkRequirement(r, file, d);
  for (const r of delta.removed) {
    if (!r.reason) d.error(file, `REMOVED requirement "${r.name}" needs a **Reason**`, r.line);
    if (!r.migration) d.error(file, `REMOVED requirement "${r.name}" needs a **Migration**`, r.line);
  }
  if (mainText === null) {
    if (!delta.purpose) d.warn(file, `New capability "${capability}" should start with a "## Purpose" section`);
    else if (delta.purpose.length < MIN_PURPOSE) {
      d.warn(file, `Purpose for new capability "${capability}" is too brief (min ${MIN_PURPOSE} characters)`);
    }
  } else if (delta.purpose) {
    d.warn(file, "## Purpose in a delta for an existing capability is ignored; edit the main spec instead");
  }

  const merge = applyDelta(mainText, text, capability);
  for (const e of merge.errors) d.error(file, `merge: ${e}`);
  if (merge.ok && merge.text) {
    const merged = validateSpecText(merge.text, `${file} (merged result)`);
    for (const e of merged.errors) d.error(e.file, e.message);
  }
  return d;
}
