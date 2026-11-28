import { Router } from "express";
import type { Db } from "../db/client.ts";
import { requireSession } from "../http/session.ts";
import { teamsOfUser } from "./repo.ts";

/** The teams of the signed-in user. */
export function teamRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/teams", requireSession(db));

  r.get("/api/teams", async (req, res) => {
    const teams = await teamsOfUser(db, req.session!.userId);
    res.json({ items: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })) });
  });

  return r;
}
