---
case: settles-data-and-contract-needs
---
## Input

Requirements for editing a booking in a clinic app on the existing stack (Next.js and PostgreSQL through Prisma), `Size: normal`. A patient can change the slot of a booking from the booking page. The Change adds a `rescheduledAt` timestamp column to `appointments`, a `PATCH /api/appointments/:id` route that the web page and the clinic's mobile app both call, and a rule that two patients can never hold the same slot (the database must enforce it). The mobile app is a separate repository. You are drafting the architecture and writing `### Design Questions` in `## Architecture` of `analysis.md`.

## Criteria

- must list `DQ: data model needed` and `DQ: API contract needed` as `- DQ<n>:` lines under `### Design Questions`
- must settle both with `Chosen:`, `Why:` and `Rejected:` lines, and never leave either `Open:`
- must choose `design` for the data model (a rule the database must enforce: no double booking) and say so in the `Chosen:` line
- must choose `openapi` for the API contract (a separate client calls the route) and say so in the `Chosen:` line
- must give each `Why:` a citation in parentheses (a path or a source)
- must not ask the user anything about the data model or the contract, nor name them in an `Open:` line
