# Architecture

A JSON API for a team task tracker. A user belongs to one or more teams; a team owns projects; a project holds tasks.
A team also orders add-ons, pays its invoices with a saved card, and books its meeting rooms by the hour.

## Structure

- `src/app.ts`: builds the Express app; mounts one router per area, then the 404 and error handlers.
- `src/http/`: shared HTTP pieces: `requireSession` (session middleware), `parse` (zod validation), `errors.ts`
  (problem bodies and the central error handler).
- `src/<area>/routes.ts` and `src/<area>/repo.ts`: the routes and the queries of an area (`auth`, `teams`, `projects`,
  `rooms`).
- `src/db/`: the PGlite client (`createDb`) and the schema.
- `src/mail/`: the mailer adapter (`Mailer`; `memoryMailer` in tests).
- `src/billing/gateway.ts`: the payment provider adapter (`PaymentGateway`; `memoryGateway` in tests).
- `src/jobs/`: background jobs (`runner.ts` runs every job listed in `registry.ts`).
- `src/config.ts`: the only module that reads environment variables.

## Sessions

`POST /api/sessions` returns a token; the client sends `Authorization: Bearer <token>`. `requireSession(db)` sets
`req.session.userId` or answers `401 unauthenticated`.

## Tenancy

The team of a project is `projects.team_id`. A caller may act on a record of a team only when a `team_members` row
links the caller to that team. A record of a team the caller is not in is answered as if it did not exist (404).

## Outside services

- Mail: `Mailer.send(mail, { timeoutMs, idempotencyKey })` in `src/mail/mailer.ts`. Without `timeoutMs` the provider's
  HTTP client waits as long as the connection stays open. The provider sends a mail once per `idempotencyKey`.
- Payments: `PaymentGateway.charge({ amount, currency, customer, idempotencyKey })` in `src/billing/gateway.ts`. The
  HTTP adapter sets its own timeout and retries a timeout or a 5xx twice with the same idempotency key; it reports
  `GatewayError` `declined` (the card was refused) or `unavailable` (no answer: the charge may have happened). Code takes
  the gateway from `paymentGateway()` when a request needs it; `src/server.ts` installs the HTTP adapter, and a test
  installs `memoryGateway()` with `usePaymentGateway()` before it sends requests.
- Tests never reach a real provider: they use `t.mailer` (the `memoryMailer` that `testApp()` passes to the app) and
  `memoryGateway()`.

## Background jobs

A job is `{ name, run(deps) }` (`src/jobs/runner.ts`) listed in `src/jobs/registry.ts`. Every instance of the API runs
`runJobsOnce({ db, mailer })` every few seconds, so two rounds of the same job can run at the same moment; tests call
`runJobsOnce` themselves. Mail owed by a write is a row of the `outbox` table (see the comment on the table in
`src/db/schema.sql`).

## Concurrency

Rules that must hold when two requests arrive at once are enforced by the database. PGlite gives the tests one
connection, which runs one statement at a time; requests sent at once still interleave between their statements.
