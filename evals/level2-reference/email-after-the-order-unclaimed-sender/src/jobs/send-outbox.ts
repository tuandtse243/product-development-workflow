import type { Mail } from "../mail/mailer.ts";
import type { Job } from "./runner.ts";

export const MAX_ATTEMPTS = 5;

interface Row {
  id: string;
  kind: string;
  payload: { orderId: string; to: string; totalCents: number };
  attempts: number;
}

function mailOf(row: Row): Mail {
  const p = row.payload;
  return { to: p.to, subject: "Order received", text: `Your order ${p.orderId} is placed. Total: ${(p.totalCents / 100).toFixed(2)}.` };
}

/**
 * WRONG on purpose: the outbox row is written with the order, but the sender reads due rows without claiming them (two
 * rounds at once both send) and passes no idempotency key (a send repeated after a lost answer is sent twice).
 */
export const sendOutbox: Job = {
  name: "send-outbox",
  async run({ db, mailer }) {
    const rows = await db.query<Row>(
      "select id, kind, payload, attempts from outbox where sent_at is null and failed_at is null and next_try_at <= now() order by next_try_at limit 20",
    );
    for (const row of rows) {
      try {
        await mailer.send(mailOf(row), { timeoutMs: 10_000 });
        await db.query("update outbox set sent_at = now() where id = $1", [row.id]);
      } catch (err) {
        await db.query(
          "update outbox set attempts = attempts + 1, last_error = $2, next_try_at = now() + interval '1 minute', failed_at = case when attempts + 1 >= $3 then now() end where id = $1",
          [row.id, err instanceof Error ? err.message : "unknown error", MAX_ATTEMPTS],
        );
      }
    }
  },
};
