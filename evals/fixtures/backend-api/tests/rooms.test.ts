import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const room = async (teamId: string, name = "Blue") =>
  (await t.db.query<{ id: string }>("insert into rooms (team_id, name) values ($1, $2) returning id", [teamId, name]))[0]!.id;

describe("GET /api/rooms/:roomId/slots/:startsAt", () => {
  it("says whether a slot of the caller's team's room is free", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const r = await room(team.id);
    await t.db.query("insert into bookings (room_id, team_id, booked_by, starts_at) values ($1, $2, $3, $4)", [r, team.id, ana.id, "2030-01-07T09:00:00Z"]);
    const taken = await t.http().get(`/api/rooms/${r}/slots/2030-01-07T09:00:00Z`).set(t.auth(ana));
    expect(taken.status).toBe(200);
    expect(taken.body).toEqual({ startsAt: "2030-01-07T09:00:00.000Z", free: false });
    const free = await t.http().get(`/api/rooms/${r}/slots/2030-01-07T10:00:00Z`).set(t.auth(ana));
    expect(free.body).toEqual({ startsAt: "2030-01-07T10:00:00.000Z", free: true });
  });

  it("answers 404 for a room of another team", async () => {
    const ana = await t.seed.user("ana");
    const bo = await t.seed.user("bo");
    const beta = await t.seed.team("Beta", [bo]);
    const r = await room(beta.id);
    const res = await t.http().get(`/api/rooms/${r}/slots/2030-01-07T09:00:00Z`).set(t.auth(ana));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ type: "room-not-found", title: "No such room", status: 404 });
  });

  it("needs a session", async () => {
    const res = await t.http().get("/api/rooms/00000000-0000-4000-8000-000000000000/slots/2030-01-07T09:00:00Z");
    expect(res.status).toBe(401);
  });
});
