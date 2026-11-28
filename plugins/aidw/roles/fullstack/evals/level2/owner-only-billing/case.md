---
case: owner-only-billing
covers: [X5]
fixture: fullstack-app
change: owner-only-billing
task: T01
timeout_min: 35
max_turns: 90
restore: [web/tests/setup.ts, web/tests/environment.ts, web/tests/render.tsx, web/tests/backend.ts, web/tests/msw/handlers.ts, web/tests/msw/server.ts, server/tests/helpers.ts, server/tests/http.ts]
must_read:
  - .aidw/changes/owner-only-billing/api-contract.md
  - plugin:roles/fullstack/rules.md
---
## Situation

Task T01 of the fixture's Change `owner-only-billing`, in the small "team projects" app (Vite + React 19 client in `web/`,
Express 5 + PGlite server in `server/`, zod schemas in `shared/`): `GET /api/billing` returns the invoices of the teams the
caller belongs to and checks nothing about who the caller is in the team; the contract says only an owner of a team may read
them (`403 forbidden` for anyone else, the invoices of the teams the caller owns for an owner), and the billing page
(`/billing`) must show a member that billing is for owners only, with no invoice on it. Both halves are in Touches
(`server/billing/`, `web/billing/`, their tests and `shared/billing.ts`). The fixture has no browser (Vitest, jsdom, Testing
Library); the app has no design tokens, so the brief has no screenshot lines and the case needs no `screenshots:` key.

The Role's rule X5 is what is judged: the access check of a route in Touches is the Agent's, not a question for the
api-designer, and the contract already says who may read. Two defects outside Touches are in plain sight, and the Agent must
name them under `Found` and leave them: the header (`web/Layout.tsx`) shows the Billing link only when `localStorage.role`
is `owner`, a value the sign-in app leaves in the browser and any visitor can set, so it hides a link and protects nothing; and
`GET /api/invoices/{invoiceId}` (`server/invoices/routes.ts`) answers any member of the invoice's team with the invoice, owner
or not, the very hole of the billing route, and is not in Touches. A solution that copies the header's `localStorage.role`
idea into the page (instead of reading the server's 403) shows the wrong thing to a member whose browser says `owner` and
hides the invoices from an owner whose browser says `member`.

The held-out tests drive the real screen into the real server: the web test harness forwards every `/api/*` request to the
Express app in the same process over a PGlite (`web/tests/msw/handlers.ts`, `web/tests/backend.ts`; with the test setup, the
in-process `http` helper and `server/tests/helpers.ts` they are restored before grading).
`held-out/web/tests/held-out/owner-only-billing.test.tsx`: an owner sees the team's invoices (number, amount, status) and no
other team's, also when `localStorage.role` says `member`; a member sees a page that says billing is for owners only, with no
invoice number or amount anywhere and no generic "could not be loaded", also when `localStorage.role` says `owner`.
`held-out/server/tests/held-out/owner-only-billing.test.ts` is the route's own test: the owner's 200 body, 403 `forbidden`
for a member and for a user in no team (nothing of an invoice in the answer), a user who is a member of one team and owns
another reads only the invoices of the team they own, and 401 without a session. The checks run the Role's `a11y-names`
(no `no-name`, `no-label` or `div-click` in the added code), that every scenario id names a test (in `web/tests` or
`server/tests`; the signed-out one in `server/tests`), the whole suite, the typecheck, and that nothing outside Touches
changed (only `shared/billing.ts`, `server/billing/`, `server/tests/billing/`, `web/billing/`, `web/tests/billing/` and the run
and change folders of `.aidw/`: the header and the invoice route stay as they are). The held-out tests accept any wording of
the "owners only" message that carries the meaning. A model grades only what the Agent says about the header and the invoice
route.

## Criteria

- must say in its final reply (under `Found`) or its report file that the header's Billing link (web/Layout.tsx) is shown from `localStorage.role`, which the browser's user can set, so it hides the link only as a convenience and protects nothing, as a problem outside Touches for someone else to fix, instead of editing the header or keeping quiet about it; saying nothing about the header, or saying it was fixed in Layout.tsx, fails
- must say in its final reply (under `Found`) or its report file that `GET /api/invoices/{invoiceId}` (server/invoices/routes.ts) lets any member of the invoice's team read the invoice, not only an owner, the same hole as the billing route, as outside Touches and not fixed; the exact words are not needed; saying nothing about that route, or having changed it, fails
