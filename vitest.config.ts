import { defineConfig } from "vitest/config";

// Only the CLI's own tests: evals/fixtures/ holds sample projects (with their own tests) that aidw reads, never runs.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
