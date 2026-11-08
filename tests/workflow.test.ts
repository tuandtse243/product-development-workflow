import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { ANALYSIS_MD, MAIN_SPEC, REQ, TASKS_YAML, tempProject, write } from "./fixtures.js";

const ID = "2026-11-08-booking";

function cli(root: string, ...argv: string[]) {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", root], {}, root, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

function changeYaml(root: string) {
  return YAML.parse(readFileSync(join(root, ".aidw/changes", ID, "change.yaml"), "utf8"));
}

/** A project with one change whose Analysis package is complete. */
function readyProject(): string {
  const root = tempProject();
  expect(cli(root, "init").code).toBe(0);
  write(root, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(root, "change", "new", ID, "--title", "Booking", "--input-type", "upwork_jd").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(root, `${c}/analysis.md`, ANALYSIS_MD);
  write(root, `${c}/tasks.yaml`, TASKS_YAML);
  write(root, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) expect(cli(root, "transition", ID, s).code).toBe(0);
  return root;
}

describe("aidw workflow", () => {
  let root: string;
  beforeEach(() => {
    root = readyProject();
  });

  it("init refuses to overwrite an existing .aidw/", () => {
    const r = cli(root, "init");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/already exists/);
  });

  it("refuses awaiting_approval for an incomplete package", () => {
    const other = tempProject();
    cli(other, "init");
    cli(other, "change", "new", "x");
    cli(other, "transition", "x", "intake");
    cli(other, "transition", "x", "analyzing");
    const r = cli(other, "transition", "x", "awaiting_approval", "--json");
    expect(r.code).toBe(1);
    const messages = r.json().errors.map((e: { message: string }) => e.message);
    expect(messages).toContain('state "awaiting_approval" requires tasks.yaml');
    expect(messages).toContain("unresolved TODO(aidw) placeholder");
    expect(messages).toContain('"## Stack" must declare "Source: client | ai | fallback"');
    expect(YAML.parse(readFileSync(join(other, ".aidw/changes/x/change.yaml"), "utf8")).state).toBe("analyzing");
  });

  it("approve -> execute keeps approval valid while tasks progress", () => {
    const a = cli(root, "approve", ID, "--json");
    expect(a.code).toBe(0);
    expect(a.json().files).toEqual([
      ".aidw/changes/2026-11-08-booking/analysis.md",
      ".aidw/changes/2026-11-08-booking/intake.md",
      ".aidw/changes/2026-11-08-booking/specs/booking/spec.md",
      ".aidw/changes/2026-11-08-booking/tasks.yaml",
      ".aidw/constitution.md",
    ]);
    expect(changeYaml(root)).toMatchObject({ state: "approved", approval: { by: "user" } });
    expect(cli(root, "transition", ID, "executing").code).toBe(0);

    // execution progress is not drift
    const tasks = join(root, ".aidw/changes", ID, "tasks.yaml");
    writeFileSync(tasks, readFileSync(tasks, "utf8").replace("status: pending", "status: done\n    attempts: 1"));
    expect(cli(root, "approval", "check", ID).code).toBe(0);
    // neither is a converge-added task
    writeFileSync(
      tasks,
      `${readFileSync(tasks, "utf8")}  - id: T03\n    title: gap\n    role: qa-engineer\n    origin: converge\n    touches: ["e2e/**"]\n    verify: ["x"]\n`,
    );
    expect(cli(root, "approval", "check", ID).code).toBe(0);
    expect(cli(root, "validate", ID).code).toBe(0);
  });

  it("treats domain, architecture and requirements as part of the approved package", () => {
    write(root, ".aidw/domain/model.md", "# Domain\n");
    cli(root, "approve", ID);
    expect(cli(root, "approval", "check", ID, "--json").json().files).toContain(".aidw/domain/model.md");
    write(root, ".aidw/domain/model.md", "# Domain\n\nA new entity appeared during execution.\n");
    expect(cli(root, "approval", "check", ID).code).toBe(1);
    write(root, ".aidw/decisions/0009-impl.md", "# Implementation detail\n");
    write(root, ".aidw/domain/model.md", "# Domain\n");
    expect(cli(root, "approval", "check", ID).code).toBe(0);
  });

  it("detects drift when the approved package changes and blocks further transitions", () => {
    cli(root, "approve", ID);
    cli(root, "transition", ID, "executing");
    write(root, `.aidw/changes/${ID}/analysis.md`, "# Analysis\n\nSummary, quietly widened scope.\n");

    const check = cli(root, "approval", "check", ID);
    expect(check.code).toBe(1);
    expect(check.out).toMatch(/APPROVAL DRIFT/);
    expect(cli(root, "validate", ID).out).toMatch(/approval drift/);
    const t = cli(root, "transition", ID, "verifying");
    expect(t.code).toBe(1);
    expect(t.err).toMatch(/approval drift/);

    // the way back: escalate -> analyzing clears the stale approval
    expect(cli(root, "transition", ID, "escalated").code).toBe(0);
    expect(cli(root, "transition", ID, "analyzing").code).toBe(0);
    expect(changeYaml(root).approval).toBeNull();
  });

  it("only approves from awaiting_approval and never via transition", () => {
    expect(cli(root, "transition", ID, "approved").err).toMatch(/use `aidw approve`/);
    cli(root, "approve", ID);
    expect(cli(root, "approve", ID).err).toMatch(/only "awaiting_approval" can be approved/);
  });

  it("pauses and resumes to the state it paused from", () => {
    cli(root, "approve", ID);
    cli(root, "transition", ID, "executing");
    expect(cli(root, "transition", ID, "paused", "--reason", "rate_limit").code).toBe(0);
    expect(changeYaml(root).run.paused).toMatchObject({ from: "executing", reason: "rate_limit" });
    expect(cli(root, "status", "--json").json().changes[0]).toMatchObject({ state: "paused", paused: { reason: "rate_limit" } });
    const r = cli(root, "transition", ID, "resume");
    expect(r.out).toMatch(/paused -> executing/);
    expect(changeYaml(root).run.paused).toBeNull();
  });

  it("rejects transitions outside the state machine", () => {
    const r = cli(root, "transition", ID, "deploying");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/cannot go from "awaiting_approval" to "deploying"/);
  });

  it("merge is a dry run unless --write", () => {
    const spec = join(root, ".aidw/specs/booking/spec.md");
    const dry = cli(root, "merge", ID);
    expect(dry.out).toMatch(/dry run/);
    expect(dry.out).toMatch(/booking: \+1 added/);
    expect(readFileSync(spec, "utf8")).toBe(MAIN_SPEC);
    expect(cli(root, "merge", ID, "--write").code).toBe(0);
    expect(readFileSync(spec, "utf8")).toContain("### Requirement: Reschedule appointment");
  });

  it("archives a delivered change: merges specs and moves the folder", () => {
    cli(root, "approve", ID);
    for (const s of ["executing", "verifying", "converging", "deploying", "delivered"]) {
      expect(cli(root, "transition", ID, s).code).toBe(0);
    }
    const r = cli(root, "archive", ID, "--json");
    expect(r.code).toBe(0);
    expect(r.json().archived).toBe(`.aidw/archive/${ID}`);
    expect(existsSync(join(root, ".aidw/changes", ID))).toBe(false);
    const archived = YAML.parse(readFileSync(join(root, ".aidw/archive", ID, "change.yaml"), "utf8"));
    expect(archived.state).toBe("archived");
    expect(readFileSync(join(root, ".aidw/specs/booking/spec.md"), "utf8")).toContain("Reschedule appointment");
    expect(cli(root, "validate", "--strict").code).toBe(0);
  });

  it("refuses to archive before delivery and writes nothing on merge failure", () => {
    expect(cli(root, "archive", ID).err).toMatch(/only "delivered" changes can be archived/);
    write(root, `.aidw/changes/${ID}/specs/booking/spec.md`, `## MODIFIED Requirements\n\n${REQ("Missing one")}`);
    const r = cli(root, "merge", ID, "--write");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/nothing was written/);
    expect(readFileSync(join(root, ".aidw/specs/booking/spec.md"), "utf8")).toBe(MAIN_SPEC);
  });

  it("flags delta files in the wrong place", () => {
    write(root, `.aidw/changes/${ID}/specs/booking.md`, "## ADDED Requirements\n");
    expect(cli(root, "validate", ID).out).toMatch(/must live at specs\/<capability>\/spec.md/);
  });
});

describe("bundled bin", () => {
  it("runs as a standalone executable", () => {
    const bin = resolve("plugins/aidw/bin/aidw");
    const root = tempProject();
    execFileSync(bin, ["init"], { cwd: root });
    const out = execFileSync(bin, ["status", "--json"], { cwd: root, encoding: "utf8" });
    expect(JSON.parse(out).specs).toEqual({ capabilities: 0, requirements: 0 });
    const grilling = execFileSync(bin, ["vendor-path", "pocock/grilling"], { cwd: root, encoding: "utf8" }).trim();
    expect(grilling).toBe(resolve("plugins/aidw/vendor/pocock/grilling/SKILL.md"));
    const pool = execFileSync(bin, ["plugin-path", "profiles/stack-pool.md"], { cwd: root, encoding: "utf8" }).trim();
    expect(existsSync(pool)).toBe(true);
    const gate = execFileSync(bin, ["gate"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "src/x.ts" }, cwd: root }),
    });
    expect(JSON.parse(gate).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(readdirSync(join(root, ".aidw")).sort()).toEqual(
      [".gitignore", "architecture", "archive", "changes", "constitution.md", "decisions", "design", "domain", "project.yaml", "requirements", "run", "specs"].sort(),
    );
  });
});
