---
name: nestjs-rules
description: Rules for NestJS code that compile and pass tests but break later - module boundaries, validation, errors, transactions, lifecycle. Loaded with the NestJS framework pack.
---

# NestJS rules

The framework pack says how the app is organised. These are the rules that keep a NestJS codebase from decaying.

## Modules and dependencies

- One module per capability. A module exports the service others may use and nothing else; a repository is never
  exported.
- No circular dependencies. `forwardRef` is a sign two modules are one module, or that a third should own what
  they share. An event or a small shared module breaks the cycle properly.
- Inject through the constructor, against a token or an abstract class when the implementation may change
  (an external client). Never `new` a provider and never reach into the container (`ModuleRef`) from business code.
- Providers are singletons. Do not keep per-request data in a field; request scope (`Scope.REQUEST`) spreads to
  every dependent and costs on each request, so pass the value as an argument instead.

## The edge: controllers

- A controller parses, calls one service method and shapes the response. No business rule, no query.
- Every body, query and param is a DTO class validated by a global
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. An untyped `@Body() body: any`
  is a hole.
- A response is a DTO too. Never return an entity: a new column would leak. Exclude secrets by construction, not
  by remembering to delete a field.
- Authentication and authorization are guards, declared where the route is, with a deny-by-default global guard
  and an explicit `@Public()`. Ownership (may this user touch this record) is checked in the service, with the id
  from the token, never from the body.

## Errors

- Services throw domain errors; one exception filter maps them to the HTTP error shape. Controllers do not
  `try/catch` to build responses.
- Never return `null` for "not found" from one method and throw from another. Pick one per layer.
- A caught error is rethrown, mapped or logged with context. An empty `catch` hides the bug for the next person.

## Data

- All queries are in repositories or the data layer; services do not build queries inline.
- Two writes that must both happen are in one transaction, started in the service that owns the use case.
- No query inside a loop: load the set once. Every list endpoint has a limit.
- Migrations are the only way the schema changes. `synchronize: true` is never on outside a throwaway test database.

## Configuration and lifecycle

- Read configuration once through `ConfigModule` with a validation schema, so a missing variable fails at start,
  not at the first request. No `process.env` in services.
- `enableShutdownHooks()` and close what you opened (database, queues) in `onModuleDestroy`.
- Outbound calls have a timeout. Long work goes to a queue, not a request handler.

## Tests

- Unit-test a service with its dependencies replaced through `Test.createTestingModule(...).overrideProvider()`.
- Test a controller through HTTP (supertest) with the real pipes and guards, or the validation is not tested at all.
- Each test builds its own module and closes it; no state shared across tests.

## Sources

Ideas, not wording: the NestJS documentation (modules, providers, pipes, guards, exception filters, lifecycle
events), Kamil Myśliwiec's guidance on circular dependencies and request scope, and the public NestJS rule sets
for coding agents, merged and cut down to what review experience shows goes wrong.
