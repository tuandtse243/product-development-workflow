import { randomUUID } from "node:crypto";
import { GatewayError, type PaymentGateway } from "../billing/gateway.ts";
import type { Db, Queryable } from "../db/client.ts";

export interface Invoice {
  id: string;
  currency: string;
  customer_ref: string;
}

export async function invoiceOfMember(db: Queryable, invoiceId: string, userId: string): Promise<Invoice | null> {
  const rows = await db.query<Invoice>(
    "select i.id, i.currency, i.customer_ref from invoices i join team_members m on m.team_id = i.team_id and m.user_id = $2 where i.id = $1",
    [invoiceId, userId],
  );
  return rows[0] ?? null;
}

export type PayOutcome =
  | { kind: "done"; status: number; body: unknown }
  | { kind: "reused" }
  | { kind: "in-progress" }
  | { kind: "unavailable" };

/** WRONG on purpose: the Idempotency-Key is required but never stored; every request charges with a new provider key. */
export async function payInvoice(db: Db, gateway: PaymentGateway, r: { callerId: string; key: string; invoice: Invoice; amount: number }): Promise<PayOutcome> {
  let ref: string;
  try {
    ref = (await gateway.charge({ amount: r.amount, currency: r.invoice.currency, customer: r.invoice.customer_ref, idempotencyKey: randomUUID() })).id;
  } catch (err) {
    if (err instanceof GatewayError && err.kind === "declined") {
      await db.query("insert into payments (invoice_id, amount, currency, state, created_by) values ($1, $2, $3, 'declined', $4)", [r.invoice.id, r.amount, r.invoice.currency, r.callerId]);
      return { kind: "done", status: 402, body: null };
    }
    if (err instanceof GatewayError) return { kind: "unavailable" };
    throw err;
  }
  const [p] = await db.query<{ id: string; created_at: Date }>(
    "insert into payments (invoice_id, amount, currency, state, provider_ref, created_by) values ($1, $2, $3, 'charged', $4, $5) returning id, created_at",
    [r.invoice.id, r.amount, r.invoice.currency, ref, r.callerId],
  );
  return { kind: "done", status: 201, body: { id: p!.id, invoiceId: r.invoice.id, amount: r.amount, currency: r.invoice.currency, state: "charged", createdAt: p!.created_at.toISOString() } };
}
