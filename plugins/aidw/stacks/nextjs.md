---
framework: Next.js
roles: [frontend, backend, fullstack]
skills: [aidw/react-rules]
---
# Framework pack: Next.js (App Router)

How to build with Next.js 15 and the App Router. Tooling (package manager, formatter, tests, CI) is in `node.md`; this
file is only what is specific to the framework. A framework pack answers the same questions under the same headings
(a test checks it, ADR-0001). When the project already uses the Pages Router or another major version, follow its code
and `.aidw/constitution.md` first and treat this file as a reference.

## Structure

- `app/` holds routes. `page.tsx` is a screen, `layout.tsx` wraps it, `route.ts` is an HTTP endpoint (export `GET`, `POST`...),
  `loading.tsx`, `error.tsx` and `not-found.tsx` are the states of a segment. A folder in parentheses, `(site)`, groups routes
  without changing the URL; `_folder` is private to the router.
- Business logic lives in `lib/<capability>/` as plain modules, called by route handlers, server actions and pages. A
  component never holds a business rule; a route handler stays thin (parse, call the module, shape the response).
- Shared UI in `components/`, one folder per feature once it has more than a few files. Keep a screen's own components next
  to it until a second screen needs them.

## Conventions

- Components are **Server Components** by default. Add `'use client'` only to the smallest leaf that needs state, effects,
  event handlers or browser APIs, and pass server data down as props.
- In Next 15 `params`, `searchParams`, `cookies()` and `headers()` are asynchronous: `const { id } = await params`.
- Navigate with `next/link` and `useRouter` from `next/navigation`; images with `next/image`; fonts with `next/font`.
- Fetching: read data in a Server Component or a module it calls, not in `useEffect`. `fetch` and `GET` route handlers are
  **not cached by default** in Next 15; opt in explicitly (`cache: 'force-cache'`, `export const revalidate = 60`) and say why.
- Metadata through `export const metadata` or `generateMetadata`, not `<head>` tags.

## Data and mutations

- Mutations are Server Actions (`'use server'` at the top of a function or file) or route handlers. **Validate every input on
  the server** (zod or the project's validator), whatever the form already checked, and check authorization inside the action:
  an action is a public endpoint.
- After a mutation call `revalidatePath` or `revalidateTag` so the screen shows the new data; redirect with `redirect()` outside
  `try/catch` (it works by throwing).
- Return a typed result (`{ ok: true, data } | { ok: false, error }`) for expected failures; throw only for bugs.

## Environment variables

- Only variables prefixed `NEXT_PUBLIC_` reach client code, and they are inlined at build time. Everything else is
  server-only: reading it in a client component yields `undefined`, not an error.
- `.env.local` holds local secrets and is never committed; list every variable in `.env.example` with a comment. Validate the
  server variables once at start-up in one module (`lib/env.ts`) and import from there.
- `middleware.ts` runs on the edge runtime (no Node-only APIs) and is not an authorization layer by itself: check access again
  in the page, action or handler that returns data.

## Testing

- Unit-test `lib/` modules with Vitest. Test a route handler by calling its exported function with a `new Request(url, init)`.
- An **async Server Component cannot be rendered by React Testing Library**: move its logic into a `lib/` function and test that,
  and prove the screen with a Playwright test. Client components are tested with Testing Library as usual.
- Playwright starts the app through `webServer` (`pnpm build && pnpm start` for CI, `pnpm dev` locally) and tests the
  scenarios; the test name carries the scenario id.

## Common mistakes

- `'use client'` at the top of a layout or page "to make it work": the whole subtree loses server rendering. Push it to a leaf.
- Reading `process.env.SECRET` in a client component, or exposing a secret by prefixing it `NEXT_PUBLIC_`.
- Forgetting `await` on `params` or `cookies()` (Next 15), which fails at run time, not at type-check.
- Hydration mismatches from `Date.now()`, `Math.random()`, `localStorage` or locale formatting rendered on the server and the
  client differently. Compute in an effect or pass the value from the server.
- Using `<a href>` for internal links (full reload), or fetching an API route from a Server Component of the same app: call the
  module directly.
- Mixing `pages/` and `app/` for the same URL, or adding `next-env.d.ts` to a commit (it is generated and ignored).
- Calling a Server Action from a loop or on every keystroke: debounce, or batch.

## Commands

`pnpm dev` (local), `pnpm build` (the `code` layer builds with it), `pnpm start` (serve a build), `pnpm lint` (the linter of
`node.md`: oxlint with the `nextjs` and `react` plugins on TypeScript 7; ESLint with `eslint-config-next` on a project that
already has it), `pnpm exec tsc --noEmit`. A type or lint error is fixed, never disabled.
