/**
 * T7 gaps (ADR-0016; I1, Q1, Q3, M1, M2, M10; OP2): the edges of the Existing System Report checks that
 * tests/existing-system.test.ts leaves open. Greenfield skips every check, whatever the Workflow; a Change created
 * before analysis_template 2 still passes and moves through its stages (the new bugfix assessment stage must not
 * strand a bugfix already in diagnosis); the question count at its limits; a bugfix that asks too much; the Size:
 * small limit is a warning; T9's Before check and this report work together.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "booking-v3";
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
type Msg = { file: string; message: string };
const analyze = () => cli("analyze", ID, "--json").json() as { errors: Msg[]; warnings: Msg[] };
const errors = () => analyze().errors.map((e) => e.message);
const warnings = () => analyze().warnings.map((e) => e.message);
const dir = () => `.aidw/changes/${ID}`;
const REPORT_MESSAGES = /Existing System Report|question\(s\)|no questions|has no part|"## Summary"|"## Not answered"|name existing-system\.md/;
const reportErrors = () => errors().filter((m) => REPORT_MESSAGES.test(m));

const REPORT = `# Existing system

## Summary

- Routes under app/api/ write through lib/db.ts.

## Findings

\`app/api/slots/route.ts:4\`.

## Not answered

None.
`;
const EXISTING = (named: boolean) =>
  `## Existing system\n\n- Routes under app/api/ write through lib/db.ts.\n\n${named ? `Full report: .aidw/changes/${ID}/existing-system.md. ` : ""}Lint and tests pass today.\n\n`;
const analysisWith = (named: boolean, before = named) =>
  ANALYSIS_MD.replace("## Domain", `${EXISTING(named)}## Domain`).replace("### Before\n\n", before ? "### Before\n\nFrom existing-system.md.\n\n" : "### Before\n\n");

const questions = (groups: number[]) => {
  let n = 0;
  return groups.map((size, g) => `## Group ${g + 1}: area ${g + 1}\n\n${Array.from({ length: size }, () => `${++n}. Question ${n}?`).join("\n")}\n`).join("\n");
};
function writeReport(groups: number[], parts = groups.length > 1 ? groups.length : 0) {
  write(root, `${dir()}/existing-system/questions.md`, `# Existing system questions\n\n${questions(groups)}`);
  for (let i = 1; i <= parts; i++) write(root, `${dir()}/existing-system/part-${i}.md`, `# Part ${i}\n`);
  write(root, `${dir()}/existing-system.md`, REPORT);
  write(root, `${dir()}/analysis.md`, analysisWith(true));
}
function setKind(kind: "brownfield" | "greenfield") {
  const f = join(root, ".aidw/project.yaml");
  writeFileSync(f, readFileSync(f, "utf8").replace(/^kind: \w+/m, `kind: ${kind}`));
}
const metaFile = () => join(root, dir(), "change.yaml");
function setWorkflow(wf: string) {
  writeFileSync(metaFile(), readFileSync(metaFile(), "utf8").replace(/^workflow: .*\n/m, "") + `workflow: ${wf}\n`);
}
/** A Change created before analysis_template 2 (and so before the report existed). */
function makeOld() {
  writeFileSync(metaFile(), readFileSync(metaFile(), "utf8").replace(/^analysis_template: .*\n/m, ""));
}

function setup() {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli("change", "new", ID).code).toBe(0);
  write(root, `${dir()}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${dir()}/tasks.yaml`, TASKS_YAML);
  write(root, `${dir()}/quality.yaml`, QUALITY_YAML);
  write(root, `${dir()}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
}
beforeEach(setup);

describe("greenfield skips the report whatever the Workflow (M1)", () => {
  it("asks nothing of a greenfield Change on the feature Workflow", () => {
    setKind("greenfield");
    setWorkflow("feature");
    write(root, `${dir()}/analysis.md`, analysisWith(false));
    expect(reportErrors()).toEqual([]);
  });

  it("asks nothing of a greenfield Change on the bugfix Workflow", () => {
    setKind("greenfield");
    setWorkflow("bugfix");
    expect(reportErrors()).toEqual([]);
  });

  it("does not judge a stray questions file on a greenfield Change", () => {
    setKind("greenfield");
    write(root, `${dir()}/existing-system/questions.md`, questions([9]));
    expect(reportErrors()).toEqual([]);
  });
});

describe("a Change created before analysis_template 2 is not judged again", () => {
  it("passes analyze on a brownfield feature Change with no report and a ## Existing system that names no file", () => {
    setKind("brownfield");
    makeOld();
    write(root, `${dir()}/analysis.md`, analysisWith(false));
    const r = cli("analyze", ID);
    expect(r.code, r.out + r.err).toBe(0);
  });

  it("passes analyze on a brownfield bugfix Change with no report", () => {
    setKind("brownfield");
    setWorkflow("bugfix");
    makeOld();
    write(root, `${dir()}/analysis.md`, analysisWith(false));
    expect(reportErrors()).toEqual([]);
  });

  it("ignores a too-long questions file on an old Change", () => {
    setKind("brownfield");
    makeOld();
    write(root, `${dir()}/analysis.md`, analysisWith(false));
    write(root, `${dir()}/existing-system/questions.md`, questions([5, 5]));
    expect(reportErrors()).toEqual([]);
  });
});

describe("the new bugfix assessment stage does not strand a bugfix Change already under way", () => {
  function oldBugfix(stagesYaml: string | null) {
    root = tempProject();
    cli("init");
    setKind("brownfield");
    expect(cli("change", "new", ID, "--workflow", "bugfix").code).toBe(0);
    makeOld();
    const f = join(root, dir(), "stages.yaml");
    if (stagesYaml === null) rmSync(f, { force: true });
    else writeFileSync(f, stagesYaml);
    expect(cli("transition", ID, "intake").code).toBe(0);
    expect(cli("transition", ID, "analyzing").code).toBe(0);
  }

  it("offers the diagnosis next to a bugfix in analyzing whose stages.yaml predates the assessment stage", () => {
    oldBugfix("done: [intake]\n");
    const j = cli("stages", ID, "--json").json();
    expect(j.done).toEqual(expect.arrayContaining(["intake", "assessment"]));
    expect(j.ready.map((s: { id: string }) => s.id)).toEqual(["diagnosis"]);
    expect(cli("stages", "--done", "diagnosis", "--change", ID).code).toBe(0);
  });

  it("offers the diagnosis next to a bugfix in analyzing that has no stages.yaml and no existing-system.md", () => {
    oldBugfix(null);
    const j = cli("stages", ID, "--json").json();
    expect(j.done).toContain("assessment");
    expect(j.ready.map((s: { id: string }) => s.id)).toContain("diagnosis");
  });

  it("offers the assessment after the intake to a new bugfix Change", () => {
    root = tempProject();
    cli("init");
    setKind("brownfield");
    expect(cli("change", "new", ID, "--workflow", "bugfix").code).toBe(0);
    expect(cli("transition", ID, "intake").code).toBe(0);
    expect(cli("stages", "--done", "intake", "--change", ID).code).toBe(0);
    const j = cli("stages", ID, "--json").json();
    expect(j.ready.map((s: { id: string }) => s.id)).toEqual(["assessment"]);
  });

  it("lets an old brownfield bugfix Change with no report reach the gate", () => {
    root = tempProject();
    cli("init");
    setKind("brownfield");
    expect(cli("change", "new", ID, "--workflow", "bugfix").code).toBe(0);
    makeOld();
    write(root, `${dir()}/analysis.md`, analysisWith(false));
    write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
    write(root, `${dir()}/tasks.yaml`, `tasks:\n  - id: T01\n    title: Fix cancel\n    role: fullstack\n    type: fix\n    touches: ["lib/cancel.ts"]\n    verify: ['node -e "process.exit(0)"']\n    status: pending\n`);
    write(root, `${dir()}/quality.yaml`, QUALITY_YAML);
    writeFileSync(metaFile(), readFileSync(metaFile(), "utf8").replace("skip_specs: false", "skip_specs: true"));
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) {
      const r = cli("transition", ID, s);
      expect(r.code, `${s}: ${r.err}${r.out}`).toBe(0);
    }
  });
});

describe("the question count at its limits (M10)", () => {
  beforeEach(() => setKind("brownfield"));

  it("accepts exactly 2 questions in one group, with no part needed", () => {
    writeReport([2]);
    expect(reportErrors()).toEqual([]);
  });

  it("accepts exactly 7 questions across groups, each with its part", () => {
    writeReport([3, 2, 2]);
    expect(reportErrors()).toEqual([]);
    const r = cli("analyze", ID);
    expect(r.code, r.out + r.err).toBe(0);
  });

  it("refuses 1 and 8 questions split across groups", () => {
    writeReport([1]);
    expect(errors()).toContain("1 question(s): write 2 to 7 neutral questions about today's code");
    writeReport([4, 4]);
    expect(errors()).toContain("8 question(s): write 2 to 7 neutral questions about today's code");
  });

  it("asks for the part of the third group by its own number", () => {
    writeReport([2, 2, 2], 2);
    expect(errors()).toContain(`"## Group 3: area 3" has no part: its Research Agent writes .aidw/changes/${ID}/existing-system/part-3.md`);
  });
});

describe("a bugfix asks at most 3 questions in one group (M2)", () => {
  beforeEach(() => {
    setKind("brownfield");
    setWorkflow("bugfix");
  });

  it("refuses 4 questions in one group", () => {
    writeReport([4]);
    expect(errors()).toContain("a bugfix asks at most 3 question(s) in one group, answered by one Agent (4 in 1 group(s))");
  });

  it("refuses 4 questions in 2 groups", () => {
    writeReport([2, 2]);
    expect(errors()).toContain("a bugfix asks at most 3 question(s) in one group, answered by one Agent (4 in 2 group(s))");
  });

  it("refuses 2 questions split in 2 groups", () => {
    writeReport([1, 1]);
    expect(errors()).toContain("a bugfix asks at most 3 question(s) in one group, answered by one Agent (2 in 2 group(s))");
  });

  it("accepts 1 question in one group (a bugfix has no lower bound of 2) and needs no part", () => {
    writeReport([1]);
    expect(reportErrors()).toEqual([]);
  });

  it("accepts 3 questions in one group answered by one Agent, no parts", () => {
    writeReport([3]);
    expect(reportErrors()).toEqual([]);
  });

  it("still needs the report itself", () => {
    writeReport([3]);
    rmSync(join(root, dir(), "existing-system.md"));
    expect(errors()).toContain("brownfield Change: missing the Existing System Report (the merging Research Agent writes it; /aidw:start step 1b)");
  });
});

describe("Size: small is a warning, not an error (M2)", () => {
  beforeEach(() => setKind("brownfield"));
  const small = () => write(root, `${dir()}/analysis.md`, analysisWith(true).replace("## Summary\n\n", "## Summary\n\nSize: small\n\n"));

  it("does not warn a small Change with 3 questions in one group", () => {
    writeReport([3]);
    small();
    expect(warnings().filter((m) => /Size: small normally/.test(m))).toEqual([]);
  });

  it("warns, but does not refuse, a small Change with 4 questions in one group", () => {
    writeReport([4]);
    small();
    expect(warnings()).toContain("Size: small normally asks at most 3 question(s) in one group, answered by one Agent (4 in 1 group(s))");
    expect(reportErrors()).toEqual([]);
  });
});

describe("T9's Before check and the report work together", () => {
  beforeEach(() => setKind("brownfield"));
  const BEFORE_ERR = '"## Before / After": this Change has an Existing System Report; "### Before" must draw from it and name existing-system.md';

  it("asks ### Before to name the report once it exists", () => {
    writeReport([2]);
    write(root, `${dir()}/analysis.md`, analysisWith(true, false));
    expect(errors()).toContain(BEFORE_ERR);
  });

  it("passes when both ## Existing system and ### Before name the report", () => {
    writeReport([2]);
    expect(errors()).not.toContain(BEFORE_ERR);
    expect(reportErrors()).toEqual([]);
  });

  it("reports the missing report once, from the report check, not from the Before check", () => {
    write(root, `${dir()}/analysis.md`, analysisWith(true, false));
    write(root, `${dir()}/existing-system/questions.md`, questions([2]));
    const m = errors();
    expect(m).toContain("brownfield Change: missing the Existing System Report (the merging Research Agent writes it; /aidw:start step 1b)");
    expect(m).not.toContain(BEFORE_ERR);
  });
});
