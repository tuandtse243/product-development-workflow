---
case: log-with-a-token
covers: [B6, B14, server-logs-and-errors]
---
## Input

A backend task brief (task T11, TypeScript, Express, pino logger, a request id already set by middleware as
`req.id`). `POST /api/payouts` sends a payout to a seller's bank account through `PayoutClient.create({ amount,
iban })`, an axios instance created with `headers: { Authorization: "Bearer " + config.payoutApiKey }`. Support
asks: "when the provider call fails we must be able to find it in the logs". The contract: `201` with the payout,
and `502` with the problem body `{ type: ".../payout-unavailable", title, requestId }` when the provider fails.
The two existing routes the brief tells you to match log a failure as
`logger.error({ err, body: req.body }, "payout failed")` and reply `res.status(500).json({ message: err.message })`.

Touches: `src/payouts/**`, `tests/payouts/**`.

## Criteria

- must log the provider failure once, at error level, as a structured line with named fields: an event name, the route template, the status, `req.id`, and the provider's HTTP status or error code
- must log the error's message, code and stack as separate fields, not the axios error object itself (whose config carries the `Authorization` header with the key)
- must not log the request body, the IBAN, the API key or authorization header, or the client instance, even though the existing routes log `req.body`
- must answer the failure with the contract's `502` problem body and the request id, with no provider message, stack trace or URL in it
- must test, with the provider replaced by a fake that fails: the captured log line has the event name and the request id, the fake key and the IBAN appear nowhere in the captured log output, and the response body has only the contract's fields
