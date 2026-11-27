#!/usr/bin/env node
// fetch-waterfalls: effects that fetch with no way to stop, effects that only copy props or state into state, and
// awaits in a row that do not depend on each other. A frontend Role tool for rules F7 and F8 (advisory). Node built-ins only.
const HELP = `
Usage: node fetch-waterfalls.mjs [dir] [--base <ref>] [--text]

Lists candidates in the JS/TS/JSX/TSX files of [dir] (default: the working directory). Each finding has a "kind":
  uncancelled-effect-fetch  a useEffect / useLayoutEffect that fetches (fetch, axios, $fetch, ky, or a call named
                            get*, list*, load*, search*, find*, query*, read*, fetch* followed by await or .then) and
                            has no AbortController / signal / abort, and no cleanup that sets an ignore flag or cancels
                            (F7). When the effect is inside a custom hook (useFetch, useData) the detail names the hook:
                            that is where to fix it, for every caller.
  derived-state-effect      a useEffect with dependencies whose only statements are setters of useState values in this
                            file, called with an expression of the dependencies: a copy of props or state that is one
                            render late (F8: compute it while rendering, or useMemo, or key the component)
  sequential-awaits         inside one block, an \`await\` of a fetch-like call (same names as above, not a POST, PUT,
                            PATCH or DELETE and not create*, update*, delete*, save*, send*, post*) after an earlier one,
                            whose call does not use the earlier result: run them together with Promise.all (F7)

Reads .ts .tsx .js .jsx .mjs .cjs .mts .cts. Test files are not scanned.

Options:
  --base <ref>  only findings on lines added since <ref> (working tree against the ref, plus untracked files)
  --text        short text instead of JSON
  --help        this text

Output (JSON): { tool, schemaVersion: 1, root, base, findings: [{ file, line, kind, detail }], skipped }
"line" is the useEffect call or the second await. "skipped" lists what was not read: public/ and static/ output,
*.min.* and *.bundle.*, files over 512 KB, unreadable files, files with a template literal that never closes.

Limits: names decide what is "fetch-like" (a data function named otherwise is not seen); a hook's callers are not
followed, only its own effect; a data library with its own cache (TanStack Query, SWR, RTK Query, Apollo) is not an
effect and is not read; an abort or ignore flag created outside the effect is not seen; a dependency between two
awaits that goes through a call or a closure is taken as present only when the name appears in the call text; the
await must start its statement (\`const a = await f()\`); Vue, Svelte, Angular and framework loaders other than plain
async functions are not read.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { changedSince, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, matchClose, projectRoot, runCli, splitTop, table } from "../../../library/scripts/_common.mjs";

const FETCH_NAME = /^(?:fetch|get|list|load|search|find|query|read|retrieve)(?:[A-Z0-9_$]|$)/;
const MUTATING = /^(?:create|update|delete|remove|save|send|post|put|patch|submit|book|cancel|charge|pay|set|add|insert|upsert|mutate)(?:[A-Z0-9_$]|$)/;
const HTTP_OBJECTS = new Set(["axios", "ky", "api", "http", "client", "request", "got", "$http"]);

/** Statements at the top level of a block body (text of the body, comments and strings blanked): [{ start, end }]. */
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
      const cont = /[,=+\-*/&|?:(.<>!]/.test(lastSig) && !/=>\s*$/.test(body.slice(start, i)) ? true : /^\s*$/.test(body.slice(start, i)) ? false : next !== null && /[.?:+\-*/&|,)=]/.test(next[0]) && !/^(\/\/|\/\*)/.test(body.slice(i + 1 + next.index));
      if (/=>\s*$/.test(body.slice(start, i)) || cont) continue;
      close(i);
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
  }
  close(body.length);
  return out;
}

/** The first call of an expression, as a dotted name: `api.get("/x")` -> { name: "api.get", last: "get", base: "api" }. */
function firstCall(expr) {
  const m = /^\s*\(?\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^()]*>)?\s*\(/.exec(expr);
  if (!m) return null;
  const parts = m[1].split(/\s*\??\.\s*/);
  return { name: parts.join("."), last: parts[parts.length - 1], base: parts.length > 1 ? parts[0] : null, parts };
}

/** Is a call a read from the network or a data layer by its name? */
function fetchLike(call) {
  if (!call) return false;
  if (call.parts.length === 1) return call.last === "fetch" || call.last === "$fetch" || HTTP_OBJECTS.has(call.last) || FETCH_NAME.test(call.last);
  if (call.base === "axios" || call.base === "ky" || call.base === "$http") return !/^(?:post|put|patch|delete)$/.test(call.last);
  if (HTTP_OBJECTS.has(call.base)) return /^(?:get|fetch|list|load|search|find|query|read)/.test(call.last);
  return false; // obj.getItem(...), map.get(...), document.getElementById(...): not the network
}

/** Does text hold a read from the network? ("fetch(" and friends, or a get*-named call used with await or .then). */
function hasFetchCall(text) {
  if (/(?<![\w$.])(?:fetch|\$fetch)\s*\(|\b(?:axios|ky)\b\s*(?:\.\s*(?:get|request)\s*)?\(|\bnew\s+XMLHttpRequest\b/.test(text)) return true;
  if (!/\bawait\b|\.then\s*\(/.test(text)) return false;
  for (const m of text.matchAll(/(?<![\w$.])((?:\w+\.)?[A-Za-z_$][\w$]*)\s*\(/g)) {
    const call = firstCall(`${m[1]}(`);
    if (call && call.parts.length === 1 && FETCH_NAME.test(call.last) && call.last !== "get" && call.last !== "find" && call.last !== "read") return true;
    if (call && call.parts.length === 1 && /^(?:getData|get[A-Z]\w*|list[A-Z]\w*|load[A-Z]\w*|search[A-Z]?\w*|query[A-Z]\w*)$/.test(call.last)) return true;
    if (call && call.parts.length > 1 && HTTP_OBJECTS.has(call.base) && fetchLike(call)) return true;
  }
  return false;
}

const SAFE_WORDS = /\bAbortController\b|\.abort\s*\(|\bsignal\b/;

/** The effect callback body and whether it is an arrow with an expression body: { body, bodyStart } with indices into `code`. */
function effectBody(code, argStart, arg) {
  const arrow = arg.indexOf("=>");
  const braceAt = arg.indexOf("{", arrow >= 0 ? arrow : 0);
  const head = arrow >= 0 ? arg.slice(arrow + 2) : arg;
  if (arrow >= 0 && !/^\s*\{/.test(head)) return { body: head, bodyStart: argStart + arrow + 2 };
  if (braceAt < 0) return null;
  const close = matchClose(arg, braceAt);
  if (close < 0) return null;
  return { body: arg.slice(braceAt + 1, close), bodyStart: argStart + braceAt + 1 };
}

function effectFindings(code, blank, line, hookRanges) {
  const out = [];
  const stateSetters = new Set([...code.matchAll(/\[\s*[\w$]+\s*,\s*(set[A-Z][\w$]*)\s*\]\s*=\s*useState\b/g)].map((m) => m[1]));
  for (const m of code.matchAll(/\buse(?:Layout)?Effect\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    if (close < 0) continue;
    const inner = code.slice(open + 1, close);
    const args = splitTop(inner);
    if (!args.length) continue;
    const argStart = open + 1 + inner.indexOf(args[0]);
    const eb = effectBody(code, argStart, args[0]);
    if (!eb) continue;
    const stmts = statements(eb.body);
    const cleanup = stmts.map((s) => eb.body.slice(s.start, s.end)).find((t) => /^return\s*(?:\(\s*\)\s*=>|function\b|async\b|[A-Za-z_$][\w$.]*\s*;?\s*$)/.test(t.trim()));
    const at = line(m.index);
    // uncancelled-effect-fetch
    const quiet = blank.slice(eb.bodyStart, eb.bodyStart + eb.body.length); // strings blanked: a "fetch(" in a message is text
    if (hasFetchCall(quiet) && !SAFE_WORDS.test(quiet)) {
      const flagged = cleanup && /\b\w+\s*=\s*(?:true|false)\b|\bcancel\w*|\bunsubscribe\b|\.abort\b/i.test(cleanup);
      if (!flagged) {
        const hook = hookRanges.filter((h) => h.start < m.index && h.end > m.index).pop();
        const why = cleanup ? "its cleanup neither aborts nor sets an ignore flag" : "no AbortController or signal, no ignore flag and no cleanup";
        out.push({ index: m.index, kind: "uncancelled-effect-fetch", detail: `${hook ? `in hook ${hook.name}: ` : ""}fetch inside the effect with ${why}: a slow older response can overwrite a newer one` });
      }
      continue;
    }
    // derived-state-effect
    const deps = args[1];
    if (!deps || !/^\[[\s\S]*\]$/.test(deps.trim()) || /^\[\s*\]$/.test(deps.trim()) || cleanup || !stmts.length) continue;
    const texts = stmts.map((s) => eb.body.slice(s.start, s.end).trim().replace(/;$/, ""));
    const depNames = splitTop(deps.trim().slice(1, -1)).map((d) => /^[A-Za-z_$][\w$]*/.exec(d.trim())?.[0]).filter(Boolean);
    const only = texts.every((t) => {
      const sm = /^(set[A-Z][\w$]*)\s*\(([\s\S]*)\)$/.exec(t);
      if (!sm || !stateSetters.has(sm[1]) || /\bawait\b|\.then\b|\basync\b|\bfetch\b|\bPromise\b|\bsetTimeout\b|\bsetInterval\b|\bDate\b|Math\.random/.test(sm[2])) return false;
      return depNames.some((d) => new RegExp(`(?<![\\w$.])${d.replace(/\$/g, "\\$")}\\b`).test(sm[2]));
    });
    if (only) out.push({ index: m.index, kind: "derived-state-effect", detail: `the effect only calls ${texts.map((t) => t.split("(")[0]).join(", ")} from ${depNames.join(", ")}: a copy that lags one render; compute it while rendering, with useMemo or with a key` });
  }
  return out;
}

/** Functions named use* (custom hooks): [{ name, start, end }] for the check that names the hook of an effect. */
function hookRanges(code) {
  const out = [];
  for (const m of code.matchAll(/(?:\bfunction\s+|\b(?:const|let|var)\s+)(use[A-Z][\w$]*)\b[^={;]*?(?:=[^{;]*?)?\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open, false, 100000);
    if (close > 0) out.push({ name: m[1], start: open, end: close });
  }
  return out;
}

function awaitFindings(code, line) {
  const out = [];
  const awaitAt = [...code.matchAll(/\bawait\b/g)].map((m) => m.index);
  if (!awaitAt.length) return out;
  const seen = new Set();
  for (let open = code.indexOf("{"); open >= 0; open = code.indexOf("{", open + 1)) {
    if (!awaitAt.some((a) => a > open && a < open + 20000)) continue;
    const close = matchClose(code, open);
    if (close < 0) continue;
    const body = code.slice(open + 1, close);
    if (!/\bawait\b/.test(body)) continue;
    let prior = []; // await-fetch statements of the current run: { names, callee, line }
    const taint = new Set();
    const uses = (text) => [...taint].some((n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(text));
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
      const mutates = call && (MUTATING.test(call.last) || /method\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)/i.test(am[3]) || /^(?:post|put|patch|delete)$/.test(call.last));
      if (call && fetchLike(call) && !mutates) {
        if (prior.length && !uses(am[3])) {
          const key = `${s.start + open}`;
          if (!seen.has(key)) {
            seen.add(key);
            const p = prior[prior.length - 1];
            out.push({ index: open + 1 + s.start, kind: "sequential-awaits", detail: `await ${call.name}(...) does not use the result of the await ${p.callee}(...) on line ${p.line}: start both, then await them together (Promise.all)` });
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
      const code = maskComments(src);
      const blank = maskComments(src, false, true);
      const line = lineIndex(src);
      const found = [...effectFindings(code, blank, line, hookRanges(code)), ...awaitFindings(code, line)];
      const seen = new Set();
      for (const f of found) {
        const n = line(f.index);
        const key = `${n}:${f.kind}`;
        if (seen.has(key) || (changed && !isAdded(changed, file, n))) continue;
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
