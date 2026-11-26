import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { createTask, projectOfMember } from "./repo.ts";

const Params = z.object({ projectId: z.string().uuid() });
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const Body = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueDate: z.string().refine(isDate, "a date YYYY-MM-DD").optional(),
  })
  .strict();

const projectNotFound = () => new HttpError(404, "project-not-found", "No such project");

/** POST /api/projects/:projectId/tasks: a task in a project of one of the caller's teams. */
export function taskRoutes(db: Db): Router {
  const r = Router();
  r.post("/api/projects/:projectId/tasks", requireSession(db), async (req, res) => {
    const userId = req.session!.userId;
    const params = Params.safeParse(req.params);
    const project = params.success ? await projectOfMember(db, params.data.projectId, userId) : null;
    if (!project) throw projectNotFound();
    const body = parse(Body, req.body);
    if (body.dueDate && body.dueDate < today()) throw new HttpError(422, "due-date-in-past", "The due date is in the past");
    const task = await createTask(db, { projectId: project.id, teamId: project.team_id, createdBy: userId, title: body.title, dueDate: body.dueDate ?? null });
    res.status(201).json({ id: task.id, title: task.title, dueDate: task.due_date, createdAt: task.created_at.toISOString() });
  });
  return r;
}
