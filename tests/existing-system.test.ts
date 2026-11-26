/**
 * T7 of the rpi upgrades (ADR-0016; I1, Q1, Q3, M1, M2, M10; OP1, OP2): the Existing System Report flow. The
 * orchestrator writes neutral questions in groups, one Research Agent per group writes a part, one more merges them
 * into existing-system.md; `## Existing system` in analysis.md carries its Summary and names it. Greenfield skips it,
 * a bugfix asks at most 3 questions in one group.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { loadArtifacts } from "../src/artifacts.js";
import { run } from "../src/cli.js";
import { questionGroups } from "../src/existingsystem.js";
import { parseRoleText } from "../src/roles.js";
import { loadWorkflow, type Workflow } from "../src/workflow.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const ID = "booking-v2";
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}
type Msg = { file: string; message: string };
const errors = () => (cli("analyze", ID, "--json").json().errors as Msg[]).map((e) => e.message);
const warnings = () => (cli("analyze", ID, "--json").json().warnings as Msg[]).map((e) => e.message);
const dir = () => `.aidw/changes/${ID}`;

const QUESTIONS = `# Existing system questions

## Group 1: HTTP routes and the database (app/api/, lib/db.ts)

1. How does a request to a route under \`app/api/\` reach the database, and which tests cover it?
2. Which tables exist, and where are they created?

## Group 2: background work (lib/jobs/)

3. Which jobs run outside a request, and how are they tested?
`;
const REPORT = `# Existing system

## Summary

- Routes under app/api/ write through lib/db.ts (Findings, "Routes write through one client").

## Questions

1. ...

## Findings

### Routes write through one client

\`app/api/slots/route.ts:4\`.

## How it is tested

| Capability | Tests read | Checks run | Not tested |
|---|---|---|---|

## Code references

- \`app/api/\`

## Not answered

None.
`;
const EXISTING = `## Existing system

- Routes under app/api/ write through lib/db.ts.

Full report: .aidw/changes/${ID}/existing-system.md. Lint and tests pass today.

`;
const BROWNFIELD_ANALYSIS = ANALYSIS_MD.replace("## Domain", `${EXISTING}## Domain`).replace("### Before\n\n", "### Before\n\nFrom existing-system.md.\n\n");

function brownfield() {
  const f = join(root, ".aidw/project.yaml");
  writeFileSync(f, readFileSync(f, "utf8").replace(/^kind: greenfield/m, "kind: brownfield"));
}
function fullReport() {
  write(root, `${dir()}/existing-system/questions.md`, QUESTIONS);
  write(root, `${dir()}/existing-system/part-1.md`, "# Part 1\n");
  write(root, `${dir()}/existing-system/part-2.md`, "# Part 2\n");
  write(root, `${dir()}/existing-system.md`, REPORT);
  write(root, `${dir()}/analysis.md`, BROWNFIELD_ANALYSIS);
}
const REPORT_MESSAGES = /Existing System Report|questions|part|"## Summary"|"## Not answered"|name existing-system\.md/;

beforeEach(() => {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli("change", "new", ID);
  write(root, `${dir()}/analysis.md`, ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${dir()}/tasks.yaml`, TASKS_YAML);
  write(root, `${dir()}/quality.yaml`, QUALITY_YAML);
  write(root, `${dir()}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
});

describe("aidw analyze: the Existing System Report of a brownfield Change", () => {
  it("passes a brownfield package with questions, a part per group, the report and the section naming it", () => {
    brownfield();
    fullReport();
    const r = cli("analyze", ID);
    expect(r.code, r.out + r.err).toBe(0);
  });

  it("asks nothing of a greenfield project (M1)", () => {
    expect(errors().filter((m) => REPORT_MESSAGES.test(m))).toEqual([]);
  });

  it("does not judge a Change created before analysis_template 2", () => {
    brownfield();
    write(root, `${dir()}/analysis.md`, BROWNFIELD_ANALYSIS);
    const meta = join(root, dir(), "change.yaml");
    writeFileSync(meta, readFileSync(meta, "utf8").replace(/^analysis_template: .*\n/m, ""));
    expect(errors().filter((m) => /Existing System Report|questions/.test(m))).toEqual([]);
  });

  it("refuses a brownfield package without the questions or the report (I1, Q3)", () => {
    brownfield();
    write(root, `${dir()}/analysis.md`, BROWNFIELD_ANALYSIS);
    const m = errors();
    expect(m).toContain("brownfield Change: missing the questions of the Existing System Report (2 to 7 neutral questions about today's code, in groups; /aidw:start step 1b)");
    expect(m).toContain("brownfield Change: missing the Existing System Report (the merging Research Agent writes it; /aidw:start step 1b)");
  });

  it("counts the questions: 2 to 7 (M10)", () => {
    brownfield();
    fullReport();
    write(root, `${dir()}/existing-system/questions.md`, "## Group 1: code\n\n1. How does a request reach the database?\n");
    expect(errors()).toContain("1 question(s): write 2 to 7 neutral questions about today's code");
    write(root, `${dir()}/existing-system/questions.md`, `## Group 1: code\n\n${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${n}. Question ${n}?`).join("\n")}\n`);
    expect(errors()).toContain("8 question(s): write 2 to 7 neutral questions about today's code");
    write(root, `${dir()}/existing-system/questions.md`, "## Group 1: code\n\nNo numbered line here.\n");
    expect(errors()).toContain('no questions: write each as a numbered line ("1. ...") under a "## " group heading');
  });

  it("needs a part for each group when several Agents answered (Q3)", () => {
    brownfield();
    fullReport();
    rmSync(join(root, dir(), "existing-system/part-2.md"));
    expect(errors()).toContain(`"## Group 2: background work (lib/jobs/)" has no part: its Research Agent writes .aidw/changes/${ID}/existing-system/part-2.md`);
  });

  it("needs the report's Summary and Not answered (OP2)", () => {
    brownfield();
    fullReport();
    write(root, `${dir()}/existing-system.md`, REPORT.replace(/## Not answered[\s\S]*$/, "").replace(/## Summary\n\n.*\n\n/, "## Summary\n\n"));
    const m = errors();
    expect(m).toContain('section "## Summary" is empty');
    expect(m).toContain('missing section "## Not answered" (the questions no part answered, or "None")');
  });

  it('refuses "## Existing system" that does not name the report (I1, Q1)', () => {
    brownfield();
    fullReport();
    write(root, `${dir()}/analysis.md`, BROWNFIELD_ANALYSIS.replace(`Full report: .aidw/changes/${ID}/existing-system.md. `, ""));
    expect(errors()).toContain('"## Existing system" carries the Summary of the Existing System Report: name existing-system.md');
  });

  it("holds a bugfix to at most 3 questions in one group, answered by one Agent (M2)", () => {
    brownfield();
    fullReport();
    const meta = join(root, dir(), "change.yaml");
    writeFileSync(meta, readFileSync(meta, "utf8").replace(/^workflow: .*\n/m, "") + "workflow: bugfix\n");
    expect(errors()).toContain("a bugfix asks at most 3 question(s) in one group, answered by one Agent (3 in 2 group(s))");
    write(root, `${dir()}/existing-system/questions.md`, "## Group 1: routes\n\n1. How does a request reach the database?\n2. Which tests cover it?\n");
    expect(errors().filter((m) => /question/.test(m))).toEqual([]);
  });

  it("warns a Size: small Change that asked more than 3 questions (M2: the size is confirmed after the questions)", () => {
    brownfield();
    fullReport();
    write(root, `${dir()}/analysis.md`, BROWNFIELD_ANALYSIS.replace("## Summary\n\n", "## Summary\n\nSize: small\n\n"));
    expect(warnings()).toContain("Size: small normally asks at most 3 question(s) in one group, answered by one Agent (3 in 2 group(s))");
  });

  it("reads groups and numbered questions, and ignores numbered lines in a code block", () => {
    const g = questionGroups(`${QUESTIONS}\n\`\`\`\n4. not a question\n\`\`\`\n`);
    expect(g.map((x) => [x.title, x.questions.length])).toEqual([
      ["Group 1: HTTP routes and the database (app/api/, lib/db.ts)", 2],
      ["Group 2: background work (lib/jobs/)", 1],
    ]);
  });
});

describe("the report as an Artifact of the Workflows' stages", () => {
  const registry = loadArtifacts(plugin)!;
  const stage = (wf: string, id: string) => (loadWorkflow(plugin, wf) as Workflow).stages.find((s) => s.id === id)!;

  it("registers the report and its parts, owned by Research", () => {
    expect(registry["existing-system"]).toMatchObject({ path: "changes/<id>/existing-system.md", owner: "research", validate: "aidw analyze" });
    expect(registry["existing-system-part"]).toMatchObject({ path: "changes/<id>/existing-system/part-<n>.md", owner: "research" });
  });

  it("is written by Research and read by the Product Manager and the Software Architect", () => {
    const header = (id: string) => parseRoleText(readFileSync(join(plugin, "roles", id, "role.md"), "utf8"))!.header;
    expect(header("research").writes).toEqual(expect.arrayContaining(["existing-system", "existing-system-part"]));
    expect(header("product-manager").reads).toContain("existing-system");
    expect(header("software-architect").reads).toContain("existing-system");
  });

  it("is written in feature's assessment and read by discovery and requirements", () => {
    const a = stage("feature", "assessment");
    expect(a.roles).toContain("research");
    expect(a.writes).toEqual(expect.arrayContaining(["existing-system", "existing-system-part"]));
    expect(stage("feature", "discovery").reads).toContain("existing-system");
    expect(stage("feature", "requirements").reads).toContain("existing-system");
  });

  it("is written in bugfix's assessment, before the diagnosis reads it, without parts (M2)", () => {
    const wf = loadWorkflow(plugin, "bugfix") as Workflow;
    const ids = wf.stages.map((s) => s.id);
    expect(ids.indexOf("assessment")).toBeLessThan(ids.indexOf("diagnosis"));
    expect(stage("bugfix", "assessment").writes).toEqual(["existing-system"]);
    expect(stage("bugfix", "diagnosis").reads).toContain("existing-system");
  });

  it("is never written in a greenfield Workflow (M1)", () => {
    const product = loadWorkflow(plugin, "product") as Workflow;
    expect(product.stages.flatMap((s) => s.writes)).not.toContain("existing-system");
  });
});

describe("the orchestrator's step 1b and the Research Role (OP1, OP2; the T6 review notes)", () => {
  const skill = readFileSync(join(plugin, "skills/start/SKILL.md"), "utf8");
  const step = skill.slice(skill.indexOf("## 1b."), skill.indexOf("## 1c."));

  it("writes 2 to 7 neutral questions, in groups, before rereading the request, with no noun of the request (OP1)", () => {
    expect(step).toContain(".aidw/changes/<id>/existing-system/questions.md");
    expect(step).toMatch(/2 to 7 questions/);
    expect(step).toMatch(/before you read the request again/i);
    expect(step).toMatch(/never from a noun of the request/);
    expect(step).toMatch(/## Group <n>/);
  });

  it("spawns one Research Agent per group in one message, then one merging Agent that reads code only where parts disagree (Q3, M10, OP2)", () => {
    expect(step).toMatch(/One Research Agent per group, all in one message/);
    expect(step).toContain("existing-system/part-<n>.md");
    expect(step).toMatch(/merging Agent/);
    expect(step).toMatch(/Read code only where two parts disagree/);
    expect(step).toContain('"Not answered"');
    expect(step).toMatch(/never the request, `intake\.md` or `analysis\.md`/);
  });

  it("skips greenfield and keeps a bugfix or small change to 3 questions and one Agent (M1, M2)", () => {
    expect(step).toMatch(/greenfield project skips/i);
    expect(step).toMatch(/`bugfix`, or a change you expect to be `Size: small`, asks at most 3 questions in one group/);
    expect(step).toMatch(/one Agent writes the report itself/);
  });

  it("makes ## Existing system the report's Summary and points to it (I1, Q1)", () => {
    expect(step).toMatch(/Fill `## Existing system` in `analysis\.md`: the report's Summary word for word/);
    expect(step).toContain("Full report: .aidw/changes/<id>/existing-system.md");
  });

  it("Research restates only the question for codebase-research and never reads the request", () => {
    const role = readFileSync(join(plugin, "roles/research/role.md"), "utf8");
    expect(role).toMatch(/For `codebase-research` restate\s+only the question/);
    expect(role).toMatch(/never `intake\.md`, `analysis\.md`/);
    expect(role).toMatch(/done by the `codebase-research` skill's own Done when/);
    expect(role).not.toMatch(/where the orchestrator names/);
  });

  it("the merge lists a question no part answered under Not answered and reads no other code (OP2)", () => {
    const s = readFileSync(join(plugin, "roles/research/skills/codebase-research.md"), "utf8");
    const merge = s.slice(s.indexOf("## 6. Synthesize"));
    expect(merge).toMatch(/\*\*Not answered\*\*/);
    expect(merge).toMatch(/Read no code for anything else/);
    expect(merge).toMatch(/Summary, Questions, Findings, How it is tested, Code references, Not answered/);
  });

  it("the analysis template asks for the report's Summary under ## Existing system", () => {
    brownfield();
    cli("change", "new", "fresh");
    const text = readFileSync(join(root, ".aidw/changes/fresh/analysis.md"), "utf8");
    expect(text).toMatch(/## Existing system\n\nTODO\(aidw\): brownfield assessment\. The Summary of the Existing System Report[\s\S]*existing-system\.md/);
    expect(YAML.parse(readFileSync(join(root, ".aidw/changes/fresh/change.yaml"), "utf8")).analysis_template).toBe(2);
  });
});
