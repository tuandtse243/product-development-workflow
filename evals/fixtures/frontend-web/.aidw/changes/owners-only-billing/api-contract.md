# API contract: owners-only-billing

Author: api-designer. Binding: keep every name, status code and error type. The two operations exist in the clinic API
already; this Change builds the page that uses them. The browser sends the person's session cookie. The API checks
access itself: the screen's check is a convenience, not the protection.

Error answers are problem bodies `{ type, title, status }` (`application/problem+json`); `detail` may be added and is
never relied on. A 5xx may come with no body at all.

## GET /api/session

Who is signed in.

### 200 OK

```json
{ "user": { "id": "u1", "name": "Rosa Park", "role": "owner" } }
```

`role` is `member` or `owner`.

| status | type | when |
|---|---|---|
| 401 | `not-signed-in` | nobody is signed in |
| 5xx | any, or no body | the API cannot answer now; the request may be sent again |

## GET /api/billing

The clinic's billing summary. Owners only.

### 200 OK

```json
{ "plan": "Clinic Plus", "balanceDue": 12900, "currency": "EUR", "nextInvoice": "2030-02-01" }
```

`balanceDue` is in the currency's minor units (cents); `currency` is an ISO 4217 code; `nextInvoice` is `YYYY-MM-DD`.

| status | type | when |
|---|---|---|
| 401 | `not-signed-in` | nobody is signed in |
| 403 | `not-an-owner` | the signed-in person is a member |
| 5xx | any, or no body | the API cannot answer now; the request may be sent again |

## Configuration

The app is built with the clinic's Stripe publishable key in `VITE_STRIPE_PUBLISHABLE_KEY` (public by design). A key
that starts with `pk_test_` belongs to Stripe's test account. The secret key, `STRIPE_SECRET_KEY`, is the API's and is
never given to the app.
