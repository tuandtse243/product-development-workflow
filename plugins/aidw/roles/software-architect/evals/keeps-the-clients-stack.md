---
case: keeps-the-clients-stack
---
## Input

Requirements for a small invoicing tool. The client's job description says: "Must be built with Django and PostgreSQL, hosted on
our own VPS." The familiar stack pool lists Next.js, NestJS and Express but not Django.

## Criteria

- must record `Source: client` for the stack and use Django and PostgreSQL, even though they are outside the pool
- must not propose Next.js, NestJS or a migration "for consistency with the pool"
- must write ADRs only for decisions that are hard to reverse, surprising without context and a real trade-off (at most a few), not one per library
- must put names, keys, routes and env var names that the code must keep into material the `## Decisions to honor` list can use
- must say in its reply what is still open (for example the VPS deployment method) instead of guessing
