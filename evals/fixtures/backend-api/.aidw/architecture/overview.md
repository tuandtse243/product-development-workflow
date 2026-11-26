# Architecture

A JSON API for a team task tracker. A user belongs to one or more teams; a team owns projects; a project holds tasks.

## Structure

- `src/app.ts`: builds the Express app; mounts one router per area, then the 404 and error handlers.
- `src/http/`: shared HTTP pieces: `requireSession` (session middleware), `parse` (zod validation), `errors.ts`
  (problem bodies and the central error handler).
- `src/<area>/routes.ts` and `src/<area>/repo.ts`: the routes and the queries of an area (`auth`, `teams`, `projects`).
- `src/db/`: the PGlite client (`createDb`) and the schema.
- `src/mail/`: the mailer adapter (an interface; a fake in tests).
- `src/config.ts`: the only module that reads environment variables.

## Sessions

`POST /api/sessions` returns a token; the client sends `Authorization: Bearer <token>`. `requireSession(db)` sets
`req.session.userId` or answers `401 unauthenticated`.

## Tenancy

The team of a project is `projects.team_id`. A caller may act on a record of a team only when a `team_members` row
links the caller to that team. A record of a team the caller is not in is answered as if it did not exist (404).
