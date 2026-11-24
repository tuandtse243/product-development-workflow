---
name: query-shape
description: Write a list or a relation load so the number of queries and rows does not grow with the data - a limit, a stable order, relations in one query, only the needed columns - and prove it with a query count.
---

# Query shape

The performance reviewer reads the finished diff for query cost (`query-cost-in-a-diff`). This is the builder's
side, short on purpose: shape the query right the first time and leave the proof in a test.

## Steps

1. **Bound the list first**: a default limit, a maximum the caller cannot exceed, and an order that ends in a unique
   key (`created_at, id`), so pages neither repeat nor skip rows. Take the numbers from the contract; when it names
   none, ask its author (Consultation), do not pick them.
2. **Load relations in one query per relation**, never one per row: a join, an `IN (...)` over the ids of the page,
   or the ORM's eager load. A call inside a loop over rows, or inside a serializer that runs per row, is the bug.
3. **Select what the response needs.** Not every column, and never a large text or JSON column in a list.
4. **Let the database count, sum, filter and sort.** Loading rows to do it in code grows with the table.
5. **Prove it in a test**: count the queries for a list of 1 row and of N rows (the Role's `query-count` helper,
   or the ORM's query log). The two counts are equal. Request more than the maximum and assert the maximum is
   returned.
6. **A new filter or sort with no index to serve it** goes in your report as a note for the `database` Role. Do
   not add the index yourself: schema files are not in a backend task's Touches.

## Right and wrong

`GET /projects` returns each project with its owner's name.

Right: two queries whatever the page size, bounded and stably ordered, with the count in a test.

```
projects = SELECT id, name, owner_id FROM projects WHERE team_id = :t
           ORDER BY created_at DESC, id DESC LIMIT :limit          -- limit <= 100
owners   = SELECT id, name FROM users WHERE id IN (:ownerIdsOfThisPage)
test: 1 project -> 2 queries; 30 projects -> 2 queries; ?limit=1000 -> 100 items
```

Wrong: no limit, no stable order, every column, and one owner query per project.

```
projects = SELECT * FROM projects WHERE team_id = :t
for p in projects: p.owner = SELECT * FROM users WHERE id = p.owner_id   -- 1 + N queries
```

## Sources

Ideas, not wording: aidw's `query-cost-in-a-diff` (the reviewer's side of the same topic); the N+1 guidance of the
Django and Prisma documentation; Markus Winand's *Use The Index, Luke* on ordering and pagination. Look there again
when the project adds an ORM with its own loading rules.
