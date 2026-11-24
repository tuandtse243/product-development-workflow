---
name: resilient-integration
description: Webhooks, idempotency, timeouts and retries for a call that crosses a process or company boundary.
---

# Calls that can fail halfway

A call across a boundary has three outcomes: it worked, it failed, or you do not know. Design for the third.

## Outbound calls

- **Timeout on every call**, shorter than the caller's own deadline. No client default: set it.
- **Retry only what is safe to repeat**: reads, and writes that carry an idempotency key. Bounded (three tries),
  with backoff and jitter. Retry on a timeout, a connection error, `429` (honor `Retry-After`) and `5xx`; never on
  other `4xx`.
- **Idempotency key for a write**: generated once per user intent (the order, the payment attempt), stored with
  the record before the call, and sent again unchanged on a retry. A new key per try defeats it.
- **Write the intent first.** Save "payment requested" with the key, call, then save the result. A crash between
  the call and the save is found by a job that asks the provider, not guessed.
- **Map the provider's errors at the boundary** into the app's own error shape. The rest of the code never sees a
  provider's status code or message.
- **Degrade on purpose.** Decide what the user sees when the service is down (a queued state, a clear failure),
  and test that path.

## Inbound webhooks

1. **Verify the signature on the raw body** before parsing, with a constant-time compare, and reject an old
   timestamp (replay). The secret comes from the environment.
2. **Answer fast.** Record the event and return `2xx`; do the work after. A slow handler makes the provider retry
   and you process twice.
3. **Deduplicate by the provider's event id**: a unique constraint on it, and "already seen" is a success.
4. **Do not trust order.** Events arrive late and out of sequence: act on the object's current state (fetch it,
   or compare a version or timestamp), not on the event being the latest.
5. **Make the handler idempotent** anyway: an upsert or a guarded state change, never a blind insert or increment.
6. **Unknown event types return `2xx`** and are logged, so a provider adding a type does not start a retry storm.

## Between your own services

- The contract is the source: generate or share types from it, and keep one contract test (the `contract-tests`
  skill) that fails when either side drifts.
- A change that is not backward compatible ships in two steps: the reader accepts both shapes first, the writer
  switches after.
- Pagination, limits and the error shape are part of the contract, not an implementation detail.

## Tests

- A fake at the boundary that can be told to time out, fail once then succeed, return `429`, and deliver the same
  webhook twice and out of order. One test per behavior above.
- No real network, no sleeping: inject the clock and the backoff.
- Never a real credential, and never a call to a live service from a test or an unattended run.

## Sources

Ideas, not wording: Stripe's guidance on idempotent requests and on handling webhook events; the IETF draft
`Idempotency-Key` header; the retry and timeout patterns of the AWS Builders' Library; Standard Webhooks for
signatures and replay protection.
