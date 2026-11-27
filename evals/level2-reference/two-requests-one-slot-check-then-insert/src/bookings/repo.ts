import type { Queryable } from "../db/client.ts";
import { activeBookingAt } from "../rooms/repo.ts";

export class SlotTaken extends Error {}

/** WRONG on purpose: the code decides from its own read, then inserts; a unique violation is not mapped. */
export async function insertBooking(
  db: Queryable,
  b: { roomId: string; teamId: string; bookedBy: string; startsAt: Date },
): Promise<{ id: string; room_id: string; starts_at: Date; created_at: Date }> {
  if (await activeBookingAt(db, b.roomId, b.startsAt)) throw new SlotTaken();
  const rows = await db.query<{ id: string; room_id: string; starts_at: Date; created_at: Date }>(
    "insert into bookings (room_id, team_id, booked_by, starts_at) values ($1, $2, $3, $4) returning id, room_id, starts_at, created_at",
    [b.roomId, b.teamId, b.bookedBy, b.startsAt.toISOString()],
  );
  return rows[0]!;
}
