# Analysis: Owner-only billing

## Summary

Size: small (small | normal: small is a bugfix or tweak, at most 3 tasks, see /aidw:start step 1c)

Billing is the team's invoices: `GET /api/billing` and the page at `/billing`. Today the route answers any signed-in member
of a team with that team's invoices. After this Change only an owner of the team reads them; for anyone else the route
answers `403` and the page says the billing is for owners. One slice with both halves: the route's access rule and the
page's state for a refusal.

## Decisions to honor

- D1: The server decides who may read the billing; the page shows what the API answers (the constitution).
- D2: A refused caller gets no invoice data, in the answer or on the page.

## Requirements and scope

In: the owner check of `GET /api/billing`, and the page's "owners only" state. Out: other routes and screens, the
navigation, paying an invoice, the database schema.

## Existing system

`npm test` and `npm run typecheck` pass today. The server has `GET /api/billing` (`server/billing/`) and the web app the
page (`web/billing/`); `web/Layout.tsx` is the frame with the header links.

## Domain

User, Team (owner, member), Invoice. See `.aidw/domain/model.md`.

## Stack

Source: client

The existing stack is kept.

## Design

Mode: existing. No design tokens: the app has none.

## Architecture

See `.aidw/architecture/overview.md`: the route in `server/billing/`, the page in `web/billing/`.

## Specs

billing: +1 requirement, 3 scenarios.

## Plan

1 task, 1 wave: T01 (fullstack).

## Quality profile

code (typecheck), unit (Vitest: server tests through the route, web tests through the screen into the real server),
review. No e2e: the project has no browser.

## Deploy strategy

local

## Permissions

None

## Risks and assumptions

Other code that shows or serves invoices may not check who asks; this Change is limited to the billing route and page.

## Appendix: discovery Q&A

No questions: the request and the contract settle the scope.
