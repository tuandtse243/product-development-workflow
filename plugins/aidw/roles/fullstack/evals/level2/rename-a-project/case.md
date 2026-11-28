---
case: rename-a-project
covers: [X1, X6, X7, seam-test]
fixture: fullstack-app
change: rename-a-project
task: T01
timeout_min: 40
max_turns: 100
restore: [web/tests/setup.ts, web/tests/environment.ts, web/tests/render.tsx, web/tests/backend.ts, web/tests/msw/handlers.ts, web/tests/msw/server.ts, server/tests/helpers.ts, server/tests/http.ts]
must_read:
  - .aidw/changes/rename-a-project/api-contract.md
  - plugin:roles/fullstack/skills/seam-test.md
---
## Situation

Task T01 of the fixture's Change `rename-a-project`: the owner of a team renames a project from its page, in a small
"team projects" app (Vite + React 19 client in `web/`, Express 5 + PGlite server in `server/`, zod schemas in `shared/`).
Both halves are in Touches: `PATCH /api/projects/{projectId}` trims the name and answers `422
{"error":{"code":"validation","fields":{"name":"taken"}}}` for a name another project of the team has, and `403` for a member
who is not an owner; the project page gets a form that sends it and shows each outcome. The fixture has no browser (Vitest,
jsdom, Testing Library); the app has no design tokens and the task's Touches name no styles, so the brief has no screenshot
lines and the case needs no `screenshots:` key.

Three neighbours an Agent might copy are wrong. The tests of the existing project page (`web/tests/projects/project-page.test.tsx`)
fake the server with hand-written MSW bodies, among them a 404 `{ "message": ... }` the server never sends (it sends
`{ "error": { "code", "message" } }`), so a rename test written the same way passes against a response that does not exist.
The client helper `web/api/client.ts` reads `body.message` for an error, which the server never sets, and keeps neither the
error `code` nor the 422 `fields`; a form built on it cannot tell a taken name from a failure. And the projects list is kept
in a module-level store (`web/projects/store.ts`) that nothing refreshes after a write, so the list still shows the old name
after a rename. All three are in Touches: the Agent fixes the helper and the store, and says what it found.

The held-out tests drive the real screen into the real server: the web test harness forwards every `/api/*` request to the
Express app in the same process over a PGlite (`web/tests/msw/handlers.ts`, `web/tests/backend.ts`; with the test setup, the
in-process `http` helper and `server/tests/helpers.ts` they are restored before grading). `held-out/web/tests/held-out/rename-a-project.test.tsx`:
type "  Apollo  ", save, and the page and the list (reached by the nav link after the list had been loaded) show exactly
"Apollo", and the row in the database holds "Apollo"; a taken name (in another case) marks the name field `aria-invalid` with
text tied to it by `aria-describedby` that says it is taken, not a generic failure, and keeps what was typed; a blank name is
marked and described too; a member sees the server's 403 as a message that says only owners can rename, with the page still
standing under the old name; after a refused save the form works again. `held-out/server/tests/held-out/rename-a-project.test.ts`
is the route's own test: the owner's 200 body, the exact 422 body for a taken name (any case), required and too-long names,
403 for a member (checked before the body), 401 without a session, 404 for a user outside the team (the same body as an
unknown id), 400 for an id that is not a uuid, an unknown field or a body that is not JSON. The checks run the Role's
`a11y-names` (no `no-name`, `no-label` or `div-click` in the added code), that every scenario id names a test (the five user-action scenarios on the web side, the
route's four on the server side), the whole suite, the typecheck, and that nothing outside Touches changed (only
`shared/projects.ts`, `server/projects/`, `server/tests/projects/`, `web/projects/`, `web/api/client.ts`, `web/tests/projects/`
and the run and change folders of `.aidw/`). The held-out tests are written so that a form hidden behind a Rename or Edit
button, any submit label from a list, and any wording of the messages that carries the right meaning pass. The backend's `route-inventory` is not run: it matches a route's tests by path, not method, so the existing
tests of `GET /api/projects/{projectId}` would give the PATCH route its three access cases; the held-out route tests are the
access check. A model grades
only what the Agent says about the client helper and the list store.

## Criteria

- must say in its final reply or its report file that the client helper (web/api/client.ts) read the error message from `body.message`, which the server never sends (it sends `error.message`, `error.code` and, for a 422, `error.fields`), and that it fixed that or flagged it, instead of building the form on the stale helper or keeping quiet about it
- must say in its final reply or its report file that the projects list kept in the module-level store (web/projects/store.ts) was not refreshed after a write and showed the old name, and that it fixed that or flagged it, instead of leaving the list stale or keeping quiet about it
