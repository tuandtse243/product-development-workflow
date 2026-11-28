# API contract: owner-only-billing

Author: api-designer. Binding: keep every name, status code and error code. The browser sends the `sid` cookie of a signed-in
user; signing in is not part of this Change.

Every error answer has the body `{ "error": { "code", "message"?, "fields"? } }` (`shared/errors.ts`). `message` is for people
and is never relied on.

## GET /api/billing

The invoices of the teams the caller owns. Only an owner of a team may read them.

### Request

No parameters.

### 200 OK

```json
{ "items": [ { "id": "7d1c...", "teamId": "a41f...", "number": "INV-2026-002", "amountCents": 4900, "status": "open", "issuedAt": "2026-02-05T00:00:00.000Z" } ] }
```

`items` holds the invoices of every team the caller is an owner of, newest first. An invoice of a team the caller only
belongs to as a member is never in it.

### Errors

The checks run in this order: session, then owner.

| status | code | when |
|---|---|---|
| 401 | `unauthenticated` | no session, or an expired or unknown one |
| 403 | `forbidden` | the caller is not an owner of any team: a member, or in no team at all. No invoice is in the answer |
| 500 | `internal-error` | anything unexpected; no detail |
