import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, gitBase, project, roleScript, runScript, write } from "./rolescripts.js";

// The frontend Role's two heuristic tools, tuned on the level 2 fixture: fetch-waterfalls (F7, F8) and route-guard-inventory (F11).
const FW = roleScript("frontend", "fetch-waterfalls.mjs");
const RG = roleScript("frontend", "route-guard-inventory.mjs");
const FIXTURE = join(__dirname, "..", "evals", "fixtures", "frontend-web");
const REFS = join(__dirname, "..", "evals", "level2-reference");
afterAll(cleanTemps);

const kinds = (r: any) => r.json.findings.map((f: any) => `${f.kind}@${f.line}`);

describe("fetch-waterfalls", () => {
  it("flags a fetch in an effect with no abort, ignore flag or cleanup, and names the custom hook", () => {
    const root = project({
      "src/useFetch.ts": [
        'import { useEffect, useState } from "react";',
        "export function useFetch(url: string) {",
        "  const [data, setData] = useState(null);",
        "  useEffect(() => {",
        "    fetch(url).then((r) => r.json()).then(setData);",
        "  }, [url]);",
        "  return data;",
        "}",
        "",
      ].join("\n"),
    });
    const r = runScript(FW, [root]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ tool: "fetch-waterfalls", schemaVersion: 1, skipped: [] });
    expect(r.json.findings).toHaveLength(1);
    expect(r.json.findings[0]).toMatchObject({ file: "src/useFetch.ts", line: 4, kind: "uncancelled-effect-fetch" });
    expect(r.json.findings[0].detail).toMatch(/hook useFetch/);
  });

  it("accepts an AbortController, a signal, an ignore flag set in the cleanup, and ignores strings and comments", () => {
    const root = project({
      "src/a.tsx": [
        "export function A({ id }) {",
        "  useEffect(() => { const ac = new AbortController(); fetch('/x', { signal: ac.signal }); return () => ac.abort(); }, [id]);",
        "  useEffect(() => { let ignore = false; (async () => { const r = await getUser(id); if (!ignore) setX(r); })(); return () => { ignore = true; }; }, [id]);",
        "  useEffect(() => { document.title = 'fetch(' + id; }, [id]);",
        "  useEffect(() => { const k = localStorage.getItem('a'); map.get(k); }, []);",
        "  // useEffect(() => { fetch('/x'); }, []);",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    });
    expect(runScript(FW, [root]).json.findings).toEqual([]);
  });

  it("flags a cleanup that does not cancel, and an effect that awaits a data call with no way to stop", () => {
    const root = project({
      "src/a.tsx": [
        "export function A({ id }) {",
        "  useEffect(() => {",
        "    async function go() { const r = await getUser(id); setX(r); }",
        "    go();",
        "  }, [id]);",
        "  useEffect(() => {",
        "    fetch('/x').then(setX);",
        "    window.addEventListener('resize', f);",
        "    return () => window.removeEventListener('resize', f);",
        "  }, []);",
        "}",
        "",
      ].join("\n"),
    });
    expect(kinds(runScript(FW, [root]))).toEqual(["uncancelled-effect-fetch@2", "uncancelled-effect-fetch@6"]);
  });

  it("flags an effect that only copies props into state, not one that fetches, resets or has no dependencies", () => {
    const root = project({
      "src/a.tsx": [
        "export function A({ first, last, id }) {",
        "  const [full, setFull] = useState('');",
        "  const [page, setPage] = useState(0);",
        "  useEffect(() => { setFull(first + ' ' + last); }, [first, last]);",
        "  useEffect(() => { setPage(0); }, [id]);",
        "  useEffect(() => { setFull('x'); }, []);",
        "  useEffect(() => { setFull(first); console.log(first); }, [first]);",
        "  useEffect(() => { setFull(first); return () => {}; }, [first]);",
        "}",
        "",
      ].join("\n"),
    });
    expect(kinds(runScript(FW, [root]))).toEqual(["derived-state-effect@4"]);
  });

  it("flags independent awaits in a row, not dependent ones, writes, or Promise.all", () => {
    const root = project({
      "src/loader.ts": [
        "export async function loader({ params }) {",
        "  const user = await getUser(params.id);",
        "  const posts = await listPosts();",
        "  const mine = await listPosts(user.id);",
        "  const res = await fetch(`/api/${mine.id}`);",
        "  const json = await res.json();",
        "  return { user, posts, json };",
        "}",
        "export async function save(id) {",
        "  const a = await getUser(id);",
        "  await updateUser(id);",
        "  await createLog(id);",
        "  const [x, y] = await Promise.all([getA(), getB()]);",
        "  await fetch('/w', { method: 'POST' });",
        "}",
        "",
      ].join("\n"),
    });
    const r = runScript(FW, [root]);
    expect(kinds(r)).toEqual(["sequential-awaits@3"]);
    expect(r.json.findings[0].detail).toMatch(/Promise\.all/);
  });

  it("with --base lists only findings on added lines; --text prints a table", () => {
    const root = project({ "src/old.tsx": "useEffect(() => { fetch('/a'); }, []);\n" });
    gitBase(root);
    write(root, { "src/new.tsx": "useEffect(() => { fetch('/b'); }, []);\n" });
    const r = runScript(FW, [root, "--base", "HEAD"]);
    expect(r.json.findings.map((f: any) => f.file)).toEqual(["src/new.tsx"]);
    expect(runScript(FW, [root, "--text"]).stdout).toMatch(/^findings \(2\):/);
  });

  it("skips test files and a file whose template literal never closes", () => {
    const root = project({
      "tests/a.test.tsx": "useEffect(() => { fetch('/a'); }, []);\n",
      "src/broken.ts": "const s = `never closed;\nuseEffect(() => { fetch('/a'); }, []);\n",
    });
    const r = runScript(FW, [root]);
    expect(r.json.findings).toEqual([]);
    expect(r.json.skipped).toEqual([{ file: "src/broken.ts", reason: "unclosed template literal: not read" }]);
  });
});

describe("route-guard-inventory", () => {
  const ROUTER = [
    'import { createBrowserRouter, redirect, Navigate, Outlet } from "react-router";',
    'import { adminRoutes } from "./admin";',
    "function RequireUser({ children }) { const u = useUser(); return u ? children : <Navigate to=\"/login\" />; }",
    "const Gatekeeper = ({ children }) => { const { session } = useSession(); if (!session) return <Navigate to=\"/login\" />; return children; };",
    'async function billingLoader() { if (!isLoggedIn()) throw redirect("/login"); return null; }',
    "export const router = createBrowserRouter([",
    '  { path: "/", element: <Layout />, children: [',
    "    { index: true, element: <Home /> },",
    '    { path: "billing", element: <Billing /> },',
    '    { path: "settings", element: <RequireAuth><Settings /></RequireAuth> },',
    '    { path: "invoices", loader: billingLoader, element: <Invoices /> },',
    "    { element: <Gatekeeper><Outlet /></Gatekeeper>, children: [ { path: \"account\", element: <Account /> } ] },",
    '    { path: "admin", children: adminRoutes },',
    '    { path: "profile", loader: async () => { if (!getUser()) throw redirect("/login"); return null; }, Component: Profile },',
    "  ]},",
    "]);",
    "",
  ].join("\n");
  const ADMIN = [
    "export const adminRoutes = [",
    '  { path: "users", element: <RequireAdmin><Users /></RequireAdmin> },',
    '  { path: "audit", element: <Audit /> },',
    "];",
    "",
  ].join("\n");

  it("lists React Router object routes with wrapper, loader and layout guards, following a children array in another file", () => {
    const root = project({ "src/router.tsx": ROUTER, "src/admin.tsx": ADMIN });
    const r = runScript(RG, [root]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ tool: "route-guard-inventory", schemaVersion: 1, framework: "react-router", skipped: [] });
    const by = Object.fromEntries(r.json.routes.map((x: any) => [x.path, x]));
    expect(by["/"]).toMatchObject({ guard: null, element: "Home", file: "src/router.tsx", line: 8 });
    expect(by["/billing"]).toMatchObject({ guard: null, guardKind: null, element: "Billing" });
    expect(by["/settings"]).toMatchObject({ guard: "wrapper:RequireAuth", guardKind: "client", element: "Settings" });
    expect(by["/invoices"].guard).toBe("loader:billingLoader");
    expect(by["/profile"]).toMatchObject({ guard: "loader:inline", element: "Profile" });
    expect(by["/account"]).toMatchObject({ guard: "layout:wrapper:Gatekeeper", element: "Account" });
    expect(by["/admin/users"]).toMatchObject({ guard: "wrapper:RequireAdmin", file: "src/admin.tsx" });
    expect(by["/admin/audit"].guard).toBeNull();
    expect(r.json.findings.map((f: any) => [f.kind, f.path])).toEqual([
      ["unguarded-route", "/admin/audit"],
      ["unguarded-route", "/billing"],
    ]);
  });

  it("reads JSX <Route> trees: a guard layout route and a guard wrapped around <Routes>", () => {
    const root = project({
      "src/App.tsx": [
        "export const App = () => (",
        "  <Routes>",
        '    <Route path="/" element={<Layout />}>',
        '      <Route path="checkout" element={<Checkout />} />',
        '      <Route element={<RequireUser><Outlet /></RequireUser>}>',
        '        <Route path="orders" element={<Orders />} />',
        "      </Route>",
        "    </Route>",
        "  </Routes>",
        ");",
        "export const B = () => (",
        "  <ProtectedRoute><Routes><Route path='/private' element={<P />} /></Routes></ProtectedRoute>",
        ");",
        "",
      ].join("\n"),
    });
    const by = Object.fromEntries(runScript(RG, [root]).json.routes.map((x: any) => [x.path, x]));
    expect(by["/checkout"].guard).toBeNull();
    expect(by["/orders"].guard).toBe("layout:wrapper:RequireUser");
    expect(by["/private"].guard).toBe("layout:wrapper:ProtectedRoute");
  });

  it("checks the paths of --routes: unguarded, not found, and a param segment matching a value", () => {
    const root = project({ "src/router.tsx": ROUTER, "src/admin.tsx": ADMIN });
    const r = runScript(RG, [root, "--routes", "/billing,/settings,/nope,/admin/users"]);
    expect(r.json.findings.map((f: any) => [f.kind, f.path])).toEqual([
      ["route-not-found", "/nope"],
      ["unguarded-route", "/billing"],
    ]);
    expect(r.json.findings[1]).toMatchObject({ file: "src/router.tsx", line: 9 });
    const p = project({ "src/r.tsx": 'export const r = [{ path: "/doctors/:id", element: <D /> }];\n' });
    expect(runScript(RG, [p, "--routes", "/doctors/42"]).json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
    expect(runScript(RG, [p, "--routes", ""]).code).toBe(2);
  });

  it("does not take a hidden nav link for a guard", () => {
    const root = project({
      "src/r.tsx": 'export const r = [{ path: "/billing", element: <Billing /> }];\n',
      "src/Nav.tsx": 'export const Nav = () => (localStorage.getItem("admin") ? <a href="/billing">Billing</a> : null);\n',
    });
    expect(runScript(RG, [root, "--routes", "/billing"]).json.findings).toHaveLength(1);
  });

  it("reads Next.js app router pages: middleware matcher, a server redirect in the page or a layout, a route group", () => {
    const root = project({
      "src/middleware.ts": 'export function middleware(req) { if (!req.cookies.get("session")) return NextResponse.redirect(new URL("/login", req.url)); }\nexport const config = { matcher: ["/billing/:path*"] };\n',
      "src/app/(shop)/billing/page.tsx": "export default function BillingPage() { return <p />; }\n",
      "src/app/(shop)/billing/plan/page.tsx": "export default function Plan() { return <p />; }\n",
      "src/app/admin/layout.tsx": 'export default async function L({ children }) { const s = await getServerSession(); if (!s) redirect("/login"); return children; }\n',
      "src/app/admin/users/page.tsx": "export default function Users() { return <p />; }\n",
      "src/app/settings/page.tsx": "export default function Settings() { return <p />; }\n",
      "src/app/about/page.tsx": "export default function About() { return <p />; }\n",
    });
    const r = runScript(RG, [root]);
    expect(r.json.framework).toBe("next");
    const by = Object.fromEntries(r.json.routes.map((x: any) => [x.path, x]));
    expect(by["/billing"]).toMatchObject({ guard: "middleware", guardKind: "server", file: "src/app/(shop)/billing/page.tsx" });
    expect(by["/billing/plan"].guard).toBe("middleware");
    expect(by["/admin/users"]).toMatchObject({ guard: "layout:server-check", guardKind: "server" });
    expect(by["/settings"].guard).toBeNull();
    expect(r.json.findings.map((f: any) => f.path)).toEqual(["/settings"]);
  });

  it("with --base lists only routes on added lines; --text prints the inventory", () => {
    const root = project({ "src/old.tsx": 'export const r = [{ path: "/admin", element: <A /> }];\n' });
    gitBase(root);
    write(root, { "src/new.tsx": 'export const q = [{ path: "/billing", element: <B /> }];\n' });
    const r = runScript(RG, [root, "--base", "HEAD"]);
    expect(r.json.routes.map((x: any) => x.path)).toEqual(["/billing"]);
    expect(r.json.findings.map((f: any) => f.path)).toEqual(["/billing"]);
    expect(runScript(RG, [root, "--text"]).stdout).toMatch(/^routes \(2\):/);
  });
});

describe("on the level 2 fixture and its references", () => {
  it.skipIf(!existsSync(FIXTURE))("find nothing wrong in the fixture's correct code, quickly", () => {
    const t = Date.now();
    const fw = runScript(FW, [FIXTURE]);
    const rg = runScript(RG, [FIXTURE]);
    expect(Date.now() - t).toBeLessThan(10000);
    expect(fw.json.findings).toEqual([]);
    expect(rg.json.findings).toEqual([]);
    expect(rg.json.framework).toBe("react-router");
    expect(rg.json.routes.map((x: any) => [x.path, x.element, x.guard])).toEqual([
      ["/", "DoctorsPage", null],
      ["/doctors/:doctorId", "DoctorPage", null],
    ]);
  });

  it.skipIf(!existsSync(REFS))("report nothing on the book-a-slot references, correct and wrong, and list the new route", () => {
    for (const d of readdirSync(REFS).filter((n) => n.startsWith("book-a-slot-screen"))) {
      expect(runScript(FW, [join(REFS, d)]).json.findings, d).toEqual([]);
      expect(runScript(RG, [join(REFS, d)]).json.findings, d).toEqual([]);
    }
    const ref = runScript(RG, [join(REFS, "book-a-slot-screen")]).json.routes.map((x: any) => x.path);
    expect(ref).toContain("/doctors/:doctorId/days/:date");
  });

  it.skipIf(!existsSync(FIXTURE))("a level 2 check can assert a path is guarded: the fixture has no /billing", () => {
    const r = runScript(RG, [FIXTURE, "--routes", "/billing"]);
    expect(r.code).toBe(0);
    expect(r.json.findings).toMatchObject([{ kind: "route-not-found", path: "/billing" }]);
  });
});

// ---------------------------------------------------------------- review fixes: one test per repro
const L = (...lines: string[]) => lines.join("\n") + "\n";
const fwRun = (files: Record<string, string>, args: string[] = []) => runScript(FW, [project(files), ...args]);
const rgRun = (files: Record<string, string>, args: string[] = []) => runScript(RG, [project(files), ...args]);
const guardsOf = (r: any) => Object.fromEntries(r.json.routes.map((x: any) => [x.path, x.guard]));

describe("fetch-waterfalls: review fixes", () => {
  it("H1: --base reports an effect when a line inside it was added, not only the useEffect( line", () => {
    const root = project({
      "src/a.tsx": L("export function A({ id }) {", "  useEffect(() => {", "    fetch('/a');", "  }, [id]);", "}"),
    });
    gitBase(root);
    write(root, { "src/a.tsx": L("export function A({ id }) {", "  useEffect(() => {", "    fetch('/b');", "  }, [id]);", "}") });
    const r = runScript(FW, [root, "--base", "HEAD"]);
    expect(r.json.findings.map((f: any) => f.line)).toEqual([2]);
    write(root, { "src/a.tsx": L("// a comment", "export function A({ id }) {", "  useEffect(() => {", "    fetch('/b');", "  }, [id]);", "}") });
    gitBase(root); // the same code is now the base: nothing added
    expect(runScript(FW, [root, "--base", "HEAD"]).json.findings).toEqual([]);
  });

  it("M1: accepts a request-id ref, a latest-url ref, a typed cleanup and a named cleanup; a mounted ref alone stays flagged", () => {
    const ok = fwRun({
      "src/a.tsx": L(
        "export function A({ id, url }) {",
        "  const req = useRef(0);",
        "  useEffect(() => { const mine = ++req.current; getUser(id).then((u) => { if (mine === req.current) setU(u); }); }, [id]);",
        "  const last = useRef(url);",
        "  useEffect(() => { last.current = url; fetch(url).then((r) => r.json()).then((d) => { if (last.current === url) setD(d); }); }, [url]);",
        "  useEffect(() => { let stale = false; getUser(id).then((u) => { if (!stale) setU(u); }); return (): void => { stale = true; }; }, [id]);",
        "  useEffect(() => {",
        "    let stale = false;",
        "    getUser(id).then((u) => { if (!stale) setU(u); });",
        "    const cleanup = () => { stale = true; };",
        "    return cleanup;",
        "  }, [id]);",
        "}",
      ),
    });
    expect(ok.json.findings).toEqual([]);
    const bad = fwRun({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const mounted = useRef(true);",
        "  useEffect(() => { getUser(id).then((u) => { if (mounted.current) setU(u); }); return () => { mounted.current = false; }; }, [id]);",
        "}",
      ),
    });
    expect(kinds(bad)).toEqual(["uncancelled-effect-fetch@3"]);
  });

  it("M2: generic calls, a client.users.list chain, fetcher and request are seen; a signal that is not passed does not count", () => {
    const r = fwRun({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useEffect(() => { getJson<User>('/u/' + id).then(setU); }, [id]);",
        "  useEffect(() => { fetcher('/x').then(setX); }, []);",
        "  useEffect(() => { const ac = new AbortController(); fetch('/y').then(setY); }, []);",
        "  useEffect(() => { const ac = new AbortController(); fetch('/z', { signal: ac.signal }).then(setZ); }, []);",
        "  useEffect(() => { const ac = new AbortController(); fetch('/w').then(setW); return () => ac.abort(); }, []);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@2", "uncancelled-effect-fetch@3", "uncancelled-effect-fetch@4"]);
  });

  it("M2e: a fetch inside a useCallback that the effect calls counts as in the effect", () => {
    const r = fwRun({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const load = useCallback(async () => { const r = await fetch('/a/' + id); setA(await r.json()); }, [id]);",
        "  useEffect(() => { load(); }, [load]);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@3"]);
    const ok = fwRun({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const load = useCallback(async (signal) => { const r = await fetch('/a/' + id, { signal }); setA(await r.json()); }, [id]);",
        "  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);",
        "}",
      ),
    });
    expect(ok.json.findings).toEqual([]);
  });

  it("M3: if (data) setPeople(data) is a derived copy; an accumulating updater is not", () => {
    const r = fwRun({
      "src/a.tsx": L(
        "export function A({ data, n }) {",
        "  const [people, setPeople] = useState([]);",
        "  const [recent, setRecent] = useState([]);",
        "  const [total, setTotal] = useState(0);",
        "  useEffect(() => { if (data) setPeople(data); }, [data]);",
        "  useEffect(() => { setRecent((r) => [...r, n].slice(-5)); }, [n]);",
        "  useEffect(() => { setTotal((t) => t + n); }, [n]);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["derived-state-effect@5"]);
  });

  it("BUG 2 (shared helper): a backtick inside a regex literal is not an open template; the shared helper keeps strings as before", () => {
    const r = fwRun({ "src/a.tsx": L("const re = /`/;", "useEffect(() => { fetch('/x'); }, []);") });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@2"]);
    expect(r.json.skipped).toEqual([]);
    // a real unclosed template is still reported
    expect(fwRun({ "src/b.ts": "const s = `open\n" }).json.skipped).toHaveLength(1);
    // a quote in a regex does not open a string that hides the next lines
    expect(kinds(fwRun({ "src/c.tsx": L("const q = /\"/.test(x);", "useEffect(() => { fetch('/x'); }, []);") }))).toEqual(["uncancelled-effect-fetch@2"]);
  });

  it("L1: thousands of awaits in one block are not quadratic", () => {
    const body = Array.from({ length: 6000 }, (_, i) => `  const v${i} = await getThing${i}(${i ? `v${i - 1}` : "x"});`).join("\n");
    const t = Date.now();
    const r = fwRun({ "src/big.ts": `export async function big() {\n${body}\n}\n` });
    expect(r.code).toBe(0);
    expect(r.json.findings).toEqual([]);
    expect(Date.now() - t).toBeLessThan(10000);
  });

  it("L1: a 400 KB file of many arrays and blocks is read in linear time", () => {
    const one = "export const r1 = [{ path: '/a', element: <A /> }, { path: '/b', element: <B /> }];\nexport async function f() { const a = await getA(); const b = await getB(a); }\n";
    const files = { "src/many.tsx": one.repeat(Math.floor((400 * 1024) / one.length)) };
    const t = Date.now();
    expect(runScript(FW, [project(files)]).code).toBe(0);
    expect(runScript(RG, [project(files)]).code).toBe(0);
    expect(Date.now() - t).toBeLessThan(10000);
  });
});

describe("route-guard-inventory: review fixes", () => {
  it("H2: an array of { path, label } for a menu is not a route array; a router config is", () => {
    const r = rgRun({
      "src/nav.tsx": L("export const NAV_LINKS = [{ path: '/billing', label: 'Billing' }, { path: '/admin', label: 'Admin' }];"),
      "src/r.tsx": L("export const router = createBrowserRouter([{ path: '/x', element: <X /> }]);", "export const t: RouteObject[] = [{ path: '/y' , element: <Y /> }];"),
    });
    expect(r.json.routes.map((x: any) => x.path)).toEqual(["/x", "/y"]);
    expect(r.json.findings).toEqual([]);
  });

  it("H3: the most specific route wins: a literal beats :param beats a catch-all", () => {
    const files = {
      "src/r.tsx": L(
        "export const router = createBrowserRouter([",
        "  { path: '/billing', element: <RequireAuth><Billing /></RequireAuth> },",
        "  { path: '/users/:id', element: <RequireAuth><U /></RequireAuth> },",
        "  { path: '*', element: <NotFound /> },",
        "]);",
      ),
    };
    expect(rgRun(files, ["--routes", "/billing,/users/7"]).json.findings).toEqual([]);
    const r = rgRun(files, ["--routes", "/nothing/here"]);
    expect(r.json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
  });

  it("H4: a layout with a role-based nav and Sign out is not a guard; plain navigation is not a guard", () => {
    const r = rgRun({
      "src/r.tsx": L(
        "function Shell() {",
        "  const { role } = useSession();",
        "  const navigate = useNavigate();",
        "  const out = async () => { await signOut(); navigate('/login'); };",
        "  return <nav>{role === 'admin' && <Link to='/admin'>Admin</Link>}<button onClick={out}>Sign out</button><Outlet /></nav>;",
        "}",
        "function Back() { const go = useNavigate(); return <button onClick={() => go(-1)}>Back</button>; }",
        "export const router = createBrowserRouter([{ element: <Shell />, children: [{ path: '/billing', element: <Billing /> }, { path: '/settings', element: <Back /> }] }]);",
      ),
    });
    expect(guardsOf(r)).toMatchObject({ "/billing": null, "/settings": null });
  });

  it("H4: a redirect on localStorage is not a guard, even in a component named RequireOwner", () => {
    const r = rgRun({
      "src/Req.tsx": L(
        "export function RequireOwner({ children }) {",
        "  const role = localStorage.getItem('role');",
        "  return role === 'owner' ? children : <Navigate to='/' />;",
        "}",
      ),
      "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', element: <RequireOwner><Billing /></RequireOwner> }]);\n",
    });
    expect(guardsOf(r)["/billing"]).toBeNull();
    expect(r.json.findings.map((f: any) => f.path)).toEqual(["/billing"]);
  });

  it("H4: a redirect under a session condition is a guard, through any name bound to useNavigate()", () => {
    const r = rgRun({
      "src/Own.tsx": L(
        "export const OwnerOnly = ({ children }) => {",
        "  const session = useSession();",
        "  const go = useNavigate();",
        "  useEffect(() => { if (session === null) go('/login'); }, [session, go]);",
        "  return session ? children : null;",
        "};",
      ),
      "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', element: <OwnerOnly><Billing /></OwnerOnly> }]);\n",
    });
    expect(guardsOf(r)["/billing"]).toBe("wrapper:OwnerOnly");
  });

  it("M4a: a loader that delegates to a helper that throws the redirect is a guard (one level)", () => {
    const r = rgRun({
      "src/requireSession.ts": L(
        "export async function requireSession(request) {",
        "  try { return await getJson('/api/session'); }",
        "  catch (e) { if (e instanceof ApiError && e.status === 401) throw redirect('/login'); throw e; }",
        "}",
      ),
      "src/billing.ts": "export async function billingLoader({ request }) { await requireSession(request); return null; }\n",
      "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', loader: billingLoader, element: <Billing /> }]);\n",
    });
    expect(guardsOf(r)["/billing"]).toBe("loader:billingLoader");
  });

  it("M4b: a page that calls a guard hook is guarded", () => {
    const r = rgRun({
      "src/useRequireOwner.ts": L("export function useRequireOwner() {", "  const s = useSession(); const navigate = useNavigate();", "  useEffect(() => { if (!s || s.user.role !== 'owner') navigate('/login'); }, [s]);", "}"),
      "src/Billing.tsx": "export function Billing() { useRequireOwner(); return <p>b</p>; }\n",
      "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', element: <Billing /> }]);\n",
    });
    expect(guardsOf(r)["/billing"]).toBe("component:Billing");
  });

  it("M4d: a lazy route is followed to a scanned module; an unscanned one is lazy-unresolved, not unguarded", () => {
    const r = rgRun({
      "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', lazy: () => import('./Billing') }, { path: '/settings', lazy: () => import('lib/Settings') }]);\n",
      "src/Billing.tsx": "export async function loader() { if (!getUser()) throw redirect('/login'); return null; }\nexport function Component() { return null; }\n",
    });
    expect(guardsOf(r)["/billing"]).toBe("loader:loader");
    expect(r.json.findings.map((f: any) => [f.kind, f.path])).toEqual([["lazy-unresolved", "/settings"]]);
  });

  it("BUG 4/5/6/7 and the nits: a Navigate route is a redirect, --routes ignores case and repeats, intercepting pages are left out, no intrinsic element", () => {
    const r = rgRun({
      "src/r.tsx": L("export const router = createBrowserRouter([", "  { path: '/admin', element: <Navigate to='/login' /> },", "  { path: '/billing', element: <div><Billing /></div> },", "  { path: '/plain', element: <div /> },", "]);"),
      "app/feed/(.)photo/[id]/page.tsx": "export default function P() { return null; }\n",
    });
    expect(r.json.findings.map((f: any) => f.path)).toEqual(["/billing"]);
    const by = Object.fromEntries(r.json.routes.map((x: any) => [x.path, x.element]));
    expect(by["/billing"]).toBe("Billing");
    expect(by["/plain"]).toBeNull();
    expect(r.json.routes.map((x: any) => x.path)).not.toContainEqual(expect.stringContaining("photo"));
    const c = rgRun({ "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', element: <B /> }]);\n" }, ["--routes", "/Billing,/billing,/BILLING"]);
    expect(c.json.findings).toHaveLength(1);
  });

  it("L2: a function or route array whose brackets do not match is listed under skipped", () => {
    const r = rgRun({ "src/r.tsx": "function Broken() { return (<div>;\nexport const r = [{ path: '/billing', element: <B /> }];\n" });
    expect(r.code).toBe(0);
    expect(r.json.skipped.length).toBeGreaterThan(0);
  });
});
