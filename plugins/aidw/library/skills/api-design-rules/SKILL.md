---
name: api-design-rules
description: Concrete rules for an HTTP API - naming, errors, pagination, idempotency, compatibility. Use when a task adds or changes a route or a server action that another part of the system calls.
---

# API design rules

The project's own conventions come first: read two existing endpoints and match them. These rules decide what the
project has not decided. Addy Osmani's `api-and-interface-design` gives the principles; this is the checklist.

## Names and shapes

- Resources are plural nouns (`/invoices/{id}`), nested one level at most (`/teams/{id}/members`). An action
  that is not CRUD is a sub-resource or a verb at the end (`POST /invoices/{id}/send`), never a verb in the middle.
- One case for JSON fields across the whole API (the project's; `camelCase` when none exists). Never both.
- Ids are opaque strings. Timestamps are RFC 3339 in UTC with a name that ends in `At`. Money is an integer in
  the minor unit plus a currency code. Enumerations are strings, and clients must tolerate a value they do not know.
- A field is either always present (possibly `null`) or documented as optional. Do not mix "absent" and `null`
  for the same meaning.
- A response is an object, never a bare array, so it can grow.

## Methods and status codes

- `GET` reads and changes nothing. `PUT` replaces, `PATCH` changes the fields sent, `DELETE` is idempotent
  (deleting what is gone is `204` or `404`, consistently).
- `201` with the created resource for a create; `202` when the work continues after the response; `204` for
  success with no body.
- `400` malformed, `401` not authenticated, `403` authenticated but not allowed, `404` not found (also when the
  caller may not know it exists), `409` conflict with current state, `422` well-formed but invalid, `429` limited.
  A failure is never `200` with an error inside.

## Errors

One shape for every error, RFC 9457 problem details unless the project has its own:

```json
{ "type": "https://example.com/problems/insufficient-funds", "title": "Insufficient funds", "status": 422,
  "detail": "The balance is 30.00 and the charge is 50.00.", "errors": [{ "field": "amount", "message": "..." }] }
```

A stable machine-readable code (`type`), a message a person can act on, per-field errors for validation. No stack
trace, SQL, file path or internal id in any error.

## Lists

- Every list has a limit with a default and a maximum. No endpoint returns "everything".
- Cursor pagination for anything that grows (`?limit=50&cursor=...`, response carries `nextCursor`), with a
  stable sort that ends in a unique key. Offset pagination only for small, fixed sets.
- Filtering and sorting use an allowlist of fields; an unknown one is `400`, not ignored.

## Writes that may be repeated

- A create or a payment-like action accepts an `Idempotency-Key` header: the same key with the same body returns
  the first result; the same key with a different body is `422`.
- Concurrent edits: a version or `ETag` with `If-Match`, and `409` or `412` when it is stale, instead of the last
  write silently winning.

## Compatibility

Adding an optional request field, a response field or a new endpoint is safe. Removing or renaming a field,
changing a type, making an optional field required, changing a status code or a default, or narrowing an
enumeration breaks clients: it needs a new version or a deprecation period, and the task's `breaking: true`.
Validate input at the boundary with a schema, and derive the types and the documentation from that one schema.

## Before you report

- [ ] every new endpoint checks who is calling and whether they may touch this record
- [ ] every list is limited and paginated
- [ ] every error path returns the one error shape with the right status
- [ ] a repeated write does not act twice
- [ ] nothing an existing client relies on changed without `breaking: true`

## Sources

Ideas, not wording: Google's API Improvement Proposals (AIP-121, 132, 158, 193), the Zalando RESTful API
Guidelines, the Microsoft Azure REST API Guidelines, RFC 9457 (problem details) and RFC 9110 (HTTP semantics).
