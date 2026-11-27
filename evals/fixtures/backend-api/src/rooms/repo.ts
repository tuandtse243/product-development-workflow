import type { Queryable } from "../db/client.ts";

export interface RoomRow {
  id: string;
  team_id: string;
  name: string;
}

/** The room, when the user is a member of its team; null otherwise (no such room or another team's). */
export async function roomOfMember(db: Queryable, roomId: string, userId: string): Promise<RoomRow | null> {
  const rows = await db.query<RoomRow>(
    "select r.id, r.team_id, r.name from rooms r join team_members m on m.team_id = r.team_id and m.user_id = $2 where r.id = $1",
    [roomId, userId],
  );
  return rows[0] ?? null;
}

/** The active booking of a slot (a room and the hour it starts), if any. */
export async function activeBookingAt(db: Queryable, roomId: string, startsAt: Date): Promise<{ id: string; booked_by: string } | null> {
  const rows = await db.query<{ id: string; booked_by: string }>(
    "select id, booked_by from bookings where room_id = $1 and starts_at = $2 and status = 'active'",
    [roomId, startsAt.toISOString()],
  );
  return rows[0] ?? null;
}
