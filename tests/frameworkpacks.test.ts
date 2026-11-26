import { existsSync, readFileSync } from "node:fs";
import { skillPath } from "../src/skills.js";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { frameworkPacks, packsFor } from "../src/stackpacks.js";
import { write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

const plugin = join(__dirname, "..", "plugins", "aidw");

describe("framework packs", () => {
  it("are found by their front matter, with the framework they cover and the Roles that read them", () => {
    expect(frameworkPacks(plugin).map((p) => [p.id, p.framework, p.roles])).toEqual([
      ["django", "Django", ["backend", "fullstack"]],
      ["express", "Express", ["backend", "fullstack"]],
      ["fastapi", "FastAPI", ["backend", "fullstack"]],
      ["fastify", "Fastify", ["backend", "fullstack"]],
      ["hono", "Hono", ["backend", "fullstack"]],
      ["nestjs", "NestJS", ["backend", "fullstack"]],
      ["nextjs", "Next.js", ["frontend", "backend", "fullstack"]],
      ["nuxt", "Nuxt", ["frontend", "backend", "fullstack"]],
      ["sveltekit", "SvelteKit", ["frontend", "backend", "fullstack"]],
    ]);
  });

  it("name only Skills that exist", () => {
    const vendor = join(plugin, "library", "vendor");
    const named = frameworkPacks(plugin).flatMap((p) => [...p.skills, ...p.reviewSkills].map((id) => [p.id, id] as const));
    expect(named.length).toBeGreaterThan(0);
    for (const [pack, id] of named) expect(existsSync(skillPath(vendor, id)), `${pack}: ${id}`).toBe(true);
  });

  it("go to the Roles that build with the framework, and to no one else", () => {
    const ids = (stack: Record<string, string>, role: string) => packsFor(plugin, stack, role).map((p) => p.id);
    expect(ids({ framework: "Next.js 15.2.0" }, "frontend")).toEqual(["nextjs"]);
    expect(ids({ framework: "Next.js 15.2.0" }, "backend")).toEqual(["nextjs"]);
    expect(ids({ framework: "NestJS 10.4.0" }, "backend")).toEqual(["nestjs"]);
    expect(ids({ framework: "NestJS 10.4.0" }, "fullstack")).toEqual(["nestjs"]);
    expect(ids({ framework: "NestJS 10.4.0" }, "frontend")).toEqual([]); // never the framework of the other side
    expect(ids({ framework: "NestJS 10.4.0" }, "code-reviewer")).toEqual([]);
    expect(ids({}, "backend")).toEqual([]);
    expect(ids({ framework: "Astro" }, "backend")).toEqual([]);
    expect(ids({ framework: "Nuxt 3.14" }, "frontend")).toEqual(["nuxt"]);
    expect(ids({ framework: "SvelteKit 2.9" }, "backend")).toEqual(["sveltekit"]);
  });

  it("give a server library's pack when no framework pack matches, never beside one", () => {
    const ids = (stack: Record<string, string>, role: string) => packsFor(plugin, stack, role).map((p) => p.id);
    expect(ids({ server: "Express 5.1.0" }, "backend")).toEqual(["express"]);
    expect(ids({ server: "Fastify 5.2.0" }, "fullstack")).toEqual(["fastify"]);
    expect(ids({ server: "Hono 4.7.0" }, "backend")).toEqual(["hono"]);
    expect(ids({ server: "Hono 4.7.0", framework: "Astro" }, "backend")).toEqual(["hono"]); // Astro has no pack
    expect(ids({ server: "Express 5.1.0" }, "frontend")).toEqual([]);
    expect(ids({ server: "Express 5.1.0", framework: "NestJS 10.4.0" }, "backend")).toEqual(["nestjs"]); // Nest's conventions win
    expect(ids({ server: "Hono 4.7.0", framework: "Next.js 15.2.0" }, "backend")).toEqual(["nextjs"]);
    expect(ids({ framework: "Express" }, "backend")).toEqual([]); // matched on the key the pack names, not any value
  });
});

const BACKEND_TASK = `tasks:
  - id: T01
    title: Reschedule an appointment, server side
    role: backend
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]
    depends_on: []
    touches: ["src/bookings/**", "tests/**"]
    verify: ['node -e "process.exit(0)"']
    status: pending
`;

describe("the implementer brief", () => {
  const brief = (root: string) => {
    let out = "";
    run(["brief", "T01", "--root", root], {}, root, { out: (s) => (out += s), err: () => undefined });
    return readFileSync(out.trim(), "utf8");
  };

  it("points at the framework pack of the project's framework", () => {
    const root = executingProject();
    write(root, "package.json", JSON.stringify({ dependencies: { next: "15.2.0", react: "19.0.0" } }));
    expect(brief(root)).toMatch(/stacks\/nextjs\.md`: how to build with Next\.js \(framework pack\)/);
  });

  it("points at the language pack of the project, for the implementer and the reviewer", () => {
    const root = executingProject({ tasks: BACKEND_TASK });
    write(root, "package.json", JSON.stringify({ dependencies: { fastify: "5.2.0" } }));
    const implement = brief(root);
    expect(implement).toMatch(/stacks\/node\.md`: tooling of the project's language: install, format, lint, typecheck, tests \(stack pack\)/);
    let out = "";
    run(["brief", "T01", "--for", "review", "--root", root], {}, root, { out: (s) => (out += s), err: () => undefined });
    const review = readFileSync(out.trim(), "utf8");
    expect(review).toMatch(/stacks\/node\.md`: tooling/);
    expect(review).toMatch(/stacks\/fastify\.md`: how to build with Fastify \(framework pack\)/);
  });

  it("names none when the project uses no framework with a pack", () => {
    const root = executingProject();
    write(root, "package.json", JSON.stringify({ dependencies: { koa: "2.15.0" } }));
    expect(brief(root)).not.toMatch(/framework pack/);
  });

  it.each([
    ["express", "5.1.0", "Express"],
    ["fastify", "5.2.0", "Fastify"],
    ["hono", "4.7.0", "Hono"],
  ])("points a backend task at the %s pack, detected from package.json", (dep, version, name) => {
    const root = executingProject({ tasks: BACKEND_TASK });
    write(root, "package.json", JSON.stringify({ dependencies: { [dep]: version } }));
    expect(brief(root)).toContain(`stacks/${dep}.md\`: how to build with ${name} (framework pack)`);
  });
});
