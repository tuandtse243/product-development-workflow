# Analysis: Invite with one schema

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

An owner of a team invites a person from the Team page (`/team`, a page with only its heading and its header link so far): a dialog with the person's name and email. One slice
with both halves: a new operation `POST /api/invites` that stores the invitation, and the dialog that uses it. The name
(1 to 80 characters) and the email are refused on the form before any request, and by the server with the same limits.

## Decisions to honor

- D1: The server decides who may invite and what an invitation may hold; the page shows what the API answers (the constitution).
- D2: A name is trimmed before it is counted; at most 80 characters, as everywhere in the app.
- D3: The rules of the request (the name's and the email's) are written once in `shared/` and used by both halves.

## Requirements and scope

In: the invite operation, the dialog on the Team page and its states (a refused name or email, a refused member,
a failure, saving). Out: sending the invitation email, accepting an invitation, listing or
withdrawing invitations, the database schema (the `invites` table exists).

## Existing system

`npm test` and `npm run typecheck` pass today. The server has `server/invites/rules.ts`, the rules of an invitation as a zod
schema, not used by a route yet; the web app has the Team page (`web/team/`, routed and linked already) and a client
that calls `fetch` (`web/api/client.ts`); tests go through the real server (`web/tests/`).

## Domain

User, Team (owner, member), Invite. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept.

## Design

Mode: existing. No design tokens: the app has none.

## Architecture

See `.aidw/architecture/overview.md`: the route in `server/invites/`, the dialog in `web/team/`, the rules in `shared/`.

## Specs

invites: +1 requirement, 5 scenarios.

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

The existing rules live next to the database code; the form has to apply the same limits.

## Appendix: discovery Q&A

No questions: the request and the contract settle the scope.
