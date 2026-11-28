# Analysis: Rename a project

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

The owner of a team renames one of its projects from the project's page (`/projects/{projectId}`). One slice with both
halves: a new operation `PATCH /api/projects/{projectId}` and the form on the project page that uses it. The list at `/`
must show the new name afterwards.

## Decisions to honor

- D1: The server decides who may rename and whether a name is taken; the page shows what the API answers (the constitution).
- D2: The name is trimmed by the server; after a save the page shows the name the server stored, not what was typed.
- D3: The shape of the request is written once in `shared/projects.ts` and used by both halves.

## Requirements and scope

In: the rename operation, the form on the project page, its states (saving, a taken or blank name, a refused member, a
failure), and the projects list showing the new name. Out: creating or deleting a project, renaming a team, changing who
is an owner, signing in, the database schema (it already has the unique name per team).

## Existing system

`npm test` and `npm run typecheck` pass today. The server has `GET /api/projects` and `GET /api/projects/:projectId`
(`server/projects/`); the web app has the list page and the project page (`web/projects/`), a client that calls `fetch`
(`web/api/client.ts`) and tests that go through the real server (`web/tests/`).

## Domain

User, Team (owner, member), Project. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept.

## Design

Mode: existing. No design tokens: the app has none.

## Architecture

See `.aidw/architecture/overview.md`: the route and its queries in `server/projects/`, the form in `web/projects/`, one
schema in `shared/projects.ts`.

## Specs

projects: +1 requirement, 6 scenarios.

## Plan

1 task, 1 wave: T01 (fullstack).

## Quality profile

code (typecheck), unit (Vitest: server tests through the route, web tests through the screen into the real server),
review. No e2e: the project has no browser.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

The existing client reads errors in its own way and the list is kept in a store: both must be checked against what the
server really sends and what a write changes.

## Appendix: discovery Q&A

No questions: the request and the contract settle the scope.
