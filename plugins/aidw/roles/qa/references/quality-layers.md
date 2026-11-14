# Quality layers and quality.yaml

`/aidw:start` step 8 writes `.aidw/changes/<id>/quality.yaml`, the machine-readable half of the Analysis
sections `## Quality profile`, `## Deploy strategy` and `## Permissions`. The user approves it at the gate;
after that it is frozen, and `aidw verify` / `aidw deploy` run its commands **without asking**. So every
command must be one the user would accept running unattended.

## Schema

```yaml
layers:                         # run in this order by `aidw verify`; any kebab-case name works
  - name: code
    run: ["pnpm lint", "pnpm format:check", "pnpm exec tsc --noEmit", "pnpm build"]
  - name: unit
    run: ["pnpm exec vitest run --project unit --reporter=default --reporter=junit --outputFile.junit=test-results/unit.xml"]
    reports: [test-results/unit.xml]       # JUnit XML: converge reads real pass/fail/skip per scenario
  - name: integration
    setup: ["pnpm exec supabase start"]          # optional; runs before `run` every time
    run: ["pnpm exec vitest run --project integration"]
  - name: e2e                   # Chrome over CDP (see below); Playwright's webServer builds and starts the app
    run: ["pnpm exec playwright test --project=e2e"]
    reports: [test-results/e2e.xml]
  - name: ui-ux                 # review layer: commands produce the artifacts, then aidw:ui-ux-designer judges them
    run: ["PLAYWRIGHT_JUNIT_OUTPUT_NAME=test-results/shots.xml pnpm exec playwright test --project=shots"]
    artifacts: ["test-results/shots/**/*.png"]
    review: ui
  - name: security
    run:
      - "pnpm audit --audit-level=high --prod"
      - "! git grep -nE 'sk_live_[0-9a-zA-Z]{8}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[0-9a-zA-Z]{20}' -- . ':!*.lock' ':!pnpm-lock.yaml'"
    review: security
deploy:
  target: preview               # none | local | preview   (production is tier 3: never automatic)
  command: pnpm dlx vercel deploy --yes --environment=preview
  smoke:                        # vercel curl passes Deployment Protection; plain curl gets 401
    - vercel curl / --deployment "$AIDW_DEPLOY_URL" --yes -- --fail --silent --show-error --output /dev/null
    - vercel curl /api/health --deployment "$AIDW_DEPLOY_URL" --yes -- --fail --silent --show-error --output /dev/null
permissions: [vercel-preview]   # tier-2 resource keys; each must also be named in ## Permissions
max_fix_rounds: 3               # fix tasks per failing layer before escalating (default 3)
parallel:                       # waves of tasks with disjoint touches, each in its own git worktree (S8)
  max: 3                        # 1 = sequential
  setup: []                     # commands run in each new worktree, e.g. ["pnpm install --offline --frozen-lockfile"]
```

- **Review layers** carry `review: ui` or `review: security`. Their `run` commands (optional) produce the
  artifacts; when they pass, `aidw verify` stops with a brief and the orchestrator spawns the matching
  read-only agent (`aidw:ui-ux-designer`, `aidw:security`), then records the verdict with
  `aidw layer-review <layer> pass|fix`. A `fix` verdict becomes a fix task with the reviewer's notes, within
  `max_fix_rounds`. `artifacts` are project-relative globs of files the reviewer must open.
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
- **Vercel specifics.** Pass `--environment=preview` so later deployments are previews. A project with no deployment at all
  cannot take a preview whatever the flag says: Vercel makes the first deployment Production (trial-3C), so the user
  runs `aidw first-deploy --yes` once in their own terminal (a public Production deployment), or the target is none. `aidw doctor` checks this. Commit a `vercel.json` with `{"framework": "nextjs"}` (or the framework in use) in the scaffold task: `vercel link` in an empty folder saves the project as preset "Other", and the build then fails with `STATIC_BUILD_NO_OUT_DIR` (trial-3C). Previews have Deployment Protection on by default, so smoke checks use `vercel curl`, which
  bypasses it for the logged-in user; plain `curl` gets 401. The CLI adds `.vercel` to `.gitignore`; the
  archive commit includes it. When its login token expires, the CLI must rewrite its auth file, which the
  sandbox blocks (error `The value of "err" is out of range`); the user runs `vercel whoami` in their own
  terminal first. The preflight's `vercel whoami` only proves the login works now, so `/aidw:run` asks for it
  again right before deploying when the run was long.
- Preview deploys need the user's provider login (`vercel login` once). Environment variables for the preview
  (e.g. Supabase URL and anon key) are listed in `## Deploy strategy`; if they require a cloud database, add the
  `supabase-dev` key and say which project.

## Brownfield projects

Use the project's own scripts (`aidw detect` lists them under `layer`) and its package manager; do not add
tools the project does not use unless a layer needs one (say why in `## Quality profile`). Run every layer
command once during the Analysis (health baseline). A check that already fails on the untouched code is
recorded under `## Existing system`; the user decides whether the change fixes it or the layer skips it.

## Tier-2 resource keys

| Key | Covers |
|---|---|
| `vercel-preview` | `vercel` / `vercel deploy` without `--prod` (creates or links a free Vercel project) |
| `netlify-preview` | `netlify deploy` without `--prod` |
| `supabase-dev` | `supabase link`, `supabase db push`, `supabase functions deploy`, `supabase secrets set` on a dev project |

Anything else that touches the cloud is tier 3 and asks every time (production, domains, deleting deployments,
creating or deleting Supabase projects, other hosts).

## Suggested commands by stack

| Stack | code | unit | integration | e2e | ui-ux / a11y / security / performance |
|---|---|---|---|---|---|
| Next.js (fallback) | `pnpm lint`, `pnpm format:check`, `pnpm exec tsc --noEmit`, `pnpm build` | `pnpm exec vitest run` | `pnpm exec supabase start` + vitest project | `pnpm exec playwright test --project=e2e` | all four (section below) |
| Vite + React | `pnpm lint`, `pnpm format:check`, `pnpm exec tsc -b`, `pnpm build` | `pnpm exec vitest run` | vitest against the API | `pnpm exec playwright test --project=e2e` | all four |
| NestJS / Express API | `pnpm lint`, `pnpm format:check`, `pnpm exec tsc --noEmit`, `pnpm build` | `pnpm test` | supertest + local DB (Docker) | API smoke via Playwright `request` or supertest | security only (no UI) |

Use the package manager the project uses; pin nothing here that the constitution decides otherwise.
The `format:check` script comes from the stack pack `stacks/node.md` (greenfield); a brownfield project uses its own.

## Database migrations

A task that adds or changes a migration is `risk: high` (it runs alone; `aidw analyze` warns otherwise) and must:

- be **reversible**: ship the down migration (or state in the Analysis why it cannot be undone, and make the user
  accept it at the gate);
- be **tested against a seeded database**: a test applies up, checks the seeded rows survive and the new shape
  works, applies down, and checks the old shape is back (SQLite or Docker Postgres for local runs, the project's
  local Supabase for Supabase);
- be **additive first** for anything live: add the column nullable, backfill, then tighten in a later task
  (expand-contract), never a rename or drop in one step;
- never run against a remote database from an unattended run: that is tier 2 or 3 and asks.

The reviewer and the security reviewer check these items on every migration in the diff; a missing down migration or
seeded test is a `fix`. The PR's Merge danger lists migration files (`aidw pr`).

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

`playwright.config.ts`: `workers: 1`, `reporter: [["list"], ["junit", { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? "test-results/e2e.xml" }]]`,
and a `webServer` that builds and starts the app on a fixed port with `reuseExistingServer: false`, so a stale
server is never tested. Screenshots for the design check use the same fixture. Projects separate the suites
that the layers below run on their own:

```ts
projects: [
  { name: "e2e", testMatch: /.*\.spec\.ts/, testIgnore: [/a11y\.spec\.ts/, /shots\.spec\.ts/] },
  { name: "a11y", testMatch: /a11y\.spec\.ts/ },
  { name: "shots", testMatch: /shots\.spec\.ts/ },
],
```

## Recommended layers (S7)

Per-task reviews see one slice at a time. These layers look at the assembled product; each is a normal entry
in `quality.yaml`, so the Analysis decides which run and the user approves them. Leaving one out is allowed and
must be justified in `## Quality profile`; the quality report lists it as not covered.

### ui-ux (review: ui)

The `shots` project photographs every main screen at three viewports and each theme, then `aidw:ui-ux-designer`
opens every image. The scaffold task adds `e2e/shots.spec.ts`:

```ts
import { test } from "./fixtures";

const routes = ["/", "/settings"];                       // every main screen
const viewports = { mobile: { width: 390, height: 844 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1280, height: 800 } };
const themes = ["light", "dark"];                        // drop "dark" when tokens have no dark values

for (const route of routes) for (const [vp, size] of Object.entries(viewports)) for (const theme of themes) {
  test(`shot ${route} ${vp} ${theme}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `test-results/shots/${route.replace(/\W+/g, "_") || "home"}-${vp}-${theme}.png`, fullPage: true });
  });
}
```

Add seeded states where they matter (an empty list, a long name, an error) by a `beforeEach` that fills storage
or the API; a screenshot of a blank page proves little. The reviewer may also run this command itself.

### a11y

axe-core through Playwright (`pnpm add -D @axe-core/playwright`), one test per main screen plus a keyboard pass:

```yaml
  - name: a11y
    run: ["PLAYWRIGHT_JUNIT_OUTPUT_NAME=test-results/a11y.xml pnpm exec playwright test --project=a11y"]
    reports: [test-results/a11y.xml]
```

```ts
// e2e/a11y.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

for (const route of ["/", "/settings"]) {
  test(`a11y ${route}: no WCAG 2.1 A/AA violations`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}

test("a11y keyboard: every control is reachable and focus is visible", async ({ page }) => {
  await page.goto("/");
  const controls = await page.locator("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])").count();
  for (let i = 0; i < controls; i++) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus-visible");
    await expect(focused).toHaveCount(1);
  }
});
```

### security (review: security)

Commands first (dependency audit and a secret scan; both exit non-zero on a finding), then
`aidw:security` reads the whole diff against the OWASP-style checklist in its brief. npm projects use
`npm audit --audit-level=high --omit=dev`. When the Analysis accepts a specific advisory, say so in
`## Quality profile` and add the exception to the command (`pnpm audit --ignore <id>` / an `.npmrc`
`audit-level`), never by weakening the layer later.

### performance

Lighthouse attaches to the CDP Chrome (`--port=9222`), so it runs inside the sandbox. The app must be running:
`start-server-and-test` starts the built app, runs Lighthouse, then stops it. A small script asserts budgets.

```yaml
  - name: performance
    run:
      - "pnpm build"
      - "pnpm exec start-server-and-test 'pnpm start -- -p 3100' http://localhost:3100 'pnpm exec lighthouse http://localhost:3100 --port=9222 --quiet --output=json --output-path=test-results/lighthouse.json --only-categories=performance,accessibility,best-practices && node scripts/lh-budget.mjs test-results/lighthouse.json'"
    artifacts: ["test-results/lighthouse.json"]
```

```js
// scripts/lh-budget.mjs  - scores are 0..1; budgets from the Analysis
import { readFileSync } from "node:fs";
const budgets = { performance: 0.8, accessibility: 0.9, "best-practices": 0.9 };
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const bad = Object.entries(budgets).filter(([k, min]) => (r.categories[k]?.score ?? 0) < min);
for (const [k, min] of bad) console.error(`${k}: ${r.categories[k]?.score} < ${min}`);
process.exit(bad.length ? 1 : 0);
```

Dev dependencies: `lighthouse`, `start-server-and-test`. The preflight checks `npx lighthouse --version`.
Mobile emulation is Lighthouse's default; add `--preset=desktop` as a second command when the desktop budget
matters too.

