---
name: rest-contract
description: Write the contract of a Change's new endpoints or actions before either side is built - OpenAPI 3.1 for HTTP routes, a typed action table otherwise.
---

# Writing the contract

The contract is what lets `frontend` and `backend` build at the same time. It is done when neither would have to
ask the other a question. The design rules (names, status codes, the error shape, lists, repeated writes) are in
`aidw vendor-path aidw/api-design-rules`: read it first and apply it; this skill is the procedure and the format.

## Procedure

1. **List the operations from the scenarios.** Each WHEN that crosses from client to server is an operation;
   each THEN says what it returns or changes. An operation no scenario needs is not in the contract.
2. **Read what exists**: the project's current routes, its error shape, its naming. The new part matches the old.
3. **For each operation decide**: resource and method (or action name), who may call it, the request (path,
   query, body), each success response, and each failure a client must tell apart, with its status and `type`.
4. **Define each shape once** as a named schema and reference it. A field has a type, required or optional,
   nullable or not, its format and limits, and one example value.
5. **Write the examples**: one request and response per scenario, with the scenario id. These are the test data
   both sides use.
6. **Check it** against the checklist of the design rules, then lint it (`redocly lint` or `spectral lint` when
   the project has one; otherwise parse it as YAML).

## Format: a Change with HTTP routes

`changes/<id>/openapi.yaml`, OpenAPI 3.1, only what this Change adds or changes:

- `paths` with an `operationId` per operation (the name the client function will have), `security` per
  operation, and every response a client handles, errors included;
- `components.schemas` for every shape, `components.responses` for the shared error responses (problem details);
- `examples` keyed by scenario id.

## Format: a stack without HTTP routes (server actions, RPC)

`changes/<id>/api-contract.md` carries a table instead:

| Action | Who may call | Input (name: type, limits) | Success result | Failures (code: when) | Scenario ids |
|---|---|---|---|---|---|

with the shared types written once below it, in the project's type language.

## Always: `changes/<id>/api-contract.md`

Short: what the Change adds, the decisions a reader would question (and why), what is deliberately not exposed,
and how this fits the existing API. Mark every operation that changes an existing one, and run the
`breaking-change` skill on it.

## Sources

Ideas, not wording: the OpenAPI 3.1 specification; design-first practice from the Zalando RESTful API Guidelines
and Google's AIPs; RFC 9457 for errors.
