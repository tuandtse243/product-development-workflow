# Constitution

Project-wide engineering principles. Every agent reads this file before working.
It is part of the approved Analysis package: changing it after approval is drift.

## Principles

- Who the caller is comes from the session (`req.session.userId`, set by `requireSession`), and nothing else.
- Every input is parsed with a zod schema before it is used (`parse()` in `src/http/validate.ts`).
- Errors are problem bodies (`HttpError` in `src/http/errors.ts`); the central error handler is the only place that
  writes an error response.
- Tests go through the HTTP routes with the in-process `t.http()` client of `testApp()` in `tests/helpers.ts`
  (chains such as `await t.http().post(url).set(name, value).send(body)`; no port, no socket) on a fresh in-memory
  database. A test never starts the app with `listen()`.

## Stack and conventions

- Express 5 (async handlers may throw), TypeScript run by Vitest, Postgres through PGlite in process.
- One folder per area under `src/` (`routes.ts` for the router, `repo.ts` for the queries); its tests under
  `tests/<area>/` or `tests/<area>.test.ts`.
- SQL is written by hand with `$1` parameters; never built from strings.
- The schema (`src/db/schema.sql`) belongs to the database Role: a change to it is a task of its own.
