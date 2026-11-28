import type { Queryable } from "../db/client.ts";

export type TeamRole = "owner" | "member";

export interface TeamRow {
  id: string;
  name: string;
  role: TeamRole;
}

/** The teams a user belongs to, with their role in each. */
export async function teamsOfUser(db: Queryable, userId: string): Promise<TeamRow[]> {
  return db.query("select t.id, t.name, m.role from teams t join team_members m on m.team_id = t.id where m.user_id = $1 order by t.name, t.id", [userId]);
}

/** A user's role in a team; null when they are not in it. */
export async function roleOf(db: Queryable, userId: string, teamId: string): Promise<TeamRole | null> {
  const rows = await db.query<{ role: TeamRole }>("select role from team_members where user_id = $1 and team_id = $2", [userId, teamId]);
  return rows[0]?.role ?? null;
}
