import { createHash } from "node:crypto";
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

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * WRONG on purpose: the key, the payment and the provider call share one transaction (flow a of repeat-safe-writes
 * used for a remote effect). The provider is called while the transaction holds its locks, so a duplicate waits behind
 * it instead of getting 409, and a crash after the charge rolls back every record of it.
 */
export async function payInvoice(db: Db, gateway: PaymentGateway, r: { callerId: string; key: string; invoice: Invoice; amount: number }): Promise<PayOutcome> {
  const fingerprint = sha(JSON.stringify({ invoiceId: r.invoice.id, amount: r.amount }));
  const providerKey = `pay_${sha(`${r.callerId}\n${r.key}\n${fingerprint}`).slice(0, 40)}`;
  return db.transaction(async (tx): Promise<PayOutcome> => {
    const [k] = await tx.query<{ fingerprint: string; response_status: number; response_body: unknown }>(
      "select fingerprint, response_status, response_body from idempotency_keys where caller_id = $1 and key = $2",
      [r.callerId, r.key],
    );
    if (k) return k.fingerprint === fingerprint ? { kind: "done", status: k.response_status, body: k.response_body } : { kind: "reused" };
    let ref: string;
    try {
      ref = (await gateway.charge({ amount: r.amount, currency: r.invoice.currency, customer: r.invoice.customer_ref, idempotencyKey: providerKey })).id;
    } catch (err) {
      if (err instanceof GatewayError && err.kind === "unavailable") return { kind: "unavailable" };
      throw err;
    }
    const [p] = await tx.query<{ id: string; created_at: Date }>(
      "insert into payments (invoice_id, amount, currency, state, provider_ref, created_by) values ($1, $2, $3, 'charged', $4, $5) returning id, created_at",
      [r.invoice.id, r.amount, r.invoice.currency, ref, r.callerId],
    );
    const body = { id: p!.id, invoiceId: r.invoice.id, amount: r.amount, currency: r.invoice.currency, state: "charged", createdAt: p!.created_at.toISOString() };
    await tx.query("insert into idempotency_keys (caller_id, key, fingerprint, state, resource_id, response_status, response_body) values ($1, $2, $3, 'done', $4, 201, $5)", [
      r.callerId,
      r.key,
      fingerprint,
      p!.id,
      JSON.stringify(body),
    ]);
    return { kind: "done", status: 201, body };
  });
}
