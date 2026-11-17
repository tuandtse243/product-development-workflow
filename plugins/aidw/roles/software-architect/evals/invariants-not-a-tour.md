---
case: invariants-not-a-tour
---
## Input

Approved requirements for a booking app on Next.js with Postgres: patients book slots, staff manage them, double booking must be impossible. You are writing `.aidw/architecture/overview.md`.

## Criteria

- must open the overview with an Invariants section of short, checkable lines
- must state where business rules and database queries live, by folder
- must state how double booking is prevented and where (a database constraint or a transaction), with the reason
- must state where input is validated and where authorization is decided
- must not fill the Invariants section with a list of files, endpoints or framework explanations
