#!/usr/bin/env node
// route-inventory: the HTTP routes of a project, found by a static scan, with the tests that call each one.
// A backend Role tool (advisory): a worklist for rule B2, never a gate. Node built-ins only.
const HELP = `
Usage: node route-inventory.mjs [dir] [--base <ref>] [--text]

Lists the HTTP routes declared in [dir] (default: the working directory): method, path, file:line, handler name
(when it is a named function), framework, and the test files that call the path. For a route whose path takes a
record id (a parameter), "accessCases" says which of the three B2 cases the tests assert: a status assertion
(.expect(401), toBe(404), toHaveStatus(200), status_code == 403, HTTP_401_...) within 15 lines of a call of the
path: noIdentity (401), otherUser (403 or 404), owner (200, 201 or 204).

Recognised (Node frameworks first):
  Express, Koa-router, Hono, Fastify  app.get('/x', h)  router.post('/x', mw, h)  router.route('/x').get(h).put(h2)
                                      fastify.route({ method: 'GET', url: '/x', handler })  app.on('PUT', '/x', h)
  NestJS                              @Controller('users') + @Get(':id') on a method
  Next.js                             app/**/route.ts exporting GET, POST...; pages/api/** (method ANY)
  FastAPI, Flask (Python)             @router.get("/x") with APIRouter(prefix=...), @app.route("/x", methods=[...])
  Django                              path("x/<int:pk>/", view) in urls.py (method ANY)

Options:
  --base <ref>   only the routes in files changed since <ref> (working tree and untracked files); each route gets
                 "added": true when its declaration line is new
  --text         a table instead of JSON
  --help         this text

Output (JSON): { tool, schemaVersion: 1, root, base, routes: [{ method, path, file, line, handler, framework, params, tests,
  accessCases?, added? }], summary: { routes, withoutTests, byFramework }, skipped, limits }
"skipped" lists files and folders not read: public/ and static/ output, *.min.* and *.bundle.* files, files over
512 KB, unreadable files.

Limits: paths are as written in the file; a prefix added elsewhere (app.use('/api', router), Fastify register
prefix, Nest global prefix, Django include) is not applied, so a test is matched on the path's tail. Routes built
from variables or loops are missed; a client call shaped like a route (two arguments, first a '/path', on a receiver
not named like an HTTP client: axios, got, ky, http, client, api, apiClient, httpClient...) can be listed.
Test files are those named *.test.*, *.spec.*, test_*.py, *_test.py or under tests/, test/, __tests__/, e2e/.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { inStringOf, changedSince, isAdded, isPython, isTestFile, JS_EXTS, lineIndex, maskComments, matchClose, loadSources, projectRoot, PY_EXTS, runCli, splitTop, table } from "./_common.mjs";

const METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "all"];
const HTTP_CLIENTS = /^(axios|got|ky|http|https|client|api|apiClient|httpClient|http_client|request|superagent|agent|instance|fetcher|\$http|wretch|this)$/i;

/** A string literal's content, or null when `arg` is not one. */
const literal = (arg) => {
  const m = /^(["'`])([^"'`]*)\1$/.exec(arg?.trim() ?? "");
  return m && !(m[1] === "`" && m[2].includes("${")) ? m[2] : null;
};
const handlerName = (arg) => (arg && /^[A-Za-z_$][\w$.]*$/.test(arg.trim()) ? arg.trim() : null);
const joinPath = (...parts) => "/" + parts.flatMap((p) => (p ?? "").split("/")).filter(Boolean).join("/");

function jsRoutes(file, src) {
  const routes = [];
  const code = maskComments(src);
  const inString = inStringOf(code);
  const line = lineIndex(code);
  const add = (method, path, idx, handler, framework) => routes.push({ method: method.toUpperCase(), path, file, line: line(idx), handler, framework });
  const callArgs = (open) => {
    const close = matchClose(code, open);
    return close < 0 ? null : { args: splitTop(code.slice(open + 1, close)), close };
  };

  // app.get('/x', ..., handler) and friends.
  for (const m of code.matchAll(new RegExp(`\\.\\s*(${METHODS.join("|")})\\s*\\(`, "g"))) if (!inString(m.index)) {
    const call = callArgs(m.index + m[0].length - 1);
    if (!call || call.args.length < 2) continue;
    const path = literal(call.args[0]);
    if (path === null || !/^[/*]/.test(path)) continue;
    const receiver = /([A-Za-z_$][\w$]*)\s*$/.exec(code.slice(Math.max(0, m.index - 80), m.index))?.[1] ?? "";
    if (HTTP_CLIENTS.test(receiver)) continue; // an outbound client call, not a route
    add(m[1], path, m.index, handlerName(call.args[call.args.length - 1]), "express-style");
  }

  // router.route('/x').get(h).post(h2)  and  fastify.route({ method, url, handler }).
  for (const m of code.matchAll(/\.\s*route\s*\(/g)) if (!inString(m.index)) {
    const call = callArgs(m.index + m[0].length - 1);
    if (!call || call.args.length === 0) continue;
    const path = literal(call.args[0]);
    if (path !== null && path.startsWith("/")) {
      let pos = call.close + 1;
      for (;;) {
        const next = new RegExp(`^\\s*\\.\\s*(${METHODS.join("|")})\\s*\\(`).exec(code.slice(pos));
        if (!next) break;
        const chained = callArgs(pos + next[0].length - 1);
        if (!chained) break;
        add(next[1], path, m.index, handlerName(chained.args[chained.args.length - 1]), "express-style");
        pos = chained.close + 1;
      }
    } else if (call.args[0].startsWith("{")) {
      const obj = call.args[0];
      const url = /\b(?:url|path)\s*:\s*["'`]([^"'`]+)["'`]/.exec(obj)?.[1];
      const methods = /\bmethod\s*:\s*(\[[^\]]*\]|["'`][A-Za-z]+["'`])/.exec(obj)?.[1];
      if (!url || !methods) continue;
      const handler = /\bhandler\s*:\s*([A-Za-z_$][\w$.]*)/.exec(obj)?.[1] ?? null;
      for (const meth of methods.match(/[A-Za-z]+/g) ?? []) add(meth, url, m.index, handler, "fastify");
    }
  }

  // Hono: app.on('PUT', '/x', h)  or  app.on(['GET', 'POST'], '/x', h).
  for (const m of code.matchAll(/\.\s*on\s*\(/g)) if (!inString(m.index)) {
    const call = callArgs(m.index + m[0].length - 1);
    if (!call || call.args.length < 3) continue;
    const path = literal(call.args[1]);
    const methods = call.args[0].match(/["'`]([A-Z]+)["'`]/g)?.map((s) => s.slice(1, -1));
    if (path === null || !path.startsWith("/") || !methods || !methods.every((x) => METHODS.includes(x.toLowerCase()))) continue;
    for (const meth of methods) add(meth, path, m.index, handlerName(call.args[call.args.length - 1]), "hono");
  }

  // NestJS: @Controller(prefix) then @Get(sub) on each handler method.
  if (/@Controller\s*\(/.test(code)) {
    let prefix = "";
    for (const m of code.matchAll(/@(Controller|Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(/g)) if (!inString(m.index)) {
      const call = callArgs(m.index + m[0].length - 1);
      if (!call) continue;
      const arg = call.args[0];
      const value = arg === undefined ? "" : (literal(arg) ?? /\bpath\s*:\s*["'`]([^"'`]*)["'`]/.exec(arg)?.[1] ?? null);
      if (m[1] === "Controller") { prefix = value ?? ""; continue; }
      if (value === null) continue;
      add(m[1], joinPath(prefix, value), m.index, methodAfter(code, call.close + 1), "nestjs");
    }
  }

  // Next.js route handlers (app router) and API routes (pages router).
  const segs = file.split("/");
  const appAt = segs.indexOf("app");
  if (appAt >= 0 && /^route\.[cm]?[jt]sx?$/.test(segs[segs.length - 1])) {
    const dirs = segs.slice(appAt + 1, -1);
    if (dirs.some((d) => d.startsWith("_"))) return routes; // a private folder is not routed
    const path = joinPath(...dirs.filter((d) => !/^\(.*\)$/.test(d) && !d.startsWith("@")));
    const VERB = "(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)";
    for (const m of code.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+${VERB}\\b`, "g"))) if (!inString(m.index)) add(m[1], path, m.index, m[1], "nextjs");
    for (const m of code.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+${VERB}\\b`, "g"))) if (!inString(m.index)) add(m[1], path, m.index, m[1], "nextjs");
    for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) if (!inString(m.index)) {
      for (const part of m[1].split(",")) {
        const e = new RegExp(`^\\s*(?:([\\w$]+)\\s+as\\s+)?${VERB}\\s*$`).exec(part);
        if (e) add(e[2], path, m.index, e[1] ?? e[2], "nextjs");
      }
    }
  }
  const pagesAt = segs.indexOf("pages");
  if (pagesAt >= 0 && segs[pagesAt + 1] === "api") {
    const rest = segs.slice(pagesAt + 1).join("/").replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
    const def = /export\s+default\s+(?:async\s+)?function\s*([\w$]*)/.exec(code);
    add("ANY", joinPath(rest), def?.index ?? 0, def?.[1] || null, "nextjs-pages");
  }
  return routes;
}

/** The name of the method declared after a decorator ends at `pos` (skipping further decorators and modifiers). */
function methodAfter(code, pos) {
  let i = pos;
  for (;;) {
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] !== "@") break;
    i++;
    while (/[\w$.]/.test(code[i] ?? "")) i++;
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] === "(") { const close = matchClose(code, i); if (close < 0) return null; i = close + 1; }
  }
  const m = /^(?:(?:public|private|protected|async|static)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/.exec(code.slice(i, i + 200));
  return m ? m[1] : null;
}

function pyRoutes(file, src) {
  const routes = [];
  const code = maskComments(src, true);
  const inString = inStringOf(code, true);
  const line = lineIndex(code);
  const prefixes = new Map();
  for (const m of code.matchAll(/(\w+)\s*=\s*(?:APIRouter|Blueprint)\s*\(([^)]*)\)/g)) if (!inString(m.index)) {
    const p = /\b(?:url_)?prefix\s*=\s*["']([^"']*)["']/.exec(m[2]);
    prefixes.set(m[1], p ? p[1] : "");
  }
  for (const m of code.matchAll(/@(\w+)\.(get|post|put|patch|delete|options|head|route|api_route)\s*\(/g)) if (!inString(m.index)) {
    const close = matchClose(code, m.index + m[0].length - 1, true);
    if (close < 0) continue;
    const args = splitTop(code.slice(m.index + m[0].length, close), true);
    const path = literal(args[0]);
    if (path === null || !path.startsWith("/")) continue;
    const methodsArg = args.find((a) => /^methods\s*=/.test(a));
    const methods = m[2] === "route" || m[2] === "api_route" ? (methodsArg?.match(/["']([A-Za-z]+)["']/g)?.map((s) => s.slice(1, -1)) ?? ["GET"]) : [m[2]];
    const def = /^\s*(?:@[\s\S]*?\n\s*)*?(?:async\s+)?def\s+(\w+)/.exec(code.slice(close + 1));
    const framework = m[2] === "route" ? "flask" : "fastapi";
    for (const meth of methods) routes.push({ method: meth.toUpperCase(), path: joinPath(prefixes.get(m[1]) ?? "", path), file, line: line(m.index), handler: def?.[1] ?? null, framework });
  }
  if (file.split("/").pop() === "urls.py") {
    for (const m of code.matchAll(/\b(?:re_)?path\s*\(\s*r?["']([^"']*)["']\s*,\s*([^,)\s]+)/g)) if (!inString(m.index)) {
      if (m[2].startsWith("include")) continue;
      routes.push({ method: "ANY", path: joinPath(m[1]), file, line: line(m.index), handler: m[2].replace(/\.as_view$/, ""), framework: "django" });
    }
  }
  return routes;
}

const PARAM = /^(:\w+|\{[^}]+\}|\[[^\]]+\]|<[^>]+>|\*.*)$/;

/**
 * Where a test file calls this route: character indices of the matches (the path's tail, or the static part before
 * its first parameter followed by a quote), and for a Next.js route handler the import of its route file.
 */
function routeHits(route, content) {
  const segs = route.path.split("/").filter(Boolean);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const param = "(?:[^/'\"`\\s?#]+|\\$\\{[^}]*\\}|\\{[^}]*\\})";
  const full = segs.map((s) => (PARAM.test(s) ? param : esc(s))).join("/");
  const hits = [...content.matchAll(new RegExp(`/${full}/?(?=["'\`?#)\\s]|$)`, "gm"))].map((m) => m.index);
  const firstParam = segs.findIndex((s) => PARAM.test(s));
  if (firstParam > 0) hits.push(...[...content.matchAll(new RegExp(`/${segs.slice(0, firstParam).map(esc).join("/")}/["'\`]`, "g"))].map((m) => m.index));
  if (route.framework === "nextjs") {
    const segsOfFile = route.file.split("/");
    const tail = segsOfFile.slice(segsOfFile.indexOf("app") + 1).join("/").replace(/\.[cm]?[jt]sx?$/, "");
    if (content.includes(tail)) hits.push(-1); // the test imports the handler: the whole file is its test
  }
  // A hit inside a helper (`const post = (id) => http.post(`/x/${id}`)`, `function post(id) { … }`, or a block body
  // of a few lines under such a declaration): each call of that helper is a call of the route too.
  const DECL = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\()/;
  const lines = content.split("\n");
  const lineOf = lineIndex(content);
  const helperOf = (h) => {
    const start = content.lastIndexOf("\n", h) + 1;
    const m = DECL.exec(content.slice(start, h));
    if (m) return m[1] ?? m[2];
    // Inside a block body: walk up, within 10 lines, to the first line that is not indented. If that line declares a
    // helper and opens a block, the hit belongs to it.
    const n = lineOf(h) - 1;
    for (let i = n - 1; i >= Math.max(0, n - 10); i--) {
      const l = lines[i] ?? "";
      if (!l.trim() || /^\s/.test(l)) continue;
      const d = DECL.exec(l);
      return d && /\{\s*$/.test(l) ? d[1] ?? d[2] : null;
    }
    return null;
  };
  // Helpers can wrap helpers (`url(id)` used by `pay(…)`): follow them up to three levels.
  const seen = new Set();
  let frontier = hits.filter((h) => h >= 0);
  for (let level = 0; level < 3 && frontier.length; level++) {
    const found = new Set(frontier.map(helperOf).filter((n) => n && !seen.has(n)));
    frontier = [];
    for (const name of found) {
      seen.add(name);
      const esc2 = name.replace(/[$]/g, "\\$");
      for (const m of content.matchAll(new RegExp(`(?<![\\w$.])${esc2}\\(`, "g"))) {
        hits.push(m.index);
        frontier.push(m.index);
      }
    }
  }
  return hits;
}

const STATUS_ASSERTION = /(?:\bexpect\(\s*|\b(?:toBe|toEqual|toStrictEqual|toHaveStatus|toHaveHTTPStatus|toHaveStatusCode)\(\s*|\bstatus(?:_code|Code)?\s*(?:===?|:)\s*|\bHTTP_)(\d{3})(?!\d)/g;
const NEAR = 15;
// A test helper named expect…/assert… that takes the response and then a status: `expectProblem(res, 401, …)`,
// a call that builds one: `expectProblem(res, problem(401, …))`, or a constant that holds one: `expectProblem(res, UNAUTH)`.
const HELPER_ASSERTION = /\b(?:expect|assert)[A-Z_]\w*\(\s*[\w.$[\]]+\s*,\s*(?:[\w$.]+\(\s*(?:\{\s*status\s*:\s*)?)?(?:(\d{3})(?!\d)|([A-Za-z_$][\w$]*)\b(?!\s*\())/g;
// A constant whose value starts with a status: `const UNAUTH = problem(401, …)`, `= { status: 404, … }`, `= 403`.
const STATUS_CONST = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.]+\(\s*|\{\s*status\s*:\s*)?(\d{3})(?!\d)/g;

const isStatus = (n) => n >= 100 && n <= 599;

/** The status codes asserted within NEAR lines of any hit (the whole file for a hit of -1). */
function assertedNear(content, hits) {
  const line = lineIndex(content);
  const at = hits.map((h) => (h < 0 ? -1 : line(h)));
  const near = (index) => {
    const n = line(index);
    return at.some((h) => h < 0 || Math.abs(h - n) <= NEAR);
  };
  const codes = new Set();
  for (const m of content.matchAll(STATUS_ASSERTION)) if (near(m.index)) codes.add(Number(m[1]));
  const consts = new Map();
  for (const m of content.matchAll(STATUS_CONST)) if (isStatus(Number(m[2]))) consts.set(m[1], Number(m[2]));
  for (const m of content.matchAll(HELPER_ASSERTION)) {
    if (!near(m.index)) continue;
    const code = m[1] ? Number(m[1]) : consts.get(m[2]);
    if (code !== undefined && isStatus(code)) codes.add(code);
  }
  return codes;
}

await runCli({
  tool: "route-inventory",
  help: HELP,
  options: { base: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const changed = values.base ? changedSince(root, values.base) : null;
    const { sources, skipped } = loadSources(root, [...JS_EXTS, ...PY_EXTS]);
    const tests = sources.filter((s) => isTestFile(s.file)).map((s) => ({ file: s.file, content: s.src }));
    let routes = [];
    for (const { file, src } of sources) {
      if (isTestFile(file) || (changed && !changed.has(file))) continue;
      routes.push(...(isPython(file) ? pyRoutes(file, src) : jsRoutes(file, src)));
    }
    routes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.method.localeCompare(b.method));
    routes = routes.map((r) => {
      const params = r.path.split("/").some((s) => PARAM.test(s));
      const hits = tests.map((t) => ({ t, at: routeHits(r, t.content) })).filter((h) => h.at.length);
      const out = { ...r, params, tests: hits.map((h) => h.t.file) };
      if (params) {
        const codes = new Set(hits.flatMap((h) => [...assertedNear(h.t.content, h.at)]));
        out.accessCases = { noIdentity: codes.has(401), otherUser: codes.has(403) || codes.has(404), owner: codes.has(200) || codes.has(201) || codes.has(204) };
      }
      if (changed) out.added = isAdded(changed, r.file, r.line);
      return out;
    });
    const byFramework = {};
    for (const r of routes) byFramework[r.framework] = (byFramework[r.framework] ?? 0) + 1;
    return {
      root,
      base: values.base ?? null,
      routes,
      skipped,
      summary: { routes: routes.length, withoutTests: routes.filter((r) => r.tests.length === 0).length, byFramework },
      limits: ["static scan: prefixes added elsewhere are not applied; dynamic routes are missed", "accessCases reads status assertions within 15 lines of a call of the path, not per test block"],
    };
  },
  text(result) {
    const rows = [["METHOD", "PATH", "WHERE", "HANDLER", "TESTS", "ACCESS (401/403-404/2xx)"]];
    for (const r of result.routes) {
      const a = r.accessCases;
      rows.push([r.method, r.path, `${r.file}:${r.line}`, r.handler ?? "-", String(r.tests.length), a ? [a.noIdentity, a.otherUser, a.owner].map((x) => (x ? "y" : "n")).join("/") : "-"]);
    }
    return table(rows) + `${result.summary.routes} routes, ${result.summary.withoutTests} without a test\n`;
  },
});
