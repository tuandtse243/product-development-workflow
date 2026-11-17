/**
 * Design compliance (D-26, blueprint section 10): the approved design becomes machine-checkable.
 *
 * `.aidw/design/tokens.yaml` holds the design tokens with a `use` rule each. It is part of the approved
 * package (design/** is frozen). For UI tasks the checkpoint proves that every color and font token exists in
 * the code, flags hard-coded colors outside the tokens, and requires screenshots that the reviewer compares
 * against the `use` rules. Checks are deterministic; judging the look stays with the reviewer.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { Diags } from "./diag.js";
import { rel, type Paths } from "./project.js";

export const TOKEN_KINDS = ["color", "font", "size", "space", "radius", "shadow", "motion", "other"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface Token {
  name: string;
  kind: TokenKind;
  value: string;
  /** dark-theme value, when the design has one */
  dark?: string;
  /** where and how the token must be used: what the reviewer checks on the screenshots */
  use: string;
  /** why this value was chosen, when the design says so: it lets a reviewer judge a deviation instead of only spotting it */
  why?: string;
}

export const tokensFile = (p: Paths) => join(p.design, "tokens.yaml");

export function parseTokens(text: string, file: string, d: Diags): Token[] {
  let data: unknown;
  try {
    data = YAML.parse(text);
  } catch (e) {
    d.error(file, `invalid YAML: ${(e as Error).message}`);
    return [];
  }
  const list = (data as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(list) || list.length === 0) {
    d.error(file, "must contain a non-empty `tokens:` list");
    return [];
  }
  const out: Token[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    const where = `tokens[${i}]`;
    const name = typeof t.name === "string" ? t.name.trim() : "";
    if (!/^[a-z][a-z0-9-]*$/.test(name)) return d.error(file, `${where}: name must be kebab-case`);
    if (seen.has(name)) return d.error(file, `${where}: duplicate token "${name}"`);
    seen.add(name);
    const kind = String(t.kind ?? "");
    if (!(TOKEN_KINDS as readonly string[]).includes(kind)) return d.error(file, `${where} (${name}): kind must be one of ${TOKEN_KINDS.join(", ")}`);
    const value = t.value === undefined || t.value === null ? "" : String(t.value).trim();
    if (!value) return d.error(file, `${where} (${name}): value is required`);
    const use = typeof t.use === "string" ? t.use.trim() : "";
    if (use.length < 8) return d.error(file, `${where} (${name}): \`use\` must say where the token is used (the reviewer checks it)`);
    const token: Token = { name, kind: kind as TokenKind, value, use };
    if (t.dark !== undefined && t.dark !== null && String(t.dark).trim()) token.dark = String(t.dark).trim();
    if (typeof t.why === "string" && t.why.trim()) token.why = t.why.trim();
    if (kind === "color") {
      for (const v of [token.value, token.dark].filter((x): x is string => !!x)) {
        if (!normalizeColor(v)) d.error(file, `${where} (${name}): "${v}" is not a color literal (hex, rgb(), hsl() or oklch())`);
      }
    }
    out.push(token);
  });
  // A UI change that reuses the existing design may add no color: it still needs one token that says where the look is
  // checked. Without a color token reviewers cannot check color use, which is said, not forced with an invented color.
  if (out.length === 0) d.error(file, "needs at least one token");
  else if (!out.some((t) => t.kind === "color")) d.warn(file, "no color token: reviewers cannot check color use (fine when the change reuses the existing design; do not invent a color to have one)");
  return out;
}

export function loadTokens(p: Paths): { tokens: Token[]; diags: Diags; exists: boolean } {
  const d = new Diags();
  const f = tokensFile(p);
  if (!existsSync(f)) return { tokens: [], diags: d, exists: false };
  return { tokens: parseTokens(readFileSync(f, "utf8"), rel(p, f), d), diags: d, exists: true };
}

// ---------------------------------------------------------------- color literals

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^()]*\)/gi;

/** Canonical form of a color literal so that #FFF, #ffffff and rgb(255, 255, 255) compare equal. */
export function normalizeColor(v: string): string | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) return `#${[...(m[1] as string)].map((c) => c + c).join("")}`.replace(/^(#[0-9a-f]{6})ff$/, "$1");
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) return `#${m[1]}`.replace(/^(#[0-9a-f]{6})ff$/, "$1");
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
    const a = m[4];
    if (a === undefined || a === "1" || a === "100%") return `#${hex}`;
    const alpha = a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
    return `#${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  }
  if (/^(?:hsla?|oklch|oklab|lab|lch)\([^()]*\)$/.test(s)) return s.replace(/\s+/g, " ").replace(/\(\s+/, "(").replace(/\s+\)/, ")");
  return null;
}

export function colorLiterals(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(HEX)) {
    const n = normalizeColor(m[0]);
    if (n) out.push(n);
  }
  for (const m of text.matchAll(FUNC)) {
    const n = normalizeColor(m[0]);
    if (n) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- project scan

const STYLE_FILE = /\.(css|scss|sass|less|pcss|tsx|jsx|ts|js|mjs|cjs|vue|svelte|astro|html)$/;
const SKIP = new Set(["node_modules", ".git", ".aidw", ".next", ".nuxt", ".svelte-kit", "dist", "build", "out", "coverage", "test-results", "playwright-report", ".turbo", ".vercel"]);
const TEST = /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.[a-z]+$/;
const MAX_FILE = 512 * 1024;

/** Source files that can carry styles (tests and generated output excluded), project-relative. */
export function styleFiles(project: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name), `${prefix}${e.name}/`);
      } else if (e.isFile() && STYLE_FILE.test(e.name)) {
        const r = `${prefix}${e.name}`;
        if (!TEST.test(r)) out.push(r);
      }
    }
  };
  walk(project, "");
  return out.sort();
}

function read(project: string, f: string): string {
  try {
    const full = join(project, f);
    return statSync(full).size > MAX_FILE ? "" : readFileSync(full, "utf8");
  } catch {
    return "";
  }
}

/** Color and font tokens whose value does not appear anywhere in the project's style sources. */
export function missingTokens(project: string, tokens: Token[], files = styleFiles(project)): string[] {
  const colors = new Set<string>();
  let text = "";
  for (const f of files) {
    const t = read(project, f);
    text += `\n${t.toLowerCase()}`;
    for (const c of colorLiterals(t)) colors.add(c);
  }
  const missing: string[] = [];
  for (const t of tokens) {
    if (t.kind === "color") {
      for (const v of [t.value, t.dark].filter((x): x is string => !!x)) {
        if (!colors.has(normalizeColor(v) ?? v)) missing.push(`${t.name}${v === t.dark ? " (dark)" : ""} ${v}`);
      }
    } else if (t.kind === "font") {
      const family = t.value.split(",")[0]?.replace(/["']/g, "").trim().toLowerCase() ?? "";
      if (family && !text.includes(family)) missing.push(`${t.name} ${t.value}`);
    }
  }
  return missing;
}

/** Color literals in the given (changed) files that are not a token value: `file: literal`. */
export function hardcodedColors(project: string, files: string[], tokens: Token[]): string[] {
  const allowed = new Set<string>(["#000000", "#ffffff", "#00000000"]);
  for (const t of tokens) {
    if (t.kind !== "color") continue;
    for (const v of [t.value, t.dark]) if (v) allowed.add(normalizeColor(v) ?? v);
  }
  const out: string[] = [];
  for (const f of files) {
    if (!STYLE_FILE.test(f) || TEST.test(f)) continue;
    const found = [...new Set(colorLiterals(read(project, f)))].filter((c) => !allowed.has(c));
    for (const c of found) out.push(`${f}: ${c}`);
    if (out.length >= 30) break;
  }
  return out;
}

// ---------------------------------------------------------------- screenshots

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Where the implementer of a UI task saves screenshots for the reviewer (inside .aidw/run, not committed). */
export const shotsDir = (p: Paths, id: string, taskId: string) => join(p.run, "shots", id, taskId);

/** Screenshots in the task's folder written at or after `since` (ISO), project-relative. */
export function taskShots(p: Paths, id: string, taskId: string, since?: string): string[] {
  const dir = shotsDir(p, id, taskId);
  if (!existsSync(dir)) return [];
  const after = since ? Date.parse(since) : 0;
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (IMAGE.test(e.name) && statSync(full).mtimeMs >= after - 1000) out.push(rel(p, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** Markdown table of the tokens for briefs. */
export function tokensTable(tokens: Token[]): string[] {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    "| Token | Kind | Value | Dark | Use |",
    "|---|---|---|---|---|",
    ...tokens.map((t) => `| \`${t.name}\` | ${t.kind} | \`${esc(t.value)}\` | ${t.dark ? `\`${esc(t.dark)}\`` : ""} | ${esc(t.use)}${t.why ? ` (why: ${esc(t.why)})` : ""} |`),
  ];
}
