/**
 * Brownfield detection (slice S10, blueprint sections 15-16, decision D-31).
 *
 * `aidw init` and `aidw detect` read the existing project, never change it: package manifest, lockfiles,
 * config files and a count of code files. The result says whether this is a brownfield project, which stack
 * it already uses (Q9: an existing project keeps its stack, source `client`), and which quality-layer
 * commands its own scripts suggest. The Analysis decides; detection only proposes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { git, isGitRepo } from "./git.js";
import { detectPython, pyRun, type PythonTool } from "./pydetect.js";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface Detection {
  kind: "greenfield" | "brownfield";
  /** why the kind was chosen */
  signals: string[];
  packageManager: PackageManager | null;
  /** the tool that runs a Python project (uv, poetry, pipenv or plain pip), or null */
  pythonTool: PythonTool | null;
  languages: string[];
  /** the stack pack (plugins/aidw/stacks/<pack>.md) that covers this project, or null: pick usual equivalents */
  stackPack: string | null;
  /** role -> what was found, e.g. framework: "Next.js 15.2" */
  stack: Record<string, string>;
  scripts: Record<string, string>;
  /** quality layers suggested from the project's own scripts and tools */
  layers: { name: string; run: string[] }[];
  codeFiles: number;
  /** problems to fix before aidw commits anything (missing .gitignore, tracked node_modules) */
  warnings: string[];
}

const SKIP = new Set(["node_modules", ".git", ".aidw", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".output", "dist", "build", "out", "coverage", "vendor", "venv", ".venv", "__pycache__", "target"]);
const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|py|go|rb|java|kt|rs|php|cs|swift)$/;
const MAX_WALK = 20000;

function countCode(dir: string, budget = { left: MAX_WALK }): number {
  let n = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (budget.left-- <= 0) break;
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) n += countCode(full, budget);
    else if (CODE.test(name)) n++;
  }
  return n;
}

const DEPS: { dep: RegExp; role: string; name: string }[] = [
  { dep: /^next$/, role: "framework", name: "Next.js" },
  { dep: /^nuxt$/, role: "framework", name: "Nuxt" },
  { dep: /^@sveltejs\/kit$/, role: "framework", name: "SvelteKit" },
  { dep: /^astro$/, role: "framework", name: "Astro" },
  { dep: /^@remix-run\/react$|^react-router$/, role: "framework", name: "React Router / Remix" },
  { dep: /^@nestjs\/core$/, role: "framework", name: "NestJS" },
  { dep: /^express$/, role: "server", name: "Express" },
  { dep: /^fastify$/, role: "server", name: "Fastify" },
  { dep: /^hono$/, role: "server", name: "Hono" },
  { dep: /^vite$/, role: "bundler", name: "Vite" },
  { dep: /^react$/, role: "ui", name: "React" },
  { dep: /^vue$/, role: "ui", name: "Vue" },
  { dep: /^svelte$/, role: "ui", name: "Svelte" },
  { dep: /^solid-js$/, role: "ui", name: "Solid" },
  { dep: /^tailwindcss$/, role: "styling", name: "Tailwind CSS" },
  { dep: /^styled-components$/, role: "styling", name: "styled-components" },
  { dep: /^@emotion\/react$/, role: "styling", name: "Emotion" },
  { dep: /^sass$/, role: "styling", name: "Sass" },
  { dep: /^@mui\/material$/, role: "components", name: "MUI" },
  { dep: /^@chakra-ui\/react$/, role: "components", name: "Chakra UI" },
  { dep: /^antd$/, role: "components", name: "Ant Design" },
  { dep: /^@radix-ui\//, role: "components", name: "Radix UI" },
  { dep: /^prisma$|^@prisma\/client$/, role: "orm", name: "Prisma" },
  { dep: /^drizzle-orm$/, role: "orm", name: "Drizzle" },
  { dep: /^typeorm$/, role: "orm", name: "TypeORM" },
  { dep: /^mongoose$/, role: "orm", name: "Mongoose" },
  { dep: /^sequelize$/, role: "orm", name: "Sequelize" },
  { dep: /^@supabase\/supabase-js$/, role: "database", name: "Supabase" },
  { dep: /^pg$|^postgres$/, role: "database", name: "PostgreSQL" },
  { dep: /^mysql2$/, role: "database", name: "MySQL" },
  { dep: /^mongodb$/, role: "database", name: "MongoDB" },
  { dep: /^better-sqlite3$|^@libsql\/client$/, role: "database", name: "SQLite" },
  { dep: /^firebase$|^firebase-admin$/, role: "database", name: "Firebase" },
  { dep: /^next-auth$|^@auth\/core$/, role: "auth", name: "Auth.js" },
  { dep: /^@clerk\//, role: "auth", name: "Clerk" },
  { dep: /^better-auth$/, role: "auth", name: "Better Auth" },
  { dep: /^@supabase\/ssr$/, role: "auth", name: "Supabase Auth" },
  { dep: /^vitest$/, role: "unit tests", name: "Vitest" },
  { dep: /^jest$/, role: "unit tests", name: "Jest" },
  { dep: /^@playwright\/test$/, role: "e2e tests", name: "Playwright" },
  { dep: /^@axe-core\/playwright$|^axe-core$/, role: "a11y tests", name: "axe-core" },
  { dep: /^cypress$/, role: "e2e tests", name: "Cypress" },
];

/** Python dependency names (normalised: lower case, `-`) to what they tell about the stack. */
const PY_DEPS: { dep: RegExp; role: string; name: string }[] = [
  { dep: /^django$/, role: "framework", name: "Django" },
  { dep: /^fastapi$/, role: "framework", name: "FastAPI" },
  { dep: /^flask$/, role: "framework", name: "Flask" },
  { dep: /^uvicorn$|^gunicorn$|^hypercorn$/, role: "server", name: "ASGI/WSGI server" },
  { dep: /^sqlalchemy$/, role: "orm", name: "SQLAlchemy" },
  { dep: /^sqlmodel$/, role: "orm", name: "SQLModel" },
  { dep: /^tortoise-orm$/, role: "orm", name: "Tortoise ORM" },
  { dep: /^alembic$/, role: "migrations", name: "Alembic" },
  { dep: /^psycopg2?(-binary)?$|^psycopg-binary$|^asyncpg$/, role: "database", name: "PostgreSQL" },
  { dep: /^pymysql$|^mysqlclient$|^aiomysql$/, role: "database", name: "MySQL" },
  { dep: /^pymongo$|^motor$/, role: "database", name: "MongoDB" },
  { dep: /^pytest$/, role: "unit tests", name: "pytest" },
  { dep: /^playwright$|^pytest-playwright$/, role: "e2e tests", name: "Playwright" },
  { dep: /^ruff$/, role: "linter", name: "Ruff" },
  { dep: /^flake8$/, role: "linter", name: "Flake8" },
  { dep: /^mypy$/, role: "types", name: "mypy" },
  { dep: /^pyright$/, role: "types", name: "Pyright" },
];

const FILES: { file: string; role: string; name: string }[] = [
  { file: "vercel.json", role: "deploy", name: "Vercel" },
  { file: ".vercel", role: "deploy", name: "Vercel" },
  { file: "netlify.toml", role: "deploy", name: "Netlify" },
  { file: "fly.toml", role: "deploy", name: "Fly.io" },
  { file: "railway.json", role: "deploy", name: "Railway" },
  { file: "railway.toml", role: "deploy", name: "Railway" },
  { file: "wrangler.toml", role: "deploy", name: "Cloudflare" },
  { file: "Dockerfile", role: "container", name: "Docker" },
  { file: "components.json", role: "components", name: "shadcn/ui" },
  { file: "supabase/config.toml", role: "database", name: "Supabase" },
];

const LANG_FILES: { file: string; lang: string }[] = [
  { file: "tsconfig.json", lang: "TypeScript" },
  { file: "pyproject.toml", lang: "Python" },
  { file: "requirements.txt", lang: "Python" },
  { file: "Pipfile", lang: "Python" },
  { file: "setup.py", lang: "Python" },
  { file: "go.mod", lang: "Go" },
  { file: "Gemfile", lang: "Ruby" },
  { file: "composer.json", lang: "PHP" },
  { file: "Cargo.toml", lang: "Rust" },
  { file: "pom.xml", lang: "Java" },
];

function packageManager(dir: string, pkg: Record<string, unknown> | null): PackageManager | null {
  const field = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  if (field === "pnpm" || field === "npm" || field === "yarn" || field === "bun") return field;
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  if (existsSync(join(dir, "package-lock.json")) || pkg) return "npm";
  return null;
}

/** `<pm> <script>` and `<pm exec> <bin>` for each package manager. */
export function pmCommands(pm: PackageManager): { script: (s: string) => string; exec: (bin: string) => string } {
  switch (pm) {
    case "pnpm":
      return { script: (s) => `pnpm ${s}`, exec: (b) => `pnpm exec ${b}` };
    case "yarn":
      return { script: (s) => `yarn ${s}`, exec: (b) => `yarn ${b}` };
    case "bun":
      return { script: (s) => `bun run ${s}`, exec: (b) => `bunx ${b}` };
    default:
      return { script: (s) => (s === "test" ? "npm test" : `npm run ${s}`), exec: (b) => `npx ${b}` };
  }
}

const JUNK_DIRS = ["node_modules", ".next", ".nuxt", ".svelte-kit", ".turbo", ".venv", ".pytest_cache", ".mypy_cache", ".ruff_cache"];
/** Generated files that are often committed by accident (tsc incremental state, Next's type shim). */
const JUNK_FILES = ["tsconfig.tsbuildinfo", "next-env.d.ts", ".DS_Store"];

/** Repo hygiene aidw depends on: it commits per task with `git add -A`, so dependencies must be ignored. */
/** Workspace markers: package-scoped touches, verify and layers are not supported yet (docs/roadmap.md). */
const WORKSPACE_FILES = ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json"];

const nonEmpty = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : !!v);

/** A pnpm-workspace.yaml is a workspace only when it lists `packages:`; a file of settings (allowBuilds, ...) is not. */
function pnpmWorkspaceHasPackages(file: string): boolean {
  try {
    const doc = YAML.parse(readFileSync(file, "utf8")) as { packages?: unknown } | null;
    return nonEmpty(doc?.packages);
  } catch {
    return false;
  }
}

/** Names the monorepo tool when the project is a workspace, else null. */
export function monorepoSignal(dir: string): string | null {
  const file = WORKSPACE_FILES.find((f) => existsSync(join(dir, f)) && (f !== "pnpm-workspace.yaml" || pnpmWorkspaceHasPackages(join(dir, f))));
  if (file) return file;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { workspaces?: unknown };
    const ws = pkg.workspaces;
    const list = ws && typeof ws === "object" && !Array.isArray(ws) ? (ws as { packages?: unknown }).packages : ws;
    if (nonEmpty(list)) return "package.json workspaces";
  } catch {
    // no readable package.json
  }
  return null;
}

export function repoWarnings(dir: string, hasPackage: boolean): string[] {
  const out: string[] = [];
  const mono = monorepoSignal(dir);
  if (mono) out.push(`monorepo detected (${mono}): aidw does not support workspaces yet. Run it in a single package, or expect task Touches, verify commands and quality layers to need manual care`);
  const ignoreText = existsSync(join(dir, ".gitignore")) ? readFileSync(join(dir, ".gitignore"), "utf8") : null;
  if (hasPackage && ignoreText === null) out.push("no .gitignore: add one with node_modules/, .venv/, __pycache__/, .next/, test-results/, *.tsbuildinfo, next-env.d.ts and .env*.local before the first task (aidw commits with `git add -A`)");
  if (!isGitRepo(dir)) return out;
  for (const d of JUNK_DIRS) {
    const tracked = git(dir, ["ls-files", "--", d]).out;
    if (tracked) out.push(`${d}/ is tracked by git (${tracked.split("\n").length} file(s)): run \`git rm -r -q --cached ${d}\`, ignore it in .gitignore and commit`);
    else if (existsSync(join(dir, d)) && !git(dir, ["check-ignore", "-q", d]).ok) out.push(`${d}/ exists but is not ignored by .gitignore: add "${d}/" before aidw commits`);
  }
  for (const f of JUNK_FILES) {
    if (git(dir, ["ls-files", "--", f]).out) out.push(`${f} is tracked by git: it is generated; run \`git rm -q --cached ${f}\`, ignore it in .gitignore and commit`);
  }
  return out;
}

export function detectProject(dir: string): Detection {
  let pkg: Record<string, unknown> | null = null;
  const pkgFile = join(dir, "package.json");
  if (existsSync(pkgFile)) {
    try {
      pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as Record<string, unknown>;
    } catch {
      pkg = {};
    }
  }
  const deps: Record<string, string> = { ...((pkg?.dependencies as Record<string, string>) ?? {}), ...((pkg?.devDependencies as Record<string, string>) ?? {}) };
  const depNames = Object.keys(deps);
  const pyDepCount = (() => { try { return Object.keys(detectPython(dir)?.deps ?? {}).length; } catch { return 0; } })();
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};
  const codeFiles = countCode(dir);

  const stack: Record<string, string> = {};
  for (const { dep, role, name } of DEPS) {
    const hit = depNames.find((d) => dep.test(d));
    if (!hit || stack[role]) continue;
    const version = String(deps[hit] ?? "").replace(/^[\^~>=<\s]+/, "").split(" ")[0];
    stack[role] = version && /^\d/.test(version) ? `${name} ${version}` : name;
  }
  const py = detectPython(dir);
  for (const { dep, role, name } of PY_DEPS) {
    const hit = py ? Object.keys(py.deps).find((d) => dep.test(d)) : undefined;
    if (!hit || stack[role]) continue;
    const v = py?.deps[hit] ?? "";
    stack[role] = v && role !== "database" ? `${name} ${v}` : name; // a driver's version is not the database's
  }
  if (py?.configured.ruff && !stack.linter) stack.linter = "Ruff";
  if (py?.configured.pytest && !stack["unit tests"]) stack["unit tests"] = "pytest";
  if (py?.configured.mypy && !stack.types) stack.types = "mypy";
  for (const { file, role, name } of FILES) if (!stack[role] && existsSync(join(dir, file))) stack[role] = name;

  const languages = new Set<string>();
  if (pkg) languages.add(depNames.includes("typescript") || existsSync(join(dir, "tsconfig.json")) ? "TypeScript" : "JavaScript");
  for (const { file, lang } of LANG_FILES) if (existsSync(join(dir, file))) languages.add(lang);

  const pm = packageManager(dir, pkg);
  const signals: string[] = [];
  if (depNames.length) signals.push(`package.json with ${depNames.length} dependencies`);
  if (codeFiles) signals.push(`${codeFiles} code file(s) outside dependencies and build output`);
  const commits = isGitRepo(dir) ? Number(git(dir, ["rev-list", "--count", "HEAD"]).out) || 0 : 0;
  if (commits > 1) signals.push(`git history: ${commits} commits`);
  for (const l of languages) if (l !== "TypeScript" && l !== "JavaScript") signals.push(`${l} project files`);
  if (pyDepCount) signals.push(`Python project with ${pyDepCount} dependencies`);
  const kind = depNames.length > 0 || pyDepCount > 0 || codeFiles > 0 ? "brownfield" : "greenfield";

  const layers: Detection["layers"] = [];
  if (pm) {
    const c = pmCommands(pm);
    const has = (s: string) => typeof scripts[s] === "string";
    const first = (...names: string[]) => names.find(has);
    const code = [
      ...(has("lint") ? [c.script("lint")] : []),
      ...(first("typecheck", "type-check", "tsc") ? [c.script(first("typecheck", "type-check", "tsc") as string)] : languages.has("TypeScript") ? [c.exec("tsc --noEmit")] : []),
      ...(has("build") ? [c.script("build")] : []),
    ];
    if (code.length) layers.push({ name: "code", run: code });
    const unit = first("test:unit", "test");
    if (unit && !/no test specified/.test(scripts[unit] ?? "")) layers.push({ name: "unit", run: [c.script(unit)] });
    const e2e = first("test:e2e", "e2e");
    if (e2e) layers.push({ name: "e2e", run: [c.script(e2e)] });
    else if (stack["e2e tests"]?.startsWith("Playwright")) layers.push({ name: "e2e", run: [c.exec("playwright test")] });
    else if (stack["e2e tests"]?.startsWith("Cypress")) layers.push({ name: "e2e", run: [c.exec("cypress run")] });
  }
  if (py) {
    const run = pyRun(py.tool);
    const known = (name: string) => Object.keys(py.deps).includes(name);
    const add = (name: string, cmds: string[]) => {
      const l = layers.find((x) => x.name === name);
      if (l) l.run.push(...cmds);
      else if (cmds.length) layers.push({ name, run: cmds });
    };
    add("code", [
      ...(known("ruff") || py.configured.ruff ? [`${run} ruff check .`] : known("flake8") ? [`${run} flake8`] : []),
      ...(known("mypy") || py.configured.mypy ? [`${run} mypy .`] : known("pyright") ? [`${run} pyright`] : []),
    ]);
    if (known("pytest") || py.configured.pytest) add("unit", [`${run} pytest`]);
  }
  return { kind, signals, packageManager: pm, pythonTool: py?.tool ?? null, languages: [...languages], stackPack: pkg ? "node" : py ? "python" : null, stack, scripts, layers, codeFiles, warnings: repoWarnings(dir, pkg !== null || py !== null) };
}
