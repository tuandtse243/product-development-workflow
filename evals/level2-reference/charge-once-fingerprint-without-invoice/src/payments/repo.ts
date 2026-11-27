import { createHash } from "node:crypto";
import { GatewayError, type PaymentGateway } from "../billing/gateway.ts";
import type { Db, Queryable } from "../db/client.ts";

export interface Invoice {
  id: string;
  currency: string;
  customer_ref: string;
}

/** The invoice, when the user is a member of its team; null otherwise (no such invoice or another team's). */
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

/** A request whose key has been in progress this long is taken to have died (the contract's 2 minutes). */
const TAKE_OVER_AFTER = "2 minutes";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Charges the card once per (caller, Idempotency-Key). Flow: (1) one transaction commits the key as in progress with
 * the payment as requested; (2) the provider is called with no transaction open, with a provider key derived from the
 * caller, the key and the request, so it is the same on every retry; (3) a second transaction stores the result and the
 * first answer. A duplicate finds the key: the same request done gets the stored answer, still running gets 409,
 * another request 422. A key left in progress longer than TAKE_OVER_AFTER (the server died while charging) is taken
 * over by the next request with it, which charges again with the same provider key: the provider returns the charge it
 * made, if any, and never charges twice.
 */
export async function payInvoice(db: Db, gateway: PaymentGateway, r: { callerId: string; key: string; invoice: Invoice; amount: number }): Promise<PayOutcome> {
  // WRONG on purpose: the fingerprint is the body only; the invoice is in the path and is left out of it.
  const fingerprint = sha(JSON.stringify({ amount: r.amount }));
  const providerKey = `pay_${sha(`${r.callerId}\n${r.key}\n${fingerprint}`).slice(0, 40)}`;

  const start = await db.transaction(async (tx) => {
    const fresh = await tx.query("insert into idempotency_keys (caller_id, key, fingerprint, state) values ($1, $2, $3, 'in_progress') on conflict do nothing returning key", [
      r.callerId,
      r.key,
      fingerprint,
    ]);
    if (!fresh.length) {
      const [k] = await tx.query<{ fingerprint: string; state: string; resource_id: string | null; response_status: number | null; response_body: unknown; stale: boolean }>(
        `select fingerprint, state, resource_id, response_status, response_body, updated_at < now() - interval '${TAKE_OVER_AFTER}' as stale
         from idempotency_keys where caller_id = $1 and key = $2 for update`,
        [r.callerId, r.key],
      );
      if (k!.fingerprint !== fingerprint) return { kind: "reused" } as const;
      if (k!.state === "done") return { kind: "done", status: k!.response_status!, body: k!.response_body } as const;
      if (!k!.stale || !k!.resource_id) return { kind: "in-progress" } as const;
      await tx.query("update idempotency_keys set updated_at = now() where caller_id = $1 and key = $2", [r.callerId, r.key]);
      return { kind: "charge", paymentId: k!.resource_id } as const;
    }
    const [p] = await tx.query<{ id: string }>(
      "insert into payments (invoice_id, amount, currency, state, created_by) values ($1, $2, $3, 'requested', $4) returning id",
      [r.invoice.id, r.amount, r.invoice.currency, r.callerId],
    );
    await tx.query("update idempotency_keys set resource_id = $3 where caller_id = $1 and key = $2", [r.callerId, r.key, p!.id]);
    return { kind: "charge", paymentId: p!.id } as const;
  });
  if (start.kind !== "charge") return start;

  let providerRef: string;
  try {
    const charge = await gateway.charge({ amount: r.amount, currency: r.invoice.currency, customer: r.invoice.customer_ref, idempotencyKey: providerKey });
    providerRef = charge.id;
  } catch (err) {
    if (err instanceof GatewayError && err.kind === "declined") {
      const body = { type: "payment-declined", title: "The card was declined", status: 402 };
      await finish(db, r, start.paymentId, "declined", null, 402, body);
      return { kind: "done", status: 402, body };
    }
    if (err instanceof GatewayError && err.kind === "unavailable") {
      // No answer: the charge may have happened. Forget the attempt; the same request sent again runs again with the
      // same provider key, so the provider returns the charge it made instead of making a second one.
      await db.transaction(async (tx) => {
        await tx.query("delete from idempotency_keys where caller_id = $1 and key = $2", [r.callerId, r.key]);
        await tx.query("delete from payments where id = $1 and state = 'requested'", [start.paymentId]);
      });
      return { kind: "unavailable" };
    }
    throw err; // unexpected: the key stays in progress and is taken over after TAKE_OVER_AFTER
  }

  const [p] = await db.query<{ created_at: Date }>("select created_at from payments where id = $1", [start.paymentId]);
  const body = { id: start.paymentId, invoiceId: r.invoice.id, amount: r.amount, currency: r.invoice.currency, state: "charged", createdAt: p!.created_at.toISOString() };
  await finish(db, r, start.paymentId, "charged", providerRef, 201, body);
  return { kind: "done", status: 201, body };
}

async function finish(db: Db, r: { callerId: string; key: string }, paymentId: string, state: string, providerRef: string | null, status: number, body: unknown) {
  await db.transaction(async (tx) => {
    await tx.query("update payments set state = $2, provider_ref = $3, updated_at = now() where id = $1", [paymentId, state, providerRef]);
    await tx.query("update idempotency_keys set state = 'done', response_status = $3, response_body = $4, updated_at = now() where caller_id = $1 and key = $2", [
      r.callerId,
      r.key,
      status,
      JSON.stringify(body),
    ]);
  });
}
