---
name: ci-pipeline
description: A CI workflow that runs the same commands as the quality layers, without leaking a secret.
---

# CI pipeline

- **Same commands as `quality.yaml`.** One step per command of the `code`, `unit` and `integration` layers, in the same order.
  When a layer command changes, the workflow changes in the same task. Do not add e2e, a11y or ui-ux unless the task asks and
  the runner has a browser.
- **Least privilege.** Set `permissions: contents: read` at the top; widen one job only when it needs it.
- **Pin actions** to a major version (`actions/checkout@v4`) or a commit; never `@main`.
- **Cache** the package manager's store through `actions/setup-node` (`cache: pnpm|npm|yarn`), keyed by the lockfile.
- **Secrets.** Read them as `${{ secrets.NAME }}` only in the step that needs them, never print them, never echo an
  environment dump, and never pass them to a step from a fork's pull request (use `pull_request`, not `pull_request_target`,
  for code from forks). A secret that tests need becomes a dummy value in the workflow's `env:`; the real one stays out of CI.
- **No deploy.** A deploy job is a tier 2 or 3 decision; do not add one unless the task names it and says which environment.
- **Check.** Lint the file (`actionlint` when installed, otherwise parse it as YAML) and run each command the workflow runs
  locally once.
