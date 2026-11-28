---
case: people-search
covers: [F6, F7, F8, client-data-and-state, testing-through-the-user]
fixture: frontend-web
change: find-a-person
task: T01
timeout_min: 35
max_turns: 90
screenshots: off
restore: [.aidw/design/tokens.yaml, tests/setup.ts, tests/environment.ts, tests/render.tsx, tests/msw/handlers.ts, tests/msw/server.ts]
must_read:
  - .aidw/changes/find-a-person/api-contract.md
  - plugin:roles/frontend/skills/client-data-and-state.md
  - plugin:roles/frontend/skills/screen-states.md
---
## Situation

Task T01 of the fixture's Change `find-a-person`: a search box at `/people` of a Vite + React 19 app that lists the people of
the clinic matching what is typed, one request per change of the text. The fixture has no browser (Vitest, jsdom,
Testing Library, MSW), so `screenshots: off` drops the brief's screenshot lines; the design tokens stay in it.

The neighbour an Agent might copy is wrong: `src/data/useFetch.ts`, which the notices page loads with, fetches in an
effect with no way to stop it and with no ignore flag, so the answer of an earlier URL replaces a later one when it
arrives last; the notices page next to it also copies the hook's data into a second piece of state with an effect
(`shown`), one render late. The hook is inside Touches: the Agent may fix it (the notices page keeps its tests) or
leave it and write its own.

The held-out tests (`held-out/tests/held-out/people-search.test.tsx`) render the app's router at `/people` and use the
fixture's MSW handlers (restored before grading) with answers held back by MSW's `delay`: nothing typed says to type a
name and sends no request; each match is listed with name and title; while the answer is out the screen says it is
searching; typing "ab" and then "e" while "ab" is slow and "abe" is fast must never show the people of "ab" (the DOM is
asserted, not the mechanism: a cancelled request and an ignored answer both pass); emptying the box while an answer is
on its way shows the first state again and the late answer never appears, with no request for the empty box; an empty
answer says "No one matches" and the text; a `503` is an alert with a Retry that searches again, never the no-match text.
The checks run the Role's `fetch-waterfalls` (no `uncancelled-effect-fetch` or `derived-state-effect` in the added code),
that every scenario id names a test, the whole suite, the typecheck, and that nothing outside Touches changed (only
`src/people/`, `tests/people/`, `src/data/useFetch.ts`, `src/routes.tsx` and the run and change folders of `.aidw/`).
A model grades only what the Agent says about the hook. The script reads the whole `useFetch` file when the session
edited it (also an edit of the body only), so a debounce with `clearTimeout` and no abort is reported; the held-out tests
still catch a stale answer whatever the hook does (a 300 ms debounce is longer than their typing, so they alone would pass it).

## Criteria

- must say in its final reply or its report file that the existing `useFetch` hook (src/data/useFetch.ts) does not cancel or ignore a request that a newer URL has superseded, and whether it fixed the hook or kept its own search from using it, instead of keeping quiet about it
