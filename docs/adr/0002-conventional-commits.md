# ADR-0002: Conventional Commits, built and checked by aidw

Status: accepted (2026-11-12)

## Context

aidw made commits such as `T01: title` and `aidw: <id> delivered`, which commitlint rejects. We want one commit
convention for this repo and for greenfield projects the plugin scaffolds. The commitlint hook does not run in
wave task worktrees (`.husky/_` is not present there), and a task that passed review must not get stuck on a
rejected message.

## Decision

- Task commits are `type(capability): title` with `Change:`, `Task:` and `Evidence:` footers. The type is a
  required field `type` on every planned task in `tasks.yaml`, chosen in `/aidw:start` and reviewed at the
  gate; `breaking: true` adds `!`. Tasks added after approval take a type from their origin (converge `test`,
  quality and integration `fix`).
- Bookkeeping commits are `chore(aidw): ...`.
- aidw builds the message in `src/commit.ts` and does not rely on the hook. Header limit is 72 characters.
- Greenfield scaffolds commitlint and a `commit-msg` hook (`profiles/code-style.md`); brownfield keeps its
  own tooling. This repo uses the same setup.

## Consequences

- `type` is part of the approved plan, so changing it after approval counts as drift.
- Limitation: a brownfield project with a different commit convention (ticket prefixes and the like) still
  receives conventional messages from aidw.
- The `subject-case` and line-length rules are off in the generated config: aidw footers carry long paths.
