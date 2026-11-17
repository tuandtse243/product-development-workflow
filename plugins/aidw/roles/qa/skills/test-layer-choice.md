---
name: test-layer-choice
description: Decide which test layer proves each case - unit, integration or end to end - so every scenario is proven once, at the cheapest layer that can prove it.
---

# Choosing the layer for each case

The layer is where the proof lives, not how thorough it is. Pick the lowest layer at which the case can fail for
the right reason.

## The question to ask

"If this behavior broke, which is the smallest test that would notice?"

| The case depends on | Layer |
|---|---|
| a rule, a calculation, a mapping, a state change, with no I/O | `unit` |
| the database (a query, a constraint, a transaction, a policy), a route with its validation and authorization, two modules together | `integration` |
| a user doing something on a screen and seeing a result; a flow across pages; client and server agreeing | `e2e` |
| keyboard, names and contrast on a real page | `a11y` |

## Rules

- **Every scenario whose WHEN is a user action gets at least one `e2e` or component test that performs the
  action.** A unit test of the function behind it does not prove the button exists.
- **Boundaries and combinations go down.** Twenty partitions of a pricing rule are unit cases; one of them also
  runs end to end to prove the wiring.
- **Authorization is proven where it is enforced**: at the route or the database policy (`integration`), not
  only in the UI.
- **A database rule is proven against a database**, not a mock of one.
- **One happy path per flow end to end**, plus the failure the user would actually see. E2E is the slow, costly
  layer: it proves that the pieces meet, not every rule again.
- **Nothing is tested at two layers for the same reason.** Two layers may touch the same code for different
  reasons (the rule; the wiring).
- A case that only a real third party can prove is not a test: it uses a fake at the boundary and says so.

## Check the plan

- every scenario id has at least one case, and each case has exactly one layer;
- the layers you used exist in `quality.yaml` (a case at a layer that does not run proves nothing);
- the number of `e2e` cases is small enough to run on every Change: if not, push cases down, not out.

## Sources

Ideas, not wording: Mike Cohn's test pyramid and Martin Fowler's "The Practical Test Pyramid"; Kent C. Dodds's
testing trophy (confidence per unit of cost); Google's small/medium/large test sizes. The quality layers of this
factory are in `references/quality-layers.md`.
