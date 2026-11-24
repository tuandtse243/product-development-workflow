import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { requestConsultation } from "../src/consult.js";
import { decide, type HookInput } from "../src/gate.js";
import { pathsFor } from "../src/project.js";
import { checkRoster, loadRole, loadTiers, renderAgent, type RoleProfile } from "../src/roles.js";
import { fingerprint } from "../src/runner.js";
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

function analyzingProject(): string {
  const root = tempProject();
  temps.push(root);
  expect(cli(root, "init").code).toBe(0);
  expect(cli(root, "change", "new", ID, "--title", "Booking").code).toBe(0);
  for (const s of ["intake", "analyzing"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  return root;
}

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

const PROGRESS = "Done so far: the booking route.\nNext step: the error shape.\nFiles touched: app/api/bookings/route.ts";

function request(root: string, name: string, head: Record<string, string>, question = "Which status code does a double booking return?"): string {
  const front = Object.entries(head).map(([k, v]) => `${k}: ${v}`).join("\n");
  return write(root, `.aidw/changes/${ID}/consult/${name}.request.md`, `---\n${front}\n---\n\n## Question\n\n${question}\n\n## Progress\n\n${PROGRESS}\n`);
}

const consultDir = (root: string) => join(root, ".aidw/changes", ID, "consult");
const recordFile = (root: string) => join(root, ".aidw/changes", ID, "consultations.yaml");
const records = (root: string) => (YAML.parse(readFileSync(recordFile(root), "utf8")) as { consultations: Record<string, unknown>[] }).consultations;
const backendAsks = (root: string, question?: string) => cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "software-architect" }, question));

/** The consulted Role answers and the asker is resumed: its run may ask again. */
function answerAndResume(root: string, cid: string): void {
  write(root, `.aidw/changes/${ID}/consult/${cid}.answer.md`, "STATUS: answered\n\n409.\n");
  expect(cli(root, "consult", "answer", cid).code).toBe(0);
  expect(cli(root, "consult", "resume", cid).code).toBe(0);
}

/** Sets fields of a task in tasks.yaml, as the CLI would have after a failed checkpoint. */
function setTask(root: string, taskId: string, fields: Record<string, unknown>): void {
  const file = join(root, ".aidw/changes", ID, "tasks.yaml");
  const data = YAML.parse(readFileSync(file, "utf8")) as { tasks: Record<string, unknown>[] };
  const t = data.tasks.find((x) => x.id === taskId);
  Object.assign(t as object, fields);
  writeFileSync(file, YAML.stringify(data));
}

const env = {} as NodeJS.ProcessEnv;
const hook = (root: string, tool_name: string, tool_input: Record<string, unknown>, agent_type?: string): HookInput => ({
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input,
  cwd: root,
  ...(agent_type ? { agent_type } : {}),
});
const writeAs = (root: string, file: string, who: string) => decide(hook(root, "Write", { file_path: file }, who), env)?.decision;

describe("consult budget per Agent run", () => {
  it("a new attempt is a new Agent run with its own budget; an interrupted run that restarts keeps its count", () => {
    const root = buildingProject();
    expect(backendAsks(root).code).toBe(0);
    answerAndResume(root, "C01");
    expect(backendAsks(root, "And the retry header?").code).toBe(0);
    answerAndResume(root, "C02");
    // the run is interrupted and restarted (same attempt): still the same run, the budget is spent
    expect(cli(root, "task", "start", "T01").code).toBe(0);
    const spent = backendAsks(root, "A third one?");
    expect(spent.code).toBe(1);
    expect(spent.err).toMatch(/at most 2 Consultations per Agent run/);
    // the checkpoint failed: the next attempt is a fresh Agent run
    setTask(root, "T01", { status: "failed", attempts: 1 });
    const start = cli(root, "task", "start", "T01");
    expect(start.code, start.err).toBe(0);
    const fresh = backendAsks(root, "A third one?");
    expect(fresh.code, fresh.err).toBe(0);
    expect(records(root)[2]).toMatchObject({ id: "C03", run: "task:T01#2" });
  });

  it("refuses a request that names neither or both of task and stage, and the wrong side of the gate", () => {
    const root = buildingProject();
    let r = cli(root, "consult", request(root, "T01", { from: "backend", to: "software-architect" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/exactly one of "task:".*"stage:"/);
    r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", stage: "architecture", to: "software-architect" }));
    expect(r.code).toBe(1);
    r = cli(root, "consult", request(root, "requirements-product-manager", { from: "product-manager", stage: "requirements", to: "research" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/past the Approval Gate/);
    const before = analyzingProject();
    r = cli(before, "consult", request(before, "T01", { from: "backend", task: "T01", to: "software-architect" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not approved/);
    expect(existsSync(recordFile(before))).toBe(false);
  });
});

describe("consult answer and resume across restarts", () => {
  it("an answer without a STATUS line leaves the Consultation open; each step runs once", () => {
    const root = buildingProject();
    expect(backendAsks(root).code).toBe(0);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "409, I think.\n");
    const bad = cli(root, "consult", "answer", "C01");
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/does not start with "STATUS: answered"/);
    expect(records(root)[0]).toMatchObject({ status: "open" });
    expect(cli(root, "consult", "resume", "C01").err).toMatch(/has no answer yet/);
    // the session dies here; a fresh one is told to record the answer that is on disk, not to spawn again
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "consult", step: "record", consultation: "C01" });
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: answered\n\n409.\n");
    expect(cli(root, "consult", "answer", "C01").code).toBe(0);
    expect(cli(root, "consult", "answer", "C01").err).toMatch(/C01 is already answered/);
    // the session dies between answer and resume: the resume brief is on disk and next says resume
    expect(existsSync(join(root, ".aidw/run/briefs", ID, "C01.resume.md"))).toBe(true);
    expect(cli(root, "next", "--json").json()).toMatchObject({ action: "consult", step: "resume", consultation: "C01" });
    expect(cli(root, "consult", "resume", "C01").code).toBe(0);
    expect(cli(root, "consult", "resume", "C01").err).toMatch(/already resumed/);
    expect(cli(root, "consult", "answer", "C09").err).toMatch(/no Consultation C09/);
  });

  it("the runner counts a recorded or answered Consultation as progress", () => {
    const root = buildingProject();
    const p = pathsFor(root);
    const before = fingerprint(p, ID);
    expect(backendAsks(root).code).toBe(0);
    const asked = fingerprint(p, ID);
    expect(asked).not.toBe(before);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: answered\n\n409.\n");
    expect(cli(root, "consult", "answer", "C01").code).toBe(0);
    expect(fingerprint(p, ID)).not.toBe(asked);
  });
});

describe("the gate on consult files", () => {
  it("an implementer writes only a request directly in consult/ of a change", () => {
    const root = buildingProject();
    const dir = consultDir(root);
    expect(writeAs(root, join(dir, "sub", "T01.request.md"), "aidw:backend")).toBe("deny");
    expect(writeAs(root, join(dir, "T01.answer.md"), "aidw:backend")).toBe("deny");
    expect(writeAs(root, join(dir, "C01.request.md"), "aidw:frontend")).toBe("deny");
    expect(writeAs(root, join(root, ".aidw/changes", "consult", "T01.request.md"), "aidw:backend")).toBe("deny");
    expect(writeAs(root, join(root, ".aidw/changes", ID, "Consultations.yaml"), "aidw:api-designer")).toBe("deny");
  });
});

describe("who may ask", () => {
  it("refuses an asker that names a task another Role runs, and a request that says it answers a Consultation", () => {
    const root = buildingProject();
    let r = cli(root, "consult", request(root, "T01", { from: "frontend", task: "T01", to: "software-architect" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/task T01 is run by backend, not frontend/);
    // the depth rule holds on the request's own word too, with no Consultation open to the asker
    r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", consultation: "C07", to: "software-architect" }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/a consulted Agent cannot consult/);
    expect(existsSync(recordFile(root))).toBe(false);
  });

  it("refuses a Role asked that is not active in the roster", () => {
    const root = analyzingProject();
    const copy = mkdtempSync(join(tmpdir(), "aidw-consult-plugin-"));
    temps.push(copy);
    cpSync(plugin, copy, { recursive: true });
    const roster = join(copy, "roster.yaml");
    writeFileSync(roster, readFileSync(roster, "utf8").replace("research: { department: product-analysis, status: active }", "research: { department: product-analysis, status: planned, carried_by: cli }"));
    const file = request(root, "requirements-product-manager", { from: "product-manager", stage: "requirements", to: "research" });
    expect(() => requestConsultation(pathsFor(root), ID, file, copy)).toThrow(/"research" is not an active Role/);
    expect(existsSync(recordFile(root))).toBe(false);
  });

  it("aidw roster rejects a Role listed twice under consults, and the agent file tells the Role whom it may consult", () => {
    const copy = mkdtempSync(join(tmpdir(), "aidw-consult-roster-"));
    temps.push(copy);
    for (const f of ["roster.yaml", "tiers.yaml", "roles", "agents", "library"]) cpSync(join(plugin, f), join(copy, f), { recursive: true });
    const file = join(copy, "roles", "backend", "role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^consults:.*$/m, "consults: [api-designer, api-designer]"));
    expect(checkRoster(copy).errors.map((e) => e.message).join("\n")).toMatch(/consults lists a role twice/);
    const tiers = loadTiers(plugin);
    const backend = renderAgent(loadRole(plugin, "backend") as RoleProfile, tiers);
    expect(backend).toMatch(/## Consultation[\s\S]*`api-designer`, `database-architect`, `software-architect`/);
    expect(renderAgent(loadRole(plugin, "research") as RoleProfile, tiers)).not.toMatch(/## Consultation/);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Probes from the review of T8, fixed

describe("consult review probes", () => {
  it("probe: a user-granted retry (attempts reset to 0) is a new Agent run with a fresh budget", () => {
    const root = buildingProject();
    expect(backendAsks(root).code).toBe(0);
    answerAndResume(root, "C01");
    expect(backendAsks(root, "And the retry header?").code).toBe(0);
    answerAndResume(root, "C02");
    setTask(root, "T01", { status: "escalated", attempts: 3 });
    expect(cli(root, "task", "retry", "T01").code).toBe(0);
    const start = cli(root, "task", "start", "T01");
    expect(start.code, start.err).toBe(0);
    // a different Agent run than the one that asked C01 and C02, yet it gets the same key task:T01#1
    const r = backendAsks(root, "A new question in the new run");
    expect(r.code, r.err).toBe(0);
  });

  it("probe: a second request from a run whose Consultation is still open is refused (the asker ended its turn)", () => {
    const root = buildingProject();
    write(root, `.aidw/changes/${ID}/data-model.md`, "# Data model\n");
    expect(backendAsks(root).code).toBe(0);
    // the consulted software-architect (an author: it may write under .aidw/) writes a request claiming to be backend
    const r = cli(root, "consult", request(root, "T01", { from: "backend", task: "T01", to: "database-architect" }, "Which index?"));
    expect(r.code).toBe(1);
  });

  it("probe: re-submitting a request already recorded as C01 does not take C01's request away", () => {
    const root = buildingProject();
    expect(backendAsks(root).code).toBe(0);
    const kept = join(consultDir(root), "C01.request.md");
    cli(root, "consult", kept);
    expect(existsSync(kept)).toBe(true);
    write(root, `.aidw/changes/${ID}/consult/C01.answer.md`, "STATUS: answered\n\n409.\n");
    const a = cli(root, "consult", "answer", "C01");
    expect(a.code, a.err).toBe(0);
  });

  it("probe: an implementer cannot overwrite the recorded C01 request through a case variant", () => {
    const root = buildingProject();
    // macOS and Windows take c01.request.md for C01.request.md
    expect(writeAs(root, join(consultDir(root), "c01.request.md"), "aidw:backend")).toBe("deny");
  });

  it("probe: only the consulted Role writes the answer of its Consultation", () => {
    const root = analyzingProject();
    expect(cli(root, "consult", request(root, "requirements-product-manager", { from: "product-manager", stage: "requirements", to: "research" })).code).toBe(0);
    const answer = join(consultDir(root), "C01.answer.md");
    expect(writeAs(root, answer, "aidw:research")).toBe("allow");
    // the asker forging its own answer
    expect(writeAs(root, answer, "aidw:product-manager")).toBe("deny");
    // a Role consulted elsewhere, or not at all
    expect(writeAs(root, answer, "aidw:api-designer")).toBe("deny");
  });
});
