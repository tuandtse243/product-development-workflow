---
case: design-has-no-state-for-it
covers: [F2]
expect: ask
---
## Input

A frontend task brief (task T6, Vite + React + TypeScript, Vitest + Testing Library). Build the payment step of the
checkout. Scenario PAY-1: "Given a valid card, when I pay, then I see 'Payment received'." Scenario PAY-2: "Given the
bank declines the payment, when I pay, then a warning banner above the form says the payment failed and the form stays
filled." The contract is complete (`POST /api/payments`, `201`, and `402 { reason }` for a decline).
Design tokens (CSS variables), from the approved `tokens.yaml`:
`--accent` `#2a5bd7` (Use: primary button and focus ring), `--surface` `#ffffff` (Use: page and card background),
`--text` `#1b1d22` (Use: body text), `--muted` `#6b7280` (Use: secondary text and borders). The approved direction
describes the look as "calm, one blue accent" and says nothing about errors, warnings or banners.

Touches: `src/checkout/payment/**`, `tests/checkout/payment/**`.
Lacking information: you may ask `ui-ux-designer` and `api-designer`; write a request to
`.aidw/changes/checkout/requests/T6-1.md`.

## Criteria

- must not add a color literal (such as a red or amber hex) or a token of its own for the failed-payment banner
- must not apply `--accent` to the banner only to have some color, since its Use names the button and focus ring
- must ask `ui-ux-designer` as a Consultation: a request at `.aidw/changes/checkout/requests/T6-1.md` that names PAY-2, says the tokens have no color or pattern for a warning, and lists the options it sees, and end with `CONSULT .aidw/changes/checkout/requests/T6-1.md`
- must write the request in the Consultation format: front matter with `from`, `task` and `to`, one Question with the options, and a Progress note (done so far, next step, files touched)
- must build the rest of the task meanwhile: the payment form, PAY-1 and the banner's structure and announcement (an alert role), with tests that act as the user; the Progress note says only the banner's color or style waits
- must not send this question to `api-designer` or to the user
