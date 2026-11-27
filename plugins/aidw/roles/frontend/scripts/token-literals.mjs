#!/usr/bin/env node
// token-literals: style literals in the code that are not a design token, by kind, with the nearest token.
// A frontend Role tool for rule F2 (advisory). Node built-ins only.
const HELP = `
Usage: node token-literals.mjs [dir] [--base <ref>] [--tokens <file>] [--text]

Lists the literal style values in [dir] (default: the working directory) that are not the value of a design token
from the Change's approved tokens.yaml, so each can be replaced by its token (rule F2). Kinds:
  color    hex, rgb(), hsl(), oklch(), oklab(), lab(), lch(), hwb()
  length   px and rem values other than 0 and 1px (spacing, font size, sizes)
  font     a font-family whose first family is not a font token (generic families alone are fine)
  shadow   a box-shadow, text-shadow or drop-shadow value that is not a shadow token
  radius   a border-radius length that is not a radius token
  z-index  a z-index other than auto, 0, 1 and -1 that is not a token value
Each finding names the nearest token of its kind when one can be computed (colors by RGB distance, lengths and
z-indexes by value).

Where it looks:
  style files      .css .scss .sass .less .pcss: every declaration, Sass/Less variables and custom properties too,
                   and Tailwind classes after @apply
  scripts          .jsx .tsx .js .ts .mjs .cjs .mts .cts: style={{...}} and sx={{...}} objects, styled-components and
                   emotion templates (styled.x\`\`, styled(X)\`\`, css\`\`, keyframes\`\`, createGlobalStyle\`\`), a
                   string that is one color literal (fill="#e5533d", const accent = '#e5533d'), and Tailwind arbitrary
                   values in any string (p-[13px], bg-[#e5533d], text-[13px], rounded-[6px], shadow-[0_1px_2px_#000],
                   z-[60], font-['Inter'])
A value derived from a token (var(--x), theme(), calc() on var(), color-mix() on var()) is not a literal; its
var()/theme()/env()/url() parts are skipped and the rest is read. Test files are not scanned.

A literal equal to a token's value is not a finding. It is listed under "tokenValues" when it is written in place
(color: #e5533d instead of var(--accent)), but not where a token is defined (a custom property, a Sass or Less
variable, or a file named tailwind.config.*, theme.*, tokens.* or *.tokens.*). Black, white and transparent black
are never findings (as the CLI's design check).

Options:
  --base <ref>      only literals on lines added since <ref> (working tree against the ref, plus untracked files)
  --tokens <file>   the tokens file, relative to [dir] or absolute (default .aidw/design/tokens.yaml); without one
                    every literal is listed and "tokensFile" is null
  --text            short text instead of JSON
  --help            this text

Output (JSON): { tool, schemaVersion: 1, root, base, tokensFile, tokens, findings: [{ file, line, kind, literal,
  value?, nearestToken?: { name, value } }], tokenValues: [{ file, line, kind, literal, token }], skipped }
"literal" is what is written (a whole Tailwind class for an arbitrary value; "value" is then the CSS value read
from it). "skipped" lists what was not read: public/ and static/ output, *.min.* and *.bundle.*, files over 512 KB,
unreadable files, files with a template literal that never closes, and a note when 0 tokens were parsed from a
non-empty tokens file.

A string that is one hex color is read only where its name speaks of color (fill, stroke, color, bg, accent, hex, ...):
href="#cafe" and querySelector('#facade') are anchors. A bare number in sx={{}} is a theme spacing multiplier, not px.
White and black written as hsl() or oklch() are allowed like #fff and #000.

Limits: plain objects other than style and sx (a theme object, StyleSheet.create) are not read; color names (red,
tomato) are not colors here; a font shorthand is read for its lengths only; .vue and .svelte files come later.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error (an unreadable or malformed tokens file, or a
"tokens:" with inline or flow content: write it as a block list).
`;

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { changedSince, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, projectRoot, runCli, splitTop, table, UsageError } from "../../../library/scripts/_common.mjs";
import { colorsIn, cssChunks, cssDeclarations, cssProp, isStyleFile, jsxElements, normalizeColor, objectEntries, STYLE_EXTS, stringLiterals } from "./_markup.mjs";

// ---------------------------------------------------------------- tokens.yaml (the subset aidw writes)

/** A YAML scalar: quoted ("..." or '...') or plain. */
function scalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** The line without a trailing # comment (a # that starts the line or follows a space, outside quotes). */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * The `tokens:` list of a tokens.yaml (block items, or flow maps `- { name: x, ... }`): { items: [{ name, kind, value,
 * dark? }], bodyLines } (bodyLines: the lines under `tokens:`). A `tokens:` key with inline content (`tokens: [ ... ]`) is an error.
 */
function parseTokensYaml(text) {
  const items = [];
  let inTokens = false, seenKey = false, cur = null, bodyLines = 0;
  const set = (key, raw) => { if (cur) cur[key] = scalar(raw); };
  const flow = (body) => {
    for (const part of splitTop(body)) {
      const m = /^([\w-]+)\s*:\s*(.*)$/s.exec(part);
      if (m) set(m[1], m[2]);
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^\S/.test(line)) {
      inTokens = /^tokens\s*:/.test(line);
      if (inTokens) {
        seenKey = true;
        const inline = line.replace(/^tokens\s*:/, "").trim();
        if (inline && !/^(\[\s*\]|~|null)$/.test(inline)) throw new UsageError("`tokens:` has inline or flow content this script cannot read; write the tokens as a block list (one `- name: ...` item per token)");
      }
      cur = null;
      continue;
    }
    if (!inTokens) continue;
    bodyLines++;
    let rest = line.trim();
    if (rest === "-" || rest.startsWith("- ")) {
      cur = {};
      items.push(cur);
      rest = rest.slice(1).trim();
      if (rest.startsWith("{") && rest.endsWith("}")) { flow(rest.slice(1, -1)); continue; }
    }
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(rest);
    if (m) set(m[1], m[2]);
  }
  if (!seenKey) throw new UsageError("no `tokens:` list in the tokens file");
  return { items: items.filter((t) => typeof t.name === "string" && t.name && typeof t.value === "string" && t.value), bodyLines };
}

// ---------------------------------------------------------------- values

const LENGTH = /(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))(px|rem)(?![\w-])/dg;
const toPx = (n, unit) => (unit === "rem" ? n * 16 : n);
const ALLOWED_COLORS = new Set(["#000000", "#ffffff", "#00000000"]);
// White and black written as hsl() or oklch() (any hue; lightness 100% or 0%, no chroma), without alpha or with alpha 1.
const BW_HSL = /^hsla?\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+(?:0|100)%(?:\s*[,/]\s*(?:1|100%|1\.0+))?\s*\)$/;
const BW_OKLCH = /^oklch\(\s*(?:0|1|0%|100%|0?\.0+|1\.0+)\s+0(?:\.0+)?%?\s+[\d.]+(?:deg)?(?:\s*\/\s*(?:1|100%|1\.0+))?\s*\)$/;
const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert", "-apple-system", "blinkmacsystemfont"]);
const firstFamily = (v) => (v.split(",")[0] ?? "").replace(/["']/g, "").trim().toLowerCase();
const COLOR_ANY = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^()]*\)/gi;
const normShadow = (v) => v.toLowerCase().replace(COLOR_ANY, (c) => normalizeColor(c) ?? c).replace(/\b0(?:px|rem)\b/g, "0").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();

/** The value with var(), theme(), env() and url() parts blanked (same length), so only literals of its own are read. */
function ownPart(value) {
  let out = value;
  for (const fn of ["var", "theme", "env", "url"]) {
    const re = new RegExp(`\\b${fn}\\(`, "gi");
    for (let m = re.exec(out); m; m = re.exec(out)) {
      let depth = 0, k = m.index + m[0].length - 1;
      for (; k < out.length; k++) { if (out[k] === "(") depth++; else if (out[k] === ")" && --depth === 0) break; }
      out = out.slice(0, m.index) + " ".repeat(Math.min(out.length, k + 1) - m.index) + out.slice(k + 1);
    }
  }
  return out;
}

/** The token set grouped for matching. */
function tokenIndex(tokens) {
  const colors = [];
  const lengths = { length: [], radius: [] };
  const fonts = [], shadows = [], integers = [];
  for (const t of tokens) {
    const values = [t.value, t.dark].filter((v) => typeof v === "string" && v);
    for (const v of values) {
      if (t.kind === "color") { const n = normalizeColor(v); if (n) colors.push({ name: t.name, value: v, n }); }
      else if (t.kind === "font") fonts.push({ name: t.name, value: v, family: firstFamily(v) });
      else if (t.kind === "shadow") shadows.push({ name: t.name, value: v, n: normShadow(v) });
      else if (["size", "space", "radius", "other"].includes(t.kind)) {
        if (/^-?\d+$/.test(v.trim())) integers.push({ name: t.name, value: v, n: Number(v) });
        for (const m of v.matchAll(LENGTH)) {
          const entry = { name: t.name, value: v, px: toPx(Number(m[1]), m[2]) };
          (t.kind === "radius" ? lengths.radius : lengths.length).push(entry);
        }
      }
    }
  }
  return { colors, lengths, fonts, shadows, integers };
}

const rgb = (n) => (/^#[0-9a-f]{6}/.test(n) ? [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)) : null);
const nearestBy = (list, dist) => {
  let best = null, bd = Infinity;
  for (const t of list) { const d = dist(t); if (d !== null && d < bd) { bd = d; best = t; } }
  return best ? { name: best.name, value: best.value } : undefined;
};

/** A checker for one token set: check(kind, literal, raw?) -> { token } when it is a token value, { nearest } otherwise, null when allowed. */
function checker(tokens) {
  const ix = tokenIndex(tokens);
  return (kind, literal, extra = {}) => {
    if (kind === "color") {
      const n = normalizeColor(literal);
      if (!n || ALLOWED_COLORS.has(n) || BW_HSL.test(n) || BW_OKLCH.test(n)) return null;
      const hit = ix.colors.find((t) => t.n === n);
      if (hit) return { token: hit.name };
      const c = rgb(n);
      return { nearest: nearestBy(ix.colors, (t) => { const d = rgb(t.n); return c && d ? Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) : null; }) };
    }
    if (kind === "length" || kind === "radius") {
      const px = extra.px;
      if (px === 0 || (Math.abs(px) === 1 && extra.unit === "px")) return null;
      // A radius is matched against the radius tokens (the length tokens when there is none), a length against size and space.
      const pool = kind === "radius" && ix.lengths.radius.length ? ix.lengths.radius : ix.lengths.length;
      const hit = pool.find((t) => t.px === Math.abs(px));
      if (hit) return { token: hit.name };
      return { nearest: nearestBy(pool, (t) => Math.abs(t.px - Math.abs(px))) };
    }
    if (kind === "font") {
      const fam = firstFamily(literal);
      if (!fam || GENERIC_FONTS.has(fam)) return null;
      const hit = ix.fonts.find((t) => t.family === fam);
      if (hit) return { token: hit.name };
      return { nearest: ix.fonts[0] ? { name: ix.fonts[0].name, value: ix.fonts[0].value } : undefined };
    }
    if (kind === "shadow") {
      const n = normShadow(literal);
      if (!n || n === "none" || /^(inherit|initial|unset)$/.test(n)) return null;
      const hit = ix.shadows.find((t) => t.n === n);
      if (hit) return { token: hit.name };
      return { nearest: ix.shadows.length === 1 ? { name: ix.shadows[0].name, value: ix.shadows[0].value } : undefined };
    }
    if (kind === "z-index") {
      const n = Number(literal);
      if (!Number.isInteger(n) || [0, 1, -1].includes(n)) return null;
      const hit = ix.integers.find((t) => t.n === n);
      if (hit) return { token: hit.name };
      return { nearest: nearestBy(ix.integers, (t) => Math.abs(t.n - n)) };
    }
    return null;
  };
}

// ---------------------------------------------------------------- reading literals

const SHADOW_PROPS = new Set(["box-shadow", "text-shadow"]);
const RADIUS_PROP = /^border(-[a-z]+)*-radius$|^border-radius$/;
const UNITLESS = new Set(["opacity", "flex", "flex-grow", "flex-shrink", "font-weight", "line-height", "order", "z-index", "zoom", "scale", "aspect-ratio", "grid-row", "grid-column", "animation-iteration-count", "column-count", "orphans", "widows", "tab-size", "stroke-width", "-webkit-line-clamp", "line-clamp", "fill-opacity", "stroke-opacity", "stop-opacity", "flood-opacity", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "flex-positive", "flex-negative", "grid-area", "grid-row-start", "grid-row-end", "grid-column-start", "grid-column-end", "border-image-slice", "font-size-adjust", "initial-letter", "max-lines", "volume", "counter-increment", "counter-reset"]);

/** Literals of one CSS declaration: [{ kind, literal, index, px?, unit? }] (index relative to the value). */
function declLiterals(prop, value) {
  const own = ownPart(value);
  const out = [];
  const custom = prop.startsWith("--") || prop.startsWith("$") || prop.startsWith("@");
  if (prop === "z-index") {
    const m = /^\s*(-?\d+)\s*$/.exec(own);
    if (m) out.push({ kind: "z-index", literal: m[1], index: own.indexOf(m[1]) });
    return out;
  }
  if (SHADOW_PROPS.has(prop) || (prop === "filter" && /drop-shadow\(/.test(own))) {
    if (/var\(|theme\(/.test(value)) return out;
    const literal = prop === "filter" ? /drop-shadow\(([^()]*(?:\([^()]*\)[^()]*)*)\)/.exec(own)?.[1] ?? "" : value.trim();
    if (literal) out.push({ kind: "shadow", literal, index: Math.max(0, value.indexOf(literal)) });
    return out;
  }
  if (prop === "font-family") {
    if (!/var\(|theme\(/.test(value)) out.push({ kind: "font", literal: value.trim(), index: 0 });
    return out;
  }
  // hsl(var(--x)) and oklch(var(--l) var(--c) var(--h)) are derived from tokens: the function's own text was blanked above.
  for (const c of colorsIn(own)) if (!/\b(?:var|theme|env)\(/i.test(value.slice(c.index, c.index + c.literal.length))) out.push({ kind: "color", literal: c.literal, index: c.index });
  if (!custom && /^(transition|animation)/.test(prop)) return out;
  const kind = RADIUS_PROP.test(prop) ? "radius" : "length";
  for (const m of own.matchAll(LENGTH)) out.push({ kind, literal: m[0], index: m.index, px: toPx(Number(m[1]), m[2]), unit: m[2] });
  return out;
}

// Tailwind arbitrary values: prefix-[value] with optional variants (hover:, md:, dark:) and a leading "-".
const TW = /(?<![\w\-[\]])((?:[\w-]+:)*)(-?)([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)-\[([^\]\s`]+)\]/dg;
const TW_COLOR_PREFIX = /^(bg|text|border(-[trblxyse])?|ring|ring-offset|outline|decoration|fill|stroke|from|via|to|accent|caret|placeholder|divide|shadow|drop-shadow)$/;
const TW_LENGTH_PREFIX = /^(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|inset(-[xy])?|top|right|bottom|left|start|end|w|h|min-w|max-w|min-h|max-h|size|text|leading|tracking|basis|indent|translate-[xy]|scroll-[mp][xytrblse]?|border(-[trblxyse])?|outline|outline-offset|ring|ring-offset|columns|underline-offset|decoration)$/;
const isColorValue = (v) => !!normalizeColor(v);

/** Literals of the Tailwind arbitrary values in a class string: [{ kind, literal, value, index, px?, unit? }]. */
function twLiterals(text) {
  const out = [];
  for (const m of text.matchAll(TW)) {
    const prefix = m[3];
    let value = m[4].replace(/_/g, " ");
    if (/var\(|--|theme\(/.test(value)) continue;
    value = value.replace(/^(color|length|family-name|number|shadow):/, "");
    const literal = m[0].slice(m[1].length);
    const index = m.indices[2][0];
    if (isColorValue(value) && (TW_COLOR_PREFIX.test(prefix))) { out.push({ kind: "color", literal, value, index }); continue; }
    if (prefix === "shadow" || prefix === "drop-shadow") { out.push({ kind: "shadow", literal, value, index }); continue; }
    if (prefix === "z") { if (/^-?\d+$/.test(value)) out.push({ kind: "z-index", literal, value: `${m[2]}${value}`, index }); continue; }
    if (prefix === "font") { if (!/^\d+$/.test(value)) out.push({ kind: "font", literal, value: value.replace(/^(["'])(.*)\1$/, "$2"), index }); continue; }
    const kind = /^rounded(-[a-z]+)?$/.test(prefix) ? "radius" : TW_LENGTH_PREFIX.test(prefix) ? "length" : null;
    if (!kind) continue;
    for (const c of colorsIn(value)) out.push({ kind: "color", literal, value: c.literal, index });
    for (const l of value.matchAll(LENGTH)) out.push({ kind, literal, value: l[0], index, px: toPx(Number(`${m[2]}${l[1]}`), l[2]), unit: l[2] });
  }
  return out;
}

// A string that is one hex color counts when what it is assigned to or passed to speaks of color (fill="#e5533d",
// const accent = '#e5533d', setColor('#fff')); href="#cafe" and querySelector('#facade') are anchors, not colors.
const COLOR_CONTEXT = /(?:hex|colou?r|fill|stroke|bg|background|border|shadow|outline|accent|tint|theme|palette|brand|swatch|gradient|stop|flood|lighting|primary|secondary)/i;
const hexContext = (code, start) => {
  const m = /([A-Za-z_$][\w$.-]*)\s*(?:=|:|\()\s*\{?\s*$/.exec(code.slice(Math.max(0, start - 80), start));
  return !!m && COLOR_CONTEXT.test(m[1]);
};

const DEFINITION_FILE = /(^|\/)(tailwind\.config|theme|tokens|design-tokens)\.[\w.]+$|\.tokens\.[\w.]+$/;

/** Every literal of one file: [{ kind, literal, value?, index, definition, px?, unit? }] (index in the file). */
function fileLiterals(file, src) {
  const code = maskComments(src);
  const found = [];
  const defFile = DEFINITION_FILE.test(file);
  const seen = new Set();
  const add = (x) => {
    const key = `${x.index}:${x.kind}:${x.literal}`;
    if (!seen.has(key)) { seen.add(key); found.push({ ...x, definition: x.definition || defFile }); }
  };
  for (const chunk of cssChunks(file, code)) {
    for (const d of cssDeclarations(chunk.text, chunk.offset)) {
      for (const l of declLiterals(d.prop, d.value)) add({ ...l, index: d.index + l.index, definition: d.definition });
    }
    for (const m of chunk.text.matchAll(/@apply\s+([^;{}]+)/g)) for (const l of twLiterals(m[1])) add({ ...l, index: chunk.offset + m.index + 7 + l.index });
  }
  if (isStyleFile(file)) return found;
  // style={{ }} and sx={{ }}: CSS values of an object literal (nested objects for selectors too)
  const objectLiterals = (body, offset, unitless = false) => {
    for (const e of objectEntries(body, offset)) {
      const v = e.value.trim();
      if (v.startsWith("{") && v.endsWith("}")) { objectLiterals(v.slice(1, -1), e.valueIndex + 1, unitless); continue; }
      const prop = cssProp(e.key);
      const str = /^(["'`])([^"'`]*)\1$/.exec(v);
      if (str) { for (const l of declLiterals(prop, str[2])) add({ ...l, index: e.valueIndex + 1 + l.index }); continue; }
      const num = /^-?\d*\.?\d+$/.exec(v);
      if (!num) continue;
      if (prop === "z-index") add({ kind: "z-index", literal: v, index: e.valueIndex });
      else if (!unitless && !UNITLESS.has(prop)) add({ kind: RADIUS_PROP.test(prop) ? "radius" : "length", literal: v, value: `${v}px`, index: e.valueIndex, px: Number(v), unit: "px" });
    }
  };
  for (const el of jsxElements(code)) {
    for (const name of ["style", "sx"]) {
      const a = el.attrs.get(name);
      if (!a || a.kind !== "expr") continue;
      const inner = a.value.trim();
      if (!inner.startsWith("{") || !inner.endsWith("}")) continue;
      const start = a.valueStart + a.value.indexOf("{") + 1;
      // a bare number in sx is a theme spacing multiplier (MUI), not px
      objectLiterals(code.slice(start, start + inner.length - 2), start, name === "sx");
    }
  }
  // strings: Tailwind arbitrary values, and a string that is one color literal
  for (const s of stringLiterals(code)) {
    for (const l of twLiterals(s.text)) add({ ...l, index: s.start + 1 + l.index });
    const whole = s.text.trim();
    if (s.quote !== "`" && isColorValue(whole) && /^(#|rgb|hsl|oklch|oklab|lab|lch|hwb)/i.test(whole) && (!whole.startsWith("#") || hexContext(code, s.start))) add({ kind: "color", literal: whole, index: s.start + 1 + s.text.indexOf(whole) });
  }
  return found;
}

const KIND_ORDER = ["color", "length", "font", "shadow", "radius", "z-index"];

await runCli({
  tool: "token-literals",
  help: HELP,
  options: { base: { type: "string" }, tokens: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const changed = values.base ? changedSince(root, values.base) : null;
    let tokensFile = values.tokens ?? ".aidw/design/tokens.yaml";
    let tokens = [];
    const notes = [];
    const tokensPath = resolve(root, tokensFile); // an absolute path is used as is
    if (existsSync(tokensPath)) {
      let text;
      try { text = readFileSync(tokensPath, "utf8"); } catch (e) { throw new UsageError(`cannot read ${tokensFile}: ${e.code ?? e.message}`); }
      try {
        const parsed = parseTokensYaml(text);
        tokens = parsed.items;
        if (tokens.length === 0 && parsed.bodyLines > 0) notes.push({ file: tokensFile, reason: "0 tokens parsed from a file with content under tokens: (each token needs name and value)" });
      } catch (e) { throw new UsageError(`${tokensFile}: ${e.message}`); }
    } else if (values.tokens) throw new UsageError(`no tokens file at ${values.tokens}`);
    else tokensFile = null;
    const check = checker(tokens);

    const findings = [];
    const tokenValues = [];
    const { sources, skipped } = loadSources(root, [...STYLE_EXTS, ...JS_EXTS], { checkTemplates: true });
    skipped.push(...notes);
    for (const { file, src } of sources) {
      if (isTestFile(file)) continue;
      const line = lineIndex(src);
      for (const l of fileLiterals(file, src)) {
        const n = line(l.index);
        if (changed && !isAdded(changed, file, n)) continue;
        const compared = l.kind === "length" || l.kind === "radius" ? l.literal : (l.value ?? l.literal);
        const r = check(l.kind, compared, l);
        if (!r) continue;
        if (r.token) { if (!l.definition) tokenValues.push({ file, line: n, kind: l.kind, literal: l.literal, token: r.token }); continue; }
        const f = { file, line: n, kind: l.kind, literal: l.literal };
        if (l.value !== undefined && l.value !== l.literal) f.value = l.value;
        if (r.nearest) f.nearestToken = r.nearest;
        findings.push(f);
      }
    }
    const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.literal.localeCompare(b.literal);
    return { root, base: values.base ?? null, tokensFile, tokens: tokens.length, findings: findings.sort(order), tokenValues: tokenValues.sort(order), skipped };
  },
  text(r) {
    const out = [`tokens: ${r.tokens} from ${r.tokensFile ?? "(no tokens file)"}`, `literals not a token (${r.findings.length}):`];
    if (r.findings.length) out.push(table([["place", "kind", "literal", "nearest token"], ...r.findings.map((f) => [`${f.file}:${f.line}`, f.kind, f.literal, f.nearestToken ? `${f.nearestToken.name} (${f.nearestToken.value})` : ""])]).trimEnd());
    if (r.tokenValues.length) out.push(`token values written in place (${r.tokenValues.length}):`, ...r.tokenValues.map((t) => `  ${t.file}:${t.line}  ${t.literal}  -> ${t.token}`));
    if (r.skipped.length) out.push(`skipped: ${r.skipped.length}`);
    return out.join("\n") + "\n";
  },
});
