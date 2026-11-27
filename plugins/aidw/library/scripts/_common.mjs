// Shared helpers of the Roles' scripts (roles/<id>/scripts/*.mjs). Not a tool itself: a script imports it as
// "../../../library/scripts/_common.mjs", which resolves next to the plugin it runs from. Node built-ins only (Node >= 20).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseArgs } from "node:util";

/** A usage or input/output error: the script prints it and exits 2. Findings never exit non-zero. */
export class UsageError extends Error {}

/**
 * Runs a script named `tool`: parses argv with `options` (node:util parseArgs), prints `help` for --help, calls `main(values,
 * positionals)` and prints its result, headed by { tool, schemaVersion: 1 }: JSON by default, `text(result)` with --text. Exits 2 on a UsageError.
 */
export async function runCli({ tool, help, options, main, text }) {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: process.argv.slice(2), options: { ...options, help: { type: "boolean" }, text: { type: "boolean" } }, allowPositionals: true, strict: true });
    } catch (e) {
      throw new UsageError(`${e.message}. See --help.`);
    }
    if (parsed.values.help) {
      process.stdout.write(help.trim() + "\n");
      return;
    }
    const result = { tool, schemaVersion: 1, ...(await main(parsed.values, parsed.positionals)) };
    process.stdout.write(parsed.values.text && text ? text(result) : JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    if (!(e instanceof UsageError)) process.stderr.write(`${e.stack ?? e}\n`);
    else process.stderr.write(`${e.message}\n`);
    process.exitCode = 2;
  }
}

/** The project directory from the first positional (default: the working directory); exits 2 when it is not one. */
export function projectRoot(positionals) {
  if (positionals.length > 1) throw new UsageError(`one project directory at most, got ${positionals.length}. See --help.`);
  const root = positionals[0] ?? process.cwd();
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new UsageError(`not a directory: ${root}`);
  return root;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "vendor", "venv", "__pycache__", "target", "site-packages"]);
const OUTPUT_DIRS = new Set(["public", "static"]); // served or built assets: skipped and reported
export const MAX_BYTES = 512 * 1024;

/**
 * Every file under root (relative paths with "/"), skipping dependencies, build output and hidden folders.
 * Returns { files, skipped }: skipped lists [{ file, reason }] for a public/ or static/ folder (as "dir/"), a
 * minified or bundled file and a file over MAX_BYTES.
 */
export function walk(root, exts) {
  const files = [];
  const skipped = [];
  const visit = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (e.isDirectory()) {
        if (OUTPUT_DIRS.has(e.name)) skipped.push({ file: `${rel}/`, reason: "build or asset output folder" });
        else if (!SKIP_DIRS.has(e.name)) visit(abs);
        continue;
      }
      if (!e.isFile() || (exts && !exts.some((x) => e.name.endsWith(x)))) continue;
      if (/\.(min|bundle)\.[^.]+$/.test(e.name)) { skipped.push({ file: rel, reason: "minified or bundled" }); continue; }
      let size = 0;
      try { size = statSync(abs).size; } catch { /* read reports it */ }
      if (size > MAX_BYTES) { skipped.push({ file: rel, reason: `larger than ${MAX_BYTES / 1024} KB` }); continue; }
      files.push(rel);
    }
  };
  visit(root);
  return { files: files.sort(), skipped };
}

/**
 * walk + read: { sources: [{ file, src }], skipped }; a file that cannot be read is skipped with its error code.
 * With `{ checkTemplates: true }` a JS/TS file whose template literal never closes is skipped too (it would be half-read).
 */
export function loadSources(root, exts, { checkTemplates = false } = {}) {
  const { files, skipped } = walk(root, exts);
  const sources = [];
  for (const file of files) {
    try {
      const src = readFileSync(join(root, file), "utf8");
      if (checkTemplates && /\.[cm]?[jt]sx?$/.test(file) && hasUnclosedTemplate(src)) { skipped.push({ file, reason: "unclosed template literal: not read" }); continue; }
      sources.push({ file, src });
    } catch (e) { skipped.push({ file, reason: `unreadable (${e.code ?? e.message})` }); }
  }
  skipped.sort((a, b) => a.file.localeCompare(b.file));
  return { sources, skipped };
}

export const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
export const PY_EXTS = [".py"];
export const isPython = (file) => file.endsWith(".py");

/** A test file by name or folder: *.test.*, *.spec.*, test_*.py, *_test.py, or under tests/, test/, __tests__/, e2e/. */
export function isTestFile(file) {
  const base = file.split("/").pop();
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || /(^|\/)(tests?|__tests__|e2e|spec)\//.test(file);
}

/**
 * Files and added line numbers since `base` (working tree against the ref, plus untracked files, which count as
 * wholly added): Map<file, Set<number> | "all">, paths relative to root. Exits 2 when git refuses the ref.
 */
export function changedSince(root, base) {
  const run = (args) => {
    try {
      return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      throw new UsageError(`git ${args.join(" ")} failed: ${(e.stderr || e.message).toString().trim()}`);
    }
  };
  run(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  const changed = new Map();
  let file = null;
  const diff = ["-c", "core.quotePath=false", "diff", "-M", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--relative", base, "--"];
  for (const line of run(diff).split("\n")) {
    if (line.startsWith("+++ ")) {
      const name = unquoteGit(line.slice(4));
      file = name === "/dev/null" ? null : name.replace(/^b\//, "");
      if (file !== null && !changed.has(file)) changed.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file !== null) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i++) changed.get(file).add(start + i);
    }
  }
  for (const f of run(["ls-files", "-z", "--others", "--exclude-standard"]).split("\0")) if (f) changed.set(f, "all");
  return changed;
}

/** A path as git prints it: C-quoted ("a\\tb", "\\303\\251") when it holds special bytes. */
function unquoteGit(s) {
  if (!s.startsWith('"')) return s.replace(/\t$/, "");
  const bytes = [];
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== "\\") { bytes.push(...Buffer.from(s[i])); continue; }
    const n = s[++i];
    if (/[0-7]/.test(n)) { bytes.push(parseInt(s.slice(i, i + 3), 8)); i += 2; }
    else bytes.push({ n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 }[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** True when line `n` of `file` is added in `changed` (a Map from changedSince). */
export const isAdded = (changed, file, n) => {
  const lines = changed.get(file);
  return lines === "all" || (lines instanceof Set && lines.has(n));
};

/** 1-based line number of a character index. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Is the `//` at `i` text rather than a line comment? A URL scheme before it (https://) or JSX text on the same line
 * (`<p>Docs // here</p>`: an opened tag, plain text, then a later tag) makes it text. A heuristic.
 */
function slashesAreText(src, i) {
  if (src[i - 1] === ":" && /[A-Za-z][A-Za-z0-9+.-]*$/.test(src.slice(Math.max(0, i - 12), i - 1))) return true;
  const ls = src.lastIndexOf("\n", i - 1) + 1;
  if (!/<[A-Za-z][^<>]*>[^<>{}]*$/.test(src.slice(ls, i))) return false;
  const le = src.indexOf("\n", i);
  return src.slice(i, le < 0 ? src.length : le).includes("<");
}

/** Does a template literal of a JS/TS source run to the end of the file without closing? (Comments and other strings are skipped.) */
export function hasUnclosedTemplate(src) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/" && !slashesAreText(src, i)) { const end = src.indexOf("\n", i); if (end < 0) return false; i = end; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); if (end < 0) return false; i = end + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const end = stringEnd(src, i);
      if (c === "`" && (end >= src.length && src[src.length - 1] !== "`" || end - 1 <= i)) return true;
      i = end;
      continue;
    }
    i++;
  }
  return false;
}

/** The source with comments blanked (same length, newlines kept); strings are kept unless `strings` is true. */
export function maskComments(src, python = false, strings = false) {
  const out = src.split("");
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < src.length) {
    const c = src[i];
    if (python && c === "#") { const end = src.indexOf("\n", i); blank(i, end < 0 ? src.length : end); i = end < 0 ? src.length : end; continue; }
    if (!python && c === "/" && src[i + 1] === "/" && !slashesAreText(src, i)) { const end = src.indexOf("\n", i); blank(i, end < 0 ? src.length : end); i = end < 0 ? src.length : end; continue; }
    if (!python && c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); const stop = end < 0 ? src.length : end + 2; blank(i, stop); i = stop; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const end = stringEnd(src, i, python);
      if (strings) blank(i + 1, end - 1);
      i = end;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** For comment-masked code: is the character at an index inside a string literal (so a "call" there is text)? */
export function inStringOf(code, python = false) {
  const bare = maskComments(code, python, true);
  return (i) => bare[i] !== code[i];
}

/** Index just after the string literal that starts at `i`. */
export function stringEnd(src, i, python = false) {
  const q = src[i];
  if (python && src.startsWith(q.repeat(3), i)) {
    const end = src.indexOf(q.repeat(3), i + 3);
    return end < 0 ? src.length : end + 3;
  }
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") { j += 2; continue; }
    if (src[j] === q) return j + 1;
    if (src[j] === "\n" && q !== "`") return j;
    j++;
  }
  return src.length;
}

/** Index of the bracket that closes the one at `open` ((, [ or {), skipping strings; -1 when unbalanced or further than `limit`. */
export function matchClose(src, open, python = false, limit = 20000) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  const stop = Math.min(src.length, open + limit);
  for (let i = open; i < stop; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = stringEnd(src, i, python) - 1; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Splits text at top-level commas (not inside brackets or strings). */
export function splitTop(text, python = false) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") { i = stringEnd(text, i, python) - 1; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** The text of string literals emptied (template expressions `${...}` kept), so a message never looks like code. */
export function stripStrings(text, python = false) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || (c === "`" && !python)) {
      const end = stringEnd(text, i, python);
      const body = text.slice(i + 1, end - 1);
      const exprs = c === "`" ? [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" ") : "";
      out += `${c}${exprs ? ` ${exprs} ` : ""}${c}`;
      i = end - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Top-level keys of an object or dict literal body (text between the braces); `spread` when one is spread in. */
export function objectKeys(body, python = false) {
  const keys = [];
  let spread = false;
  for (const entry of splitTop(body, python)) {
    if (entry.startsWith("...") || entry.startsWith("**")) { spread = true; continue; }
    const m = /^(?:["'`]([^"'`]+)["'`]|([A-Za-z_$][\w$]*))\s*:/.exec(entry)
      ?? /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(entry)
      ?? /^([A-Za-z_$][\w$]*)$/.exec(entry);
    if (m) keys.push(m[1] ?? m[2]);
    else spread = true; // a computed key: the shape cannot be known
  }
  return { keys, spread };
}

/** A table of rows (arrays of strings) with padded columns. */
export function table(rows) {
  if (rows.length === 0) return "";
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? "").length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? String(cell ?? "") : String(cell ?? "").padEnd(widths[c]))).join("  ").trimEnd()).join("\n") + "\n";
}
