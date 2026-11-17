---
name: react-rules
description: Rules for React and Next.js code that tests rarely catch - waterfalls, bundle size, re-renders, effects. Loaded with the Next.js framework pack.
---

# React and Next.js rules

The framework pack says how the app is organised. These are the mistakes that pass every test and make the app
slow or subtly wrong. In order of cost to the user.

## 1. Do not wait in sequence for things that are independent

- Start independent requests together and await them together (`Promise.all`), instead of one `await` after another.
- Move an `await` into the branch that needs its result; do not block a whole function for a value one path uses.
- In the App Router, let sibling Server Components fetch on their own and wrap the slow one in `<Suspense>` so the
  rest of the page streams. A parent that awaits everything before rendering is a waterfall.
- Do not call your own route handler from a Server Component: call the module it calls.

## 2. Ship less JavaScript

- Import the one thing you use from its own path when the package has a barrel file that pulls in everything
  (icon and component libraries), or configure the bundler to do it.
- Load a heavy component the first screen does not need with `next/dynamic` (an editor, a chart, a map).
- Keep `'use client'` on the smallest leaf. Pass only the fields a Client Component uses, not the whole record:
  everything passed is serialized into the page.
- Third-party scripts (analytics, chat) load after the page is interactive.

## 3. Fetch on the server, once

- Read data in Server Components or the functions they call. `useEffect` plus `fetch` on mount is the last choice.
- The same read in several components of one request is wrapped in `cache()` so it runs once.
- Client-side data that several components need goes through one cache (SWR, TanStack Query), not one fetch each.
- Say for each read whether it may be cached and for how long. Nothing is cached by accident.

## 4. Effects and state

- If a value can be computed from props or state, compute it during render. Do not copy it into state with an effect.
- An effect is for synchronising with something outside React (a subscription, the DOM, a timer), and it cleans up.
- Reset state by giving the component a `key`, not by an effect that watches a prop.
- Updates from the previous state use the function form (`setCount((c) => c + 1)`).
- A handler reads the latest value at call time; do not re-create subscriptions because a callback changed.
- With the React Compiler on, do not add `useMemo` or `useCallback` by hand; without it, add them only where a
  profile showed a problem.

## 5. Rendering

- A list gets a stable `key` from the data, never the index when items can move.
- Long lists are paginated or virtualised.
- Do not define a component inside another component: it is re-created and loses its state every render.
- Conditionally render with a ternary when the left side can be `0` or `""` (`count && <X/>` prints `0`).
- Anything that differs between server and client (time, random, `window`, locale) is rendered in an effect or
  passed from the server, or it is a hydration mismatch.

## 6. Forms and mutations

- A Server Action validates its input and checks who is calling: it is a public endpoint.
- Show pending state with `useActionState` or `useFormStatus`; disable the submit while it runs.
- After a mutation, revalidate the data it changed. An optimistic update has a rollback.

## Sources

Ideas, not wording: Vercel's `react-best-practices` and `composition-patterns` rule sets (which carry no licence
file, so nothing is copied), the React documentation ("You Might Not Need an Effect", the Rules of React), and
the Next.js App Router documentation.
