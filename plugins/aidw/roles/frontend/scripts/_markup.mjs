// Helpers of the frontend Role's scripts for markup and styles: JSX elements, CSS declarations and rules, styled
// templates, style objects, string literals, color literals. Not a tool itself. Node built-ins only (Node >= 20).
// Heuristic, not a parser: good enough to list candidates for an Agent or a reviewer to check.

import { matchClose, maskComments, stringEnd } from "../../../library/scripts/_common.mjs";

export const STYLE_EXTS = [".css", ".scss", ".sass", ".less", ".pcss"];
export const JSX_EXTS = [".jsx", ".tsx", ".js", ".mjs", ".cjs"];
export const isStyleFile = (file) => STYLE_EXTS.some((x) => file.endsWith(x));

// ---------------------------------------------------------------- strings

/** Every string or template literal of comment-masked code: [{ start (index of the quote), end, text, quote }]. */
export function stringLiterals(code) {
  const out = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c !== '"' && c !== "'" && c !== "`") continue;
    const end = stringEnd(code, i);
    out.push({ start: i, end, text: code.slice(i + 1, Math.max(i + 1, end - 1)), quote: c });
    i = end - 1;
  }
  return out;
}

/** The text with every `${...}` of a template body replaced by underscores (same length, newlines kept). */
export function blankTemplateExprs(body) {
  const out = body.split("");
  for (let i = body.indexOf("${"); i >= 0; i = body.indexOf("${", i + 1)) {
    const close = matchClose(body, i + 1);
    const stop = close < 0 ? body.length : close + 1;
    for (let k = i; k < stop; k++) if (out[k] !== "\n") out[k] = "_";
    i = stop - 1;
  }
  return out.join("");
}

/**
 * Every bracket pair of comment-masked code in one pass: Map(index of ( [ or { -> index of its closer). A closer that
 * does not match the open one is ignored; strings are skipped. Linear, unlike a matchClose per bracket.
 */
export function bracketPairs(code) {
  const pairs = new Map();
  const stack = [];
  const CLOSER = { "(": ")", "[": "]", "{": "}" };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") { i = stringEnd(code, i) - 1; continue; }
    if (CLOSER[c]) stack.push(i);
    else if (c === ")" || c === "]" || c === "}") {
      const o = stack[stack.length - 1];
      if (o !== undefined && CLOSER[code[o]] === c) { stack.pop(); pairs.set(o, i); }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------- JSX

const TAG = /<([A-Za-z][\w.:-]*)/y;
const ATTR = /[A-Za-z_$][\w$:.-]*/y;
const KEYWORD_BEFORE = /(?:^|[^\w$])(?:return|yield|await|default|case|in|of|else|do|typeof|void)$/;

/** Is the `<` at `i` the start of a JSX tag rather than a comparison or a type argument? */
function tagContext(code, i) {
  let p = i - 1;
  while (p >= 0 && /\s/.test(code[p])) p--;
  if (p < 0) return true;
  if (/[\w$\])]/.test(code[p])) return KEYWORD_BEFORE.test(code.slice(Math.max(0, p - 10), p + 1));
  return true;
}

/** The attributes of the opening tag whose name ends at `j`: { attrs, spread, end, selfClosing } or null. */
function parseOpenTag(code, start, j) {
  const attrs = [];
  let spread = false;
  const ws = () => { while (j < code.length && /\s/.test(code[j])) j++; };
  while (j < code.length && j - start < 20000) {
    ws();
    if (code[j] === "/" && code[j + 1] === ">") return { attrs, spread, end: j + 2, selfClosing: true };
    if (code[j] === ">") return { attrs, spread, end: j + 1, selfClosing: false };
    if (code[j] === "{") {
      const close = matchClose(code, j);
      if (close < 0 || !/^\{\s*\.\.\./.test(code.slice(j, close))) return null;
      spread = true;
      j = close + 1;
      continue;
    }
    ATTR.lastIndex = j;
    const a = ATTR.exec(code);
    if (!a) return null;
    j = ATTR.lastIndex;
    ws();
    if (code[j] !== "=") { attrs.push({ name: a[0], kind: "bool", value: "", index: a.index, valueStart: a.index }); continue; }
    j++;
    ws();
    if (code[j] === '"' || code[j] === "'") {
      const e = code.indexOf(code[j], j + 1);
      if (e < 0) return null;
      attrs.push({ name: a[0], kind: "string", value: code.slice(j + 1, e), index: a.index, valueStart: j + 1 });
      j = e + 1;
    } else if (code[j] === "{") {
      const close = matchClose(code, j);
      if (close < 0) return null;
      attrs.push({ name: a[0], kind: "expr", value: code.slice(j + 1, close), index: a.index, valueStart: j + 1 });
      j = close + 1;
    } else return null;
  }
  return null;
}

/**
 * Every JSX element of comment-masked code, nested ones included: [{ name, index, attrs: Map(name -> attr), spread,
 * openEnd, selfClosing, closeStart, closeEnd }]. An attr is { kind: "string" | "expr" | "bool", value, index, valueStart }.
 * closeStart/closeEnd are null for a self-closing element or one whose closing tag was not found.
 */
export function jsxElements(code) {
  const out = [];
  const stacks = new Map(); // name -> open non-self-closing elements not closed yet
  const closes = [];
  for (const m of code.matchAll(/<\/([A-Za-z][\w.:-]*)\s*>/g)) closes.push({ name: m[1], start: m.index, end: m.index + m[0].length });
  let c = 0;
  const closeUpTo = (limit) => {
    for (; c < closes.length && closes[c].start < limit; c++) {
      const stack = stacks.get(closes[c].name);
      const el = stack?.pop();
      if (el && closes[c].start - el.openEnd < 50000) { el.closeStart = closes[c].start; el.closeEnd = closes[c].end; }
    }
  };
  for (let i = code.indexOf("<"); i >= 0; i = code.indexOf("<", i + 1)) {
    TAG.lastIndex = i;
    const m = TAG.exec(code);
    if (!m || !tagContext(code, i)) continue;
    const open = parseOpenTag(code, i, TAG.lastIndex);
    if (!open) continue;
    closeUpTo(i); // one pass over the tags, so an unclosed <li> or <br> costs nothing more
    const el = {
      name: m[1],
      index: i,
      attrs: new Map(open.attrs.map((a) => [a.name, a])),
      spread: open.spread,
      openEnd: open.end,
      selfClosing: open.selfClosing,
      closeStart: null,
      closeEnd: null,
    };
    out.push(el);
    if (!open.selfClosing) { if (!stacks.has(m[1])) stacks.set(m[1], []); stacks.get(m[1]).push(el); }
  }
  closeUpTo(code.length);
  return out;
}

/** The value of a string attribute, or of an expression attribute that is one string literal ({"x"}, {'x'}, {`x`}). */
export function attrText(attr) {
  if (!attr) return null;
  if (attr.kind === "string") return attr.value;
  if (attr.kind === "expr") {
    const m = /^\s*(["'`])([^"'`$]*)\1\s*$/.exec(attr.value);
    if (m) return m[2];
  }
  return null;
}

// ---------------------------------------------------------------- CSS

const DECL = /(^|[{;}])(\s*)([-$@]{0,2}[A-Za-z_][\w-]*)\s*:(?!:)\s*([^;{}]*?)\s*(?=;|}|$)/dg;

/**
 * The declarations of comment-masked CSS text: [{ prop (lowercase), value, index (of the value), definition }].
 * `definition` is true for a custom property (--x), a Sass ($x) or Less (@x) variable.
 */
export function cssDeclarations(text, offset = 0) {
  const out = [];
  for (const m of text.matchAll(DECL)) {
    const prop = m[3];
    if (/^@(media|supports|container|import|layer|include|apply|extend|use|forward|font-face|keyframes|page)$/i.test(prop)) continue;
    out.push({ prop: prop.toLowerCase(), value: m[4], index: offset + m.indices[4][0], definition: /^(--|\$|@)/.test(prop) });
  }
  return out;
}

/** The rule blocks of comment-masked CSS text: [{ selector, open, close }] (indices of the braces), nested ones too. */
export function cssBlocks(text) {
  const out = [];
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    const close = matchClose(text, i, false, 200000);
    if (close < 0) continue;
    let s = i - 1;
    while (s >= 0 && !"{};".includes(text[s])) s--;
    out.push({ selector: text.slice(s + 1, i).replace(/\s+/g, " ").trim(), open: i, close });
  }
  return out;
}

const STYLED = /\b(?:styled\s*(?:\.\s*[A-Za-z]\w*|\(\s*[^()]*\))(?:\s*\.\s*(?:attrs|withConfig)\s*\((?:[^()]|\([^()]*\))*\))?|css|createGlobalStyle|keyframes|injectGlobal|tw\.\w+)\s*(?:<[^<>]*>)?\s*`/g;

/** The CSS bodies of tagged style templates (styled.x``, styled(X)``, css``, keyframes``, createGlobalStyle``) in comment-masked code: [{ text, offset }]; `${...}` blanked and CSS comments masked. */
export function styledTemplates(code) {
  const out = [];
  for (const m of code.matchAll(STYLED)) {
    const bt = m.index + m[0].length - 1;
    const end = stringEnd(code, bt);
    out.push({ text: maskComments(blankTemplateExprs(code.slice(bt + 1, end - 1))), offset: bt + 1 });
  }
  return out;
}

/** CSS text a file holds: the whole file for a style file, the styled templates for a script: [{ text, offset }]. */
export function cssChunks(file, code) {
  return isStyleFile(file) ? [{ text: code, offset: 0 }] : styledTemplates(code);
}

// ---------------------------------------------------------------- style objects

/**
 * Top-level entries of an object literal body that starts at `offset`: [{ key, value, valueIndex }] with the key
 * unquoted. Spreads and computed keys are left out.
 */
export function objectEntries(body, offset = 0) {
  const out = [];
  let depth = 0, start = 0;
  const flush = (end) => {
    const raw = body.slice(start, end);
    const m = /^\s*(?:(["'`])([^"'`]+)\1|([A-Za-z_$][\w$]*))\s*:\s*/.exec(raw);
    if (m) {
      const vStart = start + m[0].length;
      const value = body.slice(vStart, end).trimEnd();
      if (value) out.push({ key: m[2] ?? m[3], value, valueIndex: offset + vStart });
    }
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") { i = stringEnd(body, i) - 1; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { flush(i); start = i + 1; }
  }
  flush(body.length);
  return out;
}

/** camelCase style key to its CSS property (backgroundColor -> background-color); a quoted kebab key is kept. */
export const cssProp = (key) => (key.includes("-") ? key.toLowerCase() : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

// ---------------------------------------------------------------- colors

export const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/dg;
export const COLOR_FUNC = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^()]*\)/dgi;

/** Canonical form of a color literal so that #FFF, #ffffff and rgb(255, 255, 255) compare equal (as src/design.ts). */
export function normalizeColor(v) {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) return `#${[...m[1]].map((c) => c + c).join("")}`.replace(/^(#[0-9a-f]{6})ff$/, "$1");
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
  if (/^(?:hsla?|oklch|oklab|lab|lch|hwb)\([^()]*\)$/.test(s)) return s.replace(/\s+/g, " ").replace(/\(\s+/, "(").replace(/\s+\)/, ")");
  return null;
}

/** Color literals in a text: [{ literal, index }] (index relative to the text). */
export function colorsIn(text) {
  const out = [];
  for (const re of [HEX, COLOR_FUNC]) for (const m of text.matchAll(re)) if (normalizeColor(m[0])) out.push({ literal: m[0], index: m.index });
  return out.sort((a, b) => a.index - b.index);
}
