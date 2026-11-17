# Guards apply to every project; full tooling is set up only on greenfield

Status: accepted (2026-11-17)

`library/code-style.md` says a brownfield project keeps its own formatter, linter, hooks and commit rules, and
aidw never adds or replaces them. That rule stays for tooling. But an Agent can make checks pass by weakening
them (deleting or skipping a test, adding a suppression, lowering a threshold, editing the lint or CI
configuration), and a project's own tooling does not catch that. So we split the two:

- **Guards** are aidw's own deterministic checks and run on every project, brownfield included: the
  test-tampering and suppression check at the task checkpoint, protection of lint, typecheck, CI and hook
  configuration from implementing Roles, the secrets scan of the staged diff, and install safety for new
  packages. A violation becomes a `fix`; keeping a suppression needs a written reason the reviewer sees.
- **Tooling** (strict type-aware lint, test lint packs, complexity limits, dead-code and architecture checks,
  migration and workflow linters, coverage on the diff) is set up by the scaffold task on greenfield through
  the stack pack. On brownfield aidw runs what the project already has and adds none of it.

The `security` Role keeps reviewing dependencies and secrets, because a brownfield project may have no scanner.

## Considered Options

- **Offer the full tooling to brownfield at the Approval Gate.** Rejected for now: it changes a client's
  repository conventions, which the existing rule exists to prevent.
- **Nothing extra on brownfield.** Rejected: the tampering failure is the same on any codebase, and it is the
  one a review most easily misses.
- **Make test files read-only after the red phase is recorded.** Deferred: stricter, but a legitimate test
  correction would need an escalation path first. Revisit if a trial shows tampering that the diff check misses.
