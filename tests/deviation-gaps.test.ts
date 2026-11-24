import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, type HookInput } from "../src/gate.js";
import { pathsFor } from "../src/project.js";
import { fingerprint } from "../src/runner.js";
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

describe("the tasks to run again", () => {
  it("send a Change in verifying back to executing when a done task is reset", () => {
    building();
    setStatus({ T01: "done", T02: "done", T03: "done", T04: "done", T05: "done" });
    const v = cli("transition", ID, "verifying");
    expect(v.code, v.all).toBe(0);
    expect(openApi().code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("")); // breaking: Booking.at removed
    const r = cli("deviation", "close", ID);
    // a refused close must leave nothing half done: the Deviation still open and the approval as it was
    if (r.code !== 0) {
      expect({ status: deviations()[0]?.status, check: cli("approval", "check", ID).code, T01: taskOf("T01").status }).toEqual({ status: "open", check: 0, T01: "done" });
    }
    expect(r.code, r.all).toBe(0);
    expect(change().state).toBe("executing");
    expect(deviations()[0]?.status).toBe("closed");
    expect(cli("approval", "check", ID).code).toBe(0);
  });
});

describe("while a Deviation is open", () => {
  it("aidw next, read fresh from disk, returns the Deviation; the runner counts opening and closing it as progress", () => {
    building();
    const p = pathsFor(root);
    const fp0 = fingerprint(p, ID);
    expect(openApi().code).toBe(0);
    const n = JSON.parse(cli("next", "--json").out) as { action: string; deviation: string; authors: Record<string, string> };
    expect(n).toMatchObject({ action: "deviation", deviation: "D01", authors: { [`${C}/openapi.yaml`]: "api-designer" } });
    const fp1 = fingerprint(p, ID);
    expect(fp1).not.toBe(fp0);
    write(root, `${C}/openapi.yaml`, ADDITIVE("note"));
    expect(cli("deviation", "close", ID).code).toBe(0);
    expect(fingerprint(p, ID)).not.toBe(fp1);
  });

  it("the gate: the lead does not edit the Deviation's file by Bash either", () => {
    // The Write tool is denied to the lead (tested in deviation.test.ts); while the Deviation is open the approval
    // hash reads the file as it was, so a Bash edit by the lead is neither stopped nor seen as drift and closes as the
    // author's change.
    building();
    expect(openApi().code).toBe(0);
    const f = `${C}/openapi.yaml`;
    expect(bashAs(undefined, `sed -i '' 's/string/integer/' ${f}`)).toBe("deny");
    expect(bashAs(undefined, `cp /tmp/x ${f}`)).toBe("deny");
    expect(bashAs(undefined, `node -e "require('fs').writeFileSync('${f}','x')"`)).toBe("deny");
  });
});

describe("close while the author is mid-edit", () => {
  it("refuses a contract that is not valid YAML (a half-written file)", () => {
    building();
    expect(openApi().code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI().slice(0, OPENAPI().indexOf("schema: {$ref") + 10));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(1);
    expect(deviations()[0]?.status).toBe("open");
  });

  it("refuses a delta spec cut off in the middle of a scenario", () => {
    building();
    expect(open("--role", "business-analyst", "--files", `${C}/specs/booking/spec.md`, "--reason", "x").code).toBe(0);
    write(root, `${C}/specs/booking/spec.md`, DELTA.slice(0, DELTA.indexOf("- **THEN** the move is refused")));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(1);
    expect(deviations()[0]?.status).toBe("open");
  });
});

describe("abandon", () => {
  it("of a Deviation on tasks.yaml keeps the task progress recorded while it was open", () => {
    // `next` lets work in flight go on beside an open Deviation; the CLI records it in tasks.yaml
    building();
    expect(open("--role", "technical-planner", "--files", `${C}/tasks.yaml`, "--reason", "x").code).toBe(0);
    setStatus({ T03: "done" });
    expect(cli("deviation", "abandon", ID).code).toBe(0);
    expect(taskOf("T03").status).toBe("done");
  });
});

describe("deviation open with a case variant of the file", () => {
  it("names the file as it is on disk, or refuses it: the approval stays valid and the author can edit it", () => {
    building();
    const variants: [string, string, string][] = [
      ["api-designer", `${C}/OPENAPI.yaml`, `${C}/openapi.yaml`],
      ["software-architect", ".aidw/ARCHITECTURE/overview.md", ".aidw/architecture/overview.md"],
    ];
    for (const [role, variant, real] of variants) {
      const o = open("--role", role, "--files", variant, "--reason", "x");
      if (o.code !== 0) continue; // refusing a path that differs from the file on disk is fine
      expect(cli("approval", "check", ID).code, `${variant}: approval after open`).toBe(0);
      expect(writeAs(`aidw:${role}`, real), `${variant}: the author edits ${real}`).toBe("allow");
      expect(cli("deviation", "abandon", ID).code).toBe(0);
    }
  });
});
