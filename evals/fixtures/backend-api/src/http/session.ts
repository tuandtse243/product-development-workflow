import type { RequestHandler } from "express";
import { findSession } from "../auth/sessions.ts";
import type { Db } from "../db/client.ts";
import { unauthenticated } from "./errors.ts";

/**
 * Requires a signed-in caller: `Authorization: Bearer <token>` of a live session. Sets `req.session.userId`, the only
 * identity a handler may trust. Anything else is `401 unauthenticated`.
 */
export function requireSession(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.header("authorization") ?? "");
    const session = m ? await findSession(db, m[1] as string) : null;
    if (!session) throw unauthenticated();
    req.session = session;
    next();
  };
}
