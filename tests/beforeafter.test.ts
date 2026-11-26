import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { beforeAfterOf, beforeAfterSection, deferredOf } from "../src/beforeafter.js";
import { parsePage } from "../src/page.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "booking-v2";
let root: string;

function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, messages: () => (JSON.parse(out).errors as { message: string }[]).map((e) => e.message) };
}
const analysis = (text: string) => write(root, `.aidw/changes/${ID}/analysis.md`, text);
const DEFERRED_NONE = "### Deferred to architecture\n\nNone\n";
const DEFERRED_TWO = "### Deferred to architecture\n\n- DA1: Can the clinic's phone system push a missed-call event?\n- DA2: Where do reminders get sent from?\n";

beforeEach(() => {
  root = tempProject();
  cli("init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli("change", "new", ID);
  analysis(ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
});

describe("a new Change owes Before / After and Deferred to architecture", () => {
  it("is created with analysis_template 2 and both places in its analysis.md", () => {
    root = tempProject();
    cli("init");
    expect(cli("change", "new", "fresh").code).toBe(0);
    const dir = join(root, ".aidw/changes/fresh");
    expect((YAML.parse(readFileSync(join(dir, "change.yaml"), "utf8")) as Record<string, unknown>).analysis_template).toBe(2);
    const text = readFileSync(join(dir, "analysis.md"), "utf8");
    expect(text).toMatch(/## Summary[\s\S]*## Before \/ After\n\n### Before\n\nTODO\(aidw\)[\s\S]*### After\n\nTODO\(aidw\)[\s\S]*## Decisions to honor/);
    expect(text).toMatch(/## Requirements and scope[\s\S]*### Deferred to architecture\n\nTODO\(aidw\)[\s\S]*## Domain/);
  });

  it("passes the fixture package, which has both", () => {
    const r = cli("analyze", ID);
    expect(r.code, r.out).toBe(0);
  });

  it("refuses a package without Before / After", () => {
    analysis(ANALYSIS_MD.replace(/## Before \/ After[\s\S]*?(?=## Decisions to honor)/, ""));
    expect(cli("analyze", ID, "--json").messages()).toContain('missing section "## Before / After" (### Before and ### After, 3 to 6 lines each, as the user sees it)');
  });

  it("counts the lines of Before and of After: 3 to 6 each", () => {
    analysis(ANALYSIS_MD.replace("- Moving an appointment takes another call.\n", "").replace("### After\n\n", "### After\n\n- a\n- b\n- c\n- d\n"));
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"## Before / After": "### Before" has 2 line(s); write 3 to 6, as the user sees it');
    expect(m).toContain('"## Before / After": "### After" has 7 line(s); write 3 to 6, as the user sees it');
  });

  it("draws Before from the Existing System Report when the Change has one", () => {
    write(root, `.aidw/changes/${ID}/existing-system.md`, "# Existing system\n");
    expect(cli("analyze", ID, "--json").messages()).toContain('"## Before / After": this Change has an Existing System Report; "### Before" must draw from it and name existing-system.md');
    analysis(ANALYSIS_MD.replace("### Before\n\n", "### Before\n\nFrom existing-system.md.\n\n"));
    expect(cli("analyze", ID).code).toBe(0);
  });

  it("refuses a package without Deferred to architecture, and accepts None", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, ""));
    expect(cli("analyze", ID, "--json").messages()).toContain('missing "### Deferred to architecture" (under "## Requirements and scope"): list each technical question as "- DA<n>: <question>", or write "None"');
  });

  it("wants each deferred question answered in ## Architecture by its id", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, DEFERRED_TWO).replace("Next.js app router, Supabase Postgres with RLS.", "Next.js app router, Supabase Postgres with RLS.\n\n- DA1: No; the phone system has no API, so staff add missed calls by hand."));
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"### Deferred to architecture": DA2 has no answer in "## Architecture" (a "- DA2: <answer>" line)');
    expect(m.join("\n")).not.toMatch(/DA1 has no answer/);
  });

  it("refuses a deferred line without an id, and a duplicate id", () => {
    analysis(ANALYSIS_MD.replace(DEFERRED_NONE, "### Deferred to architecture\n\n- DA1: one?\n- DA1: two?\n- what about caching?\n"));
    const m = cli("analyze", ID, "--json").messages();
    expect(m).toContain('"### Deferred to architecture": duplicate DA1');
    expect(m).toContain('"### Deferred to architecture": "- what about caching?" must be "- DA<n>: <question>"');
  });

  it("does not ask a Change created before the template had them", () => {
    const file = join(root, `.aidw/changes/${ID}/change.yaml`);
    write(root, `.aidw/changes/${ID}/change.yaml`, readFileSync(file, "utf8").replace(/^analysis_template: 2\n/m, ""));
    analysis(ANALYSIS_MD.replace(/## Before \/ After[\s\S]*?(?=## Decisions to honor)/, "").replace(DEFERRED_NONE, ""));
    expect(cli("analyze", ID).code).toBe(0);
  });
});

describe("reading the two parts", () => {
  it("reads the Before and After lines", () => {
    expect(beforeAfterOf(ANALYSIS_MD)).toMatchObject({
      before: ["A patient phones the clinic and waits on hold to book.", "Staff write the slot in a paper diary.", "Moving an appointment takes another call."],
      after: ["A patient picks a free slot on their phone.", "The booking shows in the staff's slot list at once.", "The patient reschedules from the same page."],
    });
    expect(beforeAfterOf("# A\n\n## Summary\n\nx\n")).toBeNull();
  });

  it("reads the deferred questions, or None", () => {
    expect(deferredOf(ANALYSIS_MD)).toMatchObject({ none: true, items: [] });
    expect(deferredOf(ANALYSIS_MD.replace(DEFERRED_NONE, DEFERRED_TWO))?.items.map((x) => x.id)).toEqual(["DA1", "DA2"]);
    expect(deferredOf("# A\n")).toBeNull();
  });
});

describe("the gate page puts Before / After first", () => {
  it("builds the section from analysis.md", () => {
    const s = beforeAfterSection(ANALYSIS_MD);
    expect(s?.id).toBe("before-after");
    expect(s?.points[0]).toBe("**Before**: A patient phones the clinic and waits on hold to book.");
    expect(s?.points[3]).toBe("**After**: A patient picks a free slot on their phone.");
  });

  it("orders a before-after section first, above the CLI's lead sections", () => {
    const lead = [{ id: "open-findings", title: "Open findings", body: "x", points: [], html: "" }];
    const src = "layout: gate\ntitle: Approve\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n  - id: before-after\n    title: Before / After\n    points: [a]\n";
    expect(parsePage("gate", src, [], lead).page.sections.map((s) => s.id)).toEqual(["before-after", "open-findings", "scope"]);
  });

  it("is added by the CLI from analysis.md when the page does not author it", () => {
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html.indexOf('data-sec="before-after"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-sec="before-after"')).toBeLessThan(html.indexOf('data-sec="scope"'));
    expect(html).toMatch(/A patient phones the clinic/);
  });

  it("keeps the page's own before-after section and adds none", () => {
    write(root, ".aidw/run/pages/gate.yaml", `layout: gate\ntitle: Approve\nchange: ${ID}\nsections:\n  - id: scope\n    title: Scope\n    body: Booking.\n  - id: before-after\n    title: Before / After\n    body: Written by hand.\n`);
    const r = cli("page", "render", "gate");
    expect(r.code, r.err).toBe(0);
    const html = readFileSync(join(root, ".aidw/run/pages/gate.html"), "utf8");
    expect(html).toMatch(/Written by hand/);
    expect(html).not.toMatch(/A patient phones the clinic/);
  });
});
