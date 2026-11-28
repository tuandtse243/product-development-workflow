import type { Queryable } from "../db/client.ts";

export interface InviteRow {
  id: string;
  team_id: string;
  email: string;
  name: string;
  created_at: Date;
}

/** A team the user belongs to (the first by name), or null when they are in none. */
export async function teamOf(db: Queryable, userId: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>("select t.id from teams t join team_members m on m.team_id = t.id where m.user_id = $1 order by t.name, t.id limit 1", [userId]);
  return rows[0]?.id ?? null;
}

export async function insertInvite(db: Queryable, teamId: string, invitedBy: string, email: string, name: string): Promise<InviteRow> {
  const rows = await db.query<InviteRow>("insert into invites (team_id, invited_by, email, name) values ($1, $2, $3, $4) returning id, team_id, email, name, created_at", [teamId, invitedBy, email, name]);
  return rows[0]!;
}
