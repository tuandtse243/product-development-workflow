import { createHash } from "node:crypto";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Paths } from "./project.js";
import { SCOPE_QUESTIONS, SCOPE_ROUND_HEADING } from "./scope.js";

/**
 * Decision Pages (ADR-0007): one round of questions, a pick list or an Approval Gate summary rendered as one
 * self-contained HTML file. The page is a view: the user copies their choices as text, `parseAnswers` checks that
 * text against the page, and the Orchestrator records it where it is recorded anyway.
 */

export const LAYOUTS = ["questions", "picks", "gate"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface PageOption {
  key: string;
  name: string;
  summary: string;
  pros: string[];
  cons: string[];
  facts: Record<string, string>;
  html: string;
  views: PageView[];
}

export interface PageQuestion {
  id: string;
  title: string;
  body: string;
  example: string;
  multi: boolean;
  optional: boolean;
  /** the rows every option answers, so trade-offs line up across the cards */
  criteria: string[];
  recommend: string[];
  /** the recommended answer of an open question (one without options) */
  suggest: string;
  why: string;
  /** the Decision Point this question answers, if any */
  decision: string;
  /** the options are names (of a product, a term): a name needs no View */
  naming: boolean;
  html: string;
  views: PageView[];
  options: PageOption[];
}

export interface PageItem {
  key: string;
  title: string;
  group: string;
  tag: string;
  detail: string;
  recommend: boolean;
  html: string;
}

export interface PageSection {
  id: string;
  title: string;
  body: string;
  points: string[];
  html: string;
  /** optional so the sections the CLI adds itself need not say so */
  views?: PageView[];
}

export interface Page {
  name: string;
  /** first 6 hex of the data's hash: an answer copied from an older render is refused */
  version: string;
  layout: Layout;
  title: string;
  intro: string;
  lang: "en" | "vi";
  role: string;
  /** what the page was built from, e.g. "audit": names the command the answer feeds */
  kind: string;
  /** the change a gate page belongs to: the CLI adds its Decision Points and plan size as sections */
  change: string;
  questions: PageQuestion[];
  items: PageItem[];
  sections: PageSection[];
}

export const pagesDir = (p: Paths): string => join(p.run, "pages");
export const pageDataFile = (p: Paths, name: string): string => join(pagesDir(p), `${name}.yaml`);
export const pageHtmlFile = (p: Paths, name: string): string => join(pagesDir(p), `${name}.html`);

export const PAGE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID = /^[A-Za-z][\w.-]{0,39}$/;
const KEY = /^[A-Za-z0-9][\w.-]{0,39}$/;
const RESERVED = new Set(["note", "picks"]);
const MAX_FRAGMENT = 60_000;

const FRAGMENT_RULES: [RegExp, string][] = [
  [/<\s*\/?\s*(script|iframe|frame|frameset|object|embed|applet|link|meta|base|form|template)\b/i, "the <$1> element"],
  [/\son[a-z]+\s*=/i, "an event handler attribute"],
  [/javascript\s*:/i, "a javascript: link"],
  [/@import/i, "a CSS @import"],
  [/(?:src|href|srcset|poster|action|data)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i, "a network address in an attribute"],
  [/url\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i, "a network address in CSS url()"],
];

/** The free slot takes static HTML, CSS and SVG only. Returns what is not allowed, or null. */
export function checkFragment(html: string): string | null {
  if (html.length > MAX_FRAGMENT) return `is ${html.length} characters; the limit is ${MAX_FRAGMENT}`;
  for (const [re, what] of FRAGMENT_RULES) {
    const m = re.exec(html);
    if (m) return `contains ${what.replace("$1", (m[1] ?? "").toLowerCase())}: the free slot takes static HTML, CSS and SVG only, with no script and nothing loaded from the network`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------- views

/**
 * A View (ADR-0017): the smallest code shape that shows the point of a question, as the vendored show-me skill
 * picks it. Data: `view: {kind, text}` or a list of them. The text is shown as written, escaped, in a monospace
 * block; a diff colours its `+` and `-` lines.
 */
export const VIEW_KINDS = ["diff", "tree", "calltree", "component", "pseudocode"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export interface PageView {
  kind: ViewKind;
  text: string;
}
const MAX_VIEW = 20_000;

/** Reads `view` of a question, an option or a section; problems are named after `where`. */
function parseViews(v: unknown, where: string, problems: string[]): PageView[] {
  if (v === undefined || v === null) return [];
  const at = `${where}.view`;
  return (Array.isArray(v) ? v : [v]).flatMap((x): PageView[] => {
    if (!x || typeof x !== "object" || Array.isArray(x)) {
      problems.push(`${at}: give {kind, text} (kind: ${VIEW_KINDS.join(", ")})`);
      return [];
    }
    const r = x as Record<string, unknown>;
    const kind = typeof r.kind === "string" ? r.kind.trim() : "";
    // Keep the indentation: a tree or a diff's context lines start with spaces. Drop blank lines around the block.
    const body = typeof r.text === "string" ? r.text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "") : "";
    const ok = (VIEW_KINDS as readonly string[]).includes(kind);
    if (!ok) problems.push(`${at}: kind "${kind}" is not one of ${VIEW_KINDS.join(", ")}`);
    if (!body) problems.push(`${at}: text is missing`);
    else if (body.length > MAX_VIEW) problems.push(`${at}: text is ${body.length} characters; the limit is ${MAX_VIEW}`);
    return ok && body && body.length <= MAX_VIEW ? [{ kind: kind as ViewKind, text: body }] : [];
  });
}

/** A yes or no needs no View: exactly two options keyed yes and no. */
const isYesNo = (keys: string[]): boolean => keys.length === 2 && keys.map((k) => k.toLowerCase()).sort().join() === "no,yes";

/** A question with options shows a View or an html mock, on itself or on an option, unless it is a yes or no or a name. */
function checkShown(q: PageQuestion, where: string, problems: string[]): void {
  if (!q.options.length || q.naming || isYesNo(q.options.map((o) => o.key))) return;
  if (q.views.length || q.html || q.options.some((o) => o.views.length || o.html)) return;
  problems.push(
    `${where}: a choice shows a View: give \`view: {kind, text}\` (kind: ${VIEW_KINDS.join(", ")}) on the question or an option, or an \`html\` mock; a yes or no (option keys yes and no) and a name (naming: true) need none`,
  );
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : text(v) ? [text(v)] : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);

function unique(values: string[], what: string, where: string, problems: string[]): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) problems.push(`${where}: ${what} "${v}" appears twice`);
    seen.add(v);
  }
}

/**
 * Reads the data of a page. `extra` are sections the CLI adds to a gate page itself (Decision Points, plan size), after
 * the authored ones; `lead` go before them (the open findings of the plan review).
 * Problems name the field, so the Role that wrote the data can fix it without guessing.
 */
export function parsePage(name: string, source: string, extra: PageSection[] = [], lead: PageSection[] = []): { page: Page; problems: string[] } {
  const problems: string[] = [];
  let raw: Record<string, unknown> = {};
  try {
    raw = obj(parseYaml(source));
  } catch (e) {
    problems.push(`not valid YAML: ${(e as Error).message.split("\n")[0]}`);
  }
  const layout = (LAYOUTS as readonly string[]).includes(text(raw.layout)) ? (text(raw.layout) as Layout) : "questions";
  if (raw.layout !== undefined && text(raw.layout) !== layout) problems.push(`layout: "${text(raw.layout)}" is not one of ${LAYOUTS.join(", ")}`);
  const lang = text(raw.lang) === "vi" ? "vi" : "en";
  if (raw.lang !== undefined && !["en", "vi"].includes(text(raw.lang))) problems.push(`lang: "${text(raw.lang)}" is not en or vi`);
  const page: Page = {
    name,
    version: createHash("sha256").update(source).digest("hex").slice(0, 6),
    layout,
    title: text(raw.title),
    intro: text(raw.intro),
    lang,
    role: text(raw.role),
    kind: text(raw.kind),
    change: text(raw.change),
    questions: [],
    items: [],
    sections: [],
  };
  if (!page.title) problems.push("title: missing");
  const slot = (v: unknown, where: string): string => {
    const html = typeof v === "string" ? v : "";
    const bad = html ? checkFragment(html) : null;
    if (bad) problems.push(`${where}.html ${bad}`);
    return bad ? "" : html;
  };

  if (layout === "questions") {
    page.questions = rows(raw.questions).map((q, i) => {
      const id = text(q.id) || `Q${i + 1}`;
      const where = `questions[${id}]`;
      if (!ID.test(id) || RESERVED.has(id.toLowerCase())) problems.push(`${where}: id must start with a letter, use letters, digits, "-", "_" or ".", and not be "note" or "picks"`);
      const criteria = list(q.criteria);
      const options = rows(q.options).map((o, j) => {
        const key = text(o.key);
        const at = `${where}.options[${key || j + 1}]`;
        if (!KEY.test(key)) problems.push(`${at}: key is missing or not a short slug (letters, digits, "-", "_", ".")`);
        const facts: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj(o.facts))) facts[k.trim()] = text(v);
        for (const k of Object.keys(facts)) if (!criteria.includes(k)) problems.push(`${at}.facts: "${k}" is not one of the question's criteria (${criteria.join(", ") || "none declared"})`);
        for (const c of criteria) if (!facts[c]) problems.push(`${at}.facts: no value for the criterion "${c}"; every option answers every criterion so the cards line up`);
        const opt: PageOption = { key, name: text(o.name), summary: text(o.summary), pros: list(o.pros), cons: list(o.cons), facts, html: slot(o.html, at), views: parseViews(o.view, at, problems) };
        if (!opt.name) problems.push(`${at}: name is missing`);
        if (!opt.summary && !opt.pros.length && !opt.cons.length && !criteria.length) problems.push(`${at}: say what this option gives and costs (summary, pros, cons or facts)`);
        return opt;
      });
      const question: PageQuestion = {
        id,
        title: text(q.title),
        body: text(q.body),
        example: text(q.example),
        multi: q.multi === true,
        optional: q.optional === true,
        criteria,
        recommend: list(q.recommend),
        suggest: text(q.suggest),
        why: text(q.why),
        decision: text(q.decision),
        naming: q.naming === true,
        html: slot(q.html, where),
        views: parseViews(q.view, where, problems),
        options,
      };
      if (!question.title) problems.push(`${where}: title is missing`);
      if (options.length === 1) problems.push(`${where}: one option is not a choice; give at least two, or none for an open question`);
      unique(options.map((o) => o.key), "option key", where, problems);
      for (const r of question.recommend) if (!options.some((o) => o.key === r)) problems.push(`${where}.recommend: "${r}" is not an option key`);
      if (!question.multi && question.recommend.length > 1) problems.push(`${where}.recommend: several keys, but the question is not multi`);
      if (options.length && !question.recommend.length) problems.push(`${where}: recommend is missing; every choice carries the Role's recommended answer and why`);
      if (question.recommend.length && !question.why) problems.push(`${where}: why is missing; say in one or two sentences why that answer is recommended`);
      if (criteria.length === 1 || criteria.length > 4) problems.push(`${where}.criteria: give 2 to 4 criteria, or none`);
      checkShown(question, where, problems);
      return question;
    });
    if (!page.questions.length) problems.push("questions: missing or empty");
    unique(page.questions.map((q) => q.id), "question id", "questions", problems);
  }
  // The scope round of the discovery interview (scope.ts): its answer is recorded where `aidw analyze` looks for it.
  if (page.kind === "scope") {
    if (layout !== "questions") problems.push("kind: scope is a round of questions (layout: questions)");
    else
      for (const id of SCOPE_QUESTIONS) {
        const q = page.questions.find((x) => x.id === id);
        if (!q) problems.push(`kind: scope needs the question "${id}" (${SCOPE_QUESTIONS.join(", ")})`);
        else if (q.optional) problems.push(`kind: scope: the question "${id}" may not be optional; the round records an answer to each`);
        if (q && id === "scope" && (!q.multi || q.options.length < 2)) problems.push('kind: scope: the question "scope" is a multi choice with one option per capability (multi: true, options)');
      }
  }

  if (layout === "picks") {
    page.items = rows(raw.items).map((it, i) => {
      const key = text(it.key);
      const where = `items[${key || i + 1}]`;
      if (!KEY.test(key)) problems.push(`${where}: key is missing or not a short slug`);
      const item: PageItem = { key, title: text(it.title), group: text(it.group), tag: text(it.tag), detail: text(it.detail), recommend: it.recommend === true, html: slot(it.html, where) };
      if (!item.title) problems.push(`${where}: title is missing`);
      return item;
    });
    if (!page.items.length) problems.push("items: missing or empty");
    unique(page.items.map((x) => x.key), "item key", "items", problems);
  }

  if (layout === "gate") {
    page.sections = [
      ...lead,
      ...rows(raw.sections).map((s, i) => {
        const id = text(s.id);
        const where = `sections[${id || i + 1}]`;
        if (!ID.test(id) || RESERVED.has(id.toLowerCase())) problems.push(`${where}: id is missing or not a short slug starting with a letter`);
        const section: PageSection = { id, title: text(s.title), body: text(s.body), points: list(s.points), html: slot(s.html, where), views: parseViews(s.view, where, problems) };
        if (!section.title) problems.push(`${where}: title is missing`);
        if (!section.body && !section.points.length && !section.html && !section.views?.length) problems.push(`${where}: nothing to read; give body, points, html or a view`);
        return section;
      }),
      ...extra,
    ];
    if (!page.sections.length) problems.push("sections: missing or empty");
    unique(page.sections.map((s) => s.id), "section id", "sections", problems);
  }
  return { page, problems };
}

// ---------------------------------------------------------------------------------------------------- rendering

const LABELS = {
  en: {
    one: "choose one",
    many: "choose any",
    open: "your answer",
    rec: "Recommended",
    why: "Why",
    example: "Example",
    note: "Note or another answer (optional)",
    answer: "Type your answer",
    general: "Anything else for this round (optional)",
    copy: "Copy answers",
    copied: "Copied. Paste it into the chat",
    manual: "Selected. Press Cmd/Ctrl+C",
    hint: "Choose, then copy and paste the text into the chat.",
    group: "all of",
    other: "Other",
    ok: "Agree",
    change: "Needs a change",
    changeNote: "What should change (required when you ask for a change)",
    allOk: "Agree with all",
    optional: "optional",
  },
  vi: {
    one: "chọn một",
    many: "chọn nhiều",
    open: "câu trả lời của bạn",
    rec: "Đề xuất",
    why: "Vì sao",
    example: "Ví dụ",
    note: "Ghi chú hoặc phương án khác (không bắt buộc)",
    answer: "Nhập câu trả lời",
    general: "Ý khác cho vòng này (không bắt buộc)",
    copy: "Sao chép câu trả lời",
    copied: "Đã sao chép. Hãy dán vào chat",
    manual: "Đã bôi đen. Bấm Cmd/Ctrl+C",
    hint: "Chọn xong thì sao chép rồi dán khối chữ vào chat.",
    group: "cả nhóm",
    other: "Khác",
    ok: "Đồng ý",
    change: "Cần sửa",
    changeNote: "Cần sửa gì (bắt buộc khi chọn cần sửa)",
    allOk: "Đồng ý tất cả",
    optional: "không bắt buộc",
  },
} as const;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Plain text with `code`, **bold** and line breaks; everything else is escaped. */
const inline = (s: string): string =>
  esc(s)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
/** A free fragment lives in its own shadow tree, so its CSS cannot reach the page and the page's cannot reach it. */
const free = (html: string): string => (html ? `<div class="free"><template shadowrootmode="open">${html}</template></div>` : "");

/** What each kind of View is called above its block. */
const VIEW_NAMES: Record<ViewKind, string> = { diff: "diff", tree: "file tree", calltree: "call tree", component: "component tree", pseudocode: "pseudocode" };
const VIEW_CSS = `
.view{margin:0;display:flex;flex-direction:column;gap:4px;min-width:0}
.view figcaption{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.view pre{margin:0;padding:10px 12px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;font:12.5px/1.5 ui-monospace,"SF Mono",Menlo,monospace;tab-size:2}
.view pre span{display:inline-block;min-width:100%}
.view .add{color:var(--good);background:var(--good-soft)}
.view .del{color:var(--bad);background:var(--warn-soft)}
.view .hunk{color:var(--muted)}
`;

/** Each View as an escaped monospace block; a diff gets its added and removed lines coloured. */
function renderViews(views: PageView[] | undefined): string {
  return (views ?? [])
    .map((v) => {
      const body =
        v.kind === "diff"
          ? v.text
              .split("\n")
              .map((line) => `<span class="${line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx"}">${esc(line)}</span>`)
              .join("\n")
          : esc(v.text);
      return `<figure class="view" data-kind="${v.kind}"><figcaption>${VIEW_NAMES[v.kind]}</figcaption><pre>${body}</pre></figure>`;
    })
    .join("");
}

const CSS = `
:root{--bg:#f3f5f9;--surface:#fff;--fg:#17202e;--muted:#5b6678;--line:#d6dce6;--accent:#2f55d4;--accent-soft:#e4eafc;--good:#17794a;--good-soft:#dff3e8;--bad:#a8442a;--warn-soft:#fbeedd}
@media (prefers-color-scheme:dark){:root{--bg:#11151c;--surface:#1a202a;--fg:#e7ebf2;--muted:#9aa5b8;--line:#2e3746;--accent:#8aa4ff;--accent-soft:#232f52;--good:#6fd3a0;--good-soft:#173527;--bad:#f0a084;--warn-soft:#3a2d1a;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:28px 16px 170px}
.wrap{max-width:1040px;margin:0 auto;display:flex;flex-direction:column;gap:28px}
h1,h2,h3{margin:0;line-height:1.25;text-wrap:balance}
h1{font-size:26px}h2{font-size:19px}h3{font-size:15px}
p{margin:0;max-width:72ch}
.lede,.why{color:var(--muted)}.why b{color:var(--fg)}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.88em;background:var(--accent-soft);padding:1px 5px;border-radius:4px}
.q{display:flex;flex-direction:column;gap:12px;padding-top:24px;border-top:1px solid var(--line)}
.q>header{display:flex;flex-direction:column;gap:6px}
.eg{background:var(--warn-soft);border-radius:8px;padding:10px 12px;font-size:14px;max-width:none}
.opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.opt{display:flex;flex-direction:column;gap:8px;background:var(--surface);border:1.5px solid var(--line);border-radius:10px;padding:14px;cursor:pointer;min-width:0}
.opt:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.opt:has(input:focus-visible),button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.top{display:flex;gap:8px;align-items:flex-start}
.top input{margin:4px 0 0;accent-color:var(--accent);flex:none}
.name{font-weight:600}
.sum{font-size:14px}
.badge{align-self:flex-start;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--good);background:var(--good-soft);padding:2px 8px;border-radius:99px}
.tag{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);padding:1px 7px;border-radius:99px}
.pm{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:14px}
.pm li{padding-left:18px;position:relative}
.pm li::before{position:absolute;left:0;font-weight:700}
.pm .p::before{content:"+";color:var(--good)}.pm .m::before{content:"\\2212";color:var(--bad)}
.facts{margin:auto 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:13px;border-top:1px solid var(--line);padding-top:8px}
.facts dt{color:var(--muted)}.facts dd{margin:0;font-weight:500}
.free{border:1px solid var(--line);border-radius:8px;overflow:auto;background:var(--surface)}
textarea{width:100%;font:inherit;font-size:14px;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-height:40px;resize:vertical}
.group{display:flex;flex-direction:column;gap:8px}
.group>header{display:flex;gap:10px;align-items:baseline;justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:18px}
.all{font-size:13px;color:var(--muted);display:flex;gap:6px;align-items:center;cursor:pointer}
.item{flex-direction:row;gap:10px;align-items:flex-start}
.item>input{margin:4px 0 0;accent-color:var(--accent);flex:none}
.item>div{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
.item .head{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.key{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--muted)}
.detail{font-size:14px;color:var(--muted)}
.sec{background:var(--surface);border:1.5px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px}
.sec:has(input[value=ok]:checked){border-color:var(--good)}
.sec:has(input[value=change]:checked){border-color:var(--bad)}
.sec ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:3px}
.mark{display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px}
.mark label{display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:500}
.mark input{accent-color:var(--accent)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:10px 16px}
.bar .in{max-width:1040px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bar pre{flex:1 1 320px;min-width:0;margin:0;font:12px/1.45 ui-monospace,Menlo,monospace;max-height:96px;overflow:auto;white-space:pre-wrap;color:var(--muted);user-select:all}
.bar .side{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.bar small{color:var(--muted)}
button{font:inherit;font-weight:600;color:var(--surface);background:var(--accent);border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
button.quiet{color:var(--accent);background:transparent;border:1.5px solid var(--accent);padding:6px 12px;align-self:flex-start}
[hidden]{display:none!important}
`;

type L = (typeof LABELS)[keyof typeof LABELS];

function renderQuestion(q: PageQuestion, page: Page, l: L): string {
  const kind = q.options.length ? (q.multi ? l.many : l.one) : l.open;
  const head = `<header><span class="eyebrow">${esc(q.id)} · ${kind}${q.optional ? ` · ${l.optional}` : ""}${page.role ? ` · ${esc(page.role)}` : ""}</span><h2>${inline(q.title)}</h2>${q.body ? `<p>${inline(q.body)}</p>` : ""}</header>`;
  const example = q.example ? `<p class="eg"><b>${l.example}:</b> ${inline(q.example)}</p>` : "";
  const why = q.why ? `<p class="why"><b>${l.why}:</b> ${inline(q.why)}</p>` : "";
  if (!q.options.length) {
    return `<section class="q" data-q="${esc(q.id)}" data-kind="open">${head}${example}${renderViews(q.views)}${free(q.html)}${why}<textarea id="a-${esc(q.id)}" placeholder="${l.answer}">${esc(q.suggest)}</textarea></section>`;
  }
  const cards = q.options
    .map((o) => {
      const rec = q.recommend.includes(o.key);
      const lines = [...o.pros.map((x) => `<li class="p">${inline(x)}</li>`), ...o.cons.map((x) => `<li class="m">${inline(x)}</li>`)].join("");
      const facts = q.criteria.length ? `<dl class="facts">${q.criteria.map((c) => `<dt>${esc(c)}</dt><dd>${inline(o.facts[c] ?? "")}</dd>`).join("")}</dl>` : "";
      return `<label class="opt"><span class="top"><input type="${q.multi ? "checkbox" : "radio"}" name="q-${esc(q.id)}" id="q-${esc(q.id)}-${esc(o.key)}" value="${esc(o.key)}"${rec ? " checked" : ""}><span class="name">${inline(o.name)}</span></span>${rec ? `<span class="badge">${l.rec}</span>` : ""}${o.summary ? `<span class="sum">${inline(o.summary)}</span>` : ""}${lines ? `<ul class="pm">${lines}</ul>` : ""}${renderViews(o.views)}${free(o.html)}${facts}</label>`;
    })
    .join("");
  return `<section class="q" data-q="${esc(q.id)}" data-kind="choice">${head}${example}${renderViews(q.views)}${free(q.html)}<div class="opts">${cards}</div>${why}<textarea id="n-${esc(q.id)}" placeholder="${l.note}"></textarea></section>`;
}

function renderPicks(page: Page, l: L): string {
  const groups: string[] = [];
  for (const it of page.items) if (!groups.includes(it.group)) groups.push(it.group);
  return groups
    .map((g, gi) => {
      const items = page.items.filter((it) => it.group === g);
      const cards = items
        .map(
          (it) =>
            `<label class="opt item"><input type="checkbox" data-pick data-g="${gi}" id="p-${esc(it.key)}" value="${esc(it.key)}"${it.recommend ? " checked" : ""}><div><span class="head"><span class="key">${esc(it.key)}</span><span class="name">${inline(it.title)}</span>${it.tag ? `<span class="tag">${esc(it.tag)}</span>` : ""}${it.recommend ? `<span class="badge">${l.rec}</span>` : ""}</span>${it.detail ? `<span class="detail">${inline(it.detail)}</span>` : ""}${free(it.html)}</div></label>`,
        )
        .join("");
      return `<section class="group"><header><h2>${esc(g || l.other)} <span class="key">(${items.length})</span></h2><label class="all"><input type="checkbox" data-group="${gi}" id="g-${gi}">${l.group} ${esc(g || l.other)}</label></header>${cards}</section>`;
    })
    .join("");
}

function renderGate(page: Page, l: L): string {
  const sections = page.sections
    .map(
      (s) =>
        `<section class="sec" data-sec="${esc(s.id)}"><h2>${inline(s.title)}</h2>${s.body ? `<p>${inline(s.body)}</p>` : ""}${s.points.length ? `<ul>${s.points.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>` : ""}${renderViews(s.views)}${free(s.html)}<div class="mark"><label><input type="radio" name="s-${esc(s.id)}" id="s-${esc(s.id)}-ok" value="ok">${l.ok}</label><label><input type="radio" name="s-${esc(s.id)}" id="s-${esc(s.id)}-change" value="change">${l.change}</label></div><textarea id="n-${esc(s.id)}" placeholder="${l.changeNote}"></textarea></section>`,
    )
    .join("");
  return `<button type="button" class="quiet" id="allok">${l.allOk}</button>${sections}`;
}

const SCRIPT = `
(function(){
var P=__PAGE__,out=document.getElementById("out"),btn=document.getElementById("copy");
function one(s){return (s||"").replace(/\\s*\\n\\s*/g," / ").trim()}
function note(el){var t=el.querySelector("textarea");return t?one(t.value):""}
function build(){
  var L=["aidw page "+P.name+" "+P.version];
  document.querySelectorAll("[data-q]").forEach(function(s){
    var id=s.getAttribute("data-q"),n=note(s);
    if(s.getAttribute("data-kind")==="open"){L.push(id+": > "+n);return}
    var k=[].map.call(s.querySelectorAll("input:checked"),function(i){return i.value});
    L.push(id+": "+k.join(", ")+(n?" | note: "+n:""));
  });
  if(P.layout==="picks"){
    var k=[].map.call(document.querySelectorAll("input[data-pick]:checked"),function(i){return i.value});
    L.push("picks: "+(k.join(", ")||"none"));
  }
  document.querySelectorAll("[data-sec]").forEach(function(s){
    var c=s.querySelector("input:checked"),n=note(s);
    L.push(s.getAttribute("data-sec")+": "+(c?c.value:"")+(n?" | note: "+n:""));
  });
  var g=one(document.getElementById("general").value);
  if(g)L.push("note: "+g);
  return L.join("\\n");
}
function show(){out.textContent=build()}
document.addEventListener("input",show);
document.addEventListener("change",function(e){
  var t=e.target;
  if(t&&t.hasAttribute&&t.hasAttribute("data-group"))[].forEach.call(document.querySelectorAll('input[data-pick][data-g="'+t.getAttribute("data-group")+'"]'),function(i){i.checked=t.checked});
  show();
});
var all=document.getElementById("allok");
if(all)all.addEventListener("click",function(){[].forEach.call(document.querySelectorAll('input[value="ok"]'),function(i){i.checked=true});show()});
function done(m){btn.textContent=m;setTimeout(function(){btn.textContent=P.copy},2200)}
function manual(){
  var ok=false;
  try{var a=document.createElement("textarea");a.value=build();a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();ok=document.execCommand("copy");document.body.removeChild(a)}catch(e){}
  if(ok){done(P.copied);return}
  var r=document.createRange();r.selectNodeContents(out);var s=getSelection();s.removeAllRanges();s.addRange(r);done(P.manual);
}
btn.addEventListener("click",function(){
  show();
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(build()).then(function(){done(P.copied)},manual);
  else manual();
});
show();
})();
`;

/** One self-contained HTML file: no network loads, light and dark, usable on a phone. */
export function renderPage(page: Page): string {
  const l = LABELS[page.lang];
  const body = page.layout === "questions" ? page.questions.map((q) => renderQuestion(q, page, l)).join("") : page.layout === "picks" ? renderPicks(page, l) : renderGate(page, l);
  const data = JSON.stringify({ name: page.name, version: page.version, layout: page.layout, copy: l.copy, copied: l.copied, manual: l.manual }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<style>${CSS}${VIEW_CSS}</style>
</head>
<body>
<div class="wrap">
<header style="display:flex;flex-direction:column;gap:10px"><span class="eyebrow">aidw · ${esc(page.name)}</span><h1>${inline(page.title)}</h1>${page.intro ? `<p class="lede">${inline(page.intro)}</p>` : ""}</header>
${body}
<section class="q"><textarea id="general" placeholder="${l.general}"></textarea></section>
</div>
<div class="bar"><div class="in"><pre id="out"></pre><div class="side"><button type="button" id="copy">${l.copy}</button><small>${l.hint}</small></div></div></div>
<script>${SCRIPT.replace("__PAGE__", () => data)}</script>
</body>
</html>
`;
}

/** What the terminal says instead of the questions themselves. */
export function pageSummary(page: Page): string {
  if (page.layout === "questions") return `${page.questions.length} question(s): ${page.questions.map((q) => `${q.id} ${q.title}`).join("; ")}`;
  if (page.layout === "picks") return `${page.items.length} item(s) to pick from, ${page.items.filter((x) => x.recommend).length} recommended`;
  return `${page.sections.length} section(s) to agree or send back: ${page.sections.map((s) => s.title).join("; ")}`;
}

// ------------------------------------------------------------------------------------------------------ answers

export interface Answer {
  id: string;
  title: string;
  /** chosen option keys, picked item keys, or ["ok"] / ["change"] for a gate section */
  keys: string[];
  names: string[];
  /** the text of an open question */
  text: string;
  note: string;
  decision: string;
}

export interface Answers {
  ok: boolean;
  problems: string[];
  answers: Answer[];
  note: string;
  /** what the answer feeds next: a command, or what the Orchestrator does */
  next: string[];
}

const NOTE = /\s*\|\s*note:\s*/i;
const keysOf = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Checks the text the user pasted against the page it came from. Nothing is recorded here. */
export function parseAnswers(page: Page, pasted: string): Answers {
  const problems: string[] = [];
  const lines = pasted.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const at = lines.findIndex((x) => /^aidw page \S+/.test(x));
  const head = at >= 0 ? /^aidw page (\S+)(?:\s+([0-9a-f]{6}))?/.exec(lines[at] as string) : null;
  if (!head) problems.push(`the first line "aidw page ${page.name} ${page.version}" is missing: paste the whole text the copy button gives`);
  else if (head[1] !== page.name) problems.push(`this answer is for the page "${head[1]}", not "${page.name}"`);
  else if (head[2] !== page.version) problems.push(`the page changed after this answer was copied (answer ${head[2] ?? "without version"}, page ${page.version}): ask the user to reload the page and copy again`);
  const given = new Map<string, string>();
  for (const line of lines.slice(at + 1)) {
    const m = /^([A-Za-z][\w.-]*):\s*(.*)$/.exec(line);
    if (!m) {
      problems.push(`cannot read the line "${line.slice(0, 80)}"`);
      continue;
    }
    if (given.has(m[1] as string)) problems.push(`"${m[1]}" is answered twice`);
    given.set(m[1] as string, m[2] as string);
  }
  const answers: Answer[] = [];
  const next: string[] = [];
  const split = (v: string): [string, string] => {
    const i = v.search(NOTE);
    return i < 0 ? [v.trim(), ""] : [v.slice(0, i).trim(), v.slice(i).replace(NOTE, "").trim()];
  };
  const known = new Set<string>(["note"]);

  for (const q of page.questions) {
    known.add(q.id);
    const v = given.get(q.id);
    if (v === undefined) {
      problems.push(`${q.id} (${q.title}) has no line in the answer`);
      continue;
    }
    if (!q.options.length) {
      const t = v.replace(/^>\s*/, "").trim();
      if (!t && !q.optional) problems.push(`${q.id} (${q.title}) is not answered`);
      answers.push({ id: q.id, title: q.title, keys: [], names: [], text: t, note: "", decision: q.decision });
      continue;
    }
    const [k, note] = split(v);
    const keys = keysOf(k);
    for (const key of keys) if (!q.options.some((o) => o.key === key)) problems.push(`${q.id}: "${key}" is not an option (options: ${q.options.map((o) => o.key).join(", ")})`);
    if (!keys.length && !note && !q.optional) problems.push(`${q.id} (${q.title}) is not answered: no option chosen and no note`);
    if (!q.multi && keys.length > 1) problems.push(`${q.id} takes one option, got ${keys.length}`);
    answers.push({ id: q.id, title: q.title, keys, names: keys.map((key) => q.options.find((o) => o.key === key)?.name ?? key), text: "", note, decision: q.decision });
    if (q.decision && keys.length) next.push(`aidw decide ${q.decision} ${keys.join(",")} --reason "<the reason, from the recommendation or the user's note>"`);
  }

  if (page.layout === "picks") {
    known.add("picks");
    const v = given.get("picks");
    if (v === undefined) problems.push('the "picks:" line is missing');
    else {
      const keys = v.trim().toLowerCase() === "none" ? [] : keysOf(v);
      for (const key of keys) if (!page.items.some((x) => x.key === key)) problems.push(`picks: "${key}" is not an item of this page`);
      answers.push({ id: "picks", title: page.title, keys, names: keys.map((key) => page.items.find((x) => x.key === key)?.title ?? key), text: "", note: "", decision: "" });
      if (page.kind === "audit") next.push(keys.length ? `aidw audit picks ${keys.join(",")}` : "nothing was picked: the audit ends with its report");
    }
  }

  for (const s of page.sections) {
    known.add(s.id);
    const v = given.get(s.id);
    const [mark, note] = split(v ?? "");
    if (mark !== "ok" && mark !== "change") {
      problems.push(`section "${s.title}" (${s.id}) is not marked: the user chooses agree or needs a change`);
      continue;
    }
    if (mark === "change" && !note) problems.push(`section "${s.title}" (${s.id}) needs a change but the note does not say what`);
    answers.push({ id: s.id, title: s.title, keys: [mark], names: [mark], text: "", note, decision: "" });
  }
  if (page.layout === "gate" && !problems.length) {
    const change = answers.filter((a) => a.keys[0] === "change");
    next.push(
      change.length
        ? `${change.length} section(s) need a change: the Role that owns each one revises it, then show the gate again`
        : "every section is agreed: the user approves with /aidw:approve (the approval itself is theirs, behind the permission prompt)",
    );
  }
  for (const id of given.keys()) if (!known.has(id)) problems.push(`"${id}" is not part of this page`);
  if (page.kind === "scope" && !problems.length) next.push(`record these lines word for word under "### ${SCOPE_ROUND_HEADING}" in the discovery appendix of analysis.md`);
  return { ok: problems.length === 0, problems, answers, note: given.get("note") ?? "", next };
}

/** The checked answer as plain lines, ready to be recorded word for word. */
export function answersText(page: Page, a: Answers): string {
  const lines = a.answers.map((x) => {
    const value = x.text ? x.text : x.keys.length ? x.keys.map((k, i) => (x.names[i] && x.names[i] !== k ? `${k} (${x.names[i]})` : k)).join(", ") : "(none)";
    return `${x.id === "picks" ? "picks" : `${x.id} ${x.title}`}: ${value}${x.note ? ` | note: ${x.note}` : ""}`;
  });
  return [...lines, ...(a.note ? [`note: ${a.note}`] : []), ...a.next.map((n) => `NEXT: ${n}`)].join("\n") + "\n";
}

// ------------------------------------------------------------------------------------ pages the CLI builds itself

export interface Row {
  [key: string]: unknown;
}

/** A pick list from rows the CLI already has (audit findings), as page data. */
export function picksData(o: { title: string; intro: string; lang?: string; kind: string; items: { key: string; title: string; group: string; tag?: string; detail?: string; recommend?: boolean }[] }): Row {
  return { layout: "picks", title: o.title, intro: o.intro, lang: o.lang ?? "en", kind: o.kind, items: o.items };
}

/**
 * The decision an upstream Triage asks of the user. The diagnosis may end with a `## Decide` section holding one
 * YAML block (question, criteria, recommend, why, options); without it the two standing ways out are offered.
 */
export function triageData(o: { task: string; cause: string; diagnosis: string; lang?: string }): Row {
  const at = o.diagnosis.search(/^## Decide\s*$/m);
  const intro = (at < 0 ? o.diagnosis : o.diagnosis.slice(0, at)).replace(/^CAUSE:.*\n?/, "").trim();
  const block = at < 0 ? null : /```(?:yaml)?\n([\s\S]*?)```/.exec(o.diagnosis.slice(at));
  let decide: Record<string, unknown> = {};
  try {
    decide = block ? obj(parseYaml(block[1] as string)) : {};
  } catch {
    decide = {};
  }
  const fallback = {
    title: `What should happen with ${o.task}?`,
    criteria: [],
    recommend: "fix-and-resume",
    why: "The diagnosis names what is wrong; fixing that keeps the approved scope.",
    options: [
      {
        key: "fix-and-resume",
        name: "Fix what the diagnosis names, then resume",
        pros: ["The approved package stays as it is"],
        cons: ["You make or approve the fix first"],
        view: { kind: "pseudocode", text: `fix the ${o.cause} as the diagnosis says\nresume ${o.task} with a fresh attempt\nthe rest of the run goes on as approved` },
      },
      {
        key: "change-scope",
        name: "Change the scope",
        pros: ["Removes the cause when the requirement itself is the problem"],
        cons: ["The change is analyzed and approved again"],
        view: { kind: "pseudocode", text: `revise the requirement behind ${o.task}\nanalyze the package again\nshow the Approval Gate again\nresume the run from the new plan` },
      },
    ],
  };
  const q = Array.isArray(decide.options) && decide.options.length >= 2 ? { title: text(decide.question) || fallback.title, ...decide } : fallback;
  return {
    layout: "questions",
    title: `${o.task} stopped: the cause is the ${o.cause}`,
    intro: intro.slice(0, 2400),
    lang: o.lang ?? "en",
    role: "software-architect",
    kind: "triage",
    questions: [{ id: "decide", ...q }],
  };
}
