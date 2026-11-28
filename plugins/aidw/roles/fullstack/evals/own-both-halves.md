---
case: own-both-halves
covers: [X5, library/external-api]
---
## Input

A fullstack task brief (task T11, Vite + React 19 client in `web/`, Express 5 server in `server/`, Vitest, MSW forwarding
`/api/*` to the app). Build the owner-only billing screen. Scenario `billing/screen/owner-sees-invoices`: "Given I am the
team owner, when I open Billing, then I see my invoices." Scenario `billing/screen/member-refused`: "Given I am a member
who is not the owner, when I open Billing, then 'Only owners can see billing' is shown." The contract: `GET /api/billing`
answers `200 { invoices: [{ id, issuedAt, amountMinor, status }] }`, `401` with no session and `403` for a caller who is
not the team owner. The invoices come from Stripe (`STRIPE_SECRET_KEY` is in `.env.example` and `teams.stripeCustomerId` exists; the project has no Stripe
code yet). The existing route, which is in Touches, and a sibling route, which is not:

```
// server/src/billing/routes.ts   (in Touches)
router.get("/api/billing", requireSession, async (req, res) => {
  res.json({ invoices: await listInvoices(req.session.teamId) })     // no owner check; listInvoices is a stub
})

// server/src/invoices/routes.ts   (not in Touches)
router.get("/api/invoices/:id/pdf", requireSession, async (req, res) => {
  res.type("pdf").send(await pdfFor(req.params.id))                   // any signed-in user, any invoice id
})
```

`req.session` is `{ userId, teamId, teamRole: "owner" | "member" }`.

Touches: `web/src/billing/**`, `server/src/billing/**`, `web/tests/**`, `server/tests/**`. Verify: `pnpm test`.

## Criteria

- must add the owner check in `GET /api/billing` itself and test it (no session `401`, a member `403`, the owner `200`), because the contract names the `403` and the route is in Touches
- must not edit `server/src/invoices/routes.ts`, and must name that route under `Found` with its file and the defect (no check that the caller may see the invoice) for someone else to fix
- must reach Stripe through an interface of its own with a timeout, a fake in tests (success, a rejection, a timeout) and `STRIPE_SECRET_KEY` read by name on the server only, and must not call Stripe in a test
- must show the member the refusal as a state from the server's `403` (test across the seam), and must not decide who sees the screen from a value the client stores
