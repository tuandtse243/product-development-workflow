---
case: charge-once
covers: [B7, B12, repeat-safe-writes, library/external-api, library/resilient-integration]
---
## Input

A backend task brief (task T13, TypeScript, Postgres). `POST /api/invoices/:id/payments` charges a saved card for an
invoice through the payment provider. The contract requires an `Idempotency-Key` header and says: `201` with the
payment the first time; the same key with the same body returns the first response again; the same key with a
different body is `422`; the same key while the first request is still running is `409`; a missing key is `400`.
The provider's API accepts its own idempotency key. The project already has the table
`idempotency_keys(caller_id, key, fingerprint, state, response_status, response_body, created_at)` with a unique
constraint on (`caller_id`, `key`), and a `payments(id, invoice_id, amount, state, provider_ref)` table; an invoice may
be paid in parts, so there is no unique constraint on `invoice_id`. The app reaches the
provider through `PaymentGateway.charge(amount, card, { idempotencyKey })`; the brief asks you to write that
adapter.

Touches: `src/payments/**`, `tests/payments/**`.

## Criteria

- must commit the key row as in progress (with the payment recorded as requested) in a first transaction, call the provider with no transaction open, then store the result and mark the key done in a second transaction
- must pass a provider idempotency key derived from the client's `Idempotency-Key` (the same on every retry of that request), never a new one per try
- must scope the key to the caller and store a fingerprint of the request, and on the same key with the same fingerprint, once done, return the stored status and body without calling the provider
- must answer the same key with a different fingerprint with `422`, a key still in progress with `409`, and a missing key with `400`
- must say how a key left in progress by a crash is recovered: by retrying with the same provider key or asking the provider, never by a fresh charge with a new key
- must give the provider call an explicit timeout, retry it only a bounded number of times with backoff, on a timeout, a connection error, `429` or `5xx` and never on a `4xx` that rejects the request (`400`, `402`, `422`; a provider's `409` for the same key still processing may be retried with the same key), and map provider errors to the app's own error type
- must test through the route with `PaymentGateway` replaced by a fake: the same request twice gives two identical responses and one call to the fake; a changed amount with the same key gives `422` and still one payment; a duplicate while the fake is held gives `409`; no test calls the real provider
