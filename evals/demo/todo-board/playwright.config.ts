import { defineConfig } from "@playwright/test";

// The app is built and started by Playwright itself on a fixed app port (not the browser's port); a stale server
// is never reused. The browser is the project's test browser, reached over CDP (see e2e/fixtures.ts).
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  reporter: [["list"], ["junit", { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? "test-results/e2e.xml" }]],
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "pnpm build && pnpm exec next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
