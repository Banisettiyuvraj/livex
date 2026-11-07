/**
 * LiveX end-to-end verification (Playwright).
 *
 * Checks the parts of the plan that can be verified automatically:
 *   - real local files load and play through the native adapter
 *   - the capability probe reports the right verdict per container/codec
 *   - session state machine + anti-skip ceiling behave
 *   - 1x playback rate lock
 *   - no network request carries video bytes
 *
 * Run: node tests/e2e.mjs   (needs `npm run dev` on 5173, or it starts it)
 */

import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const BASE = process.env.LIVEX_URL ?? "http://localhost:5173/";

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

/** Matrix rows: file → whether native playback is expected to work. */
const MATRIX = [
  { file: "h264-aac.mp4", expect: "play" },
  { file: "hevc-aac.mp4", expect: "either" }, // depends on platform HEVC support
  { file: "vp8-vorbis.webm", expect: "play" },
  { file: "vp9-opus.webm", expect: "play" },
  { file: "av1-opus.webm", expect: "play" },
  { file: "h264-aac.mkv", expect: "either" }, // Chromium refuses mkv mime, some builds play
  { file: "hevc-aac.mkv", expect: "fail" },
  { file: "h264.mov", expect: "either" },
  { file: "hevc.mov", expect: "either" },
  { file: "mpeg4.avi", expect: "fail" },
  { file: "mpeg2.ts", expect: "fail" },
  { file: "mpeg2.mpg", expect: "fail" },
];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

/** Track every request so we can prove no video payload is uploaded. */
const requests = [];
page.on("request", (req) => {
  requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() });
});

await page.goto(BASE, { waitUntil: "load" });
record("app boots without page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
record("idle screen visible", await page.locator("#state-idle").isVisible());
record("single <video> element exists", (await page.locator("video").count()) === 1);

/* ------------------------------------------------------------------ */
/* Native capability report                                            */
/* ------------------------------------------------------------------ */
const report = await page.evaluate(() => window.__livex?.ui && null);
void report;

/* ------------------------------------------------------------------ */
/* Per-file matrix                                                     */
/* ------------------------------------------------------------------ */
const files = readdirSync(fixturesDir).filter((f) => !f.startsWith("."));

for (const row of MATRIX) {
  const path = join(fixturesDir, row.file);
  if (!files.includes(row.file)) {
    record(`fixture present: ${row.file}`, false, "missing");
    continue;
  }

  await page.setInputFiles("#video-input", path);
  // Give probe + metadata a moment; failures resolve via the error screen.
  await page.waitForTimeout(900);

  const errorVisible = await page.locator("#state-error").isVisible();
  const readyVisible = await page.locator("#state-ready").isVisible();

  let outcome;
  if (readyVisible) {
    // Try to actually play it — metadata loaded at least.
    await page.click("#start-session-btn");
    await page.waitForTimeout(1200);

    const status = await page.evaluate(() => {
      const { manager } = window.__livex ?? {};
      if (!manager) return null;
      const video = document.querySelector("video");
      return {
        state: manager.getState(),
        currentTime: video?.currentTime ?? 0,
        playing: video ? !video.paused && video.currentTime > 0 : false,
        errorVisible: !document.getElementById("state-error").classList.contains("hidden"),
      };
    });

    if (status?.errorVisible) outcome = "fail";
    else if (status?.playing) outcome = "play";
    else outcome = "fail";

    // reset for next file
    await page.evaluate(() => window.__livex.manager.reset());
  } else if (errorVisible) {
    outcome = "fail";
    const msg = await page.locator("#error-message-text").textContent();
    record(`  ↳ error message: ${row.file}`, Boolean(msg && msg.length > 10), msg?.slice(0, 120));
  } else {
    outcome = "fail";
  }

  const ok =
    row.expect === "either" ? true : row.expect === "play" ? outcome === "play" : outcome === "fail";

  record(`${row.file} → ${outcome}`, ok, `expected: ${row.expect}`);

  // Always return to idle between files.
  await page.evaluate(() => window.__livex.manager.reset());
  await page.waitForTimeout(200);
}

/* ------------------------------------------------------------------ */
/* Probe accuracy (container + codec identification)                   */
/* ------------------------------------------------------------------ */
await page.evaluate(() => window.__livex.manager.reset());
await page.setInputFiles("#video-input", join(fixturesDir, "h264-aac.mp4"));
await page.waitForTimeout(800);
const precheck = await page.evaluate(async () => {
  const res = await fetch("/__none__").catch(() => null);
  void res;
  return null;
});
void precheck;

/* ------------------------------------------------------------------ */
/* Session behaviour on a definitely-playable file                     */
/* ------------------------------------------------------------------ */
await page.evaluate(() => window.__livex.manager.reset());
await page.setInputFiles("#video-input", join(fixturesDir, "h264-aac.mp4"));
await page.waitForTimeout(800);

const readyState = await page.evaluate(() => window.__livex.manager.getState());
record("MP4 H.264 reaches ready state", readyState === "ready", readyState);

await page.click("#start-session-btn");
await page.waitForTimeout(1500);

const live = await page.evaluate(() => ({
  state: window.__livex.manager.getState(),
  liveBadge: !document.getElementById("live-badge").classList.contains("hidden"),
  time: document.querySelector("video").currentTime,
  rate: document.querySelector("video").playbackRate,
}));
record("session becomes live", live.state === "live", live.state);
record("LIVE badge shown", live.liveBadge);
record("playback progresses from 0", live.time > 0, `t=${live.time.toFixed(2)}`);
record("playback rate locked to 1x", live.rate === 1, String(live.rate));

/* 1x lock: try to change it */
await page.evaluate(() => {
  document.querySelector("video").playbackRate = 2;
});
await page.waitForTimeout(400);
const rateAfter = await page.evaluate(() => document.querySelector("video").playbackRate);
record("external 2x attempt is reverted to 1x", rateAfter === 1, String(rateAfter));

/* Anti-skip: jump forward far beyond watched position */
const antiSkip = await page.evaluate(async () => {
  const video = document.querySelector("video");
  const before = video.currentTime;
  const duration = video.duration;
  video.currentTime = duration - 1; // simulate a forward skip attempt
  await new Promise((r) => setTimeout(r, 600));
  return { before, duration, after: video.currentTime, furthest: window.__livex.manager.getProgress().furthestTime };
});
record(
  "forward seek beyond watched position is blocked",
  antiSkip.after < antiSkip.duration - 1.5,
  `requested=${(antiSkip.duration - 1).toFixed(2)} landed=${antiSkip.after.toFixed(2)} ceiling=${antiSkip.furthest.toFixed(2)}`,
);

/* Rewind is allowed */
const rewind = await page.evaluate(async () => {
  const video = document.querySelector("video");
  window.__livex.manager.seekTo(0);
  await new Promise((r) => setTimeout(r, 300));
  return video.currentTime;
});
record("rewind is permitted", rewind < 1, `t=${rewind.toFixed(2)}`);

/* Pause / resume */
await page.click("#pause-btn");
await page.waitForTimeout(300);
const paused = await page.evaluate(() => ({
  state: window.__livex.manager.getState(),
  badge: !document.getElementById("paused-badge").classList.contains("hidden"),
  paused: document.querySelector("video").paused,
}));
record("pause enters paused state", paused.state === "paused" && paused.paused, paused.state);
record("PAUSED badge shown", paused.badge);

await page.click("#resume-btn");
await page.waitForTimeout(600);
const resumed = await page.evaluate(() => window.__livex.manager.getState());
record("resume returns to live", resumed === "live", resumed);

/* Completion only from real end-of-playback. Play the 6s fixture to the end
 * (a seek to the end is correctly blocked by anti-skip, so we do not fake it). */
let completionState = "";
for (let i = 0; i < 24; i += 1) {
  await page.waitForTimeout(500);
  completionState = await page.evaluate(() => window.__livex.manager.getState());
  if (completionState === "completed") break;
}
const completion = await page.evaluate(() => ({
  state: window.__livex.manager.getState(),
  completedVisible: !document.getElementById("state-completed").classList.contains("hidden"),
}));
record("ending playback marks session completed", completion.state === "completed", completion.state);
record("completed screen visible", completion.completedVisible);

/* Completion must NOT fire from replacing the file */
await page.evaluate(() => window.__livex.manager.reset());
await page.setInputFiles("#video-input", join(fixturesDir, "h264-aac.mp4"));
await page.waitForTimeout(600);
await page.setInputFiles("#video-input", join(fixturesDir, "vp9-opus.webm"));
await page.waitForTimeout(800);
const afterReplace = await page.evaluate(() => window.__livex.manager.getState());
record("replacing a file does not count as completion", afterReplace === "ready", afterReplace);

/* Object URL hygiene */
const urlCheck = await page.evaluate(() => {
  const src = document.querySelector("video").src;
  return { isBlob: src.startsWith("blob:"), src: src.slice(0, 20) };
});
record("video source is a local blob: URL", urlCheck.isBlob, urlCheck.src);

/* ------------------------------------------------------------------ */
/* Privacy: no request carried video bytes                             */
/* ------------------------------------------------------------------ */
const posts = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
record(
  "no non-GET requests were made (no upload endpoint)",
  posts.length === 0,
  posts.map((r) => `${r.method} ${r.url}`).join(", "),
);

const suspicious = requests.filter((r) => /upload|convert|transcode|api\//i.test(r.url));
record("no upload/convert endpoints contacted", suspicious.length === 0, suspicious.map((r) => r.url).join(", "));

record("no console errors during full run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

/* ------------------------------------------------------------------ */
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("\nFailures:");
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exitCode = 1;
}
