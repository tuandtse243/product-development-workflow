---
name: breaking-change
description: Decide whether a change to an existing endpoint or action breaks its clients, and plan the change so nothing breaks at the moment it ships.
---

# Changing a contract that is in use

Before changing an operation that already exists, find out who calls it and decide whether they keep working
untouched. If not, it is a breaking change and is never shipped as a plain edit.

## 1. Who depends on it

Search the code for callers (the client functions, other services, tests, documentation examples). Ask, through
the Analysis, whether anything outside this repository calls it: a mobile app in the stores, a partner, a webhook
consumer. An unknown caller counts as a caller.

## 2. Is it breaking

**Safe** (old clients keep working): a new operation; a new optional request field; a new response field; a new
optional query filter; a wider accepted range; a new value in an enumeration the clients were told to tolerate.

**Breaking**: removing or renaming an operation, a field or a parameter; changing a type or a format; making an
optional request field required; making a response field optional or nullable that was not; narrowing accepted
values; a new enumeration value in a response when clients switch on it; a different status code or error
`type`; a different default, sort order or page size; new required authentication or a narrower permission.

When in doubt it is breaking. With an OpenAPI file, `oasdiff breaking <old> <new>` lists what a machine can see;
defaults, ordering and meaning it cannot.

## 3. Plan it without a break (expand, migrate, contract)

1. **Expand**: add the new thing beside the old (a new field, a new operation, or a new version). Both work.
2. **Migrate**: move each caller you own to the new one. Mark the old one deprecated in the contract, and in
   responses with the `Deprecation` header (RFC 9745) and, when there is a removal date, `Sunset` (RFC 8594).
3. **Contract**: remove the old one in a later Change, after the callers are gone and the date has passed.

Each step is its own task, and the last is usually its own Change. The Technical Planner needs them as separate,
ordered tasks: say so in `api-contract.md`.

## 4. When a break cannot be avoided

Say it at the Approval Gate: what breaks, for whom, and what they must do. The task carries `breaking: true`, so
its commit is marked and the pull request lists it. A break is the user's decision, never yours.

## Sources

Ideas, not wording: the oasdiff breaking-change rules; Google AIP-180 (backwards compatibility) and AIP-181/185
(stability and versioning); the Azure REST API Guidelines on versioning; RFC 9745 (Deprecation header) and
RFC 8594 (Sunset header); Stripe's account of API versioning.
