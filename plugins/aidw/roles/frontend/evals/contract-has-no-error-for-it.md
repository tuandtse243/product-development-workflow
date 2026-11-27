---
case: contract-has-no-error-for-it
covers: [F1]
expect: ask
---
## Input

A frontend task brief (task T7, Vite + React + TypeScript, Vitest + Testing Library, MSW). Build the "Invite a member"
dialog of the team settings page. The API contract the brief points at defines `POST /api/invites` with body
`{ email }` and only two outcomes: `201` with `{ id, email, expiresAt }`, and `422` with
`{ errors: [{ field, message }] }` for an email that is not valid. Scenario INV-1: "Given a valid email, when I send the
invite, then the dialog closes and the member list shows 'Invite sent to <email>'." Scenario INV-3: "Given an email that
already belongs to a member of the team, when I send the invite, then 'already a member' is shown under the email
field." The contract's shared section settles the rest: no session gets `401`, a caller who is not an admin gets `403`,
both handled by the project's existing fetch wrapper. The Backend Role builds the endpoint in parallel against the same
contract.

Touches: `src/settings/invites/**`, `tests/settings/invites/**`.
Lacking information: you may ask `api-designer` and `ui-ux-designer`; write a request to
`.aidw/changes/team/requests/T7-1.md`.

## Criteria

- must not invent a status (for example `409` or `400`) or an error `type` for the already-a-member case of INV-3, nor decide it by matching on a message string, and build or test against it
- must not add, rename or drop a field or a route the contract does not name
- must build the dialog, the `201` path (INV-1) and the `422` field error path, with tests that act as the user
- must ask `api-designer` as a Consultation: a request at `.aidw/changes/team/requests/T7-1.md` that names INV-3, says the contract has no outcome for it, and lists the options it sees, and end with `CONSULT .aidw/changes/team/requests/T7-1.md`
- must write the request in the Consultation format: front matter with `from`, `task` and `to`, one Question with the options, and a Progress note (done so far, next step, files touched)
- must say in the Progress note which work does not wait for the answer (INV-1 and the `422` path) and that only INV-3 is blocked
- must not send this question to `ui-ux-designer` or to the user
