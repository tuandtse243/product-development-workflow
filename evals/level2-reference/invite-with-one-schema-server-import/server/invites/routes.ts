import { Router } from "express";
import type { Db } from "../db/client.ts";
import { HttpError, invalidRequest } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { insertInvite, teamOwnedBy, type InviteRow } from "./repo.ts";
import { inviteRules } from "./rules.ts";

/** An invitation as the API sends it: named fields only, never the row. */
export const toInvite = (row: InviteRow) => ({ id: row.id, teamId: row.team_id, email: row.email, name: row.name, createdAt: row.created_at.toISOString() });

const FIELDS = new Set(["name", "email"]);

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
    const parsed = inviteRules.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        const value = (body as Record<string, unknown>)[field];
        fields[field] ??= field === "name" ? (issue.code === "too_big" ? "too-long" : "required") : typeof value !== "string" || !value.trim() ? "required" : "invalid";
      }
      throw new HttpError(422, "validation", undefined, fields);
    }
    const input = parsed.data;
    res.status(201).json(toInvite(await insertInvite(db, teamId, userId, input.email, input.name)));
  });

  return r;
}
