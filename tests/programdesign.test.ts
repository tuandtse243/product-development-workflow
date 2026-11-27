/**
 * T12 of the rpi upgrades (ADR-0015; D2, D3, I5, Q2 to Q7, M9): the Software Architect's Design Questions, the system
 * design round after the System Design, and the Program Design that is approved at the gate and binds the code.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { BRIEF_READS } from "../src/briefreads.js";
import { isPackageRel } from "../src/approval.js";
import { loadChange } from "../src/change.js";
import { pathsFor } from "../src/project.js";
import {
  designQuestionsOf,
  fileTreeOf,
  MAX_OPEN_QUESTIONS,
  openQuestions,
  namesPath,
  programDesignChangedPaths,
  programDesignSection,
  systemDesignRoundOf,
} from "../src/programdesign.js";
import { ANALYSIS_MD, MAIN_SPEC, PROGRAM_DESIGN_MD, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "booking-pd";
const C = `.aidw/changes/${ID}`;
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, messages: () => (JSON.parse(out).errors as { message: string }[]).map((e) => e.message), warnings: () => (JSON.parse(out).warnings as { message: string }[]).map((e) => e.message) };
}
const analysis = (text: string) => write(root, `${C}/analysis.md`, text);
const programDesign = (text: string) => writeFileSync(join(root, C, "program-design.md"), text);

const QUESTIONS = /### Design Questions\n\n[\s\S]*?(?=### System design round)/;
const ROUND = /### System design round\n\n[\s\S]*?(?=\n## Specs)/;
const OPEN_DQ = "### Design Questions\n\n- DQ1: Where does the booking rule live?\n  Open: a unique constraint | a check in the API (recommend: a unique constraint)\n\n";
const withQuestions = (block: string) => ANALYSIS_MD.replace(QUESTIONS, block);
const withRound = (block: string) => ANALYSIS_MD.replace(ROUND, block);
const settled = (n: number) =>
  `### Design Questions\n\n${Array.from({ length: n }, (_, i) => `- DQ${i + 1}: Question ${i + 1}?\n  Chosen: a.\n  Why: b.\n  Rejected: none.`).join("\n")}\n\n`;

function setup(workflow: string[] = ["--workflow", "feature"]) {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli("change", "new", ID, ...workflow).code).toBe(0);
  analysis(ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${C}/tasks.yaml`, TASKS_YAML);
  write(root, `${C}/quality.yaml`, QUALITY_YAML);
  write(root, `${C}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
}

beforeEach(() => setup());

describe("a new Change owes the round and the Program Design", () => {
  it("is created with analysis_template 3, and the fixture package passes", () => {
    expect((YAML.parse(readFileSync(join(root, C, "change.yaml"), "utf8")) as Record<string, unknown>).analysis_template).toBe(3);
    const r = cli("analyze", ID);
    expect(r.code, r.out).toBe(0);
  });

  it("asks nothing of a Change created before template 3", () => {
    const file = join(root, C, "change.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^analysis_template: \d+\n/m, "analysis_template: 2\n"));
    analysis(ANALYSIS_MD.replace(QUESTIONS, "").replace(ROUND, ""));
    rmSync(join(root, C, "program-design.md"));
    expect(cli("analyze", ID).code).toBe(0);
  });
});

describe("Design Questions (D2, D6)", () => {
  it("reads open and settled questions, with Chosen, Why and Rejected", () => {
    const qs = designQuestionsOf(ANALYSIS_MD);
    expect(qs?.items).toEqual([
      { id: "DQ1", question: "Where does the booking rule (one patient per slot) live?", open: null, chosen: "a unique constraint in Postgres.", why: "two requests for one slot must never both succeed.", rejected: "a check in the API route (two requests can pass it at once)." },
    ]);
    expect(openQuestions(withQuestions(OPEN_DQ)).map((q) => q.id)).toEqual(["DQ1"]);
    expect(designQuestionsOf("# A\n\n## Architecture\n\nx\n")).toBeNull();
  });

  it("keeps the Why and Rejected after a wrapped Chosen or Open line, and the reasons after a blank line", () => {
    const wrapped = "- DQ1: Where do jobs run?\n  Chosen: a queue worker on the existing Redis,\n    with retries\n  Why: jobs survive a restart.\n  Rejected: cron (a missed run is lost).\n";
    expect(designQuestionsOf(`# A\n\n## Architecture\n\n### Design Questions\n\n${wrapped}`)?.items).toEqual([
      { id: "DQ1", question: "Where do jobs run?", open: null, chosen: "a queue worker on the existing Redis, with retries", why: "jobs survive a restart.", rejected: "cron (a missed run is lost)." },
    ]);
    const open = "- DQ1: Where?\n  Open: a queue | cron\n    (recommend: a queue)\n- DQ2: How?\n\n  Chosen: a.\n  Why: b.\n  Rejected: none.\n";
    const items = designQuestionsOf(`# A\n\n## Architecture\n\n### Design Questions\n\n${open}`)?.items;
    expect(items?.[0]?.open).toBe("a queue | cron (recommend: a queue)");
    expect(items?.[1]).toMatchObject({ chosen: "a.", why: "b.", rejected: "none." });
    analysis(withQuestions(`### Design Questions\n\n${wrapped}\n`));
    expect(cli("analyze", ID, "--json").messages().filter((m) => m.includes("DQ1"))).toEqual([]);
  });

  it("refuses a package without them, and accepts None", () => {
    analysis(ANALYSIS_MD.replace(QUESTIONS, ""));
    expect(cli("analyze", ID, "--json").messages()).toContain('missing "### Design Questions" (under "## Architecture"): list each as "- DQ<n>: <question>" with indented "Chosen:", "Why:" and "Rejected:" lines once settled, or write "None"');
    analysis(withQuestions("### Design Questions\n\nNone\n\n").replace(ROUND, "### System design round\n\nconfirmed: yes, build it as drawn\n"));
    expect(cli("analyze", ID).code).toBe(0);
  });

  it("refuses a question still open at the gate", () => {
    analysis(withQuestions(OPEN_DQ));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### Design Questions": DQ1 is still open: put it to the user in the system design round, then record what was chosen with "Chosen:", "Why:" and "Rejected:"');
  });

  it("refuses a settled question without its reasons, a duplicate id and a bullet without an id", () => {
    analysis(withQuestions("### Design Questions\n\n- DQ1: One?\n  Chosen: a.\n- DQ1: Two?\n  Chosen: b.\n  Why: c.\n  Rejected: none.\n- what about caching?\n\n"));
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"### Design Questions": DQ1 says no "Why:", no "Rejected:": a settled Design Question records what was chosen, why, and why the other options were not ("Rejected: none" when there were none)');
    expect(m).toContain('"### Design Questions": duplicate DQ1');
    expect(m).toContain('"### Design Questions": "- what about caching?" must be "- DQ<n>: <question>"');
  });
});

describe("the system design round (D3, Q1, Q7, M9)", () => {
  it("reads the answer lines and the chat confirmation", () => {
    expect(systemDesignRoundOf(ANALYSIS_MD)).toMatchObject({ answers: ["DQ1"], confirmed: null });
    expect(systemDesignRoundOf(withRound("### System design round\n\n- confirmed: yes, go on\n"))).toMatchObject({ answers: [], confirmed: "yes, go on" });
  });

  it("refuses a normal Change without its round, or with a round that answers nothing", () => {
    analysis(ANALYSIS_MD.replace(ROUND, ""));
    expect(cli("analyze", ID, "--json").messages()).toContain(
      'the system design round is not recorded: ask the open Design Questions on the `system-design` Decision Page (or, with none open, one question in the chat) and record the checked answer under "### System design round" in "## Architecture"',
    );
    analysis(withRound("### System design round\n\nWe talked.\n"));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### System design round" has no answer: a line per question asked ("DQ1 <title>: <answer>"), or "confirmed: <the user\'s reply>" when nothing was open');
  });

  it(`asks at most ${MAX_OPEN_QUESTIONS} questions, and only ones the Design Questions list`, () => {
    const six = Array.from({ length: 6 }, (_, i) => `DQ${i + 1} Question ${i + 1}?: a`).join("\n");
    analysis(withQuestions(settled(6)).replace(ROUND, `### System design round\n\n${six}\n`));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### System design round" asked 6 Design Questions; a round asks at most 5 and the Software Architect settles the rest with its reasons');
    analysis(withRound("### System design round\n\nDQ7 Elsewhere?: b\n"));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### System design round" answers DQ7, which "### Design Questions" does not list');
  });

  it("is not owed by a Size: small Change (Q5)", () => {
    analysis(ANALYSIS_MD.replace("## Summary\n\n", "## Summary\n\nSize: small\n\n").replace(ROUND, ""));
    const r = cli("analyze", ID, "--json");
    expect(r.messages().join("\n")).not.toMatch(/system design round/);
  });

  it("is not owed by a bugfix, which still gets the short Program Design", () => {
    setup(["--workflow", "bugfix"]);
    analysis(ANALYSIS_MD.replace(QUESTIONS, "").replace(ROUND, ""));
    expect(cli("analyze", ID, "--json").messages().join("\n")).not.toMatch(/system design round|Design Questions/);
    rmSync(join(root, C, "program-design.md"));
    expect(cli("analyze", ID, "--json").messages().join("\n")).toMatch(/program-design\.md is missing/);
  });
});

describe("aidw stages: the round and the Program Design stages", () => {
  const toArchitecture = () => {
    for (const s of ["intake", "analyzing"]) expect(cli("transition", ID, s).code).toBe(0);
    for (const s of ["assessment", "discovery", "research", "user-research", "requirements", "design", "architecture"]) {
      const r = cli("stages", "--done", s, "--change", ID);
      expect(r.code, `${s}: ${r.err}`).toBe(0);
    }
  };

  it("names the open Design Questions in the NEXT line, and refuses the round while one is open", () => {
    analysis(withQuestions(OPEN_DQ).replace(ROUND, ""));
    toArchitecture();
    expect(cli("stages", ID).out).toMatch(/NEXT: stage system-design-round \(.*\): roles software-architect; 1 open Design Question\(s\) \(DQ1\): put them on the `system-design` Decision Page; when it is done/);
    const r = cli("stages", "--done", "system-design-round", "--change", ID);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/stage "system-design-round" is done when the system design round is recorded: .*DQ1 is still open/);
  });

  it("with nothing open, asks one question in the chat", () => {
    analysis(ANALYSIS_MD.replace(ROUND, ""));
    toArchitecture();
    expect(cli("stages", ID).out).toMatch(/no Design Question is open: ask one question in the chat \(a summary, the link to the architecture and a View\) and record the reply as "confirmed: <reply>"/);
    analysis(withRound("### System design round\n\nconfirmed: yes\n"));
    expect(cli("stages", "--done", "system-design-round", "--change", ID).code).toBe(0);
  });

  it("refuses more than 5 open questions", () => {
    const open = Array.from({ length: 6 }, (_, i) => `- DQ${i + 1}: Q${i + 1}?\n  Open: a | b`).join("\n");
    analysis(withQuestions(`### Design Questions\n\n${open}\n\n`).replace(ROUND, ""));
    toArchitecture();
    expect(cli("stages", ID).out).toMatch(/6 Design Questions are open \(DQ1, DQ2, DQ3, DQ4, DQ5, DQ6\); at most 5: spawn the Software Architect again to settle the rest/);
    expect(cli("stages", "--done", "system-design-round", "--change", ID).err).toMatch(/6 Design Questions are open .*a round asks at most 5/);
  });

  it("lets a small Change report the round without one", () => {
    analysis(ANALYSIS_MD.replace("## Summary\n\n", "## Summary\n\nSize: small\n\n").replace(ROUND, ""));
    toArchitecture();
    expect(cli("stages", ID).out).toMatch(/Size: small has no system design round: report the stage done/);
    expect(cli("stages", "--done", "system-design-round", "--change", ID).code).toBe(0);
  });

  it("refuses the Program Design stage until its required parts are written", () => {
    toArchitecture();
    expect(cli("stages", "--done", "system-design-round", "--change", ID).code).toBe(0);
    expect(cli("stages", "--done", "contracts", "--change", ID).code).toBe(0);
    programDesign("# Program Design\n\n## File tree\n\n```text\n+ lib/x.ts\n```\n");
    expect(cli("stages", "--done", "program-design", "--change", ID).err).toMatch(/stage "program-design" is done when the Program Design has its required parts: missing "## Signatures and contracts"/);
    programDesign(PROGRAM_DESIGN_MD);
    expect(cli("stages", "--done", "program-design", "--change", ID).code).toBe(0);
    expect(cli("stages", ID).out).toMatch(/NEXT: stage plan /);
  });
});

describe("program-design.md (I5, Q2, Q3)", () => {
  it("reads the marked lines of the file tree", () => {
    expect(fileTreeOf(PROGRAM_DESIGN_MD)).toEqual([
      { mark: "+", path: "app/api/bookings/route.ts" },
      { mark: "+", path: "app/(site)/book/page.tsx" },
    ]);
  });

  it("refuses a missing file, and a file without its required parts", () => {
    rmSync(join(root, C, "program-design.md"));
    expect(cli("analyze", ID, "--json").messages()).toContain(
      'program-design.md is missing: the Software Architect writes the Program Design ("## File tree" and "## Signatures and contracts") after the system design round (/aidw:start step 6)',
    );
    programDesign("# Program Design\n\n## File tree\n\nWe add a route.\n\n## Signatures and contracts\n\nA PATCH handler.\n\n## Call trees\n\nTODO(aidw)\n");
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"## File tree" marks no file: one path from the project root per line in a fenced block, "+ <path>" new, "~ <path>" changed, "- <path>" removed');
    expect(m).toContain('"## Signatures and contracts" shows no code: put each signature or contract in a fenced block (a diff for a shape that exists, the full shape for new code)');
    expect(m).toContain("unresolved TODO(aidw) placeholder");
  });

  it("compares the file tree with today's code before the gate (diffs for existing shapes, Q3)", () => {
    write(root, "lib/booking/repo.ts", "export const x = 1;\n");
    programDesign(
      "# Program Design\n\n## File tree\n\n```text\n~ lib/booking/repo.ts   moves an appointment\n- lib/gone.ts\n+ lib/booking/repo.ts\n```\n\n## Signatures and contracts\n\n```ts\nexport function moveAppointment(id: string): void\n```\n",
    );
    const r = cli("analyze", ID, "--json");
    expect(r.messages()).toContain('"## File tree" marks lib/gone.ts removed, but it does not exist; mark a new file "+"');
    expect(r.warnings()).toContain('"## File tree" marks lib/booking/repo.ts new, but it exists; mark it "~" and show the change as a diff');
    expect(r.warnings()).toContain('"## Signatures and contracts": the file tree changes existing files (~) but no block is a diff; show a changed shape as a ```diff block');
  });

  it("gives a small Change the short version (Q5)", () => {
    analysis(ANALYSIS_MD.replace("## Summary\n\n", "## Summary\n\nSize: small\n\n"));
    programDesign(`${PROGRAM_DESIGN_MD}\n## Call trees\n\n\`\`\`text\nPATCH -> moveAppointment\n\`\`\`\n`);
    expect(cli("analyze", ID, "--json").warnings()).toContain('Size: small gets the short Program Design (file tree and signatures); "## Call trees" can go');
  });
});

describe("the gate shows the Program Design (Q4)", () => {
  it("builds a section of Views from program-design.md", () => {
    const s = programDesignSection(`${PROGRAM_DESIGN_MD}\n## Call trees\n\n\`\`\`text\nPATCH -> moveAppointment\n\`\`\`\n`, ID);
    expect(s?.id).toBe("program-design");
    expect(s?.body).toMatch(/code that differs from it is a Deviation/);
    expect(s?.views?.map((v) => v.kind)).toEqual(["tree", "diff", "calltree"]);
    expect(s?.views?.[1]?.text.split("\n")[0]).toBe("+// app/api/bookings/route.ts");
    expect(programDesignSection(null, ID)).toBeNull();
  });

  it("is added to the gate page, unless the page writes its own", () => {
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    expect(cli("page", "render", "gate").code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).toMatch(/data-sec="program-design"/);
    expect(html).toMatch(/app\/api\/bookings\/route\.ts/);
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: program-design\n    title: Program Design\n    body: Written by hand.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    expect(readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8")).toMatch(/Written by hand/);
  });
});

describe("code that differs from the approved Program Design is a Deviation (Q4)", () => {
  it("is part of the package from version 4, and an edit after approval is drift", () => {
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli("transition", ID, s).code).toBe(0);
    const a = cli("approve", ID, "--json");
    expect(a.code, a.out).toBe(0);
    expect(JSON.parse(a.out).files).toContain(`${C}/program-design.md`);
    const p = pathsFor(root);
    const change = loadChange(p, ID);
    expect((change.data.approval as { package: number }).package).toBe(4);
    expect(isPackageRel(p, change, `${C}/program-design.md`)).toBe(true);
    expect(isPackageRel(p, change, `${C}/program-design.md`, 3)).toBe(false);
    programDesign(`${PROGRAM_DESIGN_MD}\n<!-- changed -->\n`);
    expect(cli("approval", "check", ID).code).toBe(1);
  });

  it("names the paths a change concerns, so only the tasks that build them run again", () => {
    const after = PROGRAM_DESIGN_MD.replace("+ app/(site)/book/page.tsx", "~ app/(site)/book/page.tsx");
    expect(programDesignChangedPaths(PROGRAM_DESIGN_MD, after)).toEqual(["app/(site)/book/page.tsx"]);
    const sig = PROGRAM_DESIGN_MD.replace("Promise<Response>;", "Promise<Response | null>;");
    expect(programDesignChangedPaths(PROGRAM_DESIGN_MD, sig)).toEqual(["app/api/bookings/route.ts"]);
    const prose = `${PROGRAM_DESIGN_MD}\n## Pseudocode\n\n\`\`\`text\nlock the slot, then write\n\`\`\`\n`;
    expect(programDesignChangedPaths(PROGRAM_DESIGN_MD, prose)).toBeNull();
  });

  it("matches a path only as a whole path, never inside a longer one", () => {
    expect(namesPath("see app/a.ts.", "app/a.ts")).toBe(true);
    expect(namesPath("// app/a.ts\nexport function f()", "app/a.ts")).toBe(true);
    expect(namesPath("// app/a.tsx", "app/a.ts")).toBe(false);
    expect(namesPath("// lib/app/a.ts", "app/a.ts")).toBe(false);
    expect(namesPath("app/a.ts/index", "app/a.ts")).toBe(false);
    const before = "# P\n\n## File tree\n\n```text\n+ app/a.ts\n+ app/a.tsx\n```\n\n## Signatures and contracts\n\n```ts\n// app/a.tsx\nexport function A(): JSX.Element\n```\n";
    expect(programDesignChangedPaths(before, before.replace("A(): JSX.Element", "A(p: Props): JSX.Element"))).toEqual(["app/a.tsx"]);
  });

  it("is read by the code reviewer, whose task review blocks on a file or signature that differs from it", () => {
    const plugin = join(__dirname, "..", "plugins", "aidw");
    const role = readFileSync(join(plugin, "roles", "code-reviewer", "role.md"), "utf8");
    expect(/^reads: \[(.*)\]$/m.exec(role)?.[1]?.split(", ")).toContain("program-design");
    const skill = readFileSync(join(plugin, "roles", "code-reviewer", "skills", "task-review.md"), "utf8");
    expect(skill).toMatch(/\*\*Program Design\*\*/);
    expect(skill).toMatch(/missing or differs is a\s+blocking finding unless a closed Deviation/);
  });

  it("is in every implementing task's brief", () => {
    expect(BRIEF_READS.find((r) => r.name === "program-design")?.what).toMatch(/code that differs from it is a Deviation/);
  });
});

describe("fenced blocks of program-design.md", () => {
  it("keeps a longer fence open across shorter or indented fence lines inside it", () => {
    const tree = "# P\n\n## File tree\n\n````\n+ a.ts\n```\n+ b.ts\n```\n+ c.ts\n    ````\n+ d.ts\n````\n+ e.ts\n";
    expect(fileTreeOf(tree).map((l) => l.path)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(fileTreeOf("# P\n\n## File tree\n\n~~~\n+ a.ts\n```\n+ b.ts\n~~~ x\n+ c.ts\n~~~~\n").map((l) => l.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
