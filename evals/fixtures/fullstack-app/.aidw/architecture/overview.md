# Architecture

A small app for the projects of a team: signed-in users see the projects of the teams they belong to and open one. A
Vite + React 19 single-page app (`web/`) over a JSON API (`server/`, Express 5 with PGlite, which is Postgres in process),
in one repository, with the shapes both halves use in `shared/`.

## Structure

- `shared/`: zod schemas used by both halves: `projects.ts` (a project, the list) and `errors.ts` (the error body). Nothing
  server-only is imported here.
- `server/app.ts`: the Express app (`createApp({ db })`); `server/server.ts` listens (development only).
- `server/auth/`: sessions (`sid` cookie) and `POST /api/sessions`. `server/http/`: `HttpError`, the error handler,
  `requireSession`, `parse`.
- `server/teams/`: a user's teams and role in a team (`owner` or `member`). `server/projects/`: `GET /api/projects` and
  `GET /api/projects/:projectId`, with `repo.ts` for the queries.
- `server/db/`: the PGlite client and `schema.sql` (the Database Role's).
- `web/main.tsx`, `web/routes.tsx`, `web/Layout.tsx`: the router (`/` the list, `/projects/:projectId` a project) and the frame.
- `web/api/client.ts`: the only module that calls `fetch` (`getJson`, `postJson`, `ApiError`).
- `web/projects/`: the list page (its data kept in `store.ts` for the life of the page), the project page and their API calls.

## The API

Paths are `/api/...`, resolved against the page's origin: the dev server proxies them to the API (`vite.config.ts`). The
browser sends the `sid` cookie with every request. Each Change's `api-contract.md` is the contract.

## Tests

`npm test` runs Vitest with two projects. `server` tests use `testApp()` (`server/tests/helpers.ts`) and its in-process
`http()` client over an in-memory database. `web` tests run in jsdom (`web/tests/environment.ts` keeps Node's
AbortController, which Node's `fetch` needs); MSW answers every `/api/*` request by forwarding it to the same Express app
over the same kind of database (`web/tests/msw/handlers.ts`, `web/tests/backend.ts`): a web test seeds rows with
`(await backend()).seed`, signs in with `signIn(user)` and renders the app with `renderAt(path)`.
