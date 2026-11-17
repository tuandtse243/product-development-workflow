# A Decision Page is a view the CLI renders; choices come back as pasted text

Status: accepted (2026-11-17)

Every question round, Approval Gate summary, escalation and audit pick list was chat markdown. With several
options per question the trade-offs were hard to compare, and the user asked for pages they can tick. So a
round of questions or a gate is shown as a **Decision Page**: the Orchestrator writes the questions and options
as data, the CLI renders one self-contained HTML file under `.aidw/run/` (not committed), and the terminal
prints only the link and a short summary. The page has a copy button; the user pastes the resulting text into
the chat, the CLI checks it against the page (unknown keys, unanswered questions, a stale page), and only then
is it recorded where it is recorded today: the discovery appendix of `analysis.md`, `aidw decide`,
`aidw audit picks`. The Artifacts stay the only source of truth, so the approval hash and every existing check
are unchanged. Formal approval is still `aidw approve` behind the permission prompt.

The frame (three layouts: questions, pick list, gate) belongs to the CLI so selection and copy always work and
can be tested. A free slot per option or section takes static HTML, CSS and SVG only, with no script and no
network loads, and each fragment is isolated from the page.

## Considered Options

- **A local server the page submits to.** Rejected for now: the command would have to wait for the user, the
  sandbox may refuse the port, and it is network code to maintain. The pasted text keeps stable keys so this
  can be added later without changing the data.
- **Publish as a hosted artifact.** Rejected as the default: the page holds a client's requirements and risks,
  and a Role folder must stay platform-neutral (ADR-0004).
- **The model writes free HTML each time.** Rejected: costly, different every time, and a broken copy button
  cannot be caught by a test.
- **Commit the pages.** Rejected: a second copy of the decisions that can drift from `analysis.md`.
