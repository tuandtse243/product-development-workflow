# Constitution

Project-wide engineering principles. Every agent reads this file before working.
It is part of the approved Analysis package: changing it after approval is drift.

## Principles

- Who the caller is comes from the session (`req.session.userId`, set by `requireSession` from the `sid` cookie), and
  nothing else. The server decides what a caller may do; the web app only shows what the API answers.
- Every input is parsed with a zod schema before it is used (`parse()` in `server/http/validate.ts`). A shape both halves
  use is written once in `shared/` and imported by `server/` and `web/`; `shared/` imports nothing server-only.
- Errors are `{ "error": { "code", "message"?, "fields"? } }` (`HttpError` in `server/http/errors.ts`; the shape is
  `shared/errors.ts`); the central error handler is the only place that writes an error response.
- Every request of the web app goes through `web/api/client.ts`.
- Server tests go through the HTTP routes with the in-process `t.http()` client of `testApp()` in `server/tests/helpers.ts`
  (no port, no socket) on a fresh in-memory database. Web tests render through the app's router (`renderAt(path)` in
  `web/tests/render.tsx`), find controls the way a user does (role, label, text) and act with user-event; the network is
  MSW, which forwards every `/api/*` request to the real server in the same process (`web/tests/msw/handlers.ts`), so a
  screen is tested against the answers the server really gives. A test that must see a failure the server cannot be made
  to give overrides one route with `server.use(...)`.

## Stack and conventions

- One repository, three folders: `server/` (Express 5, PGlite, zod), `web/` (Vite, React 19, React Router 7) and `shared/`
  (zod schemas). Vitest runs two projects (jsdom for `web/**`, node for `server/**`).
- One folder per area (`server/<area>/` with `routes.ts` and `repo.ts`; `web/<area>/` with its pages, API calls and
  state); tests under `server/tests/` and `web/tests/`.
- SQL is written by hand with `$1` parameters; never built from strings. The schema (`server/db/schema.sql`) belongs to the
  database Role: a change to it is a task of its own.
- The test harness (`web/tests/setup.ts`, `web/tests/environment.ts`, `web/tests/render.tsx`, `web/tests/backend.ts`,
  `web/tests/msw/`, `server/tests/helpers.ts`, `server/tests/http.ts`) is used as it is by a feature task.
