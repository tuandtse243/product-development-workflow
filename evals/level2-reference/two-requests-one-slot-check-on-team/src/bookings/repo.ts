import type { Queryable } from "../db/client.ts";

export class SlotTaken extends Error {}

/**
 * WRONG on purpose: the unique violation is mapped, but a check before the insert looks for an active booking of the
 * same team at that hour (team_id, starts_at) instead of the same room: a team cannot book two rooms for one hour.
 */
export async function insertBooking(
  db: Queryable,
  b: { roomId: string; teamId: string; bookedBy: string; startsAt: Date },
): Promise<{ id: string; room_id: string; starts_at: Date; created_at: Date }> {
  const taken = await db.query("select 1 from bookings where team_id = $1 and starts_at = $2 and status = 'active'", [b.teamId, b.startsAt.toISOString()]);
  if (taken.length) throw new SlotTaken();
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
