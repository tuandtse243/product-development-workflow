import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { loadRole, loadRoster, loadRuleTable, roleDir } from "./roles.js";

/**
 * Per-Role evals (docs/factory-architecture.md, section 11): an active Role ships at least one case in
 * `roles/<id>/evals/<case>.md` so that editing its knowledge can be checked against its own cases without running a whole
 * Workflow. A case is a situation (`## Input`) and what a good answer must and must not do (`## Criteria`, one bullet each,
 * starting `must` or `must not`). `aidw roster` checks that every active Role has a well-formed case; `aidw eval`
 * (src/evalrun.ts) runs and grades them.
 *
 * The front matter names the case and may say what it covers and what answer it expects (plan C1, C2):
 *
 *   ---
 *   case: contract-has-a-hole
 *   covers: [B1, endpoint-test-matrix]   rule ids of the Role's rules.md table and skill names of its role.md index
 *   expect: ask                          the good answer is a question, not a deliverable
 *   ---
 *
 * A Role whose rules.md is a table must cover every rule and every skill with a case (C1); its last run is recorded in
 * `evals/results.json` (C6), and `aidw roster` warns when that file is missing or older than the Role's content.
 */
export interface EvalCase {
  name: string;
  file: string;
  input: string;
  criteria: string[];
  /** rule ids and skill names of the Role this case checks */
  covers: string[];
  /** `ask`: the right answer asks a question (a hole in the contract), so it is not held to the deliverable's length */
  expect?: "ask";
}

const CASE_KEYS = ["case", "covers", "expect"];

export function loadEvalCases(root: string, id: string): { cases: EvalCase[]; diags: Diags } {
  const d = new Diags();
  const dir = join(roleDir(root, id), "evals");
  const cases: EvalCase[] = [];
  if (!existsSync(dir)) return { cases, diags: d };
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const file = `roles/${id}/evals/${f}`;
    const text = readFileSync(join(dir, f), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    let head: Record<string, unknown> | null = null;
    try {
      const v = fm ? (YAML.parse(fm[1] ?? "") as unknown) : null;
      head = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      head = null;
    }
    const name = head?.case;
    if (!head || typeof name !== "string" || !/^[a-z0-9-]+$/.test(name)) {
      d.error(file, "a case starts with a front matter `case: <name>` (kebab-case)");
      continue;
    }
    if (name !== f.slice(0, -3)) d.error(file, `case "${name}" must equal the file name "${f.slice(0, -3)}"`);
    for (const k of Object.keys(head)) if (!CASE_KEYS.includes(k)) d.error(file, `unknown key "${k}" in the front matter (${CASE_KEYS.join(", ")})`);
    let covers: string[] = [];
    if (head.covers !== undefined) {
      if (!Array.isArray(head.covers) || !head.covers.every((c) => typeof c === "string" && c.trim())) d.error(file, "covers must be a list of rule ids and skill names, e.g. [B7, effects-after-commit]");
      else covers = head.covers as string[];
    }
    if (head.expect !== undefined && head.expect !== "ask") d.error(file, 'expect must be "ask" (or left out: the answer is the deliverable)');
    const section = (title: string) => {
      const m = new RegExp(`^## ${title}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(text);
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
    cases.push({
      name,
      file,
      input: input ?? "",
      criteria: bullets.filter((l) => /^- must( not)? \S/.test(l)).map((l) => l.slice(2)),
      covers,
      ...(head.expect === "ask" ? { expect: "ask" as const } : {}),
    });
  }
  return { cases, diags: d };
}

/** The result file of a Role's last full case run (C6). */
export const resultsFile = (root: string, id: string) => join(roleDir(root, id), "evals", "results.json");

export interface CaseRecord {
  name: string;
  pass: boolean;
  runs: { total: number; passed: number; errors: number };
  /** criteria that failed in at least one run */
  failed: string[];
  error?: string;
}
export interface RunRecord {
  role: string;
  /** ISO time of the run */
  date: string;
  /** the model asked for with --model; null when the claude CLI's default answered */
  model: string | null;
  tier: string;
  runs: number;
  /** roleDigest at the time of the run */
  digest: string;
  cases: CaseRecord[];
}

/**
 * One hash of what a Role is: role.md, rules.md, skills/, references/, scripts/ and the cases (evals/*.md), not the result
 * file. A result file with another digest was made from other content.
 */
export function roleDigest(root: string, id: string): string {
  const dir = roleDir(root, id);
  const files: string[] = [];
  const walk = (rel: string) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const n of readdirSync(abs).sort()) walk(`${rel}/${n}`);
    else files.push(rel);
  };
  for (const f of ["role.md", "rules.md", "skills", "references", "scripts"]) walk(f);
  const evals = join(dir, "evals");
  if (existsSync(evals)) for (const n of readdirSync(evals).filter((x) => x.endsWith(".md")).sort()) files.push(`evals/${n}`);
  const h = createHash("sha256");
  for (const f of files.sort()) h.update(`${f}\0`).update(readFileSync(join(dir, f))).update("\0");
  return `sha256:${h.digest("hex")}`;
}

/** Coverage (C1) and the result file (C6) of one Role. Coverage is required only once its rules.md is a table. */
function checkCoverage(root: string, id: string, cases: EvalCase[], d: Diags): void {
  const table = loadRuleTable(root, id);
  const skills = (loadRole(root, id)?.skills ?? []).map((s) => s.name);
  const known = new Set([...(table ?? []).map((r) => r.id), ...skills]);
  for (const c of cases) for (const x of c.covers) if (!known.has(x)) d.error(c.file, `covers "${x}" is not a rule id or a skill of ${id}`);
  if (!table) return;
  const covered = new Set(cases.flatMap((c) => c.covers));
  for (const r of table) if (!covered.has(r.id)) d.error(`roles/${id}/evals`, `rule ${r.id} has no case (add it to a case's covers:)`);
  for (const s of skills) if (!covered.has(s)) d.error(`roles/${id}/evals`, `skill ${s} has no case (add it to a case's covers:)`);

  const rf = `roles/${id}/evals/results.json`;
  const file = resultsFile(root, id);
  if (!existsSync(file)) {
    d.warn(rf, `missing: run \`aidw eval ${id}\` and commit the file`);
    return;
  }
  let rec: RunRecord;
  try {
    rec = JSON.parse(readFileSync(file, "utf8")) as RunRecord;
  } catch {
    d.warn(rf, `not readable: run \`aidw eval ${id}\` again`);
    return;
  }
  if (rec.digest !== roleDigest(root, id)) d.warn(rf, `older than the Role's content (it changed after the run of ${rec.date}): run \`aidw eval ${id}\` again`);
  else {
    const failed = Array.isArray(rec.cases) ? rec.cases.filter((c) => !c.pass).map((c) => c.name) : [];
    if (failed.length) d.warn(rf, `the last run did not pass ${failed.length} case(s): ${failed.join(", ")}`);
  }
}

/** Every active Role has at least one well-formed case; cases of any Role are well-formed; table Roles cover their rules. */
export function checkEvals(root: string): Diags {
  const d = new Diags();
  if (!existsSync(join(root, "roster.yaml"))) return d;
  const roster = loadRoster(root);
  for (const [id, e] of Object.entries(roster.roles)) {
    if (!existsSync(join(roleDir(root, id), "role.md"))) continue;
    const r = loadEvalCases(root, id);
    d.add(r.diags);
    if (e?.status === "active" && r.cases.length === 0) d.error(`roles/${id}/evals`, "an active Role ships at least one eval case (roles/<id>/evals/<case>.md)");
    checkCoverage(root, id, r.cases, d);
  }
  return d;
}
