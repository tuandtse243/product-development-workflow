# Research also describes the existing code and reads the official docs; implementers may consult it

Status: accepted (2026-11-26); amends ADR-0013

Two facts were missing from the work. Before the interview, the orchestrator read an existing codebase itself while
already knowing the request, so the description leaned toward the change it wanted. During the build, implementers
have no web and used the model's memory of a library, which is often for another version. We widened the Research
Role rather than add one, because its job was already "answer one question with cited evidence" and the person who
describes must not be the person who designs:

- **Existing System Report.** The orchestrator writes two to seven neutral questions about how the code works today,
  without the request. Research Agents answer groups of them in parallel with a file and line for each claim and
  the way each part is tested; one more Research Agent merges the parts, writes the summary and resolves
  contradictions against the code. Greenfield projects skip this.
- **Docs Brief.** For a task that uses a library or service new to the project, or one whose use changes between
  versions, the planner names it and Research writes a Docs Brief for the installed version before the gate, from
  a ladder of sources: the official documentation of that version (llms.txt and Markdown pages first, a configured
  docs MCP server when there is one), then changelogs, migration guides and maintainers' issues, then named
  experts; forum posts and blogs are only leads. Pages are fetched with WebFetch, never curl. A brief is reused
  while the major.minor version is the same and it is at most 90 days old.

ADR-0013 let an implementing Role consult only the authors of its contracts. An implementing Role may now also
consult Research, at most once per task, for what a Docs Brief did not foresee. This asks no person, so ADR-0014
stands.

## Considered Options

- **A new Codebase Researcher Role.** Rejected: one more Role for the same discipline of cited answers.
- **The Software Architect describes the code.** Rejected: it designs right after, so the description bends toward
  its design, and its tier costs more.
- **Docs only before the gate, or only during the build.** Rejected: before the gate alone misses what the plan
  did not foresee; during the build alone costs are unknown and Waves wait.
- **curl for llms.txt.** Rejected: it would open the network to the Research Agent's shell for a gain WebFetch
  already gives.
