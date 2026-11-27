// Proposed held-out tests for email-after-the-order (not in the case yet): each catches a wrong solution the case's
// held-out tests let pass (tests/level2-fixture-cases.test.ts runs them on the gap-* reference solutions).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJobsOnce } from "../../src/jobs/runner.ts";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  await t.db.query("drop trigger if exists gap_probe_fail on outbox");
  await t.db.query("drop function if exists gap_probe_fail()");
  await t.close();
});

async function world() {
  const ana = await t.seed.user("ana");
  const alpha = await t.seed.team("Alpha", [ana]);
  const storage = (await t.db.query<{ id: string }>("insert into products (name, price_cents) values ('Extra storage', 1500) returning id"))[0]!.id;
  return { ana, alpha, storage };
}

/** The answer, or "blocked" when none came within `ms`. */
async function within<T>(ms: number, p: Promise<T>): Promise<T | "blocked"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"blocked">((r) => (timer = setTimeout(() => r("blocked"), ms)));
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

describe("gap probes: POST /api/teams/:teamId/orders", () => {
  it("gap: the owed row is in the order's transaction: when writing it fails, the order is not stored either", async () => {
    const w = await world();
    await t.db.query("create function gap_probe_fail() returns trigger language plpgsql as $$ begin raise exception 'gap probe: the outbox write fails'; end $$");
    await t.db.query("create trigger gap_probe_fail before insert on outbox for each row execute function gap_probe_fail()");
    const res = await t.http().post(`/api/teams/${w.alpha.id}/orders`).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] });
    expect(res.status).toBe(500);
    expect(await t.db.query("select id from orders"), "an order stored without the email it owes").toEqual([]);
  });

  it("gap: the sender holds no transaction open while it calls the provider", async () => {
    const w = await world();
    expect((await t.http().post(`/api/teams/${w.alpha.id}/orders`).set(t.auth(w.ana)).send({ lines: [{ productId: w.storage, quantity: 1 }] })).status).toBe(201);
    // PGlite runs one transaction at a time and a statement outside it waits for it: a statement sent from inside the
    // provider call is answered at once unless the sender's own transaction is still open around the call.
    const seen: string[] = [];
    const send = t.mailer.send.bind(t.mailer);
    t.mailer.send = async (mail, opts) => {
      const r = await within(1_000, t.db.query("select 1 as one"));
      seen.push(r === "blocked" ? "a transaction was open during the send" : "free");
      return send(mail, opts);
    };
    await runJobsOnce({ db: t.db, mailer: t.mailer });
    expect(seen).toEqual(["free"]);
  });
});
