import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import type { Mailer } from "../mail/mailer.ts";
import { isMember } from "../teams/repo.ts";
import { placeOrder, UnknownProduct } from "./repo.ts";

const Params = z.object({ teamId: z.string().uuid() });
const Line = z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }).strict();
const Body = z.object({ lines: z.array(Line).min(1).max(20) }).strict();

const teamNotFound = () => new HttpError(404, "team-not-found", "No such team");

/** WRONG on purpose (see repo.ts): the mailer is called inside the order's transaction. */
export function orderRoutes(db: Db, mailer: Mailer): Router {
  const r = Router();
  r.post("/api/teams/:teamId/orders", requireSession(db), async (req, res) => {
    const userId = req.session!.userId;
    const params = Params.safeParse(req.params);
    if (!params.success || !(await isMember(db, params.data.teamId, userId))) throw teamNotFound();
    const body = parse(Body, req.body);
    try {
      const o = await placeOrder(db, mailer, { teamId: params.data.teamId, userId, lines: body.lines });
      res.status(201).json({ id: o.id, totalCents: o.totalCents, lines: o.lines, createdAt: o.createdAt.toISOString() });
    } catch (err) {
      if (err instanceof UnknownProduct) throw new HttpError(422, "unknown-product", "No such product");
      throw err;
    }
  });
  return r;
}
