import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { backend, signIn } from "./backend";
import { server } from "./msw/server";

/** The harness itself: a `fetch` of the web app reaches the real Express app, and nothing else answers it. */
describe("the web tests' network forwards /api/* to the real server", () => {
  it("answers with the server's status, body and content type, for a signed-in user", async () => {
    const t = await backend();
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", { owners: [ana] });
    const p = await t.seed.project(team.id, "Website");
    signIn(ana);
    const res = await fetch("/api/projects");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    const body = await res.json();
    expect(body.items).toEqual([{ id: p.id, teamId: team.id, name: "Website", createdAt: expect.any(String) }]);
  });

  it("sends no cookie when nobody is signed in: the server's own 401 comes back", async () => {
    const res = await fetch("/api/projects");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
  });

  it("forwards the method and the JSON body of a write", async () => {
    const t = await backend();
    const ana = await t.seed.user("ana");
    const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: ana.email }) });
    expect(res.status).toBe(201);
    expect((await res.json()).user.id).toBe(ana.id);
  });

  it("a server.use override still wins over the forwarder, for a test that needs a failure", async () => {
    server.use(http.get("/api/projects", () => HttpResponse.json({ error: { code: "internal-error" } }, { status: 503 })));
    expect((await fetch("/api/projects")).status).toBe(503);
  });

  it("the database a test seeds is the database the forwarded requests read, and is empty for the next test", async () => {
    const t = await backend();
    expect(await t.db.query("select id from users")).toEqual([]);
    await t.seed.user("ana");
    expect(await t.db.query("select id from users")).toHaveLength(1);
  });
});
