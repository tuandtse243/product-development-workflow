import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { taskConsultable } from "../src/consult.js";
import { detectProject } from "../src/detect.js";
import { decide, type HookInput } from "../src/gate.js";
import { pathsFor } from "../src/project.js";
import { checkRoster, loadRole } from "../src/roles.js";
import { buildBrief } from "../src/run.js";
import { selectSkills } from "../src/skills.js";
import { packsFor } from "../src/stackpacks.js";
import { parseTasks, type Task } from "../src/tasks.js";
import { ANALYSIS_MD, MAIN_SPEC, QUALITY_YAML, REQ, TOKENS_YAML, planReviewed, tempProject, write } from "./fixtures.js";

// Edge probes for the frontend Role branch (T20): pack detection, skill selection, ui-ux-designer as an author, the consult gate.
const plugin = join(__dirname, "..", "plugins", "aidw");
const vendor = join(plugin, "library", "vendor");
const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

// ---------------------------------------------------------------- pack detection through the real detector

function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "aidw-edges-"));
  temps.push(dir);
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  return dir;
}
const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) => ({ "package.json": JSON.stringify({ name: "x", dependencies: deps, ...extra }) });
const packs = (dir: string, role: string) => packsFor(plugin, detectProject(dir).stack, role).map((p) => p.id);
const REACT_VITE = { react: "^19.0.0", vite: "^6.0.1" };

describe("pack detection matrix (real detectProject + packsFor)", () => {
  it("Next with react gets Next's pack for frontend and backend, never vite-react", () => {
    const dir = root(pkg({ ...REACT_VITE, next: "^15.2.0" }));
    expect(packs(dir, "frontend")).toEqual(["nextjs"]);
    expect(packs(dir, "backend")).toEqual(["nextjs"]);
    expect(packs(dir, "fullstack")).toEqual(["nextjs"]);
  });

  it("a plain Vite + React SPA: vite-react for frontend and fullstack, nothing for backend", () => {
    const dir = root(pkg(REACT_VITE));
    expect(packs(dir, "frontend")).toEqual(["vite-react"]);
    expect(packs(dir, "fullstack")).toEqual(["vite-react"]);
    expect(packs(dir, "backend")).toEqual([]);
    expect(packs(dir, "integration")).toEqual([]);
    expect(packs(dir, "code-reviewer")).toEqual([]);
  });

  it("Express beside a Vite SPA: each Role keeps its own pack", () => {
    const dir = root(pkg({ ...REACT_VITE, express: "^5.1.0" }));
    expect(packs(dir, "frontend")).toEqual(["vite-react"]);
    expect(packs(dir, "backend")).toEqual(["express"]);
    expect(packs(dir, "fullstack")).toEqual(["express", "vite-react"]);
  });

  it("NestJS beside a Vite SPA: each Role keeps its own pack", () => {
    const dir = root(pkg({ ...REACT_VITE, "@nestjs/core": "^10.4.0" }));
    expect(packs(dir, "frontend")).toEqual(["vite-react"]);
    expect(packs(dir, "backend")).toEqual(["nestjs"]);
  });

  it("FastAPI beside a Vite SPA (pyproject + package.json): each Role keeps its own pack", () => {
    const dir = root({ ...pkg(REACT_VITE), "pyproject.toml": `[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi>=0.115"]\n` });
    expect(detectProject(dir).stack.framework ?? "").toMatch(/^FastAPI/);
    expect(packs(dir, "frontend")).toEqual(["vite-react"]);
    expect(packs(dir, "backend")).toEqual(["fastapi"]);
  });

  it("Astro, Remix v2, React Router framework mode: not a browser-only app, no vite-react", () => {
    for (const deps of [
      { ...REACT_VITE, astro: "^5.1.0" },
      { ...REACT_VITE, "@remix-run/react": "^2.15.0", "@remix-run/node": "^2.15.0" },
      { ...REACT_VITE, "react-router": "^7.1.0", "@react-router/dev": "^7.1.0" },
      { ...REACT_VITE, "@react-router/dev": "^7.1.0" },
    ]) {
      const dir = root(pkg(deps));
      expect(packs(dir, "frontend"), JSON.stringify(deps)).toEqual([]);
      expect(packs(dir, "fullstack"), JSON.stringify(deps)).toEqual([]);
    }
  });

  it("detect names the three React routers apart", () => {
    const fw = (deps: Record<string, string>) => detectProject(root(pkg(deps))).stack.framework;
    expect(fw({ "@remix-run/react": "^2.15.0" })).toMatch(/^Remix /);
    expect(fw({ "react-router": "^7.1.0", "@react-router/dev": "^7.1.0" })).toMatch(/^React Router framework mode /);
    expect(fw({ "react-router": "^7.1.0" })).toBe("React Router 7.1.0");
    expect(fw({ "react-router-dom": "^6.28.0" })).toBeUndefined(); // the v6 DOM package alone says nothing about a framework
  });

  it("react-router in library mode and TanStack Router are SPAs: vite-react", () => {
    expect(packs(root(pkg({ ...REACT_VITE, "react-router": "^7.1.0" })), "frontend")).toEqual(["vite-react"]);
    expect(packs(root(pkg({ ...REACT_VITE, "@tanstack/react-router": "^1.90.0" })), "frontend")).toEqual(["vite-react"]);
    expect(packs(root(pkg({ ...REACT_VITE, "react-router-dom": "^6.28.0" })), "frontend")).toEqual(["vite-react"]);
  });

  it("Vue + Vite, Svelte + Vite, Solid + Vite and Preact + Vite are not Vite + React", () => {
    expect(packs(root(pkg({ vite: "^6.0.1", vue: "^3.5.0" })), "frontend")).toEqual([]);
    expect(packs(root(pkg({ vite: "^6.0.1", svelte: "^5.0.0" })), "frontend")).toEqual([]);
    expect(packs(root(pkg({ vite: "^6.0.1", "solid-js": "^1.9.0" })), "frontend")).toEqual([]);
    expect(packs(root(pkg({ vite: "^6.0.1", preact: "^10.25.0" })), "frontend")).toEqual([]);
  });

  it("React without Vite (webpack, CRA) and Vite in devDependencies only", () => {
    expect(packs(root(pkg({ react: "^19.0.0", webpack: "^5" })), "frontend")).toEqual([]);
    const dev = root({ "package.json": JSON.stringify({ name: "x", dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^6.0.1" } }) });
    expect(packs(dev, "frontend")).toEqual(["vite-react"]);
  });

  it("a monorepo root without react, an empty root and a broken package.json yield no frontend pack and no crash", () => {
    expect(packs(root(pkg({}, { workspaces: ["apps/*"], private: true })), "frontend")).toEqual([]);
    expect(packs(root({ "package.json": "{ not json" }), "frontend")).toEqual([]);
    expect(packs(root({}), "frontend")).toEqual([]);
  });

  it("a pack of a server library never replaces the framework's own pack for backend", () => {
    const dir = root(pkg({ "@nestjs/core": "^10.4.0", express: "^5.1.0" }));
    expect(packs(dir, "backend")).toEqual(["nestjs"]);
  });

  // The detector keeps one value per key and the first dependency in its list wins: a React Router library in the root
  // takes the `framework` slot, and the backend framework behind it is never seen, so the backend loses its own pack.
  it("BUG: NestJS beside a Vite SPA that uses react-router (library mode): backend still gets nestjs", () => {
    const dir = root(pkg({ ...REACT_VITE, "react-router": "^7.1.0", "@nestjs/core": "^10.4.0" }));
    expect(packs(dir, "frontend")).toEqual(["vite-react"]);
    expect(packs(dir, "backend")).toEqual(["nestjs"]);
  });

  it("BUG: FastAPI beside a Vite SPA that uses react-router (library mode): backend still gets fastapi", () => {
    const dir = root({ ...pkg({ ...REACT_VITE, "react-router": "^7.1.0" }), "pyproject.toml": `[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi>=0.115"]\n` });
    expect(packs(dir, "backend")).toEqual(["fastapi"]);
  });

  it("BUG: NestJS beside a Remix app is not hidden by the Remix framework entry", () => {
    const dir = root(pkg({ "@remix-run/react": "^2.15.0", "@nestjs/core": "^10.4.0" }));
    expect(packs(dir, "backend")).toEqual(["nestjs"]);
  });
});

// ---------------------------------------------------------------- selectSkills

const task = (t: Partial<Task> & Record<string, unknown>): Task => ({ id: "T01", title: "A task", ...t }) as unknown as Task;
const ids = (t: Task, kind: "implement" | "review" = "implement", opts: Parameters<typeof selectSkills>[2] = {}) => selectSkills(t, kind, opts).map((p) => p.id);
const API_PAIR = ["addy/api-and-interface-design", "aidw/api-design-rules"];
const DATA = ["aidw/schema-evolution", "supabase/supabase-postgres-best-practices"];

describe("selectSkills: the API pair", () => {
  it("frontend never gets the API pair, whatever its Touches look like", () => {
    for (const touches of [["src/api/client.ts"], ["src/actions.ts"], ["src/services/bookings.ts"], ["src/routes/index.tsx"], ["src/server/mock.ts"], ["app/api/x/route.ts"], ["src/middleware/auth.ts"], ["src/handlers/x.ts"], ["src/graphql/q.ts"]]) {
      const got = ids(task({ role: "frontend", touches }));
      for (const s of API_PAIR) expect(got, `${touches} ${s}`).not.toContain(s);
    }
  });

  it("backend and fullstack keep the pair; backend gets it from its Role even with no touches", () => {
    expect(ids(task({ role: "backend", touches: [] }))).toEqual(expect.arrayContaining(API_PAIR));
    expect(ids(task({ role: "backend", touches: ["src/api/x.ts"] }))).toEqual(expect.arrayContaining(API_PAIR));
    expect(ids(task({ role: "fullstack", touches: ["app/api/x/route.ts"] }))).toEqual(expect.arrayContaining(API_PAIR));
    expect(ids(task({ touches: ["src/api/x.ts"] }))).toEqual(expect.arrayContaining(API_PAIR)); // no role
  });

  it("integration with an api/ path keeps the pair (it connects both sides)", () => {
    expect(ids(task({ role: "integration", touches: ["src/api/client.ts"] }))).toEqual(expect.arrayContaining(API_PAIR));
  });

  it("a task may still ask for the pair by `skills:` even as frontend", () => {
    expect(ids(task({ role: "frontend", touches: ["src/x.tsx"], skills: ["api-and-interface-design"] }))).toContain("addy/api-and-interface-design");
  });

  it("a review brief is the same for every Role", () => {
    for (const role of ["frontend", "backend", "fullstack"]) expect(ids(task({ role, touches: ["src/api/x.ts"] }), "review")).toEqual(["addy/code-review-and-quality"]);
  });
});

describe("selectSkills: the data layer for frontend", () => {
  it("a form schema (schema.ts, schemas/, zod) is no data-layer signal for frontend", () => {
    for (const touches of [["src/forms/schema.ts"], ["src/schema.ts"], ["src/schema/booking.ts"], ["src/features/booking/schema.tsx"], ["schema.ts"]]) {
      const got = ids(task({ role: "frontend", touches }));
      for (const s of [...DATA, ...API_PAIR]) expect(got, `${touches} ${s}`).not.toContain(s);
    }
  });

  it("the same schema path is the data layer for fullstack, backend, integration and a task with no Role", () => {
    for (const role of ["fullstack", "backend", "integration", undefined]) expect(ids(task({ role, touches: ["src/schema/booking.ts"] })), String(role)).toEqual(expect.arrayContaining(DATA));
    expect(ids(task({ role: "database", touches: [] }))).toEqual(expect.arrayContaining(DATA));
  });

  it("frontend keeps the data-layer skills for real data-layer paths (prisma, migrations, drizzle, db/, supabase/)", () => {
    for (const touches of [["prisma/schema.prisma"], ["db/migrations/001.sql"], ["supabase/migrations/1.sql"], ["drizzle/0001.sql"], ["migrations/1.sql"]]) {
      expect(ids(task({ role: "frontend", touches })), String(touches)).toEqual(expect.arrayContaining(DATA));
    }
  });

  it("a frontend path with `schema` AND a real data-layer path still loads them", () => {
    expect(ids(task({ role: "frontend", touches: ["src/form/schema.ts", "supabase/client.ts"] }))).toEqual(expect.arrayContaining(DATA));
  });

  it("`schema` as a directory name deeper in the path, and `.schema` suffix forms, stay out too", () => {
    expect(ids(task({ role: "frontend", touches: ["src/schema/index.ts", "src/lib/booking.schema.ts"] }))).not.toContain("aidw/schema-evolution");
  });

  // The decision: the API pair is skipped for frontend. The data branch adds one half of it ("schema is an interface")
  // when frontend touches a Supabase client, so the API-design skill still reaches a frontend task by another door.
  it("BUG: a frontend task touching a Supabase client path does not load api-and-interface-design", () => {
    expect(ids(task({ role: "frontend", touches: ["src/lib/supabase.ts"] }))).not.toContain("addy/api-and-interface-design");
  });
});

describe("selectSkills: anthropic/frontend-design and approved tokens", () => {
  const FD = "anthropic/frontend-design";
  it("frontend loads it without tokens and skips it with tokens", () => {
    expect(ids(task({ role: "frontend", touches: ["src/x.tsx"] }))).toContain(FD);
    expect(ids(task({ role: "frontend", touches: ["src/x.tsx"] }), "implement", { designTokens: false })).toContain(FD);
    expect(ids(task({ role: "frontend", touches: ["src/x.tsx"] }), "implement", { designTokens: true })).not.toContain(FD);
    expect(ids(task({ role: "frontend", touches: [] }), "implement", { designTokens: true })).not.toContain(FD);
    expect(ids(task({ role: "frontend", touches: [] }))).toContain(FD); // frontend implies UI
  });

  it("tokens never take frontend-design away from fullstack, a Role-less task or integration", () => {
    for (const role of ["fullstack", undefined, "integration"]) {
      expect(ids(task({ role, touches: ["src/x.tsx"] }), "implement", { designTokens: true }), String(role)).toContain(FD);
    }
  });

  it("the other UI skills are untouched by tokens", () => {
    const got = ids(task({ role: "frontend", touches: ["src/x.tsx"] }), "implement", { designTokens: true });
    expect(got).toContain("addy/frontend-ui-engineering");
    expect(got.slice(0, 3)).toEqual(["addy/incremental-implementation", "addy/test-driven-development", "obra/verification-before-completion"]);
  });

  it("explicit `skills:` can still bring it back for a frontend task with tokens", () => {
    expect(ids(task({ role: "frontend", touches: ["src/x.tsx"], skills: [FD] }), "implement", { designTokens: true })).toContain(FD);
  });

  it("the reason text says why, for frontend with and without tokens", () => {
    const reason = (opts: Parameters<typeof selectSkills>[2]) => selectSkills(task({ role: "frontend", touches: ["src/x.tsx"] }), "implement", opts).find((p) => p.id === FD)?.reason ?? "";
    expect(reason({})).toMatch(/touches UI files/);
    expect(reason({})).toMatch(/approved design tokens/);
    const noApi = selectSkills(task({ role: "frontend", touches: ["src/api/x.ts", "src/x.tsx"] }), "implement").filter((p) => p.reason.length === 0);
    expect(noApi).toEqual([]);
  });

  it("every pick has a non-empty reason and no id appears twice", () => {
    for (const role of ["frontend", "fullstack", "backend", "integration"]) {
      const picks = selectSkills(task({ role, touches: ["src/api/x.ts", "src/schema/x.ts", "src/x.tsx", "supabase/a.sql"], skills: ["api-and-interface-design"] }), "implement", { designTokens: true });
      expect(new Set(picks.map((p) => p.id)).size, role).toBe(picks.length);
      for (const p of picks) expect(p.reason.length, `${role} ${p.id}`).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------- a project: brief, gate, consult

const cli = (rootDir: string, ...argv: string[]) => {
  let out = "";
  let err = "";
  const code = run([...argv, "--root", rootDir], {}, rootDir, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
};
const ID = "2026-11-24-booking";
const OK = `node -e "process.exit(0)"`;
const TASKS = `tasks:
  - id: T01
    title: Booking API
    role: backend
    type: feat
    specs: [booking/reschedule-appointment]
    scenarios: [booking/reschedule-appointment/reschedule-appointment-works]
    depends_on: []
    touches: ["app/api/**"]
    verify: ['${OK}']
    status: pending
  - id: T02
    title: Booking page
    role: frontend
    type: feat
    depends_on: []
    touches: ["app/(site)/**"]
    verify: ['${OK}']
    status: pending
`;

function approvedProject(opts: { design?: boolean; tokens?: string | null } = {}): string {
  const rootDir = tempProject();
  temps.push(rootDir);
  expect(cli(rootDir, "init").code).toBe(0);
  write(rootDir, ".aidw/specs/booking/spec.md", MAIN_SPEC);
  expect(cli(rootDir, "change", "new", ID, "--title", "Booking").code).toBe(0);
  const c = `.aidw/changes/${ID}`;
  write(rootDir, `${c}/analysis.md`, ANALYSIS_MD);
  write(rootDir, ".aidw/design/tokens.yaml", TOKENS_YAML); // the package needs them to be approved; the variant is applied after approval
  if (opts.design) write(rootDir, ".aidw/design/direction.md", "# Direction\n");
  write(rootDir, `${c}/tasks.yaml`, TASKS);
  write(rootDir, `${c}/quality.yaml`, QUALITY_YAML);
  write(rootDir, `${c}/specs/booking/spec.md`, `## ADDED Requirements\n\n${REQ("Reschedule appointment")}`);
  write(rootDir, ".aidw/architecture/overview.md", "# Architecture\n");
  planReviewed(rootDir, ID);
  for (const s of ["intake", "analyzing", "awaiting_approval"]) {
    const t = cli(rootDir, "transition", ID, s);
    expect(t.code, t.err + t.out).toBe(0);
  }
  const approved = cli(rootDir, "approve", ID);
  expect(approved.code, approved.err + approved.out).toBe(0);
  expect(cli(rootDir, "transition", ID, "executing").code).toBe(0);
  if (opts.tokens === null) rmSync(join(rootDir, ".aidw/design/tokens.yaml"));
  else if (opts.tokens !== undefined) writeFileSync(join(rootDir, ".aidw/design/tokens.yaml"), opts.tokens);
  return rootDir;
}

const briefSkills = (rootDir: string, taskId: string, kind: "implement" | "review" = "implement") => buildBrief(pathsFor(rootDir), ID, taskId, kind, vendor).skills.map((s) => s.id);
const FD = "anthropic/frontend-design";

describe("buildBrief: tokens decide frontend-design", () => {
  it("approved tokens: frontend skips it, and the brief still lists the other UI skills", () => {
    const rootDir = approvedProject();
    const got = briefSkills(rootDir, "T02");
    expect(got).not.toContain(FD);
    expect(got).toContain("addy/frontend-ui-engineering");
    expect(got).not.toContain("aidw/api-design-rules");
  });

  it("no tokens file, an empty list, an empty file and malformed YAML all count as no approved tokens", () => {
    for (const tokens of [null, "tokens: []\n", "", "tokens: [\n  - name: x\n    : :\n", "tokens: not-a-list\n", "[]\n", "tokens:\n  - name: Bad Name\n    kind: color\n    value: red\n    use: nowhere in particular\n"]) {
      const rootDir = approvedProject({ tokens });
      expect(briefSkills(rootDir, "T02"), JSON.stringify(tokens)).toContain(FD);
    }
  });

  it("one malformed token among valid ones makes the file unapproved (the brief carries no tokens either)", () => {
    const rootDir = approvedProject({ tokens: `${TOKENS_YAML}  - name: broken\n    kind: color\n` });
    expect(briefSkills(rootDir, "T02")).toContain(FD);
  });

  it("tokens never change a backend task's skills, and a backend task never loads the UI skills", () => {
    const withTokens = briefSkills(approvedProject(), "T01");
    const without = briefSkills(approvedProject({ tokens: null }), "T01");
    expect(withTokens).toEqual(without);
    expect(withTokens).not.toContain(FD);
    expect(withTokens).toEqual(expect.arrayContaining(API_PAIR));
  });

  it("a review brief is unaffected by tokens", () => {
    expect(briefSkills(approvedProject(), "T02", "review")).toEqual(briefSkills(approvedProject({ tokens: null }), "T02", "review"));
  });

  it("the frontend brief of a Vite + React project carries vite-react's skill, not Next's", () => {
    const rootDir = approvedProject();
    write(rootDir, "package.json", JSON.stringify({ name: "x", dependencies: { react: "^19.0.0", vite: "^6.0.1" } }));
    const got = briefSkills(rootDir, "T02");
    expect(got).toContain("aidw/react-rules");
    // the review of frontend code reads the same pack's review skills
    expect(briefSkills(rootDir, "T02", "review")).toContain("addy/code-review-and-quality");
  });

  it("a backend task in the Vite + React root does not load the frontend pack's skills", () => {
    const rootDir = approvedProject();
    write(rootDir, "package.json", JSON.stringify({ name: "x", dependencies: { react: "^19.0.0", vite: "^6.0.1", express: "^5.1.0" } }));
    expect(briefSkills(rootDir, "T01")).not.toContain("aidw/react-rules");
  });
});

// ---------------------------------------------------------------- ui-ux-designer as an author

const env = {} as NodeJS.ProcessEnv;
const hook = (rootDir: string, tool_name: string, tool_input: Record<string, unknown>, agent_type?: string): HookInput => ({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: rootDir, ...(agent_type ? { agent_type } : {}) });
const UX = "aidw:ui-ux-designer";
const writeAs = (rootDir: string, file: string, who: string, tool = "Write") => decide(hook(rootDir, tool, { file_path: file }, who), env)?.decision ?? "none";
const bashAs = (rootDir: string, command: string, who: string) => decide(hook(rootDir, "Bash", { command }, who), env)?.decision ?? "none";

describe("ui-ux-designer as an author", () => {
  it("is an `artifacts` Role whose profile still lists the verdict and design artifacts it writes", () => {
    const role = loadRole(plugin, "ui-ux-designer")!;
    expect(role.access).toBe("artifacts");
    expect(role.tools).toEqual(["Read", "Grep", "Glob", "Bash", "Write"]); // no Edit: it drafts whole files
    expect(role.consults).toEqual([]);
  });

  it("writes its layer-review verdict file during the quality layer", () => {
    const rootDir = approvedProject({ design: true });
    const run = join(rootDir, ".aidw/run");
    expect(writeAs(rootDir, join(run, "layer-review-ui-ux.md"), UX)).toBe("allow");
    expect(writeAs(rootDir, join(run, "audit-ui.md"), UX)).toBe("allow");
    // the verdict is also written with Edit and MultiEdit
    expect(writeAs(rootDir, join(run, "layer-review-ui-ux.md"), UX, "Edit")).toBe("allow");
  });

  it("is still denied every project file, with each file tool, with `..` and with a trailing-dot path", () => {
    for (const phase of [approvedProject({ design: true }), (() => { const r = tempProject(); temps.push(r); cli(r, "init"); return r; })()]) {
      for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
        expect(writeAs(phase, join(phase, "app/page.tsx"), UX, tool), tool).toBe("deny");
      }
      expect(writeAs(phase, join(phase, ".aidw/../app/page.tsx"), UX)).toBe("deny");
      expect(writeAs(phase, join(phase, ".aidw/changes/../../src/x.ts"), UX)).toBe("deny");
      expect(writeAs(phase, join(phase, "package.json"), UX)).toBe("deny");
      expect(writeAs(phase, join(phase, ".env.example"), UX)).toBe("deny");
      expect(writeAs(phase, join(phase, "README.md"), UX)).toBe("deny");
      expect(writeAs(phase, join(phase, "src", ".aidw", "x.ts"), UX)).toBe("deny"); // a folder named .aidw deeper in the tree is not the aidw state
      expect(writeAs(phase, join(phase, ".aidw-notes/x.md"), UX)).toBe("deny"); // a sibling whose name starts with .aidw
    }
  });

  it("is denied Bash writes in every form, as the reviewer it used to be", () => {
    const rootDir = approvedProject({ design: true });
    for (const cmd of ["echo x > app/page.tsx", "echo x >> .aidw/run/layer-review-ui-ux.md", "tee app/x.ts < /dev/null", "sed -i '' s/a/b/ app/page.tsx", "cp a b", "mv a b", "rm -rf app", "touch app/x", "python3 -c 'open(1)'", "node -e 'require(\"fs\")'", "printf x | tee .aidw/run/audit-ui.md", "git commit -am x", "git apply p.diff", "ln -s /etc x"]) {
      expect(bashAs(rootDir, cmd, UX), cmd).toBe("deny");
    }
  });

  it("is denied the aidw state commands, as the reviewer was", () => {
    const rootDir = approvedProject({ design: true });
    for (const cmd of ["aidw layer-review ui-ux pass", "aidw verify", "aidw task done T02", "aidw approve " + ID]) expect(bashAs(rootDir, cmd, UX), cmd).not.toBe("allow");
    expect(bashAs(rootDir, "aidw layer-review ui-ux pass", UX)).toBe("deny");
  });

  it("can still read: git diff, ls and cat are not blocked", () => {
    const rootDir = approvedProject({ design: true });
    for (const cmd of ["git diff abc123 --stat", "ls -la app", "cat .aidw/design/direction.md", "git log --oneline"]) expect(bashAs(rootDir, cmd, UX), cmd).toBe("none");
  });

  it("is denied the records only the CLI and one Role write, after approval and before it", () => {
    const rootDir = approvedProject({ design: true });
    const c = join(rootDir, ".aidw/changes", ID);
    for (const f of [join(c, "change.yaml"), join(c, "consultations.yaml"), join(c, "plan-review.yaml"), join(c, "evidence/agent-runs.json"), join(c, "deviations.yaml"), join(c, "deviations/D01.md"), join(c, "CHANGE.YAML"), join(c, "Consultations.yaml")]) {
      expect(writeAs(rootDir, f, UX), f).toBe("deny");
    }
  });

  it("cannot edit what the approved Analysis package froze: analysis, quality, specs, tokens, direction, architecture", () => {
    const rootDir = approvedProject({ design: true });
    const c = join(rootDir, ".aidw/changes", ID);
    for (const f of [join(c, "analysis.md"), join(c, "quality.yaml"), join(c, "specs/booking/spec.md"), join(rootDir, ".aidw/design/tokens.yaml"), join(rootDir, ".aidw/design/direction.md"), join(rootDir, ".aidw/architecture/overview.md")]) {
      expect(writeAs(rootDir, f, UX), f).toBe("deny");
    }
  });

  it("before approval it may draft the design Artifacts it owns", () => {
    const rootDir = tempProject();
    temps.push(rootDir);
    expect(cli(rootDir, "init").code).toBe(0);
    expect(cli(rootDir, "change", "new", ID, "--title", "Booking").code).toBe(0);
    for (const f of [".aidw/design/direction.md", ".aidw/design/tokens.yaml", `.aidw/changes/${ID}/analysis-design.md`]) expect(writeAs(rootDir, join(rootDir, f), UX), f).toBe("allow");
  });

  it("is not allowed to write another Role's consult files, or an answer nobody asked it for", () => {
    const rootDir = approvedProject({ design: true });
    expect(cli(rootDir, "task", "start", "T02").code).toBe(0);
    const dir = join(rootDir, ".aidw/changes", ID, "consult");
    // no consultation is open yet: even its own answer file is denied
    expect(writeAs(rootDir, join(dir, "C01.answer.md"), UX)).toBe("deny");
  });

  it("answers a Consultation addressed to it, and only that answer", () => {
    const rootDir = approvedProject({ design: true });
    expect(cli(rootDir, "task", "start", "T02").code).toBe(0);
    const dir = join(rootDir, ".aidw/changes", ID, "consult");
    write(rootDir, `.aidw/changes/${ID}/consult/T02.request.md`, `---\nfrom: frontend\ntask: T02\nto: ui-ux-designer\n---\n\n## Question\n\nWhich token is the error text?\n\n## Progress\n\nDone so far: the form.\nNext step: the error text.\nFiles touched: app/(site)/page.tsx\n`);
    const asked = cli(rootDir, "consult", join(dir, "T02.request.md"));
    expect(asked.code, asked.err + asked.out).toBe(0);
    expect(writeAs(rootDir, join(dir, "C01.answer.md"), UX)).toBe("allow");
    expect(writeAs(rootDir, join(dir, "C02.answer.md"), UX)).toBe("deny"); // no such consultation
    expect(writeAs(rootDir, join(dir, "C01.request.md"), UX)).toBe("deny"); // the CLI's copy
    expect(writeAs(rootDir, join(dir, "C01.answer.md"), "aidw:api-designer")).toBe("deny"); // not the consulted Role
    expect(writeAs(rootDir, join(dir, "C01.answer.md"), "aidw:frontend")).toBe("deny"); // not the asker either
    expect(writeAs(rootDir, join(dir, "C01.answer.md"), UX, "Edit")).toBe("allow");
    expect(writeAs(rootDir, join(dir, "C01.ANSWER.md"), UX)).toBe("deny"); // case games on the file name
    expect(writeAs(rootDir, join(dir, "../../other-change/consult/C01.answer.md"), UX)).toBe("deny");
    expect(writeAs(rootDir, join(rootDir, "app/page.tsx"), UX)).toBe("deny");
  });

  // The gate resolves `..` but not symlinks, so a link already under .aidw/ that points into the tree is a way around
  // "never a project file". Creating the link needs a shell, which an author lacks; it does not need one if a link exists.
  it("BUG: a write through a symlink under .aidw/ that points at project code is denied", () => {
    const rootDir = approvedProject({ design: true });
    mkdirSync(join(rootDir, "app"), { recursive: true });
    symlinkSync(join(rootDir, "app"), join(rootDir, ".aidw/run/app-link"));
    expect(writeAs(rootDir, join(rootDir, ".aidw/run/app-link/page.tsx"), UX)).toBe("deny");
  });

  it("a plain project file stays denied for every author Role, so ui-ux-designer is no looser than software-architect", () => {
    const rootDir = approvedProject({ design: true });
    for (const who of ["aidw:software-architect", "aidw:api-designer", UX]) expect(writeAs(rootDir, join(rootDir, "app/page.tsx"), who), who).toBe("deny");
  });

  it("the reviewer Roles stay confined to verdict files in .aidw/run", () => {
    const rootDir = approvedProject({ design: true });
    for (const who of ["aidw:code-reviewer", "aidw:security", "aidw:performance"]) {
      expect(writeAs(rootDir, join(rootDir, ".aidw/run/layer-review-security.md"), who), who).toBe("allow");
      expect(writeAs(rootDir, join(rootDir, ".aidw/design/direction.md"), who), who).toBe("deny");
      expect(writeAs(rootDir, join(rootDir, ".aidw/run/notes.md"), who), who).toBe("deny");
    }
  });

  // Compare with the old reviewer access: a reviewer wrote only .aidw/run/{review-,layer-review-,audit-}*.md (any layer's,
  // as it still can). An author writes anything under .aidw/ that is not frozen, so these became possible during the
  // build for ui-ux-designer, which in its review phase has no reason to write them.
  it("BUG: during the build ui-ux-designer may not rewrite tasks.yaml (the verify commands and statuses of every task)", () => {
    const rootDir = approvedProject({ design: true });
    expect(writeAs(rootDir, join(rootDir, ".aidw/changes", ID, "tasks.yaml"), UX)).toBe("deny");
  });

  it("BUG: during the build ui-ux-designer may not write run state or evidence (an implementer's report, a task's evidence, free notes)", () => {
    const rootDir = approvedProject({ design: true });
    const run = join(rootDir, ".aidw/run");
    expect(writeAs(rootDir, join(run, "report-T02.md"), UX)).toBe("deny");
    expect(writeAs(rootDir, join(run, "notes.md"), UX)).toBe("deny");
    expect(writeAs(rootDir, join(rootDir, ".aidw/changes", ID, "evidence/T02.json"), UX)).toBe("deny");
  });
});

// ---------------------------------------------------------------- the consult gate and the roster

describe("the consult gate for frontend", () => {
  const taskOf = (rootDir: string, id: string) => parseTasks(readFileSync(join(rootDir, ".aidw/changes", ID, "tasks.yaml"), "utf8")).tasks.find((t) => t.id === id)!;

  it("offers ui-ux-designer only once design artifacts exist", () => {
    const without = approvedProject({ tokens: null });
    const offered = taskConsultable(pathsFor(without), ID, taskOf(without, "T02"), plugin);
    expect(offered.roles).not.toContain("ui-ux-designer");
    const withDesign = approvedProject({ design: true });
    expect(taskConsultable(pathsFor(withDesign), ID, taskOf(withDesign, "T02"), plugin).roles).toContain("ui-ux-designer");
  });

  it("tokens alone are design artifacts: they offer ui-ux-designer too", () => {
    const rootDir = approvedProject();
    expect(taskConsultable(pathsFor(rootDir), ID, taskOf(rootDir, "T02"), plugin).roles).toContain("ui-ux-designer");
  });

  it("never offers ui-ux-designer for a backend task, design or not", () => {
    const rootDir = approvedProject({ design: true });
    const offered = taskConsultable(pathsFor(rootDir), ID, taskOf(rootDir, "T01"), plugin);
    expect(offered.role).toBe("backend");
    expect(offered.roles).not.toContain("ui-ux-designer");
  });

  it("never offers the database-architect to frontend, and keeps the declared order", () => {
    expect(loadRole(plugin, "frontend")!.consults).toEqual(["api-designer", "ui-ux-designer", "software-architect"]);
    const rootDir = approvedProject({ design: true });
    write(rootDir, `.aidw/changes/${ID}/data-model.md`, "# Data model\n");
    const offered = taskConsultable(pathsFor(rootDir), ID, taskOf(rootDir, "T02"), plugin).roles;
    expect(offered).not.toContain("database-architect");
    expect(offered).toEqual(["api-designer", "ui-ux-designer", "software-architect"].filter((r) => offered.includes(r))); // order kept
  });

  it("fullstack keeps its old consult list and does not gain ui-ux-designer", () => {
    expect(loadRole(plugin, "fullstack")!.consults).toEqual(["api-designer", "database-architect", "software-architect"]);
    expect(loadRole(plugin, "backend")!.consults).toEqual(["api-designer", "database-architect", "software-architect"]);
  });

  it("the roster passes, and a Role that consults a read-only Role is refused", () => {
    expect(checkRoster(plugin).errors).toEqual([]);
    // copy the plugin's roles, make frontend consult a read-only Role (code-reviewer) and check again
    const copy = mkdtempSync(join(tmpdir(), "aidw-roster-"));
    temps.push(copy);
    for (const d of ["roles", "company"]) if (existsSync(join(plugin, d))) cpDir(join(plugin, d), join(copy, d));
    for (const f of ["roster.yaml", "tiers.yaml", "artifacts.yaml"]) if (existsSync(join(plugin, f))) writeFileSync(join(copy, f), readFileSync(join(plugin, f)));
    const file = join(copy, "roles/frontend/role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^consults:.*$/m, "consults: [api-designer, code-reviewer]"));
    const bad = checkRoster(copy).errors.map((e) => JSON.stringify(e)).join("\n");
    expect(bad).toMatch(/code-reviewer/);
    expect(bad).toMatch(/read-only|cannot answer|consult/i);
  });

  it("ui-ux-designer is consultable now (artifacts access), so the roster accepts it as a target but not a Role that cannot write", () => {
    const copy = mkdtempSync(join(tmpdir(), "aidw-roster-"));
    temps.push(copy);
    for (const d of ["roles", "company"]) if (existsSync(join(plugin, d))) cpDir(join(plugin, d), join(copy, d));
    for (const f of ["roster.yaml", "tiers.yaml", "artifacts.yaml"]) if (existsSync(join(plugin, f))) writeFileSync(join(copy, f), readFileSync(join(plugin, f)));
    const file = join(copy, "roles/ui-ux-designer/role.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^access: artifacts$/m, "access: read-only"));
    expect(checkRoster(copy).errors.map((e) => JSON.stringify(e)).join("\n")).toMatch(/ui-ux-designer/); // frontend consults it, so it must be able to write its answer
  });
});

function cpDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) cpDir(join(from, e.name), join(to, e.name));
    else writeFileSync(join(to, e.name), readFileSync(join(from, e.name)));
  }
}

// ---------------------------------------------------------------- docs and scripts agree

describe("frontend docs and the research report agree", () => {
  const body = readFileSync(join(plugin, "roles/frontend/role.md"), "utf8");
  const report = readFileSync(join(__dirname, "..", "docs/research/frontend-role.md"), "utf8");

  it("every skill role.md names exists as a file, and every file in skills/ is indexed", () => {
    const named = [...body.matchAll(/roles\/frontend\/skills\/([a-z-]+)\.md/g)].map((m) => m[1]!);
    for (const n of new Set(named)) expect(existsSync(join(plugin, "roles/frontend/skills", `${n}.md`)), n).toBe(true);
    const role = loadRole(plugin, "frontend")!;
    const indexed = role.skills.map((s) => s.name).filter((n) => !n.startsWith("library/"));
    const onDisk = readdirSync(join(plugin, "roles/frontend/skills")).map((f) => f.replace(/\.md$/, ""));
    expect(onDisk.sort()).toEqual(indexed.sort());
  });

  it("every `aidw plugin-path` target in role.md exists", () => {
    // roles/frontend/scripts/ comes with the sibling branch that adds the scripts
    for (const m of [...body.matchAll(/aidw plugin-path ([\w./-]+)/g)].filter((x) => !x[1]!.startsWith("roles/frontend/scripts"))) expect(existsSync(join(plugin, m[1]!)), m[1]).toBe(true);
  });

  it("the three first scripts role.md lists are the ones section 5 of the report names", () => {
    const section = /^## 5\.[\s\S]*?(?=^## 6\.)/m.exec(report)?.[0] ?? "";
    expect(section.length).toBeGreaterThan(100);
    const listed = [...body.matchAll(/^- `([a-z0-9-]+)`: /gm)].map((m) => m[1]!).filter((n) => ["token-literals", "a11y-names", "public-env-scan", "fetch-waterfalls", "route-guard-inventory"].includes(n));
    for (const n of listed) expect(section, n).toContain(n);
    expect(listed.sort()).toEqual(["a11y-names", "public-env-scan", "token-literals"]);
    // the two scripts held back are not listed as available
    expect(body).not.toMatch(/^- `(fetch-waterfalls|route-guard-inventory)`/m);
  });

  it("every rule that names a script names one from the report's section 5", () => {
    const section = /^## 5\.[\s\S]*?(?=^## 6\.)/m.exec(report)?.[0] ?? "";
    const rules = readFileSync(join(plugin, "roles/frontend/rules.md"), "utf8");
    for (const m of rules.matchAll(/`(token-literals|a11y-names|public-env-scan|fetch-waterfalls|route-guard-inventory)`/g)) expect(section, m[1]).toContain(m[1]!);
  });

  it("the Vite pack's front matter and the generated frontend agent agree on the Role set", () => {
    const pack = readFileSync(join(plugin, "stacks/vite-react.md"), "utf8");
    expect(pack).toMatch(/^roles: \[frontend, fullstack\]$/m);
    expect(pack).toMatch(/^requires: \{ ui: React \}$/m);
    expect(readFileSync(join(plugin, "agents/frontend.md"), "utf8")).toMatch(/ui-ux-designer/);
    expect(readFileSync(join(plugin, "agents/ui-ux-designer.md"), "utf8")).toMatch(/Consultation/);
  });
});
