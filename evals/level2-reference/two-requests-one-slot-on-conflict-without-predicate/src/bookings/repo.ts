import type { Queryable } from "../db/client.ts";

export class SlotTaken extends Error {}

/**
 * WRONG on purpose: ON CONFLICT names the slot's columns but not the partial index's predicate, so no unique index
 * matches it (bookings_one_active_per_slot is `where status = 'active'`) and every insert fails (42P10, 500).
 */
export async function insertBooking(
  db: Queryable,
  b: { roomId: string; teamId: string; bookedBy: string; startsAt: Date },
): Promise<{ id: string; room_id: string; starts_at: Date; created_at: Date }> {
  const rows = await db.query<{ id: string; room_id: string; starts_at: Date; created_at: Date }>(
    "insert into bookings (room_id, team_id, booked_by, starts_at) values ($1, $2, $3, $4) on conflict (room_id, starts_at) do nothing returning id, room_id, starts_at, created_at",
    [b.roomId, b.teamId, b.bookedBy, b.startsAt.toISOString()],
  );
  if (!rows.length) throw new SlotTaken();
  return rows[0]!;
}
