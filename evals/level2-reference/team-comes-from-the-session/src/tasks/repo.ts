import type { Queryable } from "../db/client.ts";

/** The project, when the user is a member of its team; null otherwise (no such project or another team's). */
export async function projectOfMember(db: Queryable, projectId: string, userId: string): Promise<{ id: string; team_id: string } | null> {
  const rows = await db.query<{ id: string; team_id: string }>(
    "select p.id, p.team_id from projects p join team_members m on m.team_id = p.team_id and m.user_id = $2 where p.id = $1",
    [projectId, userId],
  );
  return rows[0] ?? null;
}

export async function createTask(
  db: Queryable,
  t: { projectId: string; teamId: string; createdBy: string; title: string; dueDate: string | null },
): Promise<{ id: string; title: string; due_date: string | null; created_at: Date }> {
  const rows = await db.query<{ id: string; title: string; due_date: string | null; created_at: Date }>(
    `insert into tasks (project_id, team_id, created_by, title, due_date) values ($1, $2, $3, $4, $5)
     returning id, title, to_char(due_date, 'YYYY-MM-DD') as due_date, created_at`,
    [t.projectId, t.teamId, t.createdBy, t.title, t.dueDate],
  );
  return rows[0]!;
}
