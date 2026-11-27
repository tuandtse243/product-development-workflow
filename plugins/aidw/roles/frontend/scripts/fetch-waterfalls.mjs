#!/usr/bin/env node
// fetch-waterfalls: effects that fetch with no way to stop, effects that only copy props or state into state, and
// awaits in a row that do not depend on each other. A frontend Role tool for rules F7 and F8 (advisory). Node built-ins only.
const HELP = `
Usage: node fetch-waterfalls.mjs [dir] [--base <ref>] [--text]

Lists candidates in the JS/TS/JSX/TSX files of [dir] (default: the working directory). Each finding has a "kind":
  uncancelled-effect-fetch  a useEffect / useLayoutEffect that fetches (fetch, axios, $fetch, ky, fetcher, request,
                            api.get(...), client.users.list(...), or a call named get*, list*, load*, search*, find*,
                            query*, read*, fetch* followed by await or .then) and has no way to ignore a stale answer
                            (F7). An effect is taken as safe when: the signal of an AbortController is passed to the
                            call, or its cleanup calls abort() or a cancel*/unsubscribe function; or its cleanup sets an
                            ignore flag (a variable assigned true or false; a ref's .current alone is not enough: a
                            "mounted" ref does not stop an old answer overwriting a new one); or the answer is checked
                            against a ref (if (reqId.current === id), if (urlRef.current === url)) before it is used.
                            A fetch in a function the effect calls (a useCallback in the same file) counts as in the
                            effect. When the effect is inside a custom hook (useFetch, useData) the detail names the
                            hook: that is where to fix it, for every caller.
  derived-state-effect      a useEffect with dependencies whose only statements are setters of useState values in this
                            file (also inside an if), called with an expression of the dependencies: a copy of props or
                            state that is one render late (F8: compute it while rendering, or useMemo, or key the
                            component). A functional update, setTotal((t) => t + n), is not a copy and is not reported.
  sequential-awaits         inside one block, an \`await\` of a fetch-like call (same names as above, not a POST, PUT,
                            PATCH or DELETE and not create*, update*, delete*, save*, send*, post*) after an earlier one,
                            whose call does not use the earlier result: run them together with Promise.all (F7)

Reads .ts .tsx .js .jsx .mjs .cjs .mts .cts. Test files are not scanned.

Options:
  --base <ref>  only findings on lines added since <ref> (working tree against the ref, plus untracked files). An effect
                is reported when any line from its useEffect( to its closing ) is added; an await, when a line of its
                statement is
  --text        short text instead of JSON
  --help        this text

Output (JSON): { tool, schemaVersion: 1, root, base, findings: [{ file, line, kind, detail }], skipped }
"line" is the useEffect call or the first line of the second await. "skipped" lists what was not read: public/ and
static/ output, *.min.* and *.bundle.*, files over 512 KB, unreadable files, files with a template literal that never closes.

Limits: names decide what is "fetch-like" (a data function named otherwise is not seen); a hook's callers are not
followed, only its own effect; a data library with its own cache (TanStack Query, SWR, RTK Query, Apollo) is not an
effect and is not read; an abort or ignore flag created outside the effect is not seen, and neither is a function the
effect calls that is defined in another file; a dependency between two awaits that goes through a call or a closure is
taken as present only when the name appears in the call text; the await must start its statement
(\`const a = await f()\`); Vue, Svelte, Angular and framework loaders other than plain async functions are not read.
Where a rule is ambiguous the script reports less, not more.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { changedSince, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, matchClose, projectRoot, runCli, splitTop, table } from "../../../library/scripts/_common.mjs";
import { bracketPairs } from "./_markup.mjs";

// ---------------------------------------------------------------- what is fetch-like (the one place the names live)

const READ = "fetch|get|list|load|search|find|query|read|retrieve";
const READ_SUFFIXED = new RegExp(`^(?:${READ})[A-Z0-9_$]`); // getUser, listPosts
const READ_BARE = new RegExp(`^(?:${READ})$`); // api.get, client.users.list
const EXACT = new Set(["fetch", "$fetch", "fetcher", "request"]);
const HTTP_OBJECTS = new Set(["axios", "ky", "api", "http", "client", "request", "got", "$http", "apiClient", "httpClient"]);
const SURE = new Set(["fetch", "$fetch", "axios", "ky"]); // a call of these is a read even with no await or .then
const MUTATING = /^(?:create|update|delete|remove|save|send|post|put|patch|submit|book|cancel|charge|pay|set|add|insert|upsert|mutate)(?:[A-Z0-9_$]|$)/;
const WRITE_VERB = /^(?:post|put|patch|delete)$/;
const CALL = /(?<![\w$.])(?<!\bfunction\s+)([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[\w\s,.|[\]{}:'"&]*>)?\s*\(/g;
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await", "async", "import", "super"]);

/** The first call of an expression, as a dotted name: `api.get("/x")` -> { name: "api.get", last: "get", base: "api", parts }. */
function firstCall(expr) {
  const m = /^\s*\(?\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[\w\s,.|[\]{}:'"&]*>)?\s*\(/.exec(expr);
  if (!m) return null;
  const parts = m[1].split(/\s*\??\.\s*/);
  return { name: parts.join("."), last: parts[parts.length - 1], base: parts.length > 1 ? parts[0] : null, parts };
}

/** Is a call a read from the network or a data layer by its name? */
function fetchLike(call) {
  if (!call) return false;
  if (call.parts.length === 1) return EXACT.has(call.last) || call.last === "axios" || call.last === "ky" || READ_SUFFIXED.test(call.last);
  if (call.base === "axios" || call.base === "ky" || call.base === "$http") return !WRITE_VERB.test(call.last);
  if (HTTP_OBJECTS.has(call.base)) return !WRITE_VERB.test(call.last) && (READ_BARE.test(call.last) || READ_SUFFIXED.test(call.last) || call.last === "request");
  return false; // obj.getItem(...), map.get(...), document.getElementById(...): not the network
}

/** The fetch-like calls of a text (strings blanked): [{ call, open, close }] where open/close bracket the arguments; await/.then needed except for SURE names. */
function fetchCalls(text) {
  const out = [];
  const needsAwait = /\bawait\b|\.then\s*\(/.test(text);
  for (const m of text.matchAll(CALL)) {
    if (KEYWORDS.has(m[1])) continue;
    const call = firstCall(`${m[1]}(`);
    if (!fetchLike(call) || (!needsAwait && !SURE.has(call.parts[0]) && !SURE.has(call.last))) continue;
    const open = m.index + m[0].length - 1;
    out.push({ call, open, close: matchClose(text, open) });
  }
  if (/\bnew\s+XMLHttpRequest\b/.test(text)) out.push({ call: { name: "XMLHttpRequest", last: "XMLHttpRequest", parts: ["XMLHttpRequest"], base: null }, open: 0, close: -1 });
  return out;
}

// ---------------------------------------------------------------- small parsers

/** Statements at the top level of a block body (text of the body): [{ start, end }]. */
function statements(body) {
  const out = [];
  let depth = 0, start = -1, lastSig = "";
  const close = (end) => { if (start >= 0 && body.slice(start, end).trim()) out.push({ start, end }); start = -1; lastSig = ""; };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (start < 0 && /\s/.test(c)) continue;
    if (start < 0) start = i;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < body.length && body[j] !== c) j += body[j] === "\\" ? 2 : 1;
      i = j; lastSig = c; continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (depth === 0 && c === ";") { close(i + 1); continue; }
    if (depth === 0 && c === "\n") {
      const next = /\S/.exec(body.slice(i + 1));
      const sofar = body.slice(start, i);
      const cont = /=>\s*$/.test(sofar) || /[,=+\-*/&|?:(.<>!]/.test(lastSig) || (next !== null && /[.?:+\-*/&|,)=]/.test(next[0]) && !/^(\/\/|\/\*)/.test(body.slice(i + 1 + next.index)));
      if (cont) continue;
      close(i);
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
  }
  close(body.length);
  return out;
}

/** The body of a function declared in the file by name (function f(), const f = () =>, const f = useCallback(() =>): { start, end } or null. */
function localFunction(code, name, bp) {
  const esc = name.replace(/\$/g, "\\$");
  let m = new RegExp(`\\bfunction\\s+${esc}\\s*(?:<[^>(]*>)?\\s*\\(`).exec(code);
  if (m) {
    const pe = bp.get(m.index + m[0].length - 1);
    const b = pe === undefined ? null : /^\s*(?::[^{=]*)?\{/.exec(code.slice(pe + 1, pe + 300));
    const at = b ? pe + b[0].length : -1;
    const e = at < 0 ? undefined : bp.get(at);
    return e === undefined ? null : { start: at, end: e };
  }
  m = new RegExp(`\\b(?:const|let|var)\\s+${esc}\\s*(?::[^=\\n]+)?=\\s*(?:useCallback\\s*\\(\\s*)?(?:async\\s*)?(?:function\\b[^(]*\\([^)]*\\)\\s*(?::[^={]+)?|(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^={=]+)?=>)\\s*`).exec(code);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (code[at] === "{") { const e = bp.get(at); return e === undefined ? null : { start: at, end: e }; }
  const nl = code.indexOf("\n", at);
  return { start: at, end: nl < 0 ? code.length : nl };
}

/** The effect callback body: { body, bodyStart } with indices into `code`, or null. */
function effectBody(argStart, arg) {
  const arrow = arg.indexOf("=>");
  const head = arrow >= 0 ? arg.slice(arrow + 2) : arg;
  if (arrow >= 0 && !/^\s*\{/.test(head)) return { body: head, bodyStart: argStart + arrow + 2 };
  const braceAt = arg.indexOf("{", arrow >= 0 ? arrow : 0);
  if (braceAt < 0) return null;
  const close = matchClose(arg, braceAt);
  if (close < 0) return null;
  return { body: arg.slice(braceAt + 1, close), bodyStart: argStart + braceAt + 1 };
}

/** `setX(args)`, `if (cond) setX(args)` or `if (cond) { setX(args) }`: { setter, args, cond } or null. */
function simpleSetter(text) {
  let t = text.trim().replace(/;$/, "");
  let cond = "";
  const im = /^if\s*\(/.exec(t);
  if (im) {
    const open = im[0].length - 1;
    const close = matchClose(t, open);
    if (close < 0) return null;
    cond = t.slice(open + 1, close);
    t = t.slice(close + 1).trim().replace(/^\{([\s\S]*)\}$/, "$1").trim().replace(/;$/, "");
  }
  const sm = /^(set[A-Z][\w$]*)\s*\(([\s\S]*)\)$/.exec(t);
  return sm ? { setter: sm[1], args: sm[2], cond } : null;
}

const word = (n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}(?![\\w$])`);

/** A line of the cleanup (return () => ..., return function, return name) among the top-level statements of an effect body, with a named cleanup resolved. */
function cleanupText(body, plainStatements, code, bodyStart, bp) {
  const stmt = plainStatements.map((s) => body.slice(s.start, s.end)).find((t) => /^return\s*(?:\(\s*\)\s*(?::[^=]+)?=>|function\b|async\b|[A-Za-z_$][\w$.]*\s*;?\s*$)/.test(t.trim()));
  if (!stmt) return null;
  let text = stmt;
  const id = /^return\s+([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(stmt.trim());
  if (id) {
    const def = localFunction(body, id[1], bracketPairs(body));
    if (def) text += " " + body.slice(def.start, def.end);
    if (/cancel|abort|unsubscribe|dispose|teardown|cleanup/i.test(id[1]) && !def) text += " cancel";
  }
  void code; void bodyStart; void bp;
  return text;
}

const IGNORE_FLAG = /(?<![\w$.])[A-Za-z_$][\w$]*\s*=\s*(?:true|false)\b/;
const REF_COMPARE = /\b\w+\.current\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*\w+\.current\b/;

/** Does an effect (with the functions it calls) have a way to drop a stale answer? */
function handled({ cleanup, fetched, text }) {
  if (fetched.some((f) => f.close > f.open && /\bsignal\b/.test(text.slice(f.open, f.close)))) return true; // the signal goes to the call
  if (cleanup && /\.abort\s*\(|\babort\b|\bcancel\w*|\bunsubscribe\b/i.test(cleanup)) return true;
  if (cleanup && IGNORE_FLAG.test(cleanup)) return true;
  return REF_COMPARE.test(text); // a request id or the latest url kept in a ref, compared before the answer is used
}

function effectFindings(code, blank, line, hooks, bp) {
  const out = [];
  const fnMemo = new Map();
  const stateSetters = new Set([...code.matchAll(/\[\s*[\w$]+\s*,\s*(set[A-Z][\w$]*)\s*\]\s*=\s*useState\b/g)].map((m) => m[1]));
  for (const m of code.matchAll(/\buse(?:Layout)?Effect\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = bp.get(open);
    if (close === undefined) continue;
    const inner = code.slice(open + 1, close);
    const args = splitTop(inner);
    if (!args.length) continue;
    const argStart = open + 1 + inner.indexOf(args[0]);
    const eb = effectBody(argStart, args[0]);
    if (!eb) continue;
    const stmts = statements(eb.body);
    const cleanup = cleanupText(eb.body, stmts, code, eb.bodyStart, bp);
    // the effect's text, with the functions it calls that are declared in this file
    let quiet = blank.slice(eb.bodyStart, eb.bodyStart + eb.body.length);
    let plain = eb.body;
    const seen = new Set();
    for (const c of quiet.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (seen.has(c[1]) || KEYWORDS.has(c[1]) || seen.size > 12) continue;
      seen.add(c[1]);
      if (!fnMemo.has(c[1])) fnMemo.set(c[1], localFunction(code, c[1], bp));
      const fn = fnMemo.get(c[1]);
      if (fn && !(fn.start >= eb.bodyStart && fn.end <= eb.bodyStart + eb.body.length)) { quiet += "\n" + blank.slice(fn.start, fn.end); plain += "\n" + code.slice(fn.start, fn.end); }
    }
    const fetched = fetchCalls(quiet);
    const at = line(m.index);
    const end = close;
    if (fetched.length) {
      if (!handled({ cleanup, fetched, text: quiet })) {
        const hook = hookAt(hooks, m.index);
        const why = cleanup ? "its cleanup does not abort, cancel or set an ignore flag" : "the signal of an AbortController is not passed to it, and there is no ignore flag and no cleanup";
        out.push({ index: m.index, end, kind: "uncancelled-effect-fetch", detail: `${hook ? `in hook ${hook.name}: ` : ""}fetch inside the effect and ${why}: a slow older response can overwrite a newer one` });
      }
      continue;
    }
    void at; void plain;
    // derived-state-effect
    const deps = args[1];
    if (!deps || !/^\[[\s\S]*\]$/.test(deps.trim()) || /^\[\s*\]$/.test(deps.trim()) || cleanup || !stmts.length) continue;
    const texts = stmts.map((s) => eb.body.slice(s.start, s.end).trim().replace(/;$/, ""));
    const depNames = splitTop(deps.trim().slice(1, -1)).map((d) => /^[A-Za-z_$][\w$]*/.exec(d.trim())?.[0]).filter(Boolean);
    const only = texts.every((t) => {
      const sm = simpleSetter(t);
      if (!sm || !stateSetters.has(sm.setter)) return false;
      if (/=>|\bfunction\b|\bawait\b|\.then\b|\basync\b|\bfetch\b|\bPromise\b|\bsetTimeout\b|\bsetInterval\b|\bDate\b|Math\.random/.test(sm.args)) return false;
      return depNames.some((d) => word(d).test(sm.args) || word(d).test(sm.cond));
    });
    if (only) out.push({ index: m.index, end, kind: "derived-state-effect", detail: `the effect only calls ${[...new Set(texts.map((t) => simpleSetter(t).setter))].join(", ")} from ${depNames.join(", ")}: a copy that lags one render; compute it while rendering, with useMemo or with a key` });
  }
  return out;
}

/** Functions named use* (custom hooks): [{ name, start, end }] for the check that names the hook of an effect. */
function hookRanges(code, bp) {
  const out = [];
  for (const m of code.matchAll(/(?:\bfunction\s+(use[A-Z][\w$]*)\s*(?:<[^>(]*>)?\s*\(|\b(?:const|let|var)\s+(use[A-Z][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:function\b[^(]*)?\()/g)) {
    const pe = bp.get(m.index + m[0].length - 1);
    if (pe === undefined) continue;
    const b = /^\s*(?::[^{=]*)?(?:=>\s*)?\{/.exec(code.slice(pe + 1, pe + 300));
    if (!b) continue;
    const at = pe + b[0].length;
    const end = bp.get(at);
    if (end !== undefined) out.push({ name: m[1] ?? m[2], start: at, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The innermost custom hook that holds an index (hooks sorted by start; a binary search, then a few steps back for nested ones). */
function hookAt(hooks, index) {
  let lo = 0, hi = hooks.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hooks[mid].start < index) lo = mid + 1; else hi = mid; }
  for (let k = lo - 1, n = 0; k >= 0 && n < 6; k--, n++) if (hooks[k].end > index) return hooks[k];
  return null;
}

function awaitFindings(code, line, bp) {
  const out = [];
  const awaitAt = [...code.matchAll(/\bawait\b/g)].map((m) => m.index);
  if (!awaitAt.length) return out;
  const hasAwaitIn = (lo, hi) => {
    let a = 0, b = awaitAt.length;
    while (a < b) { const mid = (a + b) >> 1; if (awaitAt[mid] <= lo) a = mid + 1; else b = mid; }
    return a < awaitAt.length && awaitAt[a] < hi;
  };
  const seen = new Set();
  for (const [open, close] of bp) {
    if (code[open] !== "{" || !hasAwaitIn(open, close)) continue;
    const body = code.slice(open + 1, close);
    let prior = []; // await-fetch statements of the current run: { callee, line }
    const taint = new Set();
    const uses = (text) => taint.size > 0 && (text.match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) ?? []).some((id) => taint.has(id));
    for (const s of statements(body)) {
      const text = body.slice(s.start, s.end).trim().replace(/;$/, "");
      if (/^(?:return|throw|if|for|while|switch|try|break|continue|do)\b/.test(text)) { prior = []; taint.clear(); continue; }
      const am = /^(?:(?:const|let|var)\s+([\s\S]+?)\s*=\s*|([A-Za-z_$][\w$]*)\s*=\s*)?await\s+([\s\S]+)$/.exec(text);
      const lhs = am ? (am[1] ?? am[2] ?? "") : "";
      const names = [...lhs.matchAll(/[A-Za-z_$][\w$]*/g)].map((n) => n[0]).filter((n) => !/^(?:const|let|var)$/.test(n));
      if (!am) {
        const bm = /^(?:const|let|var)\s+([\s\S]+?)\s*=\s*([\s\S]+)$/.exec(text);
        if (bm && uses(bm[2])) for (const n of bm[1].matchAll(/[A-Za-z_$][\w$]*/g)) taint.add(n[0]);
        continue;
      }
      const call = firstCall(am[3]);
      const mutates = call && (MUTATING.test(call.last) || /method\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)/i.test(am[3]) || WRITE_VERB.test(call.last));
      if (call && fetchLike(call) && !mutates) {
        if (prior.length && !uses(am[3])) {
          const key = `${open + 1 + s.start}`;
          if (!seen.has(key)) {
            seen.add(key);
            const p = prior[prior.length - 1];
            out.push({ index: open + 1 + s.start, end: open + 1 + s.end, kind: "sequential-awaits", detail: `await ${call.name}(...) does not use the result of the await ${p.callee}(...) on line ${p.line}: start both, then await them together (Promise.all)` });
          }
        }
        prior.push({ callee: call.name, line: line(open + 1 + s.start) });
        for (const n of names) taint.add(n);
      } else {
        // an await of something else: its result may depend on the run; its names join the run
        if (uses(am[3])) for (const n of names) taint.add(n);
        else if (call && !fetchLike(call)) { prior = []; taint.clear(); }
      }
    }
  }
  return out;
}

await runCli({
  tool: "fetch-waterfalls",
  help: HELP,
  options: { base: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const changed = values.base ? changedSince(root, values.base) : null;
    const findings = [];
    const { sources, skipped } = loadSources(root, JS_EXTS, { checkTemplates: true });
    for (const { file, src } of sources) {
      if (isTestFile(file)) continue;
      const code = maskComments(src, false, false, true);
      const blank = maskComments(src, false, true, true); // strings blanked: a "fetch(" in a message is text
      const line = lineIndex(src);
      const bp = bracketPairs(code);
      const found = [...effectFindings(code, blank, line, hookRanges(code, bp), bp), ...awaitFindings(code, line, bp)];
      const seen = new Set();
      for (const f of found) {
        const n = line(f.index);
        const key = `${n}:${f.kind}`;
        if (seen.has(key)) continue;
        if (changed) {
          let any = false;
          for (let l = n, last = line(f.end ?? f.index); l <= last && !any; l++) any = isAdded(changed, file, l);
          if (!any) continue;
        }
        seen.add(key);
        findings.push({ file, line: n, kind: f.kind, detail: f.detail });
      }
    }
    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
    return { root, base: values.base ?? null, findings, skipped };
  },
  text(r) {
    const out = [`findings (${r.findings.length}):`];
    if (r.findings.length) out.push(table([["place", "kind", "detail"], ...r.findings.map((f) => [`${f.file}:${f.line}`, f.kind, f.detail])]).trimEnd());
    if (r.skipped.length) out.push(`skipped: ${r.skipped.length}`);
    return out.join("\n") + "\n";
  },
});
