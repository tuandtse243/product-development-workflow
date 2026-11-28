# API contract: rename-a-project

Author: api-designer. Binding: keep every name, status code and error code. The browser sends the `sid` cookie of a signed-in
user; signing in is not part of this Change.

Every error answer has the body `{ "error": { "code", "message"?, "fields"? } }` (`shared/errors.ts`). `message` is for people
and is never relied on; a `422 validation` carries `fields` and no `message`.

## PATCH /api/projects/{projectId}

Renames one project. Only an owner of the project's team may.

### Request

- Path: `projectId`, a UUID.
- Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `name` | string | required; trimmed by the server; 1 to 80 characters after trimming; unique in the project's team, ignoring case (the project's own current name does not count as taken) |

### 200 OK

The project, as `GET /api/projects/{projectId}` returns it, with the stored name:

```json
{ "id": "5c0e...", "teamId": "a41f...", "name": "Apollo", "createdAt": "2026-03-02T09:30:00.000Z" }
```

`name` is what was stored: the request `"  Apollo  "` answers `"Apollo"`.

### Errors

The checks run in this order: session, project and membership, owner, then the body.

| status | code | when |
|---|---|---|
| 400 | `invalid-request` | the id is not a UUID, the body is not JSON or is not an object, or it has a field not listed above |
| 401 | `unauthenticated` | no session, or an expired or unknown one |
| 403 | `forbidden` | the caller belongs to the project's team but is not an owner of it |
| 404 | `project-not-found` | no project has this id, or the caller is not in the project's team: the same body in both cases |
| 422 | `validation` | `name` is missing, not a string, blank after trimming, over 80 characters, or taken in the team |
| 500 | `internal-error` | anything unexpected; no detail |

A `422` body is exactly `{ "error": { "code": "validation", "fields": { "name": "<reason>" } } }`, where `<reason>` is one of
`required` (missing, not a string or blank), `too-long` or `taken`.

## GET /api/projects and GET /api/projects/{projectId}

Exist already. A rename changes what both answer: the project's `name` is the stored one, and the list is ordered by name,
ignoring case.
