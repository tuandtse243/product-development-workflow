---
framework: Fastify
detected_as: server
roles: [backend, fullstack]
---
# Framework pack: Fastify

How to build an HTTP API with Fastify 5. Tooling (package manager, formatter, tests, CI) is in `node.md`; this file is
only what is specific to the framework. A framework pack answers the same questions under the same headings (a test
checks it, ADR-0001). `aidw detect` reports Fastify as the project's `server`; this pack loads only when no framework pack
(NestJS, Next.js...) matches. An existing Fastify project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- `src/app.ts` exports `buildApp(opts)`, which creates the instance, registers plugins and routes and returns it without
  listening. `src/server.ts` calls `buildApp` and `app.listen({ port, host })`. Tests call `buildApp` too.
- One **plugin** per capability (`src/bookings/routes.ts`: `export default async function (app) { ... }`), registered with
  a prefix (`app.register(bookings, { prefix: '/bookings' })`), next to its service, schemas and data access. Route
  handlers stay thin; the business rule lives in a service that knows nothing of `request` and `reply`.
- **Encapsulation.** A decorator, hook or registered plugin is visible only inside the plugin that registered it and its
  children. Shared things (the database client, the auth decorator, config) are plugins wrapped in `fastify-plugin`, so
  they reach the parent; feature routes are not wrapped, so their hooks stay local.

## Conventions

- **Validation through route schemas.** Every route declares `schema: { body, params, querystring, headers, response }`.
  Fastify validates the input with Ajv before the handler runs and answers `400` on failure. Use a type provider
  (`@fastify/type-provider-typebox` or `fastify-type-provider-zod`) so the schema is also the handler's type; never cast
  `request.body`. Fastify 5 requires full JSON Schema for `querystring`, `params` and `headers`
  (`{ type: 'object', properties: {...} }`); the v4 shorthand of a bare properties map is removed.
- **The response schema is a filter.** With `response: { 200: schema }` Fastify serializes only the listed fields, which
  both speeds serialization and keeps an unlisted column from leaking. Declare it for every status the route returns,
  error shapes included.
- **Errors.** Throw an error with a `statusCode` (the project's error classes, or `@fastify/sensible`'s `httpErrors`) and
  shape every failure in one `app.setErrorHandler`, which maps validation errors (`error.validation`) and the
  application's errors to the contract's error shape and logs unexpected ones with `request.log`. Add
  `app.setNotFoundHandler` for the `404` shape.
- **Handlers are `async` and return**: either the payload (`reply.code(201); return x`) or `return reply.send(x)`. Calling
  `reply.send` and then returning another value, or not returning after it, sends twice or logs a "Reply was already
  sent" error.
- **Auth as a hook.** An `onRequest` or `preHandler` hook (often a decorator such as `app.authenticate`, with
  `@fastify/jwt` or the session plugin) sets `request.user` or replies `401`; add it in the plugin that holds the protected
  routes, so its encapsulation decides where it applies. Ownership of the record is checked in the service.
- Use the built-in logger (`request.log`, pino) with a redaction list for credentials and personal data; no `console.log`.

## Data and mutations

- Return explicit objects that match the response schema, not ORM rows with relations loaded.
- A write that touches several rows runs in one transaction in the service. A migration is its own task.
- Pagination, sorting and filters are a `querystring` schema with defaults (`default:`) and a `maximum` page size.
- The database client is a plugin (`app.decorate('db', client)` inside `fastify-plugin`) closed in an `onClose` hook.

## Environment variables

List every variable in `.env.example`; none is committed with a real value. Validate them once at start-up with a schema
(`@fastify/env`, or zod over `process.env` in `src/config.ts`) and pass the result in; services never read `process.env`.
A missing required variable stops the app at boot, not at the first request.

## Testing

- Prove each scenario through HTTP with `app.inject()`, no port and no network: `const app = await buildApp(fakes);
  const res = await app.inject({ method: 'POST', url: '/bookings', payload: body }); expect(res.statusCode).toBe(201)`.
  Close the instance after each test (`await app.close()`).
- Cover per endpoint: the success case, schema-invalid input (`400` in the contract's error shape, not Ajv's raw output),
  no credentials (`401`), another user's record, and an unexpected throw through the error handler.
- Unit-test services without Fastify; fake a repository or an outside service at its boundary, passed in.

## Common mistakes

- A shared decorator or hook registered inside a plugin without `fastify-plugin`: the rest of the app does not see it.
  The reverse also hurts: wrapping a feature plugin so its auth hook applies to every route.
- No `response` schema, so the whole ORM row (password hash, internal ids) is serialized.
- An `async` handler that returns `undefined` without sending: the request hangs or answers empty.
- Testing with `listen` and a real port instead of `inject`, or forgetting `app.close()`, leaving open handles.
- Express middleware used as is: Fastify needs `@fastify/middie` for it, and a native hook or plugin is preferred.
- Returning Ajv's default validation message to the client instead of the contract's error shape.

## Commands

`pnpm dev` (for example `tsx watch src/server.ts`), `pnpm build` (the `code` layer builds with it), `pnpm start`,
`pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, as the project's scripts define them.

## Sources

Ideas, not wording: the Fastify documentation at fastify.dev (Getting Started, Plugins and Encapsulation, Validation and
Serialization, Type Providers, Hooks, Errors, Testing, Logging); the `fastify-plugin`, `@fastify/env` and `@fastify/jwt`
READMEs.
