# The Approval Gate stays after the plan

Status: accepted (2026-11-24)

We considered moving the Approval Gate up to the point where the requirements are locked, so the user would
approve only requirements, scenarios, the Design Mock, the stack and the permissions, and architecture,
contracts and the plan would be accepted by checks and an independent Agent. The user chose to keep the gate
after the whole analysis package: the plan is where every edge case has been turned into a task, and
approving it is how the user controls what gets built. After the gate the run goes to the pull request without coming back to the user (ADR-0014).

## Considered Options

- **Gate after requirements, plan accepted automatically.** Rejected: fewer pages to read, but the user would
  first see how the edge cases were planned at the pull request, when changing them means rebuilding tasks.

## Consequences

- Every Workflow has exactly one Approval Gate. The early scope gate of the `product` Workflow becomes a round
  of questions in the discovery interview: the user still settles scope before the analysis is written, but
  nothing is frozen or formally approved at that point.
- An independent review of architecture and plan runs before the gate (after the CLI's own checks, at most two
  rounds of fixes); what it could not get fixed is listed at the top of the gate's Decision Page.
