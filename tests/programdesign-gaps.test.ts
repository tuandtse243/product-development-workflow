/**
 * Gaps in the tests of T12 (ADR-0015; D2, D3, I5, Q2 to Q7, M9): an older Change through every step, an approval of
 * package version 3, the short Program Design of a small Change, the refusals of `--done system-design-round`, the
 * gate page escaping program-design.md, the Deviation of the Program Design, and the fixture that adds it.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { computeApprovalHash } from "../src/approval.js";
import { loadChange } from "../src/change.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, PROGRAM_DESIGN_MD, QUALITY_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "booking-pdg";
const C = `.aidw/changes/${ID}`;
const OK = `node -e "process.exit(0)"`;
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, all: out + err };
}
const json = (r: { out: string }) => JSON.parse(r.out) as { errors: { message: string }[]; warnings: { message: string }[] };
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const pdFile = () => join(root, C, "program-design.md");
const changeYaml = () => YAML.parse(read(`${C}/change.yaml`)) as Record<string, unknown> & { state: string; approval: Record<string, unknown> };
const tasks = () => (YAML.parse(read(`${C}/tasks.yaml`)) as { tasks: Record<string, unknown>[] }).tasks;

const QUESTIONS = /### Design Questions\n\n[\s\S]*?(?=### System design round)/;
const ROUND = /### System design round\n\n[\s\S]*?(?=\n## Specs)/;
const SMALL = (a: string) => a.replace("## Summary\n\n", "## Summary\n\nSize: small\n\n");

const DELTA = `## ADDED Requirements

### Requirement: Reschedule appointment
The system SHALL let a patient move an upcoming appointment to another free slot.

#### Scenario: Reschedule appointment works
- **WHEN** a patient moves an appointment to a free slot
- **THEN** the appointment has the new time
`;
const S1 = "booking/reschedule-appointment/reschedule-appointment-works";
const task = (id: string, role: string, touches: string, extra = "") => `  - id: ${id}
    title: Task ${id}
    role: ${role}
    type: feat
${extra}    depends_on: []
    touches: ["${touches}"]
    verify: ['${OK}']
    status: pending
`;
/** T01 builds the API route, T02 the booking page, T03 something the Program Design never names. */
const TASKS = `tasks:
${task("T01", "backend", "app/api/**", `    specs: [booking/reschedule-appointment]\n    scenarios: [${S1}]\n`)}${task("T02", "frontend", "app/(site)/**")}${task("T03", "backend", "lib/mail/**")}`;
const OPENAPI = (extra = "") => `openapi: 3.1.0
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
${extra}`;

/**
 * A Change with its package written. `template`: the analysis_template to leave on the Change (null: none, as a Change
 * created before templates existed); an older Change gets no Design Questions, no round and no program-design.md.
 */
function setup(template: number | null = 3) {
  root = tempProject();
  temps.push(root);
  expect(cli("init").code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli("change", "new", ID, "--title", "Booking", "--workflow", "feature").code).toBe(0);
  if (template !== 3) {
    const file = join(root, C, "change.yaml");
    const y = readFileSync(file, "utf8");
    writeFileSync(file, template === null ? y.replace(/^analysis_template: \d+\n/m, "") : y.replace(/^analysis_template: \d+\n/m, `analysis_template: ${template}\n`));
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace(QUESTIONS, "").replace(ROUND, ""));
    rmSync(pdFile());
  } else write(root, `${C}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${C}/tasks.yaml`, TASKS);
  write(root, `${C}/quality.yaml`, QUALITY_YAML);
  write(root, `${C}/specs/booking/spec.md`, DELTA);
  write(root, `${C}/openapi.yaml`, OPENAPI());
  write(root, ".aidw/architecture/overview.md", "# Architecture\n");
}

function toGate() {
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const t = cli("transition", ID, s);
    expect(t.code, `${s}: ${t.all}`).toBe(0);
  }
}

function approved() {
  toGate();
  const a = cli("approve", ID);
  expect(a.code, a.all).toBe(0);
  expect(cli("transition", ID, "executing").code).toBe(0);
}

const toArchitecture = () => {
  for (const s of ["intake", "analyzing"]) expect(cli("transition", ID, s).code).toBe(0);
  for (const s of ["assessment", "discovery", "research", "user-research", "requirements", "design", "architecture"]) {
    const r = cli("stages", "--done", s, "--change", ID);
    expect(r.code, `${s}: ${r.err}`).toBe(0);
  }
};

describe("a Change created before template 3 owes neither the round nor the Program Design", () => {
  for (const template of [2, null]) {
    const label = template === null ? "no analysis_template" : `analysis_template ${template}`;

    it(`${label}: reports both stages done without them`, () => {
      setup(template);
      toArchitecture();
      // the stage's title names the round; no advice about Design Questions is added to the NEXT line
      expect(cli("stages", ID).out).not.toMatch(/open Design Question\(s\)|ask one question in the chat|lists no "### Design Questions"|has no system design round/);
      const round = cli("stages", "--done", "system-design-round", "--change", ID);
      expect(round.code, round.err).toBe(0);
      expect(cli("stages", "--done", "contracts", "--change", ID).code).toBe(0);
      const pd = cli("stages", "--done", "program-design", "--change", ID);
      expect(pd.code, pd.err).toBe(0);
    });

    it(`${label}: analyze, approve, validate, approval check and a Deviation all pass without program-design.md`, () => {
      setup(template);
      expect(existsSync(pdFile())).toBe(false);
      const a = cli("analyze", ID, "--json");
      expect(json(a).errors.map((e) => e.message)).toEqual([]);
      toGate();
      expect(cli("validate", ID).code).toBe(0);
      const ap = cli("approve", ID, "--json");
      expect(ap.code, ap.all).toBe(0);
      expect(JSON.parse(ap.out).files).not.toContain(`${C}/program-design.md`);
      expect(cli("transition", ID, "executing").code).toBe(0);
      expect(cli("approval", "check", ID).code).toBe(0);
      const v = cli("validate", ID);
      expect(v.code, v.all).toBe(0);
      expect(cli("deviation", "open", ID, "--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
      write(root, `${C}/openapi.yaml`, OPENAPI("        note: {type: string}\n"));
      const close = cli("deviation", "close", ID);
      expect(close.code, close.all).toBe(0);
      expect(cli("approval", "check", ID).code).toBe(0);
      expect(cli("validate", ID).code).toBe(0);
    });
  }
});

describe("an approval of package version 3 (made before the Program Design was part of it)", () => {
  /** Rewrites the approval as `aidw approve` of package version 3 wrote it: version 3 and its hash. */
  function asVersion3() {
    const p = pathsFor(root);
    const file = join(root, C, "change.yaml");
    const y = YAML.parse(readFileSync(file, "utf8")) as { approval: Record<string, unknown> };
    y.approval.package = 3;
    writeFileSync(file, YAML.stringify(y));
    y.approval.hash = computeApprovalHash(p, loadChange(p, ID), undefined, { version: 3 }).hash;
    writeFileSync(file, YAML.stringify(y));
  }

  it("still validates, and program-design.md is not part of it", () => {
    setup();
    approved();
    asVersion3();
    expect(cli("approval", "check", ID).code).toBe(0);
    expect(cli("validate", ID).code).toBe(0);
    writeFileSync(pdFile(), `${PROGRAM_DESIGN_MD}\n<!-- edited after a version 3 approval -->\n`);
    const c = cli("approval", "check", ID);
    expect(c.code, c.all).toBe(0);
    // a file of version 3 is still bound
    writeFileSync(join(root, C, "analysis.md"), `${ANALYSIS_MD}\nedited\n`);
    expect(cli("approval", "check", ID).code).toBe(1);
  });

  it("keeps version 3 through a Deviation's close", () => {
    setup();
    approved();
    asVersion3();
    expect(cli("deviation", "open", ID, "--role", "api-designer", "--files", `${C}/openapi.yaml`, "--reason", "x").code).toBe(0);
    write(root, `${C}/openapi.yaml`, OPENAPI("        note: {type: string}\n"));
    const close = cli("deviation", "close", ID);
    expect(close.code, close.all).toBe(0);
    expect(changeYaml().approval.package).toBe(3);
    expect(cli("approval", "check", ID).code).toBe(0);
  });
});

describe("a Size: small Change (Q5)", () => {
  it("passes analyze with no round and the short Program Design, with no warning about it", () => {
    setup();
    write(root, `${C}/analysis.md`, SMALL(ANALYSIS_MD).replace(ROUND, ""));
    const r = cli("analyze", ID, "--json");
    expect(r.code, r.out).toBe(0);
    expect(json(r).warnings.map((w) => w.message).join("\n")).not.toMatch(/Program Design|program-design/);
  });

  it("warns, without refusing, about each optional part it carries", () => {
    setup();
    write(root, `${C}/analysis.md`, SMALL(ANALYSIS_MD).replace(ROUND, ""));
    writeFileSync(pdFile(), `${PROGRAM_DESIGN_MD}\n## Pseudocode\n\n\`\`\`text\nlock, write\n\`\`\`\n\n## Dependency map\n\n\`\`\`text\nroute -> repo\n\`\`\`\n`);
    const r = cli("analyze", ID, "--json");
    expect(r.code, r.out).toBe(0);
    expect(json(r).warnings.map((w) => w.message)).toContain('Size: small gets the short Program Design (file tree and signatures); "## Pseudocode", "## Dependency map" can go');
  });

  it("still refuses a Design Question left open", () => {
    setup();
    write(root, `${C}/analysis.md`, SMALL(ANALYSIS_MD).replace(QUESTIONS, "### Design Questions\n\n- DQ1: Where?\n  Open: a | b (recommend: a)\n\n").replace(ROUND, ""));
    expect(json(cli("analyze", ID, "--json")).errors.map((e) => e.message).join("\n")).toMatch(/DQ1 is still open/);
  });

  it("still needs both required parts of the Program Design", () => {
    setup();
    write(root, `${C}/analysis.md`, SMALL(ANALYSIS_MD).replace(ROUND, ""));
    writeFileSync(pdFile(), "# Program Design\n\n## Signatures and contracts\n\n```ts\nexport function f(): void\n```\n");
    expect(json(cli("analyze", ID, "--json")).errors.map((e) => e.message)).toContain('missing "## File tree"');
  });
});

describe("aidw stages --done system-design-round refuses through the CLI (D3, Q6)", () => {
  const done = () => cli("stages", "--done", "system-design-round", "--change", ID);

  it("refuses a round that is not recorded, with nothing open", () => {
    setup();
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace(ROUND, ""));
    toArchitecture();
    const r = done();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/stage "system-design-round" is done when the system design round is recorded: the system design round is not recorded/);
  });

  it("refuses a round that holds only a placeholder or no answer line", () => {
    setup();
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace(ROUND, "### System design round\n\nTODO(aidw): the answer\n"));
    toArchitecture();
    expect(done().err).toMatch(/the system design round is not recorded/);
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace(ROUND, "### System design round\n\nWe talked about it.\n"));
    expect(done().err).toMatch(/"### System design round" has no answer/);
  });

  it("refuses a round with no Design Questions listed", () => {
    setup();
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace(QUESTIONS, "").replace(ROUND, "### System design round\n\nconfirmed: yes\n"));
    toArchitecture();
    expect(done().err).toMatch(/missing "### Design Questions"/);
  });

  it("refuses a round that asked more than 5, and is not recorded as done", () => {
    setup();
    const settled = Array.from({ length: 6 }, (_, i) => `- DQ${i + 1}: Q${i + 1}?\n  Chosen: a.\n  Why: b.\n  Rejected: none.`).join("\n");
    const answers = Array.from({ length: 6 }, (_, i) => `DQ${i + 1} Q${i + 1}?: a`).join("\n");
    write(root, `${C}/analysis.md`, ANALYSIS_MD.replace(QUESTIONS, `### Design Questions\n\n${settled}\n\n`).replace(ROUND, `### System design round\n\n${answers}\n`));
    toArchitecture();
    const r = done();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/asked 6 Design Questions; a round asks at most 5/);
    expect(cli("stages", ID).out).toMatch(/NEXT: stage system-design-round/);
  });
});

describe("the gate page renders program-design.md escaped (Q4)", () => {
  it("escapes markup in the file tree and the signatures", () => {
    setup();
    writeFileSync(
      pdFile(),
      "# Program Design\n\n## File tree\n\n```text\n+ app/x<script>alert(1)</script>.ts\n```\n\n## Signatures and contracts\n\n```ts\nexport function f(a: Array<string>): \"<img src=x onerror=alert(2)>\"\n```\n",
    );
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.all).toBe(0);
    const html = read(".aidw/run/pages/gate.html");
    expect(html).toMatch(/data-sec="program-design"/);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(2)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toMatch(/Array&lt;string&gt;/);
  });

  it("adds no section when the Change has no program-design.md", () => {
    setup(2);
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.all).toBe(0);
    expect(read(".aidw/run/pages/gate.html")).not.toMatch(/data-sec="program-design"/);
  });
});

describe("a Deviation of the Program Design runs again only the tasks that build what changed (Q4)", () => {
  const setStatus = (all: string) => {
    const data = YAML.parse(read(`${C}/tasks.yaml`)) as { tasks: Record<string, unknown>[] };
    for (const t of data.tasks) t.status = all;
    writeFileSync(join(root, C, "tasks.yaml"), YAML.stringify(data));
  };
  const statuses = () => Object.fromEntries(tasks().map((t) => [t.id, t.status]));
  const openPd = () => cli("deviation", "open", ID, "--role", "software-architect", "--files", `${C}/program-design.md`, "--reason", "the route returns null");

  it("a changed signature reruns the task that touches its file, and keeps the others done", () => {
    setup();
    approved();
    setStatus("done");
    const o = openPd();
    expect(o.code, o.all).toBe(0);
    writeFileSync(pdFile(), PROGRAM_DESIGN_MD.replace("Promise<Response>;", "Promise<Response | null>;"));
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(statuses()).toMatchObject({ T02: "done", T03: "done" });
    expect(statuses().T01).not.toBe("done");
    expect(cli("approval", "check", ID).code).toBe(0);
  });

  it("a change that names no file reruns every built task", () => {
    setup();
    approved();
    setStatus("done");
    expect(openPd().code).toBe(0);
    writeFileSync(pdFile(), `${PROGRAM_DESIGN_MD}\n## Pseudocode\n\n\`\`\`text\nlock the slot, then write\n\`\`\`\n`);
    const r = cli("deviation", "close", ID);
    expect(r.code, r.all).toBe(0);
    expect(Object.values(statuses()).filter((s) => s === "done")).toEqual([]);
  });

  it("after the gate, files the tree marks new may exist (the build made them)", () => {
    setup();
    approved();
    write(root, "app/api/bookings/route.ts", "export {};\n");
    const r = cli("analyze", ID, "--json");
    expect(json(r).warnings.map((w) => w.message).join("\n")).not.toMatch(/marks app\/api\/bookings\/route\.ts new, but it exists/);
  });
});

describe("the fixture that adds program-design.md (tests/fixtures.ts)", () => {
  it("adds it only beside a Change's analysis.md and never over one a test wrote", () => {
    root = tempProject();
    temps.push(root);
    write(root, "docs/analysis.md", "x");
    expect(existsSync(join(root, "docs", "program-design.md"))).toBe(false);
    write(root, `${C}/specs/analysis.md`, "x");
    expect(existsSync(join(root, C, "specs", "program-design.md"))).toBe(false);
    write(root, `${C}/analysis.md`, ANALYSIS_MD);
    expect(read(`${C}/program-design.md`)).toBe(PROGRAM_DESIGN_MD);
    writeFileSync(pdFile(), "mine");
    write(root, `${C}/analysis.md`, ANALYSIS_MD);
    expect(read(`${C}/program-design.md`)).toBe("mine");
  });

  it("puts it back when analysis.md is written after a test removed it: remove it after the last write", () => {
    // A test of the missing-file error must remove program-design.md after its last write of analysis.md; this pins
    // the order the tests of programdesign.test.ts rely on.
    setup();
    rmSync(pdFile());
    write(root, `${C}/analysis.md`, ANALYSIS_MD);
    expect(existsSync(pdFile())).toBe(true);
    rmSync(pdFile());
    expect(json(cli("analyze", ID, "--json")).errors.map((e) => e.message).join("\n")).toMatch(/program-design\.md is missing/);
  });
});
