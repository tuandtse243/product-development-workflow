---
name: rule-and-edge-elicitation
description: The second stage of the discovery interview - find the business rules behind each behavior and the edge and failure paths, by asking for examples.
---

# Finding the rules and the edges

The Product Manager's stage settled what the user is trying to get done. Yours finds what exactly happens, and it
ends when every behavior has its rules and each rule has examples. Read the recorded answers first and never ask
again what is already answered.

## One behavior at a time

1. **Say the behavior back** in one sentence and get a yes.
2. **Ask for the rule.** "What decides whether this is allowed? What decides the result?" Write each rule as one
   plain sentence. A behavior with more than five rules is two behaviors.
3. **Ask the user for an example of each rule**, with real values: one where it applies, one where it is refused.
   "A patient cancels 25 hours before: allowed. 23 hours before: refused, and they see why." Ask outright for the
   refused case ("tell me about one that was turned down"); the user's real example often shows a rule nobody
   named. You may offer your own as a recommendation, but it does not replace theirs.
4. **Hunt the edges** with the questions below; each answer is a new example or a new rule.
5. **Park what nobody knows** as an open question with who could answer it. Never fill it in.

A round covers one behavior: its rules as choices where there are alternatives (the options being what happens, with
the refused case as the `example`), and the request for the user's own examples as open questions, all on one
Decision Page.

## Edge questions

- **Limits**: the smallest, the largest, zero, none, one too many. What happens exactly at the limit?
- **Time**: before it opens, after it closes, at midnight, in another time zone, when it expires halfway through.
- **Who**: someone without the right, someone else's record, an admin acting for a user, a deleted or blocked account.
- **Again**: the same action twice, two people at once, going back and submitting again.
- **State**: what if it is already cancelled, paid, shipped, archived? Which states can it never leave?
- **Missing things**: the related record is gone, an optional field is empty, the import has a bad row.
- **Failure**: the payment, the email or the other system does not answer. What does the user see, and what is
  left behind?
- **Undo**: can it be reversed, by whom, until when, and what happens to what depended on it?
- **Money, law, notice**: rounding, currency, tax, who must be told, what must be kept and for how long.

## Signs you are not done

A rule with no example. An example nobody can place under a rule (a rule is missing). "It depends" with no list
of what it depends on. A word used in two senses (fix the glossary first).

## Record

In `analysis.md`, discovery Q&A: for each behavior, its rules, the examples under each rule, and the open
questions. Rules that hold across behaviors go to the domain model's business rules. Each example becomes a
scenario when you draft the specs.

## Sources

Ideas, not wording: Example Mapping (Matt Wynne, Cucumber) and its rules, examples and questions; Specification
by Example (Gojko Adzic); the clarification categories of GitHub's spec-kit. Matt Pocock's `grilling` stays the
interview method.
