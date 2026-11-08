import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { approvalStatus } from "./approval.js";
import { CHANGE_ID, isState, loadChange, NEEDS_ANALYSIS, POST_APPROVAL, type Change } from "./change.js";
import { Diags } from "./diag.js";
import { capabilityOf, KEBAB_SEGMENT, readText, rel, walkFiles, type Paths } from "./project.js";
import { validateDeltaText, validateSpecText } from "./spec/validate.js";
import { parseQuality } from "./quality.js";
import { validateTasksText } from "./tasks.js";

export interface DeltaFile {
  capability: string;
  file: string;
  mainFile: string;
}

/** Delta spec files of a change, plus diagnostics for files in the wrong place. */
export function deltaFiles(p: Paths, change: Change, d: Diags): DeltaFile[] {
  const specsDir = join(change.dir, "specs");
  const out: DeltaFile[] = [];
  for (const f of walkFiles(specsDir)) {
    const cap = capabilityOf(specsDir, f);
    if (!cap) {
      if (f.endsWith(".md")) {
        d.error(rel(p, f), "delta specs must live at specs/<capability>/spec.md; this file is never merged");
      }
      continue;
    }
    const bad = cap.split("/").find((s) => !KEBAB_SEGMENT.test(s));
    if (bad) d.error(rel(p, f), `capability path segment "${bad}" must be kebab-case`);
    out.push({ capability: cap, file: f, mainFile: join(p.specs, ...cap.split("/"), "spec.md") });
  }
  return out;
}

/** Validates every main spec under .aidw/specs/. */
export function checkSpecs(p: Paths): Diags {
  const d = new Diags();
  for (const f of walkFiles(p.specs)) {
    const cap = capabilityOf(p.specs, f);
    if (!cap) {
      if (f.endsWith(".md")) d.warn(rel(p, f), "not a spec: specs must be named specs/<capability>/spec.md");
      continue;
    }
    d.add(validateSpecText(readFileSync(f, "utf8"), rel(p, f)));
  }
  return d;
}

/** Validates one change: metadata, deltas (with merge preflight), required artifacts by state, tasks, approval. */
export function checkChange(p: Paths, id: string, opts: { asState?: string } = {}): Diags {
  const d = new Diags();
  let change: Change;
  try {
    change = loadChange(p, id);
  } catch (e) {
    d.error(rel(p, join(p.changes, id)), (e as Error).message);
    return d;
  }
  const meta = rel(p, change.file);
  if (!CHANGE_ID.test(id)) d.error(meta, `change id "${id}" must be kebab-case`);
  if (change.data.id !== id) d.error(meta, `id "${String(change.data.id)}" does not match folder name "${id}"`);
  const state = opts.asState ?? change.data.state;
  if (!isState(state)) {
    d.error(meta, `unknown state "${String(state)}"`);
    return d;
  }

  const deltas = deltaFiles(p, change, d);
  for (const df of deltas) {
    d.add(validateDeltaText(readFileSync(df.file, "utf8"), rel(p, df.file), readText(df.mainFile), df.capability));
  }

  const tasksFile = join(change.dir, "tasks.yaml");
  if (existsSync(tasksFile)) d.add(validateTasksText(readFileSync(tasksFile, "utf8"), rel(p, tasksFile)));
  const qFile = join(change.dir, "quality.yaml");
  if (existsSync(qFile)) d.add(parseQuality(readFileSync(qFile, "utf8"), rel(p, qFile)).diags);

  if (NEEDS_ANALYSIS.has(state)) {
    for (const name of ["intake.md", "analysis.md", "tasks.yaml", "quality.yaml"]) {
      if (!existsSync(join(change.dir, name))) d.error(meta, `state "${state}" requires ${name}`);
    }
    if (deltas.length === 0 && change.data.skip_specs !== true) {
      d.error(meta, `state "${state}" requires at least one delta spec, or skip_specs: true when no behavior changes`);
    }
  }

  if (POST_APPROVAL.has(state)) {
    const a = approvalStatus(p, change);
    if (a.status === "none") d.error(meta, `state "${state}" requires an approval; run \`aidw approve ${id}\``);
    if (a.status === "drift") {
      d.error(meta, "approval drift: the approved Analysis package changed after approval; re-run analysis and approve again");
    }
  }
  return d;
}

export function relToChange(change: Change, file: string): string {
  return relative(change.dir, file).split(sep).join("/");
}
