# Keyset (cursor) pagination: the query behind it

Lookup material for the backend Role, read when a task builds a list that grows. What the list looks like to the
client (limit, default, maximum, `nextCursor`, allowed sorts) is decided by the contract and `aidw/api-design-rules`;
this file is how to build it so pages neither skip nor repeat rows and stay fast on page 1000.

## The query

Sort by the requested column and end with a unique key, so the order is total. Fetch one row more than the limit to
know whether a next page exists.

```sql
-- first page
SELECT id, created_at, title FROM bookings
WHERE owner_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2 + 1;

-- next page: the cursor carries the last row's (created_at, id)
SELECT id, created_at, title FROM bookings
WHERE owner_id = $1 AND (created_at, id) < ($3, $4)
ORDER BY created_at DESC, id DESC
LIMIT $2 + 1;
```

- The row comparison `(a, b) < (x, y)` works in PostgreSQL and SQLite (3.15 and later) and uses an index on
  `(owner_id, created_at, id)`. Where the planner does not use the index for it (check MySQL with `EXPLAIN`), write the
  expanded form: `created_at < $3 OR (created_at = $3 AND id < $4)`.
- The row comparison only works when every sort key goes the same direction. For a mixed sort (`price ASC, id DESC`)
  write the expanded form with the right operator per key.
- Ascending order uses `>`; descending uses `<`. A "previous page" runs the query with the operators and the order
  reversed, then reverses the rows it got.
- A nullable sort column breaks the comparison (`NULL < x` is unknown). Sort on a non-null expression
  (`COALESCE(due_at, 'infinity')`) used the same way in the `ORDER BY`, the cursor and the index, or keep rows with no
  value out of that sort.

## The cursor

- Encode the last row's sort values and id, for example base64url of `{"v":["2026-11-20T10:00:00Z"],"id":"b_81"}`. The
  client treats it as opaque.
- Keep the sort value at the database's full precision in the cursor. A PostgreSQL `timestamptz` has microseconds, a
  JavaScript `Date` ISO string only milliseconds: rows inside the same millisecond are skipped or repeated. Carry the
  value as the database's text, or truncate the column to milliseconds.
- Decode and validate it like any input: a malformed cursor is `400`, not a crash and not page 1.
- A cursor belongs to one sort and one set of filters. Put the sort (or a hash of sort and filters) in the cursor and
  refuse it with `400` when the request's sort or filters differ.
- The cursor never widens access: the query keeps every filter of the caller's scope (`owner_id`, tenant), whatever
  the cursor says.
- `nextCursor` is `null` (or absent, as the contract says) when the extra row was not returned.

## In an ORM

The expanded `WHERE` works in every ORM and query builder:

```ts
// Prisma, Drizzle or Knex follow the same shape: filter, order, take limit + 1
where: { ownerId, OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] },
orderBy: [{ createdAt: "desc" }, { id: "desc" }],
take: limit + 1,
```

- Prisma also has `cursor: { id }` with `skip: 1`; it needs a unique cursor field, and the `orderBy` must still end in
  a unique key.
- Django: `filter(Q(created_at__lt=c) | Q(created_at=c, id__lt=i)).order_by("-created_at", "-id")[: limit + 1]`.
- SQLAlchemy: `tuple_(Booking.created_at, Booking.id) < (c, i)` on PostgreSQL, the expanded `or_` form elsewhere.

## What not to do

- `OFFSET n` on a list that grows: every page reads and drops `n` rows, and an insert between two requests shifts
  rows so one is shown twice or never.
- A sort that does not end in a unique key: rows with equal values come back in any order, across pages too.
- A total count on every page of a large table: it scans the whole filter. Only when the contract asks for it, and
  then consider an estimate.
- A sort or filter field taken from the query string without an allowlist (it reaches `ORDER BY` as an identifier).
- A new sort or filter with no index behind it: say so in the report, the index is a `database` task.

## Sources

Markus Winand, "Use The Index, Luke": "Paging Through Results" and the seek method; PostgreSQL 18 documentation, "Row
Constructor Comparison"; SQLite documentation, "Row Values"; the Prisma documentation on pagination; the Django
documentation on `Q` objects and slicing querysets. Written for aidw; no text copied.
