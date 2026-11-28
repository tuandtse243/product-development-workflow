---
name: discovery-frame
description: What to find out in the discovery interview, framed as the job the user is trying to get done, before any solution is discussed.
---

# Discovery frame

The grilling skill says how to ask (rounds, a recommendation per question). This says what must be known before
requirements are written. A request usually arrives as a solution ("add a dashboard"); the interview's first job
is to recover the problem behind it.

## The job, before the feature

For each kind of user the request names, get these answered, in the user's own words:

1. **Situation**: when does this come up? What has just happened, where are they, what do they have in hand?
2. **Motivation**: what are they trying to get done, and what is it for? Ask "so that what?" until the answer is
   an outcome, not a screen.
3. **Today**: how do they do it now (a spreadsheet, another tool, by hand, not at all)? What is slow, risky or
   embarrassing about that? The current workaround is the real competitor.
4. **Done**: how will they know it worked? What would they see, and how soon?

When the user is there to answer, ask all four as questions and wait for the answers: four open questions on the
first Decision Page of the interview, each with your suggested answer where you have one. A recommended answer is
welcome, but a guess about today's workaround is not an answer: "Today" in particular is asked outright, even when
you think you know it. No requirement is written in the same turn as these questions.

Write each as one line: *When* <situation>, *I want to* <motivation>, *so I can* <outcome>. If two user kinds
give different lines, they are different jobs and may be different Slices.

## What the request does not say

Ask about each; a blank is recorded as an explicit assumption, never filled in silently.

- **Who else is affected**: who sets it up, who approves, who gets the result, who is told when it fails.
- **Frequency and volume**: once a year or fifty times a day; ten records or a million. This decides how much
  design the flow deserves.
- **What must never happen**: the mistake that would cost money, data or trust.
- **What already exists**: data, accounts, an API, a design, a rule set by law or contract.
- **The smallest version that would still be used**: what could be left out and the user would still switch from
  today's way.
- **Out of scope**: say it back to the user as a list, and get a yes.

## Technical questions wait for the architect

The user answers what they need and how they work; they should not have to choose a queue or guess whether their
phone system has an API. When such a question comes up, write it as `- DA1: <question>` under
`### Deferred to architecture` (in `## Requirements and scope`) and go on. Ask the user only the part that is theirs:
"Is a five-minute delay in the reminder acceptable?" is theirs; "Should reminders go through a job queue?" is not.
The same holds for the options of a choice. If an option is a mechanism (a version column, a database trigger, an
index), the user cannot weigh it. Ask the product rule instead ("what does the second editor see when two people
edit the same booking?"), and write the mechanism as a question for the architect (a `DA` line). The size of the Change is not a question either:
set `Size: small|normal` yourself, say why in the Summary, and the user confirms it at the gate.
That split happens in the interview, with the user there; when you draft from the record, the DA line is the
question's only place. The Software Architect answers each line before the gate. An interview that raised no
technical question ends with "None" under that heading.

## Signs the interview is not done

- A requirement only makes sense if you already know the solution ("the user clicks Export").
- You cannot say what the user did before this existed.
- Success is described as shipping it, not as something the user can now do.
- Two answers conflict and nobody has chosen.

## Record

In `analysis.md` under the discovery Q&A: the job lines, one per user kind; today's workaround; the measure of
done; assumptions, each marked as assumed. The requirements quote these, so a reader can trace a scenario back to
a job.

Today's workaround becomes the `### Before` of `## Before / After`: 3 to 6 lines of what the user does, waits for or
cannot do now, in their words and in their language (the `lang` of the gate page; the headings stay as they are). When the Change has an Existing System Report (`existing-system.md`), Before draws
on it instead and names it, because the code shows what the user really meets. `### After` says, in the same
voice, what each of those lines becomes. A line that mentions a table, an endpoint or a component is written for
the wrong reader.

## Sources

Ideas, not wording: jobs to be done (Christensen; Ulwick's outcome statements), the JTBD and problem-framing
skills of deanpeters/Product-Manager-Skills and phuryn/pm-skills, and the discovery habits in Teresa Torres's
*Continuous Discovery Habits*. Matt Pocock's `grilling` stays the interview method. Keeping technical
questions out of the product interview comes from the "Deferred to TDD" list of HumanLayer's rpi plugin
(`create-prd`, MIT); the before-and-after views from its `create-design-discussion`.
