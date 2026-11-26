/**
 * The independent review before the Approval Gate (D4, ADR-0011). After the CLI's own checks (`aidw analyze`), one
 * read-only Agent of the code-reviewer Role grades the architecture, the plan and the test plan against a fixed list
 * and writes a verdict (`.aidw/run/review-plan-<id>.md`). The CLI records each verdict as a round
 * (`changes/<id>/plan-review.yaml`, outside the approved package):
 *
 *   pass                    the review stage is done
 *   fix, rounds left        the authoring Roles fix the findings, then the reviewer runs again (at most 2 fix rounds)
 *   fix, no rounds left     the stage is done and the findings are carried to the top of the gate Decision Page
 *
 * Every round needs its own brief (`briefed` in the record). A finished review counts while the plan it graded is
 * unchanged; a changed plan starts a new cycle of rounds with its own cap. `aidw transition <id> awaiting_approval` is
 * refused until then (planReviewBlocker).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { analyzeChange, idsAfterChange } from "./analyze.js";
import { loadArtifacts, type ArtifactEntry } from "./artifacts.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { checkChange } from "./check.js";
import { workflowOfChange } from "./decisions.js";
import { OpError } from "./diag.js";
import type { PageSection } from "./page.js";
import { readText, rel, walkFiles, type Paths } from "./project.js";
import { canonicalTasks, parseTasks } from "./tasks.js";
import type { Stage, Workflow } from "./workflow.js";

/** The Artifact the review stage writes: the stage that writes it is the review stage of its Workflow. */
export const PLAN_REVIEW = "plan-review";
export const MAX_FIX_ROUNDS = 2;
/** the first review and one per fix round */
export const MAX_REVIEWS = MAX_FIX_ROUNDS + 1;

/** The fixed list the reviewer grades against; a finding cites its item number. */
export const CHECKLIST = [
  "every approved scenario has a task that really delivers it",
  "no task outside the approved scope",
  "the architecture and the plan follow the constitution",
  "no needless complexity: nothing the scenarios do not need",
] as const;

/** What a finding may name besides a task or a scenario: an Artifact of the package, by area. */
export const AREAS = ["architecture", "constitution", "contracts", "test-plan", "quality"] as const;

export interface Finding {
  item: number;
  /** a task id, a requirement or scenario id, or an area */
  target: string;
  text: string;
}

export interface Round {
  /** within its cycle: 1 to MAX_REVIEWS */
  round: number;
  /** the review cycle: a new one starts when the plan changed after a finished review (absent = 1) */
  cycle?: number;
  verdict: "pass" | "fix";
  /** of the verdict file as recorded: an edit after recording keeps the gate closed */
  digest: string;
  /** planDigest of what was reviewed (absent on records made before it existed: then it is not compared) */
  plan?: string;
  at: string;
  findings: Finding[];
}

export type Outcome = "pass" | "fix" | "carried";

export const verdictFile = (p: Paths, id: string): string => join(p.run, `review-plan-${id}.md`);
export const roundsFile = (change: Change): string => join(change.dir, "plan-review.yaml");
export const digestOf = (text: string): string => `sha256:${createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex")}`;
export const outcomeOf = (r: Round): Outcome => (r.verdict === "pass" ? "pass" : r.round >= MAX_REVIEWS ? "carried" : "fix");
export const reviewStage = (w: Workflow): Stage | undefined => w.stages.find((s) => s.writes.includes(PLAN_REVIEW));

const FORMAT = '"N. [item 1-4] <task id | scenario id | area>: <problem> -> <expected fix>"';
const NUMBERED = /^\s*\d+[.)]\s/;
const FINDING = /^\s*\d+[.)]\s*\[\s*item\s*(\d+)\s*\]\s*([^\s:]+)\s*:\s*(\S.*)$/i;
const NON_BLOCKING = /^\s*(?:#+\s*)?non-blocking\b/i;

/** The verdict and its findings (numbered lines before `Non-blocking:`), with every problem of shape. */
export function parsePlanReview(text: string): { verdict: "pass" | "fix" | null; findings: Finding[]; problems: string[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  const m = first < 0 ? null : /^\W*VERDICT:\s*(pass|fix)\W*$/i.exec(lines[first] as string);
  const verdict = m ? ((m[1] as string).toLowerCase() as "pass" | "fix") : null;
  const problems: string[] = [];
  if (!verdict) problems.push("the first line must be `VERDICT: pass` or `VERDICT: fix`");
  const findings: Finding[] = [];
  for (let i = first + 1; first >= 0 && i < lines.length; i++) {
    const l = lines[i] as string;
    if (NON_BLOCKING.test(l)) break;
    if (!NUMBERED.test(l)) continue;
    const f = FINDING.exec(l);
    if (!f) {
      problems.push(`line ${i + 1}: a finding reads ${FORMAT}`);
      continue;
    }
    const item = Number(f[1]);
    if (item < 1 || item > CHECKLIST.length) problems.push(`line ${i + 1}: item ${item} is not on the list (1 to ${CHECKLIST.length})`);
    findings.push({ item, target: f[2] as string, text: (f[3] as string).trim() });
  }
  if (verdict === "fix" && !findings.length) problems.push("a `fix` verdict lists at least one finding");
  if (verdict === "pass" && findings.length) problems.push("a `pass` verdict lists no findings; put remarks under `Non-blocking:`");
  return { verdict, findings, problems };
}

/**
 * The CLI's record of the review: the rounds of every cycle, the current cycle (a new one starts when the plan changed
 * after a finished review) and the round the last brief was written for. Only the CLI writes it (the gate hook denies
 * every Agent), and it is read strictly: a record that cannot be read is an error, never "no rounds".
 */
export interface ReviewRecord {
  cycle: number;
  briefed: number;
  /** planDigest when the last brief was written: the plan the reviewer grades */
  briefedPlan?: string;
  rounds: Round[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function readRecord(p: Paths, change: Change): ReviewRecord {
  const file = roundsFile(change);
  const text = readText(file);
  if (text === null) return { cycle: 1, briefed: 0, rounds: [] };
  let data: unknown;
  try {
    data = YAML.parse(text);
  } catch (e) {
    throw new OpError(`${rel(p, file)} cannot be read (${(e as Error).message.split("\n")[0]}): it is written only by \`aidw plan-review\`; restore it from git`);
  }
  const ok = isRecord(data) && Array.isArray(data.rounds) && data.rounds.every((r) => isRecord(r) && typeof r.round === "number" && (r.verdict === "pass" || r.verdict === "fix") && typeof r.digest === "string" && Array.isArray(r.findings));
  if (!ok) throw new OpError(`${rel(p, file)} cannot be read (no list of rounds with round, verdict, digest and findings): it is written only by \`aidw plan-review\`; restore it from git`);
  const rec = data as { cycle?: unknown; briefed?: unknown; briefedPlan?: unknown; rounds: Round[] };
  const cycle = typeof rec.cycle === "number" ? rec.cycle : 1;
  const current = rec.rounds.filter((r) => (r.cycle ?? 1) === cycle);
  return {
    cycle,
    briefed: typeof rec.briefed === "number" ? rec.briefed : current.length,
    ...(typeof rec.briefedPlan === "string" ? { briefedPlan: rec.briefedPlan } : {}),
    rounds: rec.rounds,
  };
}

/** The rounds of the current cycle. */
export const currentRounds = (rec: ReviewRecord): Round[] => rec.rounds.filter((r) => (r.cycle ?? 1) === rec.cycle);

const writeRecord = (change: Change, rec: ReviewRecord) => writeFileSync(roundsFile(change), YAML.stringify(rec));

/**
 * A digest of what the review graded: every input the brief asks the reviewer to read except analysis.md (whose summary
 * the lead writes around the review): the plan, the specs (the main specs when the change has none), the requirements,
 * the architecture and project decisions, the constitution, the decisions of the change, the contracts, the test plan
 * and quality.yaml. It is taken when the brief is written; a finished review counts only while it is unchanged.
 */
export function planDigest(p: Paths, change: Change): string {
  const c = (f: string) => join(change.dir, f);
  const files = [
    c("tasks.yaml"),
    ...walkFiles(existsSync(c("specs")) ? c("specs") : p.specs).sort(),
    join(p.requirements, `${change.id}.md`),
    join(p.architecture, "overview.md"),
    ...walkFiles(p.decisions).sort(),
    p.constitution,
    c("decisions.yaml"),
    c("data-model.md"),
    c("api-contract.md"),
    c("openapi.yaml"),
    c("test-plan.md"),
    c("quality.yaml"),
    // the Program Design (ADR-0015) only when there is one, so a review recorded before it existed still counts
    ...(existsSync(c("program-design.md")) ? [c("program-design.md")] : []),
  ];
  const parts = files.map((f) => {
    const t = readText(f);
    return `${rel(p, f)}\n${t === null ? "-" : digestOf(f.endsWith("tasks.yaml") ? canonicalTasks(t) : t)}`;
  });
  return digestOf(parts.join("\n"));
}

const planChanged = (p: Paths, change: Change, r: Round) => r.plan !== undefined && r.plan !== planDigest(p, change);

const how = (id: string) => `run \`aidw plan-review ${id} --brief\`, spawn aidw:code-reviewer with the brief, then record its verdict with \`aidw plan-review ${id}\``;

/**
 * Why the Change may not go to the Approval Gate yet because of the plan review, or null. Null too when its Workflow
 * has no review stage. Throws when the record cannot be read.
 */
export function planReviewBlocker(p: Paths, change: Change, w: Workflow): string | null {
  const s = reviewStage(w);
  if (!s) return null;
  const file = verdictFile(p, change.id);
  const rounds = currentRounds(readRecord(p, change));
  const last = rounds.at(-1);
  if (!last) {
    return existsSync(file)
      ? `the plan review's verdict (${rel(p, file)}) recorded: run \`aidw plan-review ${change.id}\``
      : `the independent review of architecture and plan (stage ${s.id}): ${how(change.id)}`;
  }
  if (rounds.length > MAX_REVIEWS) return `at most ${MAX_FIX_ROUNDS} fix rounds of the plan review (${MAX_REVIEWS} reviews); ${rounds.length} are recorded`;
  // .aidw/run/ is not committed: in a fresh clone the file is gone and the recorded round stands on its own
  const text = readText(file);
  if (text !== null && digestOf(text) !== last.digest) return `a recorded plan review: the verdict file changed after round ${last.round} was recorded; record it with \`aidw plan-review ${change.id}\``;
  if (outcomeOf(last) === "fix") return `the plan review to finish: fix round ${last.round} of ${MAX_FIX_ROUNDS} is open. The authoring Roles fix its ${last.findings.length} finding(s), then the reviewer runs again (${how(change.id)})`;
  if (planChanged(p, change, last)) return `a review of the revised plan: the plan changed since the review (round ${last.round}); ${how(change.id)}`;
  return null;
}

/** The findings carried to the gate by the current cycle (empty when it passed or is not finished). */
export function carriedFindings(p: Paths, change: Change): Finding[] {
  const last = currentRounds(readRecord(p, change)).at(-1);
  return last && outcomeOf(last) === "carried" ? last.findings : [];
}

/** The Artifact a finding asks to change. */
function artifactOf(f: Finding, tasks: ReadonlySet<string>): string {
  if (tasks.has(f.target)) return "tasks";
  if (f.target === "contracts") return "decision-data-model-needed"; // the Role that decides the contracts
  if ((AREAS as readonly string[]).includes(f.target)) return f.target;
  return f.item === 2 ? "delta-specs" : "tasks"; // a scenario out of scope, or a scenario no task delivers
}

/**
 * The Role that fixes what a finding names: the owner of the Artifact it asks to change, when a stage of this Workflow
 * has that Role write it; otherwise the lead (a bugfix spawns no architect, for one).
 */
export function fixerOf(f: Finding, tasks: ReadonlySet<string>, w: Workflow, registry: Record<string, ArtifactEntry> | null): string {
  const a = artifactOf(f, tasks);
  const owner = registry?.[a]?.owner;
  return owner && w.stages.some((s) => s.writes.includes(a) && s.roles.includes(owner)) ? owner : "the lead";
}

const taskIds = (change: Change): Set<string> => new Set(parseTasks(readText(join(change.dir, "tasks.yaml")) ?? "").tasks.map((t) => String(t.id)));

/** The change, its review stage and record, and the rounds of the cycle a brief or a verdict belongs to. */
function load(p: Paths, id: string, pluginRoot: string, mode: "brief" | "record"): { change: Change; w: Workflow; stage: Stage; rec: ReviewRecord; rounds: Round[] } {
  const change = loadChange(p, id);
  const w = workflowOfChange(p, change, pluginRoot);
  const stage = reviewStage(w);
  if (!stage) throw new OpError(`the "${w.id}" workflow has no review of architecture and plan`);
  if (stateOf(change) !== "analyzing") throw new OpError(`the plan review runs while the change is analyzing; "${id}" is "${String(change.data.state)}"`);
  const rec = readRecord(p, change);
  let rounds = currentRounds(rec);
  const last = rounds.at(-1);
  if (last && outcomeOf(last) !== "fix") {
    if (!planChanged(p, change, last)) throw new OpError(`the plan review is finished (round ${last.round}: ${outcomeOf(last) === "pass" ? "pass" : "findings carried to the gate"}); continue with \`aidw transition ${id} awaiting_approval\``);
    if (mode === "record") throw new OpError(`the plan changed since the review (round ${last.round}): start a new review with \`aidw plan-review ${id} --brief\``);
    // a new cycle for the revised plan, with its own cap
    rec.cycle += 1;
    rec.briefed = 0;
    rounds = [];
  }
  return { change, w, stage, rec, rounds };
}

export interface Recorded {
  round: Round;
  outcome: Outcome;
  stage: string;
  /** finding -> the Role that fixes it */
  fixers: string[];
}

/** Records the reviewer's verdict as the round its brief was written for. A verdict in the wrong shape is refused and not counted. */
export function recordPlanReview(p: Paths, id: string, pluginRoot: string): Recorded {
  const { change, w, stage, rec, rounds } = load(p, id, pluginRoot, "record");
  const n = rounds.length + 1;
  if (rec.briefed !== n) throw new OpError(`round ${n} has no brief yet: run \`aidw plan-review ${id} --brief\` first, then spawn the reviewer with it`);
  const plan = planDigest(p, change);
  if (rec.briefedPlan !== undefined && rec.briefedPlan !== plan) throw new OpError(`the plan changed after the brief of round ${n}, so the verdict grades a plan that is gone: brief again (\`aidw plan-review ${id} --brief\`) and spawn the reviewer with the new brief`);
  const file = verdictFile(p, id);
  const text = readText(file);
  if (text === null) throw new OpError(`no verdict at ${rel(p, file)}: ${how(id)}`);
  const parsed = parsePlanReview(text);
  const tasks = taskIds(change);
  const { ids } = idsAfterChange(p, id);
  parsed.findings.forEach((f, i) => {
    const known = tasks.has(f.target) || ids.scenarios.has(f.target) || ids.requirements.has(f.target) || (AREAS as readonly string[]).includes(f.target);
    if (!known) parsed.problems.push(`finding ${i + 1} names "${f.target}", which is not a task, a requirement or scenario of this change, or an area (${AREAS.join(", ")})`);
  });
  if (parsed.problems.length || !parsed.verdict) {
    throw new OpError(`the plan review's verdict (${rel(p, file)}) is not in the right shape; the round is not counted:\n${parsed.problems.map((x) => `  - ${x}`).join("\n")}\nSpawn the reviewer once more with the same brief.`);
  }
  const round: Round = { round: n, cycle: rec.cycle, verdict: parsed.verdict, digest: digestOf(text), plan, at: new Date().toISOString(), findings: parsed.findings };
  writeRecord(change, { ...rec, rounds: [...rec.rounds, round] });
  let registry: Record<string, ArtifactEntry> | null = null;
  try {
    registry = loadArtifacts(pluginRoot);
  } catch {
    registry = null;
  }
  return { round, outcome: outcomeOf(round), stage: stage.id, fixers: round.findings.map((f) => fixerOf(f, tasks, w, registry)) };
}

/** The packet of the reviewer: read-only, the fixed list, what to read, what is still open from the last round. */
export function buildPlanReviewBrief(p: Paths, id: string, pluginRoot: string): { path: string; text: string; round: number } {
  const { change, rec, rounds } = load(p, id, pluginRoot, "brief");
  const d = checkChange(p, id, { asState: "awaiting_approval" });
  d.add(analyzeChange(p, id));
  if (d.errors.length) throw new OpError("the CLI's own checks come first: fix what `aidw analyze` reports, then write the brief", d);
  const out = verdictFile(p, id);
  const left = readText(out);
  // a verdict not recorded yet is kept, unless it graded a plan that changed since its brief
  const stale = rec.briefedPlan !== undefined && rec.briefedPlan !== planDigest(p, change);
  if (left !== null && !stale && !rec.rounds.some((r) => r.digest === digestOf(left))) throw new OpError(`the verdict at ${rel(p, out)} is not recorded yet: run \`aidw plan-review ${id}\` first`);
  rmSync(out, { force: true });
  const round = rounds.length + 1;
  writeRecord(change, { ...rec, briefed: round, briefedPlan: planDigest(p, change) });
  const last = rounds.at(-1);
  const at = (f: string) => (existsSync(f) ? `- \`${rel(p, f)}\`` : null);
  const c = (f: string) => join(change.dir, f);
  const specs = existsSync(c("specs")) ? c("specs") : p.specs;
  const reads = [
    at(c("analysis.md")) && `${at(c("analysis.md"))}: Requirements and scope, Decisions to honor, Plan, Quality profile`,
    at(join(p.requirements, `${id}.md`)),
    at(specs) && `${at(specs)}: the scenarios`,
    at(join(p.architecture, "overview.md")),
    at(p.constitution),
    at(p.decisions),
    at(c("decisions.yaml")),
    at(c("data-model.md")),
    at(c("api-contract.md")),
    at(c("openapi.yaml")),
    at(c("program-design.md")) && `${at(c("program-design.md"))}: the Program Design the tasks are cut from`,
    at(c("tasks.yaml")),
    at(c("test-plan.md")),
    at(c("quality.yaml")),
  ].filter((x): x is string => !!x);
  const { changed } = idsAfterChange(p, id);
  const text = [
    `# Plan review brief: ${String(change.data.title ?? id)}`,
    "",
    `Change \`${id}\` · Role code-reviewer · Round ${round} of at most ${MAX_REVIEWS}`,
    "",
    "You are an independent reviewer in a fresh context. You wrote none of this package. You may read files and run read-only commands; you change nothing and fix nothing.",
    "",
    `Read your skill first: \`${join(pluginRoot, "roles", "code-reviewer", "skills", "plan-review.md")}\`.`,
    "",
    "## What to review",
    "",
    "The architecture, the plan and the test plan of this change, before the user approves them. `aidw analyze` passed: every section is filled in and every changed scenario is named by some task. You judge what a check cannot.",
    "",
    ...reads,
    "",
    ...(changed.scenarios.size ? ["Scenarios this change adds or modifies:", "", ...[...changed.scenarios].sort().map((s) => `- \`${s}\``), ""] : []),
    "## The list",
    "",
    ...CHECKLIST.map((x, i) => `${i + 1}. ${x}`),
    "",
    ...(last
      ? [
          `## Findings of round ${last.round} to check again`,
          "",
          "The authoring Roles have revised the package. For each finding, check whether it is fixed; one that is not stays in your verdict, as written or sharper.",
          "",
          ...last.findings.map((f, i) => `${i + 1}. [item ${f.item}] ${f.target}: ${f.text}`),
          "",
        ]
      : []),
    "## Verdict",
    "",
    `**Write the whole verdict to \`${out}\` with the Write tool** (the only file you may write), in this shape, then reply with just its first line:`,
    "",
    "```markdown",
    "VERDICT: pass | fix",
    "1. [item 1-4] <task id | scenario id | area>: <problem> -> <expected fix>",
    "Non-blocking:",
    "- <optional remarks>",
    "```",
    "",
    `A finding cites the item of the list it breaks and names one task id (\`T03\`), one requirement or scenario id, or one area (${AREAS.map((a) => `\`${a}\``).join(", ")}). Only a broken item is a finding and only a finding justifies \`fix\`; anything else goes under \`Non-blocking:\`. \`pass\` has no numbered findings. Most important first.`,
    "",
  ].join("\n");
  const dir = join(p.run, "briefs", id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "plan-review.md");
  writeFileSync(path, text);
  return { path, text, round };
}

/** The section the CLI puts at the top of the gate Decision Page when findings were carried; null otherwise. */
export function openFindingsSection(p: Paths, change: Change, w: Workflow): PageSection | null {
  if (!reviewStage(w)) return null;
  const open = carriedFindings(p, change);
  if (!open.length) return null;
  return {
    id: "open-findings",
    title: "Open findings of the independent review",
    body: `The code-reviewer graded the architecture and the plan against a fixed list; after ${MAX_FIX_ROUNDS} rounds of fixes these are still open. Approve with them, or mark this section for a change.`,
    points: open.map((f) => `**item ${f.item}** (${CHECKLIST[f.item - 1] ?? "?"}) \`${f.target}\`: ${f.text}`),
    html: "",
  };
}
