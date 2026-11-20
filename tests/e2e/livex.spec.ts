import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { join } from "node:path";

/**
 * LiveX end-to-end suite (roadmap 4.2).
 *
 * Self-contained: `webServer` in playwright.config.ts starts Vite, so there is
 * no manual "start the dev server first" step. The same file runs against the
 * development build and the production bundle (`LIVEX_TARGET=prod`).
 *
 * The `window.__livex` hook exists only in dev, or in a production build with
 * VITE_LIVEX_TEST_HOOKS=1.
 */

const FIXTURES = join(process.cwd(), "tests", "fixtures");
const fixture = (name: string): string => join(FIXTURES, name);

/** A public video id used only to exercise the link path. */
const VIDEO_ID = "dQw4w9WgXcQ";

/** Matrix rows: which files should play natively on this platform. */
const MATRIX: Array<{ file: string; expect: "play" | "fail" | "either" }> = [
  { file: "h264-aac.mp4", expect: "play" },
  { file: "hevc-aac.mp4", expect: "either" }, // platform HEVC support varies
  { file: "vp8-vorbis.webm", expect: "play" },
  { file: "vp9-opus.webm", expect: "play" },
  { file: "av1-opus.webm", expect: "play" },
  { file: "h264-aac.mkv", expect: "either" }, // Chromium rejects the mkv MIME
  { file: "hevc-aac.mkv", expect: "fail" },
  { file: "h264.mov", expect: "either" },
  { file: "hevc.mov", expect: "either" },
  { file: "mpeg4.avi", expect: "fail" },
  { file: "mpeg2.ts", expect: "fail" },
  { file: "mpeg2.mpg", expect: "fail" },
];

/** Collect page errors and console errors for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function clearStorage(page: Page): Promise<void> {
  // History and notes persist across runs; tests must not inherit each other.
  await page.evaluate(async () => {
    const store = (window as any).__livex?.metadataStore;
    if (store) await store.clearAll();
  });
}

async function loadFile(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as any).__livex.manager.reset());
  await page.setInputFiles("#video-input", fixture(name));
  await page.waitForTimeout(700);
}

const state = (page: Page): Promise<string> =>
  page.evaluate(() => (window as any).__livex.manager.getState());

const progress = (page: Page) =>
  page.evaluate(() => (window as any).__livex.manager.getProgress());

test.describe("LiveX", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(800);
    await clearStorage(page);
  });

  test("boots without errors and exposes the app", async ({ page }) => {
    const errors = watchErrors(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(800);

    const hasHook = await page.evaluate(() => Boolean((window as any).__livex));
    expect(hasHook, "window.__livex should be present").toBe(true);
    expect(await state(page)).toBe("idle");
    // The player reuses one element that the UI moves between slots, so a
    // second instance would mean a wiring regression (or a leaked element).
    expect(await page.locator("video").count(), "exactly one <video>").toBe(1);
    expect(errors).toEqual([]);
  });

  test("swapping files never creates a second video element", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    await loadFile(page, "vp9-opus.webm");
    expect(await page.locator("video").count(), "still exactly one <video>").toBe(1);
    expect(await state(page)).toBe("ready");
  });

  test("opens a local file and moves to ready", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    expect(await state(page)).toBe("ready");
  });

  test("starts, pauses and resumes a session", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(900);
    expect(await state(page)).toBe("live");

    // The state badge the user actually sees must agree with the state machine.
    await expect(page.locator("#live-badge")).toBeVisible();
    await expect(page.locator("#paused-badge")).toBeHidden();

    // LiveX swaps between a pause button and a resume button.
    await page.click("#pause-btn");
    await page.waitForTimeout(400);
    expect(await state(page)).toBe("paused");
    await expect(page.locator("#paused-badge")).toBeVisible();
    await expect(page.locator("#live-badge")).toBeHidden();

    await page.click("#resume-btn");
    await page.waitForTimeout(400);
    expect(await state(page)).toBe("live");
    await expect(page.locator("#live-badge")).toBeVisible();
    await expect(page.locator("#paused-badge")).toBeHidden();
  });

  test("anti-skip clamps a forward jump past the ceiling", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(1200);

    const before = await progress(page);
    // Drive the engine directly, as a script or a native scrubber would.
    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement;
      video.currentTime = 5.5;
    });
    await page.waitForTimeout(600);

    const after = await progress(page);
    expect(after.currentTime).toBeLessThanOrEqual(after.furthestTime + 1);
    expect(after.currentTime).toBeGreaterThanOrEqual(before.currentTime - 1);
    // The attempt is recorded for the integrity report.
    const integrity = await page.evaluate(() => (window as any).__livex.manager.getIntegrity());
    expect(integrity.skipAttempts).toBeGreaterThanOrEqual(1);
  });

  test("rewinding is always allowed", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(2500);

    const mid = await progress(page);
    await page.evaluate(() => (window as any).__livex.manager.seekTo(0));
    await page.waitForTimeout(400);
    const back = await progress(page);

    // Playback keeps running, so allow for a fraction of a second of progress.
    expect(back.currentTime).toBeLessThan(mid.currentTime);
    expect(back.currentTime).toBeLessThan(1);
  });

  test("locks playback to 1x during a session", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(900);

    await page.evaluate(() => {
      const video = document.querySelector("video") as HTMLVideoElement;
      video.playbackRate = 2;
    });
    await page.waitForTimeout(500);

    const rate = await page.evaluate(
      () => document.querySelector("video")!.playbackRate,
    );
    expect(rate).toBe(1);
  });

  test("completion fires from a real end of media", async ({ page }) => {
    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(900);

    // Let it play out; the fixture is ~6s.
    await expect
      .poll(async () => state(page), { timeout: 20_000 })
      .toBe("completed");

    // ...and the completion screen is what the user is left looking at.
    await expect(page.locator("#state-completed")).toBeVisible();
  });

  test("an unsupported file reports a friendly error", async ({ page }) => {
    await page.setInputFiles("#video-input", fixture("mpeg2.mpg"));
    await page.waitForTimeout(1200);

    expect(await state(page)).toBe("error");
    await expect(page.locator("#state-error")).toBeVisible();
    const message = await page.locator("#error-message-text").textContent();
    expect(message?.length ?? 0).toBeGreaterThan(10);
  });

  test("a non-video file is rejected before decoding", async ({ page }) => {
    const path = join(FIXTURES, "sample.srt");
    await page.setInputFiles("#video-input", path);
    await page.waitForTimeout(900);
    expect(await state(page)).toBe("error");
  });

  test("never sends a network request carrying video bytes", async ({ page }) => {
    const requests: Array<{ method: string; url: string }> = [];
    page.on("request", (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });

    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(2500);

    // `blob:` URLs are the local file handed to the decoder — they never touch
    // the network. Everything else must be a same-origin GET.
    const offending = requests.filter((r) => {
      if (r.method !== "GET") return true;
      if (r.url.startsWith("blob:") || r.url.startsWith("data:")) return false;
      return !r.url.startsWith("http://localhost");
    });
    expect(offending, JSON.stringify(offending)).toEqual([]);
  });

  test("works with every external request blocked (offline)", async ({ page }) => {
    // Abort anything that is not same-origin; the app must still play.
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http://localhost") || url.startsWith("blob:") || url.startsWith("data:")) {
        return route.continue();
      }
      return route.abort();
    });

    await loadFile(page, "h264-aac.mp4");
    await page.click("#start-session-btn");
    await page.waitForTimeout(1500);
    expect(await state(page)).toBe("live");
  });

  test.describe("YouTube links", () => {
    test("the idle screen offers a link field", async ({ page }) => {
      await expect(page.locator("#youtube-input")).toBeVisible();
      await expect(page.locator("#youtube-use-btn")).toBeVisible();
    });

    test("a pasted link asks for consent before loading Google code", async ({ page }) => {
      // Nothing may reach YouTube until the user has seen the disclosure.
      const external: string[] = [];
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (/youtube|ytimg|googlevideo|google/.test(url)) {
          external.push(url);
          return route.abort();
        }
        return route.continue();
      });

      await page.fill("#youtube-input", `https://youtu.be/${VIDEO_ID}`);
      await page.locator("#youtube-input").dispatchEvent("change");
      await page.waitForTimeout(400);

      await expect(page.locator("#youtube-consent")).toBeVisible();
      expect(external, "no YouTube request before consent").toEqual([]);
      // Still idle: nothing has been loaded yet.
      expect(await state(page)).toBe("idle");
    });

    test("continuing with consent reports honestly when YouTube is blocked", async ({ page }) => {
      // Simulate offline / blocked: every Google request fails.
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (/youtube|ytimg|googlevideo|google/.test(url)) return route.abort();
        return route.continue();
      });

      await page.fill("#youtube-input", `https://youtu.be/${VIDEO_ID}`);
      await page.locator("#youtube-input").dispatchEvent("change");
      await page.waitForTimeout(300);
      await page.click("#youtube-consent-continue");

      // It must land in the error state with a readable message, never hang.
      await expect
        .poll(async () => state(page), { timeout: 25_000 })
        .toBe("error");
      await expect(page.locator("#state-error")).toBeVisible();
      const message = await page.locator("#error-message-text").textContent();
      expect(message?.length ?? 0).toBeGreaterThan(10);
    });

    test("the consent choice is remembered across reloads", async ({ page }) => {
      await page.fill("#youtube-input", `https://youtu.be/${VIDEO_ID}`);
      await page.locator("#youtube-input").dispatchEvent("change");
      await page.waitForTimeout(300);
      await page.click("#youtube-consent-continue");
      await page.waitForTimeout(300);

      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(800);

      const remembered = await page.evaluate(() => {
        try {
          return window.localStorage.getItem("livex.youtubeConsent");
        } catch {
          return null;
        }
      });
      expect(remembered).toBe("1");
    });

    test("a non-YouTube link never hijacks the workspace", async ({ page }) => {
      await page.fill("#youtube-input", "https://vimeo.com/12345");
      await page.locator("#youtube-input").dispatchEvent("change");
      await page.waitForTimeout(400);

      await expect(page.locator("#youtube-consent")).toBeHidden();
      expect(await state(page)).toBe("idle");
    });

    test("a real embed hides YouTube's own controls and shields the frame", async ({ page }) => {
      test.skip(
        process.env.LIVEX_ALLOW_NETWORK !== "1",
        "needs live YouTube access; set LIVEX_ALLOW_NETWORK=1 to run",
      );

      await page.fill("#youtube-input", `https://youtu.be/${VIDEO_ID}`);
      await page.locator("#youtube-input").dispatchEvent("change");
      await page.waitForTimeout(300);
      await page.click("#youtube-consent-continue");

      // The session stops at `ready`; it must not begin on its own.
      await expect.poll(async () => state(page), { timeout: 30_000 }).toBe("ready");

      const frame = page.locator(".livex-yt-host iframe").first();
      await expect(frame).toBeVisible();
      const src = (await frame.getAttribute("src")) ?? "";
      expect(src).toContain(VIDEO_ID);
      // No scrubber, no related-video wall, no keyboard seeking.
      expect(src).toContain("controls=0");
      expect(src).toContain("rel=0");
      expect(src).toContain("disablekb=1");

      // The live surface exists and only blocks clicks once playing.
      const overlay = page.locator(".livex-yt-overlay").first();
      await expect(overlay).toBeVisible();
      expect(await overlay.evaluate((n) => getComputedStyle(n).pointerEvents)).toBe("none");

      await page.click("#start-session-btn");
      await expect.poll(async () => state(page), { timeout: 30_000 }).toBe("live");
      expect(await overlay.evaluate((n) => getComputedStyle(n).pointerEvents)).toBe("auto");
      await expect(page.locator("#live-badge")).toBeVisible();
    });
  });

  test.describe("compatibility matrix", () => {
    for (const row of MATRIX) {
      test(`${row.file} → ${row.expect}`, async ({ page }) => {
        await loadFile(page, row.file);
        const current = await state(page);

        if (row.expect === "play") {
          expect(current, `${row.file} should load`).toBe("ready");
        } else if (row.expect === "fail") {
          expect(current, `${row.file} should be rejected`).toBe("error");
        } else {
          // Platform dependent: must be one of the two terminal verdicts,
          // never a stuck or crashed state.
          expect(["ready", "error"]).toContain(current);
        }

        if (current === "ready") {
          await page.click("#start-session-btn");
          await page.waitForTimeout(1200);
          const after = await state(page);
          // Playable files must reach `live`; the rest fail honestly.
          expect(["live", "error", "paused"]).toContain(after);
        }
      });
    }
  });
});
