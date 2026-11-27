# API contract: book-a-room

Author: api-designer. Binding: keep every name, status code and error type.

## POST /api/rooms/{roomId}/bookings

Books a room for one hour. The caller must be signed in (`Authorization: Bearer <token>`) and be a member of the room's
team. The booking belongs to the room's team and is made by the caller.

### Request

- Path: `roomId`, a UUID.
- Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `startsAt` | string | required; an ISO 8601 date-time with a time zone (`Z` or an offset), on the hour (minutes, seconds and fractions zero); later than now |

Two values that name the same instant (`2030-01-07T09:00:00Z`, `2030-01-07T11:00:00+02:00`) are the same slot.

### 201 Created

```json
{ "id": "8f1c...", "roomId": "5c0e...", "startsAt": "2030-01-07T09:00:00.000Z", "createdAt": "2026-11-25T09:30:00.000Z" }
```

Exactly these four fields; `startsAt` and `createdAt` are ISO 8601 timestamps in UTC.

### Errors

Problem bodies `{ type, title, status }` (`application/problem+json`), as `src/http/errors.ts` writes them; `detail`
may be added and is never relied on.

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | the body is not JSON, `startsAt` is missing, not a date-time with a time zone or not on the hour, or the body has a field not listed above |
| 401 | `unauthenticated` | no session, or an expired or unknown token |
| 404 | `room-not-found` | no room has this id, the id is not a UUID, or the caller is not a member of the room's team: the same body in all three cases |
| 409 | `slot-taken` | the slot already has an active booking, including one made by a request that arrived at the same moment; a cancelled booking does not hold a slot |
| 422 | `slot-in-past` | `startsAt` is not later than now |
| 500 | `internal-error` | anything unexpected; no detail |

Titles: `400` "The request is not valid", `401` "Sign in first", `404` "No such room", `409` "The slot is already
booked", `422` "The slot is in the past", `500` "Something went wrong".

Checks run in this order: session (401), room and membership (404), body (400), time (422), slot (409).
