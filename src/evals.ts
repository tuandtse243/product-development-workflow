import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Diags } from "./diag.js";
import { loadRoster, roleDir } from "./roles.js";

/**
 * Per-Role evals (docs/factory-architecture.md, section 11): an active Role ships at least one case in
 * `roles/<id>/evals/<case>.md` so that editing its knowledge can be checked against its own cases without running a whole
 * Workflow. A case is a situation (`## Input`) and what a good answer must and must not do (`## Criteria`, one bullet each,
 * starting `must` or `must not`). `aidw roster` checks that every active Role has a well-formed case; `aidw eval`
 * (src/evalrun.ts) runs and grades them.
 */
export interface EvalCase {
  name: string;
  file: string;
  input: string;
  criteria: string[];
}

export function loadEvalCases(root: string, id: string): { cases: EvalCase[]; diags: Diags } {
  const d = new Diags();
  const dir = join(roleDir(root, id), "evals");
  const cases: EvalCase[] = [];
  if (!existsSync(dir)) return { cases, diags: d };
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const file = `roles/${id}/evals/${f}`;
    const text = readFileSync(join(dir, f), "utf8");
    const head = /^---\ncase: ([a-z0-9-]+)\n---\n/.exec(text);
    if (!head) {
      d.error(file, "a case starts with a front matter `case: <name>` (kebab-case)");
      continue;
    }
    if (head[1] !== f.slice(0, -3)) d.error(file, `case "${head[1]}" must equal the file name "${f.slice(0, -3)}"`);
    const section = (name: string) => {
      const m = new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(text);
      return m ? (m[1] as string).trim() : null;
    };
    const input = section("Input");
    const criteria = section("Criteria");
    if (!input) d.error(file, 'missing or empty "## Input" (the situation the Agent is given)');
    if (criteria === null) d.error(file, 'missing "## Criteria"');
    const bullets = (criteria ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const bad = bullets.filter((l) => !/^- must( not)? \S/.test(l));
    for (const l of bad) d.error(file, `criterion "${l.slice(0, 50)}" must be a bullet starting "- must" or "- must not"`);
    if (criteria !== null && !bullets.length) d.error(file, '"## Criteria" has no bullets');
    cases.push({ name: head[1] as string, file, input: input ?? "", criteria: bullets.filter((l) => /^- must( not)? \S/.test(l)).map((l) => l.slice(2)) });
  }
  return { cases, diags: d };
}

/** Every active Role has at least one well-formed case; cases of any Role are well-formed. */
export function checkEvals(root: string): Diags {
  const d = new Diags();
  if (!existsSync(join(root, "roster.yaml"))) return d;
  const roster = loadRoster(root);
  for (const [id, e] of Object.entries(roster.roles)) {
    if (!existsSync(join(roleDir(root, id), "role.md"))) continue;
    const r = loadEvalCases(root, id);
    d.add(r.diags);
    if (e?.status === "active" && r.cases.length === 0) d.error(`roles/${id}/evals`, "an active Role ships at least one eval case (roles/<id>/evals/<case>.md)");
  }
  return d;
}
