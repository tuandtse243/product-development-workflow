---
name: journey-mapping
description: Turn what is known about the users into a few user kinds and a journey for each, marking what is known and what is assumed, in a fixed format the requirements and the design are checked against.
---

# Journey mapping

A journey says what a user is doing before, during and after they touch the product, so the screens are designed
for the situation and not only for the function. It is only as good as what is known: say what is assumed.

## 1. User kinds, not personas with hobbies

From the interview record, list the kinds of user whose goals or situations differ enough to need different
things. For each, only what changes the design:

- the goal (their job, in the discovery record's words);
- the situation: where, on what device, how often, under what pressure, with what interruption;
- what they know: first time or daily, expert in the domain or not;
- what limits them: accessibility needs, language, a slow connection, shared or supervised use.

No invented name, age, photo or quote. Two kinds whose rows are the same are one kind. If nothing is known about
a kind, write "unknown" and add the question to the open list.

## 2. One journey per kind and goal

Stages left to right, from the trigger to the outcome and what comes after (not from "opens the app" to "closes
the app"). For each stage:

| Stage | Doing | Needs to know or decide | Where it can go wrong | Evidence |
|---|---|---|---|---|

- **Doing**: the user's action, in their words; include what happens outside the product (finds the invoice
  number in an email).
- **Where it can go wrong**: the realistic failure, hesitation or dead end at this stage.
- **Evidence**: `stated` (the user or client said it; quote the Q&A item), `observed` (in the existing product
  or data), or `assumed`. A journey that is mostly `assumed` says so in its first line.

## 3. When two kinds conflict

When what helps one kind hurts another (speed for the daily user, guidance for the first-timer), do not average
them. State the conflict, which kind the Analysis says matters more for this Change, and how the other is still
served. If the record does not decide it, it is an open decision for the user.

## 4. What it feeds

- each stage where something can go wrong should have a requirement or a scenario: list the stages that have none;
- the `usability-requirements` skill turns the journeys into requirements a reviewer can check;
- the designer reads the journey to order the screens and decide what each must show first.

## Output: `changes/<id>/journeys.md`

`## User kinds` (the table), `## Journeys` (one table each), `## Conflicts`, `## Not covered by a requirement`,
`## Assumptions to confirm` (each with who could confirm it).

## Sources

Ideas, not wording: Nielsen Norman Group on journey maps and on personas (a persona is behaviour, not
demographics), the GOV.UK Service Manual on user needs and assumptions, Indi Young's mental models, and Alan
Cooper's goal-directed personas.
