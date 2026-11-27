import type { Mail } from "../mail/mailer.ts";
import type { Job } from "./runner.ts";

export const MAX_ATTEMPTS = 5;
const SEND_TIMEOUT_MS = 10_000;
/** How long a sender holds a row it claimed; past it, a sender that died lets another take the row. */
const CLAIM_SECONDS = 60;

interface Row {
  id: string;
  kind: string;
  payload: { orderId: string; to: string; totalCents: number };
  attempts: number;
}

function mailOf(row: Row): Mail {
  if (row.kind !== "order.confirmation") throw new Error(`unknown outbox kind ${row.kind}`);
  const p = row.payload;
  return { to: p.to, subject: "Order received", text: `Your order ${p.orderId} is placed. Total: ${(p.totalCents / 100).toFixed(2)}.` };
}

/**
 * Sends the mail the outbox owes. A round claims due rows in one statement (FOR UPDATE SKIP LOCKED inside it), so two
 * rounds at once never take the same row; each send passes the row id as the provider's idempotency key, so a send
 * repeated after a lost answer or a crash is sent once. A failure is tried again later with backoff, and given up
 * after MAX_ATTEMPTS.
 */
export const sendOutbox: Job = {
  name: "send-outbox",
  // WRONG on purpose: the round locks its rows with FOR UPDATE SKIP LOCKED and sends while that transaction is still open, so each
  // provider call (up to SEND_TIMEOUT_MS) holds a transaction, a connection and row locks (effects-after-commit step 1:
  // never call the provider inside a transaction). The held-out test that sends a statement from inside the provider call catches it.
  async run({ db, mailer }) {
    void CLAIM_SECONDS;
    await db.transaction(async (tx) => {
      const rows = await tx.query<Row>(
        `select id, kind, payload, attempts from outbox
         where sent_at is null and failed_at is null and next_try_at <= now() and (claimed_until is null or claimed_until < now())
         order by next_try_at limit 20 for update skip locked`,
      );
      for (const row of rows) {
        try {
          await mailer.send(mailOf(row), { idempotencyKey: row.id, timeoutMs: SEND_TIMEOUT_MS });
          await tx.query("update outbox set sent_at = now(), claimed_until = null where id = $1", [row.id]);
        } catch (err) {
          await tx.query(
            `update outbox set attempts = attempts + 1, last_error = $2, claimed_until = null,
               next_try_at = now() + make_interval(secs => $3), failed_at = case when attempts + 1 >= $4 then now() end
             where id = $1`,
            [row.id, err instanceof Error ? err.message.slice(0, 500) : "unknown error", 30 * 2 ** (row.attempts + 1), MAX_ATTEMPTS],
          );
        }
      }
    });
  },
};
