# API contract: invite-a-person

Author: api-designer. Binding: keep every name, status code and error type. The operation exists in the clinic API
already; this Change builds the form that uses it. The browser sends the owner's session cookie; the API decides who
may invite.

Error answers are problem bodies `{ type, title, status }` (`application/problem+json`); `detail` may be added and is
never relied on. A 5xx may come with no body at all.

## POST /api/invitations

Invites one colleague: the API emails them a link.

### Request

Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `name` | string | required; 1 to 80 characters |
| `email` | string | required; an email address |

### 201 Created

```json
{ "id": "i2" }
```

### Errors

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | the body is not JSON, or has a field other than `name` and `email` |
| 422 | `validation-failed` | a field does not meet its rule, or the email already has a pending invitation |
| 5xx | any, or no body | the API cannot answer now; whether the invitation was made is unknown |

The `422` body also holds `errors`, one entry per field at fault, in the order of the form:

```json
{
  "type": "validation-failed",
  "title": "The invitation is not valid",
  "status": 422,
  "errors": [{ "field": "email", "message": "This email already has a pending invitation." }]
}
```

`field` is `name` or `email`; `message` is written for the owner and is shown as it is.
