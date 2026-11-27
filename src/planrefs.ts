/**
 * What a task carries besides its contract (rpi upgrades T13): code to imitate, the Docs Briefs it builds on, and the
 * checks only a human can make.
 *
 *   patterns: [{ path: src/a.ts:10-40, why: "the store function shape, with its error type" }]   (I3, Q4)
 *   docs: ["next@15.1.3 caching"]                                                              (R8, M13)
 *   manual: ["the reminder email reads well in Gmail on a phone"]                              (I11, M4)
 *
 * `aidw brief` inlines up to three snippets of at most 40 lines and the Answer and Pitfalls of each Docs Brief.
 * `aidw analyze` refuses a pattern whose file or lines are gone, a `docs:` entry with no fresh Docs Brief, and a library
 * the Program Design names (an import in one of its code blocks) that no manifest of the project lists and no task's
 * `docs:` names (OP3). The gate's plan section lists all three; `aidw deliver` warns about a package the Change added to
 * a manifest that no Docs Brief covers.
 */
import { gateLabels } from "./labels.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";
import type { Change } from "./change.js";
import { stateOf } from "./change.js";
import { addedPackages } from "./depsafety.js";
import type { Diags } from "./diag.js";
import { checkDocsBrief, DOCS_BRIEF_DIR, docsBriefName, parseDocsBrief, parseDocsRef, type DocsBriefCheck, type DocsRef } from "./docsbrief.js";
import { changedSince, git } from "./git.js";
import type { PageSection, PageStep } from "./page.js";
import { planInfo, planShape, planSummary } from "./plan.js";
import { fences, fileTreeOf, programDesignParts } from "./programdesign.js";
import type { Paths } from "./project.js";
import type { Task } from "./tasks.js";

/** The analysis.md template from which `aidw analyze` checks patterns, Docs Briefs and the Program Design's libraries. */
export const PLAN_REFS_TEMPLATE = 3;
export const MAX_PATTERNS = 3;
export const MAX_SNIPPET_LINES = 40;
/** The states before the Approval Gate: what the plan points at is judged against today's code only then. */
const BEFORE_GATE = new Set(["draft", "intake", "analyzing", "awaiting_approval"]);

export const owesPlanRefs = (change: Change): boolean => Number(change.data.analysis_template) >= PLAN_REFS_TEMPLATE;

// ------------------------------------------------------------------------------------------------ the fields

export interface PatternRef {
  /** as written: `src/a.ts:10-40` */
  path: string;
  file: string;
  start: number;
  end: number;
  why: string;
}

/** `<file>:<from>-<to>` or `<file>:<line>`, relative to the project root; null when it is not one. */
export function parsePatternPath(path: string): { file: string; start: number; end: number } | null {
  const m = /^([^\s:]+):(\d+)(?:-(\d+))?$/.exec(path.trim());
  if (!m) return null;
  const file = (m[1] as string).replace(/^\.\//, "");
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split("/").includes("..")) return null;
  const start = Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  if (start < 1 || end < start) return null;
  return { file, start, end };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Problems with the shape of `patterns`, `docs` and `manual` on one task (each message follows "task T01"). */
export function planRefProblems(t: Task): string[] {
  const out: string[] = [];
  if (t.patterns !== undefined) {
    if (!Array.isArray(t.patterns)) out.push(': "patterns" must be a list of { path: <file>:<from>-<to>, why: <what to imitate> }');
    else
      t.patterns.forEach((x, i) => {
        const at = `: patterns[${i + 1}]`;
        if (!isRecord(x)) return out.push(`${at} must be { path: <file>:<from>-<to>, why: <what to imitate> }`);
        if (typeof x.path !== "string" || !parsePatternPath(x.path))
          out.push(`${at}: path "${String(x.path ?? "")}" must be a file from the project root with its lines, e.g. src/a.ts:10-40`);
        if (typeof x.why !== "string" || !x.why.trim()) out.push(`${at} needs a "why": what the implementer should imitate there`);
        else if (/[\r\n]/.test(x.why.trim())) out.push(`${at}: "why" must be one line (it heads the snippet in the brief)`);
        return undefined;
      });
  }
  if (t.docs !== undefined) {
    if (!Array.isArray(t.docs)) out.push(': "docs" must be a list of "<lib>@<version> <topic>"');
    else
      for (const e of t.docs) {
        try {
          const r = parseDocsRef(String(e));
          docsBriefName(r.lib, r.version, r.topic);
        } catch (err) {
          out.push(`: docs: ${(err as Error).message}`);
        }
      }
  }
  if (t.manual !== undefined && !(Array.isArray(t.manual) && t.manual.every((x) => typeof x === "string" && x.trim() !== ""))) {
    out.push(': "manual" must be a list of checks a human makes, each a non-empty line');
  } else if (Array.isArray(t.manual))
    t.manual.forEach((x, i) => {
      if (/[\r\n]/.test(String(x).trim())) out.push(`: manual[${i + 1}]: a check must be one line (it is one checklist line in the handoff and the pull request)`);
    });
  return out;
}

export function taskPatterns(t: Task): PatternRef[] {
  if (!Array.isArray(t.patterns)) return [];
  return t.patterns.flatMap((x) => {
    if (!isRecord(x) || typeof x.path !== "string") return [];
    const at = parsePatternPath(x.path);
    return at ? [{ path: x.path.trim(), ...at, why: typeof x.why === "string" ? x.why.trim() : "" }] : [];
  });
}

export function taskDocs(t: Task): { entry: string; ref: DocsRef }[] {
  if (!Array.isArray(t.docs)) return [];
  return t.docs.flatMap((e) => {
    try {
      const ref = parseDocsRef(String(e));
      docsBriefName(ref.lib, ref.version, ref.topic);
      return [{ entry: String(e).trim(), ref }];
    } catch {
      return [];
    }
  });
}

export const taskManual = (t: Task): string[] => (Array.isArray(t.manual) ? t.manual.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);

const linesOf = (text: string): string[] => {
  const l = text.split(/\r?\n/);
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
};

const isFile = (f: string): boolean => existsSync(f) && statSync(f).isFile();

// --------------------------------------------------------------------------------------- libraries (OP3)

export type Ecosystem = "npm" | "pypi" | "go";

export interface NamedLibrary {
  ecosystem: Ecosystem;
  /** the package name as a manifest lists it (pypi: the distribution, e.g. pyyaml for `import yaml`) */
  name: string;
  /** as the code names it: the import specifier's package, the Python module, the Go import path */
  imported: string;
}

/** Python modules whose distribution has another name. */
const PY_DIST: Record<string, string> = {
  yaml: "pyyaml",
  pil: "pillow",
  bs4: "beautifulsoup4",
  sklearn: "scikit-learn",
  cv2: "opencv-python",
  dateutil: "python-dateutil",
  jwt: "pyjwt",
  dotenv: "python-dotenv",
  jose: "python-jose",
  multipart: "python-multipart",
  magic: "python-magic",
  attr: "attrs",
  google: "google-api-python-client",
  psycopg2: "psycopg2-binary",
  serial: "pyserial",
  usb: "pyusb",
  zmq: "pyzmq",
  crypto: "pycryptodome",
  ldap: "python-ldap",
  slugify: "python-slugify",
  socketio: "python-socketio",
  telegram: "python-telegram-bot",
  docx: "python-docx",
  pptx: "python-pptx",
  fitz: "pymupdf",
};

/** The Python standard library modules a Program Design is likely to import (never a manifest entry). */
const PY_STDLIB = new Set(
  (
    "__future__ abc argparse array ast asyncio atexit base64 bisect builtins bz2 calendar cmath codecs collections colorsys concurrent " +
    "configparser contextlib contextvars copy csv ctypes dataclasses datetime decimal difflib dis email encodings enum errno faulthandler " +
    "fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib gzip hashlib heapq hmac html http " +
    "imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox math mimetypes mmap multiprocessing " +
    "netrc numbers operator os pathlib pdb pickle pkgutil platform plistlib poplib pprint profile pstats pty queue quopri random re readline " +
    "reprlib resource sched secrets select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics " +
    "string stringprep struct subprocess sys sysconfig syslog tarfile tempfile termios textwrap threading time timeit tkinter token tokenize " +
    "tomllib trace traceback tracemalloc tty types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser winreg " +
    "wsgiref xml xmlrpc zipapp zipfile zipimport zlib zoneinfo typing_extensions"
  ).split(" "),
);
// typing_extensions is a package, but so common a dependency of what is listed that asking for its Docs Brief is noise.

const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, "").split("/")[0] as string));
const normPy = (s: string): string => s.toLowerCase().replace(/[-_.]+/g, "-");

const SKIP_DIRS = new Set(["node_modules", ".git", ".aidw", "dist", "build", ".next", "vendor", ".venv", "venv", "target", "__pycache__", ".worktrees", "coverage"]);

/** The manifests of the project (up to three folders deep) and every package they list. */
export function manifestLibraries(project: string): { npm: Set<string>; pypi: Set<string>; go: string[]; files: string[] } {
  const npm = new Set<string>();
  const pypi = new Set<string>();
  const go: string[] = [];
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const full = join(dir, n);
      let dirLike = false;
      try {
        dirLike = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (dirLike) {
        if (depth < 3 && !SKIP_DIRS.has(n) && !n.startsWith(".")) visit(full, depth + 1);
        continue;
      }
      const text = () => readFileSync(full, "utf8");
      if (n === "package.json") {
        files.push(full);
        try {
          const pkg = JSON.parse(text()) as Record<string, unknown>;
          if (typeof pkg.name === "string") npm.add(pkg.name.toLowerCase());
          for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
            const deps = pkg[key];
            if (isRecord(deps)) for (const d of Object.keys(deps)) npm.add(d.toLowerCase());
          }
        } catch {
          // an unreadable manifest lists nothing
        }
      } else if (n === "pyproject.toml") {
        files.push(full);
        for (const x of pyprojectNames(text())) pypi.add(normPy(x));
      } else if (/^requirements(?:[-.][\w.-]+)?\.txt$/.test(n) || n === "Pipfile") {
        files.push(full);
        for (const line of text().split(/\r?\n/)) {
          const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
          if (m && !/^\s*(?:#|-|\[)/.test(line)) pypi.add(normPy(m[1] as string));
        }
      } else if (n === "go.mod") {
        files.push(full);
        const t = text();
        const mod = /^module\s+(\S+)/m.exec(t)?.[1];
        if (mod) go.push(mod);
        for (const m of t.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/\S+)\s+v\d/gim)) go.push(m[1] as string);
      }
    }
  };
  visit(project, 0);
  return { npm, pypi, go, files };
}

/** Package names a pyproject.toml lists: its own name, dependency arrays, and keys of dependency tables (poetry). */
function pyprojectNames(text: string): string[] {
  const out: string[] = [];
  let section = "";
  let inArray = false;
  for (const line of text.split(/\r?\n/)) {
    const h = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
    if (h) {
      section = (h[1] as string).trim().toLowerCase();
      inArray = false;
      continue;
    }
    const name = /^\s*name\s*=\s*["']([^"']+)["']/.exec(line);
    if (name && (section === "project" || section === "tool.poetry")) out.push(name[1] as string);
    const key = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$/.exec(line);
    const depSection = /depend|dependency-groups/.test(section);
    if (key && !inArray) {
      const k = (key[1] as string).toLowerCase();
      const rest = key[2] as string;
      if (rest.trim().startsWith("[") && (/depend/.test(k) || depSection)) inArray = true;
      else if (depSection && k !== "python") out.push(key[1] as string);
    }
    if (inArray) {
      for (const m of line.matchAll(/["']\s*([A-Za-z0-9][A-Za-z0-9._-]*)/g)) out.push(m[1] as string);
      if (line.includes("]")) inArray = false;
    }
  }
  return out;
}

const GO_HOSTS = 3;
const JS_LANGS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "javascript", "typescript", "vue", "svelte", "astro"]);
const PY_LANGS = new Set(["py", "python"]);
const GO_LANGS = new Set(["go", "golang"]);

/**
 * The language of a fenced block: a code tag, or (no tag, or a diff) the first file name it mentions. Any other tag
 * (sql, sh, yaml, text, ...) is not code whose imports name libraries: null. A json block, or a diff of package.json,
 * is read for dependency lines.
 */
function blockLanguage(lang: string, text: string): "js" | "py" | "go" | "json" | "unknown" | null {
  if (JS_LANGS.has(lang)) return "js";
  if (PY_LANGS.has(lang)) return "py";
  if (GO_LANGS.has(lang)) return "go";
  if (lang === "json" || lang === "jsonc") return "json";
  if (lang !== "" && lang !== "diff") return null;
  const ext = /[\w./-]+\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|json)\b/.exec(text)?.[1];
  if (!ext) return lang === "diff" ? null : "unknown";
  if (ext === "json") return /(?:^|[\s/])package\.json\b/.test(text) ? "json" : null;
  return ext === "py" ? "py" : ext === "go" ? "go" : "js";
}

const DEP_TABLE = /^\s*"(?:dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/;
const DEP_LINE = /^\s*"((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)"\s*:\s*"((?:[\^~]|>=?)?\s*\d[^"]*|latest|next|\*)"/i;
const NOT_PACKAGES = new Set(["version", "node", "npm", "pnpm", "yarn", "bun"]);

/** The package a JS import specifier names, or null for a relative path, a builtin or an alias. */
function jsPackage(spec: string, local: Set<string>, aliases: string[]): string | null {
  const s = spec.replace(/^npm:/, "");
  if (/^(?:\.|\/|node:|bun:|data:|https?:|jsr:|virtual:|[~#$])/.test(s) || s.startsWith("@/")) return null;
  if (aliases.some((a) => a && s.startsWith(a))) return null;
  const parts = s.split("/");
  const name = (s.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string)).replace(/(?<=.)@.*$/, "");
  if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) return null;
  if (!s.startsWith("@") && (NODE_BUILTINS.has(name) || local.has(name))) return null;
  return name.toLowerCase();
}

/** Import aliases of tsconfig.json / jsconfig.json (`compilerOptions.paths`), without their `*`. */
function tsAliases(project: string): string[] {
  const out: string[] = [];
  for (const f of ["tsconfig.json", "jsconfig.json"]) {
    const file = join(project, f);
    if (!isFile(file)) continue;
    try {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
      const paths = (JSON.parse(text) as { compilerOptions?: { paths?: Record<string, unknown> } }).compilerOptions?.paths ?? {};
      for (const k of Object.keys(paths)) out.push(k.replace(/\*.*$/, ""));
    } catch {
      // a tsconfig that does not parse names no alias
    }
  }
  return out;
}

/**
 * The libraries the Program Design names: the packages its code blocks import (JS and TS `import ... from "x"`,
 * `require("x")`, `import("x")`; Python `import x`, `from x import y`; Go `import "x"`). In a diff only added and
 * context lines count. Relative paths, builtins, the standard library, import aliases and the project's own top-level
 * folders and file-tree paths are not libraries.
 */
export function programDesignLibraries(text: string, project: string): NamedLibrary[] {
  const local = new Set<string>();
  try {
    for (const n of readdirSync(project)) local.add(n.replace(/\.[^.]+$/, ""));
  } catch {
    // no project folder: nothing is local
  }
  for (const t of fileTreeOf(text)) local.add((t.path.split("/")[0] as string).replace(/\.[^.]+$/, ""));
  const aliases = tsAliases(project);
  const goLocal = manifestLibraries(project).go;
  const out = new Map<string, NamedLibrary>();
  const add = (l: NamedLibrary) => out.set(`${l.ecosystem}:${l.name}`, l);
  for (const part of programDesignParts(text).values()) {
    for (const f of fences(part.body)) {
      const lang = blockLanguage(f.lang, f.text);
      if (lang === null) continue;
      const diff = f.lang === "diff";
      let goBlock = false;
      let depTable = false;
      for (const raw of f.text.split("\n")) {
        if (diff && (/^(?:---|\+\+\+|@@)/.test(raw) || raw.startsWith("-"))) continue;
        const line = diff ? raw.replace(/^[+ ]/, "") : raw;
        if (lang === "json") {
          // a dependency of a package.json shown in the Program Design: inside a dependency table, or an added line of a diff
          if (DEP_TABLE.test(line)) depTable = true;
          else if (depTable && /^\s*\}/.test(line)) depTable = false;
          const m = DEP_LINE.exec(line);
          const name = m?.[1]?.toLowerCase();
          if (name && !NOT_PACKAGES.has(name) && (depTable || (diff && raw.startsWith("+")))) add({ ecosystem: "npm", name, imported: name });
          continue;
        }
        if (lang === "go") {
          if (/^\s*import\s*\(\s*$/.test(line)) goBlock = true;
          else if (goBlock && /^\s*\)/.test(line)) goBlock = false;
          const m = goBlock ? /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(line) : /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
          const path = m?.[1];
          if (!path || !(path.split("/")[0] as string).includes(".")) continue;
          if (goLocal.some((g) => path === g || path.startsWith(`${g}/`))) continue;
          add({ ecosystem: "go", name: path.split("/").slice(0, GO_HOSTS).join("/"), imported: path });
          continue;
        }
        if (lang === "js" || lang === "unknown") {
          for (const m of line.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g)) {
            const name = jsPackage(m[1] as string, local, aliases);
            if (name) add({ ecosystem: "npm", name, imported: m[1] as string });
          }
        }
        if ((lang === "py" || lang === "unknown") && !/["'`]/.test(line)) {
          const from = /^\s*from\s+([A-Za-z_]\w*)[\w.]*\s+import\b/.exec(line);
          const imp = /^\s*import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)\s*$/.exec(line);
          const mods = from ? [from[1] as string] : imp ? (imp[1] as string).split(",").map((x) => (x.trim().split(/[.\s]/)[0] as string)) : [];
          for (const mod of mods) {
            const low = mod.toLowerCase();
            if (PY_STDLIB.has(low) || local.has(mod) || local.has(low)) continue;
            add({ ecosystem: "pypi", name: normPy(PY_DIST[low] ?? low), imported: mod });
          }
        }
      }
    }
  }
  return [...out.values()];
}

/** Whether a manifest of the project lists this library. */
function listed(lib: NamedLibrary, m: ReturnType<typeof manifestLibraries>): boolean {
  if (lib.ecosystem === "npm") return m.npm.has(lib.name);
  if (lib.ecosystem === "pypi") return m.pypi.has(lib.name) || m.pypi.has(normPy(lib.imported));
  return m.go.some((g) => lib.imported === g || lib.imported.startsWith(`${g}/`));
}

/** Whether a `docs:` entry (its library) is about this library. */
function docsCover(lib: NamedLibrary, docsLib: string): boolean {
  const d = docsLib.trim().toLowerCase();
  if (lib.ecosystem === "npm") return d === lib.name;
  if (lib.ecosystem === "pypi") return normPy(d) === lib.name || normPy(d) === normPy(lib.imported);
  return lib.imported === d || lib.imported.startsWith(`${d}/`) || d === goShortName(lib.name);
}

// ------------------------------------------------------------------------------------------- aidw analyze

/** The checks of `aidw analyze` on patterns, docs and the Program Design's libraries (a Change of template 3 or later). */
export function checkPlanRefs(p: Paths, change: Change, tasks: Task[], tf: string, d: Diags, opts: { programDesign: string | null }): void {
  if (!owesPlanRefs(change)) return;
  const state = stateOf(change);
  if (state && !BEFORE_GATE.has(state)) return;
  for (const t of tasks) {
    const pats = taskPatterns(t);
    if (pats.length > MAX_PATTERNS) d.warn(tf, `task ${t.id} names ${pats.length} patterns; the brief shows the first ${MAX_PATTERNS}: keep the ones that teach the most`);
    for (const x of pats) {
      const abs = join(p.project, x.file);
      if (!isFile(abs)) {
        d.error(tf, `task ${t.id}: pattern "${x.path}" names ${x.file}, which does not exist: point at code that is there today`);
        continue;
      }
      const n = linesOf(readFileSync(abs, "utf8")).length;
      if (x.end > n) d.error(tf, `task ${t.id}: pattern "${x.path}" ends at line ${x.end}, but ${x.file} has ${n} lines: point at lines that exist`);
      else if (x.end - x.start + 1 > MAX_SNIPPET_LINES) d.warn(tf, `task ${t.id}: pattern "${x.path}" spans ${x.end - x.start + 1} lines; the brief shows the first ${MAX_SNIPPET_LINES}: narrow it to the part to imitate`);
    }
    for (const { entry, ref } of taskDocs(t)) {
      const c = checkDocsBrief(p.aidw, ref);
      if (c.status !== "fresh") {
        d.error(tf, `task ${t.id}: docs "${entry}" has no fresh Docs Brief (${c.status}: ${c.reasons.join("; ")}): spawn Research with docs-research to write ${c.rel} (aidw docs-brief --change ${change.id})`);
      }
    }
  }
  if (opts.programDesign === null) return;
  const manifests = manifestLibraries(p.project);
  const docsLibs = tasks.flatMap((t) => taskDocs(t).map((x) => x.ref.lib));
  for (const lib of programDesignLibraries(opts.programDesign, p.project)) {
    if (listed(lib, manifests) || docsLibs.some((x) => docsCover(lib, x))) continue;
    const where = manifests.files.length ? `no manifest of the project lists it (${[...new Set(manifests.files.map((f) => relative(p.project, f).split(sep).join("/")))].slice(0, 4).join(", ")})` : "the project has no manifest yet";
    d.error(tf, `the Program Design uses ${lib.name} (${lib.ecosystem === "pypi" && lib.imported !== lib.name ? `import ${lib.imported}` : `"${lib.imported}"`}) and ${where}: add "docs: [${lib.ecosystem === "go" ? goShortName(lib.name) : lib.name}@<version> <topic>]" to the task that uses it, so Research writes its Docs Brief before the gate`);
  }
}

// ------------------------------------------------------------------------------------------------ aidw brief

const EXT_LANG: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", py: "python", go: "go", rb: "ruby", rs: "rust", java: "java", kt: "kotlin", cs: "csharp", php: "php", sql: "sql", css: "css", scss: "scss", html: "html", vue: "vue", svelte: "svelte", yaml: "yaml", yml: "yaml", json: "json", md: "markdown", sh: "sh", prisma: "prisma" };

/** The snippets of a task's patterns for its brief: up to three, each at most 40 lines, read from the project. */
export function patternBriefLines(project: string, t: Task): string[] {
  const pats = taskPatterns(t);
  if (!pats.length) return [];
  const out = ["Code in this project to imitate: follow its shape (names, errors, how it is tested). Copy only what this task needs.", ""];
  for (const x of pats.slice(0, MAX_PATTERNS)) {
    out.push(`### \`${x.path}\`${x.why ? `: ${x.why}` : ""}`, "");
    const abs = join(project, x.file);
    const lines = isFile(abs) ? linesOf(readFileSync(abs, "utf8")) : null;
    if (!lines || x.end > lines.length) {
      out.push(`(${x.file} no longer has these lines: read the file and find the code the plan meant.)`, "");
      continue;
    }
    const last = Math.min(x.end, x.start + MAX_SNIPPET_LINES - 1);
    // one backtick longer than the longest run that opens a line (after up to 3 spaces), so the snippet stays one block
    const longest = Math.max(0, ...lines.slice(x.start - 1, last).map((l) => /^ {0,3}(`+)/.exec(l)?.[1]?.length ?? 0));
    const fence = "`".repeat(Math.max(3, longest + 1));
    out.push(`${fence}${EXT_LANG[x.file.split(".").pop()?.toLowerCase() ?? ""] ?? ""}`, ...lines.slice(x.start - 1, last), fence);
    if (last < x.end) out.push(`(lines ${last + 1}-${x.end} cut: read them in the file)`);
    out.push("");
  }
  if (pats.length > MAX_PATTERNS) out.push(`(${pats.length - MAX_PATTERNS} more pattern(s) in tasks.yaml)`, "");
  return out;
}

/** The `## <name>` sections of a Docs Brief, after its front matter. */
function briefSection(text: string, name: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const parts = body.split(/^## +/m).slice(1);
  const hit = parts.find((s) => s.split(/\r?\n/)[0]?.trim().toLowerCase() === name.toLowerCase());
  if (!hit) return "";
  const lines = hit.split(/\r?\n/).slice(1);
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
  while (lines.length && !lines[0]?.trim()) lines.shift();
  return (lines.length > MAX_SNIPPET_LINES ? [...lines.slice(0, MAX_SNIPPET_LINES), "(cut: read the brief)"] : lines).join("\n");
}

/** The Answer and Pitfalls of each Docs Brief a task names, for its brief. */
export function docsBriefLines(p: Paths, t: Task): string[] {
  const docs = taskDocs(t);
  if (!docs.length) return [];
  const out = ["What the official documentation says at the version this project uses (written by Research). Build to it; where the code behaves otherwise, consult Research once.", ""];
  for (const { entry, ref } of docs) {
    const c = checkDocsBrief(p.aidw, ref);
    out.push(`### ${entry} (\`${c.rel}\`, ${c.status})`, "");
    if (c.status === "missing") {
      out.push("No Docs Brief was written. Read the official documentation of this version before using it, and say so in your report.", "");
      continue;
    }
    const text = readFileSync(c.path, "utf8");
    if (c.status !== "fresh") out.push(`(${c.reasons.join("; ")}: check what it says against the installed version.)`, "");
    for (const s of ["Answer", "Pitfalls"]) {
      const b = briefSection(text, s);
      if (b) out.push(`**${s}**`, "", b, "");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- the gate page

const escHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The gate's plan section (layout plan): the shape as figures, one step per task in the stage it runs in, with its
 * patterns, Docs Briefs and checks for the user; the Docs Briefs as links. `pagesDir` is where the page is written.
 */
export function planGateSection(p: Paths, tasks: Task[], pagesDir: string, parallelMax = 1, lang?: string): PageSection {
  const L = gateLabels(lang);
  const shape = planShape(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const briefs: { entry: string; check: DocsBriefCheck }[] = [];
  const manual: string[] = [];
  const steps: PageStep[] = [];
  shape.levels.forEach((ids, i) => {
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) continue;
      const lines: string[] = [];
      const pats = taskPatterns(t);
      if (pats.length) lines.push(`${L.patterns}: ${pats.map((x) => `\`${x.path}\`${x.why ? ` (${x.why})` : ""}`).join("; ")}`);
      const docs = taskDocs(t).map((x) => ({ entry: x.entry, check: checkDocsBrief(p.aidw, x.ref) }));
      briefs.push(...docs.filter((x) => !briefs.some((b) => b.check.rel === x.check.rel)));
      if (docs.length) lines.push(`${L.docs}: ${docs.map((x) => `\`${x.entry}\` (${x.check.status})`).join("; ")}`);
      const checks = taskManual(t);
      manual.push(...checks.map((c) => `**${id}**: ${c}`));
      if (checks.length) lines.push(`${L.forYouToCheck}: ${checks.join("; ")}`);
      const tags = [String(t.role ?? ""), ...(t.risk === "high" ? ["risk: high"] : [])].filter(Boolean);
      steps.push({ title: `${id} ${String(t.title ?? "")}`.trim(), when: `${L.stage} ${i + 1}`, at: "", detail: lines.join("\n"), tags, hot: false, views: [] });
    }
  });
  const figures: Record<string, string> = { [L.tasks]: String(shape.tasks), [L.stages]: String(shape.levels.length), [L.widestStage]: String(shape.width) };
  if (manual.length) figures[L.checksForYou] = String(manual.length);
  const html = briefs.length
    ? `<p><b>${L.docsBriefs}</b> (${L.docsBriefsNote})</p><ul>${briefs
        .map((b) => `<li><a href="${escHtml(relative(pagesDir, b.check.path).split(sep).join("/"))}">${escHtml(b.entry)}</a> <code>${escHtml(b.check.rel)}</code> ${escHtml(b.check.status)}</li>`)
        .join("")}</ul>`
    : "";
  return {
    id: "plan",
    title: L.plan,
    body: planSummary(tasks),
    points: [...planInfo(tasks, parallelMax), ...(manual.length ? [L.planChecksNote, ...manual] : [])],
    html,
    layout: "plan",
    figures,
    steps,
  };
}

// --------------------------------------------------------------------------------------------- aidw deliver

/** The Libraries the Docs Brief store holds a brief for (front matter `lib:`), lower case. */
function briefLibraries(aidw: string): Set<string> {
  const dir = join(aidw, ...DOCS_BRIEF_DIR.split("/"));
  const out = new Set<string>();
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names.filter((x) => x.endsWith(".md"))) {
    const lib = parseDocsBrief(readFileSync(join(dir, n), "utf8")).meta.lib;
    if (lib?.trim()) out.add(lib.trim().toLowerCase());
  }
  return out;
}

/**
 * OP3 at delivery: the packages this Change added to a manifest (package.json, requirements, uv.lock with its
 * pyproject) since the first base commit of its tasks that no Docs Brief covers. Empty outside git or before any task ran.
 */
export function uncoveredPackages(p: Paths, tasks: Task[]): string[] {
  const bases = [...new Set(tasks.map((t) => t.base).filter((b): b is string => typeof b === "string" && !!b))];
  if (!bases.length) return [];
  const base = bases.length === 1 ? bases[0] : git(p.project, ["merge-base", "--octopus", ...bases]).out.trim() || null;
  if (!base) return [];
  const changed = changedSince(p.project, base);
  if (!changed) return [];
  const covered = briefLibraries(p.aidw);
  for (const t of tasks) for (const x of taskDocs(t)) covered.add(x.ref.lib.toLowerCase());
  const coveredPy = new Set([...covered].map(normPy));
  const out = new Set<string>();
  const added = [
    ...addedPackages(p.project, base, changed).map((a) => ({ ecosystem: a.ecosystem as Ecosystem, name: a.name })),
    ...addedManifestEntries(p.project, base, changed),
  ];
  for (const a of added) {
    const hit =
      a.ecosystem === "pypi"
        ? coveredPy.has(normPy(a.name))
        : a.ecosystem === "go"
          ? [...covered].some((c) => a.name.toLowerCase() === c || a.name.toLowerCase().startsWith(`${c}/`) || c === goShortName(a.name))
          : covered.has(a.name.toLowerCase());
    if (!hit) out.add(a.name);
  }
  return [...out];
}

/**
 * A Go module as a docs entry names it: a Docs Brief's file name cannot hold a module path, so `go-redis@9.5.1 ...`
 * stands for github.com/redis/go-redis/v9 (the last segment that is not a major version).
 */
const goShortName = (module: string): string => module.toLowerCase().split("/").filter((x) => !/^v\d+$/.test(x)).pop() ?? "";

/** The file at `base`, or null when it did not exist there. */
const atBase = (dir: string, base: string, file: string): string | null => {
  const r = git(dir, ["show", `${base}:${file}`]);
  return r.ok ? r.out : null;
};

/** The modules a go.mod requires (its own module excluded). */
const goRequires = (text: string | null): string[] =>
  [...(text ?? "").matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]{2,}\/\S+)\s+v\d/gim)].map((m) => m[1] as string);

/**
 * What the Guard of the checkpoint does not read but delivery must: modules a go.mod gained, and dependencies a
 * pyproject.toml gained (Poetry, pip, or uv before its lock is committed). Duplicates of addedPackages are harmless.
 */
function addedManifestEntries(dir: string, base: string, changed: string[]): { ecosystem: Ecosystem; name: string }[] {
  const out: { ecosystem: Ecosystem; name: string }[] = [];
  const read = (f: string) => (isFile(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  for (const file of changed) {
    const name = file.split("/").pop() ?? "";
    if (name === "go.mod") {
      const old = new Set(goRequires(atBase(dir, base, file)));
      for (const m of goRequires(read(file))) if (!old.has(m)) out.push({ ecosystem: "go", name: m });
    } else if (name === "pyproject.toml") {
      const now = read(file) ?? "";
      const own = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(now)?.[1];
      const old = new Set(pyprojectNames(atBase(dir, base, file) ?? "").map(normPy));
      for (const n of pyprojectNames(now)) if (!old.has(normPy(n)) && normPy(n) !== normPy(own ?? "")) out.push({ ecosystem: "pypi", name: normPy(n) });
    }
  }
  return out;
}
