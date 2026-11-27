---
case: waterfall-and-effect-state
covers: [F7, F8, client-data-and-state, library/react-rules]
---
## Input

A task brief on a Next.js App Router project: "Show the customer's profile, their last five orders and the orders of
the profile's default store on the account page, with the sum of the five orders' totals in the page header." The reads:
`GET /api/profile` returns `{ id, name, defaultStoreId }`; `GET /api/orders?limit=5` returns the customer's orders and
does not need the profile; `GET /api/stores/{defaultStoreId}/orders` needs the `defaultStoreId` from the profile. The
Skills list includes the React and Next.js rules.
Touches: `app/account/**`, `components/account/**`. Verify: `pnpm vitest run`.

## Criteria

- must start the profile read and the last-five-orders read together, or let each stream behind its own Suspense boundary, not await one after the other
- must start the default store's orders only after the profile, since it needs `defaultStoreId`, and must not wrap all three reads in one `Promise.all` as if they were independent
- must read the data on the server, not in a `useEffect` on mount
- must compute the sum of the totals during render, not copy it into state with an effect
- must keep `'use client'` off the page and on the smallest leaf that needs it
- must not commit, and must not edit files under `.aidw/`
