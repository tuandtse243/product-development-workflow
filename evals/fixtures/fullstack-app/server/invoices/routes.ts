import { Router } from "express";
import { z } from "zod";
import { findInvoice } from "../billing/repo.ts";
import { toInvoice } from "../billing/routes.ts";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { parse } from "../http/validate.ts";
import { roleOf } from "../teams/repo.ts";

const InvoiceParams = z.object({ invoiceId: z.string().uuid() });

/** One invoice, by id (linked from the emails the billing system sends). */
export function invoiceRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/invoices", requireSession(db));

  r.get("/api/invoices/:invoiceId", async (req, res) => {
    const { invoiceId } = parse(InvoiceParams, req.params);
    const row = await findInvoice(db, invoiceId);
    // An invoice of a team the caller is not in is the same answer as no invoice.
    if (!row || !(await roleOf(db, req.session!.userId, row.team_id))) throw new HttpError(404, "invoice-not-found", "No such invoice");
    res.json(toInvoice(row));
  });

  return r;
}
