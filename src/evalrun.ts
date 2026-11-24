import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { caseDigest, caseEntries, loadEvalCases, RESULTS_FORMAT, resultsFile, sharedDigest, type CaseRecord, type EvalCase, type RunRecord } from "./evals.js";
import { loadRole, loadRoster, loadRuleTable, loadTiers, renderAgent, skillFile, type RoleProfile } from "./roles.js";

/**
 * Runner for the Role cases. For each case of a Role: the Role's own instructions (its generated agent file) are given to a
 * model as the system prompt, the case `## Input` is the task, and the answer is graded in a second call against each
 * criterion. Both calls go through an injected `Exec`, so tests never reach a model; the default one is `claude -p` with no tools.
 */
export type Exec = (prompt: string, system?: string) => string;

export interface CriterionResult {
  criterion: string;
  pass: boolean;
  reason: string;
}
export interface CaseResult {
  role: string;
  name: string;
  pass: boolean;
  criteria: CriterionResult[];
  answer: string;
  /** set when the model call failed (a refusal, a timeout): the case is neither passed nor graded */
  error?: string;
  /** with --runs N: how the N runs went; `pass` is true only when every run passed */
  runs?: { total: number; passed: number; errors: number };
}

export const claudeExec =
  (model?: string): Exec =>
  (prompt, system) => {
    // Run from an empty directory and read only that directory's settings: the answer must not depend on the user's own
    // settings, hooks or CLAUDE.md, and a broken rule in them must not fail a run.
    const cwd = mkdtempSync(join(tmpdir(), "aidw-eval-"));
    try {
      const args = ["-p", "--tools", "", "--setting-sources", "project", ...(model ? ["--model", model] : []), ...(system ? ["--append-system-prompt", system] : [])];
      const r = spawnSync("claude", args, { cwd, input: prompt, encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
      if (r.error || r.status !== 0) throw new Error(`claude -p failed: ${r.error?.message ?? ((r.stderr || r.stdout || "").trim().slice(0, 500) || `exit ${r.status}`)}`);
      return r.stdout;
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };

/**
 * The Role's instructions: the body of its generated agent file, or its role.md when the agent is not generated, followed by
 * the text of its skills. A real Agent reads a skill from the index when it needs it; here there are no tools, so every skill
 * is inlined, or a case could only fail on knowledge the Role has but cannot reach.
 */
export function roleSystem(root: string, id: string, without?: string | string[]): string {
  const role = loadRole(root, id);
  const out = idList(without);
  const strip = (body: string) => body.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  let body: string;
  let index: string[] = [];
  if (role) {
    const r: RoleProfile = out.reduce(withoutItem, role);
    body = strip(renderAgent(r, loadTiers(root)));
    index = r.skills.map((x) => x.name);
  } else {
    const file = [join(root, "agents", `${id}.md`), join(root, "roles", id, "role.md")].find(existsSync);
    if (!file) throw new Error(`Role "${id}" has no agent file or role.md`);
    body = strip(readFileSync(file, "utf8"));
  }
  // The skills of the index (own and library), then any other file in the Role's skills/ folder.
  const dir = join(root, "roles", id, "skills");
  const own = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)) : [];
  const names = [...index, ...own.filter((n) => !index.includes(n) && !out.includes(n)).sort()];
  const skills = names
    .map((n) => ({ n, file: join(root, skillFile(id, n)) }))
    .filter((x) => existsSync(x.file))
    .map((x) => `### Skill: ${x.n}\n\n${strip(readFileSync(x.file, "utf8"))}`);
  return skills.length ? `${body}\n\n## Your skills, in full\n\nThe index above points at these files; here is their text.\n\n${skills.join("\n\n")}` : body;
}

/** `--without a,b,c` or one id, as a list; empty when nothing is taken out. */
export function idList(without?: string | string[]): string[] {
  if (without === undefined) return [];
  return (Array.isArray(without) ? without : without.split(",")).map((x) => x.trim()).filter(Boolean);
}

/**
 * The bare baseline (plan C3): none of the Role's own instructions, rules or skills, only the shared procedures it
 * includes (for an implementing Role, `library/implement-a-task.md`), so the protocol (how to ask, Touches) does not
 * decide the case. A case the bare model passes does not test what the Role adds: rewrite or drop it.
 */
export function bareSystem(root: string, id: string): string {
  const role = loadRole(root, id);
  if (!role) throw new Error(`Role "${id}" has no role.md`);
  return role.shared.filter(Boolean).join("\n\n").trim();
}

/**
 * The Role with one rule row or one skill taken out (plan C3): a case must fail without what it covers. Throws when the
 * Role has no such rule id or skill.
 */
export function withoutItem(role: RoleProfile, item: string): RoleProfile {
  if (role.skills.some((x) => x.name === item)) return { ...role, skills: role.skills.filter((x) => x.name !== item) };
  const row = new RegExp(`^\\s*\\|\\s*${item.replace(/[^A-Za-z0-9]/g, "")}\\s*\\|.*\\n?`, "m");
  if (/^[A-Z]+[1-9][0-9]*$/.test(item) && row.test(role.rules)) return { ...role, rules: role.rules.replace(row, "") };
  throw new Error(`--without: "${item}" is not a rule id or a skill of ${role.id}`);
}

export function buildGradePrompt(c: EvalCase, answer: string): string {
  return [
    "You grade an answer against criteria. Judge only what the answer says; do not reward length or confidence.",
    "The answer was written without tools, so it could not really run, open or write anything. Grade an action (open a file, run a",
    "command, write a file, write a test before the code) as done when the Steps say plainly that it is done, in the right order,",
    "naming the file or the command; a result the answer could not have seen (a test's output) counts when it is stated as expected.",
    "Grade a criterion about the reply (its length or its format) against the Reply section only.",
    "",
    "## Situation",
    c.input,
    "",
    "## Answer",
    answer,
    "",
    "## Criteria",
    ...c.criteria.map((x, i) => `${i + 1}. ${x}`),
    "",
    "Reply with ONLY a JSON array, one object per criterion in order: " +
      '[{"n":1,"pass":true,"reason":"one short sentence"}]. A "must not" criterion passes when the answer avoids it.',
  ].join("\n");
}

/** Reads the grader's JSON array; a missing or malformed entry counts as a failed criterion. */
export function parseGrade(text: string, criteria: string[]): CriterionResult[] {
  let arr: unknown[] = [];
  const m = /\[[\s\S]*\]/.exec(text);
  if (m) {
    try {
      const v = JSON.parse(m[0]) as unknown;
      if (Array.isArray(v)) arr = v;
    } catch {
      /* graded as failed below */
    }
  }
  return criteria.map((criterion, i) => {
    const e = arr.find((x) => typeof x === "object" && x !== null && (x as { n?: unknown }).n === i + 1) as
      | { pass?: unknown; reason?: unknown }
      | undefined;
    if (!e || typeof e.pass !== "boolean") return { criterion, pass: false, reason: "the grader gave no verdict for this criterion" };
    return { criterion, pass: e.pass, reason: typeof e.reason === "string" ? e.reason : "" };
  });
}

/**
 * No tools run in a case, and a Role's own report format is short ("reply in at most 10 lines"), which would hide what the
 * grader looks for. So the Agent is asked for the deliverable itself, inline. The wording asks for content, not for an
 * account of its thinking: a request to "show your reasoning" is refused by the models' safeguards.
 */
export function answerPrompt(c: EvalCase): string {
  return [
    c.input,
    "",
    "---",
    "Produce the deliverable for this task in full, as plain text, in two parts.",
    "## Steps: what you do, in the order you do it. Name each action (open a file, run a command, write a file) with the file or",
    "the command, and put the full content of each file you write inline: the test code, the changes, the configuration or the",
    "review verdict, exactly as you would hand them over. Nothing can be run here, so for a command say what you expect it to print.",
    "## Reply: the exact message you send back when you are done, in the format your role asks for.",
    // A case that expects a question (`expect: ask`) tests whether the Role asks: telling it not to would decide the case.
    ...(c.expect === "ask" ? [] : ["The brief above is complete and nothing is blocked: do not stop to ask a question or to report a missing input."]),
    "Do not summarize and do not leave parts out.",
  ].join("\n");
}

/** Shorter than this is no deliverable: a refusal, a question, or a note that a filter cut the reply. */
const MIN_ANSWER = 300;
/** A reply that refuses the work: for a case that expects a question, this (or nothing) is no answer. */
const REFUSAL = /^(I can['’]?t|I cannot|I won['’]?t|I'm (not able|unable)|I am (not able|unable)|Sorry, I)\b/i;

/** How a case is answered: the Role whole, without some of its rules and skills (C3), or bare (no Role at all). */
export interface Ablation {
  without?: string | string[];
  bare?: boolean;
}

export function runCase(root: string, id: string, c: EvalCase, exec: Exec, ab: Ablation | string = {}): CaseResult {
  const a: Ablation = typeof ab === "string" ? { without: ab } : ab;
  const system = a.bare ? bareSystem(root, id) : roleSystem(root, id, a.without);
  // A case that expects a question is graded whatever its length (a short question is the right answer there), but an
  // empty reply or a refusal is still no answer.
  const short = (a: string) => (c.expect === "ask" ? !a.trim() || REFUSAL.test(a.trim()) : a.trim().length < MIN_ANSWER);
  let answer = exec(answerPrompt(c), system);
  if (short(answer)) answer = exec(answerPrompt(c), system); // a filtered reply is often a one-off
  // Not graded: grading a missing deliverable would blame the Role for what the model refused to write.
  if (short(answer)) throw new Error(`no ${c.expect === "ask" ? "answer" : "deliverable"} (the model replied: ${answer.trim().replace(/\s+/g, " ").slice(0, 160) || "nothing"})`);
  const criteria = parseGrade(exec(buildGradePrompt(c, answer)), c.criteria);
  return { role: id, name: c.name, pass: criteria.every((x) => x.pass), criteria, answer };
}

/** One attempt at a case: a failed model call is an ERROR result, so one refusal never ends a run over many Roles. */
function attempt(root: string, id: string, c: EvalCase, exec: Exec, ab: Ablation): CaseResult {
  try {
    return runCase(root, id, c, exec, ab);
  } catch (e) {
    return { role: id, name: c.name, pass: false, criteria: [], answer: "", error: (e as Error).message.replace(/^claude -p failed: /, "") };
  }
}

/** N attempts as one result. A single run is the plain result; with more, a criterion that failed says in how many runs. */
function attempts(root: string, id: string, c: EvalCase, exec: Exec, n: number, ab: Ablation): CaseResult {
  if (n <= 1) return attempt(root, id, c, exec, ab);
  const rs = Array.from({ length: n }, () => attempt(root, id, c, exec, ab));
  const graded = rs.filter((r) => !r.error);
  const passed = rs.filter((r) => r.pass).length;
  // Every criterion, in the case's order: a failing one says in how many runs, so a C3 run can be read per criterion.
  const criteria = graded.length
    ? c.criteria.map((criterion) => {
        const fails = graded.map((r) => r.criteria.find((x) => x.criterion === criterion)).filter((x) => !x || !x.pass);
        return fails.length
          ? { criterion, pass: false, reason: `failed in ${fails.length} of ${graded.length} graded runs: ${fails[0]?.reason ?? "no verdict"}` }
          : { criterion, pass: true, reason: `passed in ${graded.length} of ${graded.length} graded runs` };
      })
    : [];
  return {
    role: id,
    name: c.name,
    pass: passed === n,
    criteria,
    answer: (graded[graded.length - 1] ?? rs[rs.length - 1]!).answer,
    ...(graded.length === 0 ? { error: rs[0]!.error as string } : {}),
    runs: { total: n, passed, errors: rs.length - graded.length },
  };
}

/**
 * Runs the cases of one Role (or of every active Role when `role` is omitted), optionally only the named case. With
 * `without` (one Role only; one id or a list) the Role's instructions lose those rule rows and skills and only the cases
 * that cover at least one of them run (all of `caseName` with it). With `bare` (one Role only) the cases are answered with
 * none of the Role's instructions (`bareSystem`).
 */
export function runCases(
  root: string,
  role: string | undefined,
  caseName: string | undefined,
  exec: Exec,
  onCase?: (r: CaseResult) => void,
  runs = 1,
  without?: string | string[],
  bare = false,
): CaseResult[] {
  const dropped = idList(without);
  if (without !== undefined && !dropped.length) throw new Error("--without takes a rule id or a skill, or a comma-separated list of them");
  if (dropped.length && !role) throw new Error("--without needs a Role: rule ids and skills belong to one Role");
  if (bare && !role) throw new Error("--bare needs a Role: it runs that Role's cases with none of its instructions");
  if (bare && dropped.length) throw new Error("--bare and --without do not go together: --bare already leaves out every rule and skill");
  const roster = loadRoster(root);
  const ids = role
    ? [role]
    : Object.entries(roster.roles)
        .filter(([, e]) => e?.status === "active")
        .map(([k]) => k);
  const out: CaseResult[] = [];
  for (const id of ids) {
    if (!roster.roles[id]) throw new Error(`"${id}" is not a Role in roster.yaml`);
    if (dropped.length) {
      const known = [...(loadRuleTable(root, id) ?? []).map((r) => r.id), ...(loadRole(root, id)?.skills ?? []).map((x) => x.name)];
      for (const w of dropped) if (!known.includes(w)) throw new Error(`--without: "${w}" is not a rule id or a skill of ${id}`);
    }
    for (const c of loadEvalCases(root, id).cases) {
      if (caseName && c.name !== caseName) continue;
      if (dropped.length && !caseName && !c.covers.some((x) => dropped.includes(x))) continue;
      const r = attempts(root, id, c, exec, runs, bare ? { bare } : { without: dropped });
      out.push(r);
      onCase?.(r);
    }
  }
  if (caseName && !out.length) throw new Error(`no case "${caseName}"${role ? ` for ${role}` : ""}`);
  if (dropped.length && !out.length) throw new Error(`no case of ${role} covers ${dropped.map((x) => `"${x}"`).join(" or ")}`);
  return out;
}

type ResultsMeta = { model?: string; runs: number; date?: Date };

/** The entries of `results` for Role `id`, each with the digest of its case file and the date of this run. */
function caseRecords(root: string, id: string, results: CaseResult[], date: string): CaseRecord[] {
  const fileOf = new Map(loadEvalCases(root, id).cases.map((c) => [c.name, c.file]));
  return results
    .filter((r) => r.role === id && fileOf.has(r.name))
    .map((r) => ({
      name: r.name,
      pass: r.pass,
      runs: r.runs ?? { total: 1, passed: r.pass ? 1 : 0, errors: r.error ? 1 : 0 },
      failed: r.criteria.filter((x) => !x.pass).map((x) => x.criterion),
      ...(r.error ? { error: r.error } : {}),
      digest: caseDigest(root, fileOf.get(r.name) as string),
      date,
    }));
}

function record(root: string, id: string, model: string | null, date: string, cases: CaseRecord[]): RunRecord {
  return {
    format: RESULTS_FORMAT,
    role: id,
    date,
    model,
    tier: loadRole(root, id)?.tier ?? "",
    runs: cases.length ? Math.min(...cases.map((c) => c.runs.total)) : 0,
    digest: sharedDigest(root, id),
    cases,
  };
}

function save(root: string, id: string, rec: RunRecord): string {
  const file = resultsFile(root, id);
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  return file;
}

/**
 * The record of a run of all the cases of one Role (C6), written to `roles/<id>/evals/results.json` (format 2, see
 * RunRecord) and committed with the Role's change; `aidw roster` compares its digests with the Role's content. Returns
 * the file written.
 */
export function writeResults(root: string, id: string, results: CaseResult[], meta: ResultsMeta): string {
  const date = (meta.date ?? new Date()).toISOString();
  return save(root, id, record(root, id, meta.model ?? null, date, caseRecords(root, id, results, date)));
}

/**
 * The run of some cases of one Role (`--case`) merged into its result file: their entries are replaced or added, the
 * others kept, entries of cases that no longer exist dropped. Only into a format-2 file of the same shared content and
 * model, since the kept entries stand for that content; otherwise nothing is written and `refused` says why.
 */
export function mergeResults(root: string, id: string, results: CaseResult[], meta: ResultsMeta): { file: string } | { refused: string } {
  const file = resultsFile(root, id);
  const all = `run \`aidw eval ${id}\` for all cases`;
  if (!existsSync(file)) return { refused: `there is no results.json yet: ${all} once` };
  let old: RunRecord;
  try {
    old = JSON.parse(readFileSync(file, "utf8")) as RunRecord;
  } catch {
    return { refused: `results.json is not readable: ${all}` };
  }
  if (old?.format !== RESULTS_FORMAT || !Array.isArray(old.cases)) return { refused: `results.json is the old format: ${all} once` };
  if (old.digest !== sharedDigest(root, id)) return { refused: `the Role's shared content changed since the last full run: ${all}` };
  const model = meta.model ?? null;
  if ((old.model ?? null) !== model) return { refused: `results.json was made with model ${old.model ?? "default"}, this run with ${model ?? "default"}: ${all}` };
  const date = (meta.date ?? new Date()).toISOString();
  const fresh = new Map(caseRecords(root, id, results, date).map((c) => [c.name, c]));
  const kept = new Map(caseEntries(old.cases).map((c) => [c.name, c]));
  const cases = loadEvalCases(root, id)
    .cases.map((c) => fresh.get(c.name) ?? kept.get(c.name))
    .filter((c): c is CaseRecord => c !== undefined);
  return { file: save(root, id, record(root, id, model, date, cases)) };
}

/** `every`: list every criterion with its verdict, not only the failing ones (a C3 run is read per criterion). */
export function printResults(rs: CaseResult[], showAnswers = false, every = false): string {
  const lines: string[] = [];
  for (const r of rs) {
    if (showAnswers && r.answer) lines.push(`----- answer of ${r.role}/${r.name} -----\n${r.answer.trim()}\n-----`);
    const word = r.error ? "ERROR" : r.pass ? "PASS" : r.runs && r.runs.passed > 0 ? "FLAKY" : "FAIL";
    const tally = r.runs ? ` (${r.runs.passed}/${r.runs.total} runs${r.runs.errors ? `, ${r.runs.errors} error` : ""})` : "";
    lines.push(`${word} ${r.role}/${r.name}${tally}`.replace(/^(PASS|FAIL) /, "$1  "));
    if (r.error) lines.push(`      ${r.error.split("\n")[0]?.slice(0, 200)}`);
    if (every) for (const c of r.criteria) lines.push(`      ${c.pass ? "ok  " : "FAIL"} ${c.criterion}${c.pass ? "" : `\n           ${c.reason}`}`);
    else for (const c of r.criteria.filter((x) => !x.pass)) lines.push(`      - ${c.criterion}\n        ${c.reason}`);
  }
  const bad = rs.filter((r) => !r.pass).length;
  lines.push(`${rs.length - bad}/${rs.length} case(s) passed`);
  return lines.join("\n") + "\n";
}
