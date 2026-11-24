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
function building(opts: { grants?: boolean } = {}) {
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

describe("aidw deviation open", () => {
  beforeEach(() => building());

  it("is a state command: no Agent runs it", () => {
    expect(AIDW_STATE_COMMAND.test("aidw deviation open app --role api-designer")).toBe(true);
    expect(AIDW_STATE_COMMAND.test("aidw not-built T01 --reason x")).toBe(true);
  });

  it("refuses a Role that did not write the file, a file outside the package and a missing reason", () => {
    let r = open("--role", "backend", "--files", `${C}/openapi.yaml`, "--reason", "x");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/written by api-designer, not backend/);
    r = open("--role", "api-designer", "--files", `${C}/notes.md`, "--reason", "x");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not part of the approved package/);
    r = open("--role", "api-designer", "--files", `${C}/openapi.yaml`);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/needs a reason/);
    r = open("--role", "api-designer,qa", "--files", `${C}/openapi.yaml`, "--reason", "x");
    expect(r.err).toMatch(/qa wrote none/);
  });

  it("opens one at a time, writes the brief with the three rules and prints what to spawn", () => {
    const r = open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "the 409 of a double booking is missing");
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/D01 open/);
    expect(r.out).toMatch(/SPAWN aidw:api-designer with: Deviation brief: .*D01\.deviation\.md/);
    const brief = read(`.aidw/run/briefs/${ID}/D01.deviation.md`);
    expect(brief).toMatch(/Keep the purpose/);
    expect(brief).toMatch(/smallest change/);
    expect(brief).toMatch(/Add no new scope/);
    expect(deviations()[0]).toMatchObject({ id: "D01", status: "open", roles: ["api-designer"], files: [`${C}/openapi.yaml`] });
    const again = open("--role", "database-architect", "--files", `${C}/data-model.dbml`, "--reason", "y");
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/D01 .* still open/);
    const next = cli("next");
    expect(next.out).toMatch(/Deviation D01 is open/);
    expect(next.out).toMatch(/aidw deviation close/);
  });
});

describe("the gate while a Deviation is open", () => {
  beforeEach(() => building());

  it("lets only the named author Role edit only the named files, and freezes them again after", () => {
    expect(writeAs("aidw:api-designer", `${C}/openapi.yaml`)).toBe("deny");
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    expect(writeAs("aidw:api-designer", `${C}/openapi.yaml`)).toBe("allow");
    expect(writeAs("aidw:database-architect", `${C}/openapi.yaml`)).toBe("deny");
    expect(writeAs(undefined, `${C}/openapi.yaml`)).toBe("deny");
    expect(writeAs("aidw:api-designer", `${C}/analysis.md`)).toBe("deny");
    expect(writeAs("aidw:api-designer", `${C}/data-model.dbml`)).toBe("deny");
    // the CLI's record and the copies of what was approved are no Agent's
    expect(writeAs("aidw:api-designer", `${C}/deviations.yaml`)).toBe("deny");
    expect(writeAs("aidw:api-designer", `${C}/deviations/D01/approved.json`)).toBe("deny");
    write(root, `${C}/openapi.yaml`, OPENAPI("        at: {type: string}\n        note: {type: string}\n"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect(writeAs("aidw:api-designer", `${C}/openapi.yaml`)).toBe("deny");
  });

  it("holds the task list too while a Deviation names it, and a planned change to it outside one is drift", () => {
    expect(writeAs("aidw:technical-planner", `${C}/tasks.yaml`)).toBe("allow"); // the task list is not frozen (runtime fields)
    expect(open("--role", "technical-planner", "--files", `${C}/tasks.yaml`, "--reason", "x").code).toBe(0);
    expect(writeAs("aidw:technical-planner", `${C}/tasks.yaml`)).toBe("allow");
    expect(writeAs("aidw:product-manager", `${C}/tasks.yaml`)).toBe("deny");
    expect(writeAs(undefined, `${C}/tasks.yaml`)).toBe("deny");
    expect(cli("deviation", "abandon", ID).code).toBe(0);
    write(root, `${C}/tasks.yaml`, TASKS().replace("title: Booking emails", "title: Booking mails"));
    expect(cli("approval", "check", ID).code).toBe(1);
  });
});

describe("drift", () => {
  beforeEach(() => building());

  it("an approved contract changed with no Deviation is drift", () => {
    expect(cli("approval", "check", ID).code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI(""));
    expect(cli("approval", "check", ID).code).toBe(1);
  });

  it("is still detected outside an open Deviation, and close names the file", () => {
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("        at: {type: string}\n        note: {type: string}\n"));
    expect(cli("approval", "check", ID).code).toBe(0); // the author's edit is not drift while it is open
    write(root, `${C}/analysis.md`, `${ANALYSIS_MD}\nSomething else.\n`);
    expect(cli("approval", "check", ID).code).toBe(1);
    const r = cli("deviation", "close", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`drift outside Deviation D01: ${C}/analysis\\.md changed`));
  });

  it("abandon puts the files back as they were approved", () => {
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, "garbage: true\n");
    expect(cli("deviation", "abandon", ID).code).toBe(0);
    expect(read(`${C}/openapi.yaml`)).toBe(OPENAPI());
    expect(deviations()[0]?.status).toBe("abandoned");
    expect(cli("approval", "check", ID).code).toBe(0);
  });
});

describe("aidw deviation close", () => {
  beforeEach(() => building());

  it("refuses when nothing changed", () => {
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    const r = cli("deviation", "close", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/changed none/);
  });

  it("refuses an approved scenario removed without a reason, and records it with one", () => {
    const o = open("--role", "business-analyst,technical-planner", "--files", `${C}/specs/booking/spec.md,${C}/tasks.yaml`, "--reason", "the 24-hour rule is the clinic's, not ours");
    expect(o.code, o.all).toBe(0);
    expect(deviations()[0]?.authors).toEqual({ [`${C}/specs/booking/spec.md`]: "business-analyst", [`${C}/tasks.yaml`]: "technical-planner" });
    expect(writeAs("aidw:business-analyst", `${C}/tasks.yaml`)).toBe("deny");
    expect(writeAs("aidw:technical-planner", `${C}/tasks.yaml`)).toBe("allow");
    write(root, `${C}/specs/booking/spec.md`, DELTA().replace(/\n#### Scenario: Reschedule too late[\s\S]*$/, "\n"));
    write(root, `${C}/tasks.yaml`, TASKS(`[${S1}]`));
    let r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(new RegExp(`removes approved scenario\\(s\\) ${S2}`));
    r = cli("deviation", "close", ID, "--remove-reason", "the clinic enforces it at the desk");
    expect(r.code, r.all).toBe(0);
    const d = deviations()[0] as { status: string; scenarios: { removed: unknown[] }; rerun: string[] };
    expect(d.status).toBe("closed");
    expect(d.scenarios.removed).toEqual([{ scenario: S2, reason: "the clinic enforces it at the desk" }]);
    expect(d.rerun).toContain("T01");
  });

  it("refuses a new task that serves no approved scenario, and takes one that does", () => {
    expect(open("--role", "technical-planner", "--files", `${C}/tasks.yaml`, "--reason", "the reminder mail needs its own task").code).toBe(0);
    const extra = (scenarios: string) => `  - id: T04
    title: Reminder mail
    role: backend
    type: feat
    ${scenarios}
    depends_on: []
    touches: ["lib/remind/**"]
    verify: ['${OK}']
    status: pending
`;
    write(root, `${C}/tasks.yaml`, TASKS(undefined, extra("")));
    let r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(/new task T04 serves no approved scenario/);
    write(root, `${C}/tasks.yaml`, TASKS(undefined, extra(`scenarios: [${S1}]`)));
    r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect((deviations()[0] as { tasks: { added: string[] } }).tasks.added).toEqual(["T04"]);
  });

  it("refuses a change to the grants: they are the user's", () => {
    expect(open("--role", "qa", "--files", `${C}/quality.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/quality.yaml`, `${QUALITY_YAML}grants:\n  agent_runs: 99\n`);
    const r = cli("deviation", "close", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/`grants`, `permissions` .* no Role changes them/);
  });

  it("classifies an additive contract difference and reruns no done task for it", () => {
    setStatus({ T01: "done", T02: "done", T03: "done" });
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "clients need the note").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("        at: {type: string}\n        note: {type: string}\n"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/openapi\.yaml: additive/);
    const d = deviations()[0] as { contracts: { class: string; kind: string }[]; rerun: string[] };
    expect(d.contracts[0]).toMatchObject({ kind: "openapi", class: "additive" });
    expect(d.rerun).toEqual([]);
    expect(task("T01").status).toBe("done");
  });

  it("classifies a breaking contract difference, waits for a task in flight, lists the affected tasks and resets the done ones", () => {
    setStatus({ T01: "done", T02: "done", T03: "running" });
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "`at` moves to the slot").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI(""));
    let r = cli("deviation", "close", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/T03 \(running\) must run again but is still in flight: wait for T03 to settle/);
    expect(deviations()[0]?.status).toBe("open");
    setStatus({ T03: "failed" });
    r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/openapi\.yaml: breaking \(breaking: schema Booking\.at: property removed/);
    const d = deviations()[0] as { rerun: string[]; reset: string[] };
    expect(d.rerun).toEqual(["T01", "T02", "T03"]);
    expect(d.reset).toEqual(["T01", "T02"]);
    expect(task("T01")).toMatchObject({ status: "pending", attempts: 0 });
    expect(String(task("T01").notes)).toMatch(/Deviation D01/);
    expect(task("T03").status).toBe("failed");
  });

  it("reruns the tasks of a changed scenario and the tasks built on them, not the others", () => {
    setStatus({ T01: "done", T02: "done", T03: "done" });
    expect(open("--role", "business-analyst", "--files", `${C}/specs/booking/spec.md`, "--reason", "the refusal names the desk phone").code).toBe(0);
    write(root, `${C}/specs/booking/spec.md`, DELTA().replace("- **THEN** the move is refused", "- **THEN** the move is refused with the desk phone number"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    const d = deviations()[0] as { rerun: string[]; scenarios: { changed: string[] } };
    expect(d.scenarios.changed).toEqual([S2]);
    expect(d.rerun).toEqual(["T01", "T02"]);
    expect(task("T03").status).toBe("done");
  });

  it("rehashes the approved package and keeps its history", () => {
    const before = change().approval.hash;
    expect(open("--role", "database-architect", "--files", `${C}/data-model.dbml`, "--reason", "a note column").code).toBe(0);
    write(root, `${C}/data-model.dbml`, "Table bookings {\n  id uuid [pk]\n  starts_at timestamptz [not null]\n  note text\n}\n");
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toMatch(/data-model\.dbml: additive/);
    const a = change().approval;
    expect(a.hash).not.toBe(before);
    expect(a.history).toEqual([expect.objectContaining({ deviation: "D01", previous: before, hash: a.hash, reason: "a note column", roles: ["database-architect"], files: [`${C}/data-model.dbml`] })]);
    expect(cli("approval", "check", ID).code).toBe(0);
    expect(deviations()[0]).toMatchObject({ previous: before, hash: a.hash });
  });
});

describe("the push grant after a Deviation", () => {
  it("still holds: the rehash keeps approval.push", () => {
    building({ grants: true });
    const bash = (command: string) => decide({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root } as HookInput, {})?.decision ?? "none";
    expect(bash("git push origin aidw/app")).toBe("allow");
    const push = change().approval.push;
    expect(push).toBeTruthy();
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("        at: {type: string}\n        note: {type: string}\n"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect(change().approval.push).toEqual(push);
    expect(bash("git push origin aidw/app")).toBe("allow");
  });
});

describe("a Consultation that needs a Deviation (T8)", () => {
  beforeEach(() => building());

  it("routes to the Deviation, and closing it records the Consultation and tells the asker", () => {
    expect(cli("task", "start", "T01").code).toBe(0);
    write(root, `${C}/consult/T01.request.md`, "---\nfrom: backend\ntask: T01\nto: api-designer\n---\n\n## Question\n\nWhich status code does a double booking return?\n\n## Progress\n\nThe route and its tests.\n");
    const asked = cli("consult", `${C}/consult/T01.request.md`);
    expect(asked.code, asked.all).toBe(0);
    write(root, `${C}/consult/C01.answer.md`, "STATUS: changes-approved\n\nThe contract has no 409; it needs one.\n");
    const answered = cli("consult", "answer", "C01");
    expect(answered.code, answered.all).toBe(0);
    expect(answered.out).toMatch(/aidw deviation open .* --consultation C01/);
    expect(cli("next").out).toMatch(/C01 needs a Deviation/);

    const o = open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "a double booking returns 409", "--consultation", "C01");
    expect(o.code, o.all).toBe(0);
    expect(deviations()[0]?.task).toBe("T01");
    expect(read(`.aidw/run/briefs/${ID}/D01.deviation.md`)).toMatch(/C01\.answer\.md/);
    write(root, `${C}/openapi.yaml`, OPENAPI(undefined, "  /bookings/{id}:\n    put:\n      responses:\n        \"409\":\n          description: taken\n"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    const c = (YAML.parse(read(`${C}/consultations.yaml`)) as { consultations: Record<string, unknown>[] }).consultations[0];
    expect(c).toMatchObject({ status: "needs-deviation", deviation: "recorded", deviation_id: "D01" });
    expect(read(`.aidw/run/briefs/${ID}/C01.resume.md`)).toMatch(/## Deviation D01: the approved package changed/);
    expect(cli("next").out).toMatch(/resume backend \(T01\) with `aidw consult resume C01`/);
  });
});

describe("work outside the permission envelope (D10)", () => {
  beforeEach(() => building());

  it("is marked not_built with its reason, with the tasks that depend on it; the rest carries on", () => {
    const r = cli("not-built", "T01", "--reason", "needs a paid SMS plan, which costs money");
    expect(r.code, r.all).toBe(0);
    expect(task("T01")).toMatchObject({ status: "not_built", not_built: { cause: "envelope", reason: "needs a paid SMS plan, which costs money" } });
    expect(task("T02")).toMatchObject({ status: "not_built", not_built: { cause: "dependency", reason: "depends on T01, which is not built" } });
    expect(task("T03").status).toBe("pending");
    expect(cli("next").out).toMatch(/implement T03/);
    setStatus({ T03: "done" });
    expect(cli("next").out).toMatch(/complete: all 1 task/);
    expect(cli("not-built", "T03", "--reason", "x").code).toBe(1);
    expect(cli("approval", "check", ID).code).toBe(0);
  });
});

describe("contract classification", () => {
  it("OpenAPI: operations, parameters, bodies, responses and schemas", () => {
    const base = YAML.parse(OPENAPI()) as Record<string, unknown>;
    const text = (patch: (d: Record<string, any>) => void) => {
      const d = structuredClone(base) as Record<string, any>;
      patch(d);
      return YAML.stringify(d);
    };
    const was = YAML.stringify(base);
    expect(classifyOpenApi(was, was).class).toBe("none");
    expect(classifyOpenApi(was, text((d) => (d.paths["/slots"] = { get: { responses: { "200": { description: "ok" } } } }))).class).toBe("additive");
    expect(classifyOpenApi(was, text((d) => delete d.paths["/bookings"].get)).changes).toContain("breaking: GET /bookings: operation removed");
    expect(classifyOpenApi(was, text((d) => (d.paths["/bookings"].get.parameters = [{ name: "day", in: "query", required: true }]))).class).toBe("breaking");
    expect(classifyOpenApi(was, text((d) => (d.paths["/bookings"].get.parameters = [{ name: "day", in: "query" }]))).class).toBe("additive");
    expect(classifyOpenApi(was, text((d) => delete d.paths["/bookings"].get.responses["200"])).class).toBe("breaking");
    expect(classifyOpenApi(was, text((d) => (d.components.schemas.Booking.properties.id.type = "integer"))).changes[0]).toMatch(/type changed from string to integer/);
    expect(classifyOpenApi(was, text((d) => d.components.schemas.Booking.required.push("at"))).class).toBe("breaking");
    expect(classifyOpenApi(was, "paths: [").class).toBe("breaking");
  });

  it("DBML: tables, columns and enums", () => {
    const was = "Table bookings {\n  id uuid [pk]\n  at timestamptz [not null]\n  indexes {\n    at\n  }\n}\nEnum status {\n  booked\n  cancelled\n}\n";
    expect(classifyDbml(was, was).class).toBe("none");
    expect(classifyDbml(was, was.replace("  at timestamptz [not null]\n", "  at timestamptz [not null]\n  note text\n")).class).toBe("additive");
    expect(classifyDbml(was, was.replace("  at timestamptz [not null]\n", "  at timestamptz [not null]\n  clinic uuid [not null]\n")).changes).toContain("breaking: bookings.clinic: new NOT NULL column without a default");
    expect(classifyDbml(was, was.replace("  at timestamptz [not null]\n", "  at timestamptz [not null]\n  clinic uuid [not null, default: 'x']\n")).class).toBe("additive");
    expect(classifyDbml(was, was.replace("  at timestamptz [not null]\n", "")).changes).toContain("breaking: bookings.at: column removed");
    expect(classifyDbml(was, was.replace("timestamptz", "date")).class).toBe("breaking");
    expect(classifyDbml(was, was.replace("  cancelled\n", "")).changes).toContain("breaking: enum status: value cancelled removed");
    expect(classifyDbml(was, `${was}Table slots {\n  id uuid [pk]\n}\n`).class).toBe("additive");
  });
});

it("the deviations record sits outside the approved package", () => {
  building();
  expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
  expect(existsSync(join(root, `${C}/deviations.yaml`))).toBe(true);
  const covered = (JSON.parse(cli("approval", "check", ID, "--json").out) as { files?: string[] }).files ?? [];
  expect(covered.some((f) => f.includes("deviations"))).toBe(false);
});

describe("review findings", () => {
  beforeEach(() => building());

  it("an approval of the old package list (no `package`) stays valid, opens a Deviation and keeps version 1 when it closes", () => {
    // a Change approved before the contracts joined the package: its hash covers the old list only
    const data = YAML.parse(read(`${C}/change.yaml`)) as Record<string, any>;
    delete data.approval.package;
    writeFileSync(join(root, `${C}/change.yaml`), YAML.stringify(data));
    const p = pathsFor(root);
    data.approval.hash = computeApprovalHash(p, loadChange(p, ID), undefined, { version: 1 }).hash;
    writeFileSync(join(root, `${C}/change.yaml`), YAML.stringify(data));
    expect(cli("approval", "check", ID).code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("")); // not in the old list: no drift, and not frozen
    expect(cli("approval", "check", ID).code).toBe(0);
    expect(writeAs(undefined, `${C}/openapi.yaml`)).toBe("allow");
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(1); // not part of its package
    expect(open("--role", "product-manager", "--files", `${C}/analysis.md`, "--reason", "a decision is reworded").code).toBe(0);
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace("Assumes one clinic", "Assumes a single clinic"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect((change().approval as Record<string, unknown>).package).toBeUndefined();
    expect(cli("approval", "check", ID).code).toBe(0);
    expect(writeAs(undefined, `${C}/openapi.yaml`)).toBe("allow"); // never approved by the user: not adopted
  });

  it("refuses a change to the tier 2 permissions, and reads the approved grants while quality.yaml is open", () => {
    expect(open("--role", "qa", "--files", `${C}/quality.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/quality.yaml`, `${QUALITY_YAML}grants:\n  envelope: true\n`);
    expect(readGrants(loadChange(pathsFor(root), ID)).envelope).toBe(false); // half-edited: the approved grants hold
    write(root, `${C}/quality.yaml`, QUALITY_YAML.replace("permissions: [vercel-preview]", "permissions: [vercel-preview, vercel-production]"));
    const r = cli("deviation", "close", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/`grants`, `permissions`/);
  });

  it("returns no meanwhile beside a Deviation of the task list", () => {
    setStatus({ T03: "review" });
    expect(open("--role", "technical-planner", "--files", `${C}/tasks.yaml`, "--reason", "x").code).toBe(0);
    expect(JSON.parse(cli("next", "--json").out).meanwhile).toBeUndefined();
    expect(cli("deviation", "abandon", ID).code).toBe(0);
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    expect(JSON.parse(cli("next", "--json").out).meanwhile).toMatchObject({ action: "review", task: "T03" });
  });

  it("refuses a new requirement without a scope reason, records it with one", () => {
    expect(open("--role", "business-analyst,technical-planner", "--files", `${C}/specs/booking/spec.md,${C}/tasks.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/specs/booking/spec.md`, `${DELTA()}\n### Requirement: Waiting list\nThe system SHALL keep a waiting list.\n\n#### Scenario: Join the list\n- **WHEN** a slot is full\n- **THEN** the patient joins the waiting list\n`);
    write(root, `${C}/tasks.yaml`, TASKS(`[${S1}, ${S2}, booking/waiting-list/join-the-list]`).replace("specs: [booking/reschedule-appointment]", "specs: [booking/reschedule-appointment, booking/waiting-list]"));
    let r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(/adds requirement\(s\) booking\/waiting-list/);
    r = cli("deviation", "close", ID, "--scope-reason", "the approved booking flow needs it for a full day", "--summary", "split the full-day case out");
    expect(r.code, r.all).toBe(0);
    expect(deviations()[0]).toMatchObject({ requirements: { added: ["booking/waiting-list"] }, scope_reason: "the approved booking flow needs it for a full day", summary: "split the full-day case out" });
  });

  it("takes a reason per removed scenario and names the one missing", () => {
    expect(open("--role", "business-analyst,technical-planner", "--files", `${C}/specs/booking/spec.md,${C}/tasks.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/specs/booking/spec.md`, DELTA().replace(/\n#### Scenario: Reschedule too late[\s\S]*$/, "\n"));
    write(root, `${C}/tasks.yaml`, TASKS(`[${S1}]`));
    let r = cli("deviation", "close", ID, "--remove-reason", "booking/other=nothing");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(new RegExp(`${S2} with no recorded reason`));
    r = cli("deviation", "close", ID, "--remove-reason", `${S2}=the desk enforces it`);
    expect(r.code, r.all).toBe(0);
    expect((deviations()[0] as any).scenarios.removed).toEqual([{ scenario: S2, reason: "the desk enforces it" }]);
  });

  it("reruns only the Roles that build against a breaking data model, and records an additive one's readers", () => {
    setStatus({ T01: "done", T02: "done", T03: "done" });
    expect(open("--role", "database-architect", "--files", `${C}/data-model.dbml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/data-model.dbml`, "Table bookings {\n  id uuid [pk]\n  starts_at date [not null]\n}\n");
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    const d = deviations()[0] as any;
    expect(d.contracts[0]).toMatchObject({ class: "breaking", readers: ["T01", "T03"] });
    expect(d.rerun).toEqual(["T01", "T02", "T03"]); // T02 (frontend) only because it depends on T01
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "y").code).toBe(0);
    setStatus({ T01: "done", T02: "done", T03: "done" });
    write(root, `${C}/openapi.yaml`, OPENAPI("        at: {type: string}\n        note: {type: string}\n"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect(deviations()[1]).toMatchObject({ contracts: [{ class: "additive", readers: ["T01", "T02", "T03"] }], rerun: [] });
  });

  it("classifies a text change with no difference as unclassified and reruns its readers", () => {
    setStatus({ T01: "done", T02: "done", T03: "done" });
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, `# reworded\n${OPENAPI()}`);
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect(deviations()[0]).toMatchObject({ contracts: [{ class: "unclassified" }], rerun: ["T01", "T02", "T03"] });
  });

  it("records a removed task that was already done", () => {
    setStatus({ T03: "done" });
    expect(open("--role", "technical-planner", "--files", `${C}/tasks.yaml`, "--reason", "mails move to the next change").code).toBe(0);
    const data = YAML.parse(read(`${C}/tasks.yaml`)) as { tasks: Record<string, unknown>[] };
    data.tasks = data.tasks.filter((t) => t.id !== "T03");
    writeFileSync(join(root, `${C}/tasks.yaml`), YAML.stringify(data));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect((deviations()[0] as any).tasks).toMatchObject({ removed: ["T03"], removed_done: ["T03"] });
  });

  it("aidw status shows an open Deviation", () => {
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    expect(cli("status").out).toMatch(/Deviation D01 open \(api-designer\): .*openapi\.yaml/);
  });

  it("not-built takes the cause environment", () => {
    expect(cli("not-built", "T03", "--reason", "no SMTP key in .env", "--cause", "environment").code).toBe(0);
    expect(task("T03")).toMatchObject({ status: "not_built", not_built: { cause: "environment" } });
    expect(cli("not-built", "T01", "--reason", "x", "--cause", "other").code).toBe(2);
  });
});

describe("a Consultation whose Deviation is abandoned", () => {
  it("cannot resume while its Deviation is open, and records it abandoned", () => {
    building();
    expect(cli("task", "start", "T01").code).toBe(0);
    write(root, `${C}/consult/T01.request.md`, "---\nfrom: backend\ntask: T01\nto: api-designer\n---\n\n## Question\n\nWhich code?\n\n## Progress\n\nThe route.\n");
    expect(cli("consult", `${C}/consult/T01.request.md`).code).toBe(0);
    write(root, `${C}/consult/C01.answer.md`, "STATUS: changes-approved\n\nIt needs a 409.\n");
    expect(cli("consult", "answer", "C01").code).toBe(0);
    expect(open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x", "--consultation", "C01").code).toBe(0);
    const r = cli("consult", "resume", "C01");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Deviation D01 for C01 is still open/);
    expect(cli("deviation", "abandon", ID).code).toBe(0);
    const c = (YAML.parse(read(`${C}/consultations.yaml`)) as { consultations: Record<string, unknown>[] }).consultations[0];
    expect(c).toMatchObject({ deviation: "abandoned", deviation_id: "D01" });
    expect(cli("consult", "resume", "C01").code).toBe(0);
  });
});
