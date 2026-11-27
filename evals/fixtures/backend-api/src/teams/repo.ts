import type { Queryable } from "../db/client.ts";

export interface TeamRow {
  id: string;
  name: string;
  created_at: Date;
}

export async function teamsOf(db: Queryable, userId: string): Promise<(TeamRow & { role: string })[]> {
  return db.query(
    "select t.id, t.name, t.created_at, m.role from teams t join team_members m on m.team_id = t.id where m.user_id = $1 order by t.name, t.id",
    [userId],
  );
}

export async function isMember(db: Queryable, teamId: string, userId: string): Promise<boolean> {
  const rows = await db.query("select 1 from team_members where team_id = $1 and user_id = $2", [teamId, userId]);
  return rows.length > 0;
}

export async function membersOf(db: Queryable, teamId: string): Promise<{ user_id: string; name: string; role: string }[]> {
  return db.query(
    "select u.id as user_id, u.name, m.role from team_members m join users u on u.id = m.user_id where m.team_id = $1 order by u.name, u.id",
    [teamId],
  );
}
