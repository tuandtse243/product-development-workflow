# API contract: invite-with-one-schema

Author: api-designer. Binding: keep every name, status code and error code. The browser sends the `sid` cookie of a signed-in
user; signing in is not part of this Change.

Every error answer has the body `{ "error": { "code", "message"?, "fields"? } }` (`shared/errors.ts`). `message` is for people
and is never relied on; a `422 validation` carries `fields` and no `message`.

## POST /api/invites

Invites a person to the caller's team. Only an owner of a team may; the invitation belongs to the team the caller owns.

### Request

- Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `name` | string | required; trimmed; 1 to 80 characters after trimming |
| `email` | string | required; trimmed; a valid email address |

The web form applies the same rules before it sends anything: a name or an email they refuse is not sent.

### 201 Created

```json
{ "id": "3b9e...", "teamId": "a41f...", "email": "dana@example.test", "name": "Dana White", "createdAt": "2026-03-02T09:30:00.000Z" }
```

`name` and `email` are what was stored: the trimmed values.

### Errors

The checks run in this order: session, owner, then the body.

| status | code | when |
|---|---|---|
| 400 | `invalid-request` | the body is not JSON or is not an object, or it has a field not listed above |
| 401 | `unauthenticated` | no session, or an expired or unknown one |
| 403 | `forbidden` | the caller is not an owner of any team: a member, or in no team at all |
| 422 | `validation` | `name` or `email` is missing, not a string, blank, or refused by its rule |
| 500 | `internal-error` | anything unexpected; no detail |

A `422` body is exactly `{ "error": { "code": "validation", "fields": { ... } } }` with one entry for each field at fault, and
`<reason>` one of: for `name`, `required` (missing, not a string or blank after trimming) or `too-long` (over 80 characters); for
`email`, `required` (missing, not a string or blank) or `invalid` (not a valid address).
