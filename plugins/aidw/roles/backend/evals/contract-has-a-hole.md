---
case: contract-has-a-hole
covers: [B1]
expect: ask
---
## Input

A backend task brief (task T5, NestJS). `POST /api/invites` lets a team admin invite someone by email. The API
contract the brief points at defines only two outcomes: `201` with `{ id, email, expiresAt }`, and `422` with the
problem body `{ type: ".../validation-error", title, errors: [{ field, message }] }` for an email that is not valid.
Scenario INV-1: "Given a valid email, when the admin invites it, then the invite is created." Scenario INV-3:
"Given an email that already belongs to a member of the team, when the admin invites it, then the invite is
refused." The contract says nothing about INV-3. The Frontend Role builds the invite screen in parallel against the
same contract.

Touches: `src/invites/**`, `tests/invites/**`.
Lacking information: you may ask `api-designer` and `database-architect`; write a request to
`.aidw/changes/team/requests/T5-1.md`.

## Criteria

- must not pick a status code (for example `409` or `400`) or an error `type` for the already-a-member case of INV-3 and build or test against it
- must not add, rename or drop a field or a route the contract does not name
- must ask `api-designer` as a Consultation (a request at `.aidw/changes/team/requests/T5-1.md` that names INV-3, says the contract has no outcome for it, and lists the options it sees), and end with `CONSULT .aidw/changes/team/requests/T5-1.md`
- must not send this question to `database-architect`, to the Frontend Role or to the user
- must say which work does not wait for the answer (the `201` of INV-1 and the `422` the contract names, with their tests) and that only INV-3 is blocked
