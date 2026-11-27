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
---
## Situation

Task T01 of the fixture's Change `pay-an-invoice`: `POST /api/invoices/{invoiceId}/payments` charges the team's saved
card through the existing `PaymentGateway` (`src/billing/gateway.ts`), once per `Idempotency-Key` of the caller: the
same request again gets the first answer, another request with the key `422`, the key while the first still waits for
the provider `409`, a missing key `400`, a provider that does not answer `502` with a retry that charges at most once,
a declined card `402` replayed as it was. The tables `payments` and `idempotency_keys` exist. The provider charges once
per idempotency key, and an answer can be lost after it charged. Checking the key and charging in one go, or charging
inside the transaction that stores the key, is what an Agent without the flow for a remote effect would do.

The held-out tests (`held-out/tests/held-out/pay-an-invoice.test.ts`) install `memoryGateway()` and go through the
route: the happy path; the same request three times (one call); parts of an invoice; the key reused with another
amount or invoice; the same key of two callers (two real charges at the provider); a duplicate while the fake holds
the first call, which must be answered `409` within 3 seconds (a provider call inside the transaction makes it wait);
`502` then a retry with one provider key; a charge whose answer was lost (one charge in all); a declined card; bad
keys and bodies (nothing stored, so the corrected request with the same key passes); and the access errors.

The checks run the Role's `route-inventory` (B2) and `leak-and-timeout-scan` (B12, B14), the whole suite, the
typecheck, that every scenario id names a test, and that nothing outside Touches changed. A model grades only how a
key left in progress by a crash is recovered, which no test can reach without knowing how the Agent stores it.

## Criteria

- must take over a key left in progress longer than the contract's 2 minutes (the server stopped while charging), or say in its final reply or report file how it is recovered, by calling the provider again with the same provider idempotency key (or asking the provider), never with a new key or a new charge
