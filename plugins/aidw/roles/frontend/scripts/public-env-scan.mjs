#!/usr/bin/env node
// public-env-scan: environment variables read in client code and whether each is public, secret-looking names with
// a public prefix, and server-only modules imported into client code. A frontend Role tool for rule F10 (advisory).
// Prints names and places only, never a value. Node built-ins only.
const HELP = `
Usage: node public-env-scan.mjs [dir] [--base <ref>] [--framework <name>] [--text]

Finds which files of [dir] (default: the working directory) run in the browser and lists:
  reads                  environment variables read in client files, each with "public": true when its name has the
                         framework's public prefix (a name without it is undefined or a leak in the browser)
  secretLooking          names with a public prefix that look secret (KEY, SECRET, TOKEN, PASSWORD, PRIVATE as a
                         word of the name: rule F10's list), read anywhere or listed in .env.example; names with
                         PUBLISHABLE, ANON or DSN are left out (those values are meant for the browser)
  serverImportsInClient  imports into a client file of server-only modules: server-only, $lib/server/..., $env/static/private,
                         $env/dynamic/private, a *.server.* file, a server/ folder of SvelteKit, or a local module that
                         itself imports server-only

The framework comes from package.json (or --framework): next (NEXT_PUBLIC_), vite (VITE_, or envPrefix from
vite.config; only for a client app: react, vue, svelte or preact in the dependencies, or an index.html with a vite
config, so a backend with vite only for vitest is not a Vite app), sveltekit (PUBLIC_), astro (PUBLIC_), nuxt (no prefix: process.env is not public in the browser; use
runtimeConfig.public), cra (REACT_APP_), gatsby (GATSBY_), expo (EXPO_PUBLIC_). Client files:
  every framework  a file starting with 'use client', and the local modules a client file imports (transitively,
                   relative paths and the @/ and ~/ aliases)
  vite, cra        every file under src/ except *.server.* files and files that import 'server-only' (all of
                   src/** is client code in a SPA)
  gatsby           the same, but not src/api/ (Gatsby Functions)
  expo             the same, but not *+api.* files (Expo Router API routes)
  sveltekit        src/ files but +page.server.*, +layout.server.*, +server.*, hooks.server.*, src/lib/server/, *.server.*
  nuxt             components/, composables/, layouts/, pages/, plugins/ (not *.server.*), utils/, and app/ for Nuxt 4
Remix, React Router framework mode and TanStack Start keep their code in app/ and run it on both sides; they are not
supported: the framework is "none" and "skipped" says so (only 'use client' files and what they import are read; pass
--framework to force one). NODE_ENV and Vite's built-ins (MODE, DEV, PROD, SSR, BASE_URL) are never listed. Test files are not scanned.

Options:
  --base <ref>        only reads and imports on lines added since <ref>; which files are client files still comes
                      from the whole tree
  --framework <name>  one of next, vite, sveltekit, astro, nuxt, cra, gatsby, expo, none
  --text              short text instead of JSON
  --help              this text

Output (JSON): { tool, schemaVersion: 1, root, base, framework, publicPrefix: [prefix], clientFiles: n,
  reads: [{ file, line, name, public }], secretLooking: [{ name, file, line }], serverImportsInClient: [{ file,
  line, from }], skipped }
"reads" keeps the first read of a name in each file. "skipped" lists what was not read: public/ and static/ output,
*.min.* and *.bundle.*, files over 512 KB, unreadable files, files with a template literal that never closes, and
the unsupported framework note. .env.example is read for names only; .env is never opened.

Limits: next.config's env: {} and Vite's define are not read; a name built at run time is not seen; a Next.js
pages/ file runs on both sides and counts as client only when it starts with 'use client' or a client file imports
it; .vue and .svelte files come later.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { changedSince, inStringOf, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, projectRoot, runCli, UsageError } from "../../../library/scripts/_common.mjs";

const FRAMEWORKS = {
  next: ["NEXT_PUBLIC_"],
  vite: ["VITE_"],
  sveltekit: ["PUBLIC_"],
  astro: ["PUBLIC_"],
  nuxt: [],
  cra: ["REACT_APP_"],
  gatsby: ["GATSBY_"],
  expo: ["EXPO_PUBLIC_"],
  none: [],
};
const BUILT_INS = new Set(["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL"]);
const SECRET_WORD = /(?:^|_)(KEYS?|SECRETS?|TOKENS?|PASSWORD|PRIVATE)(?:_|$)/; // rule F10's list
const MEANT_PUBLIC = /(?:^|_)(PUBLISHABLE|ANON|DSN)(?:_|$)/;
const NAME = "[A-Za-z_][A-Za-z0-9_]*";

const UNSUPPORTED = { "@remix-run/react": "Remix", "@remix-run/node": "Remix", "@react-router/dev": "React Router framework mode", "@react-router/node": "React Router framework mode", "@tanstack/react-start": "TanStack Start", "@tanstack/start": "TanStack Start" };

/** The framework from package.json dependencies: { framework, unsupported? } (unsupported: a framework that keeps its code in app/). */
function detect(root) {
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")); } catch { /* no package.json: none */ }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const known = deps.next ? "next" : deps["@sveltejs/kit"] ? "sveltekit" : deps.nuxt ? "nuxt" : deps.astro ? "astro" : deps.gatsby ? "gatsby"
    : deps.expo ? "expo" : deps["react-scripts"] ? "cra" : null;
  if (known) return { framework: known };
  const other = Object.keys(UNSUPPORTED).find((d) => deps[d]);
  if (other) return { framework: "none", unsupported: UNSUPPORTED[other] };
  if (!deps.vite) return { framework: "none" };
  // vite counts only for a client app: vitest alone in a backend's devDependencies does not make src/ client code
  const viteConfig = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"].some((f) => existsSync(join(root, f)));
  const clientApp = ["react", "vue", "svelte", "preact"].some((d) => deps[d]) || (existsSync(join(root, "index.html")) && viteConfig);
  return { framework: clientApp ? "vite" : "none" };
}

/** Vite's envPrefix when vite.config sets it literally, else null. */
function vitePrefix(root) {
  for (const f of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    if (!existsSync(join(root, f))) continue;
    const code = maskComments(readFileSync(join(root, f), "utf8"));
    const m = /\benvPrefix\s*:\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/.exec(code);
    if (m) return [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
  }
  return null;
}

/** Is the file client code by its place, for the framework? ('use client' and imports are added later.) */
function clientByPlace(fw, file) {
  if (/\.server\.[cm]?[jt]sx?$/.test(file)) return false;
  if (["vite", "cra"].includes(fw)) return file.startsWith("src/");
  if (fw === "gatsby") return file.startsWith("src/") && !file.startsWith("src/api/");
  if (fw === "expo") return file.startsWith("src/") && !/\+api\.[cm]?[jt]sx?$/.test(file);
  if (fw === "sveltekit") return file.startsWith("src/") && !/(^|\/)(\+page\.server|\+layout\.server|\+server|hooks\.server)\.[cm]?[jt]s$/.test(file) && !file.startsWith("src/lib/server/");
  if (fw === "nuxt") return /^(app\/)?(components|composables|layouts|pages|plugins|utils)\//.test(file);
  return false;
}

const USE_CLIENT = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use client["']/;
const IMPORT = /\b(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

/** `import type ...`, `export type ...` and `import { type A, type B } ...` are erased at build time: no import at run time. */
function typeOnly(text) {
  if (/^(?:import|export)\s+type\s+(?!from\b)/.test(text)) return true;
  const names = /^(?:import|export)\s*\{([^}]*)\}/.exec(text);
  return !!names && names[1].split(",").map((x) => x.trim()).filter(Boolean).every((x) => /^type\s+\w/.test(x));
}

/** Imports of a file: [{ from, index }] (type-only ones left out). */
function imports(code) {
  const inString = inStringOf(code);
  const out = [];
  for (const m of code.matchAll(IMPORT)) {
    if (inString(m.index) || typeOnly(m[0])) continue;
    out.push({ from: m[1] ?? m[2] ?? m[3], index: m.index });
  }
  return out;
}

/** A local import resolved to a scanned file (relative, @/ and ~/ aliases), or null. */
function resolveLocal(from, file, known) {
  let base;
  if (from.startsWith(".")) base = normalize(join(dirname(file), from)).split("\\").join("/");
  else if (/^[@~]\//.test(from)) base = from.slice(2);
  else return null;
  const stem = base.replace(/\.[cm]?jsx?$/, ""); // TypeScript writes "./a.js" for ./a.ts
  const tries = [base, ...(stem !== base ? JS_EXTS.map((x) => stem + x) : []), ...JS_EXTS.map((x) => base + x), ...JS_EXTS.map((x) => `${base}/index${x}`)];
  if (/^[@~]\//.test(from)) tries.push(...tries.map((t) => `src/${t}`));
  return tries.find((t) => known.has(t)) ?? null;
}

const serverOnlyModule = (from) => from === "server-only" || /^\$lib\/server(\/|$)/.test(from) || /^\$env\/(static|dynamic)\/private$/.test(from) || /\.server(\.[cm]?[jt]sx?)?$/.test(from);

/** Environment reads of one file: [{ name, index, module? }]; module is "public" or "private" for a SvelteKit $env import. */
function envReads(code) {
  const inString = inStringOf(code);
  const found = [];
  const patterns = [
    new RegExp(`\\bprocess\\.env(?:\\?)?\\.(${NAME})`, "g"),
    new RegExp(`\\bprocess\\.env(?:\\?\\.)?\\s*\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
    new RegExp(`\\bimport\\.meta\\.env\\.(${NAME})`, "g"),
    new RegExp(`\\bimport\\.meta\\.env\\s*\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) if (!inString(m.index)) found.push({ name: m[1], index: m.index });
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g)) if (!inString(m.index)) {
    for (const part of m[1].split(",")) {
      const n = new RegExp(`^\\s*(${NAME})\\s*(?::|=|$)`).exec(part);
      if (n) found.push({ name: n[1], index: m.index });
    }
  }
  // SvelteKit: import { PUBLIC_X } from '$env/static/public' (and the private ones, which are also server imports)
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\$env\/static\/(public|private)["']/g)) if (!inString(m.index)) {
    for (const part of m[1].split(",")) {
      const n = new RegExp(`^\\s*(${NAME})`).exec(part);
      if (n) found.push({ name: n[1], index: m.index, module: m[2] });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

const exampleNames = (text) => text.split(/\r?\n/).flatMap((line, i) => {
  const m = new RegExp(`^\\s*(?:#\\s*)?(?:export\\s+)?(${NAME})\\s*=`).exec(line);
  return m ? [{ name: m[1], line: i + 1 }] : [];
});

await runCli({
  tool: "public-env-scan",
  help: HELP,
  options: { base: { type: "string" }, framework: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    if (values.framework && !(values.framework in FRAMEWORKS)) throw new UsageError(`unknown framework "${values.framework}": one of ${Object.keys(FRAMEWORKS).join(", ")}. See --help.`);
    const detected = values.framework ? { framework: values.framework } : detect(root);
    const framework = detected.framework;
    const publicPrefix = (framework === "vite" && vitePrefix(root)) || FRAMEWORKS[framework];
    const isPublic = (name) => publicPrefix.some((p) => name.startsWith(p));
    const changed = values.base ? changedSince(root, values.base) : null;
    const counts = (file, n) => !changed || isAdded(changed, file, n);

    const { sources, skipped } = loadSources(root, JS_EXTS, { checkTemplates: true });
    if (detected.unsupported) skipped.push({ file: "package.json", reason: `${detected.unsupported} is not supported (its code is in app/ and runs on both sides): only 'use client' files and what they import were read; pass --framework to force one` });
    const files = new Map();
    for (const s of sources) if (!isTestFile(s.file)) files.set(s.file, { src: s.src, code: maskComments(s.src) });
    const known = new Set(files.keys());
    const importsOf = new Map([...files].map(([f, { code }]) => [f, imports(code)]));
    const isServerOnly = (f) => importsOf.get(f)?.some((i) => i.from === "server-only") ?? false;

    // client files: by place or 'use client', then every local module they import
    const client = new Set([...files].filter(([f, { src }]) => USE_CLIENT.test(src) || (clientByPlace(framework, f) && !isServerOnly(f))).map(([f]) => f));
    const queue = [...client];
    while (queue.length) {
      const f = queue.pop();
      for (const i of importsOf.get(f) ?? []) {
        const t = resolveLocal(i.from, f, known);
        if (!t || client.has(t) || isServerOnly(t) || /\.server\.[cm]?[jt]sx?$/.test(t) || /^["']use server["']/.test(files.get(t).code.trimStart())) continue;
        client.add(t);
        queue.push(t);
      }
    }

    const reads = [];
    const secret = new Map();
    const serverImportsInClient = [];
    const looksSecret = (name) => isPublic(name) && SECRET_WORD.test(name.slice(publicPrefix.find((p) => name.startsWith(p)).length)) && !MEANT_PUBLIC.test(name);
    for (const [file, { src, code }] of files) {
      const line = lineIndex(src);
      const seen = new Set();
      for (const r of envReads(code)) {
        if (BUILT_INS.has(r.name)) continue;
        const n = line(r.index);
        if (!counts(file, n)) continue;
        if (looksSecret(r.name) && !secret.has(r.name)) secret.set(r.name, { name: r.name, file, line: n });
        if (!client.has(file) || seen.has(r.name)) continue;
        seen.add(r.name);
        reads.push({ file, line: n, name: r.name, public: r.module ? r.module === "public" : isPublic(r.name) });
      }
      if (!client.has(file)) continue;
      for (const i of importsOf.get(file)) {
        const n = line(i.index);
        if (!counts(file, n)) continue;
        const t = resolveLocal(i.from, file, known);
        const svelteServer = framework === "sveltekit" && t && (t.startsWith("src/lib/server/") || /(^|\/)server\//.test(t));
        if (serverOnlyModule(i.from) || (t && (isServerOnly(t) || svelteServer))) serverImportsInClient.push({ file, line: n, from: i.from });
      }
    }
    for (const ex of [".env.example", ".env.sample", ".env.template"]) {
      if (!existsSync(join(root, ex))) continue;
      for (const e of exampleNames(readFileSync(join(root, ex), "utf8"))) if (looksSecret(e.name) && !secret.has(e.name) && counts(ex, e.line)) secret.set(e.name, { name: e.name, file: ex, line: e.line });
    }
    const bySite = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
    return {
      root,
      base: values.base ?? null,
      framework,
      publicPrefix,
      clientFiles: client.size,
      reads: reads.sort((a, b) => bySite(a, b) || a.name.localeCompare(b.name)),
      secretLooking: [...secret.values()].sort((a, b) => a.name.localeCompare(b.name)),
      serverImportsInClient: serverImportsInClient.sort(bySite),
      skipped,
    };
  },
  text(r) {
    const out = [`framework: ${r.framework}; public prefix: ${r.publicPrefix.join(", ") || "(none)"}; client files: ${r.clientFiles}`];
    const priv = r.reads.filter((x) => !x.public);
    out.push(`read in client code without the public prefix (${priv.length}):`, ...priv.map((x) => `  ${x.name}  ${x.file}:${x.line}`));
    out.push(`public reads in client code: ${r.reads.length - priv.length}`);
    out.push(`secret-looking public names (${r.secretLooking.length}):`, ...r.secretLooking.map((x) => `  ${x.name}  ${x.file}:${x.line}`));
    out.push(`server-only imports in client code (${r.serverImportsInClient.length}):`, ...r.serverImportsInClient.map((x) => `  ${x.from}  ${x.file}:${x.line}`));
    return out.join("\n") + "\n";
  },
});
