import { http, HttpResponse } from "msw";
import { backend, sessionCookie } from "../backend";

/**
 * The network of the web tests: every `/api/*` request is forwarded to the real Express app in this process (the same
 * in-process request code as the server tests, server/tests/http.ts), and its answer is the response. Nothing is faked: the
 * status, the headers that matter and the body are the server's. A test that needs another answer (a 503, a slow
 * response) overrides one route with `server.use(...)` from ./server.ts.
 */
const SKIP = new Set(["host", "connection", "content-length", "transfer-encoding"]);

export const handlers = [
  http.all("/api/*", async ({ request }) => {
    const t = await backend();
    const url = new URL(request.url);
    const req = t.http().request(request.method, `${url.pathname}${url.search}`);
    request.headers.forEach((value, name) => {
      if (!SKIP.has(name)) req.set(name, value);
    });
    const cookie = sessionCookie();
    if (cookie && !request.headers.has("cookie")) req.set("cookie", cookie);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.text();
      if (text) req.send(text);
    }
    const res = await req;
    const empty = res.status === 204 || res.status === 304;
    return new HttpResponse(empty ? null : res.text, { status: res.status, headers: { "content-type": res.headers["content-type"] ?? "text/plain" } });
  }),
];
