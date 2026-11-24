---
case: email-after-the-order
covers: [B7, B9, effects-after-commit]
---
## Input

A backend task brief (task T7, TypeScript, Postgres through Knex). `POST /api/orders` places an order: it saves the
order and its lines and sends a confirmation email through the mail provider adapter `Mailer.send(to, template,
data)`. Scenario OR-4: "Given the mail provider is down, when a customer places an order, then the order is kept and
the confirmation is sent once the provider is back." The project already has an `outbox` table (`id uuid`, `type`,
`payload jsonb`, `state` pending/sent/failed, `attempts`, `next_try_at`) and a job runner that runs registered jobs
every few seconds, possibly on several instances at once. Today no job reads the outbox.

Touches: `src/orders/**`, `src/jobs/**`, `tests/orders/**`, `tests/jobs/**`.

## Criteria

- must save the order and its lines in one transaction, and must not call `Mailer.send` while that transaction is open, nor before it
- must insert the owed email as an `outbox` row inside the same transaction as the order, so the two commit together or not at all
- must have the sending job claim pending rows so two instances never take the same row (`FOR UPDATE SKIP LOCKED`, or a claim column with a timeout), mark a row sent after the send, and on failure raise `attempts` and push `next_try_at` later, marking it failed after a bounded number of attempts
- must pass the outbox row's id as the mail provider's idempotency key (or otherwise make a second send of the same row a no-op), because a crash between the send and "mark sent" sends again
- must test, with `Mailer` replaced by a fake at its boundary: the fake fails and the order is still saved with its outbox row pending; running the job twice calls the fake once for the order
- must not call the real mail provider from any test
