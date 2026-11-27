#!/usr/bin/env node
// a11y-names: JSX elements a person on a keyboard or a screen reader cannot use or name, removed focus outlines and
// raw-HTML sinks. A frontend Role tool for rules F4, F5 and F16 (advisory). Node built-ins only.
const HELP = `
Usage: node a11y-names.mjs [dir] [--base <ref>] [--text]

Lists candidates in the JSX and styles of [dir] (default: the working directory). Each finding has a "problem":
  div-click          onClick on a non-interactive element (div, span, li, an <a> without href, ...) that lacks a
                     role, a tabIndex or a key handler (F4: use a button, or add all three)
  no-name            a button, a link (<a>, Link from next/link or react-router) or an element with an interactive
                     role whose content is only an icon (<svg>, a component named Icon or *Icon or imported from an
                     icon library, an <i> that is empty or has no text), only a symbol (x, X, \u00d7, &times;, ->)
                     or empty, with no aria-label, aria-labelledby or title (F4)
  no-label           an input, select or textarea with no aria-label or aria-labelledby, no id that a
                     <label htmlFor> (or <Label htmlFor>) in the same file names and no wrapping label (F4)
  no-alt             an <img> (or next/image's Image) with no alt attribute; alt="" marks a decorative one (F4)
  positive-tabindex  a tabIndex above 0 (F4: it breaks the tab order)
  outline-removed    outline: none or 0 in a CSS rule with no :focus-visible in the same rule (or the rule that holds
                     it; a styled or emotion template with no outer block counts whole), outline-none or outline-0 in a class string with no focus-visible: class, or outline in a
                     style object (F5)
  raw-html           dangerouslySetInnerHTML, or .innerHTML / .outerHTML assigned, insertAdjacentHTML(), document.write()
                     (F16), unless the value is passed through a call named sanitize* or *purify*
An element given a spread ({...props}) is skipped for div-click, no-name, no-label and no-alt: the missing attribute
may come from there.

Reads .jsx .tsx .js .mjs .cjs for JSX and class strings, .ts .mts .cts for raw-HTML sinks and class strings, and
.css .scss .sass .less .pcss plus styled-components/emotion templates for outlines. Test files are not scanned.

Options:
  --base <ref>  only findings on lines added since <ref> (working tree against the ref, plus untracked files)
  --text        short text instead of JSON
  --help        this text

Output (JSON): { tool, schemaVersion: 1, root, base, findings: [{ file, line, element, problem, detail }], skipped }
"element" is the tag name (div, button, img), the CSS selector for a rule, or null for a class string outside a tag.
"skipped" lists what was not read: public/ and static/ output, *.min.* and *.bundle.*, files over 512 KB,
unreadable files, files with a template literal that never closes.

Limits: a component (<Button>, <IconButton>; IconButton is not an icon) is not looked into, only host elements and the Link and Image above;
an accessible name from an expression child ({t('close')}) or from a nested element other than an icon is taken as
present; an id built at run time counts as bound when the file has any htmlFor={...}; a sanitizer that is not
called inline is not seen; .vue and .svelte templates come later.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { changedSince, inStringOf, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, projectRoot, runCli, table } from "../../../library/scripts/_common.mjs";
import { attrText, cssBlocks, cssChunks, isStyleFile, jsxElements, STYLE_EXTS, stringLiterals } from "./_markup.mjs";

const NATIVE_INTERACTIVE = new Set(["button", "input", "select", "textarea", "summary", "option", "details", "label", "a"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "switch", "tab", "treeitem", "combobox", "slider", "spinbutton", "textbox", "searchbox"]);
const KEY_HANDLERS = ["onKeyDown", "onKeyUp", "onKeyPress"];
const NO_LABEL_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const ICON_LIBS = /from\s+["'](?:lucide-react|@heroicons\/|react-icons\/|@radix-ui\/react-icons|@tabler\/icons-react|@phosphor-icons\/|@mui\/icons-material|react-feather)/;
const LINK_IMPORT = /import\s+(?:\{[^}]*\bLink\b[^}]*\}|Link)\s+from\s+["'](?:next\/link|react-router-dom|react-router|@tanstack\/react-router)["']/;
const IMAGE_IMPORT = /import\s+Image\s+from\s+["']next\/image["']/;
const SANITIZED = /\b\w*(?:sanitiz|purify)\w*\s*\(/i;
const JSX_FILE = /\.(jsx|tsx|js|mjs|cjs)$/;

const has = (el, name) => el.attrs.has(name) && (el.attrs.get(name).kind !== "string" || el.attrs.get(name).value.trim() !== "");
const roleOf = (el) => (attrText(el.attrs.get("role")) ?? "").trim();

/**
 * Is an element an icon? An <svg>; an <i> that is empty, self-closing or has a className and no text; a component
 * named Icon or *Icon (SearchIcon; not IconButton or Iconography); a name imported from a known icon library.
 */
function iconNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/import\s+\{([^}]*)\}\s+from\s+["'][^"']+["']/g)) {
    if (!ICON_LIBS.test(m[0])) continue;
    for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  }
  return (el) => {
    if (el.name === "svg") return true;
    if (el.name === "i") {
      if (el.selfClosing) return true;
      if (el.closeStart === null) return false;
      const inner = code.slice(el.openEnd, el.closeStart).replace(/<[^>]*>/g, "").trim();
      return inner === "" || (el.attrs.has("className") && !/[\p{L}\p{N}{]/u.test(inner));
    }
    return /^Icon$|[a-z0-9]Icon$/.test(el.name) || names.has(el.name);
  };
}

/**
 * What an element's content gives as a name: "text", "none" (empty or only icons), "symbol" (only non-letter text)
 * or "unknown" (an expression or another element: taken as present).
 */
function contentName(code, el, all, isIcon) {
  if (el.selfClosing) return "none";
  if (el.closeStart === null) return "unknown";
  const text = code.slice(el.openEnd, el.closeStart).split("");
  let covered = el.openEnd; // children are visited outermost first: one inside a visited child is skipped
  for (const c of all) {
    if (c.index <= el.index || c.index >= el.closeStart || c.index < covered) continue;
    const end = c.selfClosing || c.closeEnd === null ? c.openEnd : c.closeEnd;
    covered = end;
    if (c.name === "img" && (attrText(c.attrs.get("alt")) ?? (c.attrs.has("alt") ? "x" : "")).trim() !== "") return "text";
    if (!isIcon(c) && c.name !== "img") return "unknown";
    for (let k = c.index; k < end; k++) if (text[k - el.openEnd] !== undefined) text[k - el.openEnd] = " ";
  }
  const rest = text.join("").replace(/\{\s*\}/g, " ").trim();
  if (!rest) return "none";
  if (/\{[^}]*\S[^}]*\}/.test(rest)) return "unknown";
  if (/^(?:&times;|&#215;|&#xd7;|[xX\u00d7\u2715\u2716\u2717\u2718])$/i.test(rest)) return "symbol"; // a close mark is not a name
  return /[\p{L}\p{N}]/u.test(rest) ? "text" : "symbol";
}

/** JSX findings of one file (comment-masked code): [{ index, element, problem, detail }]. */
function jsxFindings(code) {
  const out = [];
  const all = jsxElements(code);
  const isIcon = iconNames(code);
  const linkComponent = LINK_IMPORT.test(code);
  const imageComponent = IMAGE_IMPORT.test(code);
  const isLabel = (e) => e.name === "label" || /^(?:Label|\w+Label)$/.test(e.name); // <label>, shadcn/Radix <Label>, <FormLabel>
  const labelFor = new Set(all.filter(isLabel).map((e) => attrText(e.attrs.get("htmlFor")) ?? attrText(e.attrs.get("for"))).filter(Boolean));
  const dynamicFor = all.some((e) => isLabel(e) && e.attrs.get("htmlFor")?.kind === "expr" && attrText(e.attrs.get("htmlFor")) === null);
  const labels = all.filter((e) => isLabel(e) && e.closeStart !== null);
  for (const el of all) {
    const host = /^[a-z]/.test(el.name);
    const role = roleOf(el);
    // div-click
    if (host && has(el, "onClick") && !el.spread) {
      const native = NATIVE_INTERACTIVE.has(el.name) && !(el.name === "a" && !el.attrs.has("href"));
      if (!native) {
        const missing = [];
        if (!INTERACTIVE_ROLES.has(role)) missing.push("role");
        if (!el.attrs.has("tabIndex")) missing.push("tabIndex");
        if (!KEY_HANDLERS.some((k) => el.attrs.has(k))) missing.push("key handler");
        if (missing.length) out.push({ index: el.index, element: el.name, problem: "div-click", detail: `onClick without ${missing.join(", ")}` });
      }
    }
    // no-name
    const isLink = el.name === "a" || (linkComponent && el.name === "Link");
    if ((el.name === "button" || isLink || (host && INTERACTIVE_ROLES.has(role))) && !el.spread && !has(el, "aria-label") && !has(el, "aria-labelledby") && !has(el, "title")) {
      const c = contentName(code, el, all, isIcon);
      if (c === "none") out.push({ index: el.index, element: el.name, problem: "no-name", detail: "content is empty or only an icon" });
      else if (c === "symbol") out.push({ index: el.index, element: el.name, problem: "no-name", detail: `content is only a symbol: ${code.slice(el.openEnd, el.closeStart).replace(/<[^>]*>/g, "").trim().slice(0, 20)}` });
    }
    // no-label
    if (["input", "select", "textarea"].includes(el.name) && !el.spread) {
      const type = (attrText(el.attrs.get("type")) ?? "text").toLowerCase();
      const named = has(el, "aria-label") || has(el, "aria-labelledby");
      const id = el.attrs.get("id");
      const bound = id && (labelFor.has(attrText(id)) || (attrText(id) === null && dynamicFor));
      const wrapped = labels.some((l) => l.index < el.index && l.closeStart > el.index);
      if (!(el.name === "input" && NO_LABEL_TYPES.has(type)) && !named && !bound && !wrapped) {
        out.push({ index: el.index, element: el.name, problem: "no-label", detail: id ? "its id is named by no <label htmlFor> in this file" : "no label, aria-label or aria-labelledby" });
      }
    }
    // no-alt
    if ((el.name === "img" || (imageComponent && el.name === "Image")) && !el.spread && !el.attrs.has("alt")) out.push({ index: el.index, element: el.name, problem: "no-alt", detail: 'no alt (alt="" for a decorative image)' });
    // positive-tabindex
    const tab = el.attrs.get("tabIndex");
    if (tab) {
      const v = tab.kind === "string" ? tab.value : tab.value.trim();
      if (/^\d+$/.test(v) && Number(v) > 0) out.push({ index: tab.index, element: el.name, problem: "positive-tabindex", detail: `tabIndex=${v}` });
    }
    // raw-html
    const raw = el.attrs.get("dangerouslySetInnerHTML");
    if (raw && !SANITIZED.test(raw.value)) out.push({ index: raw.index, element: el.name, problem: "raw-html", detail: "dangerouslySetInnerHTML" });
    // outline in a style object
    const style = el.attrs.get("style");
    if (style?.kind === "expr") {
      const m = /\boutline(?:Style)?\s*:\s*(["'`]?)(none|0)\1/.exec(style.value);
      if (m) out.push({ index: style.valueStart + m.index, element: el.name, problem: "outline-removed", detail: "outline removed in an inline style (no :focus-visible possible there)" });
    }
  }
  return { out, all };
}

/** Class strings with outline-none or outline-0 and no focus-visible: class. */
function classFindings(code, all) {
  const out = [];
  for (const s of stringLiterals(code)) {
    const m = /(?:^|\s)((?:[\w-]+:)*)outline-(?:none|0)(?=\s|$)/.exec(s.text);
    if (!m || /(?:^|\s|:)focus-visible:/.test(s.text)) continue;
    if (/focus-visible/.test(m[1])) continue;
    const owner = all.filter((e) => e.index < s.start && e.openEnd > s.start).pop();
    out.push({ index: s.start + 1 + m.index + (m[0].length - m[0].trimStart().length), element: owner ? owner.name : null, problem: "outline-removed", detail: `${m[1]}outline-${/outline-0/.test(m[0]) ? "0" : "none"} with no focus-visible: class in the same string` });
  }
  return out;
}

/** CSS rules that remove the outline with no :focus-visible in the rule or the rules around it. */
function cssFindings(file, code) {
  const out = [];
  for (const chunk of cssChunks(file, code)) {
    const blocks = cssBlocks(chunk.text);
    for (const m of chunk.text.matchAll(/(^|[{;\s])outline(?:-style)?\s*:\s*(none|0)\s*(?:!important\s*)?(?=;|}|$)/g)) {
      const at = m.index + m[1].length;
      const around = blocks.filter((b) => b.open < at && b.close > at);
      const inner = around.reduce((a, b) => (a && a.open > b.open ? a : b), null);
      const outer = around.reduce((a, b) => (a && a.open < b.open ? a : b), null);
      // A styled or emotion template is itself the rule: with no block around the declaration, the whole template is the scope.
      const scope = outer ? `${outer.selector} ${chunk.text.slice(outer.open, outer.close)}` : isStyleFile(file) ? "" : chunk.text;
      if (/focus-visible/.test(scope)) continue;
      out.push({ index: chunk.offset + at, element: inner ? inner.selector || null : null, problem: "outline-removed", detail: `outline: ${m[2]} with no :focus-visible in the rule` });
    }
  }
  return out;
}

/** innerHTML / outerHTML assignments, insertAdjacentHTML() and document.write() outside strings. */
function sinkFindings(code) {
  const out = [];
  const inString = inStringOf(code);
  const re = /\.(innerHTML|outerHTML)\s*(?:\+)?=(?!=)|\b(insertAdjacentHTML)\s*\(|\bdocument\.(write(?:ln)?)\s*\(/g;
  for (const m of code.matchAll(re)) {
    if (inString(m.index)) continue;
    const lineEnd = code.indexOf("\n", m.index);
    if (SANITIZED.test(code.slice(m.index, lineEnd < 0 ? code.length : lineEnd))) continue;
    const sink = m[1] ?? m[2] ?? `document.${m[3]}`;
    out.push({ index: m.index + (m[1] ? 1 : 0), element: sink, problem: "raw-html", detail: m[1] ? `${m[1]} assigned` : `${sink}()` });
  }
  return out;
}

const PROBLEMS = ["div-click", "no-name", "no-label", "no-alt", "positive-tabindex", "outline-removed", "raw-html"];

await runCli({
  tool: "a11y-names",
  help: HELP,
  options: { base: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const changed = values.base ? changedSince(root, values.base) : null;
    const findings = [];
    const { sources, skipped } = loadSources(root, [...JS_EXTS, ...STYLE_EXTS], { checkTemplates: true });
    for (const { file, src } of sources) {
      if (isTestFile(file)) continue;
      const code = maskComments(src);
      const line = lineIndex(src);
      const found = [];
      let all = [];
      if (JSX_FILE.test(file)) { const j = jsxFindings(code); found.push(...j.out); all = j.all; }
      if (!STYLE_EXTS.some((x) => file.endsWith(x))) { found.push(...classFindings(code, all), ...sinkFindings(code)); }
      found.push(...cssFindings(file, code));
      const seen = new Set();
      for (const f of found) {
        const n = line(f.index);
        const key = `${n}:${f.problem}:${f.element}`;
        if (seen.has(key) || (changed && !isAdded(changed, file, n))) continue;
        seen.add(key);
        findings.push({ file, line: n, element: f.element, problem: f.problem, detail: f.detail });
      }
    }
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || PROBLEMS.indexOf(a.problem) - PROBLEMS.indexOf(b.problem));
    return { root, base: values.base ?? null, findings, skipped };
  },
  text(r) {
    const out = [`findings (${r.findings.length}):`];
    if (r.findings.length) out.push(table([["place", "problem", "element", "detail"], ...r.findings.map((f) => [`${f.file}:${f.line}`, f.problem, f.element ?? "", f.detail])]).trimEnd());
    if (r.skipped.length) out.push(`skipped: ${r.skipped.length}`);
    return out.join("\n") + "\n";
  },
});
