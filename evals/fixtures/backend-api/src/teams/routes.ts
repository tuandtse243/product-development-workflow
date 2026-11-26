import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { isMember, membersOf, teamsOf } from "./repo.ts";

const TeamParams = z.object({ teamId: z.string().uuid() });
const teamNotFound = () => new HttpError(404, "team-not-found", "No such team");

/** GET /api/teams: the caller's teams. GET /api/teams/:teamId/members: the members of a team the caller is in. */
export function teamRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/teams", requireSession(db));

  r.get("/api/teams", async (req, res) => {
    const teams = await teamsOf(db, req.session!.userId);
    res.json({ items: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })) });
  });

  r.get("/api/teams/:teamId/members", async (req, res) => {
    const params = TeamParams.safeParse(req.params);
    // Not a member reads the same as no such team: a caller learns nothing about teams it is not in.
    if (!params.success || !(await isMember(db, params.data.teamId, req.session!.userId))) throw teamNotFound();
    const members = await membersOf(db, params.data.teamId);
    res.json({ items: members.map((m) => ({ userId: m.user_id, name: m.name, role: m.role })) });
  });

  return r;
}
