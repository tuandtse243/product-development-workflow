import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { classifyOpenApi } from "../src/contractdiff.js";
import { decide, type HookInput } from "../src/gate.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "app";
const C = `.aidw/changes/${ID}`;
const OK = `node -e "process.exit(0)"`;
const GRANTS = "grants:\n  push:\n    remote: origin\n    base: main\n";

const DELTA = `## ADDED Requirements

### Requirement: Reschedule appointment
The system SHALL let a patient move an upcoming appointment to another free slot.

#### Scenario: Reschedule appointment works
- **WHEN** a patient moves an appointment to a free slot
- **THEN** the appointment has the new time

#### Scenario: Reschedule too late
- **WHEN** a patient moves an appointment that starts within 24 hours
- **THEN** the move is refused
`;

const S1 = "booking/reschedule-appointment/reschedule-appointment-works";
const S2 = "booking/reschedule-appointment/reschedule-too-late";

const task = (id: string, role: string, deps: string, touches: string, extra = "") => `  - id: ${id}
    title: Task ${id}
    role: ${role}
    type: feat
${extra}    depends_on: [${deps}]
    touches: ["${touches}"]
    verify: ['${OK}']
    status: pending
`;

/** T01 (scenarios) <- T02 <- T04 <- T05; T03 alone. */
const TASKS = `tasks:
${task("T01", "backend", "", "app/api/**", `    specs: [booking/reschedule-appointment]\n    scenarios: [${S1}, ${S2}]\n`)}${task("T02", "frontend", "T01", "app/(site)/**")}${task("T03", "backend", "", "lib/mail/**")}${task("T04", "backend", "T02", "lib/a/**")}${task("T05", "backend", "T04", "lib/b/**")}`;

const OPENAPI = (extraProps = "        at: {type: string}\n") => `openapi: 3.1.0
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
components:
  schemas:
    Booking:
      type: object
      required: [id]
      properties:
        id: {type: string}
${extraProps}`;
const ADDITIVE = (n: string) => OPENAPI(`        at: {type: string}\n        ${n}: {type: string}\n`);

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
const taskOf = (id: string) => tasks().find((t) => t.id === id) as Record<string, unknown>;
function setStatus(statuses: Record<string, string>) {
  const data = YAML.parse(read(`${C}/tasks.yaml`)) as { tasks: Record<string, unknown>[] };
  for (const t of data.tasks) if (statuses[String(t.id)]) t.status = statuses[String(t.id)];
  writeFileSync(join(root, `${C}/tasks.yaml`), YAML.stringify(data));
}
const hook = (tool: string, input: Record<string, unknown>, agent?: string) =>
  decide({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd: root, ...(agent ? { agent_type: agent } : {}) } as HookInput, {})?.decision ?? "none";
const writeAs = (agent: string | undefined, rel: string, tool = "Write") => hook(tool, { file_path: join(root, rel), content: "x", old_string: "a", new_string: "b" }, agent);
const bashAs = (agent: string | undefined, command: string) => hook("Bash", { command }, agent);
const open = (...extra: string[]) => cli("deviation", "open", ID, ...extra);
const openApi = () => open("--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x");

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
  write(root, `${C}/tasks.yaml`, TASKS);
  write(root, `${C}/quality.yaml`, QUALITY_YAML + (opts.grants ? GRANTS : ""));
  write(root, `${C}/specs/booking/spec.md`, DELTA);
  write(root, `${C}/openapi.yaml`, OPENAPI());
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

describe("two Deviations in sequence", () => {
  it("chain their history, keep the hash continuous and keep approval.push (the push grant still holds)", () => {
    building({ grants: true });
    const push = change().approval.push;
    expect(push).toBeTruthy();
    const h0 = change().approval.hash;
    expect(openApi().code).toBe(0);
    write(root, `${C}/openapi.yaml`, ADDITIVE("note"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    const h1 = change().approval.hash;
    expect(cli("approval", "check", ID).code).toBe(0);
    const o = openApi();
    expect(o.code, o.all).toBe(0);
    expect(deviations()[1]).toMatchObject({ id: "D02", previous: h1 });
    write(root, `${C}/openapi.yaml`, OPENAPI(`        at: {type: string}\n        note: {type: string}\n        room: {type: string}\n`));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    const a = change().approval;
    expect(a.hash).not.toBe(h1);
    expect(a.history?.map((e) => [e.deviation, e.previous, e.hash])).toEqual([
      ["D01", h0, h1],
      ["D02", h1, a.hash],
    ]);
    expect(a.push).toEqual(push);
    expect(cli("approval", "check", ID).code).toBe(0);
    expect(bashAs(undefined, "git push origin aidw/app")).toBe("allow");
  });
});

describe("quality.yaml by Deviation", () => {
  it("takes a change outside the grants, and refuses one to them", () => {
    building({ grants: true });
    expect(open("--role", "qa", "--files", `${C}/quality.yaml`, "--reason", "a tighter budget").code).toBe(0);
    write(root, `${C}/quality.yaml`, `${QUALITY_YAML}# the budget is tighter\n${GRANTS}`);
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(open("--role", "qa", "--files", `${C}/quality.yaml`, "--reason", "y").code).toBe(0);
    write(root, `${C}/quality.yaml`, `${QUALITY_YAML}${GRANTS.replace("base: main", "base: develop")}`);
    const r2 = cli("deviation", "close", ID);
    expect(r2.code).toBe(1);
    expect(r2.err).toMatch(/grants/);
  });
});

describe("the tasks to run again", () => {
  it("include the dependants of dependants", () => {
    building();
    setStatus({ T01: "done", T02: "done", T03: "done", T04: "done", T05: "done" });
    expect(open("--role", "business-analyst", "--files", `${C}/specs/booking/spec.md`, "--reason", "wording").code).toBe(0);
    write(root, `${C}/specs/booking/spec.md`, DELTA.replace("- **THEN** the move is refused", "- **THEN** the move is refused politely"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect((deviations()[0] as { rerun: string[] }).rerun).toEqual(["T01", "T02", "T04", "T05"]);
    expect(taskOf("T05").status).toBe("pending");
    expect(taskOf("T03").status).toBe("done");
  });

  it("leave a Change in verifying where it is when nothing is reset (additive)", () => {
    building();
    setStatus({ T01: "done", T02: "done", T03: "done", T04: "done", T05: "done" });
    expect(cli("transition", ID, "verifying").code).toBe(0);
    expect(openApi().code).toBe(0);
    write(root, `${C}/openapi.yaml`, ADDITIVE("note"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect(change().state).toBe("verifying");
  });
});

describe("while a Deviation is open", () => {
  it("aidw approve is refused", () => {
    building();
    expect(openApi().code).toBe(0);
    for (const s of ["escalated", "analyzing", "awaiting_approval"]) {
      const t = cli("transition", ID, s);
      expect(t.code, t.all).toBe(0);
    }
    const a = cli("approve", ID);
    expect(a.code).toBe(1);
    expect(a.err).toMatch(/D01 .* still open/);
  });

  it("the gate: Edit and MultiEdit by the author, nothing by case variants, other Agents or another file", () => {
    building();
    expect(openApi().code).toBe(0);
    expect(writeAs("aidw:api-designer", `${C}/openapi.yaml`, "Edit")).toBe("allow");
    expect(writeAs("api-designer", `${C}/openapi.yaml`, "MultiEdit")).toBe("allow");
    for (const variant of [`${C}/OPENAPI.yaml`, `${C}/OpenApi.YAML`, `.aidw/changes/APP/openapi.yaml`]) {
      expect(writeAs("aidw:api-designer", variant)).not.toBe("allow");
      expect(writeAs("aidw:database-architect", variant)).toBe("deny");
      expect(writeAs(undefined, variant)).toBe("deny");
    }
    expect(writeAs("aidw:api-designer", `${C}/specs/booking/spec.md`)).toBe("deny");
    expect(writeAs("aidw:api-designer", `.aidw/architecture/overview.md`)).toBe("deny");
  });

  it("the gate: no Bash write of the Deviation's file by the author, an implementer or another Role", () => {
    building();
    expect(openApi().code).toBe(0);
    const f = `${C}/openapi.yaml`;
    expect(bashAs("aidw:api-designer", `sed -i '' 's/x/y/' ${f}`)).toBe("deny");
    expect(bashAs("aidw:database-architect", `cp /tmp/x ${f}`)).toBe("deny");
    expect(bashAs("aidw:backend", `cp /tmp/x ${f}`)).toBe("deny");
    expect(bashAs("aidw:backend", `node -e "require('fs').writeFileSync('${f}','x')"`)).toBe("deny");
    expect(bashAs("aidw:backend", `echo x > ${f}`)).toBe("deny");
  });
});

describe("abandon", () => {
  it("puts the bytes back exactly and removes a spec file the Deviation created", () => {
    building();
    const crlf = DELTA.replace(/\n/g, "\r\n");
    writeFileSync(join(root, `${C}/specs/booking/spec.md`), crlf);
    // CRLF normalises to the approved hash, so the approval is still valid
    expect(cli("approval", "check", ID).code).toBe(0);
    const added = `${C}/specs/notify/spec.md`;
    const o = open("--role", "business-analyst", "--files", `${C}/specs/booking/spec.md,${added}`, "--reason", "x");
    expect(o.code, o.all).toBe(0);
    write(root, `${C}/specs/booking/spec.md`, "garbage\n");
    write(root, added, "## ADDED Requirements\n");
    expect(cli("deviation", "abandon", ID).code).toBe(0);
    expect(read(`${C}/specs/booking/spec.md`)).toBe(crlf);
    expect(existsSync(join(root, added))).toBe(false);
    expect(cli("approval", "check", ID).code).toBe(0);
  });
});

describe("contract classification edge cases", () => {
  const base = YAML.parse(`openapi: 3.1.0
paths:
  /bookings/{id}:
    parameters:
      - {name: id, in: path, required: true, schema: {type: string}}
    put:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [at]
              properties:
                at: {type: string}
                status: {type: string, enum: [booked, cancelled]}
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id: {type: string}
`) as Record<string, any>;
  const was = YAML.stringify(base);
  const text = (patch: (d: Record<string, any>) => void) => {
    const d = structuredClone(base);
    patch(d);
    return YAML.stringify(d);
  };
  const body = (d: Record<string, any>) => d.paths["/bookings/{id}"].put.requestBody.content["application/json"].schema;
  const resp = (d: Record<string, any>) => d.paths["/bookings/{id}"].put.responses["200"].content["application/json"].schema;

  it("a path parameter renamed counts as breaking (conservative: the operation moves)", () => {
    const renamed = text((d) => {
      const item = d.paths["/bookings/{id}"];
      item.parameters[0].name = "bookingId";
      d.paths["/bookings/{bookingId}"] = item;
      delete d.paths["/bookings/{id}"];
    });
    expect(classifyOpenApi(was, renamed).class).toBe("breaking");
  });

  it("a required field added to a request body is breaking; an optional one is additive", () => {
    expect(classifyOpenApi(was, text((d) => {
      body(d).properties.room = { type: "string" };
      body(d).required.push("room");
    })).class).toBe("breaking");
    expect(classifyOpenApi(was, text((d) => (body(d).properties.room = { type: "string" }))).class).toBe("additive");
    expect(classifyOpenApi(was, text((d) => body(d).required.push("status"))).class).toBe("breaking");
  });

  it("an enum value removed is breaking; added to a request is additive", () => {
    expect(classifyOpenApi(was, text((d) => (body(d).properties.status.enum = ["booked"]))).class).toBe("breaking");
    expect(classifyOpenApi(was, text((d) => body(d).properties.status.enum.push("moved"))).class).toBe("additive");
  });

  it("a response field added is additive, even a required one; a response field removed is breaking", () => {
    expect(classifyOpenApi(was, text((d) => (resp(d).properties.note = { type: "string" }))).class).toBe("additive");
    expect(classifyOpenApi(was, text((d) => {
      resp(d).properties.note = { type: "string" };
      resp(d).required.push("note");
    })).class).toBe("additive");
    expect(classifyOpenApi(was, text((d) => delete resp(d).properties.id)).class).toBe("breaking");
  });
});

describe("close checks the changed package validates", () => {
  it("refuses a task list that no longer validates (a dependency on a task that does not exist)", () => {
    building();
    expect(open("--role", "technical-planner", "--files", `${C}/tasks.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/tasks.yaml`, TASKS.replace("depends_on: [T04]", "depends_on: [T99]"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(1);
    expect(r.err).toMatch(/does not validate/);
    expect(deviations()[0]?.status).toBe("open");
  });
});

describe("not built (D10) and verifying", () => {
  it("a Change whose open tasks are all not built may go on to verifying", () => {
    building();
    expect(cli("not-built", "T03", "--reason", "needs a paid plan").code).toBe(0);
    setStatus({ T01: "done", T02: "done", T04: "done", T05: "done" });
    const v = cli("transition", ID, "verifying");
    expect(v.code, v.all).toBe(0);
  });
});

