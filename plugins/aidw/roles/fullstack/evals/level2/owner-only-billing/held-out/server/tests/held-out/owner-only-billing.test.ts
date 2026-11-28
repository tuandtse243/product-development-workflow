import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

/**
 * Held-out route tests of the level 2 case owner-only-billing: `GET /api/billing` through the app's routes
 * (server/tests/helpers.ts and http.ts, restored before grading), against the contract in the Change's api-contract.md.
 */
let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const invoice = (teamId: string, number: string, cents: number, issued: string) =>
  t.db.query("insert into invoices (team_id, number, amount_cents, issued_at) values ($1, $2, $3, $4)", [teamId, number, cents, issued]);

async function world() {
  const owner = await t.seed.user("owner");
  const member = await t.seed.user("member");
  const outsider = await t.seed.user("outsider");
  const both = await t.seed.user("both");
  const alpha = await t.seed.team("Alpha", { owners: [owner], members: [member, both] });
  const beta = await t.seed.team("Beta", { owners: [both] });
  await invoice(alpha.id, "INV-A1", 120000, "2026-01-05T00:00:00Z");
  await invoice(alpha.id, "INV-A2", 4900, "2026-02-05T00:00:00Z");
  await invoice(beta.id, "INV-B1", 700, "2026-03-05T00:00:00Z");
  return { owner, member, outsider, both, alpha, beta };
}
const get = (who: { token: string } | null) => {
  const req = t.http().get("/api/billing");
  if (who) req.set(t.as(who));
  return req;
};
const numbers = (res: { body: { items: { number: string }[] } }) => res.body.items.map((i) => i.number);

describe("owner-only billing: the route (held out)", () => {
  it("an owner reads the invoices of the team: 200, newest first, as the contract shapes them", async () => {
    const w = await world();
    const res = await get(w.owner);
    expect(res.status).toBe(200);
    expect(numbers(res)).toEqual(["INV-A2", "INV-A1"]);
    expect(res.body.items[0]).toEqual({ id: expect.any(String), teamId: w.alpha.id, number: "INV-A2", amountCents: 4900, status: "open", issuedAt: "2026-02-05T00:00:00.000Z" });
  });

  it("a member who is not an owner is 403 forbidden, and nothing of an invoice is in the answer", async () => {
    const w = await world();
    const res = await get(w.member);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(res.body.items).toBeUndefined();
    expect(res.text).not.toMatch(/INV-|120000|4900|amountCents/);
  });

  it("a user in no team is 403 forbidden too", async () => {
    const w = await world();
    const res = await get(w.outsider);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(res.text).not.toMatch(/INV-/);
  });

  it("a member of one team who owns another reads only the invoices of the team they own", async () => {
    const w = await world();
    const res = await get(w.both);
    expect(res.status).toBe(200);
    expect(numbers(res)).toEqual(["INV-B1"]);
    expect(res.text).not.toMatch(/INV-A/);
  });

  it("no session, an unknown cookie: 401 unauthenticated, no invoice", async () => {
    await world();
    for (const res of [await get(null), await t.http().get("/api/billing").set({ Cookie: "sid=nope" })]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
      expect(res.text).not.toMatch(/INV-/);
    }
  });
});
