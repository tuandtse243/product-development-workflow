import { readFileSync } from "node:fs";
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
      ["fastapi", "FastAPI", ["backend", "fullstack"]],
      ["nestjs", "NestJS", ["backend", "fullstack"]],
      ["nextjs", "Next.js", ["frontend", "backend", "fullstack"]],
      ["nuxt", "Nuxt", ["frontend", "backend", "fullstack"]],
      ["sveltekit", "SvelteKit", ["frontend", "backend", "fullstack"]],
    ]);
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
});

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

  it("names none when the project uses no framework with a pack", () => {
    const root = executingProject();
    write(root, "package.json", JSON.stringify({ dependencies: { express: "4.0.0" } }));
    expect(brief(root)).not.toMatch(/framework pack/);
  });
});
