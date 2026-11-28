import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const invoice = (teamId: string, number: string, cents: number, issued: string) =>
  t.db.query("insert into invoices (team_id, number, amount_cents, issued_at) values ($1, $2, $3, $4)", [teamId, number, cents, issued]);

describe("GET /api/billing", () => {
  it("lists the invoices of the caller's team, newest first, as named fields", async () => {
    const ana = await t.seed.user("ana");
    const alpha = await t.seed.team("Alpha", { owners: [ana] });
    const other = await t.seed.team("Other");
    await invoice(alpha.id, "INV-001", 120000, "2026-01-05T00:00:00Z");
    await invoice(alpha.id, "INV-002", 4900, "2026-02-05T00:00:00Z");
    await invoice(other.id, "INV-900", 100, "2026-02-06T00:00:00Z");
    const res = await t.http().get("/api/billing").set(t.as(ana));
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { number: string }) => x.number)).toEqual(["INV-002", "INV-001"]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(["amountCents", "id", "issuedAt", "number", "status", "teamId"]);
  });

  it("billing/owner-only-billing/member-is-refused: a member of the team gets 403 forbidden and no invoice", async () => {
    const ana = await t.seed.user("ana");
    const bo = await t.seed.user("bo");
    const alpha = await t.seed.team("Alpha", { owners: [ana], members: [bo] });
    await invoice(alpha.id, "INV-001", 120000, "2026-01-05T00:00:00Z");
    const res = await t.http().get("/api/billing").set(t.as(bo));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(res.text).not.toContain("INV-001");
  });

  it("a user who is in no team gets 403 too", async () => {
    const cy = await t.seed.user("cy");
    const res = await t.http().get("/api/billing").set(t.as(cy));
    expect(res.status).toBe(403);
  });

  it("billing/owner-only-billing/signed-out-caller: needs a session", async () => {
    const res = await t.http().get("/api/billing");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });
});
