import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayError, memoryGateway, usePaymentGateway } from "../../src/billing/gateway.ts";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
let gw: ReturnType<typeof memoryGateway>;
beforeEach(async () => {
  gw = memoryGateway();
  usePaymentGateway(gw);
  t = await testApp();
});
afterEach(() => t.close());

const invoice = async (teamId: string) =>
  (await t.db.query<{ id: string }>("insert into invoices (team_id, number, amount_due, customer_ref) values ($1, 'A-1', 10000, 'cus_a') returning id", [teamId]))[0]!.id;
const pay = (invoiceId: string, key: string, user?: { token: string }, amount = 2500) => {
  const req = t.http().post(`/api/invoices/${invoiceId}/payments`).set("Idempotency-Key", key);
  return (user ? req.set(t.auth(user)) : req).send({ amount });
};

async function member() {
  const ana = await t.seed.user("ana");
  const team = await t.seed.team("Alpha", [ana]);
  return { ana, inv: await invoice(team.id) };
}

describe("POST /api/invoices/:invoiceId/payments", () => {
  it("payments/pay-an-invoice/member-pays-an-invoice: the owner's team member is charged once", async () => {
    const { ana, inv } = await member();
    const res = await pay(inv, "k1", ana);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invoiceId: inv, amount: 2500, currency: "EUR", state: "charged" });
    expect(gw.calls).toHaveLength(1);
  });

  it("payments/pay-an-invoice/no-session: 401, nothing charged", async () => {
    const { inv } = await member();
    const res = await pay(inv, "k1");
    expect(res.status).toBe(401);
    expect(gw.calls).toEqual([]);
  });

  it("payments/pay-an-invoice/invoice-of-another-team: 404 invoice-not-found for another user's invoice", async () => {
    const { inv } = await member();
    const bo = await t.seed.user("bo");
    await t.seed.team("Beta", [bo]);
    const res = await t.http().post(`/api/invoices/${inv}/payments`).set(t.auth(bo)).set("Idempotency-Key", "k1").send({ amount: 2500 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ type: "invoice-not-found", title: "No such invoice", status: 404 });
    expect(gw.calls).toEqual([]);
  });

  it("payments/pay-an-invoice/same-request-sent-again: two identical answers, one call to the provider", async () => {
    const { ana, inv } = await member();
    const a = await pay(inv, "k2", ana);
    const b = await pay(inv, "k2", ana);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(gw.calls).toHaveLength(1);
  });

  it("payments/pay-an-invoice/key-reused-for-another-request: 422, still one payment", async () => {
    const { ana, inv } = await member();
    await pay(inv, "k3", ana);
    const res = await pay(inv, "k3", ana, 9999);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ type: "idempotency-key-reused" });
    expect(await t.db.query("select 1 from payments")).toHaveLength(1);
  });

  it("payments/pay-an-invoice/request-still-running: 409 while the fake provider is held", async () => {
    const { ana, inv } = await member();
    const release = gw.hold();
    const first = (async () => await pay(inv, "k4", ana))();
    while (gw.calls.length === 0) await new Promise((r) => setTimeout(r, 10));
    const second = await pay(inv, "k4", ana);
    release();
    expect(second.status).toBe(409);
    expect((await first).status).toBe(201);
    expect(gw.charges.size).toBe(1);
  });

  it("payments/pay-an-invoice/provider-does-not-answer: 502, then 201 with the same provider key and one charge", async () => {
    const { ana, inv } = await member();
    gw.failWith = new GatewayError("unavailable", "down");
    expect((await pay(inv, "k5", ana)).status).toBe(502);
    gw.failWith = null;
    expect((await pay(inv, "k5", ana)).status).toBe(201);
    expect(new Set(gw.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(gw.charges.size).toBe(1);
  });

  it("answers 402 for a declined card, and the same again on a retry", async () => {
    const { ana, inv } = await member();
    gw.failWith = new GatewayError("declined", "no");
    expect((await pay(inv, "k6", ana)).status).toBe(402);
    gw.failWith = null;
    expect((await pay(inv, "k6", ana)).status).toBe(402);
    expect(gw.calls).toHaveLength(1);
  });

  it("answers 400 idempotency-key-missing without a key", async () => {
    const { ana, inv } = await member();
    const res = await t.http().post(`/api/invoices/${inv}/payments`).set(t.auth(ana)).send({ amount: 2500 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ type: "idempotency-key-missing" });
  });
});
