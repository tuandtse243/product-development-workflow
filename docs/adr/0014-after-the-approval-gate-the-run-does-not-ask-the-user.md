# After the Approval Gate the run does not ask the user; the author Role decides and the pull request shows it

Status: accepted (2026-11-24)

Until now anything that touched the approved package after the Approval Gate stopped the run and went back to
the user: a requirement that could not be met, a contract with a hole, a task that failed after Triage
(ADR-0003 sent every cause upstream of the gate to the user). The user approves the whole plan precisely so
that the run can finish without them, and asked that questions after the gate be settled inside the factory.
So after the gate the run never waits for the user. A question goes, as a Consultation, to the Role that wrote
the thing in question (requirements and scenarios, contracts, architecture, the plan). That Role changes its
Artifact under three rules: keep the purpose of the requirement, make the smallest change, add no new scope.
The CLI checks the change, records it as a **Deviation**, and has the affected tasks run again. The user's
second point of control is the pull request, which opens with what differs from the approved package, what
was not built and why, and what is needed from the user to finish.

A task that still fails after Triage goes back to the Role that caused it (plan, spec or architecture) to be
fixed and run again, at most three times; then it and the tasks that depend on it are marked not built and the
rest carries on. A cause in the environment (a missing key, the network) cannot be fixed inside and is marked
at once. The user sets a cap on Agent runs at the gate; at the cap no new task starts and the run ends cleanly.
The run always ends in a pull request: ready for review when everything passes, a draft when something was not
built or a quality layer still fails.

What the user grants at the gate is wider for this reason: any free resource of the providers already in use,
and migrations that change data on local and dev databases when they are reversible and tried on seed data.
Work outside that is marked not built, never done.

Never automatic, whatever else is granted: credentials outside the project's own `.env`, anything that costs
money, production deploys, deleting cloud data. These cannot be put right afterwards, and none of them lies on
the way to a pull request.

## Considered Options

- **Reopen the gate when something approved must change.** Rejected by the user: a plan that was approved
  should not come back with questions.
- **The main session decides.** Rejected: the coordinator would also rewrite requirements with nobody checking
  it, and with the runner there is no main session that lives through the whole Change.
- **The author Role may change how a requirement is met but never drop it.** Considered seriously; not chosen
  because the pull request should be whole where it can be. Dropping one still shows at the top of the pull
  request as a Deviation.

## Consequences

- What is built can differ from what was approved. The frozen package and its hash now move after the gate,
  each move with a recorded reason; the approval is no longer proof that nothing changed, the Deviation list is.
- A disagreement found at the pull request costs rework that a question at the time would have saved.
- On a client's repository a draft pull request with unfinished work is visible to others.
