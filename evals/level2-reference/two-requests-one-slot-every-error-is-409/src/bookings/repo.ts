import type { Queryable } from "../db/client.ts";

export class SlotTaken extends Error {}

/**
 * WRONG on purpose: the database decides, as it should, but every error of the insert becomes SlotTaken (409), not only the unique
 * violation of bookings_one_active_per_slot: a broken connection, a failed foreign key or any bug is told to the caller
 * as "the slot is already booked" and never reaches the log as a 500. The held-out test that makes the insert fail
 * another way catches it.
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
  } catch {
    throw new SlotTaken();
  }
}
