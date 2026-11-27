---
framework: Vite
detected_as: bundler
requires: { ui: React }
excludes: { framework: [Astro, Remix, React Router framework mode] }
roles: [frontend, fullstack]
skills: [aidw/react-rules]
---
# Framework pack: Vite + React (single-page app)

How to build a React single-page app bundled by Vite, usually with React Router and TypeScript. Tooling (package
manager, formatter, tests in CI) is in `node.md`; this file is only what is specific to the setup. A framework pack
answers the same questions under the same headings (a test checks it, ADR-0001). The pack loads for a project whose
`package.json` has `vite` and `react`, unless a framework with a pack for the same Role wins (Next.js, Nuxt, SvelteKit;
a backend framework such as NestJS, FastAPI or Django in the same root does not count for the frontend) or the app
renders on a server (Astro, Remix, React Router framework mode with `@react-router/dev`). React Router as a library
(`react-router`) keeps the pack. When the project's code or `.aidw/constitution.md` says otherwise, follow them first
and treat this file as a reference.

Everything here runs in the browser. There is no server in the app: secrets, access checks and business rules live
behind the API it calls. The parts of `aidw/react-rules` about Server Components, `cache()`, `next/dynamic` and Server
Actions do not apply; the rest does.

## Structure

- `index.html` at the root loads `src/main.tsx`, which creates the root (`createRoot`) and renders the router.
- `src/routes/` (or `src/pages/`) holds one module per screen; `src/components/` the shared UI, one folder per feature
  once it has more than a few files; `src/api/` the typed client of the API (one function per call, the contract's
  shapes as types); `src/lib/` plain logic.
- The route table lives in one file (`src/router.tsx`): `createBrowserRouter([...])` with `RouterProvider`, or
  `<BrowserRouter>` with `<Routes>`, whichever the project already uses. React Router 7 ships as `react-router`;
  version 6 projects import from `react-router-dom`.
- `public/` holds files served as they are; anything imported from `src/` is hashed and bundled.

## Conventions

- Navigate with `<Link>` and `useNavigate`, never `<a href>` for an internal page (a full reload loses state). Keep what a
  user can link to or reload into (filters, tab, page, search text) in the URL with `useSearchParams`.
- Split by route: `lazy` on a route (or `React.lazy` with `<Suspense>`) for a screen the first page does not need, and a
  dynamic `import()` for a heavy component (editor, chart, map).
- Path aliases (`@/`) are set in both `vite.config.ts` (`resolve.alias`) and `tsconfig` (`paths`); use the one the
  project has, do not add a second.
- Static assets are imported (`import logo from "./logo.svg"`) so the build hashes them.

## Data and mutations

- Reads go through the route's `loader` (data router) or the project's query cache (TanStack Query, SWR); a `useEffect`
  that fetches on mount is the last choice, and then it aborts in its cleanup. Independent reads start together.
- A loader or a wrapper that redirects signed-out users is a convenience, not a guard: the API still checks access on
  every request, and the decision comes from what the API says (the session endpoint), never from a role kept in
  `localStorage`.
- Mutations call the API through the typed client; disable the submit while pending, show the contract's field errors
  next to their fields, and refresh or update the cache after success (`revalidator`, `invalidateQueries`).
- In development, `server.proxy` in `vite.config.ts` sends `/api` to the local backend so the client uses relative URLs
  and no CORS setup; production serves the same path from the real host.

## Environment variables

- Only variables prefixed `VITE_` reach client code, through `import.meta.env.VITE_*`; they are inlined at build time
  as strings and anyone can read them in the bundle. A name with `VITE_` is public: never give a key, secret, token or
  password that prefix. A call that needs a secret goes through a server endpoint that holds it.
- `process.env` does not exist in the browser build; `import.meta.env.MODE`, `DEV` and `PROD` are the built-in values.
- Files: `.env`, `.env.local` (never committed), `.env.[mode]`. List every `VITE_` name in `.env.example` with a comment,
  and type them in `src/vite-env.d.ts` (`interface ImportMetaEnv { readonly VITE_API_URL: string }`). Do not widen
  `envPrefix` to expose more names.

## Testing

- Vitest with `environment: "jsdom"` (or `happy-dom` when the project uses it) and a setup file that imports
  `@testing-library/jest-dom/vitest`. Without `globals: true`, call `cleanup` in an `afterEach` of the setup file.
- Render screens with Testing Library (`@testing-library/react`) and act with `@testing-library/user-event`; find controls by role and
  name.
- Fake the network with MSW in the setup file: `const server = setupServer(...handlers)` from `msw/node`,
  `server.listen({ onUnhandledRequest: "error" })` before all, `server.resetHandlers()` after each, `server.close()`
  after all. A test changes one answer with `server.use(...)`. Never mock the app's own hooks or API client.
- Test a route with its router: `createMemoryRouter(routes, { initialEntries: ["/billing"] })` and `RouterProvider`
  (or `<MemoryRouter initialEntries>`), so loaders, redirects and links run as in the app.
- jsdom has no layout and no `HTMLDialogElement.showModal`: assert roles, names, focus and visibility, not sizes or
  positions. A browser test (Playwright) is for what needs a real browser, through the project's `webServer` config.

## Common mistakes

- `VITE_STRIPE_SECRET_KEY` or any secret under the public prefix, or a secret read through `define` in
  `vite.config.ts`: both end up in the bundle.
- Hiding a page or a link by a role stored in `localStorage` and calling that the access check.
- `useEffect(() => { fetch(...).then(setData) }, [q])` with no abort: the slower, older answer replaces the newer one.
- Reading `process.env.X` in client code (undefined at run time), or `import.meta.env.X` without the `VITE_` prefix.
- No SPA fallback on the host: a reload on `/billing` returns 404. The deploy rewrites unknown paths to `index.html`
  (`devops` owns that config).
- Importing a whole icon or component library through its barrel file when one icon is used.
- Tests that `vi.mock` the screen's data hook, or that query `container.querySelector(".class")`.

## Commands

`pnpm dev` (Vite dev server), `pnpm build` (usually `tsc -b && vite build`, output in `dist/`), `pnpm preview` (serve
the build), `pnpm vitest run` (tests), `pnpm lint` (the linter of `node.md`, with the `react`, `react-hooks` and
`jsx-a11y` rules), `pnpm exec tsc -b` or `pnpm exec tsc --noEmit` (whichever the project's `build` script uses). A type
or lint error is fixed, never disabled.

## Sources

vite.dev (env variables and modes, server options, building for production), reactrouter.com (routers, loaders,
testing with a memory router), testing-library.com, mswjs.io (`msw/node`, `setupServer`), vitest.dev (environments,
setup files). Look there again when Vite, React Router or MSW ships a new major version.
