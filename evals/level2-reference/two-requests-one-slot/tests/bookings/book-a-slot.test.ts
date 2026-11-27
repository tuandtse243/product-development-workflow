import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const hour = (days: number, hh = 9) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hh, 0, 0, 0);
  return d.toISOString();
};
const room = async (teamId: string) => (await t.db.query<{ id: string }>("insert into rooms (team_id, name) values ($1, 'Blue') returning id", [teamId]))[0]!.id;
const active = () => t.db.query<{ booked_by: string }>("select booked_by from bookings where status = 'active'");
const post = (roomId: string) => t.http().post(`/api/rooms/${roomId}/bookings`);

describe("POST /api/rooms/:roomId/bookings", () => {
  it("bookings/book-a-slot/member-books-a-free-slot: the owner's team member books an hour", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const r = await room(team.id);
    const res = await post(r).set(t.auth(ana)).send({ startsAt: hour(1) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ roomId: r, startsAt: hour(1) });
    expect(await active()).toEqual([{ booked_by: ana.id }]);
  });

  it("bookings/book-a-slot/no-session: 401 and nothing written", async () => {
    const ana = await t.seed.user("ana");
    const r = await room((await t.seed.team("Alpha", [ana])).id);
    const res = await post(r).send({ startsAt: hour(1) });
    expect(res.status).toBe(401);
    expect(await active()).toEqual([]);
  });

  it("bookings/book-a-slot/room-of-another-team: 404 room-not-found for another user's room", async () => {
    const ana = await t.seed.user("ana");
    const bo = await t.seed.user("bo");
    const r = await room((await t.seed.team("Beta", [bo])).id);
    const res = await post(r).set(t.auth(ana)).send({ startsAt: hour(1) });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ type: "room-not-found", title: "No such room", status: 404 });
    expect(await active()).toEqual([]);
  });

  it("bookings/book-a-slot/slot-already-taken: 409 slot-taken", async () => {
    const ana = await t.seed.user("ana");
    const r = await room((await t.seed.team("Alpha", [ana])).id);
    await post(r).set(t.auth(ana)).send({ startsAt: hour(1) });
    const res = await post(r).set(t.auth(ana)).send({ startsAt: hour(1) });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ type: "slot-taken", title: "The slot is already booked", status: 409 });
  });

  it("bookings/book-a-slot/two-bookings-at-once: ten at once, one 201 and nine 409, one active booking", async () => {
    const users: { id: string; token: string }[] = [];
    for (let i = 0; i < 5; i++) users.push(await t.seed.user(`u${i}`));
    const r = await room((await t.seed.team("Alpha", users)).id);
    const all = await Promise.all(Array.from({ length: 10 }, (_, i) => post(r).set(t.auth(users[i % 5]!)).send({ startsAt: hour(2) })));
    expect(all.map((x) => x.status).sort()).toEqual([201, ...Array(9).fill(409)]);
    expect(await active()).toHaveLength(1);
  });

  it("bookings/book-a-slot/cancelled-booking-frees-the-slot: 201", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const r = await room(team.id);
    await t.db.query("insert into bookings (room_id, team_id, booked_by, starts_at, status) values ($1, $2, $3, $4, 'cancelled')", [r, team.id, ana.id, hour(3)]);
    expect((await post(r).set(t.auth(ana)).send({ startsAt: hour(3) })).status).toBe(201);
  });

  it("bookings/book-a-slot/slot-in-the-past: 422 slot-in-past", async () => {
    const ana = await t.seed.user("ana");
    const r = await room((await t.seed.team("Alpha", [ana])).id);
    const res = await post(r).set(t.auth(ana)).send({ startsAt: hour(-1) });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ type: "slot-in-past" });
  });

  it("refuses an hour that is not on the hour with 400", async () => {
    const ana = await t.seed.user("ana");
    const r = await room((await t.seed.team("Alpha", [ana])).id);
    const res = await post(r).set(t.auth(ana)).send({ startsAt: hour(1).replace(":00:00", ":30:00") });
    expect(res.status).toBe(400);
  });
});
