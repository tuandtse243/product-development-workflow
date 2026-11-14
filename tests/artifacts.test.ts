import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkArtifacts, loadArtifacts } from "../src/artifacts.js";
import { loadRoster } from "../src/roles.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

/** A copy of the plugin's organization files that a test may break. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-artifacts-"));
  temps.push(root);
  for (const f of ["roster.yaml", "artifacts.yaml", "roles"]) cpSync(join(plugin, f), join(root, f), { recursive: true });
  return root;
}
const edit = (root: string, file: string, from: string | RegExp, to: string) => {
  const path = join(root, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, to);
  expect(after, `${file} must change`).not.toBe(before);
  writeFileSync(path, after);
};
const errors = (root: string) => checkArtifacts(root).errors.map((e) => `${e.file}: ${e.message}`).join("\n");

describe("the artifact registry of the plugin", () => {
  it("passes its own check, with no warnings", () => {
    const d = checkArtifacts(plugin);
    expect(d.errors).toEqual([]);
    expect(d.warnings).toEqual([]);
  });

  it("gives every artifact exactly one owner that is in the roster", () => {
    const roster = loadRoster(plugin);
    for (const [name, e] of Object.entries(loadArtifacts(plugin) ?? {})) {
      expect(typeof e.owner, name).toBe("string");
      expect(roster.roles[e.owner], name).toBeDefined();
    }
  });

  it("registers the files the approved package is made of", () => {
    const names = Object.keys(loadArtifacts(plugin) ?? {});
    for (const n of ["intake", "domain-model", "requirements", "delta-specs", "design-tokens", "architecture", "constitution", "tasks", "quality", "task-review"]) {
      expect(names, n).toContain(n);
    }
  });
});

describe("artifact ownership", () => {
  it("rejects an owner that is not in the roster", () => {
    const root = copy();
    edit(root, "artifacts.yaml", /(requirements:\n {2}path: [^\n]+\n {2}owner: )product-manager/, "$1ghost");
    expect(errors(root)).toMatch(/artifact requirements: owner "ghost" is not in roster\.yaml/);
  });

  it("rejects an artifact with two owners", () => {
    const root = copy();
    edit(root, "artifacts.yaml", /(requirements:\n {2}path: [^\n]+\n {2}owner: )product-manager/, "$1[product-manager, software-architect]");
    expect(errors(root)).toMatch(/artifact requirements: exactly one Role owns an artifact/);
  });

  it("rejects a Role that writes an artifact another Role owns", () => {
    const root = copy();
    edit(root, "roles/security/role.md", "writes: [layer-review-security, audit-security]", "writes: [layer-review-security, audit-security, architecture]");
    expect(errors(root)).toMatch(/roles\/security\/role\.md: writes: "architecture" is owned by software-architect/);
  });

  it("rejects a reads or writes entry that is not registered", () => {
    const root = copy();
    edit(root, "roles/backend/role.md", /reads: \[/, "reads: [made-up, ");
    expect(errors(root)).toMatch(/roles\/backend\/role\.md: reads: "made-up" is not an artifact/);
  });

  it("rejects reads that is not a list of names", () => {
    const root = copy();
    edit(root, "roles/backend/role.md", /reads: \[[^\]]*\]/, "reads: tasks");
    expect(errors(root)).toMatch(/roles\/backend\/role\.md: reads must be a list of artifact names/);
  });

  it("warns when an owner does not list its artifact under writes", () => {
    const root = copy();
    edit(root, "roles/technical-planner/role.md", "writes: [tasks, analysis-plan]", "writes: [analysis-plan]");
    const d = checkArtifacts(root);
    expect(d.errors).toEqual([]);
    expect(d.warnings.map((w) => w.message).join("\n")).toMatch(/owns "tasks" but does not list it under writes/);
  });
});

describe("artifact entries", () => {
  it("rejects two artifacts that share a path without saying which part each is", () => {
    const root = copy();
    edit(root, "artifacts.yaml", /(analysis-risks:\n {2}path: [^\n]+\n) {2}part: [^\n]+\n/, "$1");
    expect(errors(root)).toMatch(/share the path "changes\/<id>\/analysis\.md": each needs a "part"/);
  });

  it("rejects a path that leaves .aidw/", () => {
    const root = copy();
    edit(root, "artifacts.yaml", "path: constitution.md", "path: ../constitution.md");
    expect(errors(root)).toMatch(/artifact constitution: path "\.\.\/constitution\.md" must stay inside \.aidw\//);
  });

  it("rejects a validation the CLI does not have", () => {
    const root = copy();
    edit(root, "artifacts.yaml", /(tasks:\n {2}path: [^\n]+\n {2}owner: [^\n]+\n {2}validate: )aidw plan/, "$1aidw lint");
    expect(errors(root)).toMatch(/artifact tasks: validate must be one of/);
  });

  it("reports a missing registry", () => {
    const root = copy();
    rmSync(join(root, "artifacts.yaml"));
    expect(errors(root)).toMatch(/artifacts\.yaml: not found/);
  });
});
