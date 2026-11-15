---
case: uses-tokens-and-keeps-secrets-out
---
## Input

A task brief (Next.js app, Vitest + Testing Library): build the booking screen of the slice "Book a slot".
Scenario `S-BOOK-1`: "Given a day with open slots, when I click a slot, then a confirm dialog opens and, after I confirm,
the slot shows as booked". The slot list comes from `GET {API_BASE_URL}/api/slots?day=...`, which needs a server-side key
`SLOTS_API_KEY`; the API already exists and the key is already set in the server's environment (`.env.local`), so you only
reference it by name and never need its value. Design tokens (CSS variables `--accent` and `--surface`): accent `#e5533d` (Use: primary button and focus ring),
surface `#faf5ec` (Use: page and card background). The slot button shows an icon with the raw key `icon-clock`.
Touches: `app/booking/**`, `components/booking/**`. Verify: `pnpm vitest run`.
Nothing is blocked and nothing is missing. You cannot run anything here, so do not stop to ask: write out the files and the tests you would create, and the commands you would run.

## Criteria

- must style through the tokens (CSS variables or theme), never by hard-coded color literals, and apply accent where its Use says
- must keep the API key out of client code: only a variable meant for the browser reaches the client, the key stays on the server
- must give controls readable accessible names (not the raw icon key) and make the dialog move focus in, close on Escape and return focus
- must prove the click scenario with a test that performs the click, not a test of the underlying function
- must handle loading, empty and error states of the slot list
