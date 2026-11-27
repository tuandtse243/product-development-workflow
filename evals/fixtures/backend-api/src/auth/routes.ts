import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { parse } from "../http/validate.ts";
import { checkPassword, createSession } from "./sessions.ts";

const SignIn = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }).strict();

/** POST /api/sessions: signs in with email and password and returns a session token. */
export function sessionRoutes(db: Db, ttlHours: number): Router {
  const r = Router();
  r.post("/api/sessions", async (req, res) => {
    const body = parse(SignIn, req.body);
    const rows = await db.query<{ id: string; password_hash: string }>("select id, password_hash from users where email = $1", [body.email.toLowerCase()]);
    const user = rows[0];
    if (!user || !checkPassword(body.password, user.password_hash)) throw new HttpError(401, "wrong-credentials", "Email or password is wrong");
    res.status(201).json({ token: await createSession(db, user.id, ttlHours) });
  });
  return r;
}
