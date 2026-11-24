import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { parsePage } from "../src/page.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, SCOPE_ROUND, TASKS_YAML, TOKENS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-14-notes-app";
const BRIEF = "# Product brief: Notes\n\n## Vision\n\nA notes app for freelancers who lose track of client calls.\n\n## Scope\n\n- capture a note\n- tag it with a client\n\n## MVP\n\nCapture and tag; search comes later because the first users have few notes.\n\n## Out of scope\n\nSharing and sync.\n";
/** The analysis of the fixture without its scope round: what a product change looks like before the round is recorded. */
const WITHOUT_ROUND = ANALYSIS_MD.replace(SCOPE_ROUND, "");

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}
const change = (root: string) => YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8")) as Record<string, unknown>;

/** A change in analyzing with the whole package in place; `analysis` replaces the fixture's analysis.md. */
function drafted(opts: { workflow?: string | null; analysis?: string } = {}): string {
  const root = tempProject();
  cli(root, "init");
  const wf = opts.workflow === null ? [] : ["--workflow", opts.workflow ?? "product"];
  expect(cli(root, "change", "new", ID, ...wf).code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  write(root, `${c}/analysis.md`, opts.analysis ?? ANALYSIS_MD);
  write(root, ".aidw/design/tokens.yaml", TOKENS_YAML);
  write(root, `${c}/tasks.yaml`, TASKS_YAML);
  write(root, `${c}/quality.yaml`, QUALITY_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing"]) expect(cli(root, "transition", ID, s).code, s).toBe(0);
  return root;
}

describe("the scope of a product change is a round of the discovery interview", () => {
  it("is created with a place for the scope round in the discovery appendix, and no scope gate", () => {
    const root = tempProject();
    cli(root, "init");
    expect(cli(root, "change", "new", ID, "--workflow", "product").code).toBe(0);
    const data = change(root);
    expect(data.scope_gate).toBeUndefined();
    expect(data.scope_approval).toBeUndefined();
    expect(existsSync(join(root, ".aidw/changes", ID, "brief.md"))).toBe(false);
    expect(readFileSync(join(root, ".aidw/changes", ID, "analysis.md"), "utf8")).toMatch(/## Appendix: discovery Q&A[\s\S]*### Scope round\n\nTODO\(aidw\)/);
  });

  it("goes from analyzing straight to the one Approval Gate once the round is recorded", () => {
    const root = drafted();
    const r = cli(root, "transition", ID, "awaiting_approval");
    expect(r.code, r.err).toBe(0);
    const a = cli(root, "approve", ID);
    expect(a.code, a.err).toBe(0);
    expect(a.out).toMatch(/^approved /);
    expect(change(root)).toMatchObject({ state: "approved", approval: { by: "user" } });
  });

  it("refuses the gate while the scope round is not recorded in the analysis", () => {
    const root = drafted({ analysis: WITHOUT_ROUND });
    const r = cli(root, "analyze", ID);
    expect(r.code).toBe(1);
    expect(r.out + r.err).toMatch(/scope round is not recorded: .*### Scope round/);
    expect(cli(root, "transition", ID, "awaiting_approval").code).toBe(1);
  });

  it("names the scope question whose answer is missing from the round", () => {
    const root = drafted({ analysis: ANALYSIS_MD.replace(/^out .*\n/m, "") });
    const r = cli(root, "analyze", ID);
    expect(r.code).toBe(1);
    expect(r.out + r.err).toMatch(/scope round has no answer for "out"/);
  });

  it.each(["feature", "bugfix"])("%s: needs no scope round", (workflow) => {
    const root = drafted({ workflow, analysis: WITHOUT_ROUND });
    const r = cli(root, "analyze", ID);
    expect(r.out + r.err).not.toMatch(/scope round/);
  });
});

describe("the scope page", () => {
  const PAGE = `layout: questions
title: What the notes app does first
kind: scope
role: product-manager
questions:
  - { id: vision, title: Who it is for and what success looks like, suggest: "Freelancers find any client call in seconds" }
  - id: scope
    title: Capabilities in scope
    multi: true
    recommend: [capture, tag]
    why: Search can wait while the first users have few notes.
    options:
      - { key: capture, name: Capture a note, summary: The core job }
      - { key: tag, name: Tag with a client, summary: Find calls by client }
      - { key: search, name: Search, summary: Full-text search }
  - { id: mvp, title: The first cut worth building, suggest: Capture and tag }
  - { id: out, title: Out of scope, suggest: Sharing and sync }
`;

  it("must ask the four scope questions", () => {
    expect(parsePage("scope", PAGE).problems).toEqual([]);
    expect(parsePage("scope", PAGE.replace(/ {2}- \{ id: mvp.*\n/, "")).problems.join("\n")).toMatch(/kind: scope needs the question "mvp"/);
  });

  it("says where its checked answer is recorded", () => {
    const root = tempProject();
    cli(root, "init");
    write(root, ".aidw/run/pages/scope.yaml", PAGE);
    const v = parsePage("scope", PAGE).page.version;
    const r = cli(root, "page", "answers", "scope", "--text", `aidw page scope ${v}\nvision: > Freelancers find any call\nscope: capture, tag\nmvp: > Capture and tag\nout: > Sharing and sync`);
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/^scope Capabilities in scope: capture \(Capture a note\), tag \(Tag with a client\)$/m);
    expect(r.out).toMatch(/NEXT: record these lines word for word under "### Scope round" in the discovery appendix of analysis\.md/);
  });
});

describe("a change left at the old scope gate (awaiting_scope_approval)", () => {
  /** A product change persisted by an older aidw: waiting at the scope gate with an approved-looking brief. */
  function legacy(): string {
    const root = drafted({ analysis: WITHOUT_ROUND });
    const file = join(root, ".aidw/changes", ID, "change.yaml");
    const doc = YAML.parseDocument(readFileSync(file, "utf8"));
    doc.set("state", "awaiting_scope_approval");
    doc.set("scope_gate", true);
    doc.set("scope_approval", null);
    write(root, `.aidw/changes/${ID}/change.yaml`, String(doc));
    write(root, `.aidw/changes/${ID}/brief.md`, BRIEF);
    return root;
  }

  it("continues as discovery: aidw reads it as analyzing", () => {
    const root = legacy();
    const s = cli(root, "status", ID);
    expect(s.code, s.err).toBe(0);
    expect(s.out).toMatch(/analyzing/);
    expect(s.out).not.toMatch(/awaiting_scope_approval/);
    expect(cli(root, "validate", ID).err).not.toMatch(/state/);
  });

  it("goes on to the one Approval Gate without a scope approval, its brief standing in for the scope round", () => {
    const root = legacy();
    const t = cli(root, "transition", ID, "awaiting_approval");
    expect(t.code, t.err).toBe(0);
    expect(change(root).state).toBe("awaiting_approval");
    const a = cli(root, "approve", ID);
    expect(a.code, a.err).toBe(0);
    expect(change(root)).toMatchObject({ state: "approved", approval: { by: "user" } });
  });

  it("is not approved by aidw approve while it is still discovery", () => {
    const root = legacy();
    expect(cli(root, "approve", ID).err).toMatch(/is in state "analyzing"; only "awaiting_approval" can be approved/);
    expect(change(root).state).toBe("awaiting_scope_approval"); // nothing is written by a refused command
  });
});
