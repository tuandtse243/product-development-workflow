# Analysis: Book a room

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Members of a team book a meeting room of the team for an hour through `POST /api/rooms/{roomId}/bookings`. A slot (a
room and the hour it starts) has at most one active booking, also when two members book it at the same moment. One
backend task; the tables and the constraint exist.

## Decisions to honor

- D1: The caller's identity comes only from the session (`req.session.userId`); the room's team is looked up on the server.
- D2: At most one active booking per slot is enforced by the database: the unique index `bookings_one_active_per_slot` (see data-model.md).
- D3: Errors are the contract's problem bodies, written by the central error handler in `src/http/errors.ts`; request bodies are parsed with zod (`parse()`), unknown fields refused.

## Requirements and scope

In: booking a free slot of a room. Out: cancelling and listing bookings, recurring bookings, the web app.

## Existing system

Express 5 API with sessions, teams, projects and rooms (`src/`), Vitest through the routes on PGlite; `npm test` and
`npm run typecheck` pass today. The tables `rooms` and `bookings` exist in `src/db/schema.sql`; `src/rooms/` answers
whether a slot is free (`GET /api/rooms/{roomId}/slots/{startsAt}`).

## Domain

User, Team, Room, Booking. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Express 5, TypeScript, PGlite (Postgres), zod, Vitest.

## Design

Mode: existing

No UI in this change.

## Architecture

See `.aidw/architecture/overview.md` (Concurrency): a `src/bookings/` area (routes and repo) mounted in `src/app.ts`.

## Specs

bookings: +1 requirement, 7 scenarios.

## Plan

1 task, 1 wave: T01 (backend).

## Quality profile

code (typecheck), unit (vitest through the routes, bookings sent at once), review. No e2e or UI layers: there is no UI.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

In production several instances of the API share one Postgres, so two bookings of one slot can be in flight at once.

## Appendix: discovery Q&A

No questions: the request and the existing code settle the scope.
