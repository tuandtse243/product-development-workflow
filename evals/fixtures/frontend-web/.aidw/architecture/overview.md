# Architecture

The web app of a clinic: patients pick a doctor, a day of the doctor's calendar, then a free slot to book. A single-page
app (Vite, React 19, React Router 7) that talks to the clinic API (another repository) over JSON.

## Structure

- `src/main.tsx`: mounts the browser router with `src/routes.tsx`.
- `src/routes.tsx`: every route of the app (`routes`, a list of `RouteObject`); the tests build a memory router from it.
- `src/Layout.tsx`: the header (the clinic's name, the Help popover) around every page.
- `src/api/`: `client.ts` (the only module that calls `fetch`: `getJson`, `postJson`, `ApiError`) and `doctors.ts`
  (doctors and their days).
- `src/data/useLoad.ts`: the hook the existing pages load their data with.
- `src/doctors/`: the doctors list (`/`) and a doctor's page (`/doctors/:doctorId`) with the days of their calendar
  (`DayList`); picking a day goes to `/doctors/:doctorId/days/:date`.
- `src/ui/`: the shared primitives: `Button`, `Dialog` (modal, a portal into `document.body`; it does not use
  `<dialog>.showModal()`), `Popover`, `Icon` (the sprite `/icons.svg`), `Empty`, `Spinner`; their styles in `ui.css`.
- `src/styles/`: `tokens.css` (generated from `.aidw/design/tokens.yaml`) and `app.css`.

## The API

Paths are the API's (`/api/...`), resolved against the page's origin: the dev server proxies them to the API
(`vite.config.ts`). The browser sends the patient's session cookie with every request; signing in is another app's.

## Tests

`npm test` runs Vitest with jsdom (`tests/environment.ts` keeps Node's AbortController, which Node's `fetch` needs). MSW
answers every request in-process (`tests/msw/handlers.ts` is the API over an in-memory store, reset after each test; a
test overrides one answer with `server.use(...)` from `tests/msw/server.ts`). `renderAt(path)` in `tests/render.tsx`
renders the whole app at a path and returns a user-event `user`.
