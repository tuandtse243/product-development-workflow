#!/usr/bin/env node
// route-guard-inventory: the routes of a React Router or Next.js app router project and whether each has a guard (a
// wrapper element, a loader that redirects, a layout above it, a middleware match, a server-side redirect).
// A frontend Role tool for rule F11 (advisory). Node built-ins only.
const HELP = `
Usage: node route-guard-inventory.mjs [dir] [--routes /billing,/admin] [--base <ref>] [--text]

Lists the routes of [dir] (default: the working directory) with the guard each has:
  React Router 6/7  object routes (createBrowserRouter([...]), a RouteObject[] array, children, index, element,
                    Component, loader) and JSX <Route> trees; a route array named in children or spread is followed,
                    in the same file or another scanned one
  Next.js           app/**/page.* (also src/app); route groups (group) are not part of the path
A guard is one of (the value of "guard"):
  wrapper:<Name>        the route's element is wrapped by a guard component: a name such as RequireAuth, ProtectedRoute,
                        PrivateRoute, *Guard, *Gate, withAuth(...), or a component defined in a scanned file that
                        redirects (<Navigate>, redirect(), navigate()) on an auth, user, session or role check
  loader:<name|inline>  a loader that calls redirect() on such a check, or one named require*/auth*/guard*
  middleware            a Next middleware.ts whose matcher covers the route and that redirects or checks auth
  server-check          a Next page or layout above it that calls redirect() or notFound() after an auth call
A route under a layout route or a wrapper element that has a guard gets it with the prefix "layout:". "guard" is null
when there is none. "guardKind" is "client" for a React Router guard (it only hides the screen; the API must check
too) and "server" for a Next middleware or server check. A nav link hidden by localStorage or a flag is not a guard.

Options:
  --routes <list>  comma-separated paths that must be guarded (/billing,/admin/users); a ":id" or "*" segment of a
                   route matches any value. Each one without a guard is a finding "unguarded-route"; one that matches
                   no route is "route-not-found". Without --routes, routes whose path has a segment such as admin,
                   billing, account, settings, dashboard, profile, checkout, orders, payment, invoice, internal, manage
                   or private are checked the same way
  --base <ref>     only routes on lines added since <ref> (working tree against the ref, plus untracked files);
                   the paths of --routes are always checked
  --text           short text instead of JSON
  --help           this text

Output (JSON): { tool, schemaVersion: 1, root, base, framework, routes: [{ path, file, line, guard, guardKind, element }],
findings: [{ file, line, kind: "unguarded-route" | "route-not-found", path, detail }], skipped }
"framework" is "react-router", "next", "both" or null. "element" is the page component (the wrapper's child), the
Component name, or null. A route with children is not listed itself (its children are) unless it has no child with
its path; the check by --routes matches layout paths too. "skipped" lists what was not read: public/ and static/
output, *.min.* and *.bundle.*, files over 512 KB, unreadable files, files with a template literal that never closes.

Limits: a guard that has an unusual name and is not defined in a scanned file is not seen (the route is then reported
unguarded); a guard by a hook inside the page component is not seen for React Router; a route array built by code
(map, spread of a call) is not read; Next pages/ router, route handlers, server actions and Nuxt, SvelteKit, Vue Router
are not read; the API reads a route makes are not listed.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { changedSince, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, matchClose, objectKeys, projectRoot, runCli, splitTop, table, UsageError } from "../../../library/scripts/_common.mjs";
import { attrText, jsxElements, objectEntries } from "./_markup.mjs";

const GUARD_NAME = /^(?:Require|Protected|Private|Guard|WithAuth|WithRole|WithPermission|Authenticated|Authorized|LoggedIn|AdminOnly|AuthRequired|AuthGuard|AuthGate|AuthRoute|RoleGuard)|(?:Guard|Gate|ProtectedRoute|PrivateRoute|RequireAuth)$/;
const GUARD_FN = /^(?:require|ensure|assert|protect|guard)\w*|(?:Guard|Auth|Authed|Authenticated|Protected)$|^auth(?:Loader|Guard|Check)?$|^(?:check|verify)(?:Auth|User|Session|Role|Login|Permission)/;
const AUTHISH = /auth|login|log-in|sign-?in|session|user|token|role|permission|admin|cookie|credential|jwt|forbidden|unauthori[sz]ed/i;
const SENSITIVE = /^(?:admin|billing|account|settings|dashboard|profile|checkout|orders?|payments?|invoices?|internal|manage|private|me)$/i;
const NEUTRAL = new Set(["Outlet", "Suspense", "Fragment", "ErrorBoundary", "React.Suspense", "React.Fragment", "Navigate"]);

/** Components and functions defined in the scanned files: { guards: names that redirect on an auth-looking check, bodies: name -> body text }. */
function guardDefinitions(sources) {
  const guards = new Set();
  const bodies = new Map();
  const record = (name, code, at, close) => {
    const body = code.slice(at, close + 1);
    bodies.set(name, body);
    if (/<Navigate\b|\bredirect\b|\bnavigate\s*\(|\brouter\s*\.\s*(?:push|replace)\s*\(/.test(body) && AUTHISH.test(body)) guards.add(name);
  };
  for (const { src } of sources) {
    const code = maskComments(src);
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const pEnd = matchClose(code, open);
      const at = pEnd < 0 ? -1 : code.indexOf("{", pEnd);
      if (at < 0 || at - pEnd > 200) continue;
      const close = matchClose(code, at, false, 60000);
      if (close > 0) record(m[1], code, at, close);
    }
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:function\b[^(]*\([^)]*\)\s*(?::[^={]+)?|\([^)]*\)\s*(?::[^={=]+)?=>|[A-Za-z_$][\w$]*\s*=>)\s*/g)) {
      const at = m.index + m[0].length;
      if (code[at] !== "{" && code[at] !== "(" && !/function/.test(m[0])) continue;
      const bodyAt = /function/.test(m[0]) ? code.indexOf("{", at - 1) : at;
      if (bodyAt < 0) continue;
      const close = matchClose(code, bodyAt, false, 60000);
      if (close > 0) record(m[1], code, bodyAt, close);
    }
  }
  return { guards, bodies };
}

const isGuardName = (name, defs) => GUARD_NAME.test(name.split(".").pop()) || defs.guards.has(name);

/** The guard of a JSX value (element={...}): { guard: "wrapper:X" | null, element: page component name | null }. */
function elementInfo(text, defs) {
  const t = text.trim();
  const hoc = /^(with[A-Z]\w*|require[A-Z]\w*|protect\w*)\s*\(\s*([A-Za-z_$][\w$]*)/.exec(t);
  if (hoc && GUARD_NAME.test(hoc[1].replace(/^with/, "With"))) return { guard: `wrapper:${hoc[1]}`, element: hoc[2] };
  if (!t.startsWith("<")) return { guard: null, element: /^[A-Za-z_$][\w$]*$/.test(t) ? t : null };
  const els = jsxElements(t);
  let guard = null;
  for (const e of els) if (isGuardName(e.name, defs)) { guard = `wrapper:${e.name}`; break; }
  const page = els.find((e) => !isGuardName(e.name, defs) && !NEUTRAL.has(e.name)) ?? els[0];
  return { guard, element: page ? page.name : null };
}

/** The guard of a loader value (identifier, call or inline function): "loader:<name>" or null. */
function loaderGuard(value, defs) {
  const v = value.trim();
  const id = /^([A-Za-z_$][\w$.]*)$/.exec(v);
  if (id) {
    const name = id[1].split(".").pop();
    const body = defs.bodies.get(name);
    if (body !== undefined) return /\bredirect\s*\(/.test(body) && AUTHISH.test(body) ? `loader:${name}` : GUARD_FN.test(name) ? `loader:${name}` : null;
    return GUARD_FN.test(name) ? `loader:${name}` : null;
  }
  if (/\bredirect\s*\(/.test(v) && AUTHISH.test(v)) return "loader:inline";
  const call = /\b((?:require|ensure|assert|protect|guard)\w*|(?:check|verify)(?:Auth|User|Session|Role|Login|Permission)\w*)\s*\(/.exec(v);
  return call ? `loader:${call[1]}` : null;
}

const joinPath = (parent, child) => {
  const p = (child ?? "").replace(/^\/+|\/+$/g, "");
  if ((child ?? "").startsWith("/")) return "/" + p;
  const base = parent === "/" ? "" : parent.replace(/\/+$/, "");
  return base + "/" + p || "/";
};

// ---------------------------------------------------------------- React Router object routes

/** Arrays of route objects in comment-masked code: [{ open, close }], outermost only. */
function routeArrays(code) {
  const out = [];
  for (let i = code.indexOf("["); i >= 0; i = code.indexOf("[", i + 1)) {
    let p = i - 1;
    while (p >= 0 && /[ \t]/.test(code[p])) p--;
    if (p >= 0 && /[\w$\])]/.test(code[p]) && !/(?:return|default)$/.test(code.slice(Math.max(0, p - 6), p + 1))) continue; // an index or a type
    const close = matchClose(code, i, false, 200000);
    if (close < 0) continue;
    const items = splitTop(code.slice(i + 1, close));
    const objs = items.filter((x) => x.startsWith("{"));
    const isRoute = objs.some((x) => { const k = objectKeys(x.slice(1, -1)).keys; return k.includes("path") || (k.includes("index") && (k.includes("element") || k.includes("Component"))); });
    if (objs.length && isRoute && items.every((x) => x.startsWith("{") || x.startsWith("..."))) { out.push({ open: i, close }); i = close; }
  }
  return out;
}

/**
 * Walks a route array: a route with children is a layout (pushed to env.parents), any other one a route (env.routes).
 * ctx: { path, file, guard } where guard is the raw guard inherited from the layouts above.
 */
function walkArray(env, code, open, close, ctx) {
  const inner = code.slice(open + 1, close);
  let from = 0;
  for (const item of splitTop(inner)) {
    const at = inner.indexOf(item, from);
    from = at + item.length;
    if (item.startsWith("...")) {
      const ref = env.named.get(item.slice(3).trim());
      if (ref) walkArray(env, ref.code, ref.open, ref.close, { ...ctx, file: ref.file });
      continue;
    }
    const base = open + 1 + at + 1; // the first character inside the object's braces
    const entries = objectEntries(item.slice(1, -1), base);
    const get = (k) => entries.find((e) => e.key === k);
    const pathEntry = get("path");
    const own = pathEntry ? /^["'`]([^"'`]*)["'`]$/.exec(pathEntry.value.trim())?.[1] ?? null : null;
    const isIndex = get("index") && /^true$/.test(get("index").value.trim());
    const path = isIndex || own === null ? ctx.path : joinPath(ctx.path, own);
    const comp = get("Component")?.value.trim();
    const el = get("element") ? elementInfo(get("element").value, env.defs) : comp ? { guard: isGuardName(comp, env.defs) ? `wrapper:${comp}` : null, element: comp } : { guard: null, element: null };
    const mine = el.guard ?? (get("loader") ? loaderGuard(get("loader").value, env.defs) : null);
    const guard = mine ?? (ctx.guard ? `layout:${ctx.guard}` : null);
    const route = { path, file: ctx.file, line: lines(env, ctx.file, pathEntry?.valueIndex ?? base), guard, guardKind: guard ? "client" : null, element: el.element };
    const kids = get("children");
    let target = null;
    if (kids) {
      const v = kids.value.trim();
      const vAt = kids.valueIndex + (kids.value.length - kids.value.trimStart().length);
      if (v.startsWith("[")) target = { code, open: vAt, close: matchClose(code, vAt, false, 200000), file: ctx.file };
      else if (env.named.has(v)) target = env.named.get(v);
    }
    if (target && target.close > 0) {
      env.parents.push(route);
      walkArray(env, target.code, target.open, target.close, { path, file: target.file, guard: mine ?? ctx.guard });
    } else env.routes.push(route);
  }
}

const lines = (env, file, idx) => env.lineOf(file, idx);

// ---------------------------------------------------------------- JSX <Route>

function jsxRoutes(env, file, code, line) {
  const all = jsxElements(code);
  const routes = all.filter((e) => e.name === "Route" || e.name.endsWith(".Route"));
  if (!routes.length) return;
  const within = (inner, outer) => outer.closeStart !== null && inner.index > outer.openEnd && inner.index < outer.closeStart;
  const info = new Map();
  for (const r of routes) {
    const el = r.attrs.get("element");
    const comp = r.attrs.get("Component");
    const lo = r.attrs.get("loader");
    const e = el ? elementInfo(el.value, env.defs) : comp ? { guard: isGuardName(comp.value.trim(), env.defs) ? `wrapper:${comp.value.trim()}` : null, element: comp.value.trim() } : { guard: null, element: null };
    const lg = lo ? loaderGuard(lo.value, env.defs) : null;
    info.set(r, { own: e.guard ?? lg, element: e.element, path: attrText(r.attrs.get("path")), index: r.attrs.has("index") });
  }
  const parentOf = (r) => routes.filter((o) => o !== r && within(r, o)).pop() ?? null;
  const guardAbove = (r) => {
    // a guard element wrapping the <Routes> or this <Route>, outside the Route chain
    for (const e of all) if (!routes.includes(e) && isGuardName(e.name, env.defs) && within(r, e)) return `wrapper:${e.name}`;
    return null;
  };
  const resolve = (r) => {
    const p = parentOf(r);
    const up = p ? resolve(p) : { path: "/", raw: guardAbove(r) };
    const me = info.get(r);
    return { path: me.index || me.path === null ? up.path : joinPath(up.path, me.path), raw: me.own ?? up.raw };
  };
  for (const r of routes) {
    const me = info.get(r);
    const p = parentOf(r);
    const above = p ? resolve(p).raw : guardAbove(r);
    const guard = me.own ?? (above ? `layout:${above}` : null);
    const route = { path: resolve(r).path, file, line: line(r.index), guard, guardKind: guard ? "client" : null, element: me.element };
    (routes.some((o) => parentOf(o) === r) ? env.parents : env.routes).push(route);
  }
}

// ---------------------------------------------------------------- Next.js app router

const NEXT_PAGE = /^(?:src\/)?app\/((?:.*\/)?)page\.(?:tsx|jsx|ts|js|mjs)$/;
const NEXT_LAYOUT = /^(?:src\/)?app\/((?:.*\/)?)layout\.(?:tsx|jsx|ts|js|mjs)$/;
const SERVER_AUTH = /\b(?:auth|getServerSession|getSession|currentUser|getUser|requireUser|requireAuth|verifySession|getToken|cookies|headers)\s*\(/;

function nextPath(dir) {
  const segs = dir.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")).map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, "*").replace(/^\[\[\.\.\.(\w+)\]\]$/, "*").replace(/^\[(\w+)\]$/, ":$1"));
  return "/" + segs.join("/");
}

/** Does a Next middleware matcher entry (/admin/:path*, /((?!api).*)) cover a route path? */
function matcherCovers(pattern, path) {
  let re;
  try {
    const src = pattern.replace(/\/:\w+\*/g, "(?:/.*)?").replace(/:\w+\*/g, ".*").replace(/:\w+\+/g, ".+").replace(/:\w+/g, "[^/]+").replace(/\/\*/g, "(?:/.*)?");
    re = new RegExp(`^${src}$`);
  } catch { return false; }
  return re.test(path.replace(/:\w+/g, "x").replace(/\*/g, "x"));
}

function nextRoutes(env, sources) {
  const byFile = new Map(sources.map((s) => [s.file, s.src]));
  const mw = sources.find((s) => /^(?:src\/)?(?:middleware|proxy)\.(?:ts|js|mjs)$/.test(s.file));
  let mwCovers = null;
  if (mw) {
    const code = maskComments(mw.src);
    const guards = (/\bredirect\s*\(/.test(code) || /NextResponse\s*\.\s*(?:redirect|rewrite)/.test(code)) && AUTHISH.test(code);
    if (guards) {
      const mm = /\bmatcher\s*:\s*(\[[\s\S]*?\]|["'`][^"'`]+["'`])/.exec(code);
      const list = mm ? [...mm[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]) : null;
      mwCovers = (path) => (list ? list.some((p) => matcherCovers(p, path)) : true);
    }
  }
  for (const { file, src } of sources) {
    const pm = NEXT_PAGE.exec(file);
    if (!pm) continue;
    const path = nextPath(pm[1]);
    const code = maskComments(src);
    // layouts above (including the root one), outermost first, and the page itself
    const chain = [];
    const dirs = pm[1].split("/").filter(Boolean);
    const prefix = file.startsWith("src/") ? "src/app/" : "app/";
    for (let n = 0; n <= dirs.length; n++) {
      const d = dirs.slice(0, n).join("/");
      const lf = [...byFile.keys()].find((f) => f === `${prefix}${d ? d + "/" : ""}layout.tsx` || f === `${prefix}${d ? d + "/" : ""}layout.jsx` || f === `${prefix}${d ? d + "/" : ""}layout.ts` || f === `${prefix}${d ? d + "/" : ""}layout.js`);
      if (lf) chain.push(lf);
    }
    let guard = null, kind = null;
    if (mwCovers && mwCovers(path)) { guard = "middleware"; kind = "server"; }
    const serverCheck = (c) => /\b(?:redirect|notFound|permanentRedirect)\s*\(/.test(c) && SERVER_AUTH.test(c);
    const own = serverCheck(code) ? "server-check" : null;
    const wrapper = elementWrapper(code, env.defs);
    if (!guard && own) { guard = own; kind = "server"; }
    if (!guard && wrapper) { guard = `wrapper:${wrapper}`; kind = "client"; }
    if (!guard) for (const lf of chain) {
      const lc = maskComments(byFile.get(lf));
      if (serverCheck(lc)) { guard = "layout:server-check"; kind = "server"; break; }
      const w = elementWrapper(lc, env.defs);
      if (w) { guard = `layout:wrapper:${w}`; kind = "client"; break; }
    }
    const nm = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(code) ?? /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(code);
    env.routes.push({ path, file, line: env.lineOf(file, nm ? nm.index : 0), guard, guardKind: kind, element: nm ? nm[1] : null });
  }
}

/** Name of a guard component used in a file's JSX (<RequireAuth>), or null. */
function elementWrapper(code, defs) {
  for (const e of jsxElements(code)) if (isGuardName(e.name, defs)) return e.name;
  return null;
}

// ---------------------------------------------------------------- matching a requested path

function matchesPattern(pattern, requested) {
  const a = pattern.split("/").filter(Boolean);
  const b = requested.split("/").filter(Boolean);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "*") return true;
    if (i >= b.length) return a.slice(i).every((s) => s.endsWith("?"));
    if (a[i].startsWith(":") || a[i].endsWith("?")) continue;
    if (a[i] !== b[i]) return false;
  }
  return a.length === b.length;
}

const normalize = (p) => { const t = "/" + p.trim().replace(/^\/+|\/+$/g, ""); return t; };

await runCli({
  tool: "route-guard-inventory",
  help: HELP,
  options: { base: { type: "string" }, routes: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    const wanted = values.routes === undefined ? null : values.routes.split(",").map((s) => s.trim()).filter(Boolean).map(normalize);
    if (values.routes !== undefined && !wanted.length) throw new UsageError("--routes needs at least one path, for example --routes /billing,/admin. See --help.");
    const changed = values.base ? changedSince(root, values.base) : null;
    const { sources: all, skipped } = loadSources(root, JS_EXTS, { checkTemplates: true });
    const sources = all.filter((s) => !isTestFile(s.file));
    const defs = guardDefinitions(sources);
    const lines = new Map(sources.map((s) => [s.file, lineIndex(s.src)]));
    const env = { defs, routes: [], parents: [], named: new Map(), line: null, lineOf: (f, i) => lines.get(f)(i) };
    // route arrays declared by name (const adminRoutes = [...]) so children/spread references can be followed
    const perFile = [];
    for (const { file, src } of sources) {
      const code = maskComments(src);
      if (!/\bpath\s*:|\bindex\s*:\s*true|<Route\b/.test(code)) continue;
      perFile.push({ file, code, arrays: /\bpath\s*:|\bindex\s*:/.test(code) ? routeArrays(code) : [] });
    }
    const referenced = new Set();
    for (const f of perFile) {
      for (const a of f.arrays) {
        const m = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=;]*=\s*)$/.exec(f.code.slice(Math.max(0, a.open - 200), a.open));
        if (m) env.named.set(m[1], { code: f.code, open: a.open, close: a.close, file: f.file, line: lines.get(f.file)(a.open) });
      }
    }
    for (const f of perFile) for (const m of f.code.matchAll(/(?:\bchildren\s*:\s*|\.\.\.)([A-Za-z_$][\w$]*)\s*[,}\]]/g)) if (env.named.has(m[1])) referenced.add(env.named.get(m[1]).open + ":" + env.named.get(m[1]).file);
    for (const f of perFile) {
      env.line = lines.get(f.file);
      for (const a of f.arrays) {
        if (referenced.has(a.open + ":" + f.file)) continue;
        walkArray(env, f.code, a.open, a.close, { path: "/", file: f.file, guard: null });
      }
      jsxRoutes(env, f.file, f.code, lines.get(f.file));
    }
    // a walkArray route carries the file of the array it came from
    nextRoutes(env, sources);
    const hasRR = perFile.length > 0 && env.routes.some((r) => !NEXT_PAGE.test(r.file));
    const hasNext = env.routes.some((r) => NEXT_PAGE.test(r.file));
    // parents with a path of their own, for matching --routes against a layout path
    const rows = env.routes.map(({ own, layoutOnly, ...r }) => r);
    const parentPaths = env.parents.map(({ own, ...r }) => r);
    const uniq = new Map();
    for (const r of rows) uniq.set(`${r.file}:${r.line}:${r.path}`, r);
    let routes = [...uniq.values()].sort((a, b) => a.path.localeCompare(b.path) || a.file.localeCompare(b.file) || a.line - b.line);
    const findings = [];
    const known = [...routes, ...parentPaths];
    const isGuarded = (r) => r.guard !== null;
    for (const w of wanted ?? []) {
      const hit = known.filter((r) => matchesPattern(r.path, w));
      if (!hit.length) { findings.push({ file: null, line: null, kind: "route-not-found", path: w, detail: `no route matches ${w}` }); continue; }
      const open = hit.filter((r) => !isGuarded(r));
      const leafOpen = open.filter((r) => routes.includes(r));
      const pick = (leafOpen.length ? leafOpen : open.length && !hit.some(isGuarded) ? open : [])[0];
      if (pick) findings.push({ file: pick.file, line: pick.line, kind: "unguarded-route", path: w, detail: `${pick.path} has no guard (route in ${pick.file}:${pick.line})` });
    }
    if (!wanted) {
      for (const r of routes) {
        if (!r.path.split("/").some((s) => SENSITIVE.test(s)) || isGuarded(r)) continue;
        findings.push({ file: r.file, line: r.line, kind: "unguarded-route", path: r.path, detail: `${r.path} looks sensitive and has no guard` });
      }
    }
    if (changed) {
      routes = routes.filter((r) => isAdded(changed, r.file, r.line));
      if (!wanted) for (let i = findings.length - 1; i >= 0; i--) if (!isAdded(changed, findings[i].file, findings[i].line)) findings.splice(i, 1);
    }
    findings.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.path.localeCompare(b.path));
    return { root, base: values.base ?? null, framework: hasRR && hasNext ? "both" : hasNext ? "next" : hasRR ? "react-router" : null, routes, findings, skipped };
  },
  text(r) {
    const out = [`routes (${r.routes.length}):`];
    if (r.routes.length) out.push(table([["path", "guard", "element", "place"], ...r.routes.map((x) => [x.path, x.guard ?? "none", x.element ?? "", `${x.file}:${x.line}`])]).trimEnd());
    out.push(`findings (${r.findings.length}):`);
    if (r.findings.length) out.push(table([["place", "kind", "path", "detail"], ...r.findings.map((f) => [f.file ? `${f.file}:${f.line}` : "", f.kind, f.path, f.detail])]).trimEnd());
    if (r.skipped.length) out.push(`skipped: ${r.skipped.length}`);
    return out.join("\n") + "\n";
  },
});
