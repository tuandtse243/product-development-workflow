---
case: one-shape-not-two
covers: [X2, library/contract-tests, library/resilient-integration]
---
## Input

A fullstack task brief (task T6, Vite + React 19 + TypeScript client in `web/`, Express 5 + PGlite server in `server/`,
zod in both, Vitest, MSW forwarding `/api/*` to the app in client tests). Build "Invite a member". Scenario
`team/invite/invite-works`: "Given I am an admin, when I send an invite to a valid email with a name of at most 80
characters, then the invite is stored, the invitee gets an email, and the dialog closes." Scenario
`team/invite/invite-retried`: "Given the browser repeats the same request after a timeout, when the server receives it
twice, then one invite exists and one email was sent." The contract: `POST /api/invites` with the header
`Idempotency-Key` and body `{ email, name }`; `201 { id, email, name, expiresAt }`, or `422` with field errors. A repeat
with the same key returns the first answer. Mail goes out through the provider's HTTP API (`MAIL_API_KEY` is in
`.env.example`); there is no mail code in the project yet.

The form needs the rules (`email` valid, `name` 1 to 80 characters) to refuse a bad input before any request, and the
server needs the same rules. The existing file the brief points at:

```
// server/src/lib/invites.ts   (today: the only place the invite rules are written)
import { db } from "../db/client"
import { z } from "zod"
export const inviteInput = z.object({ email: z.string().email(), name: z.string().min(1).max(80) })
export const insertInvite = (i: z.infer<typeof inviteInput>) => db.insert(invites).values(i).returning()
```

Touches: `web/src/invites/**`, `server/src/invites/**`, `server/src/lib/invites.ts`, `shared/**`, `web/tests/**`,
`server/tests/**`. Verify: `pnpm test`.

## Criteria

- must write the invite rules once, in a module under `shared/` (or equivalent) that both the form and the route import, with a runtime check; must not write the 80-character limit and the email rule a second time in the client
- must keep the shared module free of the database client: must not import `lib/invites.ts` (which imports `db/client`) from a client file, and must move the rules out of it (the server file imports the shared one)
- must have a test that both halves run against the same shape (an 81-character name is refused by the form before any request and by the route with the same limit, or one contract test that feeds the shared example payloads to both)
- must send the email through an interface of its own with a timeout and a fake in tests, must read `MAIL_API_KEY` by name on the server only and not put it in client code or a test, and must not call the real provider in a test
- must make the retried request safe: the same `Idempotency-Key` returns the first answer and sends one email, with a test that sends the request twice with one key and counts one stored invite and one email; must not generate a new key per try
- must not send this question to `api-designer` or the user: the contract names everything the task needs
