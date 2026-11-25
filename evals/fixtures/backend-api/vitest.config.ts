import { defineConfig } from "vitest/config";

export default defineConfig({
  // Inside the project, not node_modules/.vite: node_modules may be a read-only shared install.
  cacheDir: ".cache/vite",
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    // Each test file starts one PGlite (tests/helpers.ts), which takes seconds when many suites run at once: files run
    // one after another, so a suite starts one database at a time, and the hook that starts it may wait.
    fileParallelism: false,
    hookTimeout: 120_000,
  },
});
