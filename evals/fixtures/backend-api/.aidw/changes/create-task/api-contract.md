# API contract: create-task

Author: api-designer. Binding: keep every name, status code and error type.

## POST /api/projects/{projectId}/tasks

Creates a task in a project. The caller must be signed in (`Authorization: Bearer <token>`) and be a member of the
project's team. The task belongs to the project's team and is created by the caller; neither is ever taken from the
request.

### Request

- Path: `projectId`, a UUID.
- Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `title` | string | required; trimmed; 1 to 200 characters after trimming |
| `dueDate` | string | optional; a calendar date `YYYY-MM-DD`; today (UTC) or later |

### 201 Created

```json
{ "id": "5c0e...", "title": "Write the release notes", "dueDate": "2026-12-01", "createdAt": "2026-11-25T09:30:00.000Z" }
```

Exactly these four fields. `dueDate` is `null` when none was given; `createdAt` is an ISO 8601 timestamp in UTC.

### Errors

Problem bodies `{ type, title, status }` (`application/problem+json`), as `src/http/errors.ts` writes them; `detail`
may be added and is never relied on.

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | the body is not JSON, a field has the wrong type or length, or the body has a field not listed above |
| 401 | `unauthenticated` | no session, or an expired or unknown token |
| 404 | `project-not-found` | no project has this id, the id is not a UUID, or the caller is not a member of the project's team: the same body in all three cases, so a caller learns nothing about other teams |
| 422 | `due-date-in-past` | `dueDate` is before today (UTC) |
| 500 | `internal-error` | anything unexpected; no detail |

Titles: `400` "The request is not valid", `401` "Sign in first", `404` "No such project", `422` "The due date is in the
past", `500` "Something went wrong".

Checks run in this order: session (401), project and membership (404), body (400), due date (422).
