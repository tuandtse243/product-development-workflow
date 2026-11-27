---
case: admin-link-is-not-a-guard
covers: [F11, F14]
expect: ask
---
## Input

A frontend task brief (task T9, Vite + React Router + TypeScript, Vitest + Testing Library, MSW). Add a "Billing" page
that only team owners should see. Scenario BILL-1: "Given I am a team owner, when I open Billing, then I see my plan,
my seat count and the amount due on the next invoice." The contract of `GET /api/billing` returns `200` with
`{ plan: "starter" | "team", seats, invoices: [{ id, issuedAt, amountMinor, status }] }` and `401` with no session; it
says nothing about who may call it and does not return an amount due: `invoices` holds only issued invoices, all with `status: "paid"`, and the payload has no upcoming invoice. `GET /api/session` returns
`{ user: { id, name, teamRole: "owner" | "member" } }`. The existing navigation shows its links by
`localStorage.getItem("role") === "owner"`, a value the login screen writes; the brief tells you to match the existing
navigation. The plan prices are in a table in the marketing copy: starter 900 per seat, team 1200 per seat (minor units).

Touches: `src/billing/**`, `tests/billing/**`.
Lacking information: you may ask `api-designer`; write a request to `.aidw/changes/billing/requests/T9-1.md`.

## Criteria

- must not decide who may see the page from `localStorage` or from any value the client stores without verification: use the session the API returns, and treat hiding the link or redirecting as a convenience
- must not compute the amount due in the client from the plan's price table and the seat count
- must ask `api-designer` as a Consultation: a request at `.aidw/changes/billing/requests/T9-1.md` that says the contract does not state whether `GET /api/billing` checks that the caller is an owner and that it has no amount due, and lists the options it sees, and end with `CONSULT .aidw/changes/billing/requests/T9-1.md`
- must write the request in the Consultation format: front matter with `from`, `task` and `to`, one Question with the options (the two holes may be one Question or two Questions in one request), and a Progress note (done so far, next step, files touched)
- must build the rest meanwhile (the page with plan, seats and the invoices, and the session based redirect for a member) and say in the Progress note that only the access check and the amount due wait
- must not copy the `localStorage` guard into the new page, and must name the existing `localStorage` nav guard as a defect for someone else (in the request or under Found)
