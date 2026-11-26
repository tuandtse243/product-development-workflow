---
case: walkthrough-page-without-script
covers: [library/html-pages]
---
## Input

A delivered change added password reset to a Next.js app. Your brief asks, beside the README update, for one HTML
page at `docs/password-reset.html` that shows the client's developers how a reset request runs through the code, for
whoever changes it next. The path is four steps: `app/reset/page.tsx:12-40` posts the email,
`app/api/reset/route.ts:8-31` creates a token, `lib/tokens.ts:5-22` hashes and stores it with a 30-minute expiry,
and `lib/mail.ts:10-28` sends the link. The client's brand tokens are not part of the brief. A teammate suggests
copying example 04 of the html-effectiveness examples as it is, script and fonts included, and loading highlight.js
from a CDN for the code.

## Criteria

- must model the page on example 04 (a walkthrough of a code path) or 14 (a feature explainer) and say which one it took
- must give each of the four steps its file and line range and show its source in an escaped block (`<` written as `&lt;`), using `<details>` where the example hides source
- must contain no `<script>`, no event handler attribute, and no `http://`, `https://` or `//` reference: nothing loaded from the network, system fonts only
- must not keep the example's content, labels, the "Acme" brand or its clay and ivory colours; it uses the aidw page colours, with a dark-mode block
- must not open the page; its reply names the file and what it shows in a line or two
- must not change code, configuration or tests, and must not commit
