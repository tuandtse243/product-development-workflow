import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadEvalCases, type EvalCase } from "./evals.js";
import { loadRoster } from "./roles.js";

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
}

export const claudeExec =
  (model?: string): Exec =>
  (prompt, system) => {
    const args = ["-p", "--tools", "", ...(model ? ["--model", model] : []), ...(system ? ["--append-system-prompt", system] : [])];
    const r = spawnSync("claude", args, { input: prompt, encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error(`claude -p failed: ${r.error?.message ?? (r.stderr || "").slice(0, 300)}`);
    return r.stdout;
  };

/** The Role's instructions: the body of its generated agent file, or its role.md when the agent is not generated. */
export function roleSystem(root: string, id: string): string {
  const file = [join(root, "agents", `${id}.md`), join(root, "roles", id, "role.md")].find(existsSync);
  if (!file) throw new Error(`Role "${id}" has no agent file or role.md`);
  return readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

export function buildGradePrompt(c: EvalCase, answer: string): string {
  return [
    "You grade an answer against criteria. Judge only what the answer says; do not reward length or confidence.",
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

export function runCase(root: string, id: string, c: EvalCase, exec: Exec): CaseResult {
  const answer = exec(c.input, roleSystem(root, id));
  const criteria = parseGrade(exec(buildGradePrompt(c, answer)), c.criteria);
  return { role: id, name: c.name, pass: criteria.every((x) => x.pass), criteria, answer };
}

/** Runs the cases of one Role (or of every active Role when `role` is omitted), optionally only the named case. */
export function runCases(root: string, role: string | undefined, caseName: string | undefined, exec: Exec): CaseResult[] {
  const roster = loadRoster(root);
  const ids = role
    ? [role]
    : Object.entries(roster.roles)
        .filter(([, e]) => e?.status === "active")
        .map(([k]) => k);
  const out: CaseResult[] = [];
  for (const id of ids) {
    if (!roster.roles[id]) throw new Error(`"${id}" is not a Role in roster.yaml`);
    for (const c of loadEvalCases(root, id).cases) if (!caseName || c.name === caseName) out.push(runCase(root, id, c, exec));
  }
  if (caseName && !out.length) throw new Error(`no case "${caseName}"${role ? ` for ${role}` : ""}`);
  return out;
}

export function printResults(rs: CaseResult[]): string {
  const lines: string[] = [];
  for (const r of rs) {
    lines.push(`${r.pass ? "PASS" : "FAIL"}  ${r.role}/${r.name}`);
    for (const c of r.criteria.filter((x) => !x.pass)) lines.push(`      - ${c.criterion}\n        ${c.reason}`);
  }
  const bad = rs.filter((r) => !r.pass).length;
  lines.push(`${rs.length - bad}/${rs.length} case(s) passed`);
  return lines.join("\n") + "\n";
}
