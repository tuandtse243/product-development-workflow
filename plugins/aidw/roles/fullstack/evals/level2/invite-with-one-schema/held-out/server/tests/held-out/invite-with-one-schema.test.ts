import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

/**
 * Held-out route tests of the level 2 case invite-with-one-schema: `POST /api/invites` through the app's routes
 * (server/tests/helpers.ts and http.ts, restored before grading), against the contract in the Change's api-contract.md.
 */
let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const rows = () => t.db.query<{ name: string; email: string; team_id: string }>("select name, email, team_id from invites order by created_at, name");

async function world() {
  const owner = await t.seed.user("owner");
  const member = await t.seed.user("member");
  const outsider = await t.seed.user("outsider");
  const alpha = await t.seed.team("Alpha", { owners: [owner], members: [member] });
  return { owner, member, outsider, alpha };
}
const post = (who: { token: string } | null, body: unknown) => {
  const req = t.http().post("/api/invites");
  if (who) req.set(t.as(who));
  return req.send(body as object);
};
const valid = { name: "Dana White", email: "dana@example.test" };
const validation = (fields: Record<string, string>) => ({ error: { code: "validation", fields } });

describe("invite a member: the route (held out)", () => {
  it("an owner invites: 201, the invitation as the API shapes it, and the row holds the trimmed name for the owner's team", async () => {
    const w = await world();
    const res = await post(w.owner, { name: "  Dana White  ", email: "dana@example.test" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), teamId: w.alpha.id, email: "dana@example.test", name: "Dana White", createdAt: expect.any(String) });
    expect(await rows()).toEqual([{ name: "Dana White", email: "dana@example.test", team_id: w.alpha.id }]);
  });

  it("a name of 80 characters is accepted, one of 81 is 422 with exactly the contract's body, spaces around it do not count; no row is added", async () => {
    const w = await world();
    expect((await post(w.owner, { ...valid, name: "x".repeat(80) })).status).toBe(201);
    expect((await post(w.owner, { ...valid, name: `  ${"y".repeat(80)}  ` })).status).toBe(201);
    for (const name of ["x".repeat(81), ` ${"z".repeat(81)} `, "é".repeat(81)]) {
      const res = await post(w.owner, { ...valid, name });
      expect(res.status).toBe(422);
      expect(res.body).toEqual(validation({ name: "too-long" }));
    }
    expect(await rows()).toHaveLength(2);
  });

  it("a blank, missing or non-string name is 422 required; a blank, missing or non-string email too", async () => {
    const w = await world();
    for (const name of ["", "   ", undefined, 7, null]) {
      const res = await post(w.owner, name === undefined ? { email: valid.email } : { ...valid, name });
      expect(res.status, String(name)).toBe(422);
      expect(res.body, String(name)).toEqual(validation({ name: "required" }));
    }
    for (const email of ["", "  ", undefined, 7, null]) {
      const res = await post(w.owner, email === undefined ? { name: valid.name } : { ...valid, email });
      expect(res.status, String(email)).toBe(422);
      expect(res.body, String(email)).toEqual(validation({ email: "required" }));
    }
    expect(await rows()).toEqual([]);
  });

  it("an email that is not an address is 422 invalid, and a request with two faults names both fields", async () => {
    const w = await world();
    for (const email of ["not-an-email", "dana@", "@example.test", "dana example@test.dev"]) {
      const res = await post(w.owner, { ...valid, email });
      expect(res.status, email).toBe(422);
      expect(res.body, email).toEqual(validation({ email: "invalid" }));
    }
    const both = await post(w.owner, { name: "x".repeat(81), email: "nope" });
    expect(both.status).toBe(422);
    expect(both.body).toEqual(validation({ name: "too-long", email: "invalid" }));
    expect(await rows()).toEqual([]);
  });

  it("a member who is not an owner, and a user in no team, are 403 forbidden, before the body is read; nothing is stored", async () => {
    const w = await world();
    for (const who of [w.member, w.outsider]) {
      for (const body of [valid, { name: "", email: "nope" }, { whatever: 1 }]) {
        const res = await post(who, body);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("forbidden");
      }
    }
    expect(await rows()).toEqual([]);
  });

  it("no session, an unknown cookie: 401 unauthenticated, before the body is read; nothing is stored", async () => {
    await world();
    for (const res of [await post(null, valid), await post(null, { name: "", email: "" }), await t.http().post("/api/invites").set({ Cookie: "sid=nope" }).send(valid)]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
    }
    expect(await rows()).toEqual([]);
  });

  it("a body that is not an object, has a field that is not listed or is not JSON is 400 invalid-request", async () => {
    const w = await world();
    for (const body of [{ ...valid, role: "owner" }, [valid], "dana"]) {
      const res = await post(w.owner, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("invalid-request");
    }
    const raw = await t.http().post("/api/invites").set(t.as(w.owner)).set("content-type", "application/json").send("{not json");
    expect(raw.status).toBe(400);
    expect(raw.body.error.code).toBe("invalid-request");
    expect(await rows()).toEqual([]);
  });

  it("the error bodies carry no stack and no echo of what was sent", async () => {
    const w = await world();
    const res = await post(w.owner, { name: "x".repeat(81), email: "secret-looking@nope" });
    expect(res.text).not.toMatch(/stack|node_modules|\.ts:\d+|secret-looking|xxxxxxxx/);
  });
});
