---
case: charge-once
covers: [B7, B12, repeat-safe-writes]
fixture: backend-api
change: pay-an-invoice
task: T01
restore: [tests/helpers.ts, tests/http.ts]
must_read:
  - .aidw/changes/pay-an-invoice/api-contract.md
  - plugin:roles/backend/skills/repeat-safe-writes.md
must_not_read:
  - plugin:roles/backend/skills/query-shape.md
timeout_min: 35
max_turns: 90
---
## Situation

Task T01 of the fixture's Change `pay-an-invoice`: `POST /api/invoices/{invoiceId}/payments` charges the team's saved
card through the existing `PaymentGateway` (`src/billing/gateway.ts`), once per `Idempotency-Key` of the caller: the
same request again gets the first answer, another request with the key `422`, the key while the first still waits for
the provider `409`, a missing key `400`, a provider that does not answer `502` with a retry that charges at most once,
a declined card `402` replayed as it was, and a key left in progress for more than 2 minutes taken over. The tables
`payments` and `idempotency_keys` exist. The provider charges once per idempotency key, and an answer can be lost after
it charged. Checking the key and charging in one go, or charging inside the transaction that stores the key, is what an
Agent without the flow for a remote effect would do. The case is bigger than the pilot, so it has 35 minutes and 90
turns.

The held-out tests (`held-out/tests/held-out/pay-an-invoice.test.ts`) install `memoryGateway()` and go through the
route: the happy path; the same request three times (one call); parts of an invoice; the key reused with another
amount or invoice; the same key of two callers (two real charges at the provider); a duplicate while the fake holds
the first call, which must be answered `409` within 3 seconds (a provider call inside the transaction makes it wait);
the payment stored as `requested` while the provider is called; `502` then a retry with one provider key; a charge
whose answer was lost (one charge in all); after such a `502`, the same key with another amount is still `422`; a
first call that charges and never answers, a duplicate `409`, then (the key row aged 3 minutes) a takeover with one
charge and one provider key; a declined card; bad keys and bodies (nothing stored, so the corrected request with the
same key passes); and the access errors.

The checks run the Role's `route-inventory` (B2) and `leak-and-timeout-scan` (B12, B14), the whole suite, the
typecheck, that every scenario id names a test, and that nothing outside Touches changed. No criterion is left to a
model.
