import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { AIDW_STATE_COMMAND } from "../src/policy.js";
import { checkRoster, loadRole } from "../src/roles.js";
import { loadArtifacts } from "../src/artifacts.js";
import { BRIEF_READS } from "../src/run.js";
import { unansweredSection } from "../src/consult.js";
import { loadChange } from "../src/change.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

const ID = "2026-11-24-booking";
const OK = `node -e "process.exit(0)"`;
const TASKS = `tasks:
  - id: T01
    title: Booking API
    role: backend
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]
    depends_on: []
    touches: ["app/api/**"]
    verify: ['${OK}']
    status: pending
  - id: T02
    title: Booking page
    role: frontend
    type: feat
    depends_on: []
    touches: ["app/(site)/**"]
    verify: ['${OK}']
    status: pending
`;

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

/** A change in analysis (before the gate). */
function analyzingProject(): string {
  const root = tempProject();
  temps.push(root);
  expect(cli(root, "init").code).toBe(0);
  expect(cli(root, "change", "new", ID, "--title", "Booking").code).toBe(0);
  for (const s of ["intake", "analyzing"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  return root;
}

/** An approved change in state executing, with T01 (backend) running. */
function buildingProject(): string {
  const root = tempProject();
  temps.push(root);
  expect(cli(root, "init").code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(root, "change", "new", ID, "--title", "Booking").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, TASKS);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(root, ".aidw/architecture/overview.md", "# Architecture\n");
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const t = cli(root, "transition", ID, s);
    expect(t.code, t.err + t.out).toBe(0);
  }
  const approved = cli(root, "approve", ID);
  expect(approved.code, approved.err + approved.out).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  expect(cli(root, "task", "start", "T01").code).toBe(0);
  return root;
}

const PROGRESS = "Done so far: the booking route and its tests.\nNext step: the error shape of a double booking.\nFiles touched: app/api/bookings/route.ts";

function request(root: string, name: string, head: Record<string, string>, question = "Which status code does a double booking return?"): string {
  const front = Object.entries(head).map(([k, v]) => `${k}: ${v}`).join("\n");
  return write(root, `.aidw/changes/${ID}/consult/${name}.request.md`, `---\n${front}\n---\n\n## Question\n\n${question}\n\n## Progress\n\n${PROGRESS}\n`);
}

/** The consulted Role answers and the asker is resumed: its run may ask again. */
function answerAndResume(root: string, cid: string): void {
  write(root, `.aidw/changes/${ID}/consult/${cid}.answer.md`, "STATUS: answered\n\n409.\n");
  expect(cli(root, "consult", "answer", cid).code).toBe(0);
  expect(cli(root, "consult", "resume", cid).code).toBe(0);
}

const records = (root: string) =>
  (YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "consultations.yaml"), "utf8")) as { consultations: Record<string, unknown>[] }).consultations;

describe("consults in role.md (aidw roster)", () => {
  function copy(): string {
    const root = mkdtempSync(join(tmpdir(), "aidw-consult-"));
    temps.push(root);
    for (const f of ["roster.yaml", "tiers.yaml", "roles", "agents", "library"]) cpSync(join(plugin, f), join(root, f), { recursive: true });
    return root;
  }
  const withConsults = (root: string, role: string, list: string) => {
    const file = join(root, "roles", role, "role.md");
    const text = readFileSync(file, "utf8").replace(/^consults:.*\n/m, "");
    writeFileSync(file, text.replace(/^access: (.*)$/m, `access: $1\nconsults: ${list}`));
  };
  const errors = (root: string) => checkRoster(root).errors.map((e) => `${e.file}: ${e.message}`).join("\n");

  it("rejects an unknown role, the role itself, a planned role and a value that is not a list", () => {
    let root = copy();
    withConsults(root, "backend", "[api-designer, nobody]");
    expect(errors(root)).toMatch(/roles\/backend\/role\.md: consults: "nobody" is not a role in roster\.yaml/);
    root = copy();
    withConsults(root, "backend", "[backend]");
    expect(errors(root)).toMatch(/consults: a role does not consult itself/);
    root = copy();
    const roster = join(root, "roster.yaml");
    writeFileSync(roster, readFileSync(roster, "utf8").replace("research: { department: product-analysis, status: active }", "research: { department: product-analysis, status: planned, carried_by: cli }"));
    withConsults(root, "backend", "[research]");
    expect(errors(root)).toMatch(/consults: "research" is not an active role/);
    root = copy();
    withConsults(root, "backend", "api-designer");
    expect(errors(root)).toMatch(/consults must be a list of role ids/);
  });

  it("declares the first pairs of ADR-0013", () => {
    const of = (id: string) => loadRole(plugin, id)?.consults.slice().sort();
    for (const id of ["ux-research", "product-manager", "software-architect"]) expect(of(id), id).toEqual(["research"]);
    expect(of("technical-planner")).toEqual(["software-architect"]);
    for (const id of ["backend", "fullstack"]) expect(of(id), id).toEqual(["api-designer", "database-architect", "software-architect"]);
    expect(of("frontend")).toEqual(["api-designer", "software-architect"]); // T20: it never reads the data model
    expect(of("research")).toEqual([]);
    expect(readFileSync(join(plugin, "agents", "backend.md"), "utf8")).toMatch(/## Consultation[\s\S]*`api-designer`/);
  });
});

describe("aidw consult in the build", () => {
  let root: string;
  beforeEach(() => {
    root = buildingProject();
  });

  it("refuses a pair the asking role does not declare", () => {
    const r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "qa" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/backend does not consult qa/);
    expect(existsSync(join(root, ".aidw/changes", ID, "consultations.yaml"))).toBe(false);
  });

  it("refuses a role that did not author a contract the task reads", () => {
    // no API contract in this change: the api-designer wrote nothing T01 builds against
    const r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "api-designer" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/api-designer wrote no contract that T01 builds against/);
    write(root, `.aidw/changes/${ID}/api-contract.md`, "# API contract\n");
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "api-designer" })).code).toBe(0);
  });

  it("refuses an asker that is not the Agent running the task", () => {
    const r = cli(root, "consult", request(root, "T02", { from: "frontend", task: "T02", to: "software-architect" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/T02 is not running/);
  });

  it("records the Consultation and prints the spawn of the consulted Role with its brief", () => {
    const file = request(root, "T01", { from: "backend", task: "T01", to: "software-architect" });
    const r = cli(root, "consult", file);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/C01 recorded: backend \(T01\) asks software-architect/);
    expect(r.out).toMatch(/SPAWN aidw:software-architect with: Consultation brief: .*C01\.consult\.md/);
    expect(r.out).toMatch(/Then: aidw consult answer C01/);
    // the request is kept under the Consultation's id, so the asker may write a second one at the same path
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(root, ".aidw/changes", ID, "consult/C01.request.md"), "utf8")).toMatch(/double booking/);
    expect(records(root)[0]).toMatchObject({ id: "C01", from: "backend", to: "software-architect", task: "T01", run: "task:T01#1", status: "open", answer: "consult/C01.answer.md" });
    const brief = readFileSync(join(root, ".aidw/run/briefs", ID, "C01.consult.md"), "utf8");
    expect(brief).toMatch(/Which status code does a double booking return\?/);
    expect(brief).toMatch(/consult\/C01\.answer\.md/);
    expect(brief).toMatch(/STATUS: answered/);
    expect(brief).toMatch(/you cannot consult another Role/i);
  });

  it("refuses a third Consultation in one Agent run", () => {
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" })).code).toBe(0);
    answerAndResume(root, "C01");
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" }, "And the retry header?")).code).toBe(0);
    answerAndResume(root, "C02");
    const r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" }, "One more?"));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/at most 2 Consultations per Agent run/);
  });

  it("refuses a consulted Agent's own request (depth 1)", () => {
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" })).code).toBe(0);
    // software-architect declares research, so only the depth rule stops it
    let r = cli(root, "consult", request(root, "C01-ask", { from: "software-architect", consultation: "C01", to: "research" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/a consulted Agent cannot consult/);
    r = cli(root, "consult", request(root, "architecture-software-architect", { from: "software-architect", stage: "architecture", to: "research" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/a consulted Agent cannot consult/);
  });

  it("writes a resume brief with the original brief, the progress note and the answer path", () => {
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" })).code).toBe(0);
    expect(cli(root, "consult", "answer", "C01").err).toMatch(/no answer at .*C01\.answer\.md/);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: answered\n\n409 with the error shape of the contract.\n");
    const r = cli(root, "consult", "answer", "C01");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Then: aidw consult resume C01/);
    const resume = readFileSync(join(root, ".aidw/run/briefs", ID, "C01.resume.md"), "utf8");
    const original = readFileSync(join(root, ".aidw/run/briefs", ID, "T01.implement.md"), "utf8");
    expect(resume).toContain(original.trim());
    expect(resume).toContain("Next step: the error shape of a double booking.");
    expect(resume).toContain(join(root, ".aidw/changes", ID, "consult/C01.answer.md"));
    expect(records(root)[0]).toMatchObject({ status: "answered", resume: `run/briefs/${ID}/C01.resume.md` });
  });

  it("aidw next in a fresh session surfaces the pending Consultation, then the resume, then the task", () => {
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" })).code).toBe(0);
    let n = cli(root, "next", "--json").json();
    expect(n).toMatchObject({ action: "consult", step: "answer", consultation: "C01", to: "software-architect", task: "T01" });
    expect(cli(root, "next").out).toMatch(/aidw consult answer C01/);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: answered\n\n409.\n");
    expect(cli(root, "consult", "answer", "C01").code).toBe(0);
    n = cli(root, "next", "--json").json();
    expect(n).toMatchObject({ action: "consult", step: "resume", consultation: "C01", from: "backend" });
    expect(cli(root, "next").out).toMatch(/aidw consult resume C01/);
    const r = cli(root, "consult", "resume", "C01");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/SendMessage/);
    expect(r.out).toMatch(/SPAWN aidw:backend with: Resume brief: .*C01\.resume\.md/);
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "implement", task: "T01", reason: "interrupted" });
    // a later brief of the task still carries the answer, in case the resumed Agent was lost too
    expect(cli(root, "task", "start", "T01").code).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/briefs", ID, "T01.implement.md"), "utf8")).toMatch(/C01[\s\S]*C01\.answer\.md/);
  });

  it("after the gate, an answer that cannot be given is routed inside the factory, never to the user", () => {
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" })).code).toBe(0);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: changes-approved\n\nThe contract must name a 409.\n");
    const r = cli(root, "consult", "answer", "C01");
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/Deviation/);
    expect(r.out).not.toMatch(/ask the user|tell the user/i);
    expect(records(root)[0]).toMatchObject({ status: "needs-deviation", outcome: "changes-approved" });
    const resume = readFileSync(join(root, ".aidw/run/briefs", ID, "C01.resume.md"), "utf8");
    expect(resume).toMatch(/do not ask the user/i);
  });

  it("the brief of a task tells its Agent where to write a request and whom it may ask", () => {
    write(root, `.aidw/changes/${ID}/data-model.md`, "# Data model\n");
    expect(cli(root, "brief", "T01").code).toBe(0);
    const brief = readFileSync(join(root, ".aidw/run/briefs", ID, "T01.implement.md"), "utf8");
    expect(brief).toContain(join(root, ".aidw/changes", ID, "consult/T01.request.md"));
    expect(brief).toMatch(/database-architect, software-architect/);
    expect(brief).not.toMatch(/may ask[^\n]*api-designer/);
  });
});

describe("aidw consult before the gate", () => {
  it("lets a stage Role ask a Role it declares, counted per stage, and aidw stages surfaces it", () => {
    const root = analyzingProject();
    const r = cli(root, "consult", request(root, "requirements-product-manager", { from: "product-manager", stage: "requirements", to: "research" }));
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/SPAWN aidw:research/);
    expect(records(root)[0]).toMatchObject({ run: "stage:requirements:product-manager", status: "open" });
    expect(cli(root, "stages").out).toMatch(/consultation C01[\s\S]*aidw consult answer C01/);
    // a stage that does not have the role
    const bad = cli(root, "consult", request(root, "x", { from: "product-manager", stage: "architecture", to: "research" }));
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/product-manager has no part in stage architecture/);
    // before the gate, an answer it cannot give goes back as an open question for the gate
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: cannot-answer\n\nNo data on this market.\n");
    expect(cli(root, "consult", "answer", "C01").code).toBe(0);
    expect(records(root)[0]).toMatchObject({ status: "unanswered" });
    expect(readFileSync(join(root, ".aidw/run/briefs", ID, "C01.resume.md"), "utf8")).toMatch(/open question/);
  });
});

describe("the gate and the consult command", () => {
  const env = {} as NodeJS.ProcessEnv;
  const hook = (root: string, tool_name: string, tool_input: Record<string, unknown>, agent_type?: string): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    cwd: root,
    ...(agent_type ? { agent_type } : {}),
  });

  it("is a state command: a subagent may not run it", () => {
    expect(AIDW_STATE_COMMAND.test(`aidw consult .aidw/changes/${ID}/consult/T01.request.md`)).toBe(true);
    const root = buildingProject();
    expect(decide(hook(root, "Bash", { command: "aidw consult x.request.md" }, "aidw:backend"), env)?.decision).toBe("deny");
  });

  it("lets an implementer write its request file and nothing else new; the consulted Role writes its answer", () => {
    const root = buildingProject();
    const dir = join(root, ".aidw/changes", ID, "consult");
    const as = (file: string, who: string) => decide(hook(root, "Write", { file_path: file }, who), env)?.decision;
    expect(as(join(dir, "T01.request.md"), "aidw:backend")).toBe("allow");
    expect(as(join(dir, "C01.request.md"), "aidw:backend")).toBe("deny");
    expect(as(join(dir, "C01.answer.md"), "aidw:backend")).toBe("deny");
    expect(as(join(root, ".aidw/changes", ID, "notes.md"), "aidw:backend")).toBe("deny");
    // only the Role consulted in an open Consultation writes its answer
    expect(as(join(dir, "C01.answer.md"), "aidw:software-architect")).toBe("deny");
    expect(cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" })).code).toBe(0);
    expect(as(join(dir, "C01.answer.md"), "aidw:software-architect")).toBe("allow");
    expect(as(join(dir, "c01.answer.md"), "aidw:software-architect")).toBe("deny");
    expect(as(join(dir, "C01.answer.md"), "aidw:api-designer")).toBe("deny");
    expect(as(join(dir, "C02.answer.md"), "aidw:software-architect")).toBe("deny");
    expect(as(join(dir, "C01.request.md"), "aidw:software-architect")).toBe("deny");
    // the request of a task the implementer does not run, or that is not running
    expect(as(join(dir, "T02.request.md"), "aidw:frontend")).toBe("deny");
    expect(as(join(dir, "notes.request.md"), "aidw:backend")).toBe("deny");
    expect(as(join(root, ".aidw/changes", ID, "consultations.yaml"), "aidw:api-designer")).toBe("deny");
    expect(as(join(dir, "C01.answer.md"), "aidw:code-reviewer")).toBe("deny");
  });
});

describe("review follow-ups", () => {
  const setTask = (root: string, taskId: string, fields: Record<string, unknown>) => {
    const file = join(root, ".aidw/changes", ID, "tasks.yaml");
    const data = YAML.parse(readFileSync(file, "utf8")) as { tasks: Record<string, unknown>[] };
    Object.assign(data.tasks.find((x) => x.id === taskId) as object, fields);
    writeFileSync(file, YAML.stringify(data));
  };
  const asks = (root: string, question?: string) => cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" }, question));

  it("the rest of a Wave carries on while one of its tasks waits for an answer (next names both)", () => {
    const root = buildingProject();
    // T01 runs in its own worktree (a wave task); T02 waits for its review
    setTask(root, "T01", { worktree: `.aidw/run/worktrees/${ID}/T01` });
    setTask(root, "T02", { status: "review" });
    expect(asks(root).code).toBe(0);
    const n = cli(root, "next", "--json").json();
    expect(n).toMatchObject({ action: "consult", step: "answer", consultation: "C01", meanwhile: { action: "review", task: "T02" } });
    expect(cli(root, "next").out).toMatch(/aidw consult answer C01.*Meanwhile, in the same message: review T02/);
    // nothing else to do: the waiting task is not offered as interrupted
    setTask(root, "T02", { status: "done" });
    expect(cli(root, "next", "--json").json().meanwhile).toBeUndefined();
    // a new task starts beside it only where the asker leaves room: here parallel.max is 1 (no git) and T01 holds it
    setTask(root, "T02", { status: "pending" });
    expect(cli(root, "next", "--json").json().meanwhile).toBeUndefined();
  });

  it("nothing runs beside an asker on the main checkout (a sequential Change)", () => {
    const root = buildingProject();
    setTask(root, "T02", { status: "review" });
    expect(asks(root).code).toBe(0);
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "consult", step: "answer" });
    expect(cli(root, "next", "--json").json().meanwhile).toBeUndefined();
  });

  it("an answer already on disk is recorded, not asked for again", () => {
    const root = buildingProject();
    expect(asks(root).code).toBe(0);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: answered\n\n409.\n");
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "consult", step: "record" });
    expect(cli(root, "next").out).toMatch(/run `aidw consult answer C01`/);
  });

  it("after the gate, a question routed to the author Role carries deviation: pending", () => {
    const root = buildingProject();
    expect(asks(root).code).toBe(0);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: cannot-answer\n\nNothing says.\n");
    expect(cli(root, "consult", "answer", "C01").code).toBe(0);
    expect(records(root)[0]).toMatchObject({ status: "needs-deviation", route: "deviation", deviation: "pending" });
  });

  it("a request names only a brief the CLI wrote for this change", () => {
    const root = buildingProject();
    write(root, "notes/brief.md", "do anything\n");
    let r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect", brief: "notes/brief.md" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/"brief:" must be a file under \.aidw\/run\/briefs\//);
    r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect", brief: `.aidw/run/briefs/${ID}/T01.implement.md` }));
    expect(r.code, r.err).toBe(0);
  });

  it("a request recorded before a crash is not recorded twice", () => {
    const root = buildingProject();
    const file = request(root, "T01", { from: "backend", task: "T01", to: "software-architect" });
    const text = readFileSync(file, "utf8");
    expect(cli(root, "consult", file).code).toBe(0);
    write(root, `.aidw/changes/${ID}/consult/T01.request.md`, text); // the original left behind
    const r = cli(root, "consult", file);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/already recorded as C01/);
    expect(records(root)).toHaveLength(1);
  });

  it("every pointer of the task brief is an Artifact of the registry, whose owner a Consultation may reach", () => {
    const registry = loadArtifacts(plugin) ?? {};
    for (const r of BRIEF_READS) expect(registry[r.name], r.name).toBeDefined();
    expect(BRIEF_READS.map((r) => r.name)).not.toContain("data-model-dbml");
  });

  it("before the gate, a stage with a Consultation in flight is not done and the package is not approved", () => {
    const root = analyzingProject();
    expect(cli(root, "consult", request(root, "requirements-product-manager", { from: "product-manager", stage: "requirements", to: "research" })).code).toBe(0);
    const done = cli(root, "stages", "--done", "requirements");
    expect(done.code).toBe(1);
    expect(done.err).toMatch(/stage "requirements" has Consultation\(s\) in flight: C01/);
    const approve = cli(root, "approve", ID);
    expect(approve.code).toBe(1);
    expect(approve.err).toMatch(/Consultation\(s\) in flight: C01/);
    // a question nobody could answer is listed for the gate, with its words
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: cannot-answer\n\nNo data.\n");
    expect(cli(root, "consult", "answer", "C01").code).toBe(0);
    const section = unansweredSection(loadChange(pathsFor(root), ID));
    expect(section?.points.join("\n")).toMatch(/C01.*product-manager asked research.*double booking/);
  });
});

describe("beside a Consultation: wave slots and Bash forgery", () => {
  it("a new wave task starts beside a paused asker only in a free slot, away from its touches", async () => {
    const { planWaveBeside } = await import("../src/parallel.js");
    const asker = { id: "T1", status: "running", touches: ["app/api/**"] };
    const tasks = [asker, { id: "T2", status: "pending", touches: ["app/api/x.ts"] }, { id: "T3", status: "pending", touches: ["app/web/**"] }, { id: "T4", status: "pending", touches: ["lib/**"] }];
    expect(planWaveBeside(tasks, 1, [asker]).map((t) => t.id)).toEqual([]);
    expect(planWaveBeside(tasks, 2, [asker]).map((t) => t.id)).toEqual(["T3"]);
    expect(planWaveBeside(tasks, 3, [asker]).map((t) => t.id)).toEqual(["T3", "T4"]);
  });

  it("aidw roster refuses consults naming a read-only Role", () => {
    const root = mkdtempSync(join(tmpdir(), "aidw-consult-ro-"));
    temps.push(root);
    for (const f of ["roster.yaml", "tiers.yaml", "roles", "agents", "library"]) cpSync(join(plugin, f), join(root, f), { recursive: true });
    const file = join(root, "roles", "backend", "role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^consults:.*$/m, "consults: [code-reviewer]"));
    expect(checkRoster(root).errors.map((e) => e.message).join("\n")).toMatch(/consults: "code-reviewer" is read-only/);
  });

  it("redirect forms and dd count as writes", async () => {
    const { WRITE_COMMANDS, writeTargets, firstMatch } = await import("../src/policy.js");
    for (const c of ["echo x 1> f", "echo x 2> f", "echo x 2>> f", "echo x &> f", "echo x &>> f", "echo x >| f", "echo x | dd of=f"]) {
      expect([c, !!firstMatch(WRITE_COMMANDS, c)]).toEqual([c, true]);
    }
    for (const c of ["ls 2>/dev/null", "cmd 2>&1 | grep x", "a => b"]) expect([c, !!firstMatch(WRITE_COMMANDS, c)]).toEqual([c, false]);
    expect(writeTargets("echo x >| .aidw/a.md")).toEqual([".aidw/a.md"]);
  });
});
