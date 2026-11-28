import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const rows = () => t.db.query<{ name: string; email: string; team_id: string }>("select name, email, team_id from invites");

async function world() {
  const owner = await t.seed.user("owner");
  const member = await t.seed.user("member");
  const team = await t.seed.team("Alpha", { owners: [owner], members: [member] });
  return { owner, member, team };
}
const post = (who: { token: string } | null, body: unknown) => {
  const req = t.http().post("/api/invites");
  if (who) req.set(t.as(who));
  return req.send(body as object);
};

describe("POST /api/invites", () => {
  it("invites/invite-a-member/owner-invites-a-member: an owner invites; the name is stored trimmed", async () => {
    const w = await world();
    const res = await post(w.owner, { name: "  Dana White  ", email: "dana@example.test" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), teamId: w.team.id, email: "dana@example.test", name: "Dana White", createdAt: expect.any(String) });
    expect(await rows()).toEqual([{ name: "Dana White", email: "dana@example.test", team_id: w.team.id }]);
  });

  it("invites/invite-a-member/name-too-long: 80 characters are accepted, 81 are 422 too-long", async () => {
    const w = await world();
    expect((await post(w.owner, { name: "x".repeat(80), email: "a@example.test" })).status).toBe(201);
    const res = await post(w.owner, { name: "x".repeat(81), email: "b@example.test" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: "validation", fields: { name: "too-long" } } });
    expect(await rows()).toHaveLength(1);
  });

  it("invites/invite-a-member/email-not-valid: an email that is not one is 422 invalid", async () => {
    const w = await world();
    const res = await post(w.owner, { name: "Dana", email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: "validation", fields: { email: "invalid" } } });
    expect(await rows()).toEqual([]);
  });

  it("invites/invite-a-member/member-is-refused: a member is 403 forbidden, and nothing is stored", async () => {
    const w = await world();
    const res = await post(w.member, { name: "Dana", email: "dana@example.test" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(await rows()).toEqual([]);
  });

  it("invites/invite-a-member/signed-out-caller: no session is 401 unauthenticated, and nothing is stored", async () => {
    await world();
    const res = await post(null, { name: "Dana", email: "dana@example.test" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
    expect(await rows()).toEqual([]);
  });

  it("a body that is not an object, or has another field, is 400 invalid-request", async () => {
    const w = await world();
    expect((await post(w.owner, { name: "Dana", email: "dana@example.test", role: "owner" })).status).toBe(400);
    expect((await post(w.owner, [])).status).toBe(400);
  });
});
