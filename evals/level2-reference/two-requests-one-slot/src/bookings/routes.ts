import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { roomOfMember } from "../rooms/repo.ts";
import { insertBooking, SlotTaken } from "./repo.ts";

const Params = z.object({ roomId: z.string().uuid() });
const onTheHour = (s: string) => {
  const d = new Date(s);
  return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
};
const Body = z.object({ startsAt: z.string().datetime({ offset: true }).refine(onTheHour, "on the hour") }).strict();

const roomNotFound = () => new HttpError(404, "room-not-found", "No such room");

/** POST /api/rooms/:roomId/bookings: books one hour of a room of one of the caller's teams. */
export function bookingRoutes(db: Db): Router {
  const r = Router();
  r.post("/api/rooms/:roomId/bookings", requireSession(db), async (req, res) => {
    const userId = req.session!.userId;
    const params = Params.safeParse(req.params);
    const room = params.success ? await roomOfMember(db, params.data.roomId, userId) : null;
    if (!room) throw roomNotFound();
    const body = parse(Body, req.body);
    const startsAt = new Date(body.startsAt);
    if (startsAt.getTime() <= Date.now()) throw new HttpError(422, "slot-in-past", "The slot is in the past");
    try {
      const b = await insertBooking(db, { roomId: room.id, teamId: room.team_id, bookedBy: userId, startsAt });
      res.status(201).json({ id: b.id, roomId: b.room_id, startsAt: b.starts_at.toISOString(), createdAt: b.created_at.toISOString() });
    } catch (err) {
      if (err instanceof SlotTaken) throw new HttpError(409, "slot-taken", "The slot is already booked");
      throw err;
    }
  });
  return r;
}
