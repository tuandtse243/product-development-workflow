import type { Queryable } from "../db/client.ts";

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
  created_at: Date;
}

/** The projects of every team the user belongs to, by name. */
export async function projectsOfUser(db: Queryable, userId: string): Promise<ProjectRow[]> {
  return db.query(
    `select p.id, p.team_id, p.name, p.created_at
       from projects p join team_members m on m.team_id = p.team_id
      where m.user_id = $1
      order by lower(p.name), p.id`,
    [userId],
  );
}

export async function findProject(db: Queryable, projectId: string): Promise<ProjectRow | null> {
  const rows = await db.query<ProjectRow>("select id, team_id, name, created_at from projects where id = $1", [projectId]);
  return rows[0] ?? null;
}
