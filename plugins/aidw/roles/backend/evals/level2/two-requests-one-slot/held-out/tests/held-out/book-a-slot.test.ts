// Held-out tests of the level 2 case two-requests-one-slot (plugins/aidw/roles/backend/evals/level2/). They are copied
// into the temp copy only after the Agent finished. They check the contract of POST /api/rooms/{roomId}/bookings in
// .aidw/changes/book-a-room/api-contract.md through the route.
//
// PGlite gives the app one connection that runs one statement at a time, so two transactions never overlap here as
// they do on a real Postgres. Two tests make the race real anyway:
// - "two bookings at once" sends ten bookings of one slot together, with every statement outside a transaction slowed
//   down so that they interleave: a check followed by an insert outside a transaction lets several pass the check, and
//   only the unique index stops the rest.
// - "another booking lands between" puts a rival booking into the slot from inside the route's own insert (a BEFORE
//   INSERT trigger), which is what another instance committing between the route's check and its write looks like on
//   Postgres. A route where the database decides (an insert whose unique violation becomes 409, or ON CONFLICT DO
//   NOTHING) answers 409; a route that decided from its own read (in a transaction or not) fails with 500.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  // a trigger outlives the truncate of the next testApp(): never leave one behind
  await t.db.query("drop trigger if exists held_out_rival on bookings");
  await t.db.query("drop function if exists held_out_rival()");
  await t.db.query("drop trigger if exists held_out_fail on bookings");
  await t.db.query("drop function if exists held_out_fail()");
  await t.close();
});

const SLOT_TAKEN = { type: "slot-taken", title: "The slot is already booked", status: 409 };
const NO_ROOM = { type: "room-not-found", title: "No such room", status: 404 };
/** The hour `days` days from now at hh:00 UTC, as an ISO string with Z. */
const hour = (days: number, hh = 9) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hh, 0, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
};
const iso = (s: string) => new Date(s).toISOString();

async function room(teamId: string, name = "Blue") {
  return (await t.db.query<{ id: string }>("insert into rooms (team_id, name) values ($1, $2) returning id", [teamId, name]))[0]!.id;
}

/** ana and cy are in Alpha (room r), bo is in Beta (room q). */
async function world() {
  const ana = await t.seed.user("ana");
  const cy = await t.seed.user("cy");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", [ana, cy]);
  const beta = await t.seed.team("Beta", [bo]);
  return { ana, cy, bo, alpha, beta, r: await room(alpha.id), q: await room(beta.id, "Red") };
}

const bookings = () =>
  t.db.query<{ room_id: string; team_id: string; booked_by: string; starts_at: Date; status: string }>(
    "select room_id, team_id, booked_by, starts_at, status from bookings order by created_at, id",
  );
const active = async () => (await bookings()).filter((b) => b.status === "active");
const post = (roomId: string) => t.http().post(`/api/rooms/${roomId}/bookings`);

describe("held-out: POST /api/rooms/:roomId/bookings", () => {
  it("books a free slot for a member, in the room's team, made by the caller", async () => {
    const w = await world();
    const res = await post(w.r).set(t.auth(w.ana)).send({ startsAt: hour(2) });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "id", "roomId", "startsAt"]);
    expect(res.body).toMatchObject({ roomId: w.r, startsAt: iso(hour(2)) });
    expect(typeof res.body.id).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    const rows = await bookings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ room_id: w.r, team_id: w.alpha.id, booked_by: w.ana.id, status: "active" });
    expect(rows[0]!.starts_at.toISOString()).toBe(iso(hour(2)));
  });

  it("two bookings at once: of ten bookings of one free slot sent together, exactly one wins and nine get 409 slot-taken", async () => {
    const w = await world();
    const members = [w.ana, w.cy];
    for (let i = 0; i < 3; i++) {
      const u = await t.seed.user(`member${i}`);
      await t.db.query("insert into team_members (team_id, user_id) values ($1, $2)", [w.alpha.id, u.id]);
      members.push(u);
    }
    const slot = hour(3, 14);
    // Each statement the app sends outside a transaction waits 20 ms first, so the ten requests all reach their reads
    // before any of them writes, as ten instances on one Postgres would.
    const query = t.db.query;
    t.db.query = async <T,>(sql: string, params?: unknown[]) => {
      await new Promise((r) => setTimeout(r, 20));
      return query.call(t.db, sql, params) as Promise<T[]>;
    };
    let answers: Awaited<ReturnType<ReturnType<typeof post>["send"]>>[];
    try {
      answers = await Promise.all(Array.from({ length: 10 }, (_, i) => post(w.r).set(t.auth(members[i % members.length]!)).send({ startsAt: slot })));
    } finally {
      t.db.query = query;
    }
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses, JSON.stringify(answers.map((a) => a.body))).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    for (const a of answers.filter((x) => x.status === 409)) expect(a.body).toMatchObject(SLOT_TAKEN);
    expect(await active()).toHaveLength(1);
  });

  it("another booking lands between the route's check and its insert: the database decides, the answer is 409 slot-taken, not 500", async () => {
    const w = await world();
    // As another instance would: cy's booking of the same slot is stored just before the route's own row is. The
    // trigger runs inside the route's insert, after anything the route read.
    await t.db.query(`create function held_out_rival() returns trigger language plpgsql as $$
      begin
        if new.booked_by <> '${w.cy.id}'::uuid then
          insert into bookings (room_id, team_id, booked_by, starts_at) values (new.room_id, new.team_id, '${w.cy.id}'::uuid, new.starts_at);
        end if;
        return new;
      end $$`);
    await t.db.query("create trigger held_out_rival before insert on bookings for each row execute function held_out_rival()");
    const res = await post(w.r).set(t.auth(w.ana)).send({ startsAt: hour(4) });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toMatchObject(SLOT_TAKEN);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect((await active()).filter((b) => b.booked_by === w.ana.id)).toEqual([]);
  });

  it("an insert that fails for another reason than the slot is a 500 internal-error, not 409 slot-taken", async () => {
    const w = await world();
    await t.db.query("create function held_out_fail() returns trigger language plpgsql as $$ begin raise exception 'held-out: the database fails'; end $$");
    await t.db.query("create trigger held_out_fail before insert on bookings for each row execute function held_out_fail()");
    const res = await post(w.r).set(t.auth(w.ana)).send({ startsAt: hour(4, 11) });
    expect(res.status, JSON.stringify(res.body)).toBe(500);
    expect(res.body).toMatchObject({ type: "internal-error", status: 500 });
  });

  it("answers 409 slot-taken for a slot booked before, also named in another time zone, and keeps the one booking", async () => {
    const w = await world();
    const slot = hour(5, 10);
    expect((await post(w.r).set(t.auth(w.ana)).send({ startsAt: slot })).status).toBe(201);
    const again = await post(w.r).set(t.auth(w.cy)).send({ startsAt: slot });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject(SLOT_TAKEN);
    const shifted = new Date(new Date(slot).getTime() + 2 * 3_600_000).toISOString().replace(".000Z", "+02:00");
    const other = await post(w.r).set(t.auth(w.cy)).send({ startsAt: shifted });
    expect(other.status).toBe(409);
    expect(await active()).toEqual([expect.objectContaining({ booked_by: w.ana.id })]);
  });

  it("a cancelled booking does not hold the slot", async () => {
    const w = await world();
    const slot = hour(6);
    await t.db.query("insert into bookings (room_id, team_id, booked_by, starts_at, status, cancelled_at) values ($1, $2, $3, $4, 'cancelled', now())", [
      w.r,
      w.alpha.id,
      w.cy.id,
      slot,
    ]);
    const res = await post(w.r).set(t.auth(w.ana)).send({ startsAt: slot });
    expect(res.status).toBe(201);
    expect(await active()).toEqual([expect.objectContaining({ booked_by: w.ana.id })]);
  });

  it("the same hour of another room and the next hour of the same room are other slots", async () => {
    const w = await world();
    const blue2 = await room(w.alpha.id, "Green");
    expect((await post(w.r).set(t.auth(w.ana)).send({ startsAt: hour(7, 9) })).status).toBe(201);
    expect((await post(blue2).set(t.auth(w.ana)).send({ startsAt: hour(7, 9) })).status).toBe(201);
    expect((await post(w.r).set(t.auth(w.ana)).send({ startsAt: hour(7, 10) })).status).toBe(201);
    expect(await active()).toHaveLength(3);
  });

  it("answers 401 without a session or with an unknown token, and writes nothing", async () => {
    const w = await world();
    const none = await post(w.r).send({ startsAt: hour(2) });
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ type: "unauthenticated", status: 401 });
    const bad = await post(w.r).set("Authorization", "Bearer not-a-session").send({ startsAt: hour(2) });
    expect(bad.status).toBe(401);
    expect(await bookings()).toEqual([]);
  });

  it("answers 404 room-not-found for a room of another team, as for one that does not exist, and writes nothing", async () => {
    const w = await world();
    const other = await post(w.q).set(t.auth(w.ana)).send({ startsAt: hour(2) });
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject(NO_ROOM);
    const missing = await post("00000000-0000-4000-8000-000000000000").set(t.auth(w.ana)).send({ startsAt: hour(2) });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(other.body);
    const notAnId = await post("not-a-uuid").set(t.auth(w.ana)).send({ startsAt: hour(2) });
    expect(notAnId.status).toBe(404);
    expect(notAnId.body).toMatchObject(NO_ROOM);
    // membership before the body
    const badBody = await post(w.q).set(t.auth(w.ana)).send({ when: "soon" });
    expect(badBody.status).toBe(404);
    expect(await bookings()).toEqual([]);
  });

  it("refuses a missing, malformed, zoneless or off-the-hour startsAt and unknown fields with 400, and writes nothing", async () => {
    const w = await world();
    const h = hour(2);
    const bodies: unknown[] = [
      {},
      { startsAt: 42 },
      { startsAt: "next tuesday" },
      { startsAt: h.replace("Z", "") },
      { startsAt: h.replace(":00:00Z", ":30:00Z") },
      { startsAt: h.replace(":00:00Z", ":00:15Z") },
      { startsAt: h, roomId: w.q },
      { startsAt: h, bookedBy: w.cy.id },
    ];
    for (const body of bodies) {
      const res = await post(w.r).set(t.auth(w.ana)).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body, JSON.stringify(body)).toMatchObject({ type: "invalid-request", status: 400 });
    }
    expect(await bookings()).toEqual([]);
  });

  it("answers 422 slot-in-past for an hour that has begun or passed, and writes nothing", async () => {
    const w = await world();
    const thisHour = new Date();
    thisHour.setUTCMinutes(0, 0, 0);
    for (const startsAt of [hour(-1), thisHour.toISOString()]) {
      const res = await post(w.r).set(t.auth(w.ana)).send({ startsAt });
      expect(res.status, startsAt).toBe(422);
      expect(res.body).toMatchObject({ type: "slot-in-past", status: 422 });
    }
    expect(await bookings()).toEqual([]);
  });
});
