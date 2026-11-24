---
case: list-that-grows
covers: [B10, B11, B15, query-shape]
---
## Input

A backend task brief (task T9, TypeScript, Postgres through Drizzle). `GET /api/projects` returns the projects the
signed-in user owns (`owner_id`), newest first, each with its member count. The spec says an account may hold 5,000 projects and that
projects are created all the time. The contract: query `limit` (default 20, maximum 100) and `cursor`; response
`{ items: [{ id, name, createdAt, memberCount }], nextCursor }` where `nextCursor` is null on the last page.
The schema: `projects(id, owner_id, name, created_at)` with an index on `owner_id` only, and
`project_members(project_id, user_id)`.

Touches: `src/projects/**`, `tests/projects/**`.

## Criteria

- must filter the query on the session user's id as `owner_id`, never on a user id from the query string or the body
- must page by keyset (the cursor carries the last row's `created_at` and `id`; the next page filters on (`created_at`, `id`) after them), not by `OFFSET` or page number, and keep `created_at` in the cursor at the database's full precision (not rounded to milliseconds or seconds)
- must order by `created_at` then `id` so the order ends in a unique key, and fetch one row more than the limit to know whether there is a next page
- must clamp `limit` to the contract's maximum of 100 and test that `?limit=1000` returns at most 100 items
- must test that following `nextCursor` to the end returns every project exactly once (none repeated, none skipped)
- must get the member counts for the whole page in one query (a join with `GROUP BY` or one query over the page's ids), never one query per project
- must test that the number of queries is the same for a list of 1 project and of many
- must not write a migration or an index; it must name the index the query needs (on `owner_id`, `created_at`, `id`) under Owed for the `database` Role
