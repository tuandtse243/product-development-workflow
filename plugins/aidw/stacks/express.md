---
framework: Express
detected_as: server
roles: [backend, fullstack]
---
# Framework pack: Express

How to build an HTTP API with Express 5 (Express 4 differences are marked). Tooling (package manager, formatter, tests,
CI) is in `node.md`; this file is only what is specific to the framework. A framework pack answers the same questions
under the same headings (a test checks it, ADR-0001). `aidw detect` reports Express as the project's `server`; this pack
loads only when no framework pack (NestJS, Next.js...) matches, because inside those the framework's conventions win. An
existing Express project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- `src/app.ts` builds and **exports** the app (`createApp(deps)`): middleware, routers, the 404 handler, the error
  handler. `src/server.ts` is the only file that calls `app.listen` and reads the port. Tests import the app, never the
  server.
- One `express.Router()` per capability (`src/bookings/bookings.routes.ts`), mounted once (`app.use('/bookings',
  bookingsRouter)`), next to its service, schemas and data access. A route handler parses, calls the service, shapes the
  response; the business rule lives in the service, which knows nothing of `req` and `res`.
- Dependencies (repositories, outside-service adapters, the clock) are passed into `createApp` or the router factory, so a
  test hands in fakes without module mocking.

## Conventions

- **Middleware order is the program.** Security headers (`helmet`), `express.json({ limit: '100kb' })`, request id and
  logging, then the routers, then the 404 handler, then the error handler, last. Without a body parser `req.body` is
  `undefined` in Express 4 and 5. What Express 5 (body-parser 2) changed: when a parser is mounted but the request's
  `Content-Type` does not match, `req.body` stays `undefined`, where Express 4 gave `{}`.
- **Validation.** Parse `req.body`, `req.params` and `req.query` with a schema (zod or the project's validator) at the top
  of the handler or in a `validate(schema)` middleware, and use only the parsed value. In Express 5 `req.query` is a
  getter: write the parsed result to `res.locals` or a local, never back to `req.query`. Unknown fields are stripped or
  refused, never passed to the database.
- **Errors.** One error-handling middleware with four parameters `(err, req, res, next)`, registered after every route,
  maps the application's error types to the status codes and the error shape the API contract names and logs the
  unexpected ones. A handler throws or calls `next(err)`; it never builds its own error body. Express 5 forwards a rejected
  promise from an `async` handler to it; **Express 4 does not**: wrap async handlers (`asyncHandler`) or `try/catch` and
  `next(err)`, else the request hangs and the rejection is unhandled.
- **Auth middleware.** Authentication is a middleware that sets `req.user` (typed with a declaration merge on
  `Express.Request`) or answers `401`; mount it on the router or the app, with public routes listed explicitly. Ownership
  of the record (may this user touch this booking?) is checked in the service, not only the role in the middleware.
- `app.disable('x-powered-by')` (or `helmet`), and `app.set('trust proxy', ...)` set to the real proxy hops when the app
  runs behind one, so `req.ip` and secure cookies are right.
- Express 5 route syntax: a wildcard is named (`/*splat`), an optional part is `{/:id}`; the Express 4 `*` and `:id?` throw
  at start-up.

## Data and mutations

- Send DTOs or explicit objects (`res.status(201).json(toBookingResponse(row))`), never an ORM row: a response must not
  carry a column the contract does not list.
- A write that touches several rows runs in one transaction in the service. A migration is its own task.
- Pagination, sorting and filters come from a parsed query schema with defaults and a maximum page size.
- Stop after sending: in an `async` handler write `res.status(404).json(...); return;` (the `@types/express` 5 handler
  type requires `void`, so `return res.status(...)` does not type-check). A second send throws "Cannot set headers
  after they are sent".

## Environment variables

List every variable in `.env.example`; none is committed with a real value. Read `process.env` once, in `src/config.ts`,
parse it with a schema at start-up (Node's `--env-file=.env` loads the file without a package), and pass the config
object in. A missing required variable stops the process at boot with a clear message, not at the first request.

## Testing

- Prove each scenario through HTTP against the exported app. When the project has its own in-process test helper (a
  `t.http()` in its test helpers, say), use it: it needs no socket, which a sandbox may refuse. Otherwise use
  `supertest`: `await request(createApp(fakes)).post('/bookings').send(body).expect(201)`. Never start the app with
  your own `listen`, and reach no network.
- Cover per endpoint: the success case, invalid input (`400` with the contract's error shape), no credentials (`401`),
  another user's record (`403` or `404` as the contract says), and the error handler's shape for an unexpected throw.
- Unit-test services without Express. Fake a repository or an outside service at its boundary, passed in, not mocked
  inside.

## Common mistakes

- An `async` handler on Express 4 without a wrapper: a thrown error never reaches the error handler.
- The error handler declared with three parameters (Express treats it as ordinary middleware), or registered before
  the routers (it is still error middleware, but it never sees errors from routes registered after it).
- Business rules or SQL inside route handlers; a handler calling another capability's repository.
- `app.listen` in the module tests import, leaving open handles and port clashes in parallel test runs.
- Sending `err.message` or a stack trace to the client from the error handler.
- `req.body` used without a schema, or `express.json()` without a size limit.
- A response sent twice (missing `return`), or a middleware that neither responds nor calls `next()`, so the request hangs.

## Commands

`pnpm dev` (for example `tsx watch src/server.ts`), `pnpm build` (the `code` layer builds with it), `pnpm start`,
`pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, as the project's scripts define them.

## Sources

Ideas, not wording: the Express documentation at expressjs.com (Writing middleware, Error handling, Routing, Migrating
to Express 5, Production best practices: security and performance); the supertest README; the Node.js documentation
for `--env-file`.
