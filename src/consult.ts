/**
 * Consultation (ADR-0013, plan D7): an Agent that lacks information asks another Role through the Orchestrator,
 * never by spawning it, and never guesses.
 *
 *   the asking Agent   writes `.aidw/changes/<id>/consult/<name>.request.md` (front matter `from`, `task` or `stage`,
 *                      `to`; sections `## Question` and `## Progress`) and ends its turn with `CONSULT <path>`
 *   aidw consult <request>      checks the pair, depth 1, the budget and (in the build) the contract author; records
 *                               C<NN> in consultations.yaml and writes the brief of the consulted Role
 *   the consulted Role writes `consult/C<NN>.answer.md`, first line `STATUS: answered | cannot-answer | changes-approved`
 *   aidw consult answer C<NN>   reads the answer, routes it (ADR-0014 after the gate) and always writes a resume brief
 *   aidw consult resume C<NN>   the asker continues: SendMessage to the live Agent, or a fresh Agent of the same Role
 *
 * Every step is in files, so a fresh session (the runner's `claude -p /aidw:resume`) picks up where the last one
 * stopped: `aidw next` and `aidw stages` surface an open or answered Consultation before anything else.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { loadArtifacts } from "./artifacts.js";
import { loadChange, stateOf, type Change } from "./change.js";
import { workflowOfChange } from "./decisions.js";
import { OpError } from "./diag.js";
import { machineOf } from "./machine.js";
import { BRIEF_READS } from "./briefreads.js";
import type { PageSection } from "./page.js";
import { readText, rel, walkFiles, type Paths } from "./project.js";
import { defaultTaskRole, implementerOf, loadRole, loadRoster } from "./roles.js";
import { touchesUi } from "./skills.js";
import { parseTasks, type Task } from "./tasks.js";
import { openDeviation } from "./deviationrecord.js";
import { agentRunStatus, capReason } from "./agentruns.js";

/** One Agent run asks at most this many questions (ADR-0013): the worst-case cost is known beforehand. */
export const MAX_CONSULTATIONS_PER_RUN = 2;

export const ANSWER_STATUSES = ["answered", "cannot-answer", "changes-approved"] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

/**
 *   open             waiting for the consulted Role's answer
 *   answered         answered; the resume brief is written, the asker has not been resumed yet
 *   unanswered       before the gate: the consulted Role could not answer (the asker records an open question for the gate)
 *   needs-deviation  after the gate: no answer without changing something approved; goes to the author Role (ADR-0014)
 *   resumed          the asker was continued with the answer
 */
export type ConsultationStatus = "open" | "answered" | "unanswered" | "needs-deviation" | "resumed";

export interface Consultation {
  id: string;
  from: string;
  to: string;
  task?: string;
  stage?: string;
  /**
   * the Agent run that asked: `task:<T>#<run>` (the task's `runs` counter, raised on every new attempt and never reset,
   * so a retry the user grants is a new run) or `stage:<stage>:<role>` (not reset across plan-review fix rounds: one
   * budget per stage and Role, on purpose); the budget counts per run
   */
  run: string;
  /** paths relative to the Change folder (request, answer) and to `.aidw/` (brief, resume) */
  request: string;
  answer: string;
  brief: string;
  /** the brief the asker started from, relative to `.aidw/` or the project, when known */
  origin?: string;
  after_gate: boolean;
  status: ConsultationStatus;
  outcome?: AnswerStatus;
  resume?: string;
  /** after the gate: where the question goes when it is not answered (T9 builds the Deviation path) */
  route?: "deviation";
  /** with route deviation: `pending` until the Deviation path (T9) records it as `recorded` */
  deviation?: "pending" | "recorded" | "abandoned";
  /** the Deviation that recorded it (src/deviation.ts) */
  deviation_id?: string;
  at: string;
  answered_at?: string;
  resumed_at?: string;
}

const now = () => new Date().toISOString();
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export const CONSULT_DIR = "consult";
export const CONSULT_RECORD = "consultations.yaml";
const recordFile = (change: Change) => join(change.dir, CONSULT_RECORD);
const briefsDir = (p: Paths, id: string) => join(p.run, "briefs", id);

/** Where the Agent of a task writes its question: the brief gives this exact path. */
export const taskRequestPath = (p: Paths, id: string, taskId: string) => join(p.changes, id, CONSULT_DIR, `${taskId}.request.md`);
/** Where an authoring Agent of a stage writes its question. */
export const stageRequestPath = (p: Paths, id: string, stage: string, role: string) => join(p.changes, id, CONSULT_DIR, `${stage}-${role}.request.md`);

export function loadConsultations(change: Change): Consultation[] {
  const text = readText(recordFile(change));
  if (text === null) return [];
  const data = YAML.parse(text) as unknown;
  const list = isRecord(data) && Array.isArray(data.consultations) ? data.consultations : [];
  return list.filter(isRecord) as unknown as Consultation[];
}

function saveConsultations(change: Change, list: Consultation[]): void {
  writeFileSync(recordFile(change), YAML.stringify({ consultations: list }));
}

/** The first Consultation that still needs the Orchestrator: an open one (get the answer) or an answered one (resume the asker). */
export function pendingConsultation(change: Change): Consultation | null {
  const list = loadConsultations(change);
  return list.find((c) => c.status === "open") ?? list.find((c) => c.status !== "open" && c.status !== "resumed") ?? null;
}

/** The Roles a Role declares under `consults:` in its role.md. */
export const consultsOf = (pluginRoot: string, role: string): string[] => loadRole(pluginRoot, role)?.consults ?? [];

/** The CLI's copies in consult/: `C<NN>.request.md`, `C<NN>.answer.md` (any case: macOS and Windows ignore it). */
export const RECORDED_FILE = /^c\d+\./i;

/** The task's Agent-run counter: raised by `aidw task start` on every new attempt, never reset (a granted retry included). */
export const taskRun = (t: Task): number =>
  Number.isInteger(t.runs) ? Number(t.runs) : Number.isInteger(t.attempts) && Number(t.attempts) > 0 ? Number(t.attempts) : 1;

/** Whether an Artifact of the registry exists for this Change (a family such as `decisions/NNNN-<slug>.md` when any member does). */
function artifactExists(p: Paths, id: string, path: string): boolean {
  const parts = path.replace(/<id>/g, id).split("/");
  const at = parts.findIndex((x) => /<[^>]+>|NNNN/.test(x));
  if (at < 0) return existsSync(join(p.aidw, ...parts));
  return walkFiles(join(p.aidw, ...parts.slice(0, at))).some((f) => f.endsWith(".md"));
}

/**
 * The Roles that wrote the contracts a task builds against (ADR-0013): the owners, in artifacts.yaml, of the Artifacts
 * its brief reads (src/briefreads.ts) that exist in this Change (api-designer for the API contract, database-architect for the data
 * model, software-architect for the architecture).
 */
export function contractAuthors(p: Paths, id: string, task: Task, pluginRoot: string): string[] {
  let registry: ReturnType<typeof loadArtifacts> = null;
  try {
    registry = loadArtifacts(pluginRoot);
  } catch {
    registry = null;
  }
  if (!registry) return [];
  const names = BRIEF_READS.filter((r) => !r.ui || touchesUi(task)).map((r) => r.name);
  const owners = new Set<string>();
  for (const n of names) {
    const e = registry[n];
    if (e && typeof e.path === "string" && typeof e.owner === "string" && artifactExists(p, id, e.path)) owners.add(e.owner);
  }
  return [...owners].sort();
}

/** The Roles the Agent of a task may consult: declared by its Role and authors of a contract the task reads. */
export function taskConsultable(p: Paths, id: string, task: Task, pluginRoot: string): { role: string; roles: string[] } {
  const role = agentRoleOf(pluginRoot, task);
  const authors = contractAuthors(p, id, task, pluginRoot);
  return { role, roles: consultsOf(pluginRoot, role).filter((r) => authors.includes(r)) };
}

const agentRoleOf = (pluginRoot: string, t: Task): string => implementerOf(pluginRoot, typeof t.role === "string" ? t.role : undefined) ?? defaultTaskRole();

// ---------------------------------------------------------------- the request

export interface ConsultRequest {
  from: string;
  to: string;
  task?: string;
  stage?: string;
  consultation?: string;
  brief?: string;
  question: string;
  progress: string;
}

function section(body: string, heading: string): string {
  const m = new RegExp(`^##\\s+${heading}\\s*$`, "im").exec(body);
  if (!m) return "";
  const rest = body.slice(m.index + m[0].length);
  const end = /^##\s+/m.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}

export function parseRequest(text: string, file: string): ConsultRequest {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) throw new OpError(`${file}: a request starts with a front matter between --- lines (from, task or stage, to)`);
  let head: unknown;
  try {
    head = YAML.parse(m[1] ?? "");
  } catch (e) {
    throw new OpError(`${file}: the front matter is not valid YAML: ${(e as Error).message}`);
  }
  if (!isRecord(head)) throw new OpError(`${file}: the front matter must be a mapping`);
  const s = (k: string) => (head[k] === undefined || head[k] === null ? undefined : String(head[k]).trim());
  const body = m[2] ?? "";
  const r: ConsultRequest = {
    from: s("from") ?? "",
    to: s("to") ?? "",
    ...(s("task") ? { task: s("task") } : {}),
    ...(s("stage") ? { stage: s("stage") } : {}),
    ...(s("consultation") ? { consultation: s("consultation") } : {}),
    ...(s("brief") ? { brief: s("brief") } : {}),
    question: section(body, "Question"),
    progress: section(body, "Progress"),
  };
  if (!r.from) throw new OpError(`${file}: "from:" (the asking Role) is missing`);
  if (!r.to) throw new OpError(`${file}: "to:" (the Role asked) is missing`);
  if (!r.question) throw new OpError(`${file}: the "## Question" section is missing or empty`);
  if (!r.progress) throw new OpError(`${file}: the "## Progress" section is missing or empty (done so far, next step, files touched): a fresh Agent continues from it`);
  return r;
}

/** The Change a request belongs to: from its path (`changes/<id>/consult/...`), or the id given. */
export function changeOfRequest(p: Paths, file: string, given: string | undefined): string | undefined {
  const r = relative(p.changes, file);
  if (r && !r.startsWith("..") && !isAbsolute(r)) {
    const parts = r.split(sep);
    if (parts.length === 3 && parts[1] === CONSULT_DIR) return parts[0];
  }
  return given;
}

// ---------------------------------------------------------------- aidw consult <request>

export interface ConsultResult {
  consultation: Consultation;
  brief: string;
  agent: string;
}

const isAfterGate = (p: Paths, change: Change): boolean => {
  const st = stateOf(change);
  return !!st && machineOf(p, change).approvalRequired.has(st);
};

const who = (c: Pick<Consultation, "from" | "task" | "stage">) => `${c.from} (${c.task ?? `stage ${c.stage}`})`;

export function requestConsultation(p: Paths, id: string, requestFile: string, pluginRoot: string): ConsultResult {
  const change = loadChange(p, id);
  const file = resolve(p.project, requestFile);
  // `C<NN>.*` are the CLI's own copies: submitting one again would take a recorded request away from its Consultation.
  if (RECORDED_FILE.test(basename(file))) throw new OpError(`${rel(p, file)} is the recorded copy of a Consultation, not a new request: the asker writes its own request file (<task>.request.md or <stage>-<role>.request.md)`);
  const text = readText(file);
  if (text === null) throw new OpError(`no request at ${file}`);
  const req = parseRequest(text, rel(p, file));
  const list = loadConsultations(change);
  // A crash after the record was saved but before the request was removed leaves it behind: never record it twice.
  const same = list.find((c) => readText(join(change.dir, c.request))?.trim() === text.trim());
  if (same) {
    rmSync(file, { force: true });
    throw new OpError(`this request is already recorded as ${same.id} (${same.status}); continue with \`aidw next\``);
  }
  const roster = loadRoster(pluginRoot);

  // Depth 1 first: whatever else the request says, a consulted Agent does not ask in turn. The check is by Role: with
  // today's stage order no Role answers a Consultation while an Agent of it runs its own work.
  const answering = list.find((c) => c.status === "open" && c.to === req.from);
  if (req.consultation || answering) {
    throw new OpError(`a consulted Agent cannot consult (depth 1, ADR-0013): ${req.from} is answering ${req.consultation ?? answering?.id}. It answers from what exists, or writes STATUS: cannot-answer`);
  }
  if (roster.roles[req.from]?.status !== "active") throw new OpError(`"${req.from}" is not an active Role`);
  if (roster.roles[req.to]?.status !== "active") throw new OpError(`"${req.to}" is not an active Role`);
  if (!consultsOf(pluginRoot, req.from).includes(req.to)) {
    const may = consultsOf(pluginRoot, req.from);
    throw new OpError(`${req.from} does not consult ${req.to}: its role.md declares ${may.length ? `consults: [${may.join(", ")}]` : "no consults"}`);
  }
  if (!!req.task === !!req.stage) throw new OpError(`${rel(p, file)}: name exactly one of "task:" (in the build) or "stage:" (before the gate)`);

  const afterGate = isAfterGate(p, change);
  let run: string;
  let origin: string | undefined;
  if (req.task) {
    if (!afterGate) throw new OpError(`change "${id}" is not approved: before the gate an Agent asks from its stage ("stage:"), not from a task`);
    const text = readText(join(change.dir, "tasks.yaml"));
    const task = text === null ? undefined : parseTasks(text).tasks.find((t) => t.id === req.task);
    if (!task) throw new OpError(`task "${req.task}" not found in ${id}/tasks.yaml`);
    if (String(task.status ?? "pending") !== "running") throw new OpError(`task ${req.task} is not running (it is "${String(task.status ?? "pending")}"): only the Agent running a task asks for it`);
    const role = agentRoleOf(pluginRoot, task);
    if (role !== req.from) throw new OpError(`task ${req.task} is run by ${role}, not ${req.from}`);
    // ADR-0013: in the build an implementing Role asks only the authors of the contracts it builds against.
    if (!contractAuthors(p, id, task, pluginRoot).includes(req.to)) {
      throw new OpError(`${req.to} wrote no contract that ${req.task} builds against: in the build ${req.from} asks only the authors of the Artifacts its brief reads (${contractAuthors(p, id, task, pluginRoot).join(", ") || "none"})`);
    }
    // D10: at the cap on Agent runs no new Agent is spawned to answer: the asker builds what was approved and reports the gap
    const cap = agentRunStatus(p, change);
    if (cap.reached) throw new OpError(`no Consultation at the cap: ${capReason(cap)}. ${req.from} builds what the approved package states and reports the gap; nobody answers in its place`);
    run = `task:${req.task}#${taskRun(task)}`;
    const brief = join(briefsDir(p, id), `${req.task}.implement.md`);
    if (existsSync(brief)) origin = relative(p.aidw, brief).split(sep).join("/");
  } else {
    if (afterGate) throw new OpError(`change "${id}" is past the Approval Gate: an Agent asks from the task it runs ("task:")`);
    const w = workflowOfChange(p, change, pluginRoot);
    const stage = w.stages.find((s) => s.id === req.stage);
    if (!stage) throw new OpError(`workflow "${w.id}" has no stage "${req.stage}"`);
    if (!stage.roles.includes(req.from)) throw new OpError(`${req.from} has no part in stage ${req.stage} (its roles: ${stage.roles.join(", ")})`);
    run = `stage:${req.stage}:${req.from}`;
  }
  if (req.brief) {
    // only a brief the CLI wrote for this Change: the resume brief copies its text
    const b = resolve(p.project, req.brief);
    const r = relative(briefsDir(p, id), b);
    if (!r || r.startsWith("..") || isAbsolute(r)) throw new OpError(`${rel(p, file)}: "brief:" must be a file under ${rel(p, briefsDir(p, id))}/`);
    origin = relative(p.aidw, b).split(sep).join("/");
  }
  // The asker ends its turn with its question: a second request of a run whose Consultation is still open is not from it.
  const waiting = list.find((c) => c.run === run && c.status === "open");
  if (waiting) throw new OpError(`the Agent run ${run} is waiting for ${waiting.id}: it ended its turn with that question, so this request is not from it`);
  const used = list.filter((c) => c.run === run).length;
  if (used >= MAX_CONSULTATIONS_PER_RUN) {
    throw new OpError(`${req.from} already asked ${used} question(s) in this run (${run}): at most ${MAX_CONSULTATIONS_PER_RUN} Consultations per Agent run (ADR-0013). It goes on from what it has and says what is still open`);
  }

  const n = list.length + 1;
  const cid = `C${String(n).padStart(2, "0")}`;
  const dir = join(change.dir, CONSULT_DIR);
  mkdirSync(dir, { recursive: true });
  const kept = join(dir, `${cid}.request.md`);
  const c: Consultation = {
    id: cid,
    from: req.from,
    to: req.to,
    ...(req.task ? { task: req.task } : {}),
    ...(req.stage ? { stage: req.stage } : {}),
    run,
    request: `${CONSULT_DIR}/${cid}.request.md`,
    answer: `${CONSULT_DIR}/${cid}.answer.md`,
    brief: `run/briefs/${id}/${cid}.consult.md`,
    ...(origin ? { origin } : {}),
    after_gate: afterGate,
    status: "open",
    at: now(),
  };
  // Kept under the Consultation's id, so the asker's next request may use the same path. Copy, record, then remove:
  // a crash leaves at worst an unrecorded copy (overwritten by the next C<NN>) or the original (refused as recorded).
  writeFileSync(kept, text);
  const brief = consultBrief(p, change, c, req, used, pluginRoot);
  saveConsultations(change, [...list, c]);
  rmSync(file, { force: true });
  return { consultation: c, brief, agent: `aidw:${req.to}` };
}

function consultBrief(p: Paths, change: Change, c: Consultation, req: ConsultRequest, used: number, pluginRoot: string): string {
  let registry: ReturnType<typeof loadArtifacts> = null;
  try {
    registry = loadArtifacts(pluginRoot);
  } catch {
    registry = null;
  }
  const own = Object.entries(registry ?? {})
    .filter(([, e]) => e?.owner === c.to && typeof e.path === "string" && artifactExists(p, change.id, e.path))
    .map(([name, e]) => `- \`${join(p.aidw, e.path.replace(/<id>/g, change.id))}\`${e.part ? ` (${e.part})` : ""}: ${name}`);
  const answer = join(change.dir, c.answer);
  const lines = [
    `# Consultation brief: ${c.id} - ${who(c)} asks ${c.to}`,
    "",
    `Change \`${change.id}\` · ${c.after_gate ? "after the Approval Gate (the package is approved)" : "before the Approval Gate"} · question ${used + 1} of at most ${MAX_CONSULTATIONS_PER_RUN} in the asker's run`,
    "",
    `You are the ${c.to} Role, consulted by another Agent through the orchestrator. You answer one question; you do not take over the asker's work.`,
    "",
    "## Question",
    "",
    req.question,
    "",
    "## What the asker has done (context only)",
    "",
    req.progress,
    "",
    "## Read first (read only what the answer needs)",
    "",
    `- \`${join(change.dir, c.request)}\`: the request as the asker wrote it`,
    ...(c.origin ? [`- \`${resolve(p.aidw, c.origin)}\`: the brief the asker works from`] : []),
    ...own,
    "",
    "## Rules",
    "",
    "- You cannot consult another Role (depth 1). Answer from the Artifacts and the code that exist; if you cannot, say so.",
    "- Never guess. An answer the asker builds on must come from an Artifact, the code or a stated reason.",
    ...(c.after_gate
      ? [
          "- The package is approved: do not edit an approved Artifact. If the only right answer changes something approved, write `STATUS: changes-approved` and the smallest change that keeps the purpose of the requirement and adds no scope; the change itself is made through the Deviation path (ADR-0014). Nobody asks the user.",
        ]
      : ["- Before the gate you may correct an Artifact you own when the question shows a hole in it; say which one in your answer."]),
    `- Write your whole answer to \`${answer}\` with the Write tool (the one file this Consultation adds). Its first line is exactly one of \`STATUS: answered\`, \`STATUS: cannot-answer\`, \`STATUS: changes-approved\`.`,
    "- Reply with just that first line.",
    "",
  ];
  const path = join(p.aidw, c.brief);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n"));
  return path;
}

// ---------------------------------------------------------------- aidw consult answer C<NN>

export function parseAnswerStatus(text: string): AnswerStatus | null {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const m = /^\s*STATUS:\s*([a-z-]+)\s*$/i.exec(first);
  const s = m?.[1]?.toLowerCase();
  return s && (ANSWER_STATUSES as readonly string[]).includes(s) ? (s as AnswerStatus) : null;
}

function find(change: Change, cid: string): { list: Consultation[]; i: number; c: Consultation } {
  const list = loadConsultations(change);
  const i = list.findIndex((c) => c.id === cid);
  if (i < 0) throw new OpError(`no Consultation ${cid} in ${change.id}/${CONSULT_RECORD}`);
  return { list, i, c: list[i] as Consultation };
}

export interface AnswerResult {
  consultation: Consultation;
  resume: string;
}

export function recordAnswer(p: Paths, id: string, cid: string, pluginRoot: string): AnswerResult {
  const change = loadChange(p, id);
  const { list, i, c } = find(change, cid);
  if (c.status !== "open") throw new OpError(`${cid} is already ${c.status}`);
  const answerFile = join(change.dir, c.answer);
  const text = readText(answerFile);
  if (text === null) throw new OpError(`no answer at ${answerFile}: the consulted Agent did not write it. Spawn a fresh ${c.to} with the brief ${join(p.aidw, c.brief)}`);
  const outcome = parseAnswerStatus(text);
  if (!outcome) throw new OpError(`${answerFile} does not start with "STATUS: answered", "STATUS: cannot-answer" or "STATUS: changes-approved"; spawn a fresh ${c.to} with the brief once more`);
  let status: ConsultationStatus = "answered";
  if (outcome !== "answered") {
    if (c.after_gate) status = "needs-deviation";
    // Before the gate nothing is approved yet: a change to the consulted Role's own Artifact is an answer.
    else status = outcome === "cannot-answer" ? "unanswered" : "answered";
  }
  const updated: Consultation = {
    ...c,
    status,
    outcome,
    answered_at: now(),
    resume: `run/briefs/${id}/${cid}.resume.md`,
    // ADR-0014: the author Role changes its Artifact as a Deviation (`aidw deviation open --consultation`, src/deviation.ts);
    // closing it sets `recorded`. `aidw next` asks for the Deviation before the asker resumes.
    ...(status === "needs-deviation" ? { route: "deviation" as const, deviation: "pending" as const } : {}),
  };
  writeResumeBrief(p, change, updated, pluginRoot);
  list[i] = updated;
  saveConsultations(change, list);
  return { consultation: updated, resume: join(p.aidw, updated.resume as string) };
}

function originalBrief(p: Paths, change: Change, c: Consultation, pluginRoot: string): string[] {
  if (c.origin) {
    const file = isAbsolute(c.origin) ? c.origin : existsSync(join(p.aidw, c.origin)) ? join(p.aidw, c.origin) : join(p.project, c.origin);
    const text = readText(file);
    if (text !== null) return [`(from \`${file}\`)`, "", text.trim()];
  }
  if (c.stage) {
    try {
      const s = workflowOfChange(p, change, pluginRoot).stages.find((x) => x.id === c.stage);
      if (s) {
        return [
          `Stage \`${s.id}\` (${s.title}) of change \`${change.id}\`, as the ${c.from} Role: follow your Role's procedure for this stage.`,
          `It reads: ${s.reads.join(", ") || "nothing"}. It writes: ${s.writes.join(", ") || "nothing"}.`,
        ];
      }
    } catch {
      // the workflow is not readable: the progress note is what remains
    }
  }
  return [`(the original brief was not kept: continue ${c.task ? `task ${c.task}` : `stage ${c.stage}`} from the progress note)`];
}

function writeResumeBrief(p: Paths, change: Change, c: Consultation, pluginRoot: string): void {
  const req = parseRequest(readText(join(change.dir, c.request)) ?? "", c.request);
  const answer = join(change.dir, c.answer);
  const left = MAX_CONSULTATIONS_PER_RUN - loadConsultations(change).filter((x) => x.run === c.run).length;
  const outcomeText =
    c.status === "answered"
      ? [`${c.to} answered. Read \`${answer}\` first and build on it.`]
      : c.status === "unanswered"
        ? [
            `${c.to} could not answer (\`${answer}\` says why). Do not guess: record the question as an open question in your Artifact (Risks and assumptions), with your recommendation, and go on with the rest. The user sees it at the Approval Gate.`,
          ]
        : [
            `${c.to} could not answer without changing something approved (\`${answer}\` says what). Do not guess and do not ask the user: after the Approval Gate the Role that wrote it decides, as a Deviation (ADR-0014).`,
            `Build what the approved package states. If the task cannot be finished without the answer, write that to your report file, naming ${c.id}, and say in your reply that the task is blocked by ${c.id}.`,
          ];
  const lines = [
    `# Resume brief: ${c.from} continues ${c.task ? `task ${c.task}` : `stage ${c.stage}`} after Consultation ${c.id}`,
    "",
    `Change \`${change.id}\`. An Agent of your Role started this work, asked ${c.to} a question and ended its turn. You continue it in a fresh context: do not start over.`,
    "",
    "## The answer",
    "",
    ...outcomeText,
    "",
    "## Progress note left by the Agent that asked",
    "",
    req.progress,
    "",
    "## The question it asked",
    "",
    req.question,
    "",
    "## Consultations left in this run",
    "",
    left > 0 ? `${left}: ask again only about something new, never the same question.` : "None: go on from what you have and say in your reply what is still open.",
    "",
    "## Original brief",
    "",
    ...originalBrief(p, change, c, pluginRoot),
    "",
  ];
  const path = join(p.aidw, c.resume as string);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

/**
 * A Deviation opened for this Consultation was closed (src/deviation.ts): the record says `recorded` and the resume
 * brief, written when the answer came, gets what changed, so the asker builds on the moved package.
 */
export function deviationRecorded(p: Paths, id: string, cid: string, d: { id: string; roles: string[]; changed?: string[]; reason: string; rerun?: string[] }): void {
  const change = loadChange(p, id);
  const { list, i, c } = find(change, cid);
  list[i] = { ...c, deviation: "recorded", deviation_id: d.id };
  saveConsultations(change, list);
  if (!c.resume) return;
  const path = join(p.aidw, c.resume);
  const text = readText(path);
  if (text === null) return;
  const files = (d.changed ?? []).map((f) => `\`${join(p.project, f)}\``).join(", ");
  writeFileSync(
    path,
    `${text.trimEnd()}\n\n## Deviation ${d.id}: the approved package changed\n\n${d.roles.join(" and ")} changed ${files} after this question (${d.reason}). The CLI checked and recorded it. Read those files again and build on them: where this brief says to build what the approved package states, the package now means the changed one.${d.rerun?.length ? ` Tasks that run again because of it: ${d.rerun.join(", ")}.` : ""}\n`,
  );
}

/** The Deviation opened for this Consultation was abandoned: nothing approved changed, the asker builds what was approved. */
export function deviationAbandoned(p: Paths, id: string, cid: string, did: string): void {
  const change = loadChange(p, id);
  const { list, i, c } = find(change, cid);
  list[i] = { ...c, deviation: "abandoned", deviation_id: did };
  saveConsultations(change, list);
}

// ---------------------------------------------------------------- aidw consult resume C<NN>

export function resumeConsultation(p: Paths, id: string, cid: string): { consultation: Consultation; resume: string; agent: string } {
  const change = loadChange(p, id);
  const { list, i, c } = find(change, cid);
  if (c.status === "open") throw new OpError(`${cid} has no answer yet: run \`aidw consult answer ${cid}\` after ${c.to} wrote it`);
  if (c.status === "resumed") throw new OpError(`${cid} was already resumed`);
  const deviating = openDeviation(change);
  if (deviating?.consultation === cid) throw new OpError(`Deviation ${deviating.id} for ${cid} is still open: \`aidw deviation close\` (or abandon) before the asker resumes`);
  const updated: Consultation = { ...c, status: "resumed", resumed_at: now() };
  list[i] = updated;
  saveConsultations(change, list);
  return { consultation: updated, resume: join(p.aidw, c.resume as string), agent: `aidw:${c.from}` };
}

/** Consultations of one task that were answered, for its next brief: the answer survives a lost resume. */
export function taskAnswers(change: Change, taskId: string): Consultation[] {
  return loadConsultations(change).filter((c) => c.task === taskId && c.status !== "open");
}

/** The NEXT text for a pending Consultation (aidw next, aidw stages). */
export function consultNextText(p: Paths, id: string, c: Consultation): string {
  if (c.status === "open" && existsSync(join(p.changes, id, c.answer))) return `consultation ${c.id}: ${c.to} wrote its answer; run \`aidw consult answer ${c.id} --change ${id}\` (do not spawn it again)`;
  return c.status === "open"
    ? `consultation ${c.id}: ${who(c)} asks ${c.to}; spawn aidw:${c.to} with: Consultation brief: ${join(p.aidw, c.brief)}. Read it and answer as it says. (If you already spawned it and it has not replied, wait.) Then \`aidw consult answer ${c.id} --change ${id}\``
    : `consultation ${c.id} is ${c.status}: resume ${who(c)} with \`aidw consult resume ${c.id} --change ${id}\``;
}

// ---------------------------------------------------------------- the gate on consult/

/**
 * What an Agent may write under `changes/<id>/consult/` (src/gate.ts), or null when the file is not there. Compared
 * without case where it protects (macOS and Windows take `c01.answer.md` for `C01.answer.md`); an allow needs the exact path.
 *   - `C<NN>.answer.md`: only the consulted Role (`to`) of that open Consultation
 *   - any other `C<NN>.*`: nobody (the CLI's copies)
 *   - an implementer: only `<task>.request.md` of a task running in that Change (the hook names the Agent's Role, not its
 *     task, so two implementers of one wave could each write the other's request; `aidw consult` still checks that the
 *     Role runs that task, and a forged request of a run that already asked is refused)
 *   - an author: its request under the normal `.aidw/` rule (null)
 */
export function consultWrite(p: Paths, file: string, agent: string, role: string | null): { allow: boolean; reason: string } | null {
  const low = (x: string) => x.toLowerCase();
  const dir = dirname(file);
  if (low(basename(dir)) !== CONSULT_DIR || low(dirname(dirname(dir))) !== low(p.changes)) return null;
  const id = basename(dirname(dir));
  const exact = existsSync(join(p.changes, id)) && dir === join(p.changes, id, CONSULT_DIR);
  const name = basename(file);
  let change: Change | null = null;
  try {
    change = exact ? loadChange(p, id) : null;
  } catch {
    change = null;
  }
  if (RECORDED_FILE.test(name)) {
    const m = /^(C\d+)\.answer\.md$/.exec(name);
    const c = m && change ? loadConsultations(change).find((x) => x.id === m[1] && x.status === "open") : undefined;
    if (c && c.to === agent) return { allow: true, reason: `the consulted Role's answer to ${c.id}` };
    return { allow: false, reason: "only the Role consulted in an open Consultation writes its answer (C<NN>.answer.md); the other C<NN> files are the CLI's" };
  }
  if (role === "implementer") {
    const m = /^(.+)\.request\.md$/.exec(name);
    const text = change && m ? readText(join(change.dir, "tasks.yaml")) : null;
    const task = text && m ? parseTasks(text).tasks.find((t) => t.id === m[1]) : undefined;
    if (task && String(task.status ?? "pending") === "running") return { allow: true, reason: "implementer question to another Role (Consultation)" };
    return { allow: false, reason: "an implementer writes only <task>.request.md, for the task it runs, directly in consult/ of its change" };
  }
  return null;
}

// ---------------------------------------------------------------- before the gate

/** Consultations of the stages before the gate that the Orchestrator has not finished (not yet resumed). */
export const stageConsultationsInFlight = (change: Change, stage?: string): Consultation[] =>
  loadConsultations(change).filter((c) => c.stage && c.status !== "resumed" && (!stage || c.stage === stage));

/** The questions no consulted Role could answer before the gate: shown on the gate's Decision Page beside the open findings. */
export function unansweredSection(change: Change): PageSection | null {
  const list = loadConsultations(change).filter((c) => !c.after_gate && c.outcome === "cannot-answer");
  if (!list.length) return null;
  const question = (c: Consultation) => {
    try {
      return parseRequest(readText(join(change.dir, c.request)) ?? "", c.request).question.replace(/\s+/g, " ").trim();
    } catch {
      return "(the request could not be read)";
    }
  };
  return {
    id: "unanswered-consultations",
    title: "Questions no Role could answer",
    body: "An Agent asked another Role these questions while drafting the package and got no answer. Each is recorded as an open question in the asker's Artifact. Approve with them, or mark this section for a change.",
    points: list.map((c) => `**${c.id}** ${c.from} asked ${c.to} (stage \`${c.stage}\`): ${question(c)}`),
    html: "",
  };
}
