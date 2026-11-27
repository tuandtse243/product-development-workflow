import { defineConfig } from "vitest/config";

export default defineConfig({
  // Inside the project, not node_modules/.vite: node_modules may be a read-only shared install.
  cacheDir: ".cache/vite",
  esbuild: { jsx: "automatic" },
  test: {
    // jsdom, with Node's AbortController kept: Node's fetch refuses jsdom's signals (tests/environment.ts).
    environment: "./tests/environment.ts",
    include: ["tests/**/*.test.{ts,tsx}"],
    // The network is MSW (tests/msw/): every request a test makes is answered in-process, and one without a handler fails.
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Files run one after another: under load, jsdom suites started at once make findBy* time out.
    fileParallelism: false,
  },
});
