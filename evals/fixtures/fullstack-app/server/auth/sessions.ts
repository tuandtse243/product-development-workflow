import { randomBytes } from "node:crypto";
import type { Queryable } from "../db/client.ts";

export interface SessionUser {
  userId: string;
}

/** A new session for a user; the token is what the browser sends back as the `sid` cookie. */
export async function createSession(db: Queryable, userId: string, ttlHours: number): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.query("insert into sessions (token, user_id, expires_at) values ($1, $2, now() + make_interval(hours => $3))", [token, userId, ttlHours]);
  return token;
}

export async function findSession(db: Queryable, token: string): Promise<SessionUser | null> {
  const rows = await db.query<{ user_id: string }>("select user_id from sessions where token = $1 and expires_at > now()", [token]);
  return rows[0] ? { userId: rows[0].user_id } : null;
}
