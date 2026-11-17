---
name: test-case-derivation
description: Turn each spec scenario into concrete test cases - the data, the steps and the expected result - including the boundaries and the negative cases the scenario implies.
---

# Deriving test cases from scenarios

A scenario says one thing that must be true. A test plan says which inputs prove it and which inputs would break
it. Work one requirement at a time.

## For each scenario

1. **The case the scenario states.** Concrete values, not "a valid user": name the role, the record, the amounts.
   Expected result in terms a test can assert (a status, a row, a text on the screen).
2. **Partitions.** For every input in the WHEN, split its values into groups the system treats alike (valid,
   empty, too long, wrong type, not allowed, already used). One case per group is enough.
3. **Boundaries.** For every limit in the requirement text (a count, a length, a date, an amount, a time window):
   the value at the limit, one inside, one outside. "More than 24 hours before" gives 24h00m01s, 24h exactly, 23h59m.
4. **Rules that combine.** When the outcome depends on several conditions (role x state x ownership), write the
   table of combinations and keep the rows whose outcome differs. Do not test all of them when a rule makes a
   whole column irrelevant.
5. **State.** If the thing has a lifecycle (draft, published, cancelled), one case per transition the spec
   allows and one for a transition it forbids.
6. **Negative and failure.** Not signed in, signed in as someone else, the record is gone, the same request twice,
   two users at once, the dependency is down. Take only those the requirement or the business rules make relevant.

## What to leave out

- A case no requirement asks for. If it matters, it is a missing requirement: report it, do not invent the answer.
- Ten cases from one partition. They cost time and prove one thing.
- Anything about how the code is built. A case is written from the spec and survives a rewrite.

## Format (`test-plan.md`, one table per requirement)

| Scenario id | Case | Given (data and state) | When | Then (what the test asserts) | Layer |
|---|---|---|---|---|---|

The scenario id is the spec's, verbatim: implementers put it in the test name and the checkpoint looks for it. A
case that belongs to no scenario gets the id of the nearest one and the word `(edge)`.

## Sources

Ideas, not wording: equivalence partitioning, boundary value analysis, decision tables and state transition
testing as taught in the ISTQB foundation syllabus and Lee Copeland's *A Practitioner's Guide to Software Test
Design*; Example Mapping (Matt Wynne) for turning a rule into examples.
