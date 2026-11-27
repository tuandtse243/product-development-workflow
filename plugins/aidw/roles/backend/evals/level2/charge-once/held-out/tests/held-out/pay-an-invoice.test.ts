// Held-out tests of the level 2 case charge-once (plugins/aidw/roles/backend/evals/level2/). They are copied into the
// temp copy only after the Agent finished. They check the contract of POST /api/invoices/{invoiceId}/payments in
// .aidw/changes/pay-an-invoice/api-contract.md through the route, with the payment provider replaced by
// memoryGateway(), which charges once per idempotency key as the real provider does.
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

const NO_INVOICE = { type: "invoice-not-found", title: "No such invoice", status: 404 };
const IN_PROGRESS = { type: "request-in-progress", title: "A request with this key is still running", status: 409 };
const REUSED = { type: "idempotency-key-reused", title: "This key was used for another request", status: 422 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invoice(teamId: string, number: string, amountDue = 10_000, currency = "EUR", customer = `cus_${number}`) {
  return (
    await t.db.query<{ id: string }>("insert into invoices (team_id, number, amount_due, currency, customer_ref) values ($1, $2, $3, $4, $5) returning id", [
      teamId,
      number,
      amountDue,
      currency,
      customer,
    ])
  )[0]!.id;
}

/** ana and cy are in Alpha (invoices i and j), bo is in Beta (invoice k). */
async function world() {
  const ana = await t.seed.user("ana");
  const cy = await t.seed.user("cy");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", [ana, cy]);
  const beta = await t.seed.team("Beta", [bo]);
  return {
    ana,
    cy,
    bo,
    i: await invoice(alpha.id, "A-1", 10_000, "EUR", "cus_alpha"),
    j: await invoice(alpha.id, "A-2", 5_000, "EUR", "cus_alpha"),
    k: await invoice(beta.id, "B-1", 7_000, "USD", "cus_beta"),
  };
}

const payments = () =>
  t.db.query<{ id: string; invoice_id: string; amount: number; currency: string; state: string; provider_ref: string | null; created_by: string }>(
    "select id, invoice_id, amount, currency, state, provider_ref, created_by from payments order by created_at, id",
  );
const charged = async () => (await payments()).filter((p) => p.state === "charged");
const pay = (invoiceId: string, user: { token: string }, key: string | null, body: unknown) => {
  const req = t.http().post(`/api/invoices/${invoiceId}/payments`).set(t.auth(user));
  return (key === null ? req : req.set("Idempotency-Key", key)).send(body as object);
};
/** The answer, or "no answer" when none came within `ms`. */
async function within<T>(ms: number, p: PromiseLike<T>): Promise<T | "no answer"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"no answer">((r) => (timer = setTimeout(() => r("no answer"), ms)));
  try {
    return await Promise.race([Promise.resolve(p), late]);
  } finally {
    clearTimeout(timer);
  }
}

describe("held-out: POST /api/invoices/:invoiceId/payments", () => {
  it("charges the team's card once for a member and answers 201 with the payment", async () => {
    const w = await world();
    const res = await pay(w.i, w.ana, "pay-1", { amount: 2_500 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["amount", "createdAt", "currency", "id", "invoiceId", "state"]);
    expect(res.body).toMatchObject({ invoiceId: w.i, amount: 2_500, currency: "EUR", state: "charged" });
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    expect(gw.calls).toHaveLength(1);
    expect(gw.calls[0]).toMatchObject({ amount: 2_500, currency: "EUR", customer: "cus_alpha" });
    expect(gw.calls[0]!.idempotencyKey.length).toBeGreaterThan(0);
    expect(await payments()).toEqual([
      { id: res.body.id, invoice_id: w.i, amount: 2_500, currency: "EUR", state: "charged", provider_ref: "ch_1", created_by: w.ana.id },
    ]);
  });

  it("same request sent again after it finished: the first answer again, and the card is not charged again", async () => {
    const w = await world();
    const first = await pay(w.i, w.ana, "pay-2", { amount: 2_500 });
    const second = await pay(w.i, w.ana, "pay-2", { amount: 2_500 });
    const third = await pay(w.i, w.ana, "pay-2", { amount: 2_500 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(third.body).toEqual(first.body);
    expect(gw.calls).toHaveLength(1);
    expect(await payments()).toHaveLength(1);
  });

  it("an invoice may be paid in parts: two keys, two charges", async () => {
    const w = await world();
    expect((await pay(w.i, w.ana, "part-1", { amount: 4_000 })).status).toBe(201);
    expect((await pay(w.i, w.ana, "part-2", { amount: 4_000 })).status).toBe(201);
    expect(gw.charges.size).toBe(2);
    expect(await charged()).toHaveLength(2);
  });

  it("key reused for another request (another amount, another invoice): 422 idempotency-key-reused, nothing charged", async () => {
    const w = await world();
    expect((await pay(w.i, w.ana, "pay-3", { amount: 2_500 })).status).toBe(201);
    const amount = await pay(w.i, w.ana, "pay-3", { amount: 9_999 });
    expect(amount.status).toBe(422);
    expect(amount.body).toMatchObject(REUSED);
    const other = await pay(w.j, w.ana, "pay-3", { amount: 2_500 });
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject(REUSED);
    expect(gw.calls).toHaveLength(1);
    expect(await payments()).toHaveLength(1);
  });

  it("keys belong to the caller: another member's payment with the same key is a payment of its own, really charged", async () => {
    const w = await world();
    const a = await pay(w.i, w.ana, "same-key", { amount: 2_500 });
    const c = await pay(w.i, w.cy, "same-key", { amount: 2_500 });
    expect(a.status).toBe(201);
    expect(c.status).toBe(201);
    expect(c.body.id).not.toBe(a.body.id);
    expect(gw.charges.size, "the provider charged both").toBe(2);
    expect(await charged()).toHaveLength(2);
  });

  it("request still running: the same key while the first waits for the provider gets 409 request-in-progress at once; one charge", async () => {
    const w = await world();
    const release = gw.hold();
    let first: Promise<{ status: number; body: unknown }> | undefined;
    try {
      first = (async () => await pay(w.i, w.ana, "pay-4", { amount: 2_500 }))();
      for (let n = 0; gw.calls.length === 0 && n < 250; n++) await sleep(20);
      expect(gw.calls, "the first request reached the provider").toHaveLength(1);
      const second = await within(3_000, pay(w.i, w.ana, "pay-4", { amount: 2_500 }));
      expect(second, "the duplicate is answered while the first still waits for the provider").not.toBe("no answer");
      expect((second as { status: number }).status).toBe(409);
      expect((second as { body: unknown }).body).toMatchObject(IN_PROGRESS);
    } finally {
      release();
    }
    const done = await first!;
    expect(done.status).toBe(201);
    const later = await pay(w.i, w.ana, "pay-4", { amount: 2_500 });
    expect(later.status).toBe(201);
    expect(later.body).toEqual(done.body);
    expect(gw.charges.size).toBe(1);
    expect(gw.calls).toHaveLength(1);
    expect(await payments()).toHaveLength(1);
  });

  it("provider does not answer: 502, and the same request sent again once it is back is charged at most once, with the same provider key", async () => {
    const w = await world();
    gw.failWith = new GatewayError("unavailable", "the provider did not answer");
    const first = await pay(w.i, w.ana, "pay-5", { amount: 2_500 });
    expect(first.status).toBe(502);
    expect(first.body).toMatchObject({ type: "payment-provider-unavailable", title: "The payment provider did not answer", status: 502 });
    gw.failWith = null;
    const second = await pay(w.i, w.ana, "pay-5", { amount: 2_500 });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(new Set(gw.calls.map((c) => c.idempotencyKey)).size, "every call of this payment uses one provider key").toBe(1);
    expect(gw.charges.size).toBe(1);
    expect(await charged()).toHaveLength(1);
  });

  it("provider charged but its answer was lost: the request sent again gets the charge already made, not a second one", async () => {
    const w = await world();
    const charge = gw.charge;
    gw.charge = async (req) => {
      await charge(req);
      throw new GatewayError("unavailable", "timeout after the charge");
    };
    const first = await pay(w.i, w.ana, "pay-6", { amount: 2_500 });
    gw.charge = charge;
    expect(first.status).toBe(502);
    const second = await pay(w.i, w.ana, "pay-6", { amount: 2_500 });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(gw.charges.size, "the card was charged once").toBe(1);
    expect(await charged()).toEqual([expect.objectContaining({ amount: 2_500, provider_ref: "ch_1" })]);
  });

  it("card declined: 402 payment-declined, the payment kept as declined, and the same request again gets the same answer without a call", async () => {
    const w = await world();
    gw.failWith = new GatewayError("declined", "the card was declined");
    const first = await pay(w.i, w.ana, "pay-7", { amount: 2_500 });
    expect(first.status).toBe(402);
    expect(first.body).toMatchObject({ type: "payment-declined", title: "The card was declined", status: 402 });
    gw.failWith = null;
    const again = await pay(w.i, w.ana, "pay-7", { amount: 2_500 });
    expect(again.status).toBe(402);
    expect(again.body).toEqual(first.body);
    expect(gw.calls).toHaveLength(1);
    expect((await payments()).map((p) => p.state)).toEqual(["declined"]);
  });

  it("answers 400 idempotency-key-missing without a usable key, and charges and writes nothing", async () => {
    const w = await world();
    for (const key of [null, "", "has space", "x".repeat(256)]) {
      const res = await pay(w.i, w.ana, key, { amount: 2_500 });
      expect(res.status, String(key)).toBe(400);
      expect(res.body, String(key)).toMatchObject({ type: "idempotency-key-missing", title: "Send an Idempotency-Key", status: 400 });
    }
    expect((await pay(w.i, w.ana, "k".repeat(255), { amount: 2_500 })).status).toBe(201);
    expect(gw.calls).toHaveLength(1);
  });

  it("refuses a bad body with 400 invalid-request and stores nothing: the corrected request with the same key is accepted", async () => {
    const w = await world();
    for (const body of [{}, { amount: 0 }, { amount: 12.5 }, { amount: "2500" }, { amount: 10_000_001 }, { amount: 2_500, currency: "USD" }]) {
      const res = await pay(w.i, w.ana, "pay-8", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body, JSON.stringify(body)).toMatchObject({ type: "invalid-request", status: 400 });
    }
    expect(gw.calls).toEqual([]);
    expect(await payments()).toEqual([]);
    const ok = await pay(w.i, w.ana, "pay-8", { amount: 2_500 });
    expect(ok.status).toBe(201);
  });

  it("answers 401 without a session or with an unknown token, and charges and writes nothing", async () => {
    const w = await world();
    const none = await t.http().post(`/api/invoices/${w.i}/payments`).set("Idempotency-Key", "pay-9").send({ amount: 2_500 });
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ type: "unauthenticated", status: 401 });
    const bad = await t.http().post(`/api/invoices/${w.i}/payments`).set("Authorization", "Bearer not-a-session").set("Idempotency-Key", "pay-9").send({ amount: 2_500 });
    expect(bad.status).toBe(401);
    expect(gw.calls).toEqual([]);
    expect(await payments()).toEqual([]);
  });

  it("answers 404 invoice-not-found for an invoice of another team, as for one that does not exist, before the key and the body", async () => {
    const w = await world();
    const other = await pay(w.k, w.ana, "pay-10", { amount: 2_500 });
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject(NO_INVOICE);
    expect(other.headers["content-type"]).toMatch(/application\/problem\+json/);
    const missing = await pay("00000000-0000-4000-8000-000000000000", w.ana, "pay-10", { amount: 2_500 });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(other.body);
    expect((await pay("not-a-uuid", w.ana, "pay-10", { amount: 2_500 })).status).toBe(404);
    expect((await pay(w.k, w.ana, null, { amount: "lots" })).status).toBe(404);
    expect(gw.calls).toEqual([]);
    expect(await payments()).toEqual([]);
    // the refused requests stored nothing under the key
    expect((await pay(w.i, w.ana, "pay-10", { amount: 2_500 })).status).toBe(201);
  });
});
