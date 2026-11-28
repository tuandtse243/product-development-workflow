import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe("GET /api/teams", () => {
  it("lists the caller's teams with their role", async () => {
    const ana = await t.seed.user("ana");
    await t.seed.team("Alpha", { owners: [ana] });
    await t.seed.team("Beta", { members: [ana] });
    await t.seed.team("Other");
    const res = await t.http().get("/api/teams").set(t.as(ana));
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { name: string; role: string }) => [x.name, x.role])).toEqual([["Alpha", "owner"], ["Beta", "member"]]);
  });

  it("needs a session", async () => {
    expect((await t.http().get("/api/teams")).status).toBe(401);
  });
});
