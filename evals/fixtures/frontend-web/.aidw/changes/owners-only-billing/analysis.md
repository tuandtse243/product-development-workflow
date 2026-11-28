# Analysis: Owners-only billing

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

A billing page at `/billing` that shows the clinic's plan, the balance due and the date of the next invoice to a signed-in
owner. A visitor who is not signed in is sent to `/login`; a signed-in member sees that the page is for owners only. Who
is signed in, and as what, is the API's answer (`GET /api/session`), and the API itself refuses the billing data to a
member. One frontend task; both operations exist. When the app is configured with a Stripe test key, the page says so.

## Decisions to honor

- D1: The role of the person comes only from `GET /api/session`; the screen never decides access from anything the browser stores (the `role` the sign-in app leaves in `localStorage` included).
- D2: The billing data is requested only once the session says the person is an owner; a member or a signed-out visitor causes no billing request.
- D3: Styles use the design tokens (`src/styles/tokens.css`); no literal color, size or spacing.
- D4: The only environment variable the app reads for Stripe is `VITE_STRIPE_PUBLISHABLE_KEY`, which is public by design; `STRIPE_SECRET_KEY` belongs to the API and appears nowhere in the app.

## Requirements and scope

In: the billing route and its access check, the checking, owner, member and signed-out cases, the billing summary, the
test-mode badge. Out: paying, changing the plan, the sign-in app, the navigation links, the API.

## Existing system

Vite + React 19 single-page app (`src/`), React Router 7 (`src/routes.tsx`), Vitest with jsdom, Testing Library,
user-event and MSW (`tests/msw/`); `npm test` and `npm run typecheck` pass today. `/login` exists (`src/auth/`) and
tells a visitor to sign in with the clinic's sign-in app. The header links (`src/Layout.tsx`) are outside this task.
`.env.example` lists `VITE_STRIPE_PUBLISHABLE_KEY` and the API's `STRIPE_SECRET_KEY`.

## Domain

Patient, Doctor, Day, Slot, Booking. A member and an owner are roles of the signed-in person, known to the API; the
Change adds no entity to `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Vite, React 19, TypeScript, React Router 7, Vitest, Testing Library, MSW.

## Design

Mode: existing

The approved tokens are `.aidw/design/tokens.yaml` (CSS variables in `src/styles/tokens.css`). No new token.

## Architecture

See `.aidw/architecture/overview.md`: a `src/billing/` area (the page, the access check, its API calls) and one route in
`src/routes.tsx`.

## Specs

billing: +1 requirement, 5 scenarios.

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

The billing data is private to owners: a member must be refused by the API as well as by the screen. A value in
`localStorage` can be set by anyone, so it decides nothing.

## Appendix: discovery Q&A

No questions: the request and the contract settle the scope.
