import { defineConfig } from "vitest/config";

/**
 * Unit-test config (roadmap 4.1).
 *
 * These tests are deliberately pure: no DOM, no IndexedDB, no network. That is
 * what lets them run in milliseconds where the Playwright suites take seconds.
 * Anything needing a browser belongs in tests/e2e.spec.ts instead.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
  },
});
