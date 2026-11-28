# Analysis: Invite a person

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

An owner invites a colleague from a form at `/people/invite`: a name and an email, sent to the API, which emails the
invitation. One frontend task; the API operation exists. The form refuses what the contract refuses before sending,
shows the API's field errors next to their fields, keeps what was typed, and sends one request however many times it
is submitted.

## Decisions to honor

- D1: The form sends and handles only what `api-contract.md` names: the fields `name` and `email`, the `201`, the `422` field errors and the `400`; its client checks mirror the contract's rules and never replace the API's.
- D2: Styles use the design tokens (`src/styles/tokens.css`); no literal color, size or spacing.
- D3: An error that belongs to a field is shown next to that field, never as a toast; the contact form's toast is not the pattern for this form.

## Requirements and scope

In: the form and its route, the client checks of the name, the field errors of a `422`, the failed-send state, the
sent state, one request per submit. Out: who may invite (the API decides and answers), listing invitations, the
email itself, the API.

## Existing system

Vite + React 19 single-page app (`src/`), React Router 7 (`src/routes.tsx`), Vitest with jsdom, Testing Library,
user-event and MSW (`tests/msw/`); `npm test` and `npm run typecheck` pass today. The contact form (`src/contact/`)
is the only form so far. Shared primitives are in `src/ui/`. An `ApiError` (`src/api/client.ts`) carries the status, the
problem `type` and the parsed problem body (`body`), where a `422`'s `errors` are.

## Domain

Patient, Doctor, Day, Slot, Booking. An invitation is the API's concern; the Change adds no entity to
`.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept: Vite, React 19, TypeScript, React Router 7, Vitest, Testing Library, MSW.

## Design

Mode: existing

The approved tokens are `.aidw/design/tokens.yaml` (CSS variables in `src/styles/tokens.css`). No new token.

## Architecture

See `.aidw/architecture/overview.md`: a `src/team/` area (the form, its API call) and one route in
`src/routes.tsx`.

## Specs

team: +1 requirement, 6 scenarios.

## Plan

1 task, 1 wave: T01 (frontend).

## Quality profile

code (typecheck), unit (Vitest through the app's router, MSW for the API), review. No e2e and no a11y layer: the
project has no browser to run axe in; labels and descriptions are tested through Testing Library in the unit layer.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

An owner who clicks twice must not invite twice. Whether an owner may invite at all is the API's decision; this
Change does not guess it.

## Appendix: discovery Q&A

No questions: the request and the contract settle the scope.
