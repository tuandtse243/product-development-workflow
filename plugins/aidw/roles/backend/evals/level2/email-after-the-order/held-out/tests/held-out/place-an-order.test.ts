// Held-out tests of the level 2 case email-after-the-order (plugins/aidw/roles/backend/evals/level2/). They are copied
// into the temp copy only after the Agent finished. They check the contract of POST /api/teams/{teamId}/orders and its
// confirmation email in .aidw/changes/place-an-order/api-contract.md, through the route and the job runner
// (runJobsOnce, src/jobs/runner.ts), with the mail provider replaced by t.mailer (memoryMailer).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/client.ts";
import { runJobsOnce } from "../../src/jobs/runner.ts";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  // a trigger outlives the truncate of the next testApp(): never leave one behind
  await t.db.query("drop trigger if exists held_out_fail on order_lines");
  await t.db.query("drop function if exists held_out_fail()");
  await t.close();
});

const NO_TEAM = { type: "team-not-found", title: "No such team", status: 404 };
const mailer = () => t.mailer;
const jobs = (db: Db = t.db) => runJobsOnce({ db, mailer: t.mailer });
/** Time passes: every mail not sent yet is due again and no sender holds it any more. */
const later = () => t.db.query("update outbox set next_try_at = now() - interval '1 second', claimed_until = null where sent_at is null");
/** The same database, each statement outside a transaction delayed: two job rounds at once interleave. */
const slow = (): Db => ({
  ...t.db,
  query: async <T,>(sql: string, params?: unknown[]) => {
    await new Promise((r) => setTimeout(r, 20));
    return t.db.query<T>(sql, params);
  },
});

async function product(name: string, priceCents: number, active = true) {
  return (await t.db.query<{ id: string }>("insert into products (name, price_cents, active) values ($1, $2, $3) returning id", [name, priceCents, active]))[0]!.id;
}

/** ana is in Alpha, bo is in Beta; two products and an inactive one. */
async function world() {
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", [ana]);
  const beta = await t.seed.team("Beta", [bo]);
  return { ana, bo, alpha, beta, storage: await product("Extra storage", 1500), support: await product("Priority support", 4900), old: await product("Fax line", 900, false) };
}

const orders = () => t.db.query<{ id: string; team_id: string; placed_by: string; total_cents: number }>("select id, team_id, placed_by, total_cents from orders");
const lines = () =>
  t.db.query<{ order_id: string; line_no: number; product_id: string; quantity: number; unit_price_cents: number }>(
    "select order_id, line_no, product_id, quantity, unit_price_cents from order_lines order by line_no",
  );
const post = (teamId: string) => t.http().post(`/api/teams/${teamId}/orders`);

describe("held-out: POST /api/teams/:teamId/orders", () => {
  it("places the order for a member at the products' prices, and the caller gets one confirmation, sent with a timeout", async () => {
    const w = await world();
    const res = await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 3 }, { productId: w.support, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "id", "lines", "totalCents"]);
    expect(res.body).toMatchObject({
      totalCents: 9400,
      lines: [
        { productId: w.storage, quantity: 3, unitPriceCents: 1500 },
        { productId: w.support, quantity: 1, unitPriceCents: 4900 },
      ],
    });
    expect(Object.keys(res.body.lines[0]).sort()).toEqual(["productId", "quantity", "unitPriceCents"]);
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    expect(await orders()).toEqual([{ id: res.body.id, team_id: w.alpha.id, placed_by: w.ana.id, total_cents: 9400 }]);
    expect(await lines()).toEqual([
      { order_id: res.body.id, line_no: 1, product_id: w.storage, quantity: 3, unit_price_cents: 1500 },
      { order_id: res.body.id, line_no: 2, product_id: w.support, quantity: 1, unit_price_cents: 4900 },
    ]);
    await jobs();
    expect(mailer().sent).toHaveLength(1);
    expect(mailer().sent[0]).toMatchObject({ to: w.ana.email, subject: "Order received" });
    expect(mailer().sent[0]!.text).toContain(res.body.id);
    expect(mailer().calls).toHaveLength(1);
    expect(mailer().calls[0]!.opts?.timeoutMs, "Mailer.send gets an explicit timeoutMs").toBeGreaterThan(0);
  });

  it("order write fails part way: nothing is stored and no confirmation is ever sent", async () => {
    const w = await world();
    await t.db.query("create function held_out_fail() returns trigger language plpgsql as $$ begin raise exception 'held-out: storing a line fails'; end $$");
    await t.db.query("create trigger held_out_fail before insert on order_lines for each row execute function held_out_fail()");
    const res = await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ type: "internal-error", status: 500 });
    expect(mailer().calls, "no mail is sent while the order is being stored").toEqual([]);
    await t.db.query("drop trigger held_out_fail on order_lines");
    expect(await orders()).toEqual([]);
    expect(await lines()).toEqual([]);
    await jobs();
    await later();
    await jobs();
    expect(mailer().calls, "no mail for an order that was not stored").toEqual([]);
  });

  it("mail provider down: the order is placed, and the confirmation is sent once the provider is back, once", async () => {
    const w = await world();
    mailer().failWith = new Error("mail provider down");
    const res = await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(await orders()).toHaveLength(1);
    await jobs();
    expect(mailer().sent).toEqual([]);
    mailer().failWith = null;
    await later();
    await jobs();
    expect(mailer().sent).toHaveLength(1);
    expect(mailer().sent[0]).toMatchObject({ to: w.ana.email, subject: "Order received" });
    const calls = mailer().calls.length;
    await later();
    await jobs();
    expect(mailer().calls).toHaveLength(calls);
  });

  it("sender runs twice, one round after the other: the provider is asked once", async () => {
    const w = await world();
    expect((await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] })).status).toBe(201);
    await jobs();
    await jobs();
    expect(mailer().calls).toHaveLength(1);
    expect(mailer().sent).toHaveLength(1);
  });

  it("sender runs twice at the same moment (two instances): the provider is asked once", async () => {
    const w = await world();
    expect((await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] })).status).toBe(201);
    await Promise.all([jobs(slow()), jobs(slow())]);
    await jobs();
    expect(mailer().calls).toHaveLength(1);
    expect(mailer().sent).toHaveLength(1);
  });

  it("a send whose answer was lost is sent again with the same idempotency key, so the customer gets one email", async () => {
    const w = await world();
    mailer().failAfterSend = new Error("timeout: the provider accepted the mail but its answer was lost");
    expect((await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] })).status).toBe(201);
    await jobs();
    mailer().failAfterSend = null;
    await later();
    await jobs();
    expect(mailer().calls).toHaveLength(2);
    expect(mailer().calls[1]!.opts?.idempotencyKey).toBe(mailer().calls[0]!.opts?.idempotencyKey);
    expect(mailer().sent).toHaveLength(1);
  });

  it("gives a confirmation up after 5 failed attempts and does not try it again", async () => {
    const w = await world();
    mailer().failWith = new Error("mail provider down");
    expect((await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] })).status).toBe(201);
    for (let round = 0; round < 8; round++) {
      await later();
      await jobs();
    }
    expect(mailer().calls).toHaveLength(5);
    mailer().failWith = null;
    await later();
    await jobs();
    expect(mailer().calls).toHaveLength(5);
  });

  it("answers 422 unknown-product for a product that does not exist or is not active, stores nothing and sends nothing", async () => {
    const w = await world();
    for (const productId of ["00000000-0000-4000-8000-000000000000", w.old]) {
      const res = await post(w.alpha.id).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }, { productId, quantity: 1 }] });
      expect(res.status, productId).toBe(422);
      expect(res.body).toMatchObject({ type: "unknown-product", title: "No such product", status: 422 });
    }
    expect(await orders()).toEqual([]);
    await jobs();
    expect(mailer().calls).toEqual([]);
  });

  it("refuses bad bodies with 400 invalid-request, stores nothing and sends nothing", async () => {
    const w = await world();
    const line = { productId: w.storage, quantity: 1 };
    const bodies: unknown[] = [
      {},
      { lines: [] },
      { lines: Array.from({ length: 21 }, () => line) },
      { lines: [{ productId: w.storage }] },
      { lines: [{ productId: w.storage, quantity: 0 }] },
      { lines: [{ productId: w.storage, quantity: 100 }] },
      { lines: [{ productId: w.storage, quantity: 1.5 }] },
      { lines: [{ productId: "not-a-uuid", quantity: 1 }] },
      { lines: [{ ...line, unitPriceCents: 1 }] },
      { lines: [line], teamId: w.beta.id },
    ];
    for (const body of bodies) {
      const res = await post(w.alpha.id).set(t.auth(w.ana)).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body, JSON.stringify(body)).toMatchObject({ type: "invalid-request", status: 400 });
    }
    expect(await orders()).toEqual([]);
    await jobs();
    expect(mailer().calls).toEqual([]);
  });

  it("answers 401 without a session or with an unknown token, stores nothing and sends nothing", async () => {
    const w = await world();
    const body = { lines: [{ productId: w.storage, quantity: 1 }] };
    const none = await post(w.alpha.id).send(body);
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ type: "unauthenticated", status: 401 });
    const bad = await post(w.alpha.id).set("Authorization", "Bearer not-a-session").send(body);
    expect(bad.status).toBe(401);
    expect(await orders()).toEqual([]);
    await jobs();
    expect(mailer().calls).toEqual([]);
  });

  it("answers 404 team-not-found for a team the caller is not in, as for one that does not exist, before the body", async () => {
    const w = await world();
    const body = { lines: [{ productId: w.storage, quantity: 1 }] };
    const other = await post(w.beta.id).set(t.auth(w.ana)).send(body);
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject(NO_TEAM);
    expect(other.headers["content-type"]).toMatch(/application\/problem\+json/);
    const missing = await post("00000000-0000-4000-8000-000000000000").set(t.auth(w.ana)).send(body);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(other.body);
    const notAnId = await post("not-a-uuid").set(t.auth(w.ana)).send(body);
    expect(notAnId.status).toBe(404);
    const badBody = await post(w.beta.id).set(t.auth(w.ana)).send({ lines: "all of them" });
    expect(badBody.status).toBe(404);
    expect(await orders()).toEqual([]);
    await jobs();
    expect(mailer().calls).toEqual([]);
  });
});
