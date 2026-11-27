import { deepStrictEqual } from "node:assert";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type RequestListener } from "node:http";
import { Duplex } from "node:stream";

/**
 * A supertest-style HTTP client that serves each request in-process: no port is bound and no socket is opened. Each
 * request gets an in-memory stream pair; one end goes to a Node HTTP server that never listens (`connection` accepts
 * any Duplex), the other to `http.request`. Requests and responses still go through Node's real HTTP parser.
 *
 *   const res = await http(app).post("/api/sessions").set("x-team-id", id).send({ email, password });
 *   res.status; res.headers["content-type"]; res.body; res.text
 */

export interface TestResponse {
  status: number;
  statusCode: number;
  /** Lower-case header names, as Node gives them. */
  headers: IncomingHttpHeaders;
  header: IncomingHttpHeaders;
  /** The media type without parameters, e.g. "application/json". */
  type: string;
  /** Parsed JSON for a JSON response (`application/json`, `application/problem+json`, ...), else `{}`. */
  body: any;
  text: string;
  ok: boolean;
}

type Expectation = (res: TestResponse) => void;

/** One client's server and the streams it is serving now. */
interface Connections {
  server: ReturnType<typeof createServer>;
  served: Set<Duplex>;
}

/** Two connected in-memory streams: what one end writes, the other reads. */
function streamPair(): [Duplex, Duplex] {
  const ends: Duplex[] = [];
  const make = (other: () => Duplex) => {
    let ended = false;
    const endOther = () => {
      const o = other();
      if (!ended && !o.destroyed) o.push(null);
      ended = true;
    };
    return new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        const o = other();
        if (!o.destroyed) o.push(chunk);
        cb();
      },
      final(cb) {
        endOther();
        cb();
      },
      destroy(err, cb) {
        endOther();
        cb(err);
      },
    });
  };
  ends.push(make(() => ends[1]!), make(() => ends[0]!));
  return [ends[0]!, ends[1]!];
}

const isJson = (type: string) => /[/+]json$/i.test(type);
const isForm = (type: string | undefined) => /^application\/x-www-form-urlencoded\b/i.test(type ?? "");
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Buffer.isBuffer(v) && !Array.isArray(v);

/** A body check: a string must equal the text, a RegExp match it, anything else deeply equal the parsed body. */
function checkBody(res: TestResponse, want: unknown): void {
  if (typeof want === "string") {
    if (res.text !== want) throw new Error(`expected body ${JSON.stringify(want)}, got ${JSON.stringify(res.text)}`);
  } else if (want instanceof RegExp) {
    if (!want.test(res.text)) throw new Error(`expected body to match ${want}, got ${JSON.stringify(res.text)}`);
  } else deepStrictEqual(res.body, want);
}

export class TestRequest implements PromiseLike<TestResponse> {
  private headers: Record<string, string> = {};
  private body: unknown = undefined;
  private search = new URLSearchParams();
  private expectations: Expectation[] = [];
  private running: Promise<TestResponse> | null = null;

  constructor(
    private readonly conn: Connections,
    private readonly method: string,
    private readonly url: string,
  ) {}

  /** One header, or several as an object. */
  set(name: string | Record<string, string>, value?: string): this {
    if (typeof name === "object") for (const [k, v] of Object.entries(name)) this.headers[k.toLowerCase()] = String(v);
    else this.headers[name.toLowerCase()] = String(value);
    return this;
  }

  /** The Content-Type: "json", "form", "text", or a media type. */
  type(t: string): this {
    const short: Record<string, string> = { json: "application/json", form: "application/x-www-form-urlencoded", text: "text/plain" };
    return this.set("content-type", short[t] ?? t);
  }

  /** Query parameters, as an object or a "a=1&b=2" string. */
  query(q: string | Record<string, string | number | boolean>): this {
    const add = typeof q === "string" ? new URLSearchParams(q) : Object.entries(q).map(([k, v]) => [k, String(v)]);
    for (const [k, v] of add) this.search.append(k, v as string);
    return this;
  }

  /**
   * The body, as supertest sends it. An object is sent as JSON (objects of several calls are merged), or form-encoded
   * when the Content-Type is a form; a string is sent as it is and makes the Content-Type a form unless one is set;
   * `null` sends an empty body.
   */
  send(data: unknown): this {
    if (typeof data === "string") {
      this.headers["content-type"] ??= "application/x-www-form-urlencoded";
      this.body = typeof this.body === "string" ? this.body + data : data;
    } else if (isPlainObject(data) && isPlainObject(this.body)) {
      this.body = { ...this.body, ...data };
    } else {
      this.body = data;
    }
    return this;
  }

  /**
   * Checks of the response, run when it is awaited, as supertest's: `.expect(201)`, `.expect(201, body)`,
   * `.expect(body)` (a string or RegExp against the text, anything else against the parsed body),
   * `.expect("content-type", /json/)`, `.expect((res) => ...)`.
   */
  expect(a: number | string | RegExp | object | Expectation, b?: unknown): this {
    if (typeof a === "function") this.expectations.push(a as Expectation);
    else if (typeof a === "number") {
      this.expectations.push((res) => {
        if (res.status !== a) throw new Error(`expected ${a}, got ${res.status}: ${res.text.slice(0, 500)}`);
        if (b !== undefined) checkBody(res, b);
      });
    } else if (typeof a !== "string" || b === undefined) {
      this.expectations.push((res) => checkBody(res, a));
    } else {
      const name = a.toLowerCase();
      this.expectations.push((res) => {
        const got = res.headers[name];
        const value = Array.isArray(got) ? got.join(", ") : got;
        if (value === undefined) throw new Error(`expected header ${a}, got none`);
        if (b instanceof RegExp ? !b.test(value) : value !== b) throw new Error(`expected header ${a} ${b instanceof RegExp ? `to match ${b}` : JSON.stringify(b)}, got ${JSON.stringify(value)}`);
      });
    }
    return this;
  }

  then<A = TestResponse, B = never>(onOk?: ((res: TestResponse) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    this.running ??= this.run();
    return this.running.then(onOk, onErr);
  }

  catch<B = never>(onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<TestResponse | B> {
    return this.then(undefined, onErr);
  }

  finally(f?: (() => void) | null): Promise<TestResponse> {
    return this.then().finally(f);
  }

  private payload(): Buffer | null {
    const b = this.body;
    if (b === undefined) return null;
    if (b === null) return Buffer.alloc(0);
    if (Buffer.isBuffer(b)) return b;
    if (typeof b === "string") return Buffer.from(b);
    if (isPlainObject(b) && isForm(this.headers["content-type"])) return Buffer.from(new URLSearchParams(Object.entries(b).map(([k, v]) => [k, String(v)])).toString());
    this.headers["content-type"] ??= "application/json";
    return Buffer.from(JSON.stringify(b));
  }

  private async run(): Promise<TestResponse> {
    const data = this.payload();
    const qs = this.search.toString();
    const path = qs ? `${this.url}${this.url.includes("?") ? "&" : "?"}${qs}` : this.url;
    const [client, served] = streamPair();
    // As a request from 127.0.0.1 looks to the app (req.ip, req.socket.remoteAddress).
    Object.assign(served, { remoteAddress: "127.0.0.1", remoteFamily: "IPv4", remotePort: 50000, localAddress: "127.0.0.1", localPort: 80 });
    this.conn.served.add(served);
    try {
      this.conn.server.emit("connection", served);
      const res = await this.exchange(client, path, data);
      for (const check of this.expectations) check(res);
      return res;
    } finally {
      client.destroy();
      served.destroy();
      this.conn.served.delete(served);
    }
  }

  private exchange(client: Duplex, path: string, data: Buffer | null): Promise<TestResponse> {
    return new Promise<TestResponse>((resolve, reject) => {
      const req = httpRequest(
        {
          method: this.method,
          path,
          host: "127.0.0.1",
          headers: { host: "127.0.0.1", ...this.headers, connection: "close", ...(data ? { "content-length": String(data.length) } : {}) },
          createConnection: () => client as never,
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("error", reject);
          r.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const type = String(r.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
            let body: unknown = {};
            if (isJson(type) && text) {
              try {
                body = JSON.parse(text);
              } catch (e) {
                reject(new Error(`the response is ${type} but not JSON: ${(e as Error).message}`));
                return;
              }
            }
            const status = r.statusCode ?? 0;
            resolve({ status, statusCode: status, headers: r.headers, header: r.headers, type, body, text, ok: status >= 200 && status < 300 });
          });
        },
      );
      req.on("error", reject);
      req.end(data ?? undefined);
    });
  }
}

/** A client for one app: `client.get(url)`, `.post(url)`, ... Each request is served in-process. */
export function http(handler: RequestListener) {
  // The server never listens, so it does not track the streams fed to it: closeAllConnections() cannot end them.
  const conn: Connections = { server: createServer(handler), served: new Set() };
  const open = (method: string) => (url: string) => new TestRequest(conn, method, url);
  return {
    get: open("GET"),
    post: open("POST"),
    put: open("PUT"),
    patch: open("PATCH"),
    delete: open("DELETE"),
    del: open("DELETE"),
    head: open("HEAD"),
    options: open("OPTIONS"),
    /** Ends any request still being served: its awaited request rejects. */
    close: () => {
      for (const s of conn.served) s.destroy();
      conn.served.clear();
    },
  };
}
