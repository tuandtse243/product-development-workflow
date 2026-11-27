#!/usr/bin/env node
// route-guard-inventory: the routes of a React Router or Next.js app router project and whether each has a guard (a
// wrapper element, a loader that redirects, a layout above it, a middleware match, a server-side redirect).
// A frontend Role tool for rule F11 (advisory). Node built-ins only.
const HELP = `
Usage: node route-guard-inventory.mjs [dir] [--routes /billing,/admin] [--base <ref>] [--text]

Lists the routes of [dir] (default: the working directory) with the guard each has:
  React Router 6/7  object routes (an array passed to createBrowserRouter / createMemoryRouter / createHashRouter /
                    useRoutes, typed RouteObject[], or whose objects have element, Component, loader, lazy or children;
                    an array of { path, label } for a menu is not a route array), JSX <Route> trees; a route array named
                    in children or spread is followed, in the same file or another scanned one; lazy: () => import(...)
                    is followed when the module is a scanned file
  Next.js           app/**/page.* (also src/app); route groups (group), parallel slots @x and intercepting segments
                    (.)x are not part of the path (an intercepting page is not a route of its own and is left out)
A guard is one of (the value of "guard"):
  wrapper:<Name>        the route's element is wrapped by a guard component: a name such as RequireAuth, ProtectedRoute,
                        PrivateRoute, *Guard, *Gate, withAuth(...), or a component defined in a scanned file that
                        redirects (<Navigate>, redirect(), navigate() or a name bound to useNavigate()) under a
                        condition that reads a session, user, role or token value, directly or through a hook
  component:<Name>      the page component itself does that (or calls a hook that does, such as useRequireOwner())
  loader:<name|inline>  a loader that redirects under such a condition, or calls a function that does (followed one
                        level, e.g. requireSession(request)), or one named require*/auth*/guard*
  middleware            a Next middleware.ts whose matcher covers the route and that redirects or checks auth
  server-check          a Next page or layout above it that calls redirect() or notFound() after an auth call
A route under a layout route or a wrapper element that has a guard gets it with the prefix "layout:". "guard" is null
when there is none. "guardKind" is "client" for a React Router guard (it only hides the screen; the API must check
too) and "server" for a Next middleware or server check. A value read from localStorage or sessionStorage is not
evidence: a redirect on it is not a guard (even in a component named RequireOwner that is defined in a scanned file),
and neither is a nav link hidden by one. Plain navigation (Sign out, Back) is not a guard.

Options:
  --routes <list>  comma-separated paths that must be guarded (/billing,/admin/users), matched case-insensitively as React
                   Router does; a ":id" or "*" segment of a route matches any value, and the most specific route wins (a
                   literal beats :param beats *, so a catch-all never stands in for a real route). Each path listed
                   without a guard is a finding "unguarded-route"; one that matches no route is "route-not-found"; one
                   whose route is a lazy import the script could not follow is "lazy-unresolved". Without --routes,
                   routes whose path has a segment such as admin, billing, account, settings, dashboard, profile,
                   checkout, orders, payment, invoice, internal, manage or private are checked the same way
  --base <ref>     only routes on lines added since <ref> (working tree against the ref, plus untracked files);
                   the paths of --routes are always checked
  --text           short text instead of JSON
  --help           this text

Output (JSON): { tool, schemaVersion: 1, root, base, framework, routes: [{ path, file, line, guard, guardKind, element }],
findings: [{ file, line, kind: "unguarded-route" | "route-not-found" | "lazy-unresolved", path, detail }], skipped }
"framework" is "react-router", "next", "both" or null. "element" is the page component (the wrapper's child), the
Component name, or null (an intrinsic tag such as div is not a name). A route whose element is <Navigate /> is a
redirect and is never "unguarded-route". A route with children is not listed itself (its children are) unless it has no
child with its path; the check by --routes matches layout paths too. "skipped" lists what was not read: public/ and
static/ output, *.min.* and *.bundle.*, files over 512 KB, unreadable files, files with a template literal that never
closes, functions and route arrays whose brackets do not match.

Limits: a guard that has an unusual name and is not defined in a scanned file is not seen (the route is then reported
unguarded); a lazy route whose module is not a scanned file is listed with no guard and reported as "lazy-unresolved"
instead of "unguarded-route"; a route array built by code (map, spread of a call) is not read; Next pages/ router, route
handlers, server actions and Nuxt, SvelteKit, Vue Router are not read; the API reads a route makes are not listed (the
research report's "reads" field is not implemented, and "guard" is a string with a separate "guardKind" instead of its
"server" | "client" | "none"). The guard rules were checked on the frontend-web fixture and on synthetic trees; real
projects may have shapes they do not cover. Where a rule is ambiguous the script reports less, not more.

Exit: 0 when the scan ran (whatever it found), 2 on a usage or read error.
`;

import { changedSince, isAdded, isTestFile, JS_EXTS, lineIndex, loadSources, maskComments, objectKeys, projectRoot, runCli, splitTop, table, UsageError } from "../../../library/scripts/_common.mjs";
import { attrText, bracketPairs, jsxElements, objectEntries } from "./_markup.mjs";

const GUARD_NAME = /^(?:Require|Protected|Private|Guard|WithAuth|WithRole|WithPermission|Authenticated|Authorized|LoggedIn|AdminOnly|AuthRequired|AuthGuard|AuthGate|AuthRoute|RoleGuard)|(?:Guard|Gate|ProtectedRoute|PrivateRoute|RequireAuth)$/;
const GUARD_HOOK = /^use(?:Require|Protect|Guard|AuthGuard|AuthRequired)/;
const GUARD_FN = /^(?:require|ensure|assert|protect|guard)\w*|(?:Guard|Auth|Authed|Authenticated|Protected)$|^auth(?:Loader|Guard|Check)?$|^(?:check|verify)(?:Auth|User|Session|Role|Login|Permission)/;
const AUTHISH = /auth|login|log-in|logged|sign-?in|session|user|token|role|permission|admin|owner|cookie|credential|jwt|forbidden|unauthori[sz]ed|\b40[13]\b/i;
const TARGET_AUTHISH = /login|log-in|sign-?in|auth|unauthori[sz]ed|forbidden|403|401/i;
const STORAGE = /\b(?:localStorage|sessionStorage|useLocalStorage|useSessionStorage)\b/;
const SENSITIVE = /^(?:admin|billing|account|settings|dashboard|profile|checkout|orders?|payments?|invoices?|internal|manage|private|me)$/i;
const NEUTRAL = new Set(["Outlet", "Suspense", "Fragment", "ErrorBoundary", "React.Suspense", "React.Fragment", "Navigate"]);
const ROUTER_CALL = /(?:createBrowserRouter|createMemoryRouter|createHashRouter|createStaticRouter|useRoutes)\s*\(\s*$|RouteObject\s*\[\s*\]\s*(?:=\s*)?$/;
const ROUTE_KEYS = ["element", "Component", "loader", "lazy", "children"];
const word = (n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}(?![\\w$])`);

// ---------------------------------------------------------------- what is a guard

/** Functions and components declared in the scanned files: { bodies: name -> { body, file }, byFile: file -> Map(name -> body) }. */
function definitions(prep, skipped) {
  const bodies = new Map();
  const byFile = new Map();
  for (const { file, code, bp } of prep) {
    const mine = new Map();
    byFile.set(file, mine);
    const record = (name, at, end) => { const body = code.slice(at, end + 1); mine.set(name, body); if (!bodies.has(name)) bodies.set(name, { body, file }); };
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g)) {
      const pe = bp.get(m.index + m[0].length - 1);
      const b = pe === undefined ? null : /^\s*(?::[^{=]*)?\{/.exec(code.slice(pe + 1, pe + 300));
      if (!b) { if (pe === undefined) skipped.push({ file, reason: `function ${m[1]} not read: its brackets do not match` }); continue; }
      const at = pe + b[0].length;
      const end = bp.get(at);
      if (end === undefined) skipped.push({ file, reason: `function ${m[1]} not read: its brackets do not match` });
      else record(m[1], at, end);
    }
    for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:function\b[^(]*\([^)]*\)\s*(?::[^={]+)?|\([^)]*\)\s*(?::[^={=]+)?=>|[A-Za-z_$][\w$]*\s*=>)\s*(?=\{)/g)) {
      const at = m.index + m[0].length;
      const end = bp.get(at);
      if (end === undefined) skipped.push({ file, reason: `function ${m[1]} not read: its brackets do not match` });
      else record(m[1], at, end);
    }
  }
  return { bodies, byFile, memo: new Map() };
}

/**
 * What a function body does about auth: { authCond, storageCond }. A redirect (<Navigate>, redirect(), navigate() or any name
 * bound to useNavigate(), router.push) counts when it sits under a condition (if, ?:, &&, ||) that reads a session, user,
 * role or token value; with storage values only, it is "storageCond" and is no guard. Plain navigation is neither.
 */
function analyze(body) {
  const nav = new Set(["navigate"]);
  for (const m of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useNavigate\s*\(/g)) nav.add(m[1]);
  const redirects = new RegExp(`<Navigate\\b|(?<![\\w$.])(?:redirect|${[...nav].join("|")})\\s*\\(|\\b(?:router|history)\\s*\\.\\s*(?:push|replace)\\s*\\(`, "g");
  const stored = new Set(), authed = new Set();
  for (const m of body.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([^;\n]*)/g)) {
    const names = [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);
    if (STORAGE.test(m[2])) names.forEach((n) => stored.add(n));
    else if (AUTHISH.test(m[2])) names.forEach((n) => authed.add(n));
  }
  const boundary = (i) => Math.max(body.lastIndexOf(";", i - 1), body.lastIndexOf("{", i - 1), body.lastIndexOf("}", i - 1));
  let authCond = false, storageCond = false;
  for (const m of body.matchAll(redirects)) {
    const b1 = boundary(m.index);
    let pre = body.slice(b1 + 1, m.index);
    if (!pre.trim() && body[b1] === "{") pre = body.slice(boundary(b1) + 1, b1); // if (!session) { navigate(...) }
    if (!/\bif\s*\(|\?|&&|\|\|/.test(pre.replace(/\?\./g, ""))) continue; // not under a condition: plain navigation
    const touchesStorage = STORAGE.test(pre) || [...stored].some((n) => word(n).test(pre));
    if (touchesStorage) { storageCond = true; continue; }
    const target = body.slice(m.index, m.index + 120);
    if (AUTHISH.test(pre) || [...authed].some((n) => word(n).test(pre)) || TARGET_AUTHISH.test(target)) authCond = true;
  }
  return { authCond, storageCond: storageCond && !authCond };
}

/** Is a component or hook a guard? A defined one by what it does (a redirect on a storage value is not one, whatever its name); an undefined one by its name. */
function isGuard(name, defs, hook = false, depth = 0) {
  const key = `${name}:${hook}`;
  if (defs.memo.has(key)) return defs.memo.get(key);
  defs.memo.set(key, false); // a cycle ends here
  const base = name.split(".").pop();
  const byName = hook ? GUARD_HOOK.test(base) : GUARD_NAME.test(base);
  const info = defs.bodies.get(base);
  let result = byName;
  if (info) {
    const a = analyze(info.body);
    if (a.authCond) result = true;
    else if (a.storageCond) result = false;
    else if (byName && !hook && !/\bchildren\b|\bOutlet\b/.test(info.body)) result = false; // named like a wrapper but wraps nothing: PrivateNotes
    else {
      result = byName;
      if (!result && depth < 1) for (const c of info.body.matchAll(/(?<![\w$.])(use[A-Z][\w$]*)\s*\(/g)) if (c[1] !== base && isGuard(c[1], defs, true, depth + 1)) { result = true; break; }
    }
  }
  defs.memo.set(key, result);
  return result;
}

/** A loader as a guard: "loader:<label>" when it redirects under an auth condition, or calls one level down a function that does. */
function loaderGuard(value, defs) {
  const v = value.trim();
  const id = /^([A-Za-z_$][\w$.]*)$/.exec(v);
  const label = id ? id[1].split(".").pop() : "inline";
  const info = id ? defs.bodies.get(label) : null;
  if (id && !info) return GUARD_FN.test(label) ? `loader:${label}` : null;
  return bodyGuard(label, info ? info.body : v, defs);
}

function bodyGuard(label, body, defs) {
  if (analyze(body).authCond) return `loader:${label}`;
  for (const c of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const n = c[1];
    if (n === label || /^(?:if|for|while|switch|catch|redirect|fetch|await)$/.test(n)) continue;
    const info = defs.bodies.get(n);
    if (info ? analyze(info.body).authCond : GUARD_FN.test(n)) return `loader:${label === "inline" ? n : label}`;
  }
  return null;
}

/** The guard, page and redirect-ness of a JSX value (element={...}). */
function elementInfo(text, defs) {
  const t = text.trim();
  const hoc = /^(with[A-Z]\w*|require[A-Z]\w*|protect\w*)\s*\(\s*([A-Za-z_$][\w$]*)/.exec(t);
  if (hoc && GUARD_NAME.test(hoc[1].replace(/^with/, "With"))) return { guard: `wrapper:${hoc[1]}`, element: hoc[2], redirect: false };
  if (!t.startsWith("<")) return { guard: null, element: /^[A-Z][\w$]*$/.test(t) ? t : null, redirect: false };
  const els = jsxElements(t).filter((e) => /^[A-Z]/.test(e.name));
  const wrapper = els.find((e) => !NEUTRAL.has(e.name) && isGuard(e.name, defs));
  const page = els.find((e) => !NEUTRAL.has(e.name) && e !== wrapper && !isGuard(e.name, defs));
  const redirect = !wrapper && !page && els.some((e) => e.name === "Navigate");
  let guard = wrapper ? `wrapper:${wrapper.name}` : null;
  if (!guard && page && isGuard(page.name, defs)) guard = `component:${page.name}`;
  if (wrapper && !page && wrapper.selfClosing) return { guard: `component:${wrapper.name}`, element: wrapper.name, redirect }; // <Billing /> that guards itself
  return { guard, element: page ? page.name : redirect ? "Navigate" : null, redirect };
}

/** A guard hook or redirect inside the page component itself: "component:<Name>" or null. */
function componentGuard(name, defs) {
  return name && /^[A-Z]/.test(name) && isGuard(name, defs) ? `component:${name}` : null;
}

// ---------------------------------------------------------------- lazy routes

const EXT = [".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

/** The scanned file a `lazy: () => import("./X")` points to, or null. */
function lazyTarget(env, fromFile, value) {
  const m = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(value);
  if (!m || !m[1].startsWith(".")) return null;
  const dir = fromFile.split("/").slice(0, -1);
  for (const seg of m[1].split("/")) { if (seg === "..") dir.pop(); else if (seg !== ".") dir.push(seg); }
  const base = dir.join("/");
  const hit = [base, ...EXT.map((x) => base + x)].find((f) => env.files.has(f));
  return hit ?? null;
}

/** What a lazy module gives its route: { guard, element } from its exported loader and Component / default export. */
function lazyInfo(env, file) {
  const mine = env.defs.byFile.get(file);
  const code = env.codes.get(file);
  const loader = mine?.get("loader");
  let guard = loader !== undefined ? bodyGuard("loader", loader, env.defs) : null;
  const dm = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(code) ?? /export\s+(?:const|function)\s+(Component)\b/.exec(code) ?? /export\s+default\s+([A-Z][\w$]*)\s*;?\s*$/m.exec(code);
  const element = dm ? dm[1] : null;
  if (!guard && element) guard = componentGuard(element, env.defs);
  return { guard, element };
}

// ---------------------------------------------------------------- React Router object routes

const joinPath = (parent, child) => {
  const p = (child ?? "").replace(/^\/+|\/+$/g, "");
  if ((child ?? "").startsWith("/")) return "/" + p;
  const base = parent === "/" ? "" : parent.replace(/\/+$/, "");
  return base + "/" + p || "/";
};

/**
 * Arrays of route objects in comment-masked code: [{ open, close }], outermost only. One pass over the bracket map.
 * An array of objects with a `path` is routes only in a router config (an argument of createBrowserRouter, useRoutes,
 * ...), typed RouteObject[], or when an object has element, Component, loader, lazy or children: a menu is not.
 */
function routeArrays(file, code, bp, skipped) {
  const out = [];
  let upTo = -1;
  for (const open of [...bp.keys()].filter((k) => code[k] === "[").sort((a, b) => a - b)) {
    if (open < upTo) continue;
    const next = /\S/.exec(code.slice(open + 1, open + 40));
    if (!next || (next[0] !== "{" && next[0] !== ".")) continue;
    let p = open - 1;
    while (p >= 0 && /[ \t]/.test(code[p])) p--;
    if (p >= 0 && /[\w$\])]/.test(code[p]) && !/(?:^|[^\w$])(?:return|default)$/.test(code.slice(Math.max(0, p - 7), p + 1))) continue; // an index, x[0]
    const close = bp.get(open);
    const items = splitTop(code.slice(open + 1, close));
    const objs = items.filter((x) => x.startsWith("{"));
    const keysOf = (x) => objectKeys(x.slice(1, -1)).keys;
    const isRoute = objs.some((x) => { const k = keysOf(x); return k.includes("path") || (k.includes("index") && (k.includes("element") || k.includes("Component"))); });
    if (!objs.length || !isRoute || !items.every((x) => x.startsWith("{") || x.startsWith("..."))) continue;
    const routerConfig = ROUTER_CALL.test(code.slice(Math.max(0, open - 160), open));
    if (!routerConfig && !objs.some((x) => keysOf(x).some((k) => ROUTE_KEYS.includes(k)))) continue; // a menu: [{ path, label }]
    out.push({ open, close });
    upTo = close;
  }
  for (const m of code.matchAll(/\[\s*\{(?=[^\]]{0,300}\bpath\s*:)/g)) if (!bp.has(m.index)) { skipped.push({ file, reason: "a route array was not read: its brackets do not match" }); break; }
  return out;
}

/**
 * Walks a route array: a route with children is a layout (pushed to env.parents), any other one a route (env.routes).
 * ctx: { path, file, guard } where guard is the raw guard inherited from the layouts above.
 */
function walkArray(env, code, open, close, ctx, depth = 0) {
  if (depth > 400) return;
  const inner = code.slice(open + 1, close);
  let from = 0;
  for (const item of splitTop(inner)) {
    const at = inner.indexOf(item, from);
    from = at + item.length;
    if (item.startsWith("...")) {
      const ref = env.named.get(item.slice(3).trim());
      if (ref && !env.walking.has(ref.open + ref.file)) { env.walking.add(ref.open + ref.file); walkArray(env, ref.code, ref.open, ref.close, { ...ctx, file: ref.file }, depth + 1); env.walking.delete(ref.open + ref.file); }
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
    const el = get("element") ? elementInfo(get("element").value, env.defs) : comp ? { guard: componentGuard(comp, env.defs), element: /^[A-Z]/.test(comp) ? comp : null, redirect: false } : { guard: null, element: null, redirect: false };
    let mine = el.guard ?? (get("loader") ? loaderGuard(get("loader").value, env.defs) : null);
    let element = el.element;
    let lazy = null;
    const lz = get("lazy");
    if (lz && !get("element") && !comp) {
      const target = lazyTarget(env, ctx.file, lz.value);
      if (target) { const li = lazyInfo(env, target); mine = mine ?? li.guard; element = li.element ?? element; } else lazy = "unresolved";
    }
    const loaderRedirect = !get("element") && !comp && !lz && get("loader") && /^(?:async\s*)?\([^)]*\)\s*=>\s*redirect\s*\(/.test(get("loader").value.trim());
    const guard = mine ?? (ctx.guard ? `layout:${ctx.guard}` : null);
    const route = { path, file: ctx.file, line: env.lineOf(ctx.file, pathEntry?.valueIndex ?? base), guard, guardKind: guard ? "client" : null, element, redirect: el.redirect || !!loaderRedirect, lazy };
    const kids = get("children");
    let target = null;
    if (kids) {
      const v = kids.value.trim();
      const vAt = kids.valueIndex + (kids.value.length - kids.value.trimStart().length);
      if (v.startsWith("[")) target = { code, open: vAt, close: env.bpOf(ctx.file).get(vAt), file: ctx.file };
      else if (env.named.has(v)) target = env.named.get(v);
    }
    if (target && target.close > 0) {
      const key = target.open + target.file;
      env.parents.push(route);
      if (!env.walking.has(key)) {
        env.walking.add(key);
        walkArray(env, target.code, target.open, target.close, { path, file: target.file, guard: mine ?? ctx.guard }, depth + 1);
        env.walking.delete(key);
      }
    } else env.routes.push(route);
  }
}

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
    const lz = r.attrs.get("lazy");
    const e = el ? elementInfo(el.value, env.defs) : comp ? { guard: componentGuard(comp.value.trim(), env.defs), element: comp.value.trim(), redirect: false } : { guard: null, element: null, redirect: false };
    let own = e.guard ?? (lo ? loaderGuard(lo.value, env.defs) : null);
    let element = e.element, lazy = null;
    if (lz && !el && !comp) {
      const target = lazyTarget(env, file, lz.value);
      if (target) { const li = lazyInfo(env, target); own = own ?? li.guard; element = li.element ?? element; } else lazy = "unresolved";
    }
    info.set(r, { own, element, redirect: e.redirect, lazy, path: attrText(r.attrs.get("path")), index: r.attrs.has("index") });
  }
  const parentOf = (r) => routes.filter((o) => o !== r && within(r, o)).pop() ?? null;
  const guardAbove = (r) => {
    // a guard element wrapping the <Routes> or this <Route>, outside the Route chain
    for (const e of all) if (!routes.includes(e) && /^[A-Z]/.test(e.name) && isGuard(e.name, env.defs) && within(r, e)) return `wrapper:${e.name}`;
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
    const route = { path: resolve(r).path, file, line: line(r.index), guard, guardKind: guard ? "client" : null, element: me.element, redirect: me.redirect, lazy: me.lazy };
    (routes.some((o) => parentOf(o) === r) ? env.parents : env.routes).push(route);
  }
}

// ---------------------------------------------------------------- Next.js app router

const NEXT_PAGE = /^(?:src\/)?app\/((?:.*\/)?)page\.(?:tsx|jsx|ts|js|mjs)$/;
const SERVER_AUTH = /\b(?:auth|getServerSession|getSession|currentUser|getUser|requireUser|requireAuth|verifySession|getToken|cookies|headers)\s*\(/;

/** The URL path of an app directory, or null for an intercepting route ((.)x, (..)x, (...)x), which is not a page of its own. */
function nextPath(dir) {
  const segs = dir.split("/").filter(Boolean);
  if (segs.some((s) => /^\((?:\.{1,3})\)/.test(s))) return null;
  const kept = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")).map((s) => s.replace(/^\[\.\.\.(\w+)\]$/, "*").replace(/^\[\[\.\.\.(\w+)\]\]$/, "*").replace(/^\[(\w+)\]$/, ":$1"));
  return "/" + kept.join("/");
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
  const byFile = new Map(sources.map((s) => [s.file, s.code]));
  const mw = sources.find((s) => /^(?:src\/)?(?:middleware|proxy)\.(?:ts|js|mjs)$/.test(s.file));
  let mwCovers = null;
  if (mw) {
    const code = mw.code;
    if ((/\bredirect\s*\(/.test(code) || /NextResponse\s*\.\s*(?:redirect|rewrite)/.test(code)) && AUTHISH.test(code)) {
      const mm = /\bmatcher\s*:\s*(\[[\s\S]*?\]|["'`][^"'`]+["'`])/.exec(code);
      const list = mm ? [...mm[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]) : null;
      mwCovers = (path) => (list ? list.some((p) => matcherCovers(p, path)) : true);
    }
  }
  for (const { file, code } of sources) {
    const pm = NEXT_PAGE.exec(file);
    if (!pm) continue;
    const path = nextPath(pm[1]);
    if (path === null) continue;
    const chain = [];
    const dirs = pm[1].split("/").filter(Boolean);
    const prefix = file.startsWith("src/") ? "src/app/" : "app/";
    for (let n = 0; n <= dirs.length; n++) {
      const d = dirs.slice(0, n).join("/");
      const lf = ["tsx", "jsx", "ts", "js"].map((x) => `${prefix}${d ? d + "/" : ""}layout.${x}`).find((f) => byFile.has(f));
      if (lf) chain.push(lf);
    }
    let guard = null, kind = null;
    if (mwCovers && mwCovers(path)) { guard = "middleware"; kind = "server"; }
    const serverCheck = (c) => /\b(?:redirect|notFound|permanentRedirect)\s*\(/.test(c) && SERVER_AUTH.test(c);
    const wrapper = elementWrapper(code, env.defs);
    if (!guard && serverCheck(code)) { guard = "server-check"; kind = "server"; }
    if (!guard && wrapper) { guard = `wrapper:${wrapper}`; kind = "client"; }
    if (!guard) for (const lf of chain) {
      const lc = byFile.get(lf);
      if (serverCheck(lc)) { guard = "layout:server-check"; kind = "server"; break; }
      const w = elementWrapper(lc, env.defs);
      if (w) { guard = `layout:wrapper:${w}`; kind = "client"; break; }
    }
    const nm = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(code) ?? /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(code);
    env.routes.push({ path, file, line: env.lineOf(file, nm ? nm.index : 0), guard, guardKind: kind, element: nm && /^[A-Z]/.test(nm[1]) ? nm[1] : null, redirect: false, lazy: null });
  }
}

/** Name of a guard component used in a file's JSX (<RequireAuth>), or null. */
function elementWrapper(code, defs) {
  for (const e of jsxElements(code)) if (/^[A-Z]/.test(e.name) && !NEUTRAL.has(e.name) && isGuard(e.name, defs)) return e.name;
  return null;
}

// ---------------------------------------------------------------- matching a requested path

/** The specificity of a route pattern for a requested path (literal 2, :param 1, * 0 per segment), or null when it does not match. Case-insensitive. */
function matchScore(pattern, requested) {
  const a = pattern.toLowerCase().split("/").filter(Boolean);
  const b = requested.toLowerCase().split("/").filter(Boolean);
  const score = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "*") { score.push(0); return score; }
    if (i >= b.length) return a.slice(i).every((s) => s.endsWith("?")) ? score : null;
    if (a[i].startsWith(":") || a[i].endsWith("?")) { score.push(1); continue; }
    if (a[i] !== b[i]) return null;
    score.push(2);
  }
  return a.length === b.length ? score : null;
}

const compare = (x, y) => { for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; } return 0; };
const normalize = (p) => "/" + p.trim().replace(/^\/+|\/+$/g, "");

await runCli({
  tool: "route-guard-inventory",
  help: HELP,
  options: { base: { type: "string" }, routes: { type: "string" } },
  main(values, positionals) {
    const root = projectRoot(positionals);
    let wanted = null;
    if (values.routes !== undefined) {
      const seen = new Set();
      wanted = values.routes.split(",").map((s) => s.trim()).filter(Boolean).map(normalize).filter((w) => !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
      if (!wanted.length) throw new UsageError("--routes needs at least one path, for example --routes /billing,/admin. See --help.");
    }
    const changed = values.base ? changedSince(root, values.base) : null;
    const { sources: all, skipped } = loadSources(root, JS_EXTS, { checkTemplates: true });
    const prep = all.filter((s) => !isTestFile(s.file)).map(({ file, src }) => {
      const code = maskComments(src, false, false, true);
      return { file, src, code, bp: bracketPairs(code), line: lineIndex(src) };
    });
    const byFile = new Map(prep.map((p) => [p.file, p]));
    const defs = definitions(prep, skipped);
    const env = {
      defs, routes: [], parents: [], named: new Map(), walking: new Set(),
      files: new Set(prep.map((p) => p.file)), codes: new Map(prep.map((p) => [p.file, p.code])),
      lineOf: (f, i) => byFile.get(f).line(i), bpOf: (f) => byFile.get(f).bp,
    };
    // route arrays declared by name (const adminRoutes = [...]) so children/spread references can be followed
    const perFile = [];
    for (const p of prep) {
      if (!/\bpath\s*:|\bindex\s*:\s*true|<Route\b/.test(p.code)) continue;
      perFile.push({ ...p, arrays: /\bpath\s*:|\bindex\s*:/.test(p.code) ? routeArrays(p.file, p.code, p.bp, skipped) : [] });
    }
    const referenced = new Set();
    for (const f of perFile) {
      for (const a of f.arrays) {
        const m = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=;]*=\s*)$/.exec(f.code.slice(Math.max(0, a.open - 200), a.open));
        if (m) env.named.set(m[1], { code: f.code, open: a.open, close: a.close, file: f.file });
      }
    }
    for (const f of perFile) for (const m of f.code.matchAll(/(?:\bchildren\s*:\s*|\.\.\.)([A-Za-z_$][\w$]*)\s*[,}\]]/g)) if (env.named.has(m[1])) referenced.add(env.named.get(m[1]).open + ":" + env.named.get(m[1]).file);
    for (const f of perFile) {
      for (const a of f.arrays) {
        if (referenced.has(a.open + ":" + f.file)) continue;
        walkArray(env, f.code, a.open, a.close, { path: "/", file: f.file, guard: null });
      }
      jsxRoutes(env, f.file, f.code, f.line);
    }
    nextRoutes(env, prep);
    const hasNext = env.routes.some((r) => NEXT_PAGE.test(r.file));
    const hasRR = env.routes.some((r) => !NEXT_PAGE.test(r.file));
    const uniq = new Map();
    for (const r of env.routes) uniq.set(`${r.file}:${r.line}:${r.path}`, r);
    const full = [...uniq.values()].sort((a, b) => a.path.localeCompare(b.path) || a.file.localeCompare(b.file) || a.line - b.line);
    const known = [...full, ...env.parents];
    const findings = [];
    const flag = (r, path, detail) => findings.push({ file: r.file, line: r.line, kind: r.lazy === "unresolved" ? "lazy-unresolved" : "unguarded-route", path, detail: r.lazy === "unresolved" ? `${r.path} is a lazy import the script could not follow: its guard is not known (route in ${r.file}:${r.line})` : detail });
    for (const w of wanted ?? []) {
      const scored = known.map((r) => ({ r, s: matchScore(r.path, w) })).filter((x) => x.s !== null);
      if (!scored.length) { findings.push({ file: null, line: null, kind: "route-not-found", path: w, detail: `no route matches ${w}` }); continue; }
      const best = scored.reduce((a, x) => (compare(x.s, a) > 0 ? x.s : a), scored[0].s);
      const hit = scored.filter((x) => compare(x.s, best) === 0).map((x) => x.r).filter((r) => !r.redirect);
      if (!hit.length || hit.some((r) => r.guard !== null)) continue;
      const pick = hit.find((r) => full.includes(r)) ?? hit[0];
      flag(pick, w, `${pick.path} has no guard (route in ${pick.file}:${pick.line})`);
    }
    if (!wanted) {
      for (const r of full) {
        if (r.redirect || r.guard !== null || !r.path.split("/").some((s) => SENSITIVE.test(s))) continue;
        flag(r, r.path, `${r.path} looks sensitive and has no guard`);
      }
    }
    let routes = full.map(({ redirect, lazy, ...r }) => r);
    if (changed) {
      routes = routes.filter((r) => isAdded(changed, r.file, r.line));
      if (!wanted) for (let i = findings.length - 1; i >= 0; i--) if (!isAdded(changed, findings[i].file, findings[i].line)) findings.splice(i, 1);
    }
    findings.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.path.localeCompare(b.path));
    skipped.sort((a, b) => a.file.localeCompare(b.file));
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
