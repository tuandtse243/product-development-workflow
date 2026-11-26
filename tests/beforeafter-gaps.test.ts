/**
 * D1, I9 (rpi upgrades T9): the gaps the first tests left open: the 3 and 6 line boundaries on both sides, a deferred
 * question answered outside "## Architecture", a Change created before analysis_template 2 that still goes through
 * the gate and the checks a Deviation re-runs, the bugfix workflow, and the gate page rendered end to end.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { readinessCheck } from "../src/ops.js";
import { pathsFor } from "../src/project.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const ID = "booking-v2";
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, messages: () => (JSON.parse(out).errors as { message: string }[]).map((e) => e.message) };
}
const C = `.aidw/changes/${ID}`;
const analysis = (text: string) => write(root, `${C}/analysis.md`, text);
const changeYaml = () => YAML.parse(readFileSync(join(root, C, "change.yaml"), "utf8")) as Record<string, unknown>;
const DEFERRED_NONE = "### Deferred to architecture\n\nNone\n";
const BEFORE = /### Before\n\n[\s\S]*?(?=### After)/;
const AFTER = /### After\n\n[\s\S]*?(?=## Decisions to honor)/;
const lines = (side: string, n: number) => `### ${side}\n\n${Array.from({ length: n }, (_, i) => `- ${side} line ${i + 1}.`).join("\n")}\n\n`;
const withSides = (before: number, after: number) => ANALYSIS_MD.replace(BEFORE, lines("Before", before)).replace(AFTER, lines("After", after));
/** analysis.md as a Change created before analysis_template 2 wrote it: neither part. */
const OLD_ANALYSIS = ANALYSIS_MD.replace(/## Before \/ After[\s\S]*?(?=## Decisions to honor)/, "").replace(DEFERRED_NONE, "");
const baMessages = (m: string[]) => m.filter((x) => x.includes("Before / After"));

function setup(workflow: string[] = []) {
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
/** Make this a Change created before the template had Before / After and Deferred to architecture. */
function makeOld() {
  const file = join(root, C, "change.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace(/^analysis_template: \d+\n/m, ""));
  analysis(OLD_ANALYSIS);
}
function toGate() {
  planReviewed(root, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const r = cli("transition", ID, s);
    expect(r.code, `${s}: ${r.err}${r.out}`).toBe(0);
  }
}

describe("D1: the line count of Before and of After", () => {
  beforeEach(() => setup());

  it("accepts exactly 3 and exactly 6 lines on either side", () => {
    for (const [b, a] of [[3, 6], [6, 3], [3, 3], [6, 6]] as const) {
      analysis(withSides(b, a));
      const r = cli("analyze", ID);
      expect(r.code, `${b}/${a}: ${r.out}${r.err}`).toBe(0);
    }
  });

  it("refuses 7 lines of Before and 2 of After (the other way round from the first test)", () => {
    analysis(withSides(7, 2));
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"## Before / After": "### Before" has 7 line(s); write 3 to 6, as the user sees it');
    expect(m).toContain('"## Before / After": "### After" has 2 line(s); write 3 to 6, as the user sees it');
  });

  it("refuses a Before / After with no ### After, and one whose sides are prose, not lines", () => {
    analysis(ANALYSIS_MD.replace(/### After\n\n[\s\S]*?(?=## Decisions to honor)/, ""));
    expect(cli("analyze", ID, "--json").messages()).toContain('"## Before / After": missing "### After"');
    analysis(ANALYSIS_MD.replace(BEFORE, "### Before\n\nA patient phones the clinic. Staff write it down. Moving takes another call.\n\n"));
    expect(cli("analyze", ID, "--json").messages()).toContain('"## Before / After": "### Before" has 0 line(s); write 3 to 6, as the user sees it');
  });

  it("refuses the template as written by aidw change new (placeholders are not lines)", () => {
    root = tempProject();
    cli("init");
    expect(cli("change", "new", "fresh").code).toBe(0);
    const r = cli("analyze", "fresh", "--json");
    expect(r.code).not.toBe(0);
    expect(r.messages()).toContain('"## Before / After": "### Before" has 0 line(s); write 3 to 6, as the user sees it');
  });
});

describe("I9: each deferred question is answered in ## Architecture", () => {
  beforeEach(() => setup());
  const DEFERRED_ONE = "### Deferred to architecture\n\n- DA1: Where do reminders get sent from?\n";
  const ANSWER = "- DA1: From a Supabase scheduled function; no extra service.";

  it("does not count an answer written in another section", () => {
    for (const section of ["## Decisions to honor\n\n", "## Stack\n\n", "## Domain\n\n", "## Plan\n\n"]) {
      analysis(ANALYSIS_MD.replace(DEFERRED_NONE, DEFERRED_ONE).replace(section, `${section}${ANSWER}\n\n`));
      const m = cli("analyze", ID, "--json").messages();
      expect(m, section).toContain('"### Deferred to architecture": DA1 has no answer in "## Architecture" (a "- DA1: <answer>" line)');
    }
  });

  it("does not count the question itself, repeated under Deferred to architecture, as its answer", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, `${DEFERRED_ONE}${ANSWER}\n`));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### Deferred to architecture": DA1 has no answer in "## Architecture" (a "- DA1: <answer>" line)');
  });

  it("does not count prose that only names the id", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, DEFERRED_ONE).replace("Next.js app router, Supabase Postgres with RLS.", "Next.js app router, Supabase Postgres with RLS. DA1 is answered by the scheduler."));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### Deferred to architecture": DA1 has no answer in "## Architecture" (a "- DA1: <answer>" line)');
  });

  it("accepts the answer under a ### heading inside ## Architecture", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, DEFERRED_ONE).replace("Next.js app router, Supabase Postgres with RLS.", `Next.js app router, Supabase Postgres with RLS.\n\n### Deferred questions\n\n${ANSWER}`));
    const r = cli("analyze", ID);
    expect(r.code, r.out).toBe(0);
  });

  it("refuses an empty Deferred to architecture (neither lines nor None)", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, "### Deferred to architecture\n\n"));
    expect(cli("analyze", ID, "--json").messages()).toContain('"### Deferred to architecture" must list "- DA<n>: <question>" lines, or say "None"');
  });
});

describe("a Change created before analysis_template 2", () => {
  beforeEach(() => {
    setup();
    makeOld();
  });

  it("reaches the gate, is approved, and still passes validate and the checks a Deviation re-runs", () => {
    toGate();
    const a = cli("approve", ID);
    expect(a.code, a.err + a.out).toBe(0);
    expect(changeYaml().analysis_template).toBeUndefined();
    const v = cli("validate", ID);
    expect(v.code, v.err + v.out).toBe(0);
    // deviation.ts closes a Deviation only when readinessCheck has no errors
    const d = readinessCheck(pathsFor(root), ID);
    expect(d.errors.map((e) => e.message)).toEqual([]);
  });

  it("renders its gate page without a before-after section and without an error", () => {
    toGate();
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).not.toContain('data-sec="before-after"');
    expect(html).toContain('data-sec="scope"');
  });

  it("is not checked on either part, even when it writes them by hand", () => {
    analysis(withSides(7, 1).replace(DEFERRED_NONE, "### Deferred to architecture\n\n- DA1: unanswered?\n"));
    const r = cli("analyze", ID, "--json");
    expect(baMessages(r.messages())).toEqual([]);
    expect(r.messages().join("\n")).not.toMatch(/Deferred to architecture/);
  });
});

describe("a new Change refuses the gate without the two parts", () => {
  it("refuses the move to awaiting_approval when Before / After is missing", () => {
    setup();
    analysis(ANALYSIS_MD.replace(/## Before \/ After[\s\S]*?(?=## Decisions to honor)/, ""));
    planReviewed(root, ID);
    cli("transition", ID, "intake");
    cli("transition", ID, "analyzing");
    const r = cli("transition", ID, "awaiting_approval");
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/missing section "## Before \/ After"/);
    expect(changeYaml().state).toBe("analyzing");
  });
});

describe("the bugfix workflow", () => {
  it("creates its Change with analysis_template >= 2, and its analyze checks both parts", () => {
    setup(["--workflow", "bugfix"]);
    expect(changeYaml().workflow).toBe("bugfix");
    expect(changeYaml().analysis_template).toBeGreaterThanOrEqual(2);
    expect(cli("analyze", ID).code).toBe(0);
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, ""));
    expect(cli("analyze", ID, "--json").messages()).toContain('missing "### Deferred to architecture" (under "## Requirements and scope"): list each technical question as "- DA<n>: <question>", or write "None"');
  });

  it("lets an old bugfix Change through its analyze stage without the two parts", () => {
    setup(["--workflow", "bugfix"]);
    makeOld();
    toGate();
    expect(cli("validate", ID).code).toBe(0);
  });
});

describe("the gate page, end to end through the CLI", () => {
  beforeEach(() => setup());

  it("puts Before / After first, above the open findings and the authored sections, with every line", () => {
    toGate();
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n  - id: risks\n    title: Risks\n    body: None.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    const secs = [...html.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1]);
    expect(secs[0]).toBe("before-after");
    expect(secs.filter((s) => s === "before-after")).toHaveLength(1);
    for (const l of ["A patient phones the clinic and waits on hold to book.", "Staff write the slot in a paper diary.", "Moving an appointment takes another call.", "A patient picks a free slot on their phone.", "The patient reschedules from the same page."]) {
      expect(html).toContain(l);
    }
  });

  it("moves an authored before-after section to the top even when the page lists it last", () => {
    toGate();
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n  - id: before-after\n    title: Before / After\n    body: Written by hand.\n`);
    expect(cli("page", "render", "gate").code).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    const secs = [...html.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1]);
    expect(secs[0]).toBe("before-after");
  });
});
