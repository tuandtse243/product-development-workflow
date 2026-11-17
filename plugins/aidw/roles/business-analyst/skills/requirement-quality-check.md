---
name: requirement-quality-check
description: Before the specs leave your hands, scan each requirement for ambiguity and rewrite it in a form with one reading, using the EARS patterns.
---

# Requirement quality check

A requirement that two people read differently will be built one way and reviewed the other. Run this over every
requirement after drafting and before `aidw validate`.

## Write each requirement in one of five shapes (EARS)

| Kind | Shape |
|---|---|
| Always true | The system SHALL <response>. |
| On an event | WHEN <trigger>, the system SHALL <response>. |
| While a state holds | WHILE <state>, the system SHALL <response>. |
| Unwanted case | IF <condition>, THEN the system SHALL <response>. |
| Only with a feature or role | WHERE <feature or role applies>, the system SHALL <response>. |

They combine in this order: WHERE, WHILE, WHEN, IF/THEN, SHALL. One SHALL per requirement; "and" between two
responses usually means two requirements. The delta-spec grammar (`delta-spec` skill) is the file format; this is
how the sentence inside it reads.

## Scan for words with more than one reading

- **Vague quality**: fast, easy, secure, user-friendly, robust, appropriate, as needed. Replace with a number, a
  named standard, or an observable result; or delete it.
- **Open lists**: etc., and so on, such as, including. Close the list or say what decides membership.
- **Weak verbs**: support, handle, manage, process, allow. Say what the system does and what the user sees.
- **Unclear who**: "the user" when there are several roles; "admin" when there are kinds of admin.
- **Unclear when**: immediately, soon, periodically, after a while. Give the event or the time.
- **Unclear which**: it, this, they, the record, when two things are in scope.
- **Hidden options**: may, can, should, optionally, if possible. Either it SHALL or it is not a requirement.
- **Passive with no actor**: "the order is cancelled". By whom, or by what rule?
- **Negatives without the positive**: "must not show X" without saying what is shown instead.
- **Unbounded**: all, any, every, never, with no limit stated. Is there really no limit?

## Check each requirement against its scenarios

- every condition in the requirement appears in some scenario's WHEN, and every outcome in some THEN;
- every THEN is something a test can observe (a response, a stored value, a text), not an internal step;
- the unwanted case named by an IF has its own scenario;
- no scenario tests something the requirement text does not say.

## What you may not do

Do not resolve an ambiguity by picking the reading you prefer. If the interview record does not decide it, it is
an open question for the user: list it in your reply and leave a clearly marked assumption in the Analysis.

A rewrite makes a requirement precise; it never makes it bigger. Every SHALL and every THEN must trace to a line of
the interview record or the request. The scan above will tempt you to fill gaps; each of these is a question, not
a requirement, when the record is silent:

- the other side of a recorded limit: the record says "up to 200 MB", not what happens to a 300 MB file;
- an actor or a precondition: "a signed-in user" when the record only says "the user";
- a screen, a list, a status or a message the record never mentions, added to give a THEN something to observe;
- a count or a timing: "exactly one email", "within 5 minutes".

When an unwanted case (IF) has no recorded response, do not write that requirement; ask for the response.

## Sources

Ideas, not wording: EARS, the Easy Approach to Requirements Syntax (Alistair Mavin, Rolls-Royce); the EARS
guidance of gotalab/cc-sdd; the ambiguity taxonomy of GitHub's spec-kit `clarify`; the quality characteristics of
ISO/IEC/IEEE 29148.
