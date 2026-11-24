# An Agent asks another Role through the Orchestrator, never by spawning it

Status: accepted (2026-11-24)

Roles could not reach each other: which Roles run was fixed by the Workflow and its Decision Points before the
work started, so a UX Researcher who met a market question mid-work had to guess. Claude Code lets a subagent
spawn subagents (three layers deep by default), so direct calls were possible. We chose a **Consultation**
instead: a Role declares which Roles it may consult, the Agent writes its question as a request, the
Orchestrator checks the pair and the budget and runs the consulted Role, and the answer comes back as an
Artifact. This keeps the rule that the CLI owns the flow (ADR-0003): every Agent that ran is in the run's
record, costs are bounded, and a Role folder does not depend on one platform's nesting (ADR-0004).

A consulted Role cannot consult in turn, and one Agent run may ask at most two questions, so there are no
chains or loops and the worst-case cost is known beforehand. Consultations are allowed during the build as
well, but there an implementing Role may ask only the Roles that wrote the contracts it builds against.

Asking does not stop the run. The Agent that asks ends its turn with the question, the Orchestrator gets the
answer and resumes it, and the other tasks of the Wave carry on. The user hears of it only when the consulted
Role cannot answer or the answer would change something that was approved. An Agent that lacks information
asks; it never guesses.

## Considered Options

- **Two levels deep, or no limit.** Rejected for now: the cost of the worst case grows fast and a loop check is
  needed; loosen it when real runs show the limit being hit.

- **Direct nesting (give Roles the Agent tool).** Rejected: the Orchestrator would not see who ran or what it
  cost, nothing stops chains or loops, and the answer lives only in the caller's context.
- **Decision Points only.** Rejected: a Decision Point is answered before the work starts, and the need to ask
  usually shows up in the middle of it.
