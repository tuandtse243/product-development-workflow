---
name: query-shape
description: Write a list or a relation load so the number of queries and rows read does not grow with the data - keyset pagination, a stable order, relations in one query, only the needed columns - and prove it with a query count.
---

# Query shape

Serves rules B10 and B11. The performance reviewer reads the finished diff for query cost (`query-cost-in-a-diff`).
This is the builder's side, short on purpose: shape the query right the first time and leave the proof in a test.
The full keyset query, the cursor and the ORM forms are in
`aidw plugin-path roles/backend/references/keyset-pagination.md`.

## Steps

1. **Bound the list first**: a default limit, a maximum the caller cannot exceed, and an order that ends in a unique
   key (`created_at, id`). Take the numbers from the contract; when it names none, ask its author (Consultation),
   do not pick them.
2. **Page a list that grows by keyset, not by offset**, as `api-design-rules` asks (`?limit=&cursor=`, a
   `nextCursor` in the response). Filter after the last row's sort keys, fetch one row more than the limit to know
   whether there is a next page, and put the last row's sort values in the cursor at the database's full precision.
   An `OFFSET` reads and throws away every earlier row, and an insert between two requests makes it show a row twice
   or never. Offset only for a small, fixed set.
3. **Load relations in one query per relation**, never one per row: a join, an `IN (...)` over the ids of the page,
   or the ORM's eager load. Skip the second query when the page is empty. A call inside a loop over rows, or inside
   a serializer that runs per row, is the bug.
4. **Select what the response needs.** Not every column, and never a large text or JSON column in a list.
5. **Let the database count, sum, filter and sort.** Loading rows to do it in code grows with the table.
6. **Prove it in a test**: count the queries for a list of 1 row and of N rows (the Role's `query-count` helper,
   or the ORM's query log). The two counts are equal. Request more than the maximum and assert the maximum is
   returned; follow `nextCursor` to the end and assert no row is repeated or missing.
7. **A filter or sort with no index to serve it** goes in your report under Owed, as a note for the `database`
   Role naming the index. Do not add it yourself: schema files are not in a backend task's Touches.

## Right and wrong

`GET /projects?limit=&cursor=` returns a team's projects, newest first, each with its owner's name.

Right: two queries whatever the page size, keyset-paged, with the count and the paging in a test.

```
projects = SELECT id, name, owner_id, created_at FROM projects
           WHERE team_id = :t AND (created_at, id) < (:c, :i)      -- omitted on the first page
           ORDER BY created_at DESC, id DESC LIMIT :limit + 1       -- limit <= 100
page = first :limit rows; nextCursor = encode(last row's created_at at full precision, id) if a row was left over
owners = SELECT id, name FROM users WHERE id IN (:ownerIdsOfThisPage)   -- skipped when the page is empty
response: { items: [...], nextCursor }
report, Owed: index (team_id, created_at, id) on projects, for the database Role
test: 1 project -> 2 queries; 30 projects -> 2 queries; ?limit=1000 -> 100 items;
      walking nextCursor over 250 projects returns each exactly once
```

Wrong: no limit, no stable order, every column, and one owner query per project.

```
projects = SELECT * FROM projects WHERE team_id = :t
for p in projects: p.owner = SELECT * FROM users WHERE id = p.owner_id   -- 1 + N queries
```

## Sources

Ideas, not wording: aidw's `query-cost-in-a-diff` (the reviewer's side of the same topic) and `api-design-rules`
(cursor pagination for lists that grow); the N+1 guidance of the Django and Prisma documentation; Markus Winand's
*Use The Index, Luke* on the seek method and paging. Look there again when the project adds an ORM with its own
loading rules.
