import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe("GET /api/teams", () => {
  it("lists only the caller's teams", async () => {
    const ana = await t.seed.user("ana");
    const bo = await t.seed.user("bo");
    await t.seed.team("Alpha", [ana]);
    await t.seed.team("Beta", [bo]);
    const res = await t.http().get("/api/teams").set(t.auth(ana));
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { name: string }) => x.name)).toEqual(["Alpha"]);
  });

  it("needs a session", async () => {
    const res = await t.http().get("/api/teams");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ type: "unauthenticated", title: "Sign in first", status: 401 });
  });
});

describe("GET /api/teams/:teamId/members", () => {
  it("lists the members of the caller's team", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const res = await t.http().get(`/api/teams/${team.id}/members`).set(t.auth(ana));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ userId: ana.id, name: "ana", role: "member" }]);
  });

  it("answers 404 for a team the caller is not in", async () => {
    const ana = await t.seed.user("ana");
    const bo = await t.seed.user("bo");
    const team = await t.seed.team("Beta", [bo]);
    const res = await t.http().get(`/api/teams/${team.id}/members`).set(t.auth(ana));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ type: "team-not-found", title: "No such team", status: 404 });
  });

  it("needs a session", async () => {
    const res = await t.http().get("/api/teams/00000000-0000-4000-8000-000000000000/members");
    expect(res.status).toBe(401);
  });
});
