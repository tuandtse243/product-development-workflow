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
      ["vite-react", "Vite", ["frontend", "fullstack"]],
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

  it("give the Vite + React pack only for Vite with React, and never beside a framework's own pack", () => {
    const ids = (stack: Record<string, string>, role: string) => packsFor(plugin, stack, role).map((p) => p.id);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0" }, "frontend")).toEqual(["vite-react"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", framework: "React Router 7.1.0" }, "frontend")).toEqual(["vite-react"]); // library mode, no pack of its own
    // server-rendering frameworks are not a browser-only app
    for (const framework of ["React Router framework mode 7.1.0", "Remix 2.15.0", "Astro 5.1.0"]) expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", framework }, "frontend"), framework).toEqual([]);
    // a backend framework in the same root does not block the frontend's pack
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", framework: "NestJS 10.4.0" }, "frontend")).toEqual(["vite-react"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", framework: "FastAPI 0.115.0" }, "frontend")).toEqual(["vite-react"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", framework: "NestJS 10.4.0" }, "backend")).toEqual(["nestjs"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", server: "Express 5.1.0" }, "fullstack")).toEqual(["express", "vite-react"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", server: "Express 5.1.0" }, "backend")).toEqual(["express"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "Vue 3.5.0" }, "frontend")).toEqual([]); // Vite without React
    expect(ids({ ui: "React 19.0.0" }, "frontend")).toEqual([]); // React without Vite
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0", framework: "Next.js 15.2.0" }, "frontend")).toEqual(["nextjs"]);
    expect(ids({ bundler: "Vite 6.0.1", ui: "React 19.0.0" }, "backend")).toEqual([]);
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

  it("points a frontend task of a Vite + React project at the vite-react pack, detected from package.json", () => {
    const root = executingProject({ tasks: BACKEND_TASK.replace("role: backend", "role: frontend").replace("src/bookings/**", "src/components/bookings/**") });
    write(root, "package.json", JSON.stringify({ dependencies: { react: "19.0.0", "react-router": "7.1.0" }, devDependencies: { vite: "6.0.1", vitest: "3.2.4" } }));
    expect(brief(root)).toContain("stacks/vite-react.md`: how to build with Vite (framework pack)");
  });

  describe("a frontend task in a root that also holds something else (probes through detection)", () => {
    const frontendTask = BACKEND_TASK.replace("role: backend", "role: frontend").replace("src/bookings/**", "src/components/bookings/**");
    const packs = (setup: (root: string) => void) => {
      const root = executingProject({ tasks: frontendTask });
      setup(root);
      return brief(root);
    };
    const viteDeps = { dependencies: { react: "19.0.0" }, devDependencies: { vite: "6.0.1" } };

    it("keeps vite-react beside NestJS", () => {
      const text = packs((r) => write(r, "package.json", JSON.stringify({ dependencies: { react: "19.0.0", "@nestjs/core": "10.4.0" }, devDependencies: { vite: "6.0.1" } })));
      expect(text).toContain("stacks/vite-react.md`");
      expect(text).not.toContain("stacks/nestjs.md`");
    });

    it("keeps vite-react beside a FastAPI pyproject", () => {
      const text = packs((r) => {
        write(r, "package.json", JSON.stringify(viteDeps));
        write(r, "pyproject.toml", '[project]\nname = "api"\ndependencies = ["fastapi>=0.115"]\n');
      });
      expect(text).toContain("stacks/vite-react.md`");
    });

    it.each([
      ["React Router framework mode", { "@react-router/dev": "7.1.0", "react-router": "7.1.0" }],
      ["Remix", { "@remix-run/react": "2.15.0" }],
      ["Astro", { astro: "5.1.0" }],
    ])("does not load vite-react for %s", (_n, extra) => {
      expect(packs((r) => write(r, "package.json", JSON.stringify({ dependencies: { react: "19.0.0", ...extra }, devDependencies: { vite: "6.0.1" } })))).not.toContain("stacks/vite-react.md`");
    });
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
