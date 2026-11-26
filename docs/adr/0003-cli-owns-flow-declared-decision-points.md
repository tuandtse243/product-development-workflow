# The CLI owns the flow; judgment happens only at declared decision points

The factory has many Roles, and "who decides the next step" could be an LLM Orchestrator reasoning freely. We
decided the CLI computes every transition from the Workflow definition, and an LLM chooses a branch only at a
**decision point** the Workflow declares: which Role decides, the allowed answers, and whether the user must
approve. The Role writes its decision and reason as an Artifact; the CLI checks the answer is in the allowed
set before it changes state. Runs stay repeatable and cheap to coordinate, and the flow does not depend on how
capable the model is, which matters because some Roles will later run on cheaper models.

When a task exhausts its attempts, an independent Agent (not the one that failed) classifies the cause as
implementation, plan, spec, architecture or environment. The CLI routes implementation and environment causes
itself; a cause upstream of an Approval Gate stops and goes to the user with the diagnosis. (Superseded in part by
[ADR-0014](0014-after-the-approval-gate-the-run-does-not-ask-the-user.md): after the gate an upstream cause goes to
the Role that wrote the Artifact, and what still fails is not built.)

## Considered Options

- **Free LLM Orchestrator.** Rejected: different path on every run, large coordinator context, and an agent
  can advance a stage by claiming it is done.
- **Pure CLI rules (aidw before this decision).** Rejected: it can only retry the same task or stop, so a
  failure caused by the spec burns every retry.
- **LLM may propose a detour at any time, user approves.** Rejected: nothing says when a proposal is allowed,
  so it cannot be tested.
- **A workflow generated per request.** Rejected: the quality of the run depends on the generated workflow,
  and it cannot be covered by fixed evals.
- **Blackboard, Roles pick up work from new Artifacts.** Rejected: order and cost are emergent. We keep one
  idea from it: because each Role declares what it reads and writes, the CLI can check that a Workflow is
  consistent.
