import type { Queryable } from "../db/client.ts";

export interface ProjectRow {
  id: string;
  team_id: string;
  name: string;
  created_at: Date;
}

export async function projectsOfTeam(db: Queryable, teamId: string): Promise<ProjectRow[]> {
  return db.query("select id, team_id, name, created_at from projects where team_id = $1 order by name, id", [teamId]);
}

export async function findProject(db: Queryable, projectId: string): Promise<ProjectRow | null> {
  const rows = await db.query<ProjectRow>("select id, team_id, name, created_at from projects where id = $1", [projectId]);
  return rows[0] ?? null;
}
