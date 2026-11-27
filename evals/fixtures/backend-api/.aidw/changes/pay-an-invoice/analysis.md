# Analysis: Pay an invoice

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Members of a team pay an invoice of the team with its saved card through
`POST /api/invoices/{invoiceId}/payments`. The client sends an `Idempotency-Key` with each payment; a request sent again
with the same key charges nothing more and gets the first answer. One backend task; the tables exist.

## Decisions to honor

- D1: The caller's identity comes only from the session (`req.session.userId`); the invoice's team is looked up on the server.
- D2: The card is charged only through `PaymentGateway` (`paymentGateway()` in `src/billing/gateway.ts`), always with an idempotency key; no code calls the provider's HTTP API directly.
- D3: Idempotency-Keys are stored in the `idempotency_keys` table, scoped to the caller.
- D4: Errors are the contract's problem bodies, written by the central error handler in `src/http/errors.ts`; request bodies are parsed with zod (`parse()`), unknown fields refused.

## Requirements and scope

In: paying an invoice, in full or in part, once per Idempotency-Key. Out: refunds, listing payments, the invoice's
balance (a later change), webhooks of the provider, the web app.

## Existing system

Express 5 API with sessions, teams, projects and rooms (`src/`), Vitest through the routes on PGlite; `npm test` and
`npm run typecheck` pass today. The tables `invoices`, `payments` and `idempotency_keys` exist in `src/db/schema.sql`
with no route using them yet. The payment provider adapter exists (`src/billing/gateway.ts`) with a fake for tests.

## Domain

User, Team, Invoice, Payment. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Express 5, TypeScript, PGlite (Postgres), zod, Vitest.

## Design

Mode: existing

No UI in this change.

## Architecture

See `.aidw/architecture/overview.md` (Outside services): a `src/payments/` area (routes and repo) mounted in
`src/app.ts`, charging through the existing gateway.

## Specs

payments: +1 requirement, 7 scenarios.

## Plan

1 task, 1 wave: T01 (backend).

## Quality profile

code (typecheck), unit (vitest through the routes, the provider replaced by its fake), review. No e2e or UI layers:
there is no UI.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

A provider that does not answer may still have charged the card: the provider's idempotency key is what keeps a retry
from charging twice. Assumes the provider keeps idempotency keys for at least a day.

## Appendix: discovery Q&A

No questions: the request, the provider's documentation and the existing code settle the scope.
