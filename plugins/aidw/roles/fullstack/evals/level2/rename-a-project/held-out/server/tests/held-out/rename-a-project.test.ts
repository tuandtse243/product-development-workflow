import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

/**
 * Held-out route tests of the level 2 case rename-a-project: `PATCH /api/projects/{projectId}` through the app's routes
 * (server/tests/helpers.ts and http.ts, restored before grading), against the contract in the Change's api-contract.md.
 */
let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const rowName = async (id: string) => (await t.db.query<{ name: string }>("select name from projects where id = $1", [id]))[0]?.name;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

async function world() {
  const owner = await t.seed.user("owner");
  const member = await t.seed.user("member");
  const outsider = await t.seed.user("outsider");
  const alpha = await t.seed.team("Alpha", { owners: [owner], members: [member] });
  const beta = await t.seed.team("Beta", { owners: [outsider] });
  const website = await t.seed.project(alpha.id, "Website");
  const gamma = await t.seed.project(alpha.id, "Gamma");
  const betaProject = await t.seed.project(beta.id, "Apollo");
  return { owner, member, outsider, alpha, beta, website, gamma, betaProject };
}
const patch = (id: string, who: { token: string } | null, body: unknown) => {
  const req = t.http().patch(`/api/projects/${id}`);
  if (who) req.set(t.as(who));
  return req.send(body as object);
};

describe("rename a project: the route (held out)", () => {
  it("an owner renames: 200, the trimmed name, the project as the API shapes it, and the row holds it", async () => {
    const w = await world();
    const res = await patch(w.website.id, w.owner, { name: "  Apollo  " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: w.website.id, teamId: w.alpha.id, name: "Apollo", createdAt: expect.any(String) });
    expect(await rowName(w.website.id)).toBe("Apollo");
    expect(await rowName(w.gamma.id)).toBe("Gamma");
  });

  it("after a rename the list and the project say the new name, the list in name order", async () => {
    const w = await world();
    await patch(w.website.id, w.owner, { name: "Apollo" });
    const list = await t.http().get("/api/projects").set(t.as(w.owner));
    expect(list.body.items.map((p: { name: string }) => p.name)).toEqual(["Apollo", "Gamma"]);
    expect((await t.http().get(`/api/projects/${w.website.id}`).set(t.as(w.owner))).body.name).toBe("Apollo");
  });

  it("a name another project of the team has is 422 with exactly the contract's body, whatever its case; the row is unchanged", async () => {
    const w = await world();
    for (const name of ["Gamma", "  gamma  ", "GAMMA"]) {
      const res = await patch(w.website.id, w.owner, { name });
      expect(res.status, name).toBe(422);
      expect(res.body, name).toEqual({ error: { code: "validation", fields: { name: "taken" } } });
    }
    expect(await rowName(w.website.id)).toBe("Website");
  });

  it("a name taken in another team is free, and a project may keep its own name (even in another case)", async () => {
    const w = await world();
    expect((await patch(w.website.id, w.owner, { name: "Apollo" })).status).toBe(200);
    const again = await patch(w.website.id, w.owner, { name: "APOLLO" });
    expect(again.status).toBe(200);
    expect(again.body.name).toBe("APOLLO");
  });

  it("a blank, missing or non-string name is 422 required; one of 81 characters is 422 too-long; 80 is fine", async () => {
    const w = await world();
    for (const body of [{ name: "" }, { name: "   " }, {}, { name: 7 }, { name: null }]) {
      const res = await patch(w.website.id, w.owner, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body, JSON.stringify(body)).toEqual({ error: { code: "validation", fields: { name: "required" } } });
    }
    const long = await patch(w.website.id, w.owner, { name: "n".repeat(81) });
    expect(long.status).toBe(422);
    expect(long.body).toEqual({ error: { code: "validation", fields: { name: "too-long" } } });
    expect((await patch(w.website.id, w.owner, { name: ` ${"n".repeat(80)} ` })).status).toBe(200);
    expect(await rowName(w.website.id)).toBe("n".repeat(80));
  });

  it("a member who is not an owner is 403 forbidden, before the body is looked at, and nothing changes", async () => {
    const w = await world();
    for (const body of [{ name: "Apollo" }, { name: "Gamma" }, { name: "" }]) {
      const res = await patch(w.website.id, w.member, body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
      expect(res.body.error.fields).toBeUndefined();
    }
    expect(await rowName(w.website.id)).toBe("Website");
  });

  it("no session, an unknown cookie and a cookie of nobody are 401 unauthenticated", async () => {
    const w = await world();
    const none = await patch(w.website.id, null, { name: "Apollo" });
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("unauthenticated");
    const unknown = await t.http().patch(`/api/projects/${w.website.id}`).set("Cookie", "sid=not-a-session").send({ name: "Apollo" });
    expect(unknown.status).toBe(401);
    expect(await rowName(w.website.id)).toBe("Website");
  });

  it("a user outside the team, and an id nobody has, get the same 404 project-not-found; a project of another team is untouched", async () => {
    const w = await world();
    const outside = await patch(w.website.id, w.outsider, { name: "Apollo" });
    const none = await patch(UNKNOWN, w.owner, { name: "Apollo" });
    expect(outside.status).toBe(404);
    expect(none.status).toBe(404);
    expect(outside.body).toEqual(none.body);
    expect(outside.body.error.code).toBe("project-not-found");
    expect(await rowName(w.website.id)).toBe("Website");
    expect(await rowName(w.betaProject.id)).toBe("Apollo");
  });

  it("an id that is not a uuid, a body with another field and a body that is not JSON are 400 invalid-request", async () => {
    const w = await world();
    expect((await patch("not-an-id", w.owner, { name: "Apollo" })).status).toBe(400);
    const extra = await patch(w.website.id, w.owner, { name: "Apollo", teamId: w.beta.id });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe("invalid-request");
    const raw = await t.http().patch(`/api/projects/${w.website.id}`).set(t.as(w.owner)).type("json").send("{nope");
    expect(raw.status).toBe(400);
    expect(await rowName(w.website.id)).toBe("Website");
    expect((await t.http().get(`/api/projects/${w.website.id}`).set(t.as(w.owner))).body.teamId).toBe(w.alpha.id);
  });

  it("the error bodies carry no stack, SQL or path", async () => {
    const w = await world();
    for (const res of [await patch(w.website.id, w.member, { name: "x" }), await patch(UNKNOWN, w.owner, { name: "x" }), await patch(w.website.id, null, { name: "x" })]) {
      expect(res.text).not.toMatch(/\n\s+at |select |insert |update |node_modules|\/Users\//i);
    }
  });
});
