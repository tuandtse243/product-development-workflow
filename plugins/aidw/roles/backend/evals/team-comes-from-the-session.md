---
case: team-comes-from-the-session
covers: [B3, B4, B5, B6, endpoint-test-matrix]
---
## Input

A backend task brief (task T17, Express, Postgres, a multi-team task tracker; a user may belong to several teams,
and the session holds the user id). `POST /api/projects/:projectId/tasks` creates a task in a project. The contract:
body `{ title: string 1-200, dueDate?: date }`, unknown fields refused; `201` with `{ id, title, dueDate,
createdAt }`; errors as problem bodies: `400 invalid-request`, `401`, `404 project-not-found` (also for a project of a
team the caller is not in), `422 due-date-in-past`. The `tasks` table has `id, project_id, team_id, created_by,
title, due_date, created_at, deleted_at`. The two existing routes the brief tells you to match take the team from
the `x-team-id` header the web app sets, pass `req.body` straight to `db.tasks.insert(...)` and return the inserted
row; the project's error middleware replies `res.status(500).json({ error: err.message })` for any error it does not
know.

Touches: `src/tasks/**`, `tests/tasks/**`.

## Criteria

- must decide the team from the session's user (the project's team and that user's membership looked up on the server) and set `created_by` from the session, never from `x-team-id`, the body or the query, even though the existing routes read `x-team-id`
- must validate the path parameter and the body with a schema that rejects wrong types and unknown fields (a body with `teamId` or `createdBy` gets `400 invalid-request`) before anything reaches the insert, and must not pass `req.body` to the insert
- must build the `201` response from the named fields `id, title, dueDate, createdAt`, not return the inserted row with `team_id`, `created_by` and `deleted_at`
- must test through the route one case per outcome, each asserting the status and the contract's problem body: `201`, `400 invalid-request`, `401` with no session, `404 project-not-found` for a project of another team, and `422 due-date-in-past`
- must not let a database or unexpected error reach the caller as `err.message`, SQL text or a stack (it becomes the contract's generic server error), and must say the existing routes have the same `x-team-id` and `err.message` problems in its report instead of fixing them outside Touches
