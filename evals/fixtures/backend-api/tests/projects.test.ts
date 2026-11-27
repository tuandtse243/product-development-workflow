import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe("GET /api/projects", () => {
  it("lists the projects of the selected team", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    await t.seed.project(team.id, "Website");
    const res = await t.http().get("/api/projects").set(t.auth(ana)).set("x-team-id", team.id);
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { name: string }) => x.name)).toEqual(["Website"]);
  });
});

describe("GET /api/projects/:projectId", () => {
  it("returns a project of the selected team", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", [ana]);
    const p = await t.seed.project(team.id, "Website");
    const res = await t.http().get(`/api/projects/${p.id}`).set(t.auth(ana)).set("x-team-id", team.id);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Website");
  });

  it("needs a session", async () => {
    const res = await t.http().get("/api/projects/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(401);
  });
});
