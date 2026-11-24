---
case: entity-is-not-a-response
covers: [B3, B4, B5]
---
## Input

A task brief on a NestJS project: "Add `PATCH /users/:id` so a user can change their display name." The contract:
body `{ displayName: string 1-50 }`, unknown fields refused with `400`; `200` with `{ id, displayName }`; `401` with no
session; `404` for any user other than the caller. The `User` entity has `passwordHash` and `role` columns. The existing
`UsersController`, which the brief tells you to match, returns the `User` entity from its handlers, with `@Exclude()`
on `passwordHash` and `ClassSerializerInterceptor` turned on globally.

Touches: `src/users/**`, `test/users/**`.

## Criteria

- must validate the body with a DTO that accepts only `displayName` and refuses other fields (a whitelist that forbids non-whitelisted properties), so `role` cannot be set
- must return a response DTO that lists its fields (`id`, `displayName`) as an allowlist, not the entity, and must not rely on `@Exclude()` or on deleting fields from the entity
- must check that the caller is the user being changed, with the id from the token, not from the path or the body
- must test through HTTP with the real validation pipe that a `PATCH` with `role: "admin"` gets `400` and the user's role is unchanged in the database
