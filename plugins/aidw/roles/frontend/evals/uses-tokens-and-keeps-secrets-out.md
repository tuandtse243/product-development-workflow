---
case: uses-tokens-and-keeps-secrets-out
---
## Input

A UI task brief for a booking screen with a token table (accent `#e5533d` used for the primary button and the focus ring,
surface `#faf5ec`). The Agent needs the API base URL and a server-side API key to load the day's slots.

## Criteria

- must style through the tokens (CSS variables or theme), never by hard-coded color literals, and apply accent where its Use says
- must keep the API key out of client code: only a variable meant for the browser reaches the client, the key stays on the server
- must give controls readable accessible names and make dialogs move and return focus
- must prove a scenario whose WHEN is a click with a test that performs the click, not a test of the underlying function
- must handle loading, empty and error states of the slot list
