import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agentRole } from "../src/gate.js";
import { AGENTS, checkRoster, generateAgents, loadRole, loadRoster, loadTiers, renderAgent, writeAgents } from "../src/roles.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

/** A copy of the plugin's organization files that a test may break. */
function copy(): string {
  const root = mkdtempSync(join(tmpdir(), "aidw-roles-"));
  temps.push(root);
  for (const f of ["roster.yaml", "tiers.yaml", "roles", "agents", "library"]) cpSync(join(plugin, f), join(root, f), { recursive: true });
  return root;
}
const messages = (root: string) => checkRoster(root).errors.map((e) => `${e.file}: ${e.message}`);

describe("the roster", () => {
  it("ignores a hidden folder in roles/ (a tool's marker is not a Role)", () => {
    const root = copy();
    mkdirSync(join(root, "roles", ".claude"), { recursive: true });
    expect(messages(root).join("\n")).not.toMatch(/\.claude/);
  });

  it("declares 21 roles in four departments, all of them active, every one with a profile", () => {
    const roster = loadRoster(plugin);
    const entries = Object.values(roster.roles);
    expect(entries).toHaveLength(21);
    expect(Object.keys(roster.departments)).toHaveLength(4);
    expect(Object.entries(roster.roles).filter(([, e]) => e.status === "active").map(([id]) => id).sort()).toEqual(
      ["api-designer", "backend", "business-analyst", "code-reviewer", "database", "database-architect", "devops", "documentation", "frontend", "fullstack", "integration", "performance", "product-manager", "qa", "release", "research", "security", "software-architect", "technical-planner", "ui-ux-designer", "ux-research"],
    );
  });

  it("every role of the roster has a profile, active or planned", () => {
    for (const id of Object.keys(loadRoster(plugin).roles)) expect(loadRole(plugin, id), id).not.toBeNull();
  });

  it("passes its own check, with the plugin's agents up to date", () => {
    expect(messages(plugin)).toEqual([]);
  });

  it("every planned role names who carries its work", () => {
    for (const [id, e] of Object.entries(loadRoster(plugin).roles)) {
      if (e.status === "planned") expect(e.carried_by, id).toBeTruthy();
    }
  });

  it("rejects a planned role carried by a role that is not active", () => {
    const root = copy();
    const file = join(root, "roster.yaml");
    // no Role is planned today: make two planned, one carried by the other
    writeFileSync(file, readFileSync(file, "utf8").replace("qa: { department: quality-delivery, status: active }", "qa: { department: quality-delivery, status: planned, carried_by: cli }").replace("research: { department: product-analysis, status: active }", "research: { department: product-analysis, status: planned, carried_by: qa }"));
    expect(messages(root).join("\n")).toMatch(/carried_by "qa" must be an active role/);
  });

  it("rejects a role folder that the roster does not list", () => {
    const root = copy();
    cpSync(join(root, "roles", "security"), join(root, "roles", "ghost"), { recursive: true });
    expect(messages(root).join("\n")).toMatch(/role "ghost" has a folder but is not in roster\.yaml/);
  });
});

describe("role profiles", () => {
  it("rejects a profile with an unknown access, and status kept outside the roster", () => {
    const root = copy();
    const file = join(root, "roles", "security", "role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("access: read-only", "access: anything\nstatus: active"));
    const out = messages(root).join("\n");
    expect(out).toMatch(/access must be one of write, artifacts, read-only/);
    expect(out).toMatch(/"status" belongs in roster\.yaml/);
  });

  it("every active role has a profile", () => {
    for (const [id, e] of Object.entries(loadRoster(plugin).roles)) {
      if (e.status === "active") expect(loadRole(plugin, id), id).not.toBeNull();
    }
    expect(checkRoster(plugin).warnings).toEqual([]);
  });

  it("the roles that draft before approval use the artifacts access, the implementing roles write", () => {
    for (const id of ["product-manager", "software-architect", "technical-planner"]) expect(loadRole(plugin, id), id).toMatchObject({ access: "artifacts" });
    for (const id of ["fullstack", "frontend", "backend", "database", "devops", "integration"]) expect(loadRole(plugin, id), id).toMatchObject({ access: "write", mode: "worker" });
  });

  it("reports a header that is not valid YAML instead of crashing", () => {
    const root = copy();
    const file = join(root, "roles", "security", "role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^description: .*$/m, "description: Reviews a change: nothing else"));
    expect(messages(root).join("\n")).toMatch(/roles\/security\/role\.md: expected a valid YAML header/);
  });

  it("the profile of each existing agent keeps its tools and tier", () => {
    expect(loadRole(plugin, "fullstack")).toMatchObject({ mode: "worker", tier: "deep", access: "write", tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"], max_turns: 100 });
    for (const id of ["code-reviewer", "security", "ui-ux-designer"]) expect(loadRole(plugin, id)).toMatchObject({ tier: "standard", access: "read-only" });
  });
});

describe("generated agents", () => {
  it("one agent file per active role that has a profile", () => {
    expect(Object.keys(generateAgents(plugin)).sort()).toEqual(["api-designer.md", "backend.md", "business-analyst.md", "code-reviewer.md", "database.md", "database-architect.md", "devops.md", "documentation.md", "frontend.md", "fullstack.md", "integration.md", "performance.md", "product-manager.md", "qa.md", "release.md", "research.md", "security.md", "software-architect.md", "technical-planner.md", "ui-ux-designer.md", "ux-research.md"].sort());
  });

  it("the three implementing roles share one procedure instead of copying it", () => {
    const tiers = loadTiers(plugin);
    const shared = loadRole(plugin, "fullstack")!.shared[0]!;
    expect(shared).toMatch(/finish by running it on the files you changed/);
    for (const id of ["fullstack", "frontend", "backend"]) {
      const agent = renderAgent(loadRole(plugin, id)!, tiers);
      expect(agent, id).toContain(shared);
      expect(readFileSync(join(plugin, "roles", id, "role.md"), "utf8"), id).not.toContain("finish by running it");
    }
  });

  it("a role's skills are listed in its agent with how to read them", () => {
    const agent = renderAgent(loadRole(plugin, "technical-planner")!, loadTiers(plugin));
    expect(agent).toMatch(/## Skills \(load only when the work needs one\)/);
    expect(agent).toContain("aidw plugin-path roles/technical-planner/skills/<name>.md");
    expect(agent).toMatch(/- `migration-tasks`: when a task adds or changes a database migration/);
  });

  it("flags a skill without a file and an include that does not exist", () => {
    const root = copy();
    const file = join(root, "roles", "technical-planner", "role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("  - migration-tasks:", "  - ghost-skill: when it is needed\n  - migration-tasks:").replace("library/author-artifacts.md", "library/missing.md"));
    const out = messages(root).join("\n");
    expect(out).toMatch(/skill "ghost-skill" has no file roles\/technical-planner\/skills\/ghost-skill\.md/);
    expect(out).toMatch(/includes: "library\/missing\.md" not found in the plugin/);
  });

  it("maps the tier to a model and carries the role's rules", () => {
    const tiers = loadTiers(plugin);
    const reviewer = renderAgent(loadRole(plugin, "code-reviewer")!, tiers);
    expect(reviewer).toMatch(/^---\nname: code-reviewer\ndescription: Independent, read-only review/);
    expect(reviewer).toMatch(/^model: sonnet$/m);
    expect(reviewer).toMatch(/## Rules\n\n- You are read-only except for one file/);
    const fullstack = renderAgent(loadRole(plugin, "fullstack")!, tiers);
    expect(fullstack).not.toMatch(/^model:/m); // deep = the session's model
    expect(fullstack).toMatch(/^maxTurns: 100$/m);
    expect(fullstack).toMatch(/Do not edit this file/);
  });

  it("flags a hand-edited agent and a hand-written one; --write repairs both", () => {
    const root = copy();
    writeFileSync(join(root, "agents", "security.md"), "edited by hand\n");
    writeFileSync(join(root, "agents", "extra.md"), "---\nname: extra\n---\n");
    const out = messages(root).join("\n");
    expect(out).toMatch(/agents\/security\.md: out of date with its role folder/);
    expect(out).toMatch(/agents\/extra\.md: not generated from a role/);
    expect(writeAgents(root)).toEqual(["api-designer.md", "backend.md", "business-analyst.md", "code-reviewer.md", "database.md", "database-architect.md", "devops.md", "documentation.md", "frontend.md", "fullstack.md", "integration.md", "performance.md", "product-manager.md", "qa.md", "release.md", "research.md", "security.md", "software-architect.md", "technical-planner.md", "ui-ux-designer.md", "ux-research.md"].sort());
    expect(messages(root)).toEqual([]);
  });

  it("the names the CLI spawns are generated agents", () => {
    const names = Object.keys(generateAgents(plugin)).map((f) => `aidw:${f.replace(/\.md$/, "")}`);
    for (const a of [AGENTS.implement, AGENTS.taskReview, AGENTS.layerReview.ui, AGENTS.layerReview.security]) expect(names).toContain(a);
  });
});

describe("the gate reads access from the role profile", () => {
  it("write -> implementer, read-only -> reviewer, unknown -> no subagent rules", () => {
    expect(agentRole("aidw:fullstack")).toBe("implementer");
    expect(["aidw:code-reviewer", "security", "aidw:ui-ux-designer"].map((a) => agentRole(a))).toEqual(["reviewer", "reviewer", "reviewer"]);
    expect(["aidw:frontend", "backend"].map((a) => agentRole(a))).toEqual(["implementer", "implementer"]);
    expect(["aidw:product-manager", "software-architect", "aidw:technical-planner"].map((a) => agentRole(a))).toEqual(["author", "author", "author"]);
    expect(agentRole("general-purpose")).toBeNull();
    expect(agentRole(undefined)).toBeNull();
  });

  it("an unknown agent named like a reviewer stays read-only", () => {
    expect(agentRole("aidw:legacy-reviewer")).toBe("reviewer");
  });
});
