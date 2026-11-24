#!/usr/bin/env node
// env-names: the environment variable names the code reads, against the names .env.example lists.
// A backend Role tool for rule B13 (advisory). Prints names and places only, never a value. Node built-ins only.
const HELP = `
Usage: node env-names.mjs [dir] [--base <ref>] [--example <file>] [--config <file>]... [--ignore <NAME>]... [--text]

Finds the environment variable names the code in [dir] (default: the working directory) reads and compares them
with the names listed in .env.example. Three lists:
  readNotListed      read by the code, not in .env.example (with the first place it is read)
  listedNotRead      in .env.example, read nowhere in the code
  readOutsideConfig  read outside the config module (B13: read once, in one validated config module)
plus "dynamic": places that read process.env[someVariable], whose name cannot be known statically.

Reads: process.env.X, process.env['X'], const { X, Y: y } = process.env, import.meta.env.X, Bun.env.X,
Deno.env.get('X'); os.environ['X'], os.environ.get('X'), os.getenv('X'), environ.get('X'), env('X') and env.str('X')
(django-environ). Test files are not scanned (setting a variable in a test is not reading it in the code).
NODE_ENV and Vite's built-ins (MODE, DEV, PROD, SSR, BASE_URL) are never flagged.

The config module is any file named env.*, config.*, settings.*, environment.* or *.config.*, or under a config/
or settings/ folder, unless --config names the files.

Options:
  --base <ref>      only the reads on lines added since <ref> count for readNotListed and readOutsideConfig;
                    listedNotRead still looks at the whole tree
  --example <file>  the example file, relative to [dir] (default .env.example, then .env.sample, .env.template)
  --config <file>   a config module file relative to [dir]; repeat for several
  --ignore <NAME>   a name never flagged; repeat for several
  --text            short text instead of JSON
  --help            this text

Output (JSON): { root, base, example, configFiles, read: [{ name, sites: [{ file, line }] }], readNotListed:
  [{ name, file, line }], listedNotRead: [name], readOutsideConfig: [{ name, file, line }], dynamic: [{ file, line }] }
The example file is read for names only (NAME=..., export NAME=..., or a commented "# NAME=" line); .env itself is
never opened.

Limits: names built at run time are only reported as "dynamic"; settings classes (pydantic BaseSettings, a Nest
ConfigService.get('X')) are not read as names.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inStringOf, changedSince, isAdded, isPython, isTestFile, JS_EXTS, lineIndex, maskComments, projectRoot, PY_EXTS, read, runCli, UsageError, walk } from "./_common.mjs";

const ALWAYS_IGNORED = ["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL"];
const NAME = "[A-Za-z_][A-Za-z0-9_]*";

const isConfigFile = (file) => {
  const base = file.split("/").pop();
  return /^(env|config|settings|environment)(\.[\w-]+)*\.(m?[jt]sx?|c[jt]s|py)$/.test(base) || /\.config\.[cm]?[jt]s$/.test(base) || /(^|\/)(config|settings)\//.test(file);
};

/** Every read of a name in one file: [{ name, index }] and the dynamic reads [{ index }]. */
function reads(file, src) {
  const python = isPython(file);
  const code = maskComments(src, python);
  const inString = inStringOf(code, python);
  const found = [];
  const dynamic = [];
  const patterns = python
    ? [
        new RegExp(`\\b(?:os\\.)?environ\\s*\\[\\s*["'](${NAME})["']\\s*\\]`, "g"),
        new RegExp(`\\b(?:os\\.)?environ\\.get\\s*\\(\\s*["'](${NAME})["']`, "g"),
        new RegExp(`\\bos\\.getenv\\s*\\(\\s*["'](${NAME})["']`, "g"),
        ...(/environ\.Env\s*\(/.test(code) ? [new RegExp(`\\benv(?:\\.\\w+)?\\s*\\(\\s*["'](${NAME})["']`, "g")] : []),
      ]
    : [
        new RegExp(`\\bprocess\\.env\\.(${NAME})`, "g"),
        new RegExp(`\\bprocess\\.env\\s*\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
        new RegExp(`\\bimport\\.meta\\.env\\.(${NAME})`, "g"),
        new RegExp(`\\bBun\\.env\\.(${NAME})`, "g"),
        new RegExp(`\\bDeno\\.env\\.get\\s*\\(\\s*["'\`](${NAME})["'\`]`, "g"),
      ];
  for (const re of patterns) for (const m of code.matchAll(re)) if (!inString(m.index)) found.push({ name: m[1], index: m.index });
  if (!python) {
    for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g)) if (!inString(m.index)) {
      for (const part of m[1].split(",")) {
        const n = new RegExp(`^\\s*(${NAME})\\s*(?::|=|$)`).exec(part);
        if (n) found.push({ name: n[1], index: m.index });
      }
    }
    for (const m of code.matchAll(/\bprocess\.env\s*\[(?!\s*["'`])/g)) if (!inString(m.index)) dynamic.push({ index: m.index });
  } else {
    for (const m of code.matchAll(/\b(?:os\.environ\s*\[|os\.environ\.get\s*\(|os\.getenv\s*\()(?!\s*["'])/g)) if (!inString(m.index)) dynamic.push({ index: m.index });
  }
  return { found, dynamic };
}

/** Names listed in an example file: NAME=, export NAME=, # NAME= (a documented optional one) or a bare NAME. */
function listedNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = new RegExp(`^\\s*(?:#\\s*)?(?:export\\s+)?(${NAME})\\s*=`).exec(line) ?? new RegExp(`^\\s*(${NAME})\\s*$`).exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

const bySite = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name);

await runCli({
  help: HELP,
  options: { base: { type: "string" }, example: { type: "string" }, config: { type: "string", multiple: true }, ignore: { type: "string", multiple: true } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const changed = values.base ? changedSince(root, values.base) : null;
    let example = null;
    if (values.example) {
      if (!existsSync(join(root, values.example))) throw new UsageError(`no example file at ${values.example}`);
      example = values.example;
    } else example = [".env.example", ".env.sample", ".env.template"].find((f) => existsSync(join(root, f))) ?? null;
    const listed = example ? listedNames(readFileSync(join(root, example), "utf8")) : new Set();
    const ignored = new Set([...ALWAYS_IGNORED, ...(values.ignore ?? [])]);
    const configSet = values.config ? new Set(values.config.map((f) => f.replace(/^\.\//, ""))) : null;
    const inConfig = (file) => (configSet ? configSet.has(file) : isConfigFile(file));

    const sites = new Map(); // name -> [{ file, line }], whole tree
    const added = []; // { name, file, line } on lines that count (all lines without --base)
    const dynamic = [];
    const configFiles = new Set();
    for (const file of walk(root, [...JS_EXTS, ...PY_EXTS])) {
      if (isTestFile(file)) continue;
      const src = read(root, file);
      const { found, dynamic: dyn } = reads(file, src);
      if (found.length === 0 && dyn.length === 0) continue;
      const line = lineIndex(src);
      if (inConfig(file)) configFiles.add(file);
      for (const f of found) {
        const site = { file, line: line(f.index) };
        if (!sites.has(f.name)) sites.set(f.name, []);
        if (!sites.get(f.name).some((s) => s.file === site.file && s.line === site.line)) sites.get(f.name).push(site);
        if (!changed || isAdded(changed, file, site.line)) added.push({ name: f.name, ...site });
      }
      for (const d of dyn) {
        const site = { file, line: line(d.index) };
        if ((!changed || isAdded(changed, file, site.line)) && !dynamic.some((d) => d.file === file && d.line === site.line)) dynamic.push(site);
      }
    }
    const unique = (list) => list.filter((x, i) => list.findIndex((y) => y.name === x.name && y.file === x.file && y.line === x.line) === i);
    const counted = unique(added).sort(bySite).filter((x) => !ignored.has(x.name));
    const readNotListed = [];
    for (const x of counted) if (!listed.has(x.name) && !readNotListed.some((y) => y.name === x.name)) readNotListed.push(x);
    readNotListed.sort((a, b) => a.name.localeCompare(b.name));
    return {
      root,
      base: values.base ?? null,
      example,
      configFiles: [...configFiles].sort(),
      read: [...sites.entries()].map(([name, s]) => ({ name, sites: s.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) })).sort((a, b) => a.name.localeCompare(b.name)),
      readNotListed,
      listedNotRead: [...listed].filter((n) => !sites.has(n) && !ignored.has(n)).sort(),
      readOutsideConfig: counted.filter((x) => !inConfig(x.file)),
      dynamic: dynamic.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    };
  },
  text(r) {
    const out = [`example: ${r.example ?? "(none)"}; config: ${r.configFiles.join(", ") || "(none found)"}`];
    out.push(`read but not listed (${r.readNotListed.length}):`, ...r.readNotListed.map((x) => `  ${x.name}  ${x.file}:${x.line}`));
    out.push(`listed but not read (${r.listedNotRead.length}):`, ...r.listedNotRead.map((n) => `  ${n}`));
    out.push(`read outside the config module (${r.readOutsideConfig.length}):`, ...r.readOutsideConfig.map((x) => `  ${x.name}  ${x.file}:${x.line}`));
    if (r.dynamic.length) out.push(`dynamic reads (${r.dynamic.length}):`, ...r.dynamic.map((x) => `  ${x.file}:${x.line}`));
    return out.join("\n") + "\n";
  },
});
