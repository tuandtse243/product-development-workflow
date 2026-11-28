---
case: invite-with-one-schema
covers: [X2]
fixture: fullstack-app
change: invite-with-one-schema
task: T01
timeout_min: 40
max_turns: 100
restore: [web/tests/setup.ts, web/tests/environment.ts, web/tests/render.tsx, web/tests/backend.ts, web/tests/msw/handlers.ts, web/tests/msw/server.ts, server/tests/helpers.ts, server/tests/http.ts]
must_read:
  - .aidw/changes/invite-with-one-schema/api-contract.md
---
## Situation

Task T01 of the fixture's Change `invite-with-one-schema`, in the small "team projects" app (Vite + React 19 client in `web/`,
Express 5 + PGlite server in `server/`, zod schemas in `shared/`): an owner of a team invites a person from a new Team page
(`/team`, a placeholder page that is routed and linked already): a dialog with a name and an email. Both halves are in Touches: `POST /api/invites` stores the
invitation (`201`; `422 validation` with `fields`, `403` for a member, `401` without a session) and the dialog refuses a name
over 80 characters (after trimming) and an email that is not valid before sending anything. The fixture has no browser
(Vitest, jsdom, Testing Library); the app has no design tokens and the task's Touches name no styles, so the brief has no
screenshot lines and the case needs no `screenshots:` key.

The trap is where the rules already are. `server/invites/rules.ts`, in Touches, holds the invitation's zod schema (name 1 to 80,
a valid email) and also a helper that takes the database client, so it imports `server/db/client.ts`. The easy move is to import
that schema into the dialog (or to write the limit a second time in `web/`): the first drags server-only code into the client
bundle (F10, and the dialog's graph reaches the database client), the second leaves two rules that drift (X2). The right move is
to write the rules once in `shared/` (which imports nothing server-only), have the server route and the dialog both import them,
and leave the database helper where it is. The spec states the limit for both halves ("the same limits") and the analysis says
the rules are written once in `shared/`, so nothing is hidden.

The held-out tests drive the real screen into the real server: the web test harness forwards every `/api/*` request to the
Express app in the same process over a PGlite (`web/tests/msw/handlers.ts`, `web/tests/backend.ts`; with the test setup, the
in-process `http` helper and `server/tests/helpers.ts` they are restored before grading), and the requests that leave the app
are counted at the network. `held-out/web/tests/held-out/invite-with-one-schema.test.tsx`: an owner sends "  Dana White  " and
a valid email, the dialog closes and the row holds the trimmed name; a name of exactly 80 characters is sent and stored; an
81-character name (set as one change, so a `maxLength` cannot cut it) is refused on the form, with the field `aria-invalid` and
text tied to it that says it is too long, and no request is sent; a bad email is refused the same way; after a refused name the
person fixes it and the invite goes through; a member sees the server's 403 as a message that says only owners can invite. Two
more tests read the source: the module graph of `web/main.tsx` (static imports, type-only ones included, resolved by a small
walker) must reach nothing under `server/` and no Express or PGlite package, and the limit of 80 must be written once, in a
`shared/` file that both the web entry and `server/app.ts` reach, and in no other file those two entries reach.
`held-out/server/tests/held-out/invite-with-one-schema.test.ts` is the route's own test: the owner's 201 body, 80 accepted and
81 (and spaces around, and 81 two-byte characters) refused with exactly the contract's 422 body, required and invalid reasons for
each field and both at once, 403 for a member and for a user in no team and 401 without a session (each before the body is read),
400 for a field that is not listed, a body that is not an object or not JSON, and error bodies with no stack. The checks run the
Role's `a11y-names` (no `no-name`, `no-label` or `div-click` in the added code), that every scenario id names a test (in
`web/tests` or `server/tests`; the signed-out one in `server/tests`), the whole suite, the typecheck, and that nothing outside
Touches changed (only `shared/invites.ts`, `server/invites/`, `server/app.ts`, `server/tests/invites/`, `web/team/`,
`web/api/client.ts` (the one module that calls `fetch`: it may need to carry the error `code` and `fields` into `ApiError`), `web/tests/team/` and the run and change folders of `.aidw/`). The held-out tests are
written so that the dialog behind any button label from a list, any submit label from a list, and any wording of the messages that carries the
right meaning pass. No model grades this case: everything it asks is checked by a machine.
