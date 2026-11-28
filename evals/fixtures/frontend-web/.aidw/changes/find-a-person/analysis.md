# Analysis: Find a person

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Patients type a name into a search box and see the people of the clinic who match: a new screen at `/people`, one
search request per text typed. One frontend task; the API operation exists. The screen shows the answer to the latest
text only, however late an earlier answer arrives, and goes back to its first state when the box is emptied.

## Decisions to honor

- D1: The screen reads only through the operation of `api-contract.md`, with `src/api/client.ts`; which people match a text is the API's answer, never filtered in the client.
- D2: Styles use the design tokens (`src/styles/tokens.css`); no literal color, size or spacing.
- D3: The answer to an earlier text is never shown once the text has changed, whatever the order the answers arrive in; the screen does not rely on the API answering in order.

## Requirements and scope

In: the search screen and its route, the first, waiting, result, no-match and failed states. Out: opening a person's
page, paging past 20 results, signing in, the API.

## Existing system

Vite + React 19 single-page app (`src/`), React Router 7 (`src/routes.tsx`), Vitest with jsdom, Testing Library and MSW
(`tests/msw/`); `npm test` and `npm run typecheck` pass today. Pages load data with `useLoad` (`src/data/useLoad.ts`) or
`useFetch` (`src/data/useFetch.ts`, which the notices page uses). Shared primitives are in `src/ui/`.

## Domain

Patient, Doctor, Day, Slot, Booking. A person is a member of the clinic's staff, known by name and title; the Change
adds no entity to `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Vite, React 19, TypeScript, React Router 7, Vitest, Testing Library, MSW.

## Design

Mode: existing

The approved tokens are `.aidw/design/tokens.yaml` (CSS variables in `src/styles/tokens.css`). No new token.

## Architecture

See `.aidw/architecture/overview.md`: a `src/people/` area (the screen, its API call) and one route in
`src/routes.tsx`.

## Specs

people: +1 requirement, 7 scenarios.

## Plan

1 task, 1 wave: T01 (frontend).

## Quality profile

code (typecheck), unit (Vitest through the app's router, MSW for the API), review. No e2e and no a11y layer: the
project has no browser to run axe in.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

The connection is slow some mornings: a slow answer to an earlier text must never replace a faster answer to the
current one.

## Appendix: discovery Q&A

No questions: the request and the contract settle the scope.
