import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Queryable } from "../db/client.ts";

export interface SessionUser {
  userId: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(password, salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A new session for a user; the token is what the client sends as `Authorization: Bearer <token>`. */
export async function createSession(db: Queryable, userId: string, ttlHours: number): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.query("insert into sessions (token, user_id, expires_at) values ($1, $2, now() + make_interval(hours => $3))", [token, userId, ttlHours]);
  return token;
}

export async function findSession(db: Queryable, token: string): Promise<SessionUser | null> {
  const rows = await db.query<{ user_id: string }>("select user_id from sessions where token = $1 and expires_at > now()", [token]);
  return rows[0] ? { userId: rows[0].user_id } : null;
}
