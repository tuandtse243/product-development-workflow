import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, gitBase, project, roleScript, runScript, write } from "./rolescripts.js";

// The backend Role's measuring tools (plan R1): dependency-free Node scripts, advisory, JSON by default.
const S = (name: string) => roleScript("backend", name);
afterAll(cleanTemps);

const SCRIPTS = ["route-inventory.mjs", "env-names.mjs", "error-shape-probe.mjs", "query-count.mjs", "leak-and-timeout-scan.mjs"];

describe("every backend script", () => {
  it("is one of the five, prints --help with exit 0, refuses an unknown option with exit 2", () => {
    const dir = join(__dirname, "..", "plugins", "aidw", "roles", "backend", "scripts");
    expect(readdirSync(dir).filter((f) => !f.startsWith("_")).sort()).toEqual([...SCRIPTS].sort());
    for (const name of SCRIPTS) {
      const help = runScript(S(name), ["--help"]);
      expect(help.code, name).toBe(0);
      expect(help.stdout, name).toMatch(/Usage:/);
      const bad = runScript(S(name), ["--no-such-option"]);
      expect(bad.code, name).toBe(2);
      expect(bad.stderr, name).toMatch(/--help/);
    }
  });

  it("imports only node built-ins and documents its usage at the top", () => {
    const dir = join(__dirname, "..", "plugins", "aidw", "roles", "backend", "scripts");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)) expect(m[1], `${f}: ${m[1]}`).toMatch(/^(node:|\.\/_)/);
      if (!f.startsWith("_")) expect(src.slice(0, 2000), f).toMatch(/Usage:/);
    }
  });

  it("exits 2 on a directory that does not exist", () => {
    for (const name of ["route-inventory.mjs", "env-names.mjs", "error-shape-probe.mjs", "leak-and-timeout-scan.mjs"]) {
      expect(runScript(S(name), ["/no/such/dir/anywhere"]).code, name).toBe(2);
    }
  });
});

describe("route-inventory", () => {
  const files = {
    "package.json": "{}",
    "src/server.ts": [
      "import express from 'express';",
      "const app = express();",
      "// app.get('/commented', handler)",
      "app.get('/health', (req, res) => res.send('ok'));",
      "app.post('/orders', requireUser, createOrder);",
      "router.route('/items/:id').get(getItem).delete(removeItem);",
      "const v = map.get('key');",
      "fastify.route({ method: ['GET', 'HEAD'], url: '/fastify/:id', handler: show });",
      "app.on('PUT', '/hono', (c) => c.text('x'));",
    ].join("\n"),
    "src/users.controller.ts": [
      "import { Controller, Get, Post, Param } from '@nestjs/common';",
      "@Controller('users')",
      "export class UsersController {",
      "  @Get(':id')",
      "  async findOne(@Param('id') id: string) {}",
      "  @Post()",
      "  @HttpCode(201)",
      "  public create() {}",
      "}",
    ].join("\n"),
    "app/api/projects/[id]/route.ts": "export async function GET(req: Request) {}\nexport const DELETE = async () => {};\n",
    "app/(admin)/api/stats/route.ts": "export { handler as GET, handler as POST };\n",
    "app/_private/route.ts": "export function GET() {}\n",
    "api/main.py": [
      "from fastapi import APIRouter",
      "router = APIRouter(prefix=\"/books\")",
      "@router.get(\"/{book_id}\")",
      "async def read_book(book_id: int):",
      "    pass",
    ].join("\n"),
    "tests/items.test.ts": "it('x', async () => { await request(app).get('/items/' + id).expect(401); await request(app).get(`/items/${other}`).expect(404); expect(200) });\n",
    "tests/health.test.ts": "request(app).get('/health')\n",
  };

  it("lists Express, Fastify, Hono, NestJS, Next.js and FastAPI routes with file:line and handler", () => {
    const root = project(files);
    const r = runScript(S("route-inventory.mjs"), [root]);
    expect(r.code).toBe(0);
    const got = r.json.routes.map((x: any) => `${x.method} ${x.path} ${x.file}:${x.line} ${x.handler ?? "-"}`).sort();
    expect(got).toEqual([
      "DELETE /api/projects/[id] app/api/projects/[id]/route.ts:2 DELETE",
      "DELETE /items/:id src/server.ts:6 removeItem",
      "GET /api/projects/[id] app/api/projects/[id]/route.ts:1 GET",
      "GET /api/stats app/(admin)/api/stats/route.ts:1 handler",
      "GET /books/{book_id} api/main.py:3 read_book",
      "GET /fastify/:id src/server.ts:8 show",
      "GET /health src/server.ts:4 -",
      "GET /items/:id src/server.ts:6 getItem",
      "GET /users/:id src/users.controller.ts:4 findOne",
      "HEAD /fastify/:id src/server.ts:8 show",
      "POST /api/stats app/(admin)/api/stats/route.ts:1 handler",
      "POST /orders src/server.ts:5 createOrder",
      "POST /users src/users.controller.ts:6 create",
      "PUT /hono src/server.ts:9 -",
    ]);
  });

  it("finds the tests that call a route and, for a route with an id, which access cases they assert", () => {
    const root = project(files);
    const routes = runScript(S("route-inventory.mjs"), [root]).json.routes;
    const item = routes.find((x: any) => x.method === "GET" && x.path === "/items/:id");
    expect(item.tests).toEqual(["tests/items.test.ts"]);
    expect(item.accessCases).toEqual({ noIdentity: true, otherUser: true, owner: true });
    const health = routes.find((x: any) => x.path === "/health");
    expect(health.tests).toEqual(["tests/health.test.ts"]);
    expect(health.accessCases).toBeUndefined();
    const orders = routes.find((x: any) => x.path === "/orders");
    expect(orders.tests).toEqual([]);
  });

  it("with --base keeps the routes of changed files and marks the added ones", () => {
    const root = project({ "src/a.ts": "app.get('/a', a);\n", "src/b.ts": "app.get('/b', b);\n" });
    gitBase(root);
    write(root, { "src/a.ts": "app.get('/a', a);\napp.post('/a', a2);\n", "src/c.ts": "app.put('/c', c);\n" });
    const r = runScript(S("route-inventory.mjs"), [root, "--base", "HEAD"]);
    expect(r.code).toBe(0);
    expect(r.json.routes.map((x: any) => `${x.method} ${x.path} ${x.added}`).sort()).toEqual(["GET /a false", "POST /a true", "PUT /c true"]);
  });

  it("does not take code inside a string or a comment for a route", () => {
    const root = project({ "src/doc.ts": "const help = `\n  app.get('/in-a-string', h)\n`;\n/* app.post('/in-a-comment', h) */\napp.put('/real', h);\n" });
    expect(runScript(S("route-inventory.mjs"), [root]).json.routes.map((x: any) => x.path)).toEqual(["/real"]);
  });

  it("prints a table with --text", () => {
    const root = project(files);
    const r = runScript(S("route-inventory.mjs"), [root, "--text"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/GET\s+\/health\s+src\/server\.ts:4/);
  });

  it("exits 2 on a base ref git does not know", () => {
    const root = project({ "a.ts": "" });
    gitBase(root);
    expect(runScript(S("route-inventory.mjs"), [root, "--base", "nope-ref"]).code).toBe(2);
  });
});

describe("env-names", () => {
  const files = {
    ".env.example": "# comment\nDATABASE_URL=postgres://user:secret-value@host/db\nexport STRIPE_KEY=\nUNUSED_ONE=1\n# OPTIONAL_FLAG=\n",
    ".env": "SHOULD_NEVER_BE_READ=topsecret\n",
    "src/config/env.ts": "export const env = { db: process.env.DATABASE_URL, stripe: process.env['STRIPE_KEY'], mode: process.env.NODE_ENV };\n",
    "src/orders/service.ts": "const k = process.env.MISSING_KEY;\nconst { REDIS_URL, PORT: port = 3000 } = process.env;\nconst dyn = process.env[name];\n",
    "web/main.ts": "const u = import.meta.env.VITE_API_URL; const m = import.meta.env.MODE;\n",
    "app/settings.py": "import os\nA = os.environ['PY_A']\nB = os.environ.get(\"PY_B\")\nC = os.getenv('OPTIONAL_FLAG')\n",
    "tests/a.test.ts": "process.env.TEST_ONLY = '1'; const x = process.env.TEST_READ;\n",
  };

  it("lists names read but not in .env.example, listed but never read, and read outside the config module", () => {
    const root = project(files);
    const r = runScript(S("env-names.mjs"), [root]);
    expect(r.code).toBe(0);
    expect(r.json.example).toBe(".env.example");
    expect(r.json.readNotListed.map((x: any) => x.name)).toEqual(["MISSING_KEY", "PORT", "PY_A", "PY_B", "REDIS_URL", "VITE_API_URL"]);
    expect(r.json.listedNotRead).toEqual(["UNUSED_ONE"]);
    expect(r.json.readOutsideConfig.map((x: any) => `${x.name} ${x.file}:${x.line}`)).toEqual([
      "MISSING_KEY src/orders/service.ts:1",
      "PORT src/orders/service.ts:2",
      "REDIS_URL src/orders/service.ts:2",
      "VITE_API_URL web/main.ts:1",
    ]);
    expect(r.json.dynamic).toEqual([{ file: "src/orders/service.ts", line: 3 }]);
    expect(r.json.read.map((x: any) => x.name)).not.toContain("TEST_READ");
  });

  it("never prints a value, from .env.example or .env", () => {
    const root = project(files);
    for (const args of [[root], [root, "--text"]]) {
      const out = runScript(S("env-names.mjs"), args).stdout;
      expect(out).not.toMatch(/secret-value|topsecret|SHOULD_NEVER_BE_READ|postgres:/);
    }
  });

  it("treats files named with --config as the config module, and reports a missing .env.example", () => {
    const root = project({ "src/a.ts": "process.env.A;\n", "src/b.ts": "process.env.B;\n" });
    const r = runScript(S("env-names.mjs"), [root, "--config", "src/a.ts"]);
    expect(r.json.example).toBeNull();
    expect(r.json.readNotListed.map((x: any) => x.name)).toEqual(["A", "B"]);
    expect(r.json.readOutsideConfig.map((x: any) => x.name)).toEqual(["B"]);
  });

  it("with --base looks only at the lines the diff adds, but listed-not-read still uses the whole tree", () => {
    const root = project({ ".env.example": "OLD=\nGONE=\n", "src/config.ts": "process.env.OLD;\n", "src/x.ts": "process.env.LEGACY;\n" });
    gitBase(root);
    write(root, { "src/x.ts": "process.env.LEGACY;\nprocess.env.NEW_ONE;\n" });
    const r = runScript(S("env-names.mjs"), [root, "--base", "HEAD"]);
    expect(r.json.readNotListed.map((x: any) => x.name)).toEqual(["NEW_ONE"]);
    expect(r.json.listedNotRead).toEqual(["GONE"]);
  });
});

describe("error-shape-probe", () => {
  it("statically finds error responses whose keys miss the default problem-details shape", () => {
    const root = project({
      "src/a.ts": [
        "res.status(404).json({ type: 'about:blank', title: 'Not found', status: 404 });",
        "res.status(400).json({ error: 'bad' });",
        "res.status(500).send({ message: err.message, stack: err.stack });",
        "reply.code(409).send({ type: t, title, status: 409, detail: d, code: 'X' });",
        "res.status(200).json({ ok: true });",
        "res.json({ error: 'oops' });",
        "return NextResponse.json({ message: 'no' }, { status: 403 });",
        "return c.json({ error: 'x' }, 422);",
        "throw new HttpException({ reason: 'x' }, 400);",
        "res.status(400).json({ ...problem, title: 'x' });",
      ].join("\n"),
      "src/b.py": "return JSONResponse(status_code=422, content={\"msg\": \"bad\"})\n",
      "src/c.ts": "return NextResponse.json(listTodos());\nreturn NextResponse.json(todo, { status: 201 });\nres.status(200).json(rows);\nconst t = `res.status(400).json({ e: 1 })`;\n",
    });
    const r = runScript(S("error-shape-probe.mjs"), [root]);
    expect(r.code).toBe(0);
    expect(r.json.shape.source).toBe("default (RFC 9457 problem details)");
    const sites = r.json.sites.filter((s: any) => s.file === "src/a.ts").map((s: any) => `${s.line}:${s.status ?? "-"}:${s.kind}:${s.missing.join(",")}`);
    expect(sites).toEqual([
      "1:404:ok:",
      "2:400:mismatch:type,title,status",
      "3:500:mismatch:type,title,status",
      "4:409:ok:",
      "6:200:error-in-200:",
      "7:403:mismatch:type,title,status",
      "8:422:mismatch:type,title,status",
      "9:400:mismatch:type,title,status",
      "10:400:unknown:",
    ]);
    expect(r.json.sites.filter((s: any) => s.file === "src/c.ts")).toEqual([]);
    const py = r.json.sites.find((s: any) => s.file === "src/b.py");
    expect(py.missing).toEqual(["type", "title", "status"]);
    expect(r.json.sites.find((s: any) => s.line === 4 && s.file === "src/a.ts").extra).toEqual(["code"]);
  });

  it("reads the error shape from an OpenAPI contract given with --contract", () => {
    const root = project({
      "openapi.yaml": [
        "openapi: 3.1.0",
        "paths:",
        "  /x:",
        "    get:",
        "      responses:",
        "        '404':",
        "          description: not found",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/ApiError'",
        "components:",
        "  schemas:",
        "    ApiError:",
        "      type: object",
        "      required: [code, message]",
        "      properties:",
        "        code:",
        "          type: string",
        "        message:",
        "          type: string",
      ].join("\n"),
      "src/a.ts": "res.status(404).json({ code: 'NOT_FOUND', message: 'x' });\nres.status(400).json({ error: 'x' });\n",
    });
    const r = runScript(S("error-shape-probe.mjs"), [root, "--contract", join(root, "openapi.yaml")]);
    expect(r.code).toBe(0);
    expect(r.json.shape).toMatchObject({ source: "contract openapi.yaml#/components/schemas/ApiError", required: ["code", "message"], mediaType: "application/json" });
    expect(r.json.sites.map((s: any) => `${s.line}:${s.kind}:${s.missing.join(",")}`)).toEqual(["1:ok:", "2:mismatch:code,message"]);
  });

  it("checks captured responses: missing members, media type and leak markers", () => {
    const root = project({
      "responses.jsonl": [
        JSON.stringify({ name: "ok", status: 404, headers: { "Content-Type": "application/problem+json" }, body: { type: "t", title: "Not found", status: 404 } }),
        JSON.stringify({ name: "leaky", status: 500, headers: { "content-type": "text/html" }, body: "Error: boom\n    at Object.<anonymous> (/Users/dev/app/src/x.js:10:5)\nSELECT * FROM users WHERE id = 1" }),
        JSON.stringify({ name: "fine 200", status: 200, headers: {}, body: { id: 1 } }),
      ].join("\n"),
    });
    const r = runScript(S("error-shape-probe.mjs"), ["--responses", join(root, "responses.jsonl")]);
    expect(r.code).toBe(0);
    expect(r.json.responses).toHaveLength(2);
    expect(r.json.responses[0]).toMatchObject({ name: "ok", kind: "ok", missing: [], leaks: [] });
    expect(r.json.responses[1]).toMatchObject({ name: "leaky", kind: "mismatch", mediaType: "text/html" });
    expect(r.json.responses[1].leaks.sort()).toEqual(["SQL text", "absolute path", "stack trace"]);
    expect(r.json.responses[1].findings.join(" ")).toMatch(/application\/problem\+json/);
  });

  it("takes the shape from --shape and exits 2 on an unreadable contract", () => {
    const root = project({ "src/a.ts": "res.status(400).json({ error: 'x' });\n" });
    const r = runScript(S("error-shape-probe.mjs"), [root, "--shape", "error"]);
    expect(r.json.sites[0].kind).toBe("ok");
    expect(runScript(S("error-shape-probe.mjs"), [root, "--contract", join(root, "nope.yaml")]).code).toBe(2);
  });
});

describe("query-count", () => {
  it("counts statements in a query log and compares two logs (1 row and N rows)", () => {
    const root = project({
      "one.log": "prisma:query SELECT * FROM posts LIMIT 20\nprisma:query SELECT * FROM authors WHERE id IN ($1)\n",
      "many.log": [
        "Executing (default): SELECT * FROM posts LIMIT 20",
        "(0.001) SELECT * FROM authors WHERE id = 1; args=(1,)",
        "Query: select * from authors where id = $1",
        "INFO sqlalchemy.engine.Engine SELECT authors.id",
        "FROM authors",
        "server started with config ok",
      ].join("\n"),
    });
    const one = runScript(S("query-count.mjs"), ["--log", join(root, "one.log")]);
    expect(one.code).toBe(0);
    expect(one.json.total).toBe(2);
    const cmp = runScript(S("query-count.mjs"), ["--one", join(root, "one.log"), "--many", join(root, "many.log")]);
    expect(cmp.json).toMatchObject({ one: 2, many: 4, difference: 2, grows: true });
  });

  it("reads labelled sections that the module's mark() writes and compares them by label", () => {
    const root = project({
      "q.log": "-- aidw:query-count one\naidw:query SELECT 1\naidw:query SELECT 2\n-- aidw:query-count many\naidw:query SELECT 1\naidw:query SELECT 2\n",
    });
    const r = runScript(S("query-count.mjs"), ["--log", join(root, "q.log"), "--one", "one", "--many", "many"]);
    expect(r.json.sections).toEqual([{ label: "one", count: 2 }, { label: "many", count: 2 }]);
    expect(r.json).toMatchObject({ one: 2, many: 2, difference: 0, grows: false });
  });

  it("works as a module: a counter wraps a driver, and with --run it reads the log the test wrote", () => {
    const mod = S("query-count.mjs");
    const root = project({
      "count.test.mjs": [
        `import { createCounter } from ${JSON.stringify(mod)};`,
        "import { writeFileSync } from 'node:fs';",
        "const db = { async query(sql) { return [sql]; } };",
        "const counter = createCounter();",
        "const restore = counter.wrap(db, ['query']);",
        "async function list(n) { await db.query('SELECT posts'); for (let i = 0; i < n; i++) await db.query('SELECT author'); }",
        "const m = await counter.measure(() => list(2));",
        "counter.mark('one'); await list(1);",
        "counter.mark('many'); await list(5);",
        "restore();",
        "await db.query('not counted');",
        "writeFileSync('result.json', JSON.stringify({ count: counter.count, measured: m.count }));",
      ].join("\n"),
    });
    const r = runScript(S("query-count.mjs"), ["--run", `node count.test.mjs`, "--log", "q.log", "--one", "one", "--many", "many"], root);
    expect(r.code).toBe(0);
    expect(r.json.run.exitCode).toBe(0);
    expect(r.json).toMatchObject({ one: 2, many: 6, difference: 4, grows: true });
    expect(readFileSync(join(root, "q.log"), "utf8")).toMatch(/aidw:query-count one/);
    expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8"))).toEqual({ count: 11, measured: 3 });
  });

  it("exits 2 on a missing log or no input", () => {
    expect(runScript(S("query-count.mjs"), ["--log", "/no/such.log"]).code).toBe(2);
    expect(runScript(S("query-count.mjs"), []).code).toBe(2);
  });
});

describe("leak-and-timeout-scan", () => {
  const files = {
    "src/client.ts": [
      "await fetch(url);",
      "await fetch(url, { signal: AbortSignal.timeout(5000) });",
      "await axios.get(url);",
      "await axios.post(url, body, { timeout: 3000 });",
      "await got(url);",
      "const r = http.request(opts, cb);",
      "this.fetch(url);",
      "// await fetch(commented)",
    ].join("\n"),
    "src/log.ts": [
      "logger.info(req);",
      "logger.info({ userId: user.id }, 'Invalid password for user');",
      "console.log(err.config);",
      "log.debug('auth', req.headers.authorization);",
      "logger.error({ token: session.token });",
      "logger.info('done');",
    ].join("\n"),
    "app/x.py": "requests.get(url)\nrequests.post(url, timeout=5)\nlogging.info(request.headers)\n",
    "tests/x.test.ts": "await fetch(url);\n",
    "src/help.ts": "export const HELP = `fetch(url) then logger.info(req)`;\n",
  };

  it("finds outbound calls with no timeout and log calls that carry whole objects or secrets", () => {
    const root = project(files);
    const r = runScript(S("leak-and-timeout-scan.mjs"), [root]);
    expect(r.code).toBe(0);
    const got = r.json.findings.map((f: any) => `${f.kind} ${f.file}:${f.line}`);
    expect(got).toEqual([
      "timeout app/x.py:1",
      "leak app/x.py:3",
      "timeout src/client.ts:1",
      "timeout src/client.ts:3",
      "timeout src/client.ts:5",
      "timeout src/client.ts:6",
      "leak src/log.ts:1",
      "leak src/log.ts:3",
      "leak src/log.ts:4",
      "leak src/log.ts:5",
    ]);
    expect(r.json.summary).toEqual({ timeout: 5, leak: 5 });
  });

  it("with --base reports only added lines, and --include-tests scans test files too", () => {
    const root = project({ "src/a.ts": "await fetch(a);\n" });
    gitBase(root);
    write(root, { "src/a.ts": "await fetch(a);\nawait fetch(b);\n", "tests/a.test.ts": "await fetch(c);\n" });
    expect(runScript(S("leak-and-timeout-scan.mjs"), [root, "--base", "HEAD"]).json.findings.map((f: any) => `${f.file}:${f.line}`)).toEqual(["src/a.ts:2"]);
    expect(runScript(S("leak-and-timeout-scan.mjs"), [root, "--base", "HEAD", "--include-tests"]).json.findings).toHaveLength(2);
  });

  it("prints file:line findings with --text", () => {
    const root = project(files);
    expect(runScript(S("leak-and-timeout-scan.mjs"), [root, "--text"]).stdout).toMatch(/src\/client\.ts:1\s+timeout/);
  });
});

describe("backend scripts on realistic code", () => {
  it("route-inventory: an outbound client call shaped like a route is not a route", () => {
    const root = project({ "src/a.ts": "await axios.get('/remote/users', cfg);\nconst r = await apiClient.post('/remote/orders', body);\nrouter.get('/:id', auth, getUser);\n" });
    expect(runScript(S("route-inventory.mjs"), [root]).json.routes.map((x: any) => `${x.method} ${x.path} ${x.handler}`)).toEqual(["GET /:id getUser"]);
  });

  it("route-inventory: Nest @Controller({ path }) and a Next.js route group under app/", () => {
    const root = project({
      "src/admin.controller.ts": "@Controller({ path: 'admin' })\nexport class A {\n  @Delete(':id')\n  @UseGuards(G)\n  remove() {}\n}\n",
      "app/(shop)/api/cart/route.ts": "export const POST = async () => {};\n",
      "tests/cart.test.ts": "await request(app).post('/api/cart').expect(201);\n",
    });
    const routes = runScript(S("route-inventory.mjs"), [root]).json.routes.map((x: any) => `${x.method} ${x.path} ${x.handler} ${x.tests.length}`);
    expect(routes.sort()).toEqual(["DELETE /admin/:id remove 0", "POST /api/cart POST 1"]);
  });

  it("env-names: ?? defaults, multi-line destructuring and an example file with blanks, comments and export", () => {
    const root = project({
      ".env.example": "# Database\n\nDATABASE_URL=postgres://u:hunter2@h/db\n  # an indented comment\nexport JWT_SECRET=\"s3cr3t\"\nPORT=3000 # inline comment\n\n",
      ".env": "JWT_SECRET=realsecret123\n",
      "src/app.ts": "const port = process.env.PORT ?? '3000';\nconst { JWT_SECRET, DATABASE_URL } = process.env;\nconst {\n  REDIS_URL,\n  LOG_LEVEL = 'info',\n} = process.env;\n",
    });
    const r = runScript(S("env-names.mjs"), [root]);
    expect(r.code).toBe(0);
    expect(r.json.read.map((x: any) => x.name)).toEqual(["DATABASE_URL", "JWT_SECRET", "LOG_LEVEL", "PORT", "REDIS_URL"]);
    expect(r.json.readNotListed.map((x: any) => x.name)).toEqual(["LOG_LEVEL", "REDIS_URL"]);
    expect(r.json.listedNotRead).toEqual([]);
    for (const args of [[root], [root, "--text"]]) expect(runScript(S("env-names.mjs"), args).stdout).not.toMatch(/hunter2|s3cr3t|realsecret|3000/);
  });

  it("error-shape-probe: --contract follows a $ref to components/responses and takes its media type", () => {
    const root = project({
      "openapi.yaml": [
        "openapi: 3.0.3",
        "info:",
        "  title: \"T: x\"  # a comment",
        "paths:",
        "  /users/{id}:",
        "    get:",
        "      responses:",
        "        \"200\":",
        "          description: ok",
        "        \"404\":",
        "          $ref: '#/components/responses/NotFound'",
        "components:",
        "  responses:",
        "    NotFound:",
        "      description: nf",
        "      content:",
        "        application/problem+json:",
        "          schema:",
        "            $ref: \"#/components/schemas/Problem\"",
        "  schemas:",
        "    Problem:",
        "      type: object",
        "      required:",
        "        - type",
        "        - title",
        "      properties:",
        "        type: { type: string }",
        "        title:",
        "          type: string",
      ].join("\n"),
      "src/a.ts": "res.status(404).json({ type: 't', title: 'x' });\nres.status(400).json({ title: 'x', code: 1 });\n",
      "r.jsonl": JSON.stringify({ name: "stack", status: 500, headers: { "content-type": "application/problem+json; charset=utf-8" }, body: { type: "t", title: "Internal", detail: "TypeError: x\n    at getUser (/app/src/users.js:12:9)" } }) + "\n",
    });
    const r = runScript(S("error-shape-probe.mjs"), [root, "--contract", join(root, "openapi.yaml"), "--responses", join(root, "r.jsonl")]);
    expect(r.code).toBe(0);
    expect(r.json.shape).toMatchObject({ source: "contract openapi.yaml#/components/schemas/Problem", required: ["type", "title"], properties: ["type", "title"], mediaType: "application/problem+json" });
    expect(r.json.sites.map((s: any) => `${s.line}:${s.kind}:${s.missing.join(",")}:${s.extra.join(",")}`)).toEqual(["1:ok::", "2:mismatch:type:code"]);
    expect(r.json.responses[0]).toMatchObject({ mediaType: "application/problem+json", missing: [], kind: "mismatch" });
    expect(r.json.responses[0].leaks).toContain("stack trace");
  });

  it("query-count: measure counts only the queries of its own call, on a driver whose method is on the prototype", async () => {
    const mod = S("query-count.mjs");
    const root = project({
      "t.mjs": [
        `import { createCounter } from ${JSON.stringify(mod)};`,
        "class Pool { query(q) { return Promise.resolve(q); } }",
        "const pool = new Pool();",
        "const c = createCounter({ log: '' });",
        "const restore = c.wrap(pool, ['query']);",
        "await pool.query({ text: 'SELECT before' });",
        "const m = await c.measure(async () => { await pool.query('SELECT 1'); await pool.query('SELECT 2'); return 7; });",
        "restore();",
        "console.log(JSON.stringify({ measured: m.count, result: m.result, total: c.count, restored: !Object.hasOwn(pool, 'query') }));",
      ].join("\n"),
    });
    const r = runScript(join(root, "t.mjs"), [], root);
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ measured: 2, result: 7, total: 3, restored: true });
  });

  it("leak-and-timeout-scan: axios config forms, axios.defaults.timeout and a bare err", () => {
    const a = project({
      "src/a.ts": [
        "await axios({ url, method: 'get' });",
        "await axios({ url, timeout: 1000 });",
        "await axios.get(url, { timeout: 5000 });",
        "console.log(err);",
        "logger.info({ tokenCount });",
        "logger.info('reset', { password: p });",
      ].join("\n"),
    });
    expect(runScript(S("leak-and-timeout-scan.mjs"), [a]).json.findings.map((f: any) => `${f.kind} ${f.line}`)).toEqual(["timeout 1", "leak 6"]);
    const b = project({ "src/setup.ts": "axios.defaults.timeout = 5000;\n", "src/a.ts": "await axios.get(url);\nawait fetch(url);\n" });
    expect(runScript(S("leak-and-timeout-scan.mjs"), [b]).json.findings.map((f: any) => `${f.file}:${f.line}`)).toEqual(["src/a.ts:2"]);
  });

  it("every directory scan skips dependencies, build output and hidden folders", () => {
    const code = "app.get('/skip', h);\nprocess.env.SKIPPED;\nfetch(u);\nres.status(400).json({ e: 1 });\n";
    const root = project(Object.fromEntries(["node_modules/x/a.ts", "dist/a.js", "build/a.ts", ".next/a.js"].map((f) => [f, code])));
    expect(runScript(S("route-inventory.mjs"), [root]).json.routes).toEqual([]);
    expect(runScript(S("env-names.mjs"), [root]).json.read).toEqual([]);
    expect(runScript(S("leak-and-timeout-scan.mjs"), [root]).json.findings).toEqual([]);
    expect(runScript(S("error-shape-probe.mjs"), [root]).json.sites).toEqual([]);
  });

  it("every directory scan survives a symlink loop, a binary file, non-UTF-8 text and a syntax error", () => {
    const root = project({
      "src/ok.ts": "app.get('/ok', h);\nfetch(u);\nprocess.env.OK;\nres.status(400).json({ e: 1 });\n",
      "src/broken.ts": "app.get('/broken', (req, res) => { res.status(500).json({ error: 'x' ;\nfetch(u, {\nlogger.info(req\nconst x = `unterminated\n",
    });
    writeFileSync(join(root, "src/bin.js"), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256)));
    writeFileSync(join(root, "src/latin1.ts"), Buffer.from("const a = '\xff\xfe caf\xe9';\napp.get('/latin', h);\n", "latin1"));
    mkdirSync(join(root, "src/loop"));
    symlinkSync("..", join(root, "src/loop/up"));
    for (const name of ["route-inventory.mjs", "env-names.mjs", "error-shape-probe.mjs", "leak-and-timeout-scan.mjs"]) {
      const r = runScript(S(name), [root]);
      expect(r.code, `${name}: ${r.stderr}`).toBe(0);
      expect(r.json, name).not.toBeNull();
    }
    const paths = runScript(S("route-inventory.mjs"), [root]).json.routes.map((x: any) => x.path).sort();
    expect(paths).toEqual(expect.arrayContaining(["/latin", "/ok"]));
  });
});

describe("route-inventory: known misdetections", () => {
  it("lists a Fastify route declared with an options object (fastify.get('/x', { schema }, h))", () => {
    const root = project({ "src/f.ts": "fastify.get('/x', { schema }, handlerX);\nfastify.post('/y', { preHandler: [auth] }, async (req, reply) => {});\n" });
    expect(runScript(S("route-inventory.mjs"), [root]).json.routes.map((x: any) => `${x.method} ${x.path}`)).toEqual(["GET /x", "POST /y"]);
  });
});

describe("review fixes", () => {
  const tiny = { "src/a.ts": "app.get('/a', h);\n", "q.log": "SELECT a FROM b\n" };
  it.each([
    ["route-inventory.mjs", (r: string) => [r], ["tool", "schemaVersion", "root", "base", "routes", "skipped", "summary", "limits"]],
    ["env-names.mjs", (r: string) => [r], ["tool", "schemaVersion", "root", "base", "example", "configFiles", "read", "readNotListed", "listedNotRead", "readOutsideConfig", "dynamic", "skipped"]],
    ["error-shape-probe.mjs", (r: string) => [r], ["tool", "schemaVersion", "root", "base", "shape", "sites", "skipped", "summary"]],
    ["query-count.mjs", (r: string) => ["--log", join(r, "q.log")], ["tool", "schemaVersion", "log", "total", "sections"]],
    ["leak-and-timeout-scan.mjs", (r: string) => [r], ["tool", "schemaVersion", "root", "base", "findings", "skipped", "summary"]],
  ])("%s names the tool and schema version and keeps its top-level keys", (name, args, keys) => {
    const r = runScript(S(name), args(project(tiny)));
    expect(Object.keys(r.json)).toEqual(keys);
    expect(r.json).toMatchObject({ tool: name.replace(/\.mjs$/, ""), schemaVersion: 1 });
  });

  it("query-count --run never empties a file that is not a query log; without --log it writes a fresh temp file", () => {
    const mod = S("query-count.mjs");
    const root = project({
      "notes.txt": "keep me\n",
      "t.mjs": `import { createCounter } from ${JSON.stringify(mod)};\ncreateCounter().tick('SELECT a FROM b');\n`,
    });
    const refused = runScript(S("query-count.mjs"), ["--run", "node t.mjs", "--log", "notes.txt"], root);
    expect(refused.code).toBe(2);
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("keep me\n");
    const temp = runScript(S("query-count.mjs"), ["--run", "node t.mjs"], root);
    expect(temp.code).toBe(0);
    expect(temp.json.total).toBe(1);
    expect(temp.json.log.startsWith(root)).toBe(false);
    write(root, { "q.log": "aidw:query SELECT x FROM y\n" });
    expect(runScript(S("query-count.mjs"), ["--run", "node t.mjs", "--log", "q.log"], root).json.total).toBe(1);
  });

  it("query-count wrapStatements counts executions of prepared statements, not preparations", () => {
    const mod = S("query-count.mjs");
    const root = project({
      "t.mjs": [
        `import { createCounter } from ${JSON.stringify(mod)};`,
        "const db = { prepare(sql) { return { sql, run() { return 1; }, all() { return []; } }; } };",
        "const c = createCounter({ log: '' });",
        "const restore = c.wrapStatements(db);",
        "const st = db.prepare('SELECT * FROM t WHERE id = ?');",
        "db.prepare('SELECT unused FROM t');",
        "st.all(); st.all(); st.run();",
        "restore();",
        "console.log(JSON.stringify({ count: c.count, restored: !Object.hasOwn(db, 'prepare') || db.prepare.toString().includes('return { sql') }));",
      ].join("\n"),
    });
    expect(runScript(join(root, "t.mjs"), [], root).json).toEqual({ count: 3, restored: true });
  });

  it("query-count does not say 'does not grow' when it counted nothing", () => {
    const root = project({ "a.log": "server started\n", "b.log": "" });
    const r = runScript(S("query-count.mjs"), ["--one", join(root, "a.log"), "--many", join(root, "b.log")]);
    expect(r.json).toMatchObject({ one: 0, many: 0, grows: null });
    expect(r.json.note).toMatch(/no statements counted/);
    const t = runScript(S("query-count.mjs"), ["--one", join(root, "a.log"), "--many", join(root, "b.log"), "--text"]);
    expect(t.stdout).toMatch(/no statements counted/);
    expect(t.stdout).not.toMatch(/does not grow/);
  });

  it("query-count counts only lines with SQL context, and --timeout stops a hanging command", () => {
    const root = project({ "a.log": "UPDATE available for the package\nSelected 3 items\nUPDATE users SET a = 1\nSELECT id FROM users\nINSERT INTO t VALUES (1)\n" });
    expect(runScript(S("query-count.mjs"), ["--log", join(root, "a.log")]).json.total).toBe(3);
    const r = runScript(S("query-count.mjs"), ["--run", "node -e \"setTimeout(() => {}, 20000)\"", "--timeout", "1"], root);
    expect(r.code).toBe(0);
    expect(r.json.run.exitCode).toBeNull();
    expect(r.json.run.signal ?? r.json.run.error).toBeTruthy();
    expect(runScript(S("query-count.mjs"), ["--help"]).stdout).toMatch(/read-only/);
  });

  it("--base works with diff.noprefix and with non-ASCII and spaced file names", () => {
    const root = project({ "src/café.ts": "app.get('/a', a);\n" });
    gitBase(root);
    spawnSync("git", ["config", "diff.noprefix", "true"], { cwd: root });
    write(root, { "src/café.ts": "app.get('/a', a);\napp.post('/b', b);\n", "src/new é.ts": "app.put('/c', c);\n" });
    const r = runScript(S("route-inventory.mjs"), [root, "--base", "HEAD"]);
    expect(r.json.routes.map((x: any) => `${x.method} ${x.path} ${x.added}`).sort()).toEqual(["GET /a false", "POST /b true", "PUT /c true"]);
  });

  it("every directory scan skips large, minified and bundled files and public/static output, and reports them", () => {
    const root = project({
      "src/big.ts": "process.env.BIG;\nfetch(u);\napp.get('/big', h);\n" + "x".repeat(600 * 1024),
      "src/app.min.js": "process.env.MIN;\n",
      "src/app.bundle.js": "process.env.BUN;\n",
      "public/x.js": "process.env.PUB;\n",
      "static/y.js": "process.env.STA;\n",
      "src/ok.ts": "process.env.OK;\n",
    });
    expect(runScript(S("env-names.mjs"), [root]).json.read.map((x: any) => x.name)).toEqual(["OK"]);
    for (const name of ["route-inventory.mjs", "env-names.mjs", "error-shape-probe.mjs", "leak-and-timeout-scan.mjs"]) {
      const skipped = runScript(S(name), [root]).json.skipped.map((x: any) => x.file);
      expect(skipped, name).toEqual(expect.arrayContaining(["src/big.ts", "src/app.min.js", "src/app.bundle.js", "public/", "static/"]));
    }
  });

  it("an unreadable file is skipped and reported, not a failed scan", () => {
    const root = project({ "src/ok.ts": "process.env.OK;\n", "src/locked.ts": "process.env.LOCKED;\n" });
    chmodSync(join(root, "src/locked.ts"), 0o000);
    try {
      for (const name of ["route-inventory.mjs", "env-names.mjs", "error-shape-probe.mjs", "leak-and-timeout-scan.mjs"]) {
        const r = runScript(S(name), [root]);
        expect(r.code, name).toBe(0);
        expect(r.json.skipped.find((x: any) => x.file === "src/locked.ts")?.reason, name).toMatch(/unreadable/);
      }
    } finally {
      chmodSync(join(root, "src/locked.ts"), 0o644);
    }
  });

  it("env-names stays fast on many reads and reads process.env?.X", () => {
    const files: Record<string, string> = { "src/opt.ts": "const a = process.env?.OPTIONAL_CHAIN;\n" };
    for (let f = 0; f < 8; f++) files[`src/f${f}.ts`] = Array.from({ length: 20000 }, (_, i) => `process.env.V_${i % 500};`).join("\n");
    const root = project(files);
    const start = Date.now();
    const r = runScript(S("env-names.mjs"), [root]);
    expect(Date.now() - start).toBeLessThan(15000);
    expect(r.json.read).toHaveLength(501);
    expect(r.json.read.map((x: any) => x.name)).toContain("OPTIONAL_CHAIN");
  });

  it("route-inventory reads access-case assertions near the call of the route, not anywhere in the file", () => {
    const root = project({
      "src/a.ts": "router.get('/items/:id', getItem);\nrouter.get('/other/:id', getOther);\n",
      "tests/a.test.ts": "it('item', async () => { await request(app).get('/items/' + id).expect(401); });\n" + "\n".repeat(40) + "it('other', async () => { const res = await request(app).get(`/other/${id}`); expect(res.status).toBe(404); expect(res.status).toBe(200); });\n",
      "tests/test_x.py": "def test_x(client):\n    r = client.get(f\"/other/{oid}\")\n    assert r.status_code == 401\n",
    });
    const routes = runScript(S("route-inventory.mjs"), [root]).json.routes;
    expect(routes.find((x: any) => x.path === "/items/:id").accessCases).toEqual({ noIdentity: true, otherUser: false, owner: false });
    expect(routes.find((x: any) => x.path === "/other/:id").accessCases).toEqual({ noIdentity: true, otherUser: true, owner: true });
  });

  it("route-inventory reads a status passed to an expect…/assert… helper, as a number or a constant", () => {
    const root = project({
      "src/a.ts": "router.post('/api/projects/:projectId/tasks', create);\nrouter.get('/notes/:id', getNote);\nrouter.get('/docs/:id', getDoc);\nrouter.get('/teams/:id', getTeam);\n",
      "tests/a.test.ts":
        "const problem = (status, type) => ({ status, type });\n" +
        "const UNAUTH = problem(401, 'unauthenticated');\n" +
        "const NOT_FOUND = { status: 404, type: 'project-not-found' };\n" +
        "const LIMIT = 10;\n" +
        "\n".repeat(40) +
        "it('no session', async () => { const res = await http.post(`/api/projects/${p.id}/tasks`); expectProblem(res, UNAUTH); });\n" +
        "it('other team', async () => { const res = await http.post(`/api/projects/${q.id}/tasks`); expectProblem(res, NOT_FOUND); });\n" +
        "it('member', async () => { const res = await http.post(`/api/projects/${p.id}/tasks`); assertStatus(res, 201); });\n" +
        "\n".repeat(40) +
        "it('note', async () => { const res = await http.get(`/notes/${n.id}`); expectPage(res, LIMIT); expectProblem(res, 401, 'x'); });\n" +
        "\n".repeat(40) +
        "it('doc', async () => { const res = await http.get(`/docs/${d.id}`); expectProblem(res, problem(401, 'u')); expectProblem(res, problem(404, 'n')); expectOk(res, build(LIMIT)); });\n" +
        "const team = (id) => http.get(`/teams/${id}`);\n" +
        "\n".repeat(40) +
        "it('team none', async () => { const res = await team(t1.id); expect(res.status).toBe(401); });\n" +
        "\n".repeat(40) +
        "it('team other', async () => { const res = await team(t2.id); expect(res.status).toBe(404); });\n" +
        "\n".repeat(40) +
        "it('team owner', async () => { const res = await team(t1.id); expect(res.status).toBe(200); });\n",
    });
    const routes = runScript(S("route-inventory.mjs"), [root]).json.routes;
    expect(routes.find((x: any) => x.path === "/api/projects/:projectId/tasks").accessCases).toEqual({ noIdentity: true, otherUser: true, owner: true });
    // A constant that is not a status (LIMIT = 10) counts for nothing; the literal 401 does.
    expect(routes.find((x: any) => x.path === "/notes/:id").accessCases).toEqual({ noIdentity: true, otherUser: false, owner: false });
    // A status built in the argument (problem(401, …)) counts; build(LIMIT) does not.
    expect(routes.find((x: any) => x.path === "/teams/:id").accessCases).toEqual({ noIdentity: true, otherUser: true, owner: true });
    expect(routes.find((x: any) => x.path === "/docs/:id").accessCases).toEqual({ noIdentity: true, otherUser: true, owner: false });
  });

  it("error-shape-probe: header chains, paths relative to [dir], --base, and fewer false leak markers", () => {
    const root = project({
      "openapi.yaml": "components:\n  schemas:\n    ApiError:\n      required: [code]\n",
      "src/a.ts": "res.status(404).type('application/problem+json').json({ code: 'x' });\nres.status(400).set('X-A', f(1)).json({ nope: 1 });\n",
      "r.json": JSON.stringify([{ status: 404, headers: { "content-type": "application/json" }, body: { code: "x", detail: "Try again at noon", instance: "/orders/5/items", hint: "see /tmp" } }]),
    });
    const r = runScript(S("error-shape-probe.mjs"), [root, "--contract", "openapi.yaml", "--responses", "r.json"]);
    expect(r.code).toBe(0);
    expect(r.json.shape.required).toEqual(["code"]);
    expect(r.json.sites.map((s: any) => `${s.line}:${s.status}:${s.kind}`)).toEqual(["1:404:ok", "2:400:mismatch"]);
    expect(r.json.responses[0].leaks).toEqual([]);
    gitBase(root);
    write(root, { "src/a.ts": readFileSync(join(root, "src/a.ts"), "utf8") + "res.status(500).json({ boom: 1 });\n" });
    expect(runScript(S("error-shape-probe.mjs"), [root, "--contract", "openapi.yaml", "--base", "HEAD"]).json.sites.map((s: any) => s.line)).toEqual([3]);
    expect(runScript(S("error-shape-probe.mjs"), ["--help"]).stdout).toMatch(/relative to \[dir\]/);
  });

  it("leak-and-timeout-scan never echoes a literal secret and catches camelCase compounds", () => {
    const root = project({ "src/a.ts": "logger.info('key sk_live_ABC123', token);\nlogger.info({ resetToken });\nlog.debug(userPassword);\nlogger.info({ tokenCount });\n" });
    const r = runScript(S("leak-and-timeout-scan.mjs"), [root]);
    expect(r.json.findings.map((f: any) => f.line)).toEqual([1, 2, 3]);
    for (const out of [r.stdout, runScript(S("leak-and-timeout-scan.mjs"), [root, "--text"]).stdout]) expect(out).not.toMatch(/sk_live/);
  });
});
