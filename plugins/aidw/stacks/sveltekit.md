---
framework: SvelteKit
roles: [frontend, backend, fullstack]
skills: [svelte/svelte-core-bestpractices]
---
# Framework pack: SvelteKit

How to build a full-stack Svelte app with SvelteKit. Tooling (package manager, formatter, tests, CI) is in `node.md`; this file
is only what is specific to the framework. A framework pack answers the same questions under the same headings (a test checks it,
ADR-0001). An existing SvelteKit project keeps its own structure and `.aidw/constitution.md` first.

## Structure

- `src/routes/` is file-based routing: `+page.svelte` (the screen), `+page.server.ts` (server `load` and form `actions`),
  `+page.ts` (universal `load`), `+layout.*` (shared shell and data), `+server.ts` (an HTTP endpoint with `GET`/`POST` exports),
  `+error.svelte`.
- `src/lib/` is shared code (import it as `$lib/...`); `src/lib/server/` is server-only and the build fails if client code
  imports it. `src/hooks.server.ts` runs on every request (session, auth, headers).
- `svelte.config.js` holds the adapter and aliases; the adapter decides where the app runs.

## Conventions

- Fetch data in `load`, not in the component. Data that needs a secret or the database goes in `+page.server.ts`; the
  returned object must be serializable.
- Mutations are form **actions** (`export const actions = { default: async ({ request }) => ... }`) with `use:enhance` on the
  form for progressive enhancement. Return `fail(400, { errors })` for validation failures and `error(status, message)` for
  the rest. Never return `200` with an error inside a `+server.ts` endpoint.
- Validate every input on the server with a schema (zod, valibot); the client check is for comfort only.
- Check authorization in `hooks.server.ts` or in each `load` and action that returns or changes data: a layout `load` does
  not protect a child's `+server.ts` endpoint.
- Svelte 5: state is `$state`, derived values `$derived`, side effects `$effect`, props `$props()`. Do not mix the Svelte 4
  `export let` and `$:` style into a component that uses runes.

## Data and mutations

- Return the fields the contract names, not database rows: no password hashes, no internal ids.
- A write that touches several rows runs in one transaction. A migration is its own task: reversible, tested against a seeded
  database.
- After an action succeeds, `load` data is invalidated and reruns on its own; call `invalidate`/`invalidateAll` only for data
  changed outside a form.

## Environment variables

- `$env/static/private` and `$env/dynamic/private` are server-only; the build fails if client code imports them.
  `$env/static/public` and `$env/dynamic/public` need the `PUBLIC_` prefix and reach the browser. Never read `process.env`.
- `.env` is never committed; list every variable in `.env.example`.

## Testing

- Unit-test `$lib` modules (including `$lib/server`) with Vitest. Test components with `@testing-library/svelte`; test a
  `load` or an action by calling the function with a faked `event` (`request`, `locals`, `params`).
- Playwright starts the built app (`pnpm build && pnpm preview`) and tests the scenarios; the test name carries the scenario id.

## Common mistakes

- Importing from `$lib/server` or `$env/*/private` in a component or a universal `load`: a build error, and the sign that
  secret code is on the wrong side.
- A `load` in `+page.ts` (runs in the browser too) that needs a secret: move it to `+page.server.ts`.
- Per-request data in a module-level variable (shared between users) instead of `event.locals`.
- Browser APIs (`window`, `localStorage`) in script top level: guard with `browser` from `$app/environment` or use `onMount`.
- Forgetting `use:enhance` (a full page reload on submit), or returning a non-serializable value (a class instance, a `Date`
  you then call methods on) from `load`.
- Redirecting with `throw redirect()` inside a `try` that catches everything (Svelte 5 / SvelteKit 2: call `redirect(...)`
  without `throw`, outside a broad catch).

## Commands

`pnpm dev` (local), `pnpm build` (the `code` layer builds with it), `pnpm preview` (serve a build), `pnpm check`
(`svelte-check`, the type check), `pnpm lint`. `svelte-kit sync` regenerates the `.svelte-kit/` types; `.svelte-kit/` and the
build output are generated and never committed.
The type check here is `svelte-check`, and it decides the TypeScript major: confirm the installed `svelte-check` supports
the TypeScript version before the scaffold pins it. If it does not support TypeScript 7 yet, stay on 6 and use the
ESLint path of `node.md` (`eslint-plugin-svelte`); oxlint reads only the script part of a `.svelte` file.
