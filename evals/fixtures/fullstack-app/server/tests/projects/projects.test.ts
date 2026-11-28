import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

describe("GET /api/projects", () => {
  it("lists the projects of the teams the caller belongs to, by name, as named fields", async () => {
    const ana = await t.seed.user("ana");
    const alpha = await t.seed.team("Alpha", { owners: [ana] });
    const beta = await t.seed.team("Beta", { members: [ana] });
    const other = await t.seed.team("Other");
    await t.seed.project(alpha.id, "Website");
    await t.seed.project(beta.id, "api");
    await t.seed.project(other.id, "Secret");
    const res = await t.http().get("/api/projects").set(t.as(ana));
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: { name: string }) => x.name)).toEqual(["api", "Website"]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(["createdAt", "id", "name", "teamId"]);
  });

  it("needs a session", async () => {
    const res = await t.http().get("/api/projects");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
  });
});

describe("GET /api/projects/:projectId", () => {
  it("returns a project of a team the caller belongs to", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha", { members: [ana] });
    const p = await t.seed.project(team.id, "Website");
    const res = await t.http().get(`/api/projects/${p.id}`).set(t.as(ana));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: p.id, teamId: team.id, name: "Website" });
  });

  it("is 404 project-not-found for a project of a team the caller is not in", async () => {
    const ana = await t.seed.user("ana");
    const team = await t.seed.team("Alpha");
    const p = await t.seed.project(team.id, "Website");
    const res = await t.http().get(`/api/projects/${p.id}`).set(t.as(ana));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("project-not-found");
  });

  it("is 400 invalid-request for an id that is not a uuid", async () => {
    const ana = await t.seed.user("ana");
    const res = await t.http().get("/api/projects/not-an-id").set(t.as(ana));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid-request");
  });

  it("needs a session", async () => {
    const res = await t.http().get("/api/projects/00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(401);
  });
});
