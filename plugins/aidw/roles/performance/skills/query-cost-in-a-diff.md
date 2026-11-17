---
name: query-cost-in-a-diff
description: Find in a diff the costs that no small test database shows - a query per row, a list with no limit, a missing index - and judge them against the scale the spec states.
---

# Query and data cost in a diff

A page is fast with ten rows in a test database. Read the diff for what happens with the number of rows the spec
says the product will have. If the spec states no scale, say so and judge against a plain assumption you write down.

## What to look for

- **A query per item.** A database or network call inside a loop, a `map`, a component rendered per row, a
  serializer or a resolver that loads a relation for each parent. Count: one query for the list plus one per row.
  The fix is one query (a join, an `IN`, the ORM's eager loading or a batch loader).
- **A list with no limit.** `findMany()`, `SELECT` with no `LIMIT`, an endpoint that returns everything, a
  component that renders every row. Ask what the largest realistic list is.
- **Work in the application that the database should do.** Loading rows to count, sum, filter, sort or dedupe them.
- **A filter or sort with no index.** A new `WHERE`, `ORDER BY` or join column: is there an index that starts
  with it? A leading-wildcard `LIKE`, a function on the column, or a mismatched type will not use one.
- **Too much per row.** `SELECT *` or a whole document when the path shows three fields; large text or JSON
  columns in a list query.
- **Sequential awaits** for calls that do not depend on each other.
- **Repeated work.** The same query or computation several times in one request; an expensive call with a stable
  result and no cache, or a cache with no bound or no invalidation.
- **Writes in bulk done one by one**, each in its own transaction or round trip.
- **Long transactions** that hold locks across a network call.
- **In the client**: the whole dataset sent to filter in the browser, a re-fetch on every keystroke, a re-render
  of a long list on each change.

## How to check instead of guess

Read the code path from the entry point to the query. Where the project lets you run things read-only, turn on
query logging in a test and count the statements for a list of 1 and of 20: the count must not grow with the
list. `EXPLAIN` a new query when a database is available. Say which of these you did and which you only read.

## What is and is not a finding

Blocking: a per-item query or an unbounded list on a path the spec says will be large or frequent; a query that
cannot use an index on a table the spec says will be large. Non-blocking: the same on an admin screen with a
handful of rows, micro-optimisations, anything you could not tie to a stated scale. Each blocking line gives the
file, the path that triggers it, the count or size that makes it hurt, and the shape of the fix.

## Sources

Ideas, not wording: Sentry's `django-perf-review` (prove the impact before reporting), *Use The Index, Luke*
(Markus Winand), the N+1 guidance of the Rails, Django and Prisma documentation, and Addy Osmani's
`performance-optimization`.
