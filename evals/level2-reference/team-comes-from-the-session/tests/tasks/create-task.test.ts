import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const count = async () => (await t.db.query<{ n: number }>("select count(*)::int as n from tasks"))[0]!.n;

async function world() {
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", [ana]);
  const beta = await t.seed.team("Beta", [bo]);
  const p = await t.seed.project(alpha.id);
  return { ana, bo, alpha, beta, p };
}

describe("POST /api/projects/:projectId/tasks", () => {
  it("tasks/create-a-task/member-creates-a-task: 201 with the four fields, in the project's team", async () => {
    const w = await world();
    const res = await t.http().post(`/api/projects/${w.p.id}/tasks`).set(t.auth(w.ana)).send({ title: "Notes", dueDate: tomorrow() });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "dueDate", "id", "title"]);
    const [row] = await t.db.query<{ team_id: string; created_by: string }>("select team_id, created_by from tasks");
    expect(row).toEqual({ team_id: w.alpha.id, created_by: w.ana.id });
  });

  it("tasks/create-a-task/no-session: 401 and nothing written", async () => {
    const w = await world();
    const res = await t.http().post(`/api/projects/${w.p.id}/tasks`).send({ title: "Notes" });
    expect(res.status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("tasks/create-a-task/project-of-another-team: 404 project-not-found and nothing written", async () => {
    const w = await world();
    const res = await t.http().post(`/api/projects/${w.p.id}/tasks`).set(t.auth(w.bo)).send({ title: "Notes" });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ type: "project-not-found", status: 404 });
    expect(await count()).toBe(0);
  });

  it("tasks/create-a-task/team-named-in-the-request: teamId is refused, x-team-id is ignored", async () => {
    const w = await world();
    const field = await t.http().post(`/api/projects/${w.p.id}/tasks`).set(t.auth(w.ana)).send({ title: "Notes", teamId: w.beta.id });
    expect(field.status).toBe(400);
    expect(field.body).toMatchObject({ type: "invalid-request" });
    const header = await t.http().post(`/api/projects/${w.p.id}/tasks`).set(t.auth(w.bo)).set("x-team-id", w.alpha.id).send({ title: "Notes" });
    expect(header.status).toBe(404);
    expect(await count()).toBe(0);
  });

  it("tasks/create-a-task/due-date-in-the-past: 422 and nothing written", async () => {
    const w = await world();
    const res = await t.http().post(`/api/projects/${w.p.id}/tasks`).set(t.auth(w.ana)).send({ title: "Late", dueDate: "2020-01-01" });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ type: "due-date-in-past" });
    expect(await count()).toBe(0);
  });
});
