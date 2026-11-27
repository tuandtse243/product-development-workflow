import type { Queryable } from "../db/client.ts";

export class SlotTaken extends Error {}

/**
 * Stores an active booking of a slot. The unique index bookings_one_active_per_slot decides between two bookings of
 * the same slot, whenever they arrive: the loser's insert fails with a unique violation, raised here as SlotTaken.
 */
export async function insertBooking(
  db: Queryable,
  b: { roomId: string; teamId: string; bookedBy: string; startsAt: Date },
): Promise<{ id: string; room_id: string; starts_at: Date; created_at: Date }> {
  try {
    const rows = await db.query<{ id: string; room_id: string; starts_at: Date; created_at: Date }>(
      "insert into bookings (room_id, team_id, booked_by, starts_at) values ($1, $2, $3, $4) returning id, room_id, starts_at, created_at",
      [b.roomId, b.teamId, b.bookedBy, b.startsAt.toISOString()],
    );
    return rows[0]!;
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === "23505" && e.constraint === "bookings_one_active_per_slot") throw new SlotTaken();
    throw err;
  }
}
