import { Router } from "express";
import { z } from "zod";
import type { Project } from "../../shared/projects.ts";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { roleOf } from "../teams/repo.ts";
import { findProject, projectsOfUser, type ProjectRow } from "./repo.ts";

/** A project as the API sends it: named fields only, never the row. */
export const toProject = (row: ProjectRow): Project => ({ id: row.id, teamId: row.team_id, name: row.name, createdAt: row.created_at.toISOString() });

const ProjectParams = z.object({ projectId: z.string().uuid() });

/** The projects of the teams the signed-in user belongs to. */
export function projectRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/projects", requireSession(db));

  r.get("/api/projects", async (req, res) => {
    const rows = await projectsOfUser(db, req.session!.userId);
    res.json({ items: rows.map(toProject) });
  });

  r.get("/api/projects/:projectId", async (req, res) => {
    const { projectId } = parse(ProjectParams, req.params);
    const row = await findProject(db, projectId);
    // A project of a team the caller is not in is the same answer as no project.
    if (!row || !(await roleOf(db, req.session!.userId, row.team_id))) throw new HttpError(404, "project-not-found", "No such project");
    res.json(toProject(row));
  });

  return r;
}
