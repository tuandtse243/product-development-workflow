// A wrong solution, laid over the reference one: it copies the projects routes and trusts the x-team-id header. The
// held-out tests must fail it (tests/level2-fixture.test.ts).
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { findProject } from "../projects/repo.ts";
import { createTask } from "./repo.ts";

const Body = z.object({ title: z.string().trim().min(1).max(200), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();

export function taskRoutes(db: Db): Router {
  const r = Router();
  r.post("/api/projects/:projectId/tasks", requireSession(db), async (req, res) => {
    const project = /^[0-9a-f-]{36}$/.test(req.params.projectId) ? await findProject(db, req.params.projectId) : null;
    if (!project || project.team_id !== req.header("x-team-id")) throw new HttpError(404, "project-not-found", "No such project");
    const body = parse(Body, req.body);
    if (body.dueDate && body.dueDate < new Date().toISOString().slice(0, 10)) throw new HttpError(422, "due-date-in-past", "The due date is in the past");
    const task = await createTask(db, { projectId: project.id, teamId: project.team_id, createdBy: req.session!.userId, title: body.title, dueDate: body.dueDate ?? null });
    res.status(201).json({ id: task.id, title: task.title, dueDate: task.due_date, createdAt: task.created_at.toISOString() });
  });
  return r;
}
