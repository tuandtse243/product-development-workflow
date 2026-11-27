# API contract: pay-an-invoice

Author: api-designer. Binding: keep every name, status code and error type.

## POST /api/invoices/{invoiceId}/payments

Charges the team's saved card for an invoice of the team, in full or in part. The caller must be signed in
(`Authorization: Bearer <token>`) and be a member of the invoice's team. The card is charged once per payment the client
asks for: the client sends an `Idempotency-Key` with each payment and sends the same key again when it retries.

### Request

- Path: `invoiceId`, a UUID.
- Header `Idempotency-Key`: required; 1 to 255 visible ASCII characters (no spaces); a new value for each payment the
  client means to make, the same value when it sends that payment again.
- Body (`application/json`), unknown fields refused:

| field | type | rule |
|---|---|---|
| `amount` | integer | required; the amount to charge in cents, 1 to 10000000 |

The same request is the same invoice and the same body.

### 201 Created

```json
{ "id": "8f1c...", "invoiceId": "5c0e...", "amount": 2500, "currency": "EUR", "state": "charged", "createdAt": "2026-11-25T09:30:00.000Z" }
```

Exactly these six fields. `currency` is the invoice's; `createdAt` is an ISO 8601 timestamp in UTC.

### Sending a request again

Keys belong to the caller: two callers may use the same key, each for a payment of their own.

| the caller's key was used before for | answer |
|---|---|
| the same request, which finished with `201` or `402` | the first answer again, the same status and body; nothing is charged |
| the same request, which is still running | `409 request-in-progress` |
| the same request, which ended with `502` | the request runs again; the card is charged at most once in all |
| another request (another invoice or another body) | `422 idempotency-key-reused`; nothing is charged |

A request refused with `400`, `401` or `404` stores nothing, so the client may send it again, corrected, with the same
key. A key whose request has been running for more than 2 minutes (the server stopped while charging) is taken over by
the next request with that key, which completes the payment without charging the card a second time. Keys are kept 24
hours.

### Errors

Problem bodies `{ type, title, status }` (`application/problem+json`), as `src/http/errors.ts` writes them; `detail`
may be added and is never relied on.

| status | type | when |
|---|---|---|
| 400 | `idempotency-key-missing` | no `Idempotency-Key` header, or one that is empty, longer than 255 characters or not visible ASCII |
| 400 | `invalid-request` | the body is not JSON, `amount` is missing, not an integer or out of range, or the body has a field not listed above |
| 401 | `unauthenticated` | no session, or an expired or unknown token |
| 402 | `payment-declined` | the provider declined the card; the payment is kept as declined |
| 404 | `invoice-not-found` | no invoice has this id, the id is not a UUID, or the caller is not a member of the invoice's team: the same body in all three cases |
| 409 | `request-in-progress` | the caller's request with this key has not finished yet |
| 422 | `idempotency-key-reused` | the caller used this key for another request |
| 502 | `payment-provider-unavailable` | the provider did not answer (`GatewayError` `unavailable`): the card may or may not have been charged; send the same request again with the same key |
| 500 | `internal-error` | anything unexpected; no detail |

Titles: `idempotency-key-missing` "Send an Idempotency-Key", `invalid-request` "The request is not valid",
`unauthenticated` "Sign in first", `payment-declined` "The card was declined", `invoice-not-found` "No such invoice",
`request-in-progress` "A request with this key is still running", `idempotency-key-reused` "This key was used for
another request", `payment-provider-unavailable` "The payment provider did not answer", `internal-error` "Something
went wrong".

Checks run in this order: session (401), invoice and membership (404), the `Idempotency-Key` header (400), body (400),
then the key (422, 409, or the first answer again).
