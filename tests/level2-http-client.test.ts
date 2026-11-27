import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureFixturePackages, fixtureCacheRoot, fixturesDir, gradingSandbox, removeTree, runCheck, sandboxProfile, sessionSettings } from "../src/evallevel2.js";

/**
 * The backend-api fixture's in-process HTTP client (evals/fixtures/backend-api/tests/http.ts), which the fixture's
 * tests use through `t.http()`: its supertest-style API, how it compares with supertest where tests commonly rely on
 * it, and that it needs no network (it still works inside the grading sandbox, which denies all of it). Also: the
 * level 2 session settings no longer allow local binding, and the grading sandbox denies localhost over every family.
 *
 * Express comes from the fixture's packages in the cache (AIDW_FIXTURE_CACHE); supertest, which the fixture no longer
 * depends on, from any cached package set of the fixture that still holds it. Tests that need them skip without them.
 */
const repo = join(__dirname, "..");
const plugin = join(repo, "plugins", "aidw");
const fixture = join(fixturesDir(plugin), "backend-api");
const clientFile = join(fixture, "tests", "http.ts");

type Client = {
  get(u: string): Req;
  post(u: string): Req;
  put(u: string): Req;
  patch(u: string): Req;
  delete(u: string): Req;
  del(u: string): Req;
  head(u: string): Req;
  options(u: string): Req;
  close(): void;
};
type Res = { status: number; statusCode: number; headers: Record<string, string | string[] | undefined>; header: Record<string, unknown>; type: string; body: any; text: string; ok: boolean };
type Req = PromiseLike<Res> & {
  set(n: string | Record<string, string>, v?: string): Req;
  type(t: string): Req;
  query(q: string | Record<string, string | number | boolean>): Req;
  send(d: unknown): Req;
  expect(a: unknown, b?: unknown): Req;
  catch(f: (e: unknown) => unknown): Promise<unknown>;
  finally(f: () => void): Promise<Res>;
};
let http: (h: RequestListener) => Client;

let nodeModules: string | null = null;
try {
  nodeModules = ensureFixturePackages(fixture, "backend-api", process.env, () => {
    throw new Error("not installed");
  }).nodeModules;
} catch {
  nodeModules = null;
}
const fromCache = nodeModules ? createRequire(join(nodeModules, "noop.js")) : null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const express: any = fromCache ? fromCache("express") : null;

/** supertest from a cached package set of the fixture that still has it (the fixture dropped it). */
function findSupertest(): ((app: unknown) => any) | null {
  const root = fixtureCacheRoot(process.env);
  if (!existsSync(root)) return null;
  for (const e of readdirSync(root).filter((d) => d.startsWith("backend-api-") && !d.includes(".tmp-"))) {
    const nm = join(root, e, "node_modules");
    if (existsSync(join(nm, "supertest", "package.json"))) return createRequire(join(nm, "noop.js"))("supertest");
  }
  return null;
}
const supertest = findSupertest();

const temps: string[] = [];
afterAll(() => temps.forEach(removeTree));

beforeAll(async () => {
  http = ((await import(clientFile)) as { http: typeof http }).http;
});

/** A plain handler that answers with what it got. */
const echo: RequestListener = (q: IncomingMessage, r: ServerResponse) => {
  const chunks: Buffer[] = [];
  q.on("data", (c: Buffer) => chunks.push(c));
  q.on("end", () => {
    const raw = Buffer.concat(chunks);
    r.setHeader("content-type", "application/json");
    r.end(JSON.stringify({ method: q.method, url: q.url, headers: q.headers, body: raw.toString("utf8"), bytes: raw.length, hex: raw.subarray(0, 16).toString("hex") }));
  });
};

describe("the in-process client: requests", () => {
  it("sends every verb, del() as DELETE", async () => {
    const c = http(echo);
    for (const [fn, m] of [["get", "GET"], ["post", "POST"], ["put", "PUT"], ["patch", "PATCH"], ["delete", "DELETE"], ["del", "DELETE"], ["options", "OPTIONS"]] as const) {
      const res = await c[fn]("/x");
      expect(res.status).toBe(200);
      expect(res.body.method).toBe(m);
    }
    const seen: string[] = [];
    const head = await http((q, r) => {
      seen.push(q.method!);
      r.end();
    }).head("/x");
    expect(head.status).toBe(200);
    expect(seen).toEqual(["HEAD"]);
  });

  it(".set takes a pair or an object; names are case-insensitive and a later value wins", async () => {
    const res = await http(echo).get("/").set("X-One", "1").set({ "X-Two": "2", Authorization: "Bearer a" }).set("authorization", "Bearer b");
    expect(res.body.headers["x-one"]).toBe("1");
    expect(res.body.headers["x-two"]).toBe("2");
    expect(res.body.headers.authorization).toBe("Bearer b");
  });

  it(".send merges objects of several calls and sends them as JSON with the right length", async () => {
    const res = await http(echo).post("/").send({ a: 1, b: 1 }).send({ b: 2, c: 3 });
    expect(JSON.parse(res.body.body)).toEqual({ a: 1, b: 2, c: 3 });
    expect(res.body.headers["content-type"]).toBe("application/json");
    expect(res.body.headers["content-length"]).toBe(String(Buffer.byteLength(res.body.body)));
  });

  it(".send sends an array as JSON, and multibyte JSON with its byte length", async () => {
    const arr = await http(echo).post("/").send([1, { x: "y" }]);
    expect(JSON.parse(arr.body.body)).toEqual([1, { x: "y" }]);
    const mb = await http(echo).post("/").send({ name: "Tuấn ✓" });
    expect(JSON.parse(mb.body.body)).toEqual({ name: "Tuấn ✓" });
    expect(mb.body.headers["content-length"]).toBe(String(mb.body.bytes));
  });

  it(".send of a string goes as it is, form-encoded unless a type is set; strings of several calls are joined", async () => {
    const form = await http(echo).post("/").send("a=1").send("&b=2");
    expect(form.body.body).toBe("a=1&b=2");
    expect(form.body.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const typed = await http(echo).post("/").set("Content-Type", "text/csv").send("x,y");
    expect(typed.body.headers["content-type"]).toBe("text/csv");
    expect(typed.body.body).toBe("x,y");
  });

  it(".send of a Buffer sends its bytes unchanged, with no Content-Type of its own", async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0xfe]);
    const res = await http(echo).post("/").send(bytes);
    expect(res.body.hex).toBe("00ff1080fe");
    expect(res.body.bytes).toBe(5);
    expect(res.body.headers["content-type"]).toBeUndefined();
    const typed = await http(echo).post("/").type("application/octet-stream").send(bytes);
    expect(typed.body.headers["content-type"]).toBe("application/octet-stream");
  });

  it("sends no body and no Content-Length when nothing is sent", async () => {
    const res = await http(echo).get("/");
    expect(res.body.bytes).toBe(0);
    expect(res.body.headers["content-length"]).toBeUndefined();
    expect(res.body.headers["content-type"]).toBeUndefined();
  });

  it(".send(null) sends an empty body; an object after a string is form-encoded under the string's type, as supertest does", async () => {
    const none = await http(echo).post("/").send(null);
    expect(none.body.bytes).toBe(0);
    expect(none.body.headers["content-length"]).toBe("0");
    expect(none.body.headers["content-type"]).toBeUndefined();
    const mixed = await http(echo).post("/").send("a=1").send({ b: 2, c: "x y" });
    expect(mixed.body.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(mixed.body.body).toBe("b=2&c=x+y");
  });

  it("looks to the app like a request from 127.0.0.1 with Host 127.0.0.1", async () => {
    const res = await http((q, r) => r.end(JSON.stringify({ ra: q.socket.remoteAddress, fam: q.socket.remoteFamily, host: q.headers.host }))).get("/");
    expect(JSON.parse(res.text)).toEqual({ ra: "127.0.0.1", fam: "IPv4", host: "127.0.0.1" });
  });

  it(".query takes an object or a string, adds to a query in the URL, and encodes values", async () => {
    const res = await http(echo).get("/list?x=1").query({ y: 2, ok: true }).query("z=3&z=4").query({ q: "a b&c=d/é" });
    const u = new URL(res.body.url, "http://h");
    expect(u.pathname).toBe("/list");
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.searchParams.get("y")).toBe("2");
    expect(u.searchParams.get("ok")).toBe("true");
    expect(u.searchParams.getAll("z")).toEqual(["3", "4"]);
    expect(u.searchParams.get("q")).toBe("a b&c=d/é");
    const plain = await http(echo).get("/list").query({ a: "1" });
    expect(plain.body.url).toBe("/list?a=1");
  });

  it(".type takes json, form, text or a media type, and a type set before .send is kept", async () => {
    const got = async (t: string) => (await http(echo).post("/").type(t).send("x")).body.headers["content-type"];
    expect(await got("json")).toBe("application/json");
    expect(await got("form")).toBe("application/x-www-form-urlencoded");
    expect(await got("text")).toBe("text/plain");
    expect(await got("application/vnd.api+json")).toBe("application/vnd.api+json");
    const obj = await http(echo).post("/").type("application/merge-patch+json").send({ a: 1 });
    expect(obj.body.headers["content-type"]).toBe("application/merge-patch+json");
  });

  it("is awaited once: awaiting twice sends one request; .catch and .finally work", async () => {
    let n = 0;
    const c = http((_q, r) => {
      n++;
      r.end("ok");
    });
    const req = c.get("/");
    const [a, b] = await Promise.all([req, req]);
    expect(a).toBe(b);
    expect(n).toBe(1);
    let done = false;
    await c.get("/").finally(() => (done = true));
    expect(done).toBe(true);
    const caught = await c.get("/").expect(500).catch((e) => (e as Error).message);
    expect(caught).toMatch(/expected 500, got 200/);
  });
});

describe("the in-process client: .expect", () => {
  const app: RequestListener = (q, r) => {
    if (q.url === "/json") {
      r.writeHead(201, { "content-type": "application/json; charset=utf-8", "x-id": "abc-123" });
      r.end(JSON.stringify({ id: 7, tags: ["a"] }));
    } else {
      r.writeHead(200, { "content-type": "text/plain" });
      r.end("hello world");
    }
  };

  it("checks a status", async () => {
    await expect(http(app).get("/json").expect(201)).resolves.toMatchObject({ status: 201 });
    await expect(http(app).get("/json").expect(200)).rejects.toThrow(/expected 200, got 201: \{"id":7/);
  });

  it("checks a status and a body: an object deeply, a string exactly, a RegExp against the text", async () => {
    await http(app).get("/json").expect(201, { id: 7, tags: ["a"] });
    await expect(http(app).get("/json").expect(201, { id: 7 })).rejects.toThrow();
    await http(app).get("/text").expect(200, "hello world");
    await expect(http(app).get("/text").expect(200, "hello")).rejects.toThrow(/expected body "hello"/);
    await http(app).get("/text").expect(200, /wor/);
    await expect(http(app).get("/text").expect(200, /^world/)).rejects.toThrow(/to match/);
  });

  it("checks a header: exact, by RegExp, case-insensitive name, and fails when it is missing", async () => {
    await http(app).get("/json").expect("Content-Type", /json/).expect("x-id", "abc-123").expect("X-ID", /^abc/);
    await expect(http(app).get("/json").expect("x-id", "abc")).rejects.toThrow(/expected header x-id "abc", got "abc-123"/);
    await expect(http(app).get("/json").expect("x-missing", /./)).rejects.toThrow(/expected header x-missing, got none/);
  });

  it("runs a function with the response; its error rejects the request", async () => {
    let seen: Res | undefined;
    const res = await http(app).get("/json").expect((r: Res) => (seen = r));
    expect(seen).toBe(res);
    await expect(
      http(app)
        .get("/json")
        .expect((r: Res) => {
          if (r.body.id !== 8) throw new Error("wrong id");
        }),
    ).rejects.toThrow("wrong id");
  });

  it("runs every expectation in order; the first that fails rejects", async () => {
    const order: number[] = [];
    await expect(
      http(app)
        .get("/json")
        .expect(() => order.push(1))
        .expect(404)
        .expect(() => order.push(3)),
    ).rejects.toThrow(/expected 404/);
    expect(order).toEqual([1]);
  });

  // supertest: .expect(body) with one argument checks the body (a string exactly, a RegExp, an object deeply).
  it(".expect with only a body string checks the body, as supertest does (not a header named by the body)", async () => {
    await expect(http(app).get("/text").expect("hello world")).resolves.toMatchObject({ text: "hello world" });
  });

  it(".expect with only a RegExp checks the body text, as supertest does", async () => {
    await expect(Promise.resolve().then(() => http(app).get("/text").expect(/hello/))).resolves.toMatchObject({ status: 200 });
  });

  it(".expect with only an object checks the JSON body, as supertest does", async () => {
    await expect(Promise.resolve().then(() => http(app).get("/json").expect({ id: 7, tags: ["a"] }))).resolves.toMatchObject({ status: 201 });
  });
});

describe("the in-process client: responses", () => {
  it("parses JSON of any +json type and with parameters; other types give body {} and the text", async () => {
    const reply =
      (type: string, text: string, status = 200): RequestListener =>
      (_q, r) => {
        r.writeHead(status, { "content-type": type });
        r.end(text);
      };
    const problem = await http(reply("application/problem+json", '{"title":"Not found"}', 404)).get("/");
    expect(problem).toMatchObject({ status: 404, statusCode: 404, ok: false, type: "application/problem+json", body: { title: "Not found" } });
    const cs = await http(reply("Application/JSON; charset=utf-8", "[1,2]")).get("/");
    expect(cs.type).toBe("application/json");
    expect(cs.body).toEqual([1, 2]);
    const html = await http(reply("text/html; charset=utf-8", "<p>hi</p>")).get("/");
    expect(html).toMatchObject({ type: "text/html", body: {}, text: "<p>hi</p>", ok: true });
    const none = await http((_q, r) => r.end("raw")).get("/");
    expect(none).toMatchObject({ type: "", body: {}, text: "raw" });
    expect(none.header).toBe(none.headers);
  });

  it("rejects a JSON response that is not JSON", async () => {
    await expect(
      http((_q, r) => {
        r.setHeader("content-type", "application/json");
        r.end("{nope");
      }).get("/"),
    ).rejects.toThrow(/application\/json but not JSON/);
  });

  it("gives an empty JSON body as {} and text ''; a 204 has no body; HEAD has headers and no body", async () => {
    const empty = await http((_q, r) => {
      r.setHeader("content-type", "application/json");
      r.end();
    }).get("/");
    expect(empty).toMatchObject({ status: 200, body: {}, text: "" });
    const app: RequestListener = (q, r) => {
      if (q.url === "/gone") {
        r.statusCode = 204;
        r.end();
        return;
      }
      r.writeHead(200, { "content-type": "application/json", "content-length": "13" });
      r.end(q.method === "HEAD" ? undefined : '{"big":"one"}');
    };
    const c = http(app);
    const gone = await c.delete("/gone").expect(204);
    expect(gone).toMatchObject({ status: 204, ok: true, body: {}, text: "" });
    const head = await c.head("/thing").expect(200).expect("content-length", "13");
    expect(head).toMatchObject({ body: {}, text: "" });
  });

  it("carries large bodies both ways (8 MB)", async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 0x61);
    big[big.length - 1] = 0x7a;
    const res = await http(echo).post("/").type("application/octet-stream").send(big);
    expect(res.body.bytes).toBe(big.length);
    const down = await http((_q, r) => {
      r.setHeader("content-type", "text/plain");
      r.end(big);
    }).get("/");
    expect(down.text.length).toBe(big.length);
    expect(down.text.endsWith("az")).toBe(true);
    const json = { items: Array.from({ length: 50_000 }, (_, i) => ({ i, name: `item ${i}` })) };
    const back = await http((_q, r) => {
      r.setHeader("content-type", "application/json");
      r.end(JSON.stringify(json));
    }).get("/");
    expect(back.body.items).toHaveLength(50_000);
    expect(back.body.items[49_999]).toEqual({ i: 49_999, name: "item 49999" });
  });

  it("serves a chunked, streamed response", async () => {
    const res = await http((_q, r) => {
      r.setHeader("content-type", "text/plain");
      let n = 0;
      const tick = () => (n < 5 ? (r.write(`${n++};`), setImmediate(tick)) : r.end("end"));
      tick();
    }).get("/");
    expect(res.headers["transfer-encoding"]).toBe("chunked");
    expect(res.text).toBe("0;1;2;3;4;end");
  });

  it("serves 100 concurrent requests on one client, each with its own answer", async () => {
    const c = http((q, r) => {
      const id = new URL(q.url!, "http://h").searchParams.get("id");
      setTimeout(() => {
        r.setHeader("content-type", "application/json");
        r.end(JSON.stringify({ id }));
      }, Math.random() * 20);
    });
    const all = await Promise.all(Array.from({ length: 100 }, (_, i) => c.post("/").query({ id: i }).send({ i })));
    expect(all.map((r) => r.body.id)).toEqual(Array.from({ length: 100 }, (_, i) => String(i)));
  });

  it("opens a connection per request and closes it, even when a test asks for keep-alive", async () => {
    const conns = new Set<unknown>();
    const c = http((q, r) => {
      conns.add(q.socket);
      r.setHeader("content-type", "application/json");
      r.end(JSON.stringify({ connection: q.headers.connection }));
    });
    for (let i = 0; i < 20; i++) {
      const res = await c.get("/").set("Connection", "keep-alive");
      expect(res.body.connection).toBe("close");
      expect(res.headers.connection).toBe("close");
    }
    expect(conns.size).toBe(20);
  });

  it("a hanging route does not hold up other requests on the same client", async () => {
    const c = http((q, r) => {
      if (q.url === "/hang") return;
      r.end("ok");
    });
    void c
      .get("/hang")
      .then(() => {}, () => {});
    await expect(c.get("/fast")).resolves.toMatchObject({ text: "ok" });
    c.close();
  });

  it("close() with nothing in flight does nothing and the client still works after it", async () => {
    const c = http((_q, r) => r.end("ok"));
    expect(() => c.close()).not.toThrow();
    expect((await c.get("/")).text).toBe("ok");
    c.close();
  });

  // tests/helpers.ts: close() "Ends any request still being served" and runs in afterEach, so that a test that timed out
  // on a route that never answers does not leave its request pending.
  it("close() ends a request still being served: a hanging route's request settles", async () => {
    const c = http(() => {});
    const pending = c.get("/hang").then(
      () => "resolved",
      () => "rejected",
    );
    await new Promise((r) => setTimeout(r, 50));
    c.close();
    const got = await Promise.race([pending, new Promise((r) => setTimeout(() => r("still pending"), 1000))]);
    expect(got).not.toBe("still pending");
  });
});

describe.skipIf(!express)("the in-process client with an Express app (the fixture's packages)", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.get("/sync-error", () => {
      throw new Error("boom");
    });
    a.get("/async-error", async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error("later boom");
    });
    a.post("/json", (q: { body: unknown }, r: { status(n: number): { json(b: unknown): void } }) => r.status(201).json({ got: q.body }));
    a.get("/redirect", (_q: unknown, r: { redirect(u: string): void }) => r.redirect("/elsewhere"));
    return a;
  };

  it("an error thrown in a route, sync or async, gives a 500", async () => {
    const c = http(app());
    const sync = await c.get("/sync-error");
    expect(sync.status).toBe(500);
    expect(sync.ok).toBe(false);
    expect(sync.type).toBe("text/html");
    const later = await c.get("/async-error");
    expect(later.status).toBe(500);
  });

  it("express.json() reads the body the client sends; a malformed one is a 400", async () => {
    const c = http(app());
    await c.post("/json").send({ a: [1, 2] }).expect(201, { got: { a: [1, 2] } });
    const bad = await c.post("/json").type("json").send("{bad");
    expect(bad.status).toBe(400);
  });

  it("does not follow a redirect and gives an unknown route Express's 404", async () => {
    const c = http(app());
    await c.get("/redirect").expect(302).expect("location", "/elsewhere");
    const nf = await c.get("/nope");
    expect(nf.status).toBe(404);
    expect(nf.text).toMatch(/Cannot GET \/nope/);
  });
});

/** Can this process bind a local port? supertest needs one (not inside a Claude Code sandbox). */
async function canBind(): Promise<boolean> {
  const s = createNetServer();
  try {
    s.listen(0, "127.0.0.1");
    await Promise.race([once(s, "listening"), once(s, "error").then(([e]) => Promise.reject(e))]);
    return true;
  } catch {
    return false;
  } finally {
    s.close();
  }
}

describe.skipIf(!express || !supertest)("the in-process client against supertest, on the same Express app", () => {
  let bindable = false;
  beforeAll(async () => {
    bindable = await canBind();
  });
  const listening: { close(): void }[] = [];
  afterAll(() => listening.forEach((s) => s.close()));
  /**
   * supertest on the app served on 127.0.0.1. Given the app itself, supertest listens on every interface and connects
   * to 127.0.0.1, which now and then reaches another process's server on 127.0.0.1 with the same port (a 404 from
   * nowhere): the flake an in-process client does not have.
   */
  const theirClient = async (a: any) => {
    const s = a.listen(0, "127.0.0.1");
    await once(s, "listening");
    listening.push(s);
    return supertest!(s);
  };
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use(express.urlencoded({ extended: false }));
    a.use(express.raw({ type: "application/octet-stream" }));
    a.all("/echo", (q: any, r: any) =>
      r.json({ method: q.method, body: Buffer.isBuffer(q.body) ? q.body.toString("hex") : (q.body ?? null), query: q.query, type: q.headers["content-type"] ?? null, auth: q.headers.authorization ?? null, team: q.headers["x-team-id"] ?? null }),
    );
    a.get("/text", (_q: any, r: any) => r.type("text").send("plain text"));
    a.get("/html", (_q: any, r: any) => r.send("<p>html</p>"));
    a.get("/problem", (_q: any, r: any) => r.status(422).type("application/problem+json").send(JSON.stringify({ title: "Invalid", errors: [{ path: "title" }] })));
    a.get("/empty", (_q: any, r: any) => r.status(204).end());
    a.get("/boom", () => {
      throw new Error("boom");
    });
    a.get("/redirect", (_q: any, r: any) => r.redirect(301, "/text"));
    a.get("/cookie", (_q: any, r: any) => r.cookie("sid", "abc", { httpOnly: true }).json({}));
    return a;
  };
  /** What tests commonly read off a response. */
  const view = (r: Res, head = false) => ({
    status: r.status,
    statusCode: r.statusCode,
    ok: r.ok,
    type: r.type,
    body: r.body,
    ...(head ? {} : { text: r.text }),
    contentType: r.headers["content-type"],
    location: r.headers.location,
    setCookie: r.headers["set-cookie"],
  });
  const cases: [string, (c: any) => any, boolean?][] = [
    ["a JSON POST with headers by pair and object", (c) => c.post("/echo").set("Authorization", "Bearer t").set({ "x-team-id": "T1" }).send({ title: "x", n: 1 })],
    ["merged .send objects", (c) => c.patch("/echo").send({ a: 1 }).send({ b: 2 })],
    ["a form string", (c) => c.post("/echo").send("a=1&b=two")],
    ["a JSON string with type json", (c) => c.put("/echo").type("json").send('{"x":[1]}')],
    ["a Buffer with type octet-stream", (c) => c.post("/echo").type("application/octet-stream").send(Buffer.from([1, 2, 255]))],
    // (supertest puts .query strings before .query objects; tests rarely depend on that order)
    ["a query object added to a URL query", (c) => c.get("/echo?x=1").query({ y: "a b", n: 2 })],
    ["a query string", (c) => c.get("/echo").query("z=3&z=4")],
    ["DELETE via del", (c) => c.del("/echo")],
    ["OPTIONS", (c) => c.options("/echo")],
    ["a text response", (c) => c.get("/text")],
    ["an HTML response", (c) => c.get("/html")],
    ["problem+json", (c) => c.get("/problem")],
    ["a 204", (c) => c.get("/empty")],
    ["a 500 from a thrown error", (c) => c.get("/boom")],
    ["an unknown route", (c) => c.get("/nope")],
    ["a redirect, not followed", (c) => c.get("/redirect")],
    ["a Set-Cookie header", (c) => c.get("/cookie")],
    ["HEAD", (c) => c.head("/text"), true],
  ];
  for (const [name, build, head] of cases) {
    it(`same response as supertest: ${name}`, async (ctx) => {
      if (!bindable) ctx.skip();
      const a = app();
      const ours = (await build(http(a))) as Res;
      const theirs = (await build(await theirClient(a))) as Res;
      expect(view(ours, head)).toEqual(view(theirs, head));
    });
  }

  it("same .expect outcomes as supertest for status, status+body, header and function forms", async (ctx) => {
    if (!bindable) ctx.skip();
    const a = app();
    const outcome = (p: PromiseLike<unknown>) =>
      Promise.resolve(p).then(
        () => "pass",
        () => "fail",
      );
    const forms: ((r: any) => any)[] = [
      (r) => r.get("/text").expect(200),
      (r) => r.get("/text").expect(201),
      (r) => r.get("/text").expect(200, "plain text"),
      (r) => r.get("/text").expect(200, "plain"),
      (r) => r.get("/text").expect(200, /plain/),
      (r) => r.post("/echo").send({ a: 1 }).expect(200, { method: "POST", body: { a: 1 }, query: {}, type: "application/json", auth: null, team: null }),
      (r) => r.post("/echo").send({ a: 1 }).expect(200, { method: "POST" }),
      (r) => r.get("/text").expect("Content-Type", /text\/plain/),
      (r) => r.get("/text").expect("content-type", "text/plain; charset=utf-8"),
      (r) => r.get("/text").expect("Content-Type", "text/plain"),
      (r) => r.get("/text").expect("X-None", /./),
      (r) => r.get("/text").expect((res: Res) => expect(res.text).toBe("plain text")),
      (r) => r.get("/text").expect((res: Res) => expect(res.text).toBe("nope")),
    ];
    const ours = await Promise.all(forms.map((f) => outcome(f(http(a)))));
    const st = await theirClient(a);
    const theirs = await Promise.all(forms.map((f) => outcome(f(st))));
    expect(ours).toEqual(theirs);
  });
});

describe("the level 2 session settings and the grading sandbox's network", () => {
  it("the session settings allow no local binding, in the source and in the built bin", () => {
    const st = sessionSettings({ pluginRoot: "/p/aidw", project: "/w/copy" }) as { sandbox: { network: Record<string, unknown> } };
    expect(JSON.stringify(st)).not.toMatch(/allowLocalBinding|allowAllUnixSockets|allowUnixSockets/);
    expect(st.sandbox.network).toEqual({ allowedDomains: [] });
    for (const bare of [true, false]) expect(JSON.stringify(sessionSettings({ pluginRoot: "/p", project: "/w", bare }))).not.toMatch(/allowLocalBinding/);
    const bin = join(plugin, "bin", "aidw");
    if (existsSync(bin)) expect(readFileSync(bin, "utf8")).not.toMatch(/allowLocalBinding\s*:\s*(true|false|!0|!1)/); // a comment may still name it
  });

  it("the macOS profile denies all network, with or without a write scope, and names no localhost", () => {
    for (const p of [sandboxProfile(), sandboxProfile({ project: tmpdir(), scratch: tmpdir() })]) {
      expect(p).toContain("(deny network*)");
      expect(p).not.toMatch(/localhost|allow network/);
    }
  });

  const sb = gradingSandbox(process.env);
  const nodeExit = (js: string) => `node -e '${js}'`;
  it.skipIf(sb.how === "none")("denies localhost over IPv6 and a Unix socket served outside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aidw-l2-net-"));
    temps.push(dir);
    const servers: NetServer[] = [];
    try {
      const v6 = createNetServer((s) => s.end()).listen(0, "::1");
      servers.push(v6);
      let v6port: number | null = null;
      try {
        await Promise.race([once(v6, "listening"), once(v6, "error").then(([e]) => Promise.reject(e))]);
        v6port = (v6.address() as { port: number }).port;
      } catch {
        v6port = null; // no IPv6 loopback here
      }
      if (v6port) {
        const run = nodeExit(`require("net").connect(${v6port},"::1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(7))`);
        expect(runCheck({ name: "v6", run, expect: { exit: 7 } }, tmpdir(), process.env, sb)).toEqual({ pass: true, why: "" });
      }
      const sock = join(dir, "s.sock");
      const unix = createNetServer((s) => s.end()).listen(sock);
      servers.push(unix);
      await once(unix, "listening");
      const run = nodeExit(`require("net").connect(${JSON.stringify(sock)}).on("connect",()=>process.exit(0)).on("error",()=>process.exit(7))`);
      // control: outside the sandbox the same command connects
      expect(runCheck({ name: "unix-control", run, expect: { exit: 0 } }, tmpdir(), process.env)).toEqual({ pass: true, why: "" });
      expect(runCheck({ name: "unix", run, expect: { exit: 7 } }, tmpdir(), process.env, sb)).toEqual({ pass: true, why: "" });
    } finally {
      servers.forEach((s) => s.close());
    }
  }, 30_000);

  it.skipIf(sb.how === "none")("denies a bind on 0.0.0.0 and on a Unix socket path", () => {
    const dir = mkdtempSync(join(tmpdir(), "aidw-l2-bind-"));
    temps.push(dir);
    const any = nodeExit('require("net").createServer().listen(0,"0.0.0.0",()=>process.exit(0)).on("error",()=>process.exit(7))');
    const sock = nodeExit(`require("net").createServer().listen(${JSON.stringify(join(dir, "b.sock"))},()=>process.exit(0)).on("error",()=>process.exit(7))`);
    if (sb.how !== "bwrap") expect(runCheck({ name: "any", run: any, expect: { exit: 7 } }, tmpdir(), process.env, sb)).toEqual({ pass: true, why: "" });
    expect(runCheck({ name: "sock", run: sock, expect: { exit: 7 } }, tmpdir(), process.env, sb)).toEqual({ pass: true, why: "" });
  }, 30_000);

  it.skipIf(sb.how === "none" || !express)("the in-process client still serves an Express app inside the sandbox that denies all network", () => {
    const dir = mkdtempSync(join(tmpdir(), "aidw-l2-inproc-"));
    temps.push(dir);
    const script = join(dir, "probe.mts");
    writeFileSync(
      script,
      [
        'import { createRequire } from "node:module";',
        'import { createServer } from "node:net";',
        `import { http } from ${JSON.stringify(clientFile)};`,
        `const express = createRequire(${JSON.stringify(join(nodeModules!, "noop.js"))})("express");`,
        "const app = express(); app.use(express.json());",
        "app.post('/x', (q, r) => r.status(201).json({ got: q.body }));",
        "const res = await http(app).post('/x').send({ a: 1 }).expect(201);",
        "console.log(JSON.stringify(res.body));",
        // and a socket is refused in the same process
        'await new Promise((ok) => createServer().listen(0, "127.0.0.1", () => { console.log("BOUND"); ok(); }).on("error", () => { console.log("NOBIND"); ok(); }));',
      ].join("\n"),
    );
    const argv = sb.wrap(`node --experimental-transform-types --no-warnings ${JSON.stringify(script)}`);
    const r = spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8", timeout: 60_000 });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('{"got":{"a":1}}');
    if (sb.how !== "bwrap") expect(r.stdout).toContain("NOBIND");
  }, 60_000);
});
