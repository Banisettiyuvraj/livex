import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration (roadmap 4.2).
 *
 * `webServer` removes the "start the dev server first" step: `npm run test:e2e`
 * now works from a clean checkout. The same suite runs against the dev server
 * and against the built `dist/` output by setting `LIVEX_TARGET=prod`.
 *
 * Dev builds expose `window.__livex` (`import.meta.env.DEV`). Production builds
 * only expose it when `VITE_LIVEX_TEST_HOOKS=1`, which the prod command sets —
 * so the app under test is byte-identical to a normal build apart from that
 * single guarded assignment.
 */
const TARGET = process.env.LIVEX_TARGET === "prod" ? "prod" : "dev";
const isProd = TARGET === "prod";

const PORT = isProd ? 4173 : 5173;

export default defineConfig({
  testDir: "./tests/e2e",
  // Only `*.spec.ts` are tests. `tests/e2e/suites/*.mjs` are shared assertion
  // modules imported by the specs — they define no tests of their own.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Video decode + 12 fixtures takes a while; give the suite room.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],

  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },

  webServer: {
    command: isProd
      ? "npm run build && npm run preview -- --port 4173 --strictPort"
      : "npm run dev -- --port 5173 --strictPort",
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: isProd ? { VITE_LIVEX_TEST_HOOKS: "1" } : {},
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
