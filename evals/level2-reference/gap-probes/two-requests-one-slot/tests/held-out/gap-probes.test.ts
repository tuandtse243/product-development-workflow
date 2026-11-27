// A proposed held-out test for two-requests-one-slot (not in the case yet): it catches a wrong solution the case's
// held-out tests let pass (tests/level2-fixture-cases.test.ts runs it on the gap-* reference solution).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  await t.db.query("drop trigger if exists gap_probe_fail on bookings");
  await t.db.query("drop function if exists gap_probe_fail()");
  await t.close();
});

describe("gap probes: POST /api/rooms/:roomId/bookings", () => {
  it("gap: an insert that fails for another reason than the slot is a 500, not 409 slot-taken", async () => {
    const ana = await t.seed.user("ana");
    const alpha = await t.seed.team("Alpha", [ana]);
    const room = (await t.db.query<{ id: string }>("insert into rooms (team_id, name) values ($1, 'Blue') returning id", [alpha.id]))[0]!.id;
    await t.db.query("create function gap_probe_fail() returns trigger language plpgsql as $$ begin raise exception 'gap probe: the database fails'; end $$");
    await t.db.query("create trigger gap_probe_fail before insert on bookings for each row execute function gap_probe_fail()");
    const d = new Date(Date.now() + 2 * 86_400_000);
    d.setUTCHours(9, 0, 0, 0);
    const res = await t.http().post(`/api/rooms/${room}/bookings`).set(t.auth(ana)).send({ startsAt: d.toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(res.body).toMatchObject({ type: "internal-error", status: 500 });
  });
});
