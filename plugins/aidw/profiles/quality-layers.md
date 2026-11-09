# Quality layers and quality.yaml

`/aidw:start` step 8 writes `.aidw/changes/<id>/quality.yaml`, the machine-readable half of the Analysis
sections `## Quality profile`, `## Deploy strategy` and `## Permissions`. The user approves it at the gate;
after that it is frozen, and `aidw verify` / `aidw deploy` run its commands **without asking**. So every
command must be one the user would accept running unattended.

## Schema

```yaml
layers:                         # run in this order by `aidw verify`; any kebab-case name works
  - name: code
    run: ["pnpm lint", "pnpm exec tsc --noEmit", "pnpm build"]
  - name: unit
    run: ["pnpm exec vitest run --project unit --reporter=default --reporter=junit --outputFile.junit=test-results/unit.xml"]
    reports: [test-results/unit.xml]       # JUnit XML: converge reads real pass/fail/skip per scenario
  - name: integration
    setup: ["pnpm exec supabase start"]          # optional; runs before `run` every time
    run: ["pnpm exec vitest run --project integration"]
  - name: e2e
    setup: ["pnpm exec playwright install chromium"]
    run: ["PLAYWRIGHT_JUNIT_OUTPUT_NAME=test-results/e2e.xml pnpm exec playwright test --reporter=list,junit"]
    reports: [test-results/e2e.xml]
deploy:
  target: preview               # none | local | preview   (production is tier 3: never automatic)
  command: pnpm dlx vercel deploy --yes
  smoke: ['curl -fsS "$AIDW_DEPLOY_URL" -o /dev/null', 'curl -fsS "$AIDW_DEPLOY_URL/api/health"']
permissions: [vercel-preview]   # tier-2 resource keys; each must also be named in ## Permissions
max_fix_rounds: 3               # fix tasks per failing layer before escalating (default 3)
```

- **Layers** must not need a human: no interactive prompts, no watch mode, exit non-zero on failure.
  Playwright starts the app through its `webServer` config; tests that need a database use the local
  Supabase (tier 1), never a cloud project.
- **`code`, `unit`, `e2e` are expected** for web projects (Q5: comprehensive by default). Dropping one is a
  warning; justify it in `## Quality profile`.
- **Reports (recommended).** With `reports`, `aidw converge` reads each test case's real result (pass, fail,
  skipped) by scenario id. Without them it falls back to "a non-skipped test names the scenario and the layer
  passed", and the quality report says the evidence is presence-only. Runners: vitest
  `--reporter=junit --outputFile.junit=<file>`, Playwright `reporter: [["junit", { outputFile: "<file>" }]]`,
  `node --test --test-reporter=junit --test-reporter-destination=<file>`, Jest `jest-junit`.
- **Runs inside Claude Code's sandbox.** Layers, checkpoints and verify run through the Bash tool. The sandbox
  may deny writing outside the project (e.g. `playwright install` into `~/Library/Caches`) and launching
  browsers. Install browsers once in a normal terminal, and settle how e2e launches a browser during the
  Analysis (`/aidw:start` step 8 preflight), never with a `setup` step that only fails after approval.
- **E2E covers the scenarios.** Each scenario id appears in a test name (the checkpoint enforces that per
  task); the e2e layer then proves the main flows pass together on the built app.
- **Deploy** `command` must be a recognized preview deploy (Vercel or Netlify draft), and its tier-2 key must
  be in `permissions`. `aidw deploy` takes the deployment URL from the output and runs each `smoke` command with
  `AIDW_DEPLOY_URL` set. `target: none` (or `local`) records that nothing was deployed.
- Preview deploys need the user's provider login (`vercel login` once). Environment variables for the preview
  (e.g. Supabase URL and anon key) are listed in `## Deploy strategy`; if they require a cloud database, add the
  `supabase-dev` key and say which project.

## Tier-2 resource keys

| Key | Covers |
|---|---|
| `vercel-preview` | `vercel` / `vercel deploy` without `--prod` (creates or links a free Vercel project) |
| `netlify-preview` | `netlify deploy` without `--prod` |
| `supabase-dev` | `supabase link`, `supabase db push`, `supabase functions deploy`, `supabase secrets set` on a dev project |

Anything else that touches the cloud is tier 3 and asks every time (production, domains, deleting deployments,
creating or deleting Supabase projects, other hosts).

## Suggested commands by stack

| Stack | code | unit | integration | e2e |
|---|---|---|---|---|
| Next.js (fallback) | `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` | `pnpm exec vitest run` | `pnpm exec supabase start` + vitest project | `pnpm exec playwright test` |
| Vite + React | `pnpm lint`, `pnpm exec tsc -b`, `pnpm build` | `pnpm exec vitest run` | vitest against the API | `pnpm exec playwright test` |
| NestJS / Express API | `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` | `pnpm test` | supertest + local DB (Docker) | API smoke via Playwright `request` or supertest |

Use the package manager the project uses; pin nothing here that the constitution decides otherwise.
