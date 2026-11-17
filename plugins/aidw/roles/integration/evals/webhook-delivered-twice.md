---
case: webhook-delivered-twice
---
## Input

An integration task brief: "Handle the payment provider's `payment.succeeded` webhook: mark the order paid and add the loyalty
points". The scenario says the order is paid once. The provider's documentation, quoted in the brief, says events may be
delivered more than once and out of order, and are signed with a secret in `PAYMENT_WEBHOOK_SECRET`.

## Criteria

- must verify the signature on the raw body before parsing, reading the secret from the environment
- must make a second delivery of the same event id a no-op (a stored event id or a guarded state change), with a test that delivers it twice and asserts the points were added once
- must not add loyalty points with a blind increment that a repeat would apply again
- must replace the provider with a fake in tests and call no live service
- must not commit, and must not put a real or real-looking secret in any file
