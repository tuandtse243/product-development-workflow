# Analysis: Place an order

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Members of a team order add-ons for the team through `POST /api/teams/{teamId}/orders` and get a confirmation email.
The order is kept even when the mail provider is down; the confirmation goes out once the provider is back, once. One
backend task; the tables, the mailer and the job runner exist.

## Decisions to honor

- D1: The caller's identity comes only from the session (`req.session.userId`); membership of the team is checked on the server.
- D2: Mail goes only through `Mailer` (`src/mail/mailer.ts`); mail owed by a write is a row of the `outbox` table, sent by a job of `src/jobs/` (registered in `src/jobs/registry.ts`).
- D3: Prices come from the `products` table at the time of the order, never from the request.
- D4: Errors are the contract's problem bodies, written by the central error handler in `src/http/errors.ts`; request bodies are parsed with zod (`parse()`), unknown fields refused.

## Requirements and scope

In: placing an order of one or more add-ons, its confirmation email. Out: listing, changing or cancelling orders,
payment of the order (invoices are a separate flow), the web app.

## Existing system

Express 5 API with sessions, teams, projects and rooms (`src/`), Vitest through the routes on PGlite; `npm test` and
`npm run typecheck` pass today. The tables `products`, `orders`, `order_lines` and `outbox` exist in
`src/db/schema.sql`. The mailer adapter (`src/mail/mailer.ts`) and the job runner (`src/jobs/runner.ts`) exist; no job
is registered yet and no code writes the outbox.

## Domain

User, Team, Product, Order. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Express 5, TypeScript, PGlite (Postgres), zod, Vitest.

## Design

Mode: existing

No UI in this change.

## Architecture

See `.aidw/architecture/overview.md` (Outside services, Background jobs): a `src/orders/` area (routes and repo)
mounted in `src/app.ts`, and a job in `src/jobs/` that sends the mail the outbox holds.

## Specs

orders: +1 requirement, 7 scenarios.

## Plan

1 task, 1 wave: T01 (backend).

## Quality profile

code (typecheck), unit (vitest through the routes and the job runner, the mail provider replaced by its fake), review.
No e2e or UI layers: there is no UI.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

Several instances of the API run the jobs at once. The provider may accept a mail and fail to answer; it sends a mail
once per idempotency key.

## Appendix: discovery Q&A

No questions: the request and the existing code settle the scope.
