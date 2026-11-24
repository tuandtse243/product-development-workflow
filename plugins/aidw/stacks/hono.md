---
framework: Hono
detected_as: server
roles: [backend, fullstack]
---
# Framework pack: Hono

How to build an HTTP API with Hono 4. Tooling (package manager, formatter, tests, CI) is in `node.md`; this file is only
what is specific to the framework. A framework pack answers the same questions under the same headings (a test checks
it, ADR-0001). `aidw detect` reports Hono as the project's `server`; this pack loads only when no framework pack (NestJS,
Next.js...) matches. Hono runs on several runtimes (Node through `@hono/node-server`, Cloudflare Workers, Bun, Deno):
read the runtime from `.aidw/architecture.md` and the entry file before using a runtime API. An existing Hono project
keeps its own structure and `.aidw/constitution.md` first.

## Structure

- `src/app.ts` builds and exports the app (`createApp(deps)` returning a `new Hono<Env>()`); the runtime entry
  (`src/index.ts` with `serve({ fetch: app.fetch, port })` on Node, `export default app` on Workers and Bun) is the only
  file that knows the runtime. Tests import the app.
- One sub-app per capability (`src/bookings/routes.ts`: `export const bookings = new Hono<Env>()...`), mounted with
  `app.route('/bookings', bookings)`, next to its service, schemas and data access. Handlers stay thin; the business rule
  lives in a service that knows nothing of the context `c`.
- Declare the app's types once: `type Env = { Bindings: {...}; Variables: { user: User } }`, so `c.env` and `c.get('user')`
  are typed everywhere. Chain the routes of a sub-app (`.get(...).post(...)`) when the client uses Hono's RPC types
  (`hc<AppType>`): an unchained route is missing from `AppType`.

## Conventions

- **Validation.** Every input goes through a validator middleware: `zValidator('json', schema)` from `@hono/zod-validator`
  (or `hono/validator`, or the project's own) for `json`, `param`, `query`, `header` and `form`, and the handler reads only
  `c.req.valid('json')`. Pass a hook to the validator so a failure answers `400` in the contract's error shape, not the
  validator's default body.
- **Errors.** Throw `HTTPException` (from `hono/http-exception`) or the application's error classes; one `app.onError`
  maps them to the status codes and the error shape the contract names and logs unexpected ones; `app.notFound` shapes the
  `404`. A handler never builds its own error body.
- **Auth middleware.** A middleware made with `createMiddleware<Env>` (or Hono's `jwt`, `bearerAuth` and cookie helpers)
  verifies the credential, `c.set('user', user)` and `await next()`, or returns `401`; apply it with `app.use('/bookings/*',
  auth)` or on the sub-app, with public routes explicit. Ownership of the record is checked in the service.
- A middleware always `await next()` (or returns a response); a forgotten `await` runs the rest after the response.
- Return with the context helpers (`c.json(body, 201)`, `c.body(null, 204)`); set headers with `c.header()`. CORS and secure
  headers come from `hono/cors` and `hono/secure-headers` with an explicit origin list.

## Data and mutations

- Return explicit objects (`c.json(toBookingResponse(row))`), never an ORM row: a response must not carry a column the
  contract does not list.
- A write that touches several rows runs in one transaction in the service. A migration is its own task. On Workers the
  database client comes from a binding per request (`c.env.DB`), not from a module-level singleton.
- Pagination, sorting and filters are a `query` schema with defaults and a maximum page size.

## Environment variables

List every variable in `.env.example` (or `.dev.vars.example` on Workers); none is committed with a real value. On Node,
parse `process.env` once at start-up in `src/config.ts`. On Workers there is no `process.env`: variables and secrets are
bindings, read through `c.env` (or `env(c)` from `hono/adapter` when the code runs on several runtimes) and validated in a
middleware. A missing required variable fails at start-up or on the first request with a clear message, never a silent
`undefined`.

## Testing

- Prove each scenario through HTTP with `app.request()`, no server and no network: `const res = await
  createApp(fakes).request('/bookings', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type':
  'application/json' } }); expect(res.status).toBe(201)`. Pass bindings as the third argument when the code reads `c.env`.
- With RPC types, `testClient(app)` from `hono/testing` gives a typed client over the same in-process call.
- Cover per endpoint: the success case, invalid input (`400` in the contract's error shape), no credentials (`401`),
  another user's record, and an unexpected throw through `onError`.
- Unit-test services without Hono; fake a repository or an outside service at its boundary, passed in.

## Common mistakes

- Reading `process.env` in code that runs on Workers, or importing a Node built-in (`node:fs`, or any `node:` module
  without the `nodejs_compat` flag) in a Workers app.
- `c.req.json()` read directly instead of a validator and `c.req.valid()`, so nothing is checked.
- The validator's default error body reaching the client instead of the contract's error shape.
- A middleware that forgets `await next()`, or `app.use('/bookings', auth)` without `/*`, so the sub-routes are not
  protected.
- Unchained route definitions when the frontend relies on `hc<AppType>`, so the client types silently lose routes.
- `app.request('/x', { body: obj })` without `JSON.stringify` and the `Content-Type` header: the validator sees no JSON.

## Commands

`pnpm dev` (`tsx watch src/index.ts` on Node, `wrangler dev` on Workers), `pnpm build` (the `code` layer builds with it),
`pnpm start` or `wrangler deploy`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, as the project's scripts define
them.

## Sources

Ideas, not wording: the Hono documentation at hono.dev (Routing, Middleware, Validation, Exception, Testing, RPC, Best
Practices, Getting Started for Node.js and Cloudflare Workers, the `env()` adapter helper); the `@hono/zod-validator` and
`@hono/node-server` READMEs.
