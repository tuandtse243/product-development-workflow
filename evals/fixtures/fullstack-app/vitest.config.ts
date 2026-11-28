import { defineConfig } from "vitest/config";

/**
 * Two projects in one run. `web` tests render the app in jsdom; every `/api/*` request they make is forwarded to the real
 * Express app in this process (web/tests/msw/handlers.ts), over an in-memory PGlite: no socket, no network. `server`
 * tests call the app's routes through server/tests/http.ts.
 */
export default defineConfig({
  // Inside the project, not node_modules/.vite: node_modules may be a read-only shared install.
  cacheDir: ".cache/vite",
  esbuild: { jsx: "automatic" },
  test: {
    testTimeout: 20_000,
    // Each test file starts one PGlite, which takes seconds when many suites run at once: files run one after another.
    fileParallelism: false,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: "web",
          // jsdom, with Node's AbortController kept: Node's fetch refuses jsdom's signals (web/tests/environment.ts).
          environment: "./web/tests/environment.ts",
          include: ["web/**/*.test.{ts,tsx}"],
          setupFiles: ["web/tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["server/**/*.test.ts"],
        },
      },
    ],
  },
});
