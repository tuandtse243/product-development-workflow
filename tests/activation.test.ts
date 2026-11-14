import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkArtifacts } from "../src/artifacts.js";
import { checkEvals } from "../src/evals.js";
import { checkRoster, generateAgents, writeAgents } from "../src/roles.js";
import { loadWorkflow } from "../src/workflow.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

describe("activating a planned role", () => {
  it("is data only: delete carried_by, say active, add the knowledge; no CLI code names the role", () => {
    const root = mkdtempSync(join(tmpdir(), "aidw-activate-"));
    temps.push(root);
    for (const f of ["roster.yaml", "tiers.yaml", "artifacts.yaml", "roles", "library", "workflows", "agents"]) cpSync(join(plugin, f), join(root, f), { recursive: true });

    // the profile of a planned role is already a full profile (a header and a Role's own sections); activating drops its Status note
    const file = join(root, "roles", "api-designer", "role.md");
    const text = readFileSync(file, "utf8")
      .replace(/^## Status[\s\S]*?(?=^## )/m, "")
      .replace(/^description: "(.*) Planned role\."$/m, 'description: "$1"');
    writeFileSync(file, text);
    mkdirSync(join(root, "roles", "api-designer", "evals"), { recursive: true });
    writeFileSync(join(root, "roles", "api-designer", "evals", "contract-is-written-once.md"), "---\ncase: contract-is-written-once\n---\n## Input\n\nAn API with two consumers.\n\n## Criteria\n\n- must name each field once\n");
    const roster = join(root, "roster.yaml");
    writeFileSync(roster, readFileSync(roster, "utf8").replace("api-designer: { department: architecture-planning, status: planned, carried_by: software-architect }", "api-designer: { department: architecture-planning, status: active }"));

    expect(Object.keys(generateAgents(root))).toContain("api-designer.md");
    writeAgents(root);
    expect(checkRoster(root).errors.map((e) => e.message)).toEqual([]);
    expect(checkArtifacts(root).errors).toEqual([]);
    expect(checkEvals(root).errors).toEqual([]);
    expect(loadWorkflow(root, "product")).not.toBeNull();
  });
});
