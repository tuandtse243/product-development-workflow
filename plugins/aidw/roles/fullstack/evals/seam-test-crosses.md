---
case: seam-test-crosses
covers: [X1, seam-test]
---
## Input

A fullstack task brief (task T4, Vite + React 19 + TypeScript client in `web/`, Express 5 + PGlite server in `server/`,
Vitest with MSW for the client tests and supertest for the server tests). Build "Rename project". Scenario
`projects/rename-project/rename-works`: "Given a project named 'Road', when I change its name to '  Roadmap  ' and press
Save, then the page heading shows 'Roadmap'." Scenario `projects/rename-project/rename-name-taken`: "Given another project
is already named 'Roadmap', when I save that name, then 'Name already used' is shown under the Name field." The contract:
`PATCH /api/projects/:id` with `{ name }` answers `200 { id, name }` (the name trimmed by the server) or
`422 { error: { code: "name_taken", fields: { name: "taken" } } }`.

Existing tests to match, per the brief ("follow the project's test conventions"):

```
// web/tests/ProjectList.test.tsx
server.use(http.get("/api/projects", () => HttpResponse.json([{ id: "p1", name: "Road" }])))
render(<ProjectList />)
expect(await screen.findByText("Road")).toBeVisible()

// server/tests/projects.test.ts
const res = await request(app).get("/api/projects").set("Cookie", sessionFor(owner))
expect(res.body).toEqual([{ id: "p1", name: "Road" }])
```

`server/tests/helpers.ts` exports `app`, a PGlite test database and `sessionFor(user)`. The project's `web/tests/setup.ts`
starts an MSW server with no handlers.

Touches: `web/src/projects/**`, `server/src/projects/**`, `web/tests/**`, `server/tests/**`. Verify: `pnpm test`.

## Criteria

- must write, before either half exists, a test named with the scenario id `rename-works` that renders the screen, types `  Roadmap  `, presses Save and expects the heading `Roadmap`, and must say or show that it failed first
- must have that test's request answered by the real Express app in the same process (an MSW handler that forwards `/api/*` to the app, an in-process request (`inject`, `app.request`, a non-listening helper) or a fetch adapter over `app`, with the test database), not by a response body written in the test
- must not make the screen-side test pass with a hand-written MSW body for `PATCH /api/projects/:id`, and must not mock the server's own route module, the shared shape or the database
- must assert a value the server decides (the trimmed `Roadmap`), so a fake that echoes the input could not pass
- must give the scenario `rename-name-taken` its own test across the seam that asserts what the user sees under the field, not only the status code
- must still test the route on its own (status, body, access) in `server/tests/`, besides the test across the seam
