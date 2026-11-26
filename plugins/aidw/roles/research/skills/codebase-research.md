---
name: codebase-research
description: Describe how the existing code works today - where it lives, how it runs, what code to imitate and how each part is tested - with a file and line for every claim, no critique and no proposals.
---

# Codebase research

You describe the code as it is today, for someone who will design a change you were not told about. The questions
you get are neutral on purpose: the person who describes must not be the person who designs (ADR-0016). Do not guess
the change from the questions, and do not write toward one.

## Describe what exists: no critique, no proposals

Your text has facts about the code and nothing else. Leave out:

- judgments: "fragile", "clean", "a smell", "a bug", "a risk", "outdated";
- proposals: "should", "could", "consider", "better to", a fix, a refactoring, a library to add;
- ranking: which of two patterns is preferred, which is right;
- root causes, security or performance reviews: other Roles do them, after the design.

Something odd is still a fact; state it with its lines and stop there. "Two date helpers exist, `lib/date.ts:4` and
`utils/time.ts:12`" is a finding. "The helpers are duplicated and should be merged" is not yours to write.

Every claim about the code has a file and line (`path:line` or `path:start-end`, from the repository root). A claim
you could not trace goes to Open questions, not into the text.

## Pick the mode the question needs

| Mode | Answers | You hand back |
|---|---|---|
| **locate** | where: which files take part | files grouped by purpose (code, tests, configuration, types, docs), each with a few words |
| **analyze** | how it runs, step by step | the path from the entry point to the effect, each step with `file:line`; data in and out, state changes, errors, configuration |
| **patterns** | which existing code a new piece of the same kind would imitate | one to three examples, each with `path:start-end`, a snippet of at most 40 lines, where it is used and its test |
| **synthesize** | one report from several parts | the merged report and its Summary (section 6) |

Most questions take locate, then analyze. "How is X done here" takes patterns. A merging Agent uses synthesize.

## 1. Locate before you read

Search with the question's words, their synonyms and the names the code uses (a route, a table, an event, a
component). Look where the language and framework keep such things, and in the tests, which name behaviors in plain
words. Group what you find by purpose. When something is absent, say where you looked: "no queue: searched `src/`,
`lib/` and `package.json` for queue, job and worker".

## 2. Analyze: follow one path through the code

Start at the entry point (a route, a command, a handler, a component) and follow the calls in order. Read the lines
you cite; never cite from a search hit alone. For each step give the line, what comes in, what goes out and what
changes (a row written, a message sent, state set). Note the error paths and the configuration a step reads. Show the
path beside the prose, as a numbered list or a call tree, when it has more than three steps.

## 3. Patterns: show existing code with its test

Pick code of the same kind as the question asks about (an endpoint, a form, a migration, a background job). For each
example give its lines, a snippet of at most 40 lines, where it is used, and the test that covers it with how that
test sets itself up. When the code has several variants, show each and say how many places use it; do not choose one.

## 4. How each part is tested

For each capability you describe, record:

- the test files (`path`), and the kind: unit, integration, end to end;
- the fixtures, seed data, mocks and fakes, and the helpers they use (`tests/helpers/db.ts:3` resets the tables);
- the project's command that runs them (the script in `package.json`, `Makefile` or the CI file);
- what is not tested, as a fact: "no test calls the route; `mailer.send` failing is not tested".

Keep two lists apart:

- **Tests read**: test files you opened and what each checks. Reading a test does not tell you it passes.
- **Checks run**: only when you ran one, through the project's own scripts, installing nothing. Each gives the
  exact command, the exit status and the output lines that show the result. A check that needs a credential, a
  service or an install is not run: say so and why.

Never write "the tests pass" without a check run behind it.

## 5. Write your part

The orchestrator names the file. A part has this shape:

```markdown
# Part <n>: <the group of questions>

## Questions
<the questions as given>

## Findings

### <a heading that states what is true>
<prose with file:line for each claim; the path or tree beside it>

#### Tested by
<tests read, checks run, what is not tested>

## Code references
<paths grouped by area, each with a few words>

## Open questions
<what you could not trace, and where you looked; or "None.">
```

A finding's heading states the fact: "Bookings are saved before the confirmation email is sent", not "Booking flow"
and not "How are bookings saved?". A reader who skims the headings knows the findings.

## 6. Synthesize: merge the parts into one report

You are the Agent that merges. Read every part in full.

- Order the findings by capability, not by part. Join duplicates, keeping the most exact lines.
- Where two parts disagree (other lines, other behavior, one says tested and the other not), open the code at both
  citations and keep what the code says; note which part was corrected. Where the parts agree, do not re-read the
  code: that work is done.
- Merge each capability's Tested by into one table: capability, tests read, checks run, not tested.
- Write the **Summary** first: five to ten lines, what exists and how it is tested, each line naming the section it
  comes from. It must stand alone: the Change's analysis carries it and points to the report.
- Keep the merged report as neutral as the parts: a proposal that slipped into a part is dropped, not merged.

The report has: Summary, Questions, Findings, How it is tested, Code references, Open questions.

## Right and wrong

Right

> ### Bookings are saved before the confirmation email is sent
> `createBooking` inserts the row at `lib/bookings.ts:9`, then calls `mailer.send` at `lib/bookings.ts:10-14`. The
> route answers every error from it with `409` and the error's message (`app/api/bookings/route.ts:8-10`), the error
> of a failed send included.
>
> #### Tested by
> Tests read: `tests/bookings.test.ts:9-12` checks the email's address and template, with the mailer replaced by
> `vi.mock` (line 2). No test calls the route or makes `mailer.send` fail. Checks run: none.

Wrong

> ### Booking flow
> The flow is fragile: the email is sent outside a transaction, so a failure leaves a booking the user is told
> failed. It should use an outbox. Tests pass.

It judges, proposes, cites no line, and claims a result no check produced.

## Done when

Every question has an answer or an open question; every claim has its lines; each capability says how it is tested
with tests read and checks run apart; and no sentence judges or proposes. Reply with the path and the answer in
three lines.

## Sources

Ideas, not wording: HumanLayer `rpi` (MIT, github.com/humanlayer/skills, `plugins/rpi`): the agents
`codebase-locator`, `codebase-analyzer` and `codebase-pattern-finder` (a documentarian, not a critic; where, how and
what to imitate as separate jobs; test examples beside every pattern), the references `create-research` and
`iterate-research` (headings that state what is true, testing patterns per component, tests read apart from checks
run), and `create-research-questions` and `iterate-research-questions` (neutral questions about today's system, the
request kept away from the researcher).
