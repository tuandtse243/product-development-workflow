---
case: email-after-the-order
covers: [B7, B9, B12, effects-after-commit]
fixture: backend-api
change: place-an-order
task: T01
restore: [tests/helpers.ts, tests/http.ts]
must_read:
  - .aidw/changes/place-an-order/api-contract.md
  - plugin:roles/backend/skills/effects-after-commit.md
must_not_read:
  - plugin:roles/backend/skills/query-shape.md
---
## Situation

Task T01 of the fixture's Change `place-an-order`: `POST /api/teams/{teamId}/orders` stores an order and its lines and
owes the caller a confirmation email, sent through the existing `Mailer` (`src/mail/mailer.ts`) only after the order is
committed, never for an order that was not stored, still when the provider was down at the time, and once. The
project has an `outbox` table (with `next_try_at`, `claimed_until`, `failed_at`) and a job runner whose rounds may run
on several instances at once (`runJobsOnce`, jobs listed in `src/jobs/registry.ts`); no job reads the outbox yet.
`Mailer.send` takes `{ timeoutMs, idempotencyKey }`, and without `timeoutMs` it waits as long as the connection stays
open. Sending from the handler, inside or right after the transaction, is what an Agent that only wires a mailer
would do.

The held-out tests (`held-out/tests/held-out/place-an-order.test.ts`) go through the route and `runJobsOnce`, with
`t.mailer` as the provider: the order and the mail on the happy path (with a `timeoutMs`); a BEFORE INSERT trigger
that makes storing a line fail (no order, no mail ever, and none sent while the transaction was open); one that makes
recording the owed email fail (500 and no order: the owed row is in the order's transaction); a statement sent from
inside the provider call, which must be answered within 1 s (the sender holds no transaction open around a send); the provider
down (201, sent once it is back); two sender rounds one after the other and at the same moment, with every statement
outside a transaction slowed down so that they interleave (one call to the provider); an answer lost after the
provider accepted the mail (sent again with the same idempotency key, delivered once); 5 failed attempts and no more;
and the contract's errors. Between rounds the tests make time pass by setting `next_try_at` to the past and clearing
`claimed_until`.

The checks run the Role's `route-inventory` (the three access tests of B2) and `leak-and-timeout-scan` (B12, B14), the
whole suite, the typecheck, that every scenario id names a test, and that nothing outside Touches changed. A model
grades only the Agent's own tests of the failure paths.

## Criteria

- must have tests of its own, with the mailer replaced by its fake (`t.mailer`), that make the send fail and assert the order is still stored and its email still owed, that make storing the order fail part way and assert no order, no owed row and no send, and that run the sender twice and assert one call to the provider
