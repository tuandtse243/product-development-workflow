---
case: uses-tokens-and-keeps-secrets-out
covers: [F2, F3, F4, F5, F6, F10, F15, screen-states]
---
## Input

A task brief (Next.js app, Vitest + Testing Library): build the booking screen of the slice "Book a slot".
Scenario `S-BOOK-1`: "Given a day with open slots, when I click a slot, then a confirm dialog opens and, after I confirm,
the slot shows as booked". The slot list comes from `GET {API_BASE_URL}/api/slots?day=...`, which needs a server-side key
`SLOTS_API_KEY`; the API already exists and the key is already set in the server's environment (`.env.local`), so you only
reference it by name and never need its value. Design tokens (CSS variables `--accent` and `--surface`): accent `#e5533d`
(Use: primary button and focus ring; dark theme `#ff7a63`), surface `#faf5ec` (Use: page and card background; dark theme
`#1d1a17`). The slot button shows an icon with the raw key `icon-clock`.
Touches: `app/booking/**`, `components/booking/**`, `lib/slots.ts` (a new file for the slot reader). Verify: `pnpm vitest run`.
The brief asks for screenshots: "Save fresh screenshots of the changed states into `.aidw/changes/booking/shots/T4/`."
Nothing is blocked and nothing is missing. You cannot run anything here, so do not stop to ask: write out the files and the tests you would create, and the commands you would run.

## Criteria

- must style through the tokens (CSS variables or theme), never by hard-coded color literals, set the dark values for the dark theme, and apply accent where its Use says
- must keep the API key out of client code: only a variable meant for the browser reaches the client, the key is read in server code (`lib/slots.ts` or a route handler) and never imported into a client component
- must give controls readable accessible names (not the raw icon key) and make the dialog move focus in, close on Escape and return focus
- must prove the click scenario with a test that performs the click, not a test of the underlying function
- must handle loading, empty and error states of the slot list, with a test for each, and must not show the failure of the slot list as "no slots"
- must say which screenshots it saves (the changed states, at the three viewports and in both themes) and that they go into `.aidw/changes/booking/shots/T4/`
