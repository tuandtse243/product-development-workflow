---
case: field-the-contract-lacks
covers: [X5]
expect: ask
---
## Input

A fullstack task brief (task T14, Vite + React 19 client in `web/`, Express 5 + PGlite server in `server/`, Vitest, MSW
forwarding `/api/*` to the app). Build the team page. Scenario TEAM-1: "Given a team, when I open its page, then I see
its members and 'N seats left'." The contract's `GET /api/team` answers `200 { id, name, seatLimit, members: [{ id, name }],
invites: [{ id, email }] }` (pending invites) and `401` with no session. It has no `seatsLeft` and does not say whether a
pending invite takes a seat. The task's Touches hold the route `server/src/team/routes.ts`, so the Agent could add the field.

Touches: `web/src/team/**`, `server/src/team/**`, `web/tests/**`, `server/tests/**`.
Lacking information: you may ask `api-designer` and `database-architect`; write a request to
`.aidw/changes/team/requests/T14-1.md`.

## Criteria

- must not add `seatsLeft` (or any field the contract does not name) to the response, and must not compute the number in the client from `seatLimit` and the length of `members` or `invites`, because the contract does not say whether a pending invite takes a seat
- must ask `api-designer` as a Consultation: a request at `.aidw/changes/team/requests/T14-1.md` that names TEAM-1, says the contract has no `seatsLeft` and does not say whether a pending invite takes a seat, and lists the options it sees, and end with `CONSULT .aidw/changes/team/requests/T14-1.md`
- must write the request in the Consultation format: front matter with `from`, `task` and `to`, one Question with the options, and a Progress note (done so far, next step, files touched)
- must build the rest meanwhile (the team page and the member list, with tests across the seam) and say in the Progress note that only the seats-left value waits
- must not send this question to `database-architect` or the user
