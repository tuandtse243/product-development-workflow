import { Router } from "express";
import type { Invoice } from "../../shared/billing.ts";
import type { Db } from "../db/client.ts";
import { HttpError } from "../http/errors.ts";
import { requireSession } from "../http/session.ts";
import { invoicesOfOwner, ownsATeam, type InvoiceRow } from "./repo.ts";

/** An invoice as the API sends it: named fields only, never the row. */
export const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  teamId: row.team_id,
  number: row.number,
  amountCents: row.amount_cents,
  status: row.status,
  issuedAt: row.issued_at.toISOString(),
});

/** What the teams are billed: for the owners of a team only. */
export function billingRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/billing", requireSession(db));

  r.get("/api/billing", async (req, res) => {
    const userId = req.session!.userId;
    // The server decides: nothing the browser says about a role counts.
    if (!(await ownsATeam(db, userId))) throw new HttpError(403, "forbidden", "Only owners can read the billing");
    const rows = await invoicesOfOwner(db, userId);
    res.json({ items: rows.map(toInvoice) });
  });

  return r;
}
