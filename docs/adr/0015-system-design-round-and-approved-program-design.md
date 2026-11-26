# System Design is confirmed in a round of questions; the Program Design is approved and binding

Status: accepted (2026-11-26)

The architect Agent drafted the whole architecture in a fresh context and the user saw its technical choices for the
first time at the Approval Gate, after the plan had been built on them. The rpi workflow (HumanLayer) settles a
system design and then a program design, each with the user. We keep one Approval Gate (ADR-0011) and add, for a
`normal` Change, a **round of questions** after the Software Architect writes the System Design. The round puts the
Design Questions the Agent may not settle alone: a choice that is hard to reverse, two options that are about equal,
or a choice that changes cost or operation. It puts at most five of them, and the Agent settles the rest with its
reasons. When nothing is open, the round is one question in the chat with a View. Only then does the Architect, in a
second run, write the **Program Design** (`program-design.md`): a file-tree diff and the main signatures and
contracts are required; call trees, component trees, dependency maps and pseudocode are added where they help.
A `small` Change gets a short Program Design and no round.

The Program Design is approved at the gate with the rest of the package. Code that differs from it is a
Deviation (ADR-0014's path), not a free choice of the implementer: otherwise the user would approve something that
binds nothing.

## Considered Options

- **Two Approval Gates, as rpi does.** Rejected: a gate is a point where the work stops until the user approves, and
  ADR-0011 keeps one per Workflow. A round of questions gives the same check without a second approval.
- **No round; show both designs at the gate.** Rejected: a wrong System Design would be found only after the Program
  Design and the plan had been written on it.
- **The Technical Planner writes the Program Design.** Rejected: the planner would both design and cut the work, and
  the plan review could no longer grade one against the other.
