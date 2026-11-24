import { readdirSync, readFileSync } from "node:fs";
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
