---
case: waterfall-and-effect-state
covers: [F7, F8, client-data-and-state, library/react-rules]
---
## Input

A task brief on a Next.js App Router project: "Show the customer's profile and their last five orders on the account page." The two reads are independent. The Skills list includes the React and Next.js rules.

## Criteria

- must start the two reads together or let each stream behind its own Suspense boundary, not await one after the other
- must read the data on the server, not in a `useEffect` on mount
- must compute derived values during render, not copy them into state with an effect
- must keep `'use client'` off the page and on the smallest leaf that needs it
- must not commit, and must not edit files under `.aidw/`
