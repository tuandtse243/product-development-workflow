---
name: server-logs-and-errors
description: Map errors to the contract's shape in one place and write structured log lines that help an operator without leaking a secret or a whole object. Use when a task adds an entry point or an error path in a project with a logger, or asks for logs, a health check or a request id.
---

# Server logs and errors

Serves rules B6 and B14. An error has two readers: the caller, who gets the contract's shape and nothing internal,
and the operator, who gets the cause in the log. Mixing them leaks internals to the caller or leaves the operator
with "something failed". A log line has one more risk: it is copied to places with weaker access than the database.

## Steps

1. **One place maps errors to responses.** Known errors (validation, not found, conflict, not allowed) become the
   contract's status and error body; anything else becomes the contract's server error with a generic message and
   the request id. No response carries a stack trace, SQL text, a file path, a library's message or an internal id.
   When the contract has no shape for an error you need, ask its author (Consultation); do not make one up.
2. **Log each failure once, at the right level.** A `4xx` is the caller's mistake: `info`, without the stack;
   failed sign-ins and refused permissions (`401`, `403`) at `warn`, because a run of them is how an attack shows.
   A `5xx` is ours: `error`, logged once at the mapping point, not again at every layer it passed through. Log the
   cause's `message`, `code` and `stack` as fields, not the library's error object: an HTTP client's error often
   carries the request config with its headers, and so the API key.
3. **Fields, not sentences.** An event name, the outcome, the route template (`/notes/{id}`, not `/notes/8812`),
   the status, the duration, and the request or trace id the project already propagates. Values the operator
   searches by go in their own field, not inside a message string.
4. **Never log**: passwords, tokens, API keys, session ids, cookies, the authorization header, connection strings,
   payment data, and whole request bodies, user objects, config objects or clients. Log the fields you need by name
   (`userId`, not `user`). A whole object is a leak waiting for someone to add a secret to it.
5. **When to load `sentry/secret-serialization`**: when your task puts a credential on a class, model or config
   object, or adds a logger, span or error-context call that receives whole objects or every argument. Read its
   `SKILL.md` and only the reference for the project's language, and the notes beside the vendored skills.
   The status codes and error body for the close calls are in
   `aidw plugin-path roles/backend/references/status-codes.md`.
6. **Use the project's logger and write to stdout.** The app does not open, rotate or ship log files; the
   environment does. Do not add a logging library the project does not have; if the brief asks for logs and there
   is no logger, ask the architecture's author (Consultation) which to use.
7. **Test one line and one body**: capture the log output in a test, trigger a failure, assert the event name,
   level and request id are there and that a known secret value is not. Assert the error response body has only the
   contract's fields.

## Right and wrong

A failed call to the payment provider while placing an order.

Right: the caller gets the contract's shape; the log has fields an operator can search, and no secret.

```
response 502: { "type": ".../payment-unavailable", "title": "Payment is unavailable", "requestId": "r-41c" }
log error {event: "order.payment_failed", route: "/orders", status: 502, orderId: 77,
           provider: "pay", providerStatus: 503, requestId: "r-41c", durationMs: 2014,
           errMessage: err.message, errCode: err.code, errStack: err.stack}
test: provider fake returns 503 -> body has type,title,requestId only; log line has event and requestId;
      the fake API key string appears nowhere in the captured output
```

Wrong: the internals go to the caller, and the log line carries the whole request and the client with its key.

```
response 500: { "error": "Error: connect ECONNREFUSED 10.0.3.7:443 at PayClient.charge (src/pay.ts:42)" }
log("payment failed for " + JSON.stringify(req.body), payClient)   // body has the card, client has the key
log.error({ err })                     // the HTTP client's error object carries its config: headers, API key
```

## Sources

Ideas, not wording: the OWASP Logging Cheat Sheet (what to record, what never to record); the OpenTelemetry HTTP
span conventions (route template as the name, server error status only for `5xx`, headers captured only when
configured) and its logs data model (trace and span ids on a log record); Twelve-Factor "XI. Logs" (logs as an
event stream on stdout); RFC 9457 and Google AIP-193 (an error body for people and machines, with no
implementation detail); getsentry `secret-serialization` (Apache-2.0), vendored at
`library/vendor/sentry/secret-serialization/`, for leaks through serialization. Look there again when the
OpenTelemetry logging conventions are marked stable.
