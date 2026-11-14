---
framework: Nuxt
roles: [frontend, backend, fullstack]
---
# Framework pack: Nuxt

How to build a full-stack Vue app with Nuxt 3. Tooling (package manager, formatter, tests, CI) is in `node.md`; this file is
only what is specific to the framework. A framework pack answers the same questions under the same headings (a test checks it,
ADR-0001). An existing Nuxt project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- `pages/` is file-based routing (`pages/todos/[id].vue` is `/todos/:id`); `layouts/`, `components/` and `composables/` are
  auto-imported, so a name is global: keep names unique and specific.
- `server/api/*.ts` and `server/routes/*.ts` are the HTTP handlers (`defineEventHandler`, one file per route and method:
  `todos.post.ts`); `server/utils/` holds server-only helpers; `server/middleware/` runs on every request.
- `app.vue` is the shell; `nuxt.config.ts` holds modules and runtime configuration; `middleware/` is route middleware for pages.

## Conventions

- Use `<script setup lang="ts">` and the Composition API. Shared state is a composable over `useState('key', () => initial)`
  (it is serialized from server to client); do not use a module-level `ref` for per-request data, it leaks between users.
- Fetch data with `useFetch` or `useAsyncData` (they run on the server and hand the result to the client without a second
  request). A bare `$fetch` in `setup` fetches twice; use it in event handlers.
- Validate every handler input on the server (`readValidatedBody`, `getValidatedQuery` with a schema such as zod) and throw
  `createError({ statusCode, statusMessage })` for failures. Never return `200` with an error inside.
- A handler is the only place that touches the database or a secret. Components never import from `server/`.

## Data and mutations

- Return plain objects the contract names, not ORM rows: a response never exposes a column the contract does not list.
- A write that touches several rows runs in one transaction. A migration is its own task: reversible, tested against a seeded
  database.
- After a mutation, refresh the data that depends on it (`refresh()` of the `useFetch`, or `refreshNuxtData('key')`); do not
  patch local state by hand when the server is the source of truth.

## Environment variables

- Declare each one in `runtimeConfig` in `nuxt.config.ts`: keys at the top level are server-only, keys under `public` reach the
  browser. Override with `NUXT_<KEY>` (and `NUXT_PUBLIC_<KEY>`) at run time; read them with `useRuntimeConfig()`, never
  `process.env` in components.
- `.env` is never committed; list every variable in `.env.example`. A secret under `public` is a leak.

## Testing

- Unit-test composables and `server/utils/` with Vitest. Test a handler by calling its logic as a function, or with
  `@nuxt/test-utils` (`$fetch` against `setup({ server: true })`).
- Mount components with `@nuxt/test-utils` `mountSuspended` (plain Vue Test Utils lacks the auto-imports and the Nuxt context).
- Playwright starts the built app (`pnpm build && pnpm preview`) and tests the scenarios; the test name carries the scenario id.

## Common mistakes

- Browser-only code (`window`, `localStorage`, `document`) at the top of `setup`: it runs on the server and throws. Put it in
  `onMounted`, or wrap the component in `<ClientOnly>`.
- Hydration mismatches from `Date.now()`, `Math.random()` or locale formatting that differ between server and client. Compute
  once on the server through `useState`.
- Reading `useRuntimeConfig().public` for a secret, or a secret with a `NUXT_PUBLIC_` prefix.
- Per-request data in module scope (shared between users); data fetched with `$fetch` in `setup` (fetched twice).
- A handler that trusts `getQuery` or `readBody` without validation.

## Commands

`pnpm dev` (local), `pnpm build` (the `code` layer builds with it), `pnpm preview` (serve a build), `pnpm exec nuxi typecheck`
(or `vue-tsc --noEmit`), `pnpm lint`. `nuxi prepare` regenerates the `.nuxt/` types after a config change; `.nuxt/` and `.output/`
are generated and never committed.
