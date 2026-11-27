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
    expect(Date.now() - t).toBeLessThan(2000);
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
