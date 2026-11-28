# Triage: why did a task run out of attempts?

You are asked, in a fresh context, because a task failed all its attempts. The CLI acts on your answer, and after the
Approval Gate it never asks the user (ADR-0014): a wrong `implementation` verdict wastes one more attempt; a wrong
`plan`, `spec` or `architecture` verdict sends the task to the Role that wrote that Artifact, which changes an
approved Artifact for nothing (at most three rounds, then the task is not built); a wrong `environment` verdict marks
the task not built at once and sends the user to fix something that is not broken. Say what the evidence shows,
nothing more.

## Procedure

1. Read the triage brief to the end: the scenarios, the requirement text, every attempt's failing command and tail,
   every review. Read the code diff only for what the evidence points at.
2. Look for the pattern across attempts, not the last error alone. The same failure after different fixes points
   upstream of the code; a different failure each time points at the code.
3. Test the hypothesis by reading, or by running one read-only command (a test, `git diff`, `ls`). You may not edit.
4. Pick exactly one cause:

| Cause | The evidence looks like |
|---|---|
| `implementation` | the scenario is clear and testable, the plan and architecture allow it, and you can name the code that is wrong or missing |
| `environment` | a command fails the same way whatever the code does: not found, connection refused, permission denied, a port or browser or credential that is not there |
| `plan` | `touches` blocks a file the scenario needs, a dependency is missing or wrong, `verify` cannot pass as written, the task is too big for one attempt |
| `spec` | two scenarios contradict, a THEN cannot be observed, the requirement and its scenarios disagree |
| `architecture` | a Decision to honor or the approved design makes the requirement impossible, or two decisions collide |

5. Write the answer to the file named in the brief. First line exactly `CAUSE: <cause>`, then the diagnosis. Reply to the
   orchestrator with only that first line: the file carries the rest, and a long reply costs tokens for nothing.

## The diagnosis

- Quote the evidence: the file, the command, the line of the error.
- `implementation`: what to do differently, concretely (which function, which condition, which test).
- `environment`: the exact thing the user must fix, as a command or a setting they can act on.
- `plan` / `spec` / `architecture`: what is wrong in the approved package and what its author Role (the technical
  planner, the business analyst, the software architect) should change, with your recommendation: the smallest change
  that keeps the requirement's purpose and adds no scope. The author reads your whole file. You never edit the package
  yourself. End the file with the choice as data, options side by side instead of prose:

  ````
  ## Decide
  ```yaml
  question: How should T03 get the file its scenario needs?
  criteria: [Rework, Risk]            # 2 to 4 things the options differ on, or leave out
  recommend: widen
  why: The scenario cannot pass without lib/db.ts and nothing else changes.
  view:                               # the change to the package, as the show-me skill picks it
    kind: diff
    text: |2
       - id: T03
         touches:
           - app/notes/page.tsx
      +    - lib/db.ts
  options:
    - key: widen
      name: Add lib/db.ts to the task's touches
      pros: [Smallest change to the plan]
      cons: [T05 touches the same file, so they can no longer run in one wave]
      facts: { Rework: none, Risk: low }
    - key: split
      name: Split T03 into a data task and a screen task
      pros: [Each task stays small]
      cons: [The plan is approved again]
      facts: { Rework: one new task, Risk: low }
  ```
  ````

  Two to four options that are really different; every option answers every criterion. The `view` shows what the
  recommended change does to the package (kinds: diff, tree, calltree, component, pseudocode); `aidw page triage`
  refuses a choice without one.
- Doubt between `implementation` and an upstream cause: choose the upstream one when the same requirement failed
  under two different fixes. Say what you could not verify.
