// Held-out tests of the level 2 case team-comes-from-the-session (plugins/aidw/roles/backend/evals/level2/). They are
// copied into the temp copy only after the Agent finished, so it never sees them. They check the contract of
// POST /api/projects/{projectId}/tasks in .aidw/changes/create-task/api-contract.md through the route.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testApp, type TestApp } from "../helpers.ts";

let t: TestApp;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.close());

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const NO_PROJECT = { type: "project-not-found", title: "No such project", status: 404 };

/** ana is in Alpha (project p), bo is in Beta (project q). */
async function world() {
  const ana = await t.seed.user("ana");
  const bo = await t.seed.user("bo");
  const alpha = await t.seed.team("Alpha", [ana]);
  const beta = await t.seed.team("Beta", [bo]);
  const p = await t.seed.project(alpha.id, "Website");
  const q = await t.seed.project(beta.id, "Billing");
  return { ana, bo, alpha, beta, p, q };
}

const tasks = () => t.db.query<{ project_id: string; team_id: string; created_by: string; title: string; due_date: string | null }>(
  "select project_id, team_id, created_by, title, to_char(due_date, 'YYYY-MM-DD') as due_date from tasks",
);
const post = (projectId: string) => t.http().post(`/api/projects/${projectId}/tasks`);

describe("held-out: POST /api/projects/:projectId/tasks", () => {
  it("creates the task for a member, in the project's team, created by the caller", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).send({ title: "Write the release notes", dueDate: day(7) });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "dueDate", "id", "title"]);
    expect(res.body).toMatchObject({ title: "Write the release notes", dueDate: day(7) });
    expect(typeof res.body.id).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    expect(await tasks()).toEqual([{ project_id: w.p.id, team_id: w.alpha.id, created_by: w.ana.id, title: "Write the release notes", due_date: day(7) }]);
  });

  it("gives dueDate null when none is sent, and trims the title", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).send({ title: "  Plan the sprint  " });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Plan the sprint", dueDate: null });
  });

  it("accepts a due date of today", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).send({ title: "Today", dueDate: day(0) });
    expect(res.status).toBe(201);
  });

  it("answers 401 without a session or with an unknown token, and writes nothing", async () => {
    const w = await world();
    const none = await post(w.p.id).send({ title: "x" });
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ type: "unauthenticated", status: 401 });
    const bad = await post(w.p.id).set("Authorization", "Bearer not-a-session").send({ title: "x" });
    expect(bad.status).toBe(401);
    expect(await tasks()).toEqual([]);
  });

  it("answers 404 project-not-found for a project of another team, as for one that does not exist, and writes nothing", async () => {
    const w = await world();
    const other = await post(w.p.id).set(t.auth(w.bo)).send({ title: "Sneak in" });
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject(NO_PROJECT);
    expect(other.headers["content-type"]).toMatch(/application\/problem\+json/);
    const missing = await post("00000000-0000-4000-8000-000000000000").set(t.auth(w.bo)).send({ title: "Sneak in" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(other.body);
    const notAnId = await post("not-a-uuid").set(t.auth(w.bo)).send({ title: "Sneak in" });
    expect(notAnId.status).toBe(404);
    expect(notAnId.body).toMatchObject(NO_PROJECT);
    expect(await tasks()).toEqual([]);
  });

  it("ignores x-team-id: a caller of another team who names the project's team still gets 404", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.bo)).set("x-team-id", w.alpha.id).send({ title: "Sneak in" });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject(NO_PROJECT);
    expect(await tasks()).toEqual([]);
  });

  it("ignores x-team-id: a member who names another team creates the task in the project's team", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).set("x-team-id", w.beta.id).send({ title: "Ours" });
    expect(res.status).toBe(201);
    expect(await tasks()).toEqual([expect.objectContaining({ project_id: w.p.id, team_id: w.alpha.id, created_by: w.ana.id })]);
  });

  it("checks membership before the body: a caller of another team gets 404 even for a bad body", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.bo)).send({ teamId: w.beta.id });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject(NO_PROJECT);
  });

  it("refuses a teamId field with 400 invalid-request and writes nothing", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).send({ title: "Moved", teamId: w.beta.id });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ type: "invalid-request", status: 400 });
    expect(await tasks()).toEqual([]);
  });

  it("refuses other unknown fields, a missing, empty, long or non-string title and a malformed date with 400", async () => {
    const w = await world();
    const bodies: unknown[] = [
      { title: "x", createdBy: w.bo.id },
      {},
      { title: "" },
      { title: "   " },
      { title: "x".repeat(201) },
      { title: 42 },
      { title: "x", dueDate: "25/12/2030" },
      { title: "x", dueDate: "2030-13-45" },
    ];
    for (const body of bodies) {
      const res = await post(w.p.id).set(t.auth(w.ana)).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body, JSON.stringify(body)).toMatchObject({ type: "invalid-request", status: 400 });
    }
    expect(await tasks()).toEqual([]);
  });

  it("accepts a title of exactly 200 characters", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).send({ title: "x".repeat(200) });
    expect(res.status).toBe(201);
  });

  it("answers 422 due-date-in-past for a date before today and writes nothing", async () => {
    const w = await world();
    const res = await post(w.p.id).set(t.auth(w.ana)).send({ title: "Too late", dueDate: day(-1) });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ type: "due-date-in-past", status: 422 });
    expect(await tasks()).toEqual([]);
  });
});
