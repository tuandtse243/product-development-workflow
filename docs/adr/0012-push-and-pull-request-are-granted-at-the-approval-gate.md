# Pushing the Change Branch and opening the pull request are granted at the Approval Gate

Status: accepted (2026-11-24)

Pushing to any remote is a tier 3 action, which means "always ask", and the pull request was an opt-in step
at delivery. The user wants a Change to run without a stop from the Approval Gate to an open pull request. So
the gate asks once for that Change: push its Change Branch to the named remote and open one pull request
against the named base. With that granted, the push at the end does not ask again. It is the only tier 3
action that can be granted ahead of time, and it covers one branch of one Change; Task Worktree branches are
never pushed, and every other tier 3 action (production deploys, anything that costs money, deleting cloud
data) still asks at the moment it happens.

## Considered Options

- **Keep asking before the push.** Rejected: one more stop at the end of every Change, hours after the user
  left, for an action whose result is a pull request they review anyway.
- **Always push, with no grant.** Rejected: some projects are client repositories where a push is visible to
  others; the user must be able to say no for a Change.

The grant covers a draft pull request as well: a run that could not finish everything still pushes and opens
one, marked as a draft (ADR-0014).
