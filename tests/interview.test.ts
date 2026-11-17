import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateAgents, loadRole, loadRoster } from "../src/roles.js";

const plugin = join(__dirname, "..", "plugins", "aidw");
const start = readFileSync(join(plugin, "skills", "start", "SKILL.md"), "utf8");

describe("interview in the main session, drafting in worker Agents", () => {
  it("the start skill spawns the drafting Agent of every authoring Role, and each exists", () => {
    const agents = Object.keys(generateAgents(plugin)).map((f) => f.replace(/\.md$/, ""));
    const spawned = [...start.matchAll(/\*\*`aidw:([a-z-]+)`\*\*/g)].map((m) => m[1]);
    // the Product Manager is spawned twice: for the product brief (scope gate) and for the specs
    expect(spawned.sort()).toEqual(["api-designer", "business-analyst", "database-architect", "product-manager", "product-manager", "qa", "research", "software-architect", "technical-planner", "ux-research"]);
    for (const id of spawned) expect(agents).toContain(id as string);
  });

  it("every Agent the start skill names is an active Role", () => {
    const roster = loadRoster(plugin);
    for (const m of start.matchAll(/`aidw:([a-z-]+)`|aidw:([a-z-]+)\*\*/g)) {
      const id = (m[1] ?? m[2]) as string;
      expect(roster.roles[id]?.status, id).toBe("active");
    }
  });

  it("the Roles that interview are interactive and keep an Interview section; the drafting Agent cannot ask the user", () => {
    for (const id of ["product-manager", "software-architect", "business-analyst", "ux-research"]) {
      const role = loadRole(plugin, id)!;
      expect(role.mode, id).toBe("interactive");
      expect(role.body, id).toMatch(/## Interview \(main session\)/);
      expect(role.body, id).toMatch(/## Procedure \(drafting\)/);
    }
    expect(loadRole(plugin, "technical-planner")).toMatchObject({ mode: "worker" });
    expect(readFileSync(join(plugin, "library", "author-artifacts.md"), "utf8")).toMatch(/cannot ask them from a subagent/);
  });

  it("each drafting prompt points at what the Agent reads on disk, not at this conversation", () => {
    for (const prompt of start.match(/`Change <id>\.[^`]+`/g) ?? []) expect(prompt).toMatch(/\.aidw\/(?:changes|research)\/<id>|\bdrafted\b/);
    expect((start.match(/`Change <id>\.[^`]+`/g) ?? []).length).toBe(11); // one per drafting Agent, plus the brief and the planner prompt of a bugfix
  });
});
