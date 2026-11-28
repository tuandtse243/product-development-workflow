import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { parse } from "../http/validate.ts";
import { createSession } from "./sessions.ts";

/** Signing in: `POST /api/sessions` with an email (the team's sign-in is by link, handled before this call) sets the `sid` cookie. */
export function sessionRoutes(db: Db, ttlHours: number): Router {
  const r = Router();

  r.post("/api/sessions", async (req, res) => {
    const { email } = parse(z.object({ email: z.string().email() }).strict(), req.body);
    const users = await db.query<{ id: string; name: string }>("select id, name from users where email = $1", [email]);
    const user = users[0];
    if (!user) throw new HttpError(401, "invalid-credentials", "Unknown email");
    const token = await createSession(db, user.id, ttlHours);
    res.cookie("sid", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: ttlHours * 3600_000 });
    res.status(201).json({ user: { id: user.id, name: user.name } });
  });

  return r;
}
