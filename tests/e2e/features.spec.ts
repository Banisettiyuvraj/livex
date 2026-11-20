import { expect, test } from "@playwright/test";
import { join } from "node:path";

/**
 * Feature suites — Parts 1 and 2 of the expansion roadmap.
 *
 * The assertion bodies live in the plain `features*.mjs` runners so the same
 * checks can be driven either from `npm test:features` or from here. This spec
 * gives them the Playwright harness: a managed dev server, per-test isolation,
 * fixtures and tracing on failure.
 */

const FIXTURES = join(process.cwd(), "tests", "fixtures");

type Check = { name: string; ok: boolean; detail?: string };
type Runner = (page: any, fixture: (name: string) => string, check: (c: Check) => void) => Promise<void>;

const fixture = (name: string): string => join(FIXTURES, name);

async function runChecks(
  page: any,
  suite: (page: any, fixture: (name: string) => string) => Promise<Check[]>,
): Promise<void> {
  await page.goto("/", { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    const store = (window as any).__livex?.metadataStore;
    if (store) await store.clearAll();
  });

  const checks = await suite(page, fixture);
  expect(checks.length, "the suite should run at least one check").toBeGreaterThan(0);

  const failed = checks.filter((c) => !c.ok);
  expect(
    failed.map((c) => `${c.name}${c.detail ? " — " + c.detail : ""}`),
    `${failed.length} of ${checks.length} checks failed`,
  ).toEqual([]);
}

test.describe("Part 1 features", () => {
  test("history, annotations, keyboard, dialogs, PiP, time modes", async ({ page }) => {
    await runChecks(page, async (p, fx) => {
      const checks: Check[] = [];
      const record = (name: string, ok: boolean, detail = ""): void => {
        checks.push({ name, ok, detail });
      };
      const { runPart1 } = await import("./suites/part1.mjs");
      await runPart1(p, fx, record);
      return checks;
    });
  });
});

test.describe("Part 2 features", () => {
  test("integrity, resume, focus, playlist, chapters, subtitles, analytics", async ({ page }) => {
    await runChecks(page, async (p, fx) => {
      const checks: Check[] = [];
      const record = (name: string, ok: boolean, detail = ""): void => {
        checks.push({ name, ok, detail });
      };
      const { runPart2 } = await import("./suites/part2.mjs");
      await runPart2(p, fx, record);
      return checks;
    });
  });
});
