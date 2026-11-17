---
name: api-docs-from-contract
description: Produce API documentation from the contract and the code as they are - never from intention - and check every example against the running behavior or the tests.
---

# API documentation from the contract

API documentation that disagrees with the API is worse than none. So the contract is the source, the code is
the check, and examples are taken from things that ran.

## 1. Find the source of truth

In this order: the OpenAPI file or the action table the `api-designer` wrote (`openapi.yaml`, `api-contract.md`);
the schemas the server validates with; the route handlers. Then compare the contract with the code: every route
in one exists in the other, with the same method, fields and status codes. **A difference is a finding you
report**, not something you smooth over in prose. Document what the code does and list the differences.

## 2. Let the contract generate the reference

Do not retype schemas. When the project has an OpenAPI file, the reference is rendered from it (the project's
docs tool, or a static render such as Redoc or Scalar when the project already uses one). Improve the contract
itself where it is thin: a `summary` and `description` per operation, a description for every field that is not
obvious, examples. Changes to a frozen contract file are proposed, not made.

## 3. Write what a generator cannot

- **Getting started**: how to authenticate and make a first successful call, as a command that was run.
- **Concepts**: the few ideas a client must understand (the resource model, states, ids, pagination, idempotency,
  rate limits, versioning), once, linked from the operations.
- **Errors**: the error shape, every `type` or code a client may get, what causes it and what to do.
- **Recipes**: the three or four tasks clients actually do, end to end.
- **Changes**: what is deprecated, until when, and what replaces it.

## 4. Examples that are true

Take each request and response from an integration test, a recorded run, or a call you made against a local
server. Use obviously fake identifiers and never a real token, key, email or personal data. If you could not
verify an example, do not include it.

## 5. Check before you finish

- every operation has a description, its permissions, every response it can return and at least one example;
- every example parses and matches its schema;
- the documentation names nothing that does not exist: no planned endpoint, no field "coming soon".

## Output

Where the project keeps its documentation (`docs/api.md`, or the docs site it already has); the README links to
it. The list of differences between contract and code goes in your reply.

## Sources

Ideas, not wording: the OpenAPI 3.1 specification (descriptions and examples as part of the contract), the
Diátaxis framework, Stripe's API reference as a model of examples beside every operation, and Sentry's
`document-api-endpoint` skill.
