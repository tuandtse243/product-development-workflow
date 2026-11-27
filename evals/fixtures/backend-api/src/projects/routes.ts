import { Router } from "express";
import type { Db } from "../db/client.ts";
import { HttpError, invalidRequest } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { findProject, projectsOfTeam } from "./repo.ts";

/**
 * Projects of the team the web app has selected. The web app sends the selected team in the `x-team-id` header on
 * every call.
 */
export function projectRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/projects", requireSession(db));

  r.get("/api/projects", async (req, res) => {
    const teamId = req.header("x-team-id");
    if (!teamId) throw invalidRequest("x-team-id is required");
    res.json({ items: await projectsOfTeam(db, teamId) });
  });

  r.get("/api/projects/:projectId", async (req, res) => {
    const project = await findProject(db, req.params.projectId);
    if (!project || project.team_id !== req.header("x-team-id")) throw new HttpError(404, "project-not-found", "No such project");
    res.json(project);
  });

  return r;
}
