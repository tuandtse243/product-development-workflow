import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadEvalCases, resultsFile, roleDigest, type EvalCase, type RunRecord } from "./evals.js";
import { loadRole, loadRoster } from "./roles.js";

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
export function roleSystem(root: string, id: string): string {
  const file = [join(root, "agents", `${id}.md`), join(root, "roles", id, "role.md")].find(existsSync);
  if (!file) throw new Error(`Role "${id}" has no agent file or role.md`);
  const body = readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const dir = join(root, "roles", id, "skills");
  const skills = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => n.endsWith(".md"))
        .sort()
        .map((n) => `### Skill: ${n.slice(0, -3)}\n\n${readFileSync(join(dir, n), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim()}`)
    : [];
  return skills.length ? `${body}\n\n## Your skills, in full\n\nThe index above points at these files; here is their text.\n\n${skills.join("\n\n")}` : body;
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

export function runCase(root: string, id: string, c: EvalCase, exec: Exec): CaseResult {
  const system = roleSystem(root, id);
  // A case that expects a question is graded whatever its length: a short question is the right answer there.
  const short = (a: string) => c.expect !== "ask" && a.trim().length < MIN_ANSWER;
  let answer = exec(answerPrompt(c), system);
  if (short(answer)) answer = exec(answerPrompt(c), system); // a filtered reply is often a one-off
  // Not graded: grading a missing deliverable would blame the Role for what the model refused to write.
  if (short(answer)) throw new Error(`no deliverable (the model replied: ${answer.trim().replace(/\s+/g, " ").slice(0, 160)})`);
  const criteria = parseGrade(exec(buildGradePrompt(c, answer)), c.criteria);
  return { role: id, name: c.name, pass: criteria.every((x) => x.pass), criteria, answer };
}

/** One attempt at a case: a failed model call is an ERROR result, so one refusal never ends a run over many Roles. */
function attempt(root: string, id: string, c: EvalCase, exec: Exec): CaseResult {
  try {
    return runCase(root, id, c, exec);
  } catch (e) {
    return { role: id, name: c.name, pass: false, criteria: [], answer: "", error: (e as Error).message.replace(/^claude -p failed: /, "") };
  }
}

/** N attempts as one result. A single run is the plain result; with more, a criterion that failed says in how many runs. */
function attempts(root: string, id: string, c: EvalCase, exec: Exec, n: number): CaseResult {
  if (n <= 1) return attempt(root, id, c, exec);
  const rs = Array.from({ length: n }, () => attempt(root, id, c, exec));
  const graded = rs.filter((r) => !r.error);
  const passed = rs.filter((r) => r.pass).length;
  const failing = new Map<string, { count: number; reason: string }>();
  for (const r of graded) for (const k of r.criteria.filter((x) => !x.pass)) {
    const e = failing.get(k.criterion);
    failing.set(k.criterion, { count: (e?.count ?? 0) + 1, reason: e?.reason ?? k.reason });
  }
  return {
    role: id,
    name: c.name,
    pass: passed === n,
    criteria: [...failing].map(([criterion, v]) => ({ criterion, pass: false, reason: `failed in ${v.count} of ${graded.length} graded runs: ${v.reason}` })),
    answer: (graded[graded.length - 1] ?? rs[rs.length - 1]!).answer,
    ...(graded.length === 0 ? { error: rs[0]!.error as string } : {}),
    runs: { total: n, passed, errors: rs.length - graded.length },
  };
}

/** Runs the cases of one Role (or of every active Role when `role` is omitted), optionally only the named case. */
export function runCases(root: string, role: string | undefined, caseName: string | undefined, exec: Exec, onCase?: (r: CaseResult) => void, runs = 1): CaseResult[] {
  const roster = loadRoster(root);
  const ids = role
    ? [role]
    : Object.entries(roster.roles)
        .filter(([, e]) => e?.status === "active")
        .map(([k]) => k);
  const out: CaseResult[] = [];
  for (const id of ids) {
    if (!roster.roles[id]) throw new Error(`"${id}" is not a Role in roster.yaml`);
    for (const c of loadEvalCases(root, id).cases) {
      if (caseName && c.name !== caseName) continue;
      const r = attempts(root, id, c, exec, runs);
      out.push(r);
      onCase?.(r);
    }
  }
  if (caseName && !out.length) throw new Error(`no case "${caseName}"${role ? ` for ${role}` : ""}`);
  return out;
}

/**
 * The record of a run of all the cases of one Role (C6), written to `roles/<id>/evals/results.json` and committed with the
 * Role's change; `aidw roster` compares its digest with the Role's content. Returns the file written.
 */
export function writeResults(root: string, id: string, results: CaseResult[], meta: { model?: string; runs: number; date?: Date }): string {
  const record: RunRecord = {
    role: id,
    date: (meta.date ?? new Date()).toISOString(),
    model: meta.model ?? null,
    tier: loadRole(root, id)?.tier ?? "",
    runs: meta.runs,
    digest: roleDigest(root, id),
    cases: results
      .filter((r) => r.role === id)
      .map((r) => ({
        name: r.name,
        pass: r.pass,
        runs: r.runs ?? { total: 1, passed: r.pass ? 1 : 0, errors: r.error ? 1 : 0 },
        failed: r.criteria.filter((x) => !x.pass).map((x) => x.criterion),
        ...(r.error ? { error: r.error } : {}),
      })),
  };
  const file = resultsFile(root, id);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export function printResults(rs: CaseResult[], showAnswers = false): string {
  const lines: string[] = [];
  for (const r of rs) {
    if (showAnswers && r.answer) lines.push(`----- answer of ${r.role}/${r.name} -----\n${r.answer.trim()}\n-----`);
    const word = r.error ? "ERROR" : r.pass ? "PASS" : r.runs && r.runs.passed > 0 ? "FLAKY" : "FAIL";
    const tally = r.runs ? ` (${r.runs.passed}/${r.runs.total} runs${r.runs.errors ? `, ${r.runs.errors} error` : ""})` : "";
    lines.push(`${word} ${r.role}/${r.name}${tally}`.replace(/^(PASS|FAIL) /, "$1  "));
    if (r.error) lines.push(`      ${r.error.split("\n")[0]?.slice(0, 200)}`);
    for (const c of r.criteria.filter((x) => !x.pass)) lines.push(`      - ${c.criterion}\n        ${c.reason}`);
  }
  const bad = rs.filter((r) => !r.pass).length;
  lines.push(`${rs.length - bad}/${rs.length} case(s) passed`);
  return lines.join("\n") + "\n";
}
