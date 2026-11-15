# CI scaffold: one workflow that mirrors the `code` and `unit` layers

The scaffold task of a **greenfield** project that will live on GitHub also writes `.github/workflows/ci.yml`, so
the same checks aidw runs unattended run on every push and pull request. Put `.github/**` in its `touches`.
Brownfield projects keep their own CI; do not add or replace it.

The workflow runs exactly the commands of the `code`, `unit` and `integration` layers in `quality.yaml` (not e2e,
a11y or ui-ux: they need a browser the sandbox-free runner does not have by default). If a layer command changes,
change the workflow in the same task so the two never drift. No secrets, no deploy: preview and production stay
tier 2 and tier 3 decisions made in `/aidw:run`.

## Node (pnpm)

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc # or: node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # one step per command of the code, unit and integration layers, in order:
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm exec tsc --noEmit
      - run: pnpm build
      - run: pnpm exec vitest run --project unit
      - run: pnpm exec vitest run --project integration
```

`pnpm/action-setup` reads the version from `package.json` `packageManager`, so the scaffold task sets that field.
Add a `.nvmrc` (or use `node-version`) matching the Node the project was built on.
