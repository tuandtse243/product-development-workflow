import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { LIBRARY_SKILL, loadRole, loadRoster, loadRuleTable, parseRoleText, roleDir, skillFile, tierModel } from "./roles.js";

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
 * A Role whose rules.md is a table must cover every rule and every skill with a case (C1); its runs are recorded in
 * `evals/results.json` (C6, see RunRecord), and `aidw roster` warns when that file is missing or older than the Role's
 * shared content, or when a case has no entry or one older than its case file.
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

/**
 * The body of a case's `## <title>` section, up to the next `## ` heading. A heading inside a fenced block (``` or ~~~)
 * is part of the quoted material, not of the case: an Input that quotes a Markdown file keeps its `## ` lines.
 */
export function caseSection(text: string, title: string): string | null {
  const lines = text.split("\n");
  let fence: string | null = null;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      const mark = f[1] as string;
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
      continue;
    }
    if (fence !== null || !line.startsWith("## ")) continue;
    if (start >= 0) return lines.slice(start, i).join("\n").trim();
    if (line.trimEnd() === `## ${title}`) start = i + 1;
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

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
    const section = (title: string) => caseSection(text, title);
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

/** The result file of a Role's cases (C6). */
export const resultsFile = (root: string, id: string) => join(roleDir(root, id), "evals", "results.json");

/** The entries of a result file's `cases` that are objects with a name; a hand-edited file may hold anything there. */
export function caseEntries(cases: unknown): CaseRecord[] {
  return Array.isArray(cases) ? cases.filter((c): c is CaseRecord => !!c && typeof c === "object" && typeof (c as CaseRecord).name === "string") : [];
}

/** The format of the result file written today; a file without `format` is the old one (one digest over the whole Role). */
export const RESULTS_FORMAT = 2;

export interface CaseRecord {
  name: string;
  pass: boolean;
  runs: { total: number; passed: number; errors: number };
  /** criteria that failed in at least one run */
  failed: string[];
  error?: string;
  /** format 2: caseDigest of the case file this entry was run from */
  digest?: string;
  /** format 2: ISO time of the run that made this entry */
  date?: string;
  /** format 2: the model asked for in the run that made this entry; null is the claude CLI's default at `date` */
  model?: string | null;
}
/**
 * `roles/<id>/evals/results.json`. Format 2 (`format: 2`): `digest` is the sharedDigest of the Role (all its content but
 * its case files) at the last write, and each case entry carries the caseDigest of its own case file and the `date` it
 * ran. A case's answer depends only on the shared content and its own case file, so a case whose file changed is run
 * again alone (`aidw eval <id> --case <name>`), which replaces only its entry. A full run writes a fresh file. Top-level
 * `date` is the time of the last write (a full run or one case); `runs` is the fewest runs any entry had. Entries of
 * cases that no longer exist are dropped on each write. Each entry also records the model asked for (`model`, null for
 * the claude CLI's default); a merge needs the same model, but null means the default at that entry's date, so a file
 * merged over time can mix the defaults of different dates (the actual model is not detected). Digests are taken
 * before the run starts. A file without `format` is the old format: `digest` is the roleDigest of the whole Role, and
 * only a full run replaces it.
 */
export interface RunRecord {
  format?: number;
  role: string;
  /** ISO time of the last write */
  date: string;
  /** the model asked for at the last write (its tier's model); null for the claude CLI's default at that date */
  model: string | null;
  tier: string;
  /** runs per case (format 2: the fewest any entry had) */
  runs: number;
  /** format 2: sharedDigest at the last write; old format: roleDigest at the run */
  digest: string;
  cases: CaseRecord[];
}

/**
 * Plugin-relative files of a Role's content: every file under `roles/<id>/` but the result file (and with `noCases` the
 * case files `roles/<id>/evals/*.md`), its generated agent file, the shared procedures its `includes` names, the shared
 * library skills its index lists and `tiers.yaml`. Dotfiles (`.DS_Store`) are left out. The runner's own prompts (the
 * answer and grading prompts in src/evalrun.ts) are not Role content and are not in it.
 */
function roleFiles(root: string, id: string, noCases: boolean): string[] {
  const files: string[] = [];
  const evals = `roles/${id}/evals/`;
  const walk = (rel: string) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const n of readdirSync(abs).sort()) if (!n.startsWith(".")) walk(`${rel}/${n}`);
    } else if (rel === `${evals}results.json`) return;
    else if (noCases && rel.startsWith(evals) && !rel.slice(evals.length).includes("/") && rel.endsWith(".md")) return;
    else files.push(rel);
  };
  walk(`roles/${id}`);
  walk(`agents/${id}.md`);
  // role.md read with LF line endings, so a CRLF checkout lists the same files.
  const roleMd = join(root, "roles", id, "role.md");
  const head = existsSync(roleMd) ? parseRoleText(readFileSync(roleMd, "utf8").replace(/\r\n/g, "\n"))?.header : undefined;
  const skills = Array.isArray(head?.skills) ? head.skills.flatMap((e) => (e && typeof e === "object" ? Object.keys(e) : [])) : [];
  for (const sk of skills) if (LIBRARY_SKILL.test(sk)) walk(skillFile(id, sk));
  // The shared procedures it includes and the tier map, read directly: the agent file may not have been regenerated.
  const includes = Array.isArray(head?.includes) ? head.includes.map(String) : [];
  for (const f of includes) if (!f.split("/").includes("..")) walk(f);
  walk("tiers.yaml");
  return files;
}

/** One hash of the files' paths and contents; text is hashed with LF line endings, so a `core.autocrlf` checkout agrees. */
function digestOf(root: string, files: string[]): string {
  const h = createHash("sha256");
  for (const f of [...new Set(files)].sort()) {
    const raw = readFileSync(join(root, f));
    const text = !raw.includes(0);
    h.update(`${f}\0`).update(text ? raw.toString("utf8").replace(/\r\n/g, "\n") : raw).update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}

/** One hash of everything a Role is (roleFiles with its case files): the digest of an old-format result file. */
export function roleDigest(root: string, id: string): string {
  return digestOf(root, roleFiles(root, id, false));
}

/** roleDigest without the case files (`roles/<id>/evals/*.md`): what every case's answer depends on. */
export function sharedDigest(root: string, id: string): string {
  return digestOf(root, roleFiles(root, id, true));
}

/** The digest of one case file, plugin-relative as EvalCase.file (`roles/<id>/evals/<case>.md`); its path counts too. */
export function caseDigest(root: string, caseFile: string): string {
  return digestOf(root, existsSync(join(root, caseFile)) ? [caseFile] : []);
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
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    d.warn(rf, `not readable: run \`aidw eval ${id}\` again`);
    return;
  }
  // Graded on its tier's model (null: the session's default) or not level 1 at all.
  const tm = tierModel(root, id) ?? null;
  const name = (m: unknown) => (typeof m === "string" ? m : "default");
  const modelOk = (rec.model ?? null) === tm;
  if (!modelOk) d.warn(rf, `made with model ${name(rec.model)}, not its tier's model (${name(tm)}): run \`aidw eval ${id}\` again`);
  if (rec.format === RESULTS_FORMAT) {
    if (rec.digest !== sharedDigest(root, id)) {
      d.warn(rf, `older than the Role's content (it changed after ${rec.date}): run \`aidw eval ${id}\` again`);
      return;
    }
    if (modelOk) {
      const other = caseEntries(rec.cases).filter((c) => c.model !== undefined && (c.model ?? null) !== tm);
      for (const c of other) d.warn(rf, `case ${c.name} was made with model ${name(c.model)}, not its tier's model (${name(tm)}): run \`aidw eval ${id} --case ${c.name}\``);
    }
    // The shared content is the same, so an entry holds as long as its own case file has not changed.
    const entries = new Map(caseEntries(rec.cases).map((c) => [c.name, c]));
    const missing: string[] = [];
    const fresh: CaseRecord[] = [];
    for (const c of cases) {
      const e = entries.get(c.name);
      if (!e) missing.push(c.name);
      else if (e.digest !== caseDigest(root, c.file)) d.warn(rf, `made from another version of its case file ${c.file}: run \`aidw eval ${id} --case ${c.name}\``);
      else fresh.push(e);
    }
    if (missing.length) d.warn(rf, `no result for case(s): ${missing.join(", ")}: run \`aidw eval ${id} --case <name>\` for each`);
    const few = fresh.filter((c) => !(Number(c.runs?.total) >= 3)).map((c) => c.name);
    if (few.length) d.warn(rf, `${few.length} case(s) last ran fewer than 3 times: ${few.join(", ")}; a case passes level 1 only with 3 of 3: run it again without --runs`);
    const failed = fresh.filter((c) => !c.pass).map((c) => c.name);
    if (failed.length) d.warn(rf, `the last run did not pass ${failed.length} case(s): ${failed.join(", ")}`);
    return;
  }
  // The old format: one digest over the whole Role.
  if (rec.digest !== roleDigest(root, id)) d.warn(rf, `older than the Role's content (it changed after ${rec.date}): run \`aidw eval ${id}\` again`);
  else {
    if (!(Number(rec.runs) >= 3)) d.warn(rf, `the last run had ${String(rec.runs)} run(s) per case; a case passes level 1 only with 3 of 3: run it again without --runs`);
    const failed = caseEntries(rec.cases).filter((c) => !c.pass).map((c) => c.name);
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
