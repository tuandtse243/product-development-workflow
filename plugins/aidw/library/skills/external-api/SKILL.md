---
name: external-api
description: Call a third-party service behind an interface, with a timeout, bounded retries and a fake in tests.
---

# External API

- **An interface of your own.** The application depends on a small interface named for what it needs (`PaymentGateway.charge`),
  not on the vendor's SDK types. One adapter implements it for the real service.
- **Timeout on every call.** Never wait forever; pick a number from the architecture or a short default (a few seconds).
- **Bounded retry.** Retry only calls that are safe to repeat (a read, or a write with an idempotency key), at most 2 or 3
  times, with backoff. Never retry a 4xx other than 429; honor `Retry-After`.
- **Map errors.** Turn the vendor's errors into the application's own error type, so the caller handles "unavailable" and "rejected"
  differently and no vendor message reaches the user.
- **Secrets by name.** The key comes from an environment variable named in `.env.example`; never in code, in a log or in a test.
- **A fake at the boundary.** Tests replace the adapter (or the HTTP layer with a local stub), cover success, a rejection, a
  timeout and a 5xx, and never reach the real service.

## Sources

Ideas, not wording: the ports-and-adapters pattern (Alistair Cockburn, "Hexagonal architecture"); the timeout,
retry and backoff guidance of the AWS Builders' Library; Stripe's guidance on idempotent requests; RFC 6585 for
`429` and RFC 9110 for `Retry-After`.
