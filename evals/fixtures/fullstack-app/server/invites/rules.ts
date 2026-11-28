import { z } from "zod";
import type { Queryable } from "../db/client.ts";

/** What an invitation needs: the person's email and name. A name is at most 80 characters, as everywhere in the app. */
export const inviteRules = z
  .object({
    email: z.string().trim().email(),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type InviteInput = z.infer<typeof inviteRules>;

/** Whether the team has not invited this email yet, ignoring case (for the bulk import; no route uses it yet). */
export async function emailIsNew(db: Queryable, teamId: string, email: string): Promise<boolean> {
  const rows = await db.query<{ n: number }>("select count(*)::int as n from invites where team_id = $1 and lower(email) = lower($2)", [teamId, email]);
  return rows[0]?.n === 0;
}
