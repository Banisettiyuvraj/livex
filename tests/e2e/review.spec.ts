import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const fixture = (name: string): string => join(FIXTURES, name);

const state = (page: Page): Promise<string> =>
  page.evaluate(() => (window as any).__livex.manager.getState());

test.describe("Lecture review mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.evaluate(async () => {
      const store = (window as any).__livex?.metadataStore;
      if (store) await store.clearAll();
    });
  });

  test("builds a review queue and leaves the completed session intact", async ({ page }) => {
    await page.setInputFiles("#video-input", fixture("h264-long-40s.mp4"));
    // Probing a 40-second file can take longer than a second on a loaded CI
    // machine; wait for the state instead of guessing at a sleep.
    await expect.poll(() => state(page), { timeout: 15_000 }).toBe("ready");

    // Seed two saved moments, then finish quickly from near the end. Review
    // mode only cares that the live session genuinely completed.
    await page.evaluate(async () => {
      const { annotations, manager } = (window as any).__livex;
      await annotations.add("bookmark", 5);
      await annotations.add("note", 12, "Revisit the derivation");
      await manager.startAt(39.4);
    });

    await expect.poll(() => state(page), { timeout: 15_000 }).toBe("completed");
    const completedHistory = await page.evaluate(() => {
      const entry = (window as any).__livex.history.getEntry();
      return entry
        ? { completed: entry.completed, lastTime: entry.lastTime, furthestTime: entry.furthestTime }
        : null;
    });

    await page.click("#review-session-btn");
    await expect(page.locator("#state-review")).toBeVisible();
    await expect(page.locator("#review-list li")).toHaveCount(2);
    await expect(page.locator("#review-list input[type=checkbox]")).toHaveCount(2);
    await expect(page.locator("#review-selection-count")).toHaveText("2 of 2 selected");

    // Select just the note timestamp.
    await page.locator("#review-list input[type=checkbox]").first().uncheck();
    await expect(page.locator("#review-selection-count")).toHaveText("1 of 2 selected");
    await page.click("#review-start-btn");

    await expect(page.locator("#review-player")).toBeVisible();
    await expect(page.locator("#review-queue-count")).toHaveText("1 of 1");
    await expect(page.locator("#review-item-text")).toHaveText("Revisit the derivation");
    expect(
      await page.evaluate(
        () => document.querySelector("video")?.parentElement?.id,
      ),
    ).toBe("review-video-slot");

    // The video starts at the selected note, not at the end of the lecture.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (document.querySelector("video") as HTMLVideoElement).currentTime,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(11.5);

    // Review seeking is free and does not restart or alter the live session.
    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement;
      video.pause();
      video.currentTime = 35;
    });
    await page.waitForTimeout(400);
    expect(await state(page)).toBe("completed");
    expect(
      await page.evaluate(
        () => (document.querySelector("video") as HTMLVideoElement).currentTime,
      ),
    ).toBeGreaterThan(34);

    // Direct review playback must not write partial positions into history.
    const afterReview = await page.evaluate(() => {
      const entry = (window as any).__livex.history.getEntry();
      return entry
        ? { completed: entry.completed, lastTime: entry.lastTime, furthestTime: entry.furthestTime }
        : null;
    });
    expect(afterReview).toEqual(completedHistory);

    await page.click("#review-exit-btn");
    await expect(page.locator("#state-completed")).toBeVisible();
    await expect(page.locator("#state-review")).toBeHidden();
    expect(await state(page)).toBe("completed");
  });
});
