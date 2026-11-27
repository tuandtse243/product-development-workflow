import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, gitBase, project, roleScript, runScript, write } from "./rolescripts.js";

// Adversarial edges of fetch-waterfalls and route-guard-inventory. A test named "BUG:" fails on purpose: it states the
// correct behaviour the script does not have yet.
const FW = roleScript("frontend", "fetch-waterfalls.mjs");
const RG = roleScript("frontend", "route-guard-inventory.mjs");
const FIXTURE = join(__dirname, "..", "evals", "fixtures", "frontend-web");
afterAll(cleanTemps);

const fw = (files: Record<string, string>, args: string[] = []) => runScript(FW, [project(files), ...args]);
const rg = (files: Record<string, string>, args: string[] = []) => runScript(RG, [project(files), ...args]);
const kinds = (r: any) => r.json.findings.map((f: any) => `${f.kind}@${f.line}`);
const guards = (r: any) => Object.fromEntries(r.json.routes.map((x: any) => [x.path, x.guard]));
const L = (...lines: string[]) => lines.join("\n") + "\n";

describe("fetch-waterfalls: no false positive on correct code", () => {
  it("does not read TanStack Query, SWR or RTK Query hooks", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const q = useQuery({ queryKey: ['u', id], queryFn: () => fetch('/u/' + id).then((r) => r.json()) });",
        "  const { data } = useSWR('/api/u/' + id, (u) => fetch(u).then((r) => r.json()));",
        "  const { data: d2 } = useGetUserQuery(id);",
        "  const m = useMutation({ mutationFn: (b) => fetch('/x', { method: 'POST', body: b }) });",
        "  return null;",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("accepts an AbortController kept in a useRef, or made by a helper, when abort appears in the effect", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const ref = useRef<AbortController | null>(null);",
        "  useEffect(() => {",
        "    ref.current?.abort();",
        "    ref.current = new AbortController();",
        "    fetch('/x', { signal: ref.current.signal }).then(setX);",
        "    return () => ref.current?.abort();",
        "  }, [id]);",
        "  useEffect(() => {",
        "    const { signal, cancel } = makeCancelable();",
        "    getUser(id, { signal }).then(setX);",
        "    return cancel;",
        "  }, [id]);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("accepts an ignore flag named cancelled / stale / active / isMounted", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useEffect(() => { let cancelled = false; getUser(id).then((u) => { if (!cancelled) setX(u); }); return () => { cancelled = true; }; }, [id]);",
        "  useEffect(() => { let stale = false; getUser(id).then((u) => { if (!stale) setX(u); }); return () => { stale = true; }; }, [id]);",
        "  useEffect(() => { let active = true; getUser(id).then((u) => { if (active) setX(u); }); return () => { active = false; }; }, [id]);",
        "  useEffect(() => { let isMounted = true; getUser(id).then((u) => { if (isMounted) setX(u); }); return () => { isMounted = false; }; }, [id]);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("does not flag useSyncExternalStore or subscriptions (websocket, event listeners)", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ url }) {",
        "  const v = useSyncExternalStore(store.subscribe, store.getSnapshot);",
        "  useEffect(() => { const ws = new WebSocket(url); ws.onmessage = (m) => setMsg(m.data); return () => ws.close(); }, [url]);",
        "  useEffect(() => { const h = () => setW(window.innerWidth); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);",
        "  useEffect(() => { const un = store.subscribe(() => setS(store.getState())); return un; }, []);",
        "  useEffect(() => { const t = setInterval(tick, 1000); return () => clearInterval(t); }, []);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("does not take an effect that sets loading state AND fetches (with abort) for a derived copy", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const [loading, setLoading] = useState(true);",
        "  const [data, setData] = useState(null);",
        "  useEffect(() => {",
        "    const ac = new AbortController();",
        "    setLoading(true);",
        "    fetch('/x/' + id, { signal: ac.signal }).then((r) => r.json()).then(setData).finally(() => setLoading(false));",
        "    return () => ac.abort();",
        "  }, [id]);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("does not flag Promise.allSettled, nor awaits that depend on each other in a for...of", () => {
    const r = fw({
      "src/a.ts": L(
        "export async function load(ids) {",
        "  const res = await Promise.allSettled([getA(), getB()]);",
        "  return res;",
        "}",
        "export async function walk(ids) {",
        "  let cursor = null;",
        "  for (const id of ids) {",
        "    const page = await fetchPage(id, cursor);",
        "    cursor = page.next;",
        "  }",
        "}",
        "export async function chain() {",
        "  const a = await getUser();",
        "  const b = await getOrders(a);",
        "  const c = await getItems(b.first);",
        "  return c;",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("an await in a loop body: each iteration re-awaits one call; not a second independent await", () => {
    const r = fw({
      "src/a.ts": L(
        "export async function walk(ids) {",
        "  for (const id of ids) {",
        "    const u = await getUser(id);",
        "    out.push(u);",
        "  }",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("skips test and spec files and __tests__ and *.stories files", () => {
    const body = "useEffect(() => { fetch('/a'); }, []);\nexport async function t() { const a = await getA(); const b = await getB(); }\n";
    const r = fw({
      "src/a.test.ts": body,
      "src/a.spec.tsx": body,
      "src/__tests__/b.tsx": body,
      "tests/c.ts": body,
      "e2e/d.ts": body,
    });
    expect(r.json.findings).toEqual([]);
  });

  it("server code under src/server is not a React effect, but sequential awaits there are still reported", () => {
    const r = fw({
      "src/server/db.ts": L(
        "export async function handler() {",
        "  const a = await getUser();",
        "  const b = await listPosts();",
        "  return [a, b];",
        "}",
      ),
    });
    // sequential awaits on the server are real waterfalls too; the point is no effect finding appears
    expect(kinds(r)).toEqual(["sequential-awaits@3"]);
  });

  it("a Next 'use server' action file with a write after a read is not reported", () => {
    const r = fw({
      "src/actions.ts": L(
        "'use server';",
        "export async function act(id) {",
        "  const u = await getUser(id);",
        "  await saveUser(u);",
        "  await sendEmail(u);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("does not flag effects that call non-fetch methods named get/find on collections", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useEffect(() => { const el = refs.get(id); el?.focus(); }, [id]);",
        "  useEffect(() => { const x = items.find((i) => i.id === id); setX(x); }, [id]);",
        "  useEffect(() => { searchParams.get('q'); }, []);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });
});

describe("fetch-waterfalls: false negatives", () => {
  it("a .then chain in an effect is flagged; so is an async IIFE with no guard", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useEffect(() => {",
        "    fetch('/a/' + id).then((r) => r.json()).then(setA);",
        "  }, [id]);",
        "  useEffect(() => {",
        "    (async () => {",
        "      const r = await fetch('/b/' + id);",
        "      setB(await r.json());",
        "    })();",
        "  }, [id]);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@2", "uncancelled-effect-fetch@5"]);
  });

  it("flags useLayoutEffect and React.useEffect and an effect with a function-expression callback", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useLayoutEffect(() => { fetch('/a'); }, []);",
        "  React.useEffect(() => { fetch('/b'); }, []);",
        "  useEffect(function () { fetch('/c'); }, []);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@2", "uncancelled-effect-fetch@3", "uncancelled-effect-fetch@4"]);
  });

  it("an imported api client: api.get(...) with no abort", () => {
    const r = fw({
      "src/a.tsx": L(
        "import { api } from './api';",
        "export function A({ id }) {",
        "  useEffect(() => { api.get('/u/' + id).then(setU); }, [id]);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@3"]);
  });

  it("BUG (medium): a nested client call, client.users.list().then(...), is a list* call but is not seen (member chain of two dots)", () => {
    const r = fw({
      "src/a.tsx": L(
        "import { client } from './api';",
        "export function A() {",
        "  useEffect(() => { client.users.list().then(setUsers); }, []);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@3"]);
  });

  it("a call named request or fetcher is seen; documents the limit: a call named run is not", () => {
    // names decide. getJSON/loadX/request/fetcher are seen; a call named `run` is not.
    const seen = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useEffect(() => { api.request({ url: '/u/' + id }).then(setU); }, [id]);",
        "}",
      ),
    });
    expect(kinds(seen)).toEqual(["uncancelled-effect-fetch@2"]);
    const unseen = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  useEffect(() => { api.run({ url: '/u/' + id }).then(setU); }, [id]);",
        "}",
      ),
    });
    expect(unseen.json.findings).toEqual([]);
  });

  it("derived-state effect with several setters, each from the dependencies", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ user }) {",
        "  const [name, setName] = useState('');",
        "  const [email, setEmail] = useState('');",
        "  useEffect(() => {",
        "    setName(user.name);",
        "    setEmail(user.email);",
        "  }, [user]);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["derived-state-effect@4"]);
  });

  it("BUG (low): a functional updater setX(prev => prev + n) is not a pure copy of the dependencies", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ n }) {",
        "  const [total, setTotal] = useState(0);",
        "  useEffect(() => { setTotal((t) => t + n); }, [n]);",
        "}",
      ),
    });
    // accumulating is a legitimate effect use
    expect(r.json.findings).toEqual([]);
  });

  it("derived-state: a setter of a useReducer or a prop callback is not a useState setter in this file", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ value, onChange }) {",
        "  const [s, dispatch] = useReducer(red, 0);",
        "  useEffect(() => { onChange(value * 2); }, [value]);",
        "  useEffect(() => { dispatch({ type: 'x', value }); }, [value]);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("derived-state: the setter's expression does not use any dependency (constant reset) is not flagged", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ id }) {",
        "  const [open, setOpen] = useState(true);",
        "  useEffect(() => { setOpen(false); }, [id]);",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("useFetch defined in another file and used in a scanned file: flagged where it is defined, not where it is used", () => {
    const r = fw({
      "src/hooks/useFetch.ts": L(
        "export function useFetch(url) {",
        "  const [d, setD] = useState(null);",
        "  useEffect(() => { fetch(url).then((r) => r.json()).then(setD); }, [url]);",
        "  return d;",
        "}",
      ),
      "src/Page.tsx": L(
        "import { useFetch } from './hooks/useFetch';",
        "export const Page = () => { const d = useFetch('/api/x'); return <p>{d}</p>; };",
      ),
    });
    expect(r.json.findings.map((f: any) => f.file)).toEqual(["src/hooks/useFetch.ts"]);
  });

  it("names an arrow-function hook (const useData = () => ...) in the detail", () => {
    const r = fw({
      "src/useData.ts": L(
        "export const useData = (id) => {",
        "  const [d, setD] = useState();",
        "  useEffect(() => { getData(id).then(setD); }, [id]);",
        "  return d;",
        "};",
      ),
    });
    expect(r.json.findings).toHaveLength(1);
    expect(r.json.findings[0].detail).toMatch(/hook useData/);
  });

  it("an effect with a block-comment or JSX text containing 'fetch(' is not a fetch", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A() {",
        "  useEffect(() => { /* fetch('/x') */ console.log('getUser()'); }, []);",
        "  return <p>call fetch('/y') then await getA()</p>;",
        "}",
      ),
    });
    expect(r.json.findings).toEqual([]);
  });

  it("BUG (medium): a backtick inside a regex literal makes the scanner read the rest of the file as a template: the file is skipped as unclosed and a real finding is lost", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A() {",
        "  const re = /`/;",
        "  useEffect(() => { fetch('/x'); }, []);",
        "}",
      ),
    });
    // the lone backtick sits inside a regex literal, so the template never opens: the fetch below must still be found
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@3"]);
    expect(r.json.skipped).toEqual([]);
  });

  it("BUG: a division sign followed later by a template literal is not read as a regex that swallows code", () => {
    const r = fw({
      "src/a.tsx": L(
        "export function A({ a, b }) {",
        "  const half = a / 2; const q = b / 4;",
        "  const s = `x ${half}`;",
        "  useEffect(() => { fetch('/x'); }, []);",
        "}",
      ),
    });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@4"]);
  });
});

describe("fetch-waterfalls: input edges", () => {
  it("CRLF files give the same lines and findings", () => {
    const src = L(
      "export function A({ id }) {",
      "  useEffect(() => {",
      "    fetch('/a');",
      "  }, [id]);",
      "}",
      "export async function f() {",
      "  const a = await getA();",
      "  const b = await getB();",
      "}",
    ).replace(/\n/g, "\r\n");
    const r = fw({ "src/a.tsx": src });
    expect(kinds(r)).toEqual(["uncancelled-effect-fetch@2", "sequential-awaits@8"]);
  });

  it("an unclosed template literal skips only that file and reports it", () => {
    const r = fw({
      "src/bad.ts": "const s = `abc ${x\nuseEffect(() => { fetch('/a'); }, []);\n",
      "src/good.tsx": "useEffect(() => { fetch('/b'); }, []);\n",
    });
    expect(r.code).toBe(0);
    expect(r.json.skipped.map((s: any) => s.file)).toEqual(["src/bad.ts"]);
    expect(r.json.findings.map((f: any) => f.file)).toEqual(["src/good.tsx"]);
  });

  it("a file over 512 KB is skipped with a reason, not read", () => {
    const big = "// " + "x".repeat(600 * 1024) + "\nuseEffect(() => { fetch('/a'); }, []);\n";
    const r = fw({ "src/big.ts": big });
    expect(r.code).toBe(0);
    expect(r.json.findings).toEqual([]);
    expect(r.json.skipped).toHaveLength(1);
    expect(r.json.skipped[0].file).toBe("src/big.ts");
  });

  it("a 400 KB file of many effects finishes quickly", () => {
    const one = "useEffect(() => { let c = false; getA().then((x) => { if (!c) set(x); }); return () => { c = true; }; }, []);\n";
    const t = Date.now();
    const r = fw({ "src/many.tsx": one.repeat(Math.floor((400 * 1024) / one.length)) });
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.json.findings).toEqual([]);
  });

  it("a binary file with a .ts extension does not crash the scan", () => {
    const root = project({ "src/ok.tsx": "useEffect(() => { fetch('/b'); }, []);\n" });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "blob.ts"), Buffer.from([0, 255, 254, 0, 1, 2, 96, 96, 0xc3, 0x28, 0, 0]));
    const r = runScript(FW, [root]);
    expect(r.code).toBe(0);
    expect(r.json.findings.map((f: any) => f.file)).toEqual(["src/ok.tsx"]);
  });

  it("an empty directory and a missing directory", () => {
    const r = fw({ "README.md": "x\n" });
    expect(r.code).toBe(0);
    expect(r.json.findings).toEqual([]);
    expect(runScript(FW, ["/nonexistent-dir-aidw-xyz"]).code).toBe(2);
  });

  it("an unknown flag and --base with a bad ref exit 2", () => {
    const root = project({ "src/a.ts": "x\n" });
    expect(runScript(FW, [root, "--wat"]).code).toBe(2);
    gitBase(root);
    expect(runScript(FW, [root, "--base", "no-such-ref"]).code).toBe(2);
  });

  it("--base with a renamed file: an unchanged body moved to a new name is not reported as added", () => {
    const body = L("export function A() {", "  useEffect(() => { fetch('/old'); }, []);", "}");
    const root = project({ "src/old.tsx": body });
    gitBase(root);
    spawnSync("git", ["mv", "src/old.tsx", "src/renamed.tsx"], { cwd: root });
    const r = runScript(FW, [root, "--base", "HEAD"]);
    expect(r.code).toBe(0);
    // a pure rename adds no lines: a PR reviewer should not see the old finding again
    expect(r.json.findings).toEqual([]);
  });

  it("--base: a renamed file with one added effect reports only the added one", () => {
    const body = L("export function A() {", "  useEffect(() => { fetch('/old'); }, []);", "}");
    const root = project({ "src/old.tsx": body });
    gitBase(root);
    spawnSync("git", ["mv", "src/old.tsx", "src/renamed.tsx"], { cwd: root });
    write(root, { "src/renamed.tsx": body + "export function B() {\n  useEffect(() => { fetch('/new'); }, []);\n}\n" });
    const r = runScript(FW, [root, "--base", "HEAD"]);
    expect(r.json.findings.map((f: any) => f.line)).toEqual([5]);
  });

  it("--base on a non-git directory exits 2", () => {
    const root = project({ "src/a.ts": "x\n" });
    expect(runScript(FW, [root, "--base", "HEAD"]).code).toBe(2);
  });

  it("ignores node_modules, dist and build output", () => {
    const f = "useEffect(() => { fetch('/a'); }, []);\n";
    const r = fw({ "node_modules/x/i.js": f, "dist/a.js": f, "public/a.js": f, "src/a.min.js": f, "src/a.bundle.js": f });
    expect(r.json.findings).toEqual([]);
  });
});

describe("route-guard-inventory: React Router shapes", () => {
  it("nested layouts with <Outlet/>: a guarded layout guards every child, an unguarded one none", () => {
    const r = rg({
      "src/r.tsx": L(
        "export const router = createBrowserRouter([",
        "  { path: '/', element: <Shell />, children: [",
        "    { path: 'billing', element: <Billing /> },",
        "    { element: <RequireAuth><Outlet /></RequireAuth>, children: [",
        "      { path: 'settings', element: <Settings /> },",
        "      { path: 'profile', children: [ { index: true, element: <Profile /> }, { path: 'edit', element: <Edit /> } ] },",
        "    ]},",
        "  ]},",
        "]);",
      ),
    });
    const g = guards(r);
    expect(g["/billing"]).toBeNull();
    expect(g["/settings"]).toBe("layout:wrapper:RequireAuth");
    expect(g["/profile/edit"]).toBe("layout:wrapper:RequireAuth");
    expect(r.json.routes.find((x: any) => x.path === "/profile")?.guard).toBe("layout:wrapper:RequireAuth");
  });

  it("an index route inherits its parent's path and guard", () => {
    const r = rg({
      "src/r.tsx": L(
        "export const router = createBrowserRouter([",
        "  { path: '/admin', element: <RequireAdmin><Outlet /></RequireAdmin>, children: [ { index: true, element: <AdminHome /> } ] },",
        "]);",
      ),
    });
    const hit = r.json.routes.filter((x: any) => x.path === "/admin");
    expect(hit).toHaveLength(1);
    expect(hit[0].guard).toMatch(/RequireAdmin/);
    expect(hit[0].element).toBe("AdminHome");
    expect(r.json.findings).toEqual([]);
  });

  it("lazy routes: lazy: () => import(...) is a route, and its guard wrapper is still seen", () => {
    const r = rg({
      "src/r.tsx": L(
        "export const router = createBrowserRouter([",
        "  { path: '/billing', lazy: () => import('./Billing') },",
        "  { path: '/settings', lazy: async () => { const m = await import('./Settings'); return { Component: m.Settings }; } },",
        "  { path: '/account', element: <RequireAuth><LazyAccount /></RequireAuth> },",
        "]);",
      ),
    });
    const g = guards(r);
    expect(Object.keys(g).sort()).toEqual(["/account", "/billing", "/settings"]);
    expect(g["/billing"]).toBeNull();
    expect(g["/account"]).toBe("wrapper:RequireAuth");
    // the modules are not scanned files: the guard is unknown, which is "lazy-unresolved", never "unguarded-route"
    expect(r.json.findings.map((f: any) => [f.kind, f.path])).toEqual([["lazy-unresolved", "/billing"], ["lazy-unresolved", "/settings"]]);
  });

  it("a lazy route whose module is a scanned file is followed: its loader that redirects is its guard", () => {
    const r = rg({
      "src/r.tsx": "export const router = createBrowserRouter([{ path: '/billing', lazy: () => import('./Billing') }]);\n",
      "src/Billing.tsx": "export async function loader() { if (!isLoggedIn()) throw redirect('/login'); return null; }\nexport const Component = () => null;\n",
    });
    expect(r.code).toBe(0);
    expect(guards(r)["/billing"]).toBe("loader:loader");
    expect(r.json.findings).toEqual([]);
  });

  it("BUG (low): a route whose element is a <Navigate/> redirect is not a page, so it is not an unguarded-route finding", () => {
    const r = rg({
      "src/r.tsx": L(
        "export const router = createBrowserRouter([",
        "  { path: '/admin', element: <Navigate to='/login' replace /> },",
        "  { path: '/old-billing', element: <Navigate to='/billing' /> },",
        "  { path: '/billing', element: <Billing /> },",
        "]);",
      ),
    });
    expect(r.json.findings.map((f: any) => f.path)).toEqual(["/billing"]);
  });

  it("a guard component that only renders null is not a redirect guard (client-only hide), but a named RequireX still counts", () => {
    const r = rg({
      "src/r.tsx": L(
        "function Hide({ children }) { const u = useUser(); return u ? children : null; }",
        "export const router = createBrowserRouter([",
        "  { path: '/billing', element: <Hide><Billing /></Hide> },",
        "  { path: '/settings', element: <RequireAuth><Settings /></RequireAuth> },",
        "]);",
      ),
    });
    const g = guards(r);
    expect(g["/billing"]).toBeNull();
    expect(g["/settings"]).toBe("wrapper:RequireAuth");
  });

  it("documents the limit: a component named RequireAuth that is defined in the file but only passes children through still counts as a guard (the name decides)", () => {
    const r = rg({
      "src/r.tsx": L(
        "const RequireAuth = ({ children }) => children;",
        "export const router = createBrowserRouter([ { path: '/billing', element: <RequireAuth><Billing /></RequireAuth> } ]);",
      ),
    });
    expect(guards(r)["/billing"]).toBe("wrapper:RequireAuth");
  });

  it("route config split across files: a spread of an imported array and a children reference", () => {
    const r = rg({
      "src/router.tsx": L(
        "import { billing } from './billing';",
        "import { adminRoutes } from './admin';",
        "export const router = createBrowserRouter([",
        "  ...billing,",
        "  { path: '/admin', element: <RequireAdmin><Outlet /></RequireAdmin>, children: adminRoutes },",
        "]);",
      ),
      "src/billing.tsx": "export const billing = [{ path: '/billing', element: <Billing /> }];\n",
      "src/admin.tsx": "export const adminRoutes = [{ path: 'users', element: <Users /> }];\n",
    });
    const g = guards(r);
    expect(g["/billing"]).toBeNull();
    expect(g["/admin/users"]).toBe("layout:wrapper:RequireAdmin");
  });

  it("a circular children reference between two arrays terminates", () => {
    const r = rg({
      "src/a.tsx": "export const a = [{ path: 'x', children: b }];\nexport const b = [{ path: 'y', children: a }];\n",
    });
    expect(r.code).toBe(0);
  });

  it("createRoutesFromElements with <Route> JSX is read", () => {
    const r = rg({
      "src/r.tsx": L(
        "export const router = createBrowserRouter(createRoutesFromElements(",
        "  <Route path='/' element={<Root />}>",
        "    <Route path='billing' element={<Billing />} />",
        "    <Route element={<RequireAuth><Outlet /></RequireAuth>}>",
        "      <Route path='settings' element={<Settings />} />",
        "    </Route>",
        "  </Route>",
        "));",
      ),
    });
    const g = guards(r);
    expect(g["/billing"]).toBeNull();
    expect(g["/settings"]).toBe("layout:wrapper:RequireAuth");
  });

  it("a JSX <Route> with Component={...} or lazy prop and a self-closing guard element", () => {
    const r = rg({
      "src/r.tsx": L(
        "export const A = () => (",
        "  <Routes>",
        "    <Route path='/billing' Component={Billing} />",
        "    <Route path='/settings' element={<ProtectedRoute><Settings /></ProtectedRoute>} />",
        "  </Routes>",
        ");",
      ),
    });
    const g = guards(r);
    expect(g["/billing"]).toBeNull();
    expect(g["/settings"]).toBe("wrapper:ProtectedRoute");
  });

  it("a guard that checks localStorage.role: the route is a client-only guard, classified as 'client'", () => {
    const r = rg({
      "src/r.tsx": L(
        "function AdminOnly({ children }) { return localStorage.getItem('role') === 'admin' ? children : <Navigate to='/' />; }",
        "export const router = createBrowserRouter([ { path: '/admin', element: <AdminOnly><Admin /></AdminOnly> } ]);",
      ),
    });
    const x = r.json.routes.find((q: any) => q.path === "/admin");
    expect(x.guardKind === "client" || x.guard === null).toBe(true);
    if (x.guard !== null) expect(x.guardKind).toBe("client");
    // the Navigate checks a role from localStorage, which the user controls: either way it must not be called a server guard
    expect(x.guardKind).not.toBe("server");
  });

  it("a guard component that redirects on a localStorage role check is not a guard: the user controls localStorage", () => {
    const r = rg({
      "src/r.tsx": L(
        "function AdminOnly({ children }) { return localStorage.getItem('role') === 'admin' ? children : <Navigate to='/' />; }",
        "export const router = createBrowserRouter([ { path: '/admin', element: <AdminOnly><Admin /></AdminOnly> } ]);",
      ),
    });
    expect(guards(r)["/admin"]).toBeNull();
  });

  it("a route with a trailing-slash path or an uppercase path is still listed", () => {
    const r = rg({
      "src/r.tsx": "export const r = [{ path: '/Billing/', element: <B /> }, { path: 'Settings', element: <S /> }];\n",
    });
    expect(r.json.routes.map((x: any) => x.path).sort()).toEqual(["/Billing", "/Settings"]);
  });
});

describe("route-guard-inventory: --routes matching", () => {
  const R = { "src/r.tsx": "export const r = [{ path: '/billing', element: <B /> }, { path: '/users/:id', element: <U /> }, { path: '/files/*', element: <F /> }];\n" };

  it("a trailing slash on the --routes path matches the route", () => {
    const r = rg(R, ["--routes", "/billing/"]);
    expect(r.json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
  });

  it("a --routes path without a leading slash matches", () => {
    const r = rg(R, ["--routes", "billing"]);
    expect(r.json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
  });

  it("a param segment on either side matches: /users/:id vs /users/7 vs /users/:uid", () => {
    expect(rg(R, ["--routes", "/users/7"]).json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
    expect(rg(R, ["--routes", "/users/:uid"]).json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
  });

  it("a splat route matches a deeper path", () => {
    expect(rg(R, ["--routes", "/files/a/b"]).json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
  });

  it("case mismatch: --routes /Billing against /billing is reported either as found or as not found, not silently as clean", () => {
    const r = rg(R, ["--routes", "/Billing"]);
    expect(r.json.findings).toHaveLength(1);
  });

  it("BUG (low): React Router matches paths case-insensitively, so --routes /Billing hits /billing: it should be unguarded-route, not route-not-found", () => {
    const r = rg(R, ["--routes", "/Billing"]);
    expect(r.json.findings[0].kind).toBe("unguarded-route");
  });

  it("documents the behaviour: a query string in --routes is part of the path, so it is reported route-not-found (loud, not silent)", () => {
    const r = rg(R, ["--routes", "/billing?tab=1"]);
    expect(r.json.findings.map((f: any) => f.kind)).toEqual(["route-not-found"]);
  });

  it("a guarded route in --routes yields no finding", () => {
    const g = rg({ "src/r.tsx": "export const r = [{ path: '/billing', element: <RequireAuth><B /></RequireAuth> }];\n" }, ["--routes", "/billing"]);
    expect(g.json.findings).toEqual([]);
  });

  it("BUG (low): a path listed twice in --routes (or listed and also caught by the default sensitive-segment check) yields one finding, not two", () => {
    const d = rg(R, ["--routes", "/billing,/billing"]);
    expect(d.json.findings).toHaveLength(1);
  });

  it("whitespace around the entries is trimmed; a stray comma is ignored", () => {
    const r = rg(R, ["--routes", " /billing , ,/nope"]);
    expect(r.json.findings.map((f: any) => f.kind).sort()).toEqual(["route-not-found", "unguarded-route"]);
  });

  it("a layout path is matched too: --routes /admin where /admin is only a layout of guarded children", () => {
    const r = rg({
      "src/r.tsx": "export const r = [{ path: '/admin', children: [ { path: 'users', element: <RequireAdmin><U /></RequireAdmin> } ] }];\n",
    }, ["--routes", "/admin"]);
    // the layout itself has no guard, so asserting it is unguarded is right: the check by --routes matches layout paths
    expect(r.json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
  });

  it("--routes against a Next app with no middleware reports unguarded; with a matching middleware reports clean", () => {
    const base = { "src/app/billing/page.tsx": "export default function P() { return null; }\n" };
    expect(rg(base, ["--routes", "/billing"]).json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route"]);
    const mw = rg({
      ...base,
      "middleware.ts": "export function middleware(req) { if (!req.cookies.get('s')) return NextResponse.redirect(new URL('/login', req.url)); }\nexport const config = { matcher: ['/billing'] };\n",
    }, ["--routes", "/billing"]);
    expect(mw.json.findings).toEqual([]);
  });
});

describe("route-guard-inventory: Next app router", () => {
  it("route groups and parallel routes: (group) and @slot are not part of the path", () => {
    const r = rg({
      "app/(marketing)/about/page.tsx": "export default function A() { return null; }\n",
      "app/(app)/dashboard/page.tsx": "export default function D() { return null; }\n",
      "app/(app)/dashboard/@stats/page.tsx": "export default function S() { return null; }\n",
      "app/(app)/dashboard/@stats/default.tsx": "export default function S() { return null; }\n",
    });
    const paths = r.json.routes.map((x: any) => x.path).sort();
    expect(paths).not.toContain("/@stats");
    expect(paths.some((p: string) => p.includes("@"))).toBe(false);
    expect(paths).toContain("/about");
    expect(paths).toContain("/dashboard");
  });

  it("BUG (low): an intercepting route (.)photo is not reported as its own literal path with parens", () => {
    const r = rg({
      "app/feed/(.)photo/[id]/page.tsx": "export default function P() { return null; }\n",
      "app/photo/[id]/page.tsx": "export default function P() { return null; }\n",
    });
    const paths = r.json.routes.map((x: any) => x.path);
    expect(paths.some((p: string) => p.includes("(.)"))).toBe(false);
  });

  it("dynamic segments [id], [...slug], [[...slug]] become :id / * so --routes can match them", () => {
    const r = rg({
      "app/blog/[slug]/page.tsx": "export default function P() { return null; }\n",
      "app/docs/[...path]/page.tsx": "export default function P() { return null; }\n",
    }, ["--routes", "/blog/hello,/docs/a/b"]);
    expect(r.json.findings.map((f: any) => f.kind)).toEqual(["unguarded-route", "unguarded-route"]);
  });

  it("the root page app/page.tsx is route /", () => {
    const r = rg({ "app/page.tsx": "export default function H() { return null; }\n" });
    expect(r.json.routes.map((x: any) => x.path)).toEqual(["/"]);
  });

  it("a layout with an auth check that only reads a cookie but never redirects is not a server guard", () => {
    const r = rg({
      "app/admin/layout.tsx": "export default async function L({ children }) { const s = await getServerSession(); return <div data-auth={!!s}>{children}</div>; }\n",
      "app/admin/page.tsx": "export default function A() { return null; }\n",
    });
    expect(guards(r)["/admin"]).toBeNull();
  });

  it("a middleware that matches with a negative lookahead matcher covers /billing", () => {
    const r = rg({
      "middleware.ts": "export function middleware(req) { if (!req.cookies.get('s')) return NextResponse.redirect(new URL('/login', req.url)); }\nexport const config = { matcher: ['/((?!api|_next/static|login).*)'] };\n",
      "app/billing/page.tsx": "export default function B() { return null; }\n",
      "app/login/page.tsx": "export default function L() { return null; }\n",
    });
    expect(guards(r)["/billing"]).toBe("middleware");
  });

  it("a middleware without a matcher covers everything it redirects for", () => {
    const r = rg({
      "middleware.ts": "export function middleware(req) { if (!getToken(req)) return NextResponse.redirect(new URL('/login', req.url)); }\n",
      "app/billing/page.tsx": "export default function B() { return null; }\n",
    });
    expect(guards(r)["/billing"]).toBe("middleware");
  });

  it("a middleware that rewrites headers only (no redirect, no auth) is not a guard", () => {
    const r = rg({
      "middleware.ts": "export function middleware(req) { const res = NextResponse.next(); res.headers.set('x-a', '1'); return res; }\n",
      "app/billing/page.tsx": "export default function B() { return null; }\n",
    });
    expect(guards(r)["/billing"]).toBeNull();
  });

  it("the pages/ router is not read: no routes, no crash", () => {
    const r = rg({ "pages/billing.tsx": "export default function B() { return null; }\n" });
    expect(r.code).toBe(0);
    expect(r.json.routes).toEqual([]);
    expect(r.json.framework).toBeNull();
  });

  it("both a React Router app and a Next app: framework is 'both'", () => {
    const r = rg({
      "app/billing/page.tsx": "export default function B() { return null; }\n",
      "src/r.tsx": "export const r = [{ path: '/x', element: <X /> }];\n",
    });
    expect(r.json.framework).toBe("both");
  });
});

describe("route-guard-inventory: input edges", () => {
  it("CRLF line endings give the same line numbers and guards", () => {
    const src = L(
      "export const router = createBrowserRouter([",
      "  { path: '/billing', element: <Billing /> },",
      "  { path: '/settings', element: <RequireAuth><S /></RequireAuth> },",
      "]);",
    ).replace(/\n/g, "\r\n");
    const r = rg({ "src/r.tsx": src });
    expect(r.json.routes.map((x: any) => [x.path, x.line, x.guard])).toEqual([
      ["/billing", 2, null],
      ["/settings", 3, "wrapper:RequireAuth"],
    ]);
  });

  it("an unclosed template literal skips that file, others still read", () => {
    const r = rg({
      "src/bad.tsx": "const s = `open\nexport const r = [{ path: '/billing', element: <B /> }];\n",
      "src/ok.tsx": "export const r = [{ path: '/admin', element: <A /> }];\n",
    });
    expect(r.json.skipped.map((s: any) => s.file)).toEqual(["src/bad.tsx"]);
    expect(r.json.routes.map((x: any) => x.path)).toEqual(["/admin"]);
  });

  it("a route path built from a template literal or a variable is not read, and does not crash", () => {
    const r = rg({
      "src/r.tsx": "const base = '/x';\nexport const r = [{ path: `${base}/billing`, element: <B /> }, { path: base, element: <C /> }];\n",
    });
    expect(r.code).toBe(0);
  });

  it("a file over 512 KB is skipped; a binary file is tolerated", () => {
    const root = project({ "src/big.tsx": "// " + "y".repeat(600 * 1024) + "\n", "src/ok.tsx": "export const r = [{ path: '/admin', element: <A /> }];\n" });
    writeFileSync(join(root, "src", "blob.ts"), Buffer.from([0, 1, 2, 96, 0, 255, 254, 123, 123]));
    const r = runScript(RG, [root]);
    expect(r.code).toBe(0);
    expect(r.json.skipped.map((s: any) => s.file)).toContain("src/big.tsx");
    expect(r.json.routes.map((x: any) => x.path)).toEqual(["/admin"]);
  });

  it("a deeply nested route tree (200 levels) does not overflow the stack", () => {
    let s = "";
    for (let i = 0; i < 200; i++) s += `{ path: 'p${i}', children: [`;
    s += "{ path: 'leaf', element: <L /> }";
    for (let i = 0; i < 200; i++) s += "] }";
    const r = rg({ "src/r.tsx": `export const r = [${s}];\n` });
    expect(r.code).toBe(0);
  });

  it("--base with a renamed route file: an unchanged route is not reported", () => {
    const body = "export const r = [{ path: '/billing', element: <B /> }];\n";
    const root = project({ "src/old.tsx": body });
    gitBase(root);
    spawnSync("git", ["mv", "src/old.tsx", "src/renamed.tsx"], { cwd: root });
    const r = runScript(RG, [root, "--base", "HEAD"]);
    expect(r.code).toBe(0);
    expect(r.json.routes).toEqual([]);
    expect(r.json.findings).toEqual([]);
  });

  it("--base: a route added in a file whose guard wrapper is defined on an unchanged line is still guarded", () => {
    const root = project({ "src/r.tsx": "function RequireUser({ children }) { const u = useUser(); return u ? children : <Navigate to='/login' />; }\nexport const r = [];\n" });
    gitBase(root);
    write(root, { "src/r.tsx": "function RequireUser({ children }) { const u = useUser(); return u ? children : <Navigate to='/login' />; }\nexport const r = [{ path: '/billing', element: <RequireUser><B /></RequireUser> }];\n" });
    const r = runScript(RG, [root, "--base", "HEAD"]);
    expect(r.json.findings).toEqual([]);
  });

  it("--routes empty list, a bare --routes and a bad flag exit 2", () => {
    const root = project({ "src/r.tsx": "export const r = [];\n" });
    expect(runScript(RG, [root, "--routes"]).code).toBe(2);
    expect(runScript(RG, [root, "--routes", ","]).code).toBe(2);
    expect(runScript(RG, [root, "--nope"]).code).toBe(2);
  });
});

describe("on the real fixture evals/fixtures/frontend-web", () => {
  it.skipIf(!existsSync(FIXTURE))("fetch-waterfalls reports nothing and skips only the public/ output folder", () => {
    const r = runScript(FW, [FIXTURE]);
    expect(r.code).toBe(0);
    expect(r.json.findings).toEqual([]);
    expect(r.json.skipped.map((x: any) => x.file)).toEqual(["public/"]);
    expect(runScript(FW, [FIXTURE, "--text"]).code).toBe(0);
  });

  it.skipIf(!existsSync(FIXTURE))("route-guard-inventory reports nothing and skips only the public/ output folder", () => {
    const r = runScript(RG, [FIXTURE]);
    expect(r.code).toBe(0);
    expect(r.json.findings).toEqual([]);
    expect(r.json.skipped.map((x: any) => x.file)).toEqual(["public/"]);
    expect(runScript(RG, [FIXTURE, "--text"]).code).toBe(0);
  });

  it.skipIf(!existsSync(FIXTURE))("run from the fixture as the cwd with no dir argument gives the same result", () => {
    const a = runScript(FW, [FIXTURE]);
    const b = runScript(FW, [], FIXTURE);
    expect(b.json.findings).toEqual(a.json.findings);
    const c = runScript(RG, [FIXTURE]);
    const d = runScript(RG, [], FIXTURE);
    expect(d.json.routes).toEqual(c.json.routes);
  });
});
