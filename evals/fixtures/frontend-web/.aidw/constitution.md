# Constitution

Project-wide engineering principles. Every agent reads this file before working.
It is part of the approved Analysis package: changing it after approval is drift.

## Principles

- The web app shows what the clinic API answers; it holds no rule the API decides (whether a slot is free, who may
  book). The API is described by each Change's `api-contract.md`.
- Every request goes through `src/api/client.ts` (`getJson`, `postJson`); an error answer is an `ApiError` with its
  status and problem `type`.
- Styles use the design tokens (`.aidw/design/tokens.yaml`, as CSS variables in `src/styles/tokens.css`), never a
  literal color, size or spacing.
- Tests render through the app's router (`renderAt(path)` in `tests/render.tsx`), find controls the way a user does
  (role, label, text) and act with user-event. The network is MSW (`tests/msw/`): no test reaches a real server, and a
  request without a handler fails.

## Stack and conventions

- Vite, React 19, TypeScript, React Router 7 (`src/routes.tsx` holds every route); Vitest with jsdom, Testing Library,
  user-event and jest-dom; MSW (`msw/node`) for the network.
- One folder per area under `src/` (a page component, its parts, its API calls and its CSS file); the shared
  primitives are in `src/ui/`. Tests of an area are under `tests/<area>/` or `tests/<area>.test.tsx`.
- `tests/setup.ts`, `tests/environment.ts`, `tests/render.tsx` and `tests/msw/` are the test harness: a feature task
  uses them as they are and does not change them.
