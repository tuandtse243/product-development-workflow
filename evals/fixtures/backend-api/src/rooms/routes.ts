import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { activeBookingAt, roomOfMember } from "./repo.ts";

const Params = z.object({ roomId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }) });
const roomNotFound = () => new HttpError(404, "room-not-found", "No such room");

/** GET /api/rooms/:roomId/slots/:startsAt: whether a slot of a room of one of the caller's teams is free. */
export function roomRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/rooms", requireSession(db));

  r.get("/api/rooms/:roomId/slots/:startsAt", async (req, res) => {
    const params = Params.safeParse(req.params);
    const room = params.success ? await roomOfMember(db, params.data.roomId, req.session!.userId) : null;
    if (!params.success || !room) throw roomNotFound();
    const startsAt = new Date(params.data.startsAt);
    const booking = await activeBookingAt(db, room.id, startsAt);
    res.json({ startsAt: startsAt.toISOString(), free: !booking });
  });

  return r;
}
