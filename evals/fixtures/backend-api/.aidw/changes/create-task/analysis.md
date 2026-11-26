# Analysis: Create a task in a project

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Members of a team can create tasks in the team's projects through `POST /api/projects/{projectId}/tasks`. One backend
task; the `tasks` table already exists. The team of a task is always its project's team, and only members of that
team may create one.

## Decisions to honor

- D1: The caller's identity comes only from the session (`req.session.userId`); the team of a task is the team of its project, looked up on the server.
- D2: Errors are the contract's problem bodies, written by the central error handler in `src/http/errors.ts`.
- D3: Request bodies are parsed with zod (`parse()` in `src/http/validate.ts`); unknown fields are refused.

## Requirements and scope

In: creating a task (title, optional due date). Out: listing, editing, deleting and assigning tasks; the web app.

## Existing system

Express 5 API with sessions, teams and projects (`src/`), Vitest and supertest on PGlite; `npm test` and
`npm run typecheck` pass today. The `tasks` table exists in `src/db/schema.sql` with no route using it yet. The
projects routes take the selected team from the `x-team-id` header the web app sends.

## Domain

User, Team, Project, Task. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Express 5, TypeScript, PGlite (Postgres), zod, Vitest, supertest.

## Design

Mode: existing

No UI in this change.

## Architecture

See `.aidw/architecture/overview.md`: a `src/tasks/` area (routes and repo) mounted in `src/app.ts`.

## Specs

tasks: +1 requirement, 5 scenarios.

## Plan

1 task, 1 wave: T01 (backend).

## Quality profile

code (typecheck), unit (vitest through the routes), review. No e2e or UI layers: there is no UI.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

Assumes a session token in the `Authorization` header, as the existing routes use.

## Appendix: discovery Q&A

No questions: the request and the existing code settle the scope.
