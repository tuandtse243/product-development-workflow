# Planning the scaffold and the toolchain

The first tasks of a greenfield plan usually scaffold the project with the approved stack and set up the test
harness, the JUnit reporters of `quality.yaml`, and `.env.example` for every environment variable (names only).

- **The scaffold creates no tables.** It sets up the database client and its config only (`src/db/client.ts`,
  `drizzle.config.ts`). The first schema and its migration are their own task, owned by `database`, `risk: high`,
  right after the scaffold: see "Who owns the database" in your role. `aidw analyze` refuses a scaffold whose
  `touches` include a schema file or a migration folder.
- **Code style and commits.** For a greenfield project the scaffold task also sets up the formatter, linter, hooks
  and commit lint of the project's **stack pack** (`aidw plugin-path stacks/node.md` for JS/TS; the
  language-neutral rules are in `aidw plugin-path library/code-style.md`); put those files in its `touches` and
  tell it to follow both. A stack without a pack gets the language's usual equivalents. Brownfield projects keep
  their own tooling. Greenfield scaffolds commitlint with the same rules (the stack pack).
- **CI.** A greenfield project that will live on GitHub also gets `.github/workflows/ci.yml` from the scaffold
  task, mirroring the `code`, `unit` and `integration` layers (`aidw plugin-path roles/devops/references/ci.md`). Brownfield keeps
  its own.
- **Test reports.** Every layer in `quality.yaml` with `reports:` needs its runner configured to write that JUnit
  file (Playwright `reporter: [['list'], ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? '...' }]]`).
  Put it in the scaffold task's brief: a layer that passes without writing its report fails verify.
- **Vercel needs its framework in the repo.** When the deploy target is Vercel, the scaffold task must commit a
  `vercel.json` with `{"framework": "nextjs"}` (or the framework in use) and put it in its `touches`: a project
  linked before the app exists is saved as preset "Other" and fails with `STATIC_BUILD_NO_OUT_DIR`. Add that line
  to the scaffold task's scenarios or verify command. A brand-new project's first deployment is Production
  (`aidw first-deploy --yes`, run by the user), so tell the user at the gate.
