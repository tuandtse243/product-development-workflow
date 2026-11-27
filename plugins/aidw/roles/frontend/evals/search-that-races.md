---
case: search-that-races
covers: [F7, F8, client-data-and-state]
---
## Input

A frontend task brief (task T9, Vite + React + TypeScript, Vitest + Testing Library, MSW; the project has no query
library and uses plain `fetch`). Build the people search of the directory page. Scenario DIR-1: "Given I type in the
search box, when the answers arrive, then the list shows the people for what is in the box now." Scenario DIR-2: "Given
the results, when I tick 'Active only', then only active people are listed and the heading shows how many." Typing fires
`GET /api/people?q=<text>` that returns `{ people: [{ id, name, active }] }`; the brief notes that answers take 100 to
900 ms. The "Active only" filter is client side; the API has no parameter for it.
Touches: `src/directory/**`, `tests/directory/**`. Verify: `npm test`.

## Criteria

- must make sure a superseded request cannot replace newer results: abort it (`AbortController`) or ignore its answer, and must not rely on a debounce alone
- must compute the "Active only" list and the count in the heading during render, not copy them into state with an effect
- must hold the fetched people in one place, not in the component and again in another store
- must prove with a test that answers two queries out of order (the older one last) and asserts the list still shows the newer query's people
- must use `findBy` or `waitFor` on what the user sees and fake the network at its boundary, not mock the component's own hook
