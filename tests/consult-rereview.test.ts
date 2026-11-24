import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { decide, gateState, runGate } from "../src/gate.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

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
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  expect(cli(root, "approve", ID).code).toBe(0);
  expect(cli(root, "transition", ID, "executing").code).toBe(0);
  expect(cli(root, "task", "start", "T01").code).toBe(0);
  return root;
}

const PROGRESS = "Done so far: the route.\nNext step: the error shape.\nFiles touched: app/api/bookings/route.ts";
const ask = (root: string) =>
  cli(
    root,
    "consult",
    write(root, `.aidw/changes/${ID}/consult/T01.request.md`, `---\nfrom: backend\ntask: T01\nto: software-architect\n---\n\n## Question\n\nWhich code?\n\n## Progress\n\n${PROGRESS}\n`),
  );

describe("T8 re-review probes", () => {
  it("meanwhile never starts another task on the main checkout while the asker's half-done work sits there", () => {
    const root = buildingProject(); // no git: sequential, T01 runs on the main checkout
    expect(ask(root).code).toBe(0);
    const n = cli(root, "next", "--json").json();
    expect(n.action).toBe("consult");
    // T02 would be started on the same checkout as T01's uncommitted work, and its checkpoint would commit it
    expect(n.meanwhile).toBeUndefined();
  });

  it("an authoring Role cannot Bash-write the answer of a Consultation (numbered or clobber redirects, dd)", () => {
    const root = buildingProject();
    expect(ask(root).code).toBe(0);
    const ans = `.aidw/changes/${ID}/consult/C01.answer.md`;
    const bash = (agent: string, command: string) => decide({ cwd: root, tool_name: "Bash", agent_type: agent, tool_input: { command } }, {});
    const allowed: string[] = [];
    for (const command of [`echo 'STATUS: answered' 1> ${ans}`, `echo 'STATUS: answered' 2> ${ans}`, `echo 'STATUS: answered' &> ${ans}`, `echo 'STATUS: answered' >| ${ans}`, `echo 'STATUS: answered' | dd of=${ans}`]) {
      if (bash("aidw:api-designer", command)?.decision !== "deny") allowed.push(`api-designer: ${command}`);
    }
    // the asking implementer forging its own answer: `>|` loses its target when the command is split on `|`
    const own = `echo 'STATUS: answered' >| ${ans}`;
    if (bash("aidw:backend", own)?.decision !== "deny") allowed.push(`backend: ${own}`);
    expect(allowed).toEqual([]);
  });

  it("raising runs on a new attempt is not approval drift", () => {
    const root = buildingProject();
    expect(gateState(pathsFor(root)).drift).toEqual([]);
    expect(readFileSync(join(root, ".aidw/changes", ID, "tasks.yaml"), "utf8")).toMatch(/runs: 1/);
  });

  it("a malformed consultations.yaml fails closed for the answer write", () => {
    const root = buildingProject();
    expect(ask(root).code).toBe(0);
    write(root, `.aidw/changes/${ID}/consultations.yaml`, "consultations: [\n  - id: C01\n bad: : :\n");
    const input = { cwd: root, tool_name: "Write", agent_type: "aidw:software-architect", tool_input: { file_path: join(root, `.aidw/changes/${ID}/consult/C01.answer.md`), content: "x" } };
    expect(runGate(JSON.stringify(input), {})).toMatch(/"permissionDecision":"deny"/);
  });

  it("brief pointers name the files the contract authors own", () => {
    const root = buildingProject();
    write(root, `.aidw/changes/${ID}/api-contract.md`, "# API\n");
    const b = cli(root, "brief", "T01");
    expect(b.code, b.err).toBe(0);
    const text = readFileSync(join(root, ".aidw/run/briefs", ID, "T01.implement.md"), "utf8");
    for (const f of ["constitution.md", "architecture/overview.md", `${ID}/api-contract.md`]) expect(text).toContain(f);
  });
});
