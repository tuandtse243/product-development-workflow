import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJobsOnce } from "../../src/jobs/runner.ts";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  await t.db.query("drop trigger if exists fail_lines on order_lines");
  await t.db.query("drop function if exists fail_lines()");
  await t.close();
});

const product = async (price = 1500, active = true) =>
  (await t.db.query<{ id: string }>("insert into products (name, price_cents, active) values ('Storage', $1, $2) returning id", [price, active]))[0]!.id;
const jobs = () => runJobsOnce({ db: t.db, mailer: t.mailer });
const due = () => t.db.query("update outbox set next_try_at = now(), claimed_until = null where sent_at is null");
const post = (teamId: string) => t.http().post(`/api/teams/${teamId}/orders`);

describe("POST /api/teams/:teamId/orders", () => {
  it("orders/place-an-order/member-places-an-order: the owner's team member orders, and gets one confirmation", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const p = await product();
    const res = await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: p, quantity: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ totalCents: 3000, lines: [{ productId: p, quantity: 2, unitPriceCents: 1500 }] });
    expect(t.mailer.calls).toEqual([]); // nothing is sent by the request itself
    await jobs();
    expect(t.mailer.sent).toEqual([expect.objectContaining({ to: ana.email, subject: "Order received" })]);
    expect(t.mailer.calls[0]!.opts).toMatchObject({ idempotencyKey: expect.any(String), timeoutMs: expect.any(Number) });
  });

  it("orders/place-an-order/no-session: 401", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const res = await post(team.id).send({ lines: [{ productId: await product(), quantity: 1 }] });
    expect(res.status).toBe(401);
    expect(await t.db.query("select 1 from orders")).toEqual([]);
  });

  it("orders/place-an-order/team-of-another-member: 404 team-not-found for another user's team", async () => {
    const ana = await t.seed.user("ana");
    const bo = await t.seed.user("bo");
    const beta = await t.seed.team("Beta", [bo]);
    const res = await post(beta.id).set(t.auth(ana)).send({ lines: [{ productId: await product(), quantity: 1 }] });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ type: "team-not-found", title: "No such team", status: 404 });
    expect(await t.db.query("select 1 from orders")).toEqual([]);
  });

  it("orders/place-an-order/unknown-product: 422 for an inactive product, nothing owed", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const res = await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: await product(900, false), quantity: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ type: "unknown-product" });
    expect(await t.db.query("select 1 from outbox")).toEqual([]);
  });

  it("orders/place-an-order/mail-provider-down: the order is kept, the mail is owed and sent once the provider is back", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    t.mailer.failWith = new Error("down");
    const res = await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: await product(), quantity: 1 }] });
    expect(res.status).toBe(201);
    await jobs();
    expect(await t.db.query("select attempts from outbox where sent_at is null")).toEqual([{ attempts: 1 }]);
    t.mailer.failWith = null;
    await due();
    await jobs();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it("orders/place-an-order/order-write-fails: no order, no outbox row, no mail", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    await t.db.query("create function fail_lines() returns trigger language plpgsql as $$ begin raise exception 'no'; end $$");
    await t.db.query("create trigger fail_lines before insert on order_lines for each row execute function fail_lines()");
    const res = await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: await product(), quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(await t.db.query("select 1 from orders")).toEqual([]);
    expect(await t.db.query("select 1 from outbox")).toEqual([]);
    await jobs();
    expect(t.mailer.calls).toEqual([]);
  });

  it("orders/place-an-order/sender-runs-twice: one call to the provider, after each other or at once", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const p = await product();
    await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: p, quantity: 1 }] });
    await jobs();
    await jobs();
    expect(t.mailer.calls).toHaveLength(1);
    await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: p, quantity: 1 }] });
    await Promise.all([jobs(), jobs()]);
    expect(t.mailer.calls).toHaveLength(2);
  });

  it("gives up after 5 failed attempts", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    t.mailer.failWith = new Error("down");
    await post(team.id).set(t.auth(ana)).send({ lines: [{ productId: await product(), quantity: 1 }] });
    for (let i = 0; i < 7; i++) {
      await due();
      await jobs();
    }
    expect(t.mailer.calls).toHaveLength(5);
  });
});
