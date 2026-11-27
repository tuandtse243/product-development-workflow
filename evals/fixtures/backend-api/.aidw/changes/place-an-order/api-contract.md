# API contract: place-an-order

Author: api-designer. Binding: keep every name, status code and error type.

## POST /api/teams/{teamId}/orders

Places an order of add-ons for a team. The caller must be signed in (`Authorization: Bearer <token>`) and be a member
of the team. Prices are the products' prices when the order is placed.

### Request

- Path: `teamId`, a UUID.
- Body (`application/json`), unknown fields refused (in the body and in each line):

| field | type | rule |
|---|---|---|
| `lines` | array | required; 1 to 20 lines |
| `lines[].productId` | string | required; a UUID |
| `lines[].quantity` | integer | required; 1 to 99 |

### 201 Created

```json
{
  "id": "5c0e...",
  "totalCents": 4500,
  "lines": [{ "productId": "a1b2...", "quantity": 3, "unitPriceCents": 1500 }],
  "createdAt": "2026-11-25T09:30:00.000Z"
}
```

Exactly these four fields, and these three in each line, in the order of the request. `totalCents` is the sum of
quantity times unit price; `createdAt` is an ISO 8601 timestamp in UTC.

### Confirmation email

Once the order is stored, the caller gets one email: to the caller's address (`users.email`), subject
`Order received`, a text that names the order id and the total. It is sent through `Mailer.send` only after the order
is committed, and never for an order that was not stored. When the provider is down the order is still placed (`201`)
and the email goes out once the provider is back. A failed send is tried again later (`outbox.next_try_at`); after 5
failed attempts the email is given up and not tried again. Sends may be repeated (a lost answer, a crash), but the
customer gets the email once.

### Errors

Problem bodies `{ type, title, status }` (`application/problem+json`), as `src/http/errors.ts` writes them; `detail`
may be added and is never relied on.

| status | type | when |
|---|---|---|
| 400 | `invalid-request` | the body is not JSON, a field has the wrong type or range, there are no lines or more than 20, or a field not listed above |
| 401 | `unauthenticated` | no session, or an expired or unknown token |
| 404 | `team-not-found` | no team has this id, the id is not a UUID, or the caller is not a member of the team: the same body in all three cases |
| 422 | `unknown-product` | a line names a product that does not exist or is not active |
| 500 | `internal-error` | anything unexpected; no detail |

Titles: `400` "The request is not valid", `401` "Sign in first", `404` "No such team", `422` "No such product",
`500` "Something went wrong".

Checks run in this order: session (401), team and membership (404), body (400), products (422).
