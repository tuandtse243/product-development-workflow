---
framework: NestJS
roles: [backend, fullstack]
---
# Framework pack: NestJS

How to build an HTTP API with NestJS. Tooling (package manager, formatter, tests, CI) is in `node.md`; this file is only
what is specific to the framework. A framework pack answers the same questions under the same headings (a test checks it,
ADR-0001). An existing NestJS project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- One **module** per capability (`bookings/bookings.module.ts`) with its controller, service(s), DTOs and entities beside it.
  `AppModule` only imports feature modules and global configuration.
- A **controller** maps HTTP to a call: route, parameter parsing, status code. A **service** (`@Injectable()`) holds the
  business rule and is the unit tests target. A repository or data service (Prisma, TypeORM, Drizzle) is the only code that
  talks to the database.
- `main.ts` bootstraps the app: global prefix, `ValidationPipe`, CORS, shutdown hooks. Nothing else lives there.

## Conventions

- Constructor injection only. A provider must be listed in its module's `providers`, and in `exports` for another module to
  use it. Import the module, never the provider's file, across features.
- **Validate every input with DTO classes** (`class-validator` and `class-transformer`) and register one global pipe:
  `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. A DTO must be a class: an
  interface or type is erased at run time and validates nothing.
- Failures are exceptions from `@nestjs/common` (`NotFoundException`, `ConflictException`, `ForbiddenException`...); one exception
  filter shapes the error body the API contract names. Never return `200` with an error inside.
- Authorization is a **guard** (`@UseGuards`), applied to the controller or globally with an opt-out for public routes. Check
  ownership of the record in the service, not only the role in the guard.
- Configuration through `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true, validate })`), validated at start-up; never
  read `process.env` inside a service.

## Data and mutations

- Return DTOs or plain objects, not ORM entities: a response never exposes a column the contract does not list (password hashes,
  internal ids). Use a serializer or map explicitly.
- A write that touches several rows runs in one transaction. A migration is its own task: reversible, tested against a seeded
  database (see the migration rules of the `backend` Role).
- Pagination, sorting and filters are query DTOs with defaults and a maximum page size.

## Environment variables

List every variable in `.env.example`; none is committed with a real value. Read them only through the validated config
service. A missing required variable stops the app at boot with a clear message, not at the first request.

## Testing

- Unit-test services with `Test.createTestingModule({ providers: [Service, { provide: Repo, useValue: fake }] })`. Fake the
  repository at its boundary, never inside the service.
- Prove each scenario through HTTP: build the module, `app = moduleRef.createNestApplication()`, apply the same global pipes
  as `main.ts` (put them in one `configureApp(app)` function used by both), `await app.init()`, call it with `supertest`.
- Nest relies on decorator metadata: with Vitest use the SWC transform (`unplugin-swc`) so `emitDecoratorMetadata` works;
  the Nest CLI's Jest setup already does.

## Common mistakes

- Business rules in a controller, or a controller calling another module's repository directly.
- A provider missing from `providers` or `exports`: "Nest can't resolve dependencies of ...". Avoid circular imports between
  modules; `forwardRef` hides a design problem, so split or move the shared part first.
- `@Body() dto: SomeInterface`, or a global `ValidationPipe` left out of the e2e test, so the test passes while production
  rejects (or the reverse).
- `whitelist` off: unknown fields pass through to the database.
- Returning the entity with relations loaded, leaking fields and running N+1 queries.
- Forgetting to enable shutdown hooks (`app.enableShutdownHooks()`) so connections stay open in tests and on deploy.

## Commands

`pnpm start:dev` (watch), `pnpm build` (the `code` layer builds with it), `pnpm start:prod`, `pnpm lint`,
`pnpm exec tsc --noEmit`, `pnpm test` (unit) and `pnpm test:e2e` as the project's scripts define them.
