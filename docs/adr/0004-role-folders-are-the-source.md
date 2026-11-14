# A Role is a platform-neutral folder; platform agent files are generated from it

Claude Code wants one `agents/<name>.md` per subagent, and subagents cannot talk to the user, while several
Roles (Product Manager, Business Analyst, Designer, Architect) must interview the user. We decided a Role is a
folder (`role.md` with a machine-readable header, rules, skills, references, scripts, evals) that declares its
**run mode**: interactive Roles are loaded into the main session, worker Roles run in a fresh context. The
Claude Code agent files are a build product generated from `role.md` and are never edited by hand.

This keeps one source per Role, keeps per-Role tool limits (a reviewer stays read-only), and lets us generate
adapters for other platforms later; the first version targets Claude Code only. A Role declares a model
**tier** (deep, standard, fast) instead of a model name, and configuration maps tiers to models.

An interactive Role only interviews in the main session and records the questions and answers on disk; a
worker Agent of the same Role drafts the Artifacts from that record, so the main session's context stays small.

## Considered Options

- **Every Role is a subagent.** Rejected: every question to the user would round-trip through the Orchestrator.
- **One generic worker agent that loads a Role at run time.** Rejected: all Roles would share one tool
  permission set.
- **Hand-written agent files next to the Role folders.** Rejected: two places to keep in step.
