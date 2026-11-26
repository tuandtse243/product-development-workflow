import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsToHonor } from "../src/analyze.js";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TASKS_YAML, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const ID = "booking-d6";
// only the decisions lose their reasons: the settled Design Questions of "## Architecture" keep theirs
const OLD_FORMAT = ANALYSIS_MD.replace(/## Decisions to honor[^]*?(?=## Requirements and scope)/, (honor) => honor.replace(/\n {2}(?:Why|Rejected):.*/g, ""));

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

function project(analysis = ANALYSIS_MD): string {
  const root = tempProject();
  cli(root, "init");
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  cli(root, "change", "new", ID);
  write(root, `.aidw/changes/${ID}/analysis.md`, analysis);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `.aidw/changes/${ID}/tasks.yaml`, TASKS_YAML);
  write(root, `.aidw/changes/${ID}/quality.yaml`, QUALITY_YAML);
  write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  return root;
}

const honor = (body: string, after = "\n## Next\n\nText.\n") => `# Analysis: x\n\n## Decisions to honor\n\n${body}${after}`;

describe("decisionsToHonor reads a decision with its reasons (D6)", () => {
  it("gives the old one-line form exactly as before", () => {
    expect(decisionsToHonor(OLD_FORMAT)).toEqual([
      "D1: Times are stored in UTC and shown in the clinic's timezone.",
      "D2: Booking state lives in Supabase; no client-side cache of slots.",
    ]);
  });

  it("joins the indented Why and Rejected lines of the fixture, Rejected: none included", () => {
    expect(decisionsToHonor(ANALYSIS_MD)).toEqual([
      "D1: Times are stored in UTC and shown in the clinic's timezone. Why: patients book across a daylight-saving change; one stored zone keeps slots comparable. Rejected: clinic local time (a clock change moves booked slots by an hour).",
      "D2: Booking state lives in Supabase; no client-side cache of slots. Why: two patients must never see the same free slot. Rejected: none.",
    ]);
  });

  it("reads CRLF line endings the same as LF", () => {
    const lf = honor("- D1: A.\n  Why: b.\n  Rejected: none\n- D2: C.\n");
    expect(decisionsToHonor(lf.replace(/\n/g, "\r\n"))).toEqual(decisionsToHonor(lf));
    expect(decisionsToHonor(lf)).toEqual(["D1: A. Why: b. Rejected: none", "D2: C."]);
  });

  it("reads indented bullets, tab-indented reasons and bold ids", () => {
    expect(decisionsToHonor(honor("  - D1: A.\n    Why: b.\n    Rejected: c (d).\n  - D2: E.\n"))).toEqual(["D1: A. Why: b. Rejected: c (d).", "D2: E."]);
    expect(decisionsToHonor(honor("* **D1**: A.\n\tWhy: b.\n\tRejected: none\n"))).toEqual(["D1: A. Why: b. Rejected: none"]);
  });

  it("stops at the next heading, even with no blank line before it, and never takes its indented lines", () => {
    expect(decisionsToHonor(honor("- D1: A.\n  Why: b.\n", "## Next\n  Rejected: not this one\n- D9: nor this\n"))).toEqual(["D1: A. Why: b."]);
  });

  it("takes no unindented line and no sub-bullet as part of a decision", () => {
    expect(decisionsToHonor(honor("- D1: A.\nWhy: b.\n"))).toEqual(["D1: A."]);
    expect(decisionsToHonor(honor("- D1: A.\n  - a note\n  Why: b.\n"))).toEqual(["D1: A."]);
  });

  it("gives nothing for a None section", () => {
    expect(decisionsToHonor(honor("None\n", "\n## Next\n\n- D9: x\n  Why: y\n"))).toEqual([]);
  });
});

describe("aidw analyze and validate on decisions without reasons (D6)", () => {
  it("warns once per decision and names only what is missing", () => {
    const root = project(ANALYSIS_MD.replace(/\n {2}Rejected: clinic local time.*/, ""));
    const r = cli(root, "analyze", ID);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/D1 says no "Rejected:"/);
    expect(r.out).not.toMatch(/D1 says no "Why:"/);
    expect(r.out).not.toMatch(/D2 says no/);
  });

  it("accepts the old one-line form in analyze, and fails it only under validate --strict", () => {
    const root = project(OLD_FORMAT);
    const a = cli(root, "analyze", ID);
    expect(a.code, a.out).toBe(0);
    expect(a.out).toMatch(/D1 says no "Why:" and no "Rejected:"/);
    expect(a.out).toMatch(/D2 says no "Why:" and no "Rejected:"/);
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
    expect(cli(root, "validate", ID).code).toBe(0);
    const strict = cli(root, "validate", ID, "--strict");
    expect(strict.code).toBe(1);
    expect(strict.out).toMatch(/D1 says no "Why:"/);
  });

  it("a complete record raises no decision warning under validate --strict", () => {
    const root = project();
    planReviewed(root, ID);
    for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
    expect(cli(root, "validate", ID, "--strict").out).not.toMatch(/Decisions to honor/);
  });
});

describe("the analysis template asks for the reasons (D6)", () => {
  it("a new change's analysis.md asks for Why and Rejected under each decision", () => {
    const root = tempProject();
    cli(root, "init");
    cli(root, "change", "new", ID);
    const t = readFileSync(join(root, ".aidw/changes", ID, "analysis.md"), "utf8");
    const s = t.split("## Decisions to honor")[1]?.split("\n## ")[0] ?? "";
    expect(s).toMatch(/Why: <reason/);
    expect(s).toMatch(/Rejected: <option> \(<why not>\)/);
    expect(s).toMatch(/Rejected: none/);
  });
});

describe("the generated agents carry the new library sections (I6, I10, D5, D6)", () => {
  const agents = readdirSync(join(plugin, "agents")).filter((f) => f.endsWith(".md"));
  const text = (f: string) => readFileSync(join(plugin, "agents", f), "utf8");

  it("every agent that includes author-artifacts has the writing rules", () => {
    const authoring = agents.filter((f) => text(f).includes("After the gate: an upstream brief"));
    expect(authoring.length).toBeGreaterThan(5);
    for (const f of authoring) {
      expect(text(f), f).toMatch(/A sub-heading states the finding/);
      expect(text(f), f).toMatch(/A technical recommendation cites its evidence/);
      expect(text(f), f).toMatch(/^ {2}Rejected: /m);
    }
  });

  it("every agent that includes implement-a-task has the precedence and the three-line mismatch", () => {
    const implementing = agents.filter((f) => text(f).includes("Rules for every implementing Role"));
    expect(implementing.length).toBeGreaterThan(3);
    for (const f of implementing) {
      expect(text(f), f).toMatch(/When documents disagree, the higher one wins/);
      expect(text(f), f).toMatch(/^Why this matters: /m);
      expect(text(f), f).toContain("BLOCKED: documents disagree");
    }
  });
});
