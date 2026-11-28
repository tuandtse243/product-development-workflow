import { Router } from "express";
import type { Invoice } from "../../shared/billing.ts";
import type { Db } from "../db/client.ts";
import { requireSession } from "../http/session.ts";
import { invoicesOfUser, type InvoiceRow } from "./repo.ts";

/** An invoice as the API sends it: named fields only, never the row. */
export const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  teamId: row.team_id,
  number: row.number,
  amountCents: row.amount_cents,
  status: row.status,
  issuedAt: row.issued_at.toISOString(),
});

/** What the teams are billed. */
export function billingRoutes(db: Db): Router {
  const r = Router();
  r.use("/api/billing", requireSession(db));

  r.get("/api/billing", async (req, res) => {
    const rows = await invoicesOfUser(db, req.session!.userId);
    res.json({ items: rows.map(toInvoice) });
  });

  return r;
}
