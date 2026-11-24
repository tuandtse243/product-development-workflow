import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { classifyDbml, classifyOpenApi } from "../src/contractdiff.js";
import { decide, type HookInput } from "../src/gate.js";
import { AIDW_STATE_COMMAND } from "../src/policy.js";
import { computeApprovalHash } from "../src/approval.js";
import { loadChange } from "../src/change.js";
import { readGrants } from "../src/grants.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "app";
const C = `.aidw/changes/${ID}`;
const OK = `node -e "process.exit(0)"`;
const GRANTS = "grants:\n  push:\n    remote: origin\n    base: main\n";

const DELTA = (second = "Reschedule too late") => `## ADDED Requirements

### Requirement: Reschedule appointment
The system SHALL let a patient move an upcoming appointment to another free slot.

#### Scenario: Reschedule appointment works
- **WHEN** a patient moves an appointment to a free slot
- **THEN** the appointment has the new time

#### Scenario: ${second}
- **WHEN** a patient moves an appointment that starts within 24 hours
- **THEN** the move is refused
`;

const S1 = "booking/reschedule-appointment/reschedule-appointment-works";
const S2 = "booking/reschedule-appointment/reschedule-too-late";

const TASKS = (scenarios = `[${S1}, ${S2}]`, extra = "") => `tasks:
  - id: T01
    title: Booking API
    role: backend
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: ${scenarios}
    depends_on: []
    touches: ["app/api/**"]
    verify: ['${OK}']
    status: pending
  - id: T02
    title: Booking page
    role: frontend
    type: feat
    depends_on: [T01]
    touches: ["app/(site)/**"]
    verify: ['${OK}']
    status: pending
  - id: T03
    title: Booking emails
    role: backend
    type: feat
    depends_on: []
    touches: ["lib/mail/**"]
    verify: ['${OK}']
    status: pending
${extra}`;

const OPENAPI = (extraProps = "        at: {type: string}\n", extraPaths = "") => `openapi: 3.1.0
info: {title: Booking, version: "1"}
paths:
  /bookings:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {$ref: "#/components/schemas/Booking"}
${extraPaths}components:
  schemas:
    Booking:
      type: object
      required: [id]
      properties:
        id: {type: string}
${extraProps}`;

const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, all: out + err };
}
const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...a], { cwd: root, encoding: "utf8" });
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const change = () => YAML.parse(read(`${C}/change.yaml`)) as { state: string; approval: { hash: string; push?: unknown; history?: Record<string, unknown>[] } };
const deviations = () => (YAML.parse(read(`${C}/deviations.yaml`)) as { deviations: Record<string, unknown>[] }).deviations;
const tasks = () => (YAML.parse(read(`${C}/tasks.yaml`)) as { tasks: Record<string, unknown>[] }).tasks;
const task = (id: string) => tasks().find((t) => t.id === id) as Record<string, unknown>;
function setStatus(statuses: Record<string, string>) {
  const data = YAML.parse(read(`${C}/tasks.yaml`)) as { tasks: Record<string, unknown>[] };
  for (const t of data.tasks) if (statuses[String(t.id)]) t.status = statuses[String(t.id)];
  writeFileSync(join(root, `${C}/tasks.yaml`), YAML.stringify(data));
}
const writeAs = (agent: string | undefined, rel: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(root, rel), content: "x" }, cwd: root, ...(agent ? { agent_type: agent } : {}) } as HookInput, {})?.decision ?? "none";

/** An approved change in state executing, with a push grant, an OpenAPI contract, a data model and three tasks. */
function building(opts: { grants?: boolean; notes?: boolean } = {}) {
  root = tempProject();
  temps.push(root);
  expect(cli("init").code).toBe(0);
  if (opts.grants) {
    git("init", "-q");
    git("remote", "add", "origin", "https://github.com/acme/app.git");
  }
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli("change", "new", ID, "--title", "Booking").code).toBe(0);
  write(root, `${C}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${C}/tasks.yaml`, TASKS());
  write(root, `${C}/quality.yaml`, QUALITY_YAML + (opts.grants ? GRANTS : ""));
  write(root, `${C}/specs/booking/spec.md`, DELTA());
  write(root, `${C}/openapi.yaml`, OPENAPI());
  write(root, `${C}/data-model.dbml`, "Table bookings {\n  id uuid [pk]\n  starts_at timestamptz [not null]\n}\n");
  write(root, ".aidw/architecture/overview.md", "# Architecture\n");
  if (opts.notes) write(root, `${C}/api-contract.md`, "# API contract\n\nA double booking returns 409.\n");
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const t = cli("transition", ID, s);
    expect(t.code, t.all).toBe(0);
  }
  const a = cli("approve", ID);
  expect(a.code, a.all).toBe(0);
  expect(cli("transition", ID, "executing").code).toBe(0);
}

const open = (...extra: string[]) => cli("deviation", "open", ID, ...extra);

const bashAs = (agent: string | undefined, command: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root, ...(agent ? { agent_type: agent } : {}) } as HookInput, {})?.decision ?? "none";

describe("re-review probes", () => {
  it("the gate: a Bash command that names the open Deviation's file and writes it is denied to the lead (git restore, git checkout --, a formatter)", () => {
    building();
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    const f = `${C}/openapi.yaml`;
    // reads stay allowed
    for (const c of [`cat ${f}`, `git diff ${f}`, `git add ${f}`, `grep -n paths ${f}`, `git show HEAD:${f}`]) expect(bashAs(undefined, c), c).not.toBe("deny");
    // each of these rewrites the author's file while the Deviation is open; close then records the lead's bytes as the author's change
    for (const c of [`git checkout -- ${f}`, `git restore ${f}`, `npx prettier --write ${f}`]) expect(bashAs(undefined, c), c).toBe("deny");
  });

  it("a close interrupted after the record and the new hash are saved, before the resets: the next session still resets the done tasks it recorded", () => {
    building();
    setStatus({ T01: "done", T02: "done", T03: "done" });
    const before = read(`${C}/tasks.yaml`);
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("")); // breaking
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect((deviations()[0] as any).reset).toEqual(["T01", "T02", "T03"]);
    // the crash: tasks.yaml as it was before rerunTasks ran, and the record not yet finished
    writeFileSync(join(root, `${C}/tasks.yaml`), before);
    const rec = YAML.parse(read(`${C}/deviations.yaml`)) as { deviations: Record<string, unknown>[] };
    delete rec.deviations[0]!.finished;
    writeFileSync(join(root, `${C}/deviations.yaml`), YAML.stringify(rec));
    expect(cli("approval", "check", ID).code).toBe(0);
    const n = JSON.parse(cli("next", "--json").out) as { action: string };
    // nothing tells the fresh session: the record says T01-T03 were reset, tasks.yaml says done, next moves on
    expect({ action: n.action, T01: task("T01").status }).toMatchObject({ T01: "pending" });
  });

  it("a v1 approval: a contract edited after the gate is not adopted by the next close; the approval stays v1", () => {
    building();
    const data = YAML.parse(read(`${C}/change.yaml`)) as Record<string, any>;
    delete data.approval.package;
    const p = pathsFor(root);
    writeFileSync(join(root, `${C}/change.yaml`), YAML.stringify(data));
    data.approval.hash = computeApprovalHash(p, loadChange(p, ID), undefined, { version: 1 }).hash;
    writeFileSync(join(root, `${C}/change.yaml`), YAML.stringify(data));
    write(root, `${C}/openapi.yaml`, OPENAPI("")); // free to edit in v1, as before T9
    expect(cli("approval", "check", ID).code).toBe(0);
    expect(open("--role", "product-manager", "--files", `${C}/analysis.md`, "--reason", "reword").code).toBe(0);
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace("Assumes one clinic", "Assumes a single clinic"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect((change().approval as Record<string, unknown>).package).toBeUndefined();
    expect(deviations()[0]).toMatchObject({ package: 1, finished: true });
    expect((change().approval.history?.at(-1) as { files: string[] }).files).toEqual([`${C}/analysis.md`]);
    write(root, `${C}/openapi.yaml`, OPENAPI("        at: {type: integer}\n"));
    expect(cli("approval", "check", ID).code).toBe(0); // still outside the v1 package
  });

  it("a close interrupted after the record is saved, before the new hash: the next command writes the hash and finishes", () => {
    building();
    setStatus({ T01: "done", T02: "done", T03: "done" });
    const approvedChange = read(`${C}/change.yaml`);
    const before = read(`${C}/tasks.yaml`);
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI(""));
    expect(cli("deviation", "close", ID).code).toBe(0);
    const closed = deviations()[0] as Record<string, unknown>;
    // the crash: deviations.yaml saved as closed (not finished), change.yaml and tasks.yaml as they were
    const rec = YAML.parse(read(`${C}/deviations.yaml`)) as { deviations: Record<string, unknown>[] };
    delete rec.deviations[0]!.finished;
    writeFileSync(join(root, `${C}/deviations.yaml`), YAML.stringify(rec));
    writeFileSync(join(root, `${C}/change.yaml`), approvedChange);
    writeFileSync(join(root, `${C}/tasks.yaml`), before);
    expect(cli("approval", "check", ID).code).toBe(0); // the CLI finished the close first
    expect(change().approval.hash).toBe(closed.hash);
    expect(change().approval.history?.at(-1)).toMatchObject({ deviation: "D01", previous: closed.previous, hash: closed.hash });
    expect(task("T01").status).toBe("pending");
    expect(deviations()[0]?.finished).toBe(true);
    // finished: running it again changes nothing
    setStatus({ T01: "done" });
    expect(cli("status").code).toBe(0);
    expect(task("T01").status).toBe("done");
  });

  it("an interrupted close of a Consultation's Deviation records the Consultation on the next command", () => {
    building();
    expect(cli("task", "start", "T01").code).toBe(0);
    write(root, `${C}/consult/T01.request.md`, "---\nfrom: backend\ntask: T01\nto: api-designer\n---\n\n## Question\n\nWhich code?\n\n## Progress\n\nThe route.\n");
    expect(cli("consult", `${C}/consult/T01.request.md`).code).toBe(0);
    write(root, `${C}/consult/C01.answer.md`, "STATUS: changes-approved\n\nIt needs a 409.\n");
    expect(cli("consult", "answer", "C01").code).toBe(0);
    const pendingRecord = read(`${C}/consultations.yaml`);
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x", "--consultation", "C01").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI(undefined, "  /bookings/{id}:\n    put:\n      responses:\n        \"409\":\n          description: taken\n"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    const rec = YAML.parse(read(`${C}/deviations.yaml`)) as { deviations: Record<string, unknown>[] };
    delete rec.deviations[0]!.finished;
    writeFileSync(join(root, `${C}/deviations.yaml`), YAML.stringify(rec));
    writeFileSync(join(root, `${C}/consultations.yaml`), pendingRecord);
    expect(cli("next").out).toMatch(/resume backend \(T01\)/);
    const c = (YAML.parse(read(`${C}/consultations.yaml`)) as { consultations: Record<string, unknown>[] }).consultations[0];
    expect(c).toMatchObject({ deviation: "recorded", deviation_id: "D01" });
  });

  it("API notes changed beside an openapi.yaml are prose: the Roles that build against the API run again", () => {
    building({ notes: true });
    setStatus({ T01: "done", T02: "done", T03: "done" });
    expect(open("--role", "api-designer", "--files", `${C}/api-contract.md`, "--reason", "x").code).toBe(0);
    write(root, `${C}/api-contract.md`, "# API contract\n\nA double booking returns 409 with the slot that is free next.\n");
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(deviations()[0]).toMatchObject({ contracts: [{ kind: "prose", class: "prose" }], rerun: ["T01", "T02", "T03"] });
  });

  it("refuses a change to a quality layer's run or setup commands: the user approved that tooling", () => {
    building();
    expect(open("--role", "qa", "--files", `${C}/quality.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/quality.yaml`, QUALITY_YAML.replace('run: ["pnpm vitest run"]', 'run: ["pnpm vitest run --passWithNoTests"]'));
    const r = cli("deviation", "close", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/layers' `run` and `setup` commands/);
  });
});
