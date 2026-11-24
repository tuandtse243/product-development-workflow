# Status codes for the cases people get wrong

Lookup material for the backend Role, read when a route must answer a case the contract does not spell out. The
contract in the brief wins over this table, and the `aidw/api-design-rules` Skill holds the general list of codes and
the error shape; this file only settles the close calls. When the contract is silent on a case that changes what a
client does, ask (a Consultation with `api-designer`) instead of picking.

## Who is calling, and may they touch it

| Situation | Code | Why |
|---|---|---|
| No credentials, or an expired or invalid token | `401` with `WWW-Authenticate` | the caller is unknown; logging in again may help |
| Known caller, action not allowed for their role (not about one record) | `403` | logging in again does not help |
| Known caller asks for a record of another user or tenant | `404` (default) or `403`, as the contract says | `404` does not confirm the record exists; whichever is chosen, it is the same for "missing" and "not yours" on that route |
| Known caller, record exists, they may read but not change it | `403` | they can see it, so hiding it gains nothing |

## Is the request itself wrong

| Situation | Code | Why |
|---|---|---|
| Body is not valid JSON, a required field is missing, a type is wrong, an unknown field is sent | `400` | the request does not match the schema |
| Well-formed, but breaks a business rule (end before start, amount over the limit) | `422` | the schema is met, the content is refused |
| Body too large for the parser limit | `413` | set by the body parser's limit |
| Wrong `Content-Type` for a route that only takes JSON | `415` | |
| Path exists, method does not | `405` with `Allow` | not `404` |
| An id in the body points at a record that does not exist (a foreign key from the client) | `422`, or `404` if the contract says so | the route exists; the reference in the payload is the problem |

The `400` versus `422` split is a common contract choice, not a law: some APIs answer `400` for both. Follow the
contract and the project's existing routes; never mix the two meanings on one API.

## Does it clash with the current state

| Situation | Code | Why |
|---|---|---|
| Unique business key already taken (email, slot, order number) | `409` | the current state forbids it; the database's unique violation is mapped here |
| State machine refuses the move (cancel a shipped order) | `409` | |
| `If-Match` sent and the version is stale | `412` | the precondition failed |
| The route requires `If-Match` and it is missing | `428` | |
| Same `Idempotency-Key` with a different body | `422` | per the IETF draft and `api-design-rules` |
| Same `Idempotency-Key` while the first request is still running | `409` | |
| Record existed and was deleted, and the contract promises to say so | `410` | otherwise `404` |

## Success

| Situation | Code | Notes |
|---|---|---|
| Created | `201`, the resource in the body, `Location` header when the contract has one | |
| Accepted for later work | `202`, with where to poll | the work is recorded before answering |
| Done, nothing to return (delete, a command) | `204`, no body | a body with `204` is dropped by clients |
| Replay of a stored idempotent response | the stored status and body | not a fresh `200` |

## Something failed on our side

| Situation | Code | Notes |
|---|---|---|
| A bug, an unexpected exception | `500` | the problem body names no cause; the log has it |
| An outside service answered with an error we cannot map | `502` | the contract may fold it into `503` |
| An outside service timed out | `504` or `503` | per the contract |
| Overloaded or in maintenance, a retry later will help | `503` with `Retry-After` | |
| Rate limit of this API reached | `429` with `Retry-After` | |
| Database serialization failure or deadlock after the bounded retries | `503` or `500` | never `409`: the client did nothing wrong (see `database-conflicts.md`) |

## Sources

RFC 9110 (HTTP Semantics, sections 15.2 to 15.6 and the `Allow`, `Location`, `Retry-After` and `WWW-Authenticate`
fields), RFC 6585 (`428`, `429`), RFC 9457 (problem details), the IETF draft `draft-ietf-httpapi-idempotency-key-header`,
and the OWASP API Security Top 10 2023, API1 (broken object level authorization), for the `404` versus `403` choice.
Written for aidw; no text copied.
