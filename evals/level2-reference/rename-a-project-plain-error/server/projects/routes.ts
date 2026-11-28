import { Router } from "express";
import { z } from "zod";
import { PROJECT_NAME_MAX, renameProjectSchema, type NameProblem, type Project } from "../../shared/projects.ts";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { roleOf } from "../teams/repo.ts";
import { findProject, nameTaken, projectsOfUser, renameProject, type ProjectRow } from "./repo.ts";

/** A project as the API sends it: named fields only, never the row. */
export const toProject = (row: ProjectRow): Project => ({ id: row.id, teamId: row.team_id, name: row.name, createdAt: row.created_at.toISOString() });

const ProjectParams = z.object({ projectId: z.string().uuid() });

const refused = (name: NameProblem) => new HttpError(422, "validation", "That name is not available");

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

  r.patch("/api/projects/:projectId", async (req, res) => {
    const { projectId } = parse(ProjectParams, req.params);
    const row = await findProject(db, projectId);
    const role = row ? await roleOf(db, req.session!.userId, row.team_id) : null;
    if (!row || !role) throw new HttpError(404, "project-not-found", "No such project");
    if (role !== "owner") throw new HttpError(403, "forbidden", "Only owners can rename a project");

    const body = parse(renameProjectSchema, req.body);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw refused("required");
    if (name.length > PROJECT_NAME_MAX) throw refused("too-long");
    if (await nameTaken(db, row.team_id, name, row.id)) throw refused("taken");
    try {
      res.json(toProject(await renameProject(db, row.id, name)));
    } catch (e) {
      // Two renames to one name at once: the unique index of the team decides.
      if ((e as { code?: string }).code === "23505") throw refused("taken");
      throw e;
    }
  });

  return r;
}
