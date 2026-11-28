---
name: client-data-and-state
description: Decide where each piece of client state lives (server cache, URL, local, form), read independent data together, cancel or ignore a superseded request so a stale answer never wins, compute derived values in render, and roll back an optimistic update that fails.
---

# Client data and state

Serves rules F7, F8 and F14. A search box that fires a request per keystroke shows the results for "ab" when the
slower "ab" answer lands after "abc". A total copied into state by an effect is one render behind its items. Neither
shows up in a happy-path test. React and Next.js specifics (Server Components, `cache()`, `next/dynamic`, effects in
detail) are in `aidw/react-rules`, loaded with the framework pack; this skill is the part that holds in any framework.

## Steps

1. **Give each piece of state one home** before writing code:

   | State | Home |
   |---|---|
   | data the server owns (lists, records, the session) | the framework's loader or server component, or the project's query cache (TanStack Query, SWR, RTK Query): one place, never also copied into a component or global store |
   | what the user can link to or reload into (filter, tab, page, search text) | the URL |
   | what one component alone uses (open, hover, a draft) | local state |
   | a form's typed values and field errors | the form (see `forms-from-the-contract`) |
   | anything computable from the above | nothing: compute it during render |

2. **Read on the server or in a loader when the framework can.** A mount effect that fetches is the last choice; when it
   is the only choice, it cleans up (step 4).
3. **Start independent reads together** (`Promise.all`, parallel queries, sibling loaders) and await a read only where
   its result is needed. A read that uses another's result waits for it, and only for it.
4. **Never let a superseded request win.** Search, filters, tabs and paging start a new request before the old one
   answers. Give each request an `AbortController` signal (or the query cache's `signal`) and abort it in the effect's
   cleanup, or key the cache by the input so each answer lands under its own key. A debounce cuts requests but does not
   order them: it is never the fix by itself.
5. **Compute, do not copy.** A total, a filtered list, a "has changes" flag is an expression in render. An effect whose
   body only calls a setter with props or state is the bug (F8).
6. **Show what the server says.** A price, a permission, a limit or a status transition comes from the API's answer.
   When the screen needs a value the API does not give, ask `api-designer` as a Consultation (F14); do not compute it
   from what the client happens to know.
7. **An optimistic update has a rollback**: keep the previous value, apply the change, and on an error restore it and
   tell the user (the error state of `screen-states`).
8. **Prove the order in a test**: answer the first request late and the second at once, then assert only the newer
   results are visible after both settle (`testing-through-the-user` shows how to delay one answer).

## Right and wrong

A people search that reads `GET /api/people?q=` as the user types:

Right: each request is cancelled when a newer one starts, or the cache keeps answers apart by `q`.

```
useEffect(() => {
  if (!q) return setHits([]);
  const c = new AbortController();
  searchPeople(q, { signal: c.signal }).then(setHits).catch((e) => { if (e.name !== "AbortError") setError(e); });
  return () => c.abort();
}, [q]);
// or: const { data } = useQuery({ queryKey: ["people", q], queryFn: ({ signal }) => searchPeople(q, { signal }) });
test: type "ab" (answer after 300 ms), then "c" (answer at once) -> after both settle only the "abc" people show
```

Wrong: the slower answer overwrites the newer one, and a derived value is copied by an effect.

```
useEffect(() => { searchPeople(q).then(setHits); }, [q]);                  // "ab" lands after "abc" and wins
useEffect(() => setTotal(items.reduce((s, i) => s + i.price, 0)), [items]); // one render stale; compute it instead
```

## Sources

Ideas, not wording: the React documentation, "You Might Not Need an Effect" and "Synchronizing with Effects" (fetching
and its cleanup); TanStack Query's guide on query cancellation; the `async-` and `client-` categories of Vercel's
`react-best-practices` (no licence file, so nothing is copied); aidw's `react-rules`, which this skill points to rather
than repeats.
