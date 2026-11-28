---
name: seam-test
description: Write the one test per scenario that crosses the seam in process - the client drives, the real server handler answers, only outside services and the clock are faked - using the stack's own way of reaching the handler, so a field the client reads and the server never sends fails a test.
---

# One test across the seam

Serves rules X1 and X6. In a Slice you build whole, nobody else proves the two halves meet. The route test passes
against the server's idea of the response, the screen test passes against a body you typed into a fake, and the
scenario still fails because the client sends `dueDate` and the server reads `due_date`, or the client reads
`body.message` while the server sends `{error:{code}}`. One test per scenario in which the client's real request meets
the real handler closes that gap, and it is the first test you write.

## Steps

1. **Pick the scenarios** whose WHEN is a user action and whose THEN needs the server (a save, a rename, a refusal).
   One seam test each; a scenario that names an error (X6) gets one more for that error, driven from the screen.
2. **Write it failing first**, before either half exists, in the shape of the user's act: render, find the control by
   role and name, act, assert what the user sees. The `testing-through-the-user` skill has the queries.
3. **Reach the real handler the way the stack allows**, with no socket and no deployed service:
   - **SPA plus a Node server** (Vite + React with Express, Fastify, Hono): fake the network at the browser boundary
     with an MSW handler that forwards `/api/*` to the app's in-process request helper (`app.request()` in Hono, `inject`
     in Fastify, supertest or a fetch adapter over the app in Express). Use the project's test database (PGlite, SQLite in
     memory), not a mock of your own data layer.
   - **Next.js**: call the Server Action or the route handler as a function with a test session (a `Request` or form data
     and the session the project's auth helper reads), then render the client component with the return value it really
     gives. An async Server Component does not render in Testing Library: cover the data it builds with a contract test
     (`library/contract-tests`) that runs the builder against the shared shape and the component's props against the same.
   - **SvelteKit and Nuxt**: call `load`, the form action or the server route with a test event (`url`, `params`,
     `locals`, `request`), then render the component with its return.
4. **Fake only what is outside**: a payment provider, an email sender, the clock. Never the server's own module, the
   shared schema or the database.
5. **Assert a value the server decides** (a trimmed name, a generated id, a refused field) so a fake could not pass by
   echoing the input. The error cases assert the state F3 or F9 asks for (an alert, a field error), not the status.
6. **Watch it fail for the right reason**, then build the server half behind its own route tests and the screen against
   what the server returns, and run the seam test again until it passes. When it fails on a field name, fix the side that
   deviates from the contract and say which in the report.
7. **Check before you reply**: each user-action scenario has a seam test or, where the screen cannot render, a contract
   test; no seam test fakes a body the server never sends.

## Right and wrong

A project screen renames a project: `PATCH /api/projects/:id` trims the name and answers `422
{error:{code:"name_taken", fields:{name:"taken"}}}` for a duplicate.

Right: the screen's real request is answered by the real Express app in the same process.

```
// web/tests/rename.seam.test.tsx
server.use(http.all("/api/*", (req) => appRequest(app, req)))   // MSW forwards to the in-process app
render(<ProjectPage id={project.id} />)
await user.type(await screen.findByLabelText("Name"), "  Roadmap  ")
await user.click(screen.getByRole("button", { name: "Save" }))
expect(await screen.findByRole("heading", { name: "Roadmap" })).toBeVisible()   // trimmed by the server
// the taken-name case: the field shows the server's text under it, tied by aria-describedby
```

Wrong: the screen test hand-writes the response, so it passes whatever the server does.

```
server.use(http.patch("/api/projects/:id", () => HttpResponse.json({ name: "Roadmap" })))   // the server never sends this
server.use(http.patch("/api/projects/:id", () => HttpResponse.json({ message: "taken" }, { status: 422 })))  // nor this
```

The route test and this screen test both pass; the first real save shows nothing, because the client reads
`body.message` and the server sends `fields.name`.

## Sources

Ideas, not wording: aidw's `testing-through-the-user` skill and the backend Role's `endpoint-test-matrix` (the two
halves' own tests); `library/contract-tests` (the fallback where the screen cannot render); `stacks/vite-react.md`,
`stacks/nextjs.md`, `stacks/sveltekit.md` and `stacks/nuxt.md` (how each reaches its handler); the Mock Service Worker
documentation on request handlers; Next.js documentation on testing and on Server Actions; SvelteKit documentation on
`load` and form actions; Hono's `app.request` and Fastify's `inject` for in-process requests.
