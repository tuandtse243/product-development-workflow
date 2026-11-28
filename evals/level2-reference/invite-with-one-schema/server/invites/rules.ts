import type { Queryable } from "../db/client.ts";

// The rules of an invitation (the name's and the email's) are in shared/invites.ts, which the web form uses too.

/** Whether the team has not invited this email yet, ignoring case (for the bulk import; no route uses it yet). */
export async function emailIsNew(db: Queryable, teamId: string, email: string): Promise<boolean> {
  const rows = await db.query<{ n: number }>("select count(*)::int as n from invites where team_id = $1 and lower(email) = lower($2)", [teamId, email]);
  return rows[0]?.n === 0;
}
