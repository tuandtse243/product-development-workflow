import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { detectProject } from "../src/detect.js";
import { write } from "./fixtures.js";
import { executingProject } from "./run.test.js";

// T17 probes: the server packs load only when no framework pack matches, from a real package.json; the language pack of
// the project in both briefs; a project aidw cannot detect; the shared library Skills of integration.

const plugin = join(__dirname, "..", "plugins", "aidw");

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

const briefOf = (root: string, kind: "implement" | "review"): string => {
  let out = "";
  const args = kind === "review" ? ["brief", "T01", "--for", "review", "--root", root] : ["brief", "T01", "--root", root];
  expect(run(args, {}, root, { out: (s) => (out += s), err: () => undefined })).toBe(0);
  return readFileSync(out.trim(), "utf8");
};
const packsIn = (brief: string) => [...brief.matchAll(/stacks\/([a-z]+)\.md`/g)].map((m) => m[1]).sort();

describe("server packs from a real package.json", () => {
  it("Express under NestJS: the NestJS pack only, in both briefs", () => {
    const root = executingProject({ tasks: BACKEND_TASK });
    write(root, "package.json", JSON.stringify({ dependencies: { "@nestjs/core": "10.4.0", "@nestjs/platform-express": "10.4.0", express: "4.21.0" } }));
    expect(detectProject(root).stack).toMatchObject({ framework: "NestJS 10.4.0", server: "Express 4.21.0" });
    expect(packsIn(briefOf(root, "implement"))).toEqual(["nestjs", "node"]);
    expect(packsIn(briefOf(root, "review"))).toEqual(["nestjs", "node"]);
  });

  it("Fastify beside Next.js: the Next.js pack only", () => {
    const root = executingProject({ tasks: BACKEND_TASK });
    write(root, "package.json", JSON.stringify({ dependencies: { next: "15.2.0", react: "19.0.0", fastify: "5.2.0" } }));
    expect(packsIn(briefOf(root, "implement"))).toEqual(["nextjs", "node"]);
    expect(packsIn(briefOf(root, "review"))).toEqual(["nextjs", "node"]);
  });

  it("Hono on Cloudflare Workers (wrangler, no node server): the Hono pack and the Node.js language pack", () => {
    const root = executingProject({ tasks: BACKEND_TASK });
    write(root, "package.json", JSON.stringify({ dependencies: { hono: "4.7.0" }, devDependencies: { wrangler: "3.100.0", typescript: "5.7.0" } }));
    write(root, "wrangler.toml", 'name = "api"\nmain = "src/index.ts"\n');
    expect(packsIn(briefOf(root, "implement"))).toEqual(["hono", "node"]);
  });

  it("a frontend task in an Express project reads no server pack", () => {
    const root = executingProject({ tasks: BACKEND_TASK.replace("role: backend", "role: frontend") });
    write(root, "package.json", JSON.stringify({ dependencies: { express: "5.1.0" } }));
    expect(briefOf(root, "implement")).not.toMatch(/stacks\/express\.md/);
  });
});

describe("a project outside Node", () => {
  it("a Python project with Flask and uvicorn: the Python language pack, no framework or server pack", () => {
    const root = executingProject({ tasks: BACKEND_TASK });
    write(root, "pyproject.toml", '[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["flask>=3.1", "uvicorn>=0.32"]\n');
    const d = detectProject(root);
    expect(d.stackPack).toBe("python");
    expect(d.stack.server).toMatch(/^ASGI\/WSGI/);
    for (const kind of ["implement", "review"] as const) {
      const b = briefOf(root, kind);
      expect(packsIn(b)).toEqual(["python"]);
      expect(b).not.toMatch(/framework pack\)/);
    }
  });

  it("a project aidw cannot detect (no stack pack): the briefs are built, with no pack line", () => {
    const root = executingProject({ tasks: BACKEND_TASK });
    expect(detectProject(root).stackPack).toBeNull();
    for (const kind of ["implement", "review"] as const) {
      const b = briefOf(root, kind);
      expect(b).toContain("## Read first");
      expect(b).not.toMatch(/\(stack pack\)|\(framework pack\)|undefined|null\.md/);
    }
  });
});

describe("integration's shared library Skills", () => {
  const path = (args: string[]) => {
    let out = "";
    const code = run(args, {}, plugin, { out: (s) => (out += s), err: () => undefined });
    return { code, out: out.trim() };
  };

  it.each(["external-api", "resilient-integration"])("%s resolves by vendor-path and plugin-path to the same file", (name) => {
    const file = join(plugin, "library", "skills", name, "SKILL.md");
    expect(existsSync(file)).toBe(true);
    expect(path(["vendor-path", `aidw/${name}`])).toEqual({ code: 0, out: file });
    expect(path(["plugin-path", `library/skills/${name}/SKILL.md`])).toEqual({ code: 0, out: file });
    expect(path(["plugin-path", `roles/integration/skills/${name}.md`]).code).not.toBe(0);
  });

  it("the generated integration agent points at the library paths", () => {
    const agent = readFileSync(join(plugin, "agents", "integration.md"), "utf8");
    expect(agent).toContain("aidw plugin-path library/skills/external-api/SKILL.md");
    expect(agent).toContain("aidw plugin-path library/skills/resilient-integration/SKILL.md");
  });

  it("nothing in plugins/ or src/ still names the old integration skill files", () => {
    const old = /roles\/integration\/skills\/(external-api|resilient-integration)/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (n === "node_modules" || n === "vendor") continue;
        const f = join(dir, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(md|ts|js|ya?ml|json)$/.test(n) || n === "aidw") {
          if (old.test(readFileSync(f, "utf8"))) hits.push(f);
        }
      }
    };
    walk(plugin);
    walk(join(__dirname, "..", "src"));
    expect(hits).toEqual([]);
  });
});
