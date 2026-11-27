import type { Db } from "../db/client.ts";
import { activeBookingAt } from "../rooms/repo.ts";

export class SlotTaken extends Error {}

/**
 * WRONG on purpose: the read and the insert run in one transaction, which PGlite serialises (so ten bookings at once
 * pass), but on Postgres two such transactions both read "free" and the second insert fails unmapped (500).
 */
export async function insertBooking(
  db: Db,
  b: { roomId: string; teamId: string; bookedBy: string; startsAt: Date },
): Promise<{ id: string; room_id: string; starts_at: Date; created_at: Date }> {
  return db.transaction(async (tx) => {
    if (await activeBookingAt(tx, b.roomId, b.startsAt)) throw new SlotTaken();
    const rows = await tx.query<{ id: string; room_id: string; starts_at: Date; created_at: Date }>(
      "insert into bookings (room_id, team_id, booked_by, starts_at) values ($1, $2, $3, $4) returning id, room_id, starts_at, created_at",
      [b.roomId, b.teamId, b.bookedBy, b.startsAt.toISOString()],
    );
    return rows[0]!;
  });
}
