import { Router } from "express";
import { inviteFieldErrors, inviteRequestSchema, type Invite } from "../../shared/invites.ts";
import type { Db } from "../db/client.ts";
import { HttpError, invalidRequest } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { insertInvite, teamOwnedBy, type InviteRow } from "./repo.ts";

/** An invitation as the API sends it: named fields only, never the row. */
export const toInvite = (row: InviteRow): Invite => ({ id: row.id, teamId: row.team_id, email: row.email, name: row.name, createdAt: row.created_at.toISOString() });

const FIELDS = new Set(Object.keys(inviteRequestSchema.shape));

/** Inviting people to the caller's team: owners only. */
export function inviteRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/invites", requireSession(db));

  r.post("/api/invites", async (req, res) => {
    const userId = req.session!.userId;
    const teamId = await teamOwnedBy(db, userId);
    if (!teamId) throw new HttpError(403, "forbidden", "Only owners can invite");
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !FIELDS.has(k))) throw invalidRequest("the body is not an object with name and email");
    const fields = inviteFieldErrors(body);
    if (fields) throw new HttpError(422, "validation", undefined, fields);
    const input = inviteRequestSchema.parse(body);
    res.status(201).json(toInvite(await insertInvite(db, teamId, userId, input.email, input.name)));
  });

  return r;
}
