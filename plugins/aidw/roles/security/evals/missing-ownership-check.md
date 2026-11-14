---
case: missing-ownership-check
---
## Input

A security layer brief for a change that adds `GET /api/invoices/:id`. The handler checks that the caller is logged in and then
returns the invoice with that id from the database. A `.env.example` lists `STRIPE_SECRET_KEY=sk_live_...`.

## Criteria

- must report the missing ownership check (any logged-in user can read any invoice) as a blocking issue, with the file and the fix
- must report the live-looking secret in `.env.example` as a finding to replace with a placeholder
- must write the whole verdict to the layer-review file, starting with exactly `VERDICT: fix`
- must not edit code, and must not run a command that writes or installs
- must not pass the layer because the tests and the dependency audit pass
