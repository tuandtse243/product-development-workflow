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
  - name: e2e                   # Chrome over CDP (see below); Playwright's webServer builds and starts the app
    run: ["pnpm exec playwright test"]
    reports: [test-results/e2e.xml]
deploy:
  target: preview               # none | local | preview   (production is tier 3: never automatic)
  command: pnpm dlx vercel deploy --yes --environment=preview
  smoke:                        # vercel curl passes Deployment Protection; plain curl gets 401
    - vercel curl / --deployment "$AIDW_DEPLOY_URL" --yes -- --fail --silent --show-error --output /dev/null
    - vercel curl /api/health --deployment "$AIDW_DEPLOY_URL" --yes -- --fail --silent --show-error --output /dev/null
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
  may deny writing outside the project and launching browsers, so e2e uses Chrome over CDP (below). Settle the
  browser during the Analysis (`/aidw:start` step 8 preflight), never with a `setup` step that only fails after
  approval.
- **E2E covers the scenarios.** Each scenario id appears in a test name (the checkpoint enforces that per
  task); the e2e layer then proves the main flows pass together on the built app.
- **Deploy** `command` must be a recognized preview deploy (Vercel or Netlify draft), and its tier-2 key must
  be in `permissions`. `aidw deploy` takes the deployment URL from the output (Vercel's JSON `url`, never the
  alias) and runs each `smoke` command with `AIDW_DEPLOY_URL` set. `target: none` (or `local`) records that
  nothing was deployed.
- **Vercel specifics.** Pass `--environment=preview`: without it, a project's first deployment goes to
  production. Previews have Deployment Protection on by default, so smoke checks use `vercel curl`, which
  bypasses it for the logged-in user; plain `curl` gets 401. The CLI adds `.vercel` to `.gitignore`; the
  archive commit includes it. When its login token expires, the CLI must rewrite its auth file, which the
  sandbox blocks (error `The value of "err" is out of range`); the user runs `vercel whoami` in their own
  terminal first. The preflight's `vercel whoami` only proves the login works now, so `/aidw:run` asks for it
  again right before deploying when the run was long.
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

## E2E browser over CDP

Claude Code's sandbox usually blocks launching Chromium, so Playwright connects to a Chrome the user runs
outside the sandbox. The user starts it once per session, in their own terminal, with a separate profile:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.aidw-chrome" --no-first-run about:blank
```

The scaffold task writes a fixture that every e2e test imports instead of `@playwright/test`. Each test gets its
own browser context, so tests stay isolated and never touch the user's tabs:

```ts
// e2e/fixtures.ts
import { test as base, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

const cdpUrl = process.env.E2E_CDP_URL ?? "http://127.0.0.1:9222";

export const test = base.extend<{ context: BrowserContext; page: Page }, { cdpBrowser: Browser }>({
  cdpBrowser: [
    async ({}, use) => {
      const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 }).catch(() => {
        throw new Error(`Cannot reach Chrome at ${cdpUrl}. Start Chrome with --remote-debugging-port=9222.`);
      });
      await use(browser);
      await browser.close(); // disconnects; the user's Chrome keeps running
    },
    { scope: "worker" },
  ],
  context: async ({ cdpBrowser, baseURL }, use) => {
    const context = await cdpBrowser.newContext({ baseURL });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => use(await context.newPage()),
});
export { expect } from "@playwright/test";
```

`playwright.config.ts`: `workers: 1`, `reporter: [["list"], ["junit", { outputFile: "test-results/e2e.xml" }]]`,
and a `webServer` that builds and starts the app on a fixed port with `reuseExistingServer: false`, so a stale
server is never tested. Screenshots for the design check use the same fixture.

