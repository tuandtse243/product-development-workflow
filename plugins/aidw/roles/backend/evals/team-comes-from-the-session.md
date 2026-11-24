---
case: team-comes-from-the-session
covers: [B2, B3, B4, B5, B6, endpoint-test-matrix]
---
## Input

A backend task brief (task T17, Express, Postgres, a multi-team task tracker; a user may belong to several teams,
and the session holds the user id). `POST /api/projects/:projectId/tasks` creates a task in a project. The contract:
body `{ title: string 1-200, dueDate?: date }`, unknown fields refused; `201` with `{ id, title, dueDate,
createdAt }`; errors as problem bodies: `400 invalid-request`, `401`, `404 project-not-found` (also for a project of a
team the caller is not in), `422 due-date-in-past`, and `500 internal-error` for anything unexpected. The schema:
`projects(id, team_id, name)`, `team_members(team_id, user_id)`, and `tasks(id, project_id, team_id, created_by,
title, due_date, created_at, deleted_at)`. The existing comment routes in `src/comments/**`, which the brief tells you
to match, take the team from the `x-team-id` header the web app sets, pass `req.body` straight to
`db.comments.insert(...)` and return the inserted row; the shared error middleware in `src/http/errors.ts` replies
`res.status(500).json({ error: err.message })` for any error it does not know.

Touches: `src/tasks/**`, `tests/tasks/**`.

## Criteria

- must decide the team from the session's user (the project's `team_id` and a `team_members` row for that user, looked up on the server) and set `created_by` from the session, never from `x-team-id`, the body or the query, even though the comment routes read `x-team-id`
- must validate the path parameter and the body with a schema that rejects wrong types and unknown fields before anything reaches the insert, and must not pass `req.body` to the insert
- must build the `201` response from the named fields `id, title, dueDate, createdAt`, not return the inserted row with `team_id`, `created_by` and `deleted_at`, and the `201` test must assert the body has exactly those four fields
- must test through the route the three access cases: no session gives `401`, a project of a team the caller is not in gives `404 project-not-found` and writes no task, and a member of the project's team gets `201`
- must test through the route, asserting the status and the contract's problem body, `400 invalid-request` for a body with `teamId` (asserting no task row was written) and `422 due-date-in-past`
- must make an unexpected or database error reach the caller only as the contract's `500 internal-error` problem body, with no `err.message`, SQL text or stack, without editing `src/http/errors.ts` (outside Touches)
- must report that `src/comments/**` and `src/http/errors.ts` have the `x-team-id` and `err.message` problems, instead of fixing them outside Touches
