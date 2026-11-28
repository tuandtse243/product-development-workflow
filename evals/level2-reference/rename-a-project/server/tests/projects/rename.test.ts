import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const nameOf = async (id: string) => (await t.db.query<{ name: string }>("select name from projects where id = $1", [id]))[0]?.name;

async function team() {
  const owner = await t.seed.user("owner");
  const member = await t.seed.user("member");
  const outsider = await t.seed.user("outsider");
  const alpha = await t.seed.team("Alpha", { owners: [owner], members: [member] });
  const website = await t.seed.project(alpha.id, "Website");
  const gamma = await t.seed.project(alpha.id, "Gamma");
  return { owner, member, outsider, alpha, website, gamma };
}

describe("PATCH /api/projects/:projectId", () => {
  it("projects/rename-a-project/owner-renames: an owner renames, the name is trimmed and the answer is the stored project", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.owner)).send({ name: "  Apollo  " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: x.website.id, teamId: x.alpha.id, name: "Apollo", createdAt: expect.any(String) });
    expect(await nameOf(x.website.id)).toBe("Apollo");
  });

  it("projects/rename-a-project/name-already-taken: a name another project of the team has is 422 validation, whatever its case", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.owner)).send({ name: " gamma " });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: "validation", fields: { name: "taken" } } });
    expect(await nameOf(x.website.id)).toBe("Website");
  });

  it("projects/rename-a-project/blank-name: a blank name is 422 required", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.owner)).send({ name: "   " });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { code: "validation", fields: { name: "required" } } });
  });

  it("projects/rename-a-project/member-is-refused: a member who is not an owner is 403 forbidden and nothing changes", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.member)).send({ name: "Apollo" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
    expect(await nameOf(x.website.id)).toBe("Website");
  });

  it("projects/rename-a-project/signed-out-caller: no session is 401 unauthenticated", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).send({ name: "Apollo" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
    expect(await nameOf(x.website.id)).toBe("Website");
  });

  it("a user outside the team gets 404 project-not-found", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.outsider)).send({ name: "Apollo" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("project-not-found");
  });

  it("a name over 80 characters is 422 too-long, and 80 is fine", async () => {
    const x = await team();
    const long = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.owner)).send({ name: "n".repeat(81) });
    expect(long.status).toBe(422);
    expect(long.body.error.fields).toEqual({ name: "too-long" });
    expect((await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.owner)).send({ name: "n".repeat(80) })).status).toBe(200);
  });

  it("keeping the project's own name is not taken", async () => {
    const x = await team();
    const res = await t.http().patch(`/api/projects/${x.website.id}`).set(t.as(x.owner)).send({ name: "website" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("website");
  });
});
