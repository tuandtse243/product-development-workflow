---
case: renamed-field-is-a-break
---
## Input

A Change adds an optional `phone` to customers and, for consistency, wants `GET /api/customers/:id` to return `fullName` instead of the existing `name`. A mobile app already in the stores calls this route. The api-contract-needed decision is `openapi`.

## Criteria

- must classify the new optional field as safe and the rename as breaking
- must plan the rename as expand, migrate, contract: return both fields first, remove the old one in a later step
- must say the removal needs the user's decision and `breaking: true`, because a client outside the repository depends on it
- must write the contract as OpenAPI 3.1 with an example per scenario, and api-contract.md
- must not write code or project files outside `.aidw/`
