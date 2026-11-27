import type { Db } from "../db/client.ts";

export class SlotTaken extends Error {}

/**
 * WRONG on purpose: SELECT ... FOR UPDATE on the slot's active booking, then an insert, in one transaction. When the slot
 * is free there is no row to lock, so on Postgres two such transactions both find nothing and the second insert fails
 * with an unmapped unique violation (500). PGlite runs one transaction at a time, so ten bookings at once pass; the rival
 * inserted from inside the route's own insert catches it.
 */
export async function insertBooking(
  db: Db,
  b: { roomId: string; teamId: string; bookedBy: string; startsAt: Date },
): Promise<{ id: string; room_id: string; starts_at: Date; created_at: Date }> {
  return db.transaction(async (tx) => {
    const held = await tx.query("select id from bookings where room_id = $1 and starts_at = $2 and status = 'active' for update", [b.roomId, b.startsAt.toISOString()]);
    if (held.length) throw new SlotTaken();
    const rows = await tx.query<{ id: string; room_id: string; starts_at: Date; created_at: Date }>(
      "insert into bookings (room_id, team_id, booked_by, starts_at) values ($1, $2, $3, $4) returning id, room_id, starts_at, created_at",
      [b.roomId, b.teamId, b.bookedBy, b.startsAt.toISOString()],
    );
    return rows[0]!;
  });
}
