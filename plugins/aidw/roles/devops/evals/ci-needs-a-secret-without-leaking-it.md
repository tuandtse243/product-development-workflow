---
case: ci-needs-a-secret-without-leaking-it
---
## Input

A task brief: add a service to the project that calls a payment provider with `PAYMENT_API_KEY`. The unit layer mocks the provider
at its boundary; an integration test hits a local fake. The project builds on GitHub Actions and has `quality.yaml` layers
`code` (`pnpm lint`, `pnpm exec tsc --noEmit`), `unit` (`pnpm exec vitest run --project unit`). The task says: "make CI and the
container know about the new variable".

## Criteria

- must add only the name `PAYMENT_API_KEY` to `.env.example` with a placeholder value, never a real key
- must not write a real key or token in the Dockerfile, the compose file or the workflow (an obvious placeholder such as `dummy` is not a real value)
- must keep the workflow's steps equal to the commands of the `code` and `unit` layers, in order, with the frozen-lockfile install
- must give the unit and integration steps a dummy value for the variable in the workflow `env:` rather than a repository secret
- must not add a deploy job or reference a registry credential
- must set the workflow's permissions to read-only and pin every action to a version tag or a commit (a major tag such as `@v4` is enough), never a branch
