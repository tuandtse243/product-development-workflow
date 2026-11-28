# Analysis: Book a slot

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Patients open a day of a doctor's calendar and book a free slot from the web app: a new screen at
`/doctors/{doctorId}/days/{date}`, which the doctor's page already links to. One frontend task; the API operations
exist.

## Decisions to honor

- D1: The screen reads and books only through the operations of `api-contract.md`, with `src/api/client.ts`; whether a slot is free is the API's answer, never computed in the client.
- D2: Styles use the design tokens (`src/styles/tokens.css`); no literal color, size or spacing.
- D3: The booking is confirmed in the project's shared `Dialog` (`src/ui/Dialog.tsx`); no second dialog component.

## Requirements and scope

In: the slots of one day, booking an open slot, the loading, empty and error states. Out: cancelling or listing
bookings, signing in, the doctors list and the doctor's page (they exist), the API.

## Existing system

Vite + React 19 single-page app (`src/`), React Router 7 (`src/routes.tsx`), Vitest with jsdom, Testing Library and MSW
(`tests/msw/`); `npm test` and `npm run typecheck` pass today. The doctors list and a doctor's page exist
(`src/doctors/`); picking a day on the doctor's page navigates to `/doctors/{doctorId}/days/{date}`, which has no route
yet. Shared primitives in `src/ui/`; pages load data with `useLoad` (`src/data/useLoad.ts`).

## Domain

Patient, Doctor, Day, Slot, Booking. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Vite, React 19, TypeScript, React Router 7, Vitest, Testing Library, MSW.

## Design

Mode: existing

The approved tokens are `.aidw/design/tokens.yaml` (CSS variables in `src/styles/tokens.css`). No new token.

## Architecture

See `.aidw/architecture/overview.md`: a `src/booking/` area (the screen, its parts, its API calls) and one route in
`src/routes.tsx`.

## Specs

booking: +1 requirement, 8 scenarios.

## Plan

1 task, 1 wave: T01 (frontend).

## Quality profile

code (typecheck), unit (Vitest through the app's router, MSW for the API), review. No e2e and no a11y layer: the
project has no browser to run axe in; names, roles and focus are tested through Testing Library in the unit layer.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

The API can be down for minutes at a time: a failed load must not look like a day with no slots.

## Appendix: discovery Q&A

No questions: the request, the contract and the existing screens settle the scope.
