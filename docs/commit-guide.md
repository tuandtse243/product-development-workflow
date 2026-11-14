# Commit message guide

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/), checked by
[commitlint](https://commitlint.js.org/) with `@commitlint/config-conventional`. This applies to this repo, to
the commits aidw makes while running a change, and to greenfield projects the plugin scaffolds
(`plugins/aidw/library/code-style.md`). Decision: [ADR-0002](adr/0002-conventional-commits.md).

```
<type>(<scope>): <subject>

<optional body>

<optional footers>
```

## Rules

- **type** (required, lowercase): `feat` new feature, `fix` bug fix, `docs`, `style` (formatting only),
  `refactor`, `perf`, `test`, `build` (build system, dependencies), `ci`, `chore` (anything else), `revert`.
- **scope** (optional, lowercase kebab-case noun): the area touched, for example `gate`, `run`, `docs`.
- **subject**: imperative present tense ("add", not "added"), no trailing period, lowercase first word
  (acronyms such as API stay).
- **The whole header (`type(scope): subject`) is at most 72 characters.**
- Breaking change: `!` after the type or scope (`feat(api)!: drop v1`), or a `BREAKING CHANGE:` footer.
- Body and footers: explain why, not what. Footers are `Key: value` lines, for example `Fixes #12`.

## Commits that aidw makes

| Commit | Message |
|---|---|
| A task, after review passes | `type(capability): task title`, footers `Change:`, `Task:`, `Evidence:` |
| Change delivered | `chore(aidw): <change-id> delivered` |
| Change archived | `chore(aidw): archive <change-id>` |

- `type` comes from the task's `type` field in `tasks.yaml` (set in `/aidw:start`, reviewed at the approval gate;
  analysis fails without it). `breaking: true` adds the `!`.
- The scope is the capability of the task's first spec; a task with no spec (the scaffold) uses `config`.
- aidw builds and checks these messages itself because the `commit-msg` hook does not run in a wave task's
  worktree. A title that is too long is cut at a word.

## Examples

```
feat(expenses): add expense form

Change: 2026-11-12-expense-tracker
Task: T02
Evidence: .aidw/changes/2026-11-12-expense-tracker/evidence/T02.json
```

```
fix(gate): deny writes by read-only reviewers
```

```
chore(config): scaffold prettier, husky and commitlint
```

## Hooks

Greenfield projects get `.husky/pre-commit` (lint-staged) and `.husky/commit-msg` (commitlint). To bypass in an
emergency: `git commit --no-verify`. Brownfield projects keep their own hooks and commit rules.

## `commitlint.config.js`

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 72],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
```

`subject-case` and the line limits are off because aidw footers carry long evidence paths and a title may start
with an acronym.
