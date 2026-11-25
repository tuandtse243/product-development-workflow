import { defineConfig } from "vitest/config";

export default defineConfig({
  // Inside the project, not node_modules/.vite: node_modules may be a read-only shared install.
  cacheDir: ".cache/vite",
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
