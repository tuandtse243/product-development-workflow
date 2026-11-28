import type { Queryable } from "../db/client.ts";

export interface InvoiceRow {
  id: string;
  team_id: string;
  number: string;
  amount_cents: number;
  status: "open" | "paid";
  issued_at: Date;
}

/** The invoices of the teams the user belongs to, newest first. */
export async function invoicesOfUser(db: Queryable, userId: string): Promise<InvoiceRow[]> {
  return db.query(
    `select i.id, i.team_id, i.number, i.amount_cents, i.status, i.issued_at
       from invoices i join team_members m on m.team_id = i.team_id
      where m.user_id = $1
      order by i.issued_at desc, i.number, i.id`,
    [userId],
  );
}

export async function findInvoice(db: Queryable, invoiceId: string): Promise<InvoiceRow | null> {
  const rows = await db.query<InvoiceRow>("select id, team_id, number, amount_cents, status, issued_at from invoices where id = $1", [invoiceId]);
  return rows[0] ?? null;
}
