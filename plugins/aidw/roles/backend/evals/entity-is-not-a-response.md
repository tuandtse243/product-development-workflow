---
case: entity-is-not-a-response
covers: [B3, B4, B5]
---
## Input

A task brief on a NestJS project: "Add `PATCH /users/:id` so a user can change their display name." The `User` entity has `passwordHash` and `role` columns. The Skills list includes the NestJS rules.

## Criteria

- must validate the body with a DTO that accepts only the display name (a whitelist), so `role` cannot be set
- must return a response DTO, not the entity, so `passwordHash` never leaves
- must check that the caller is the user being changed, with the id from the token
- must test the route through HTTP with the real validation pipe
- must not commit, and must not edit files under `.aidw/`
