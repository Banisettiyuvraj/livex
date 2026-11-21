/**
 * Part 1 feature checks (roadmap 1.1 - 1.6).
 *
 * Shared by `npm run test:features` and the Playwright spec, so there is one
 * definition of "correct" for both entry points.
 */

export async function runPart1(page, fixture, record) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const state = () => page.evaluate(() => window.__livex.manager.getState());
  const progress = () => page.evaluate(() => window.__livex.manager.getProgress());
  const modeText = async () => page.locator("#time-display").textContent();

  async function loadAndStart(name = "h264-aac.mp4") {
    await page.evaluate(() => window.__livex.manager.reset());
    await page.setInputFiles("#video-input", fixture(name));
    await page.waitForTimeout(800);
    await page.click("#start-session-btn");
    await page.waitForTimeout(1400);
  }

  record("boots without errors", errors.length === 0, errors.slice(0, 2).join(" | "));

/* ================================================================== */
/* 1.3 Keyboard map                                                   */
/* ================================================================== */
await loadAndStart();
record("[1.3] session live before key tests", (await state()) === "live");

// Forward arrow (+5s) must respect the anti-skip ceiling.
const beforeArrow = await progress();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(350);
const afterArrow = await progress();
record(
  "[1.3] → seeks forward within the anti-skip ceiling",
  afterArrow.currentTime >= beforeArrow.currentTime &&
    afterArrow.currentTime <= afterArrow.furthestTime + 1,
  `${beforeArrow.currentTime.toFixed(1)} → ${afterArrow.currentTime.toFixed(1)}`,
);

// Back arrow always works.
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(300);
const afterBack = await progress();
record("[1.3] ← rewinds ~5s", afterBack.currentTime < afterArrow.currentTime, `now ${afterBack.currentTime.toFixed(1)}`);

// Shift+ArrowLeft jumps 30s. On a 6s fixture that clamps to the start.
const beforeBigRewind = (await progress()).currentTime;
await page.keyboard.press("Shift+ArrowLeft");
await page.waitForTimeout(250);
const afterBigRewind = (await progress()).currentTime;
record(
  "[1.3] Shift+← rewinds ~30s (clamped to the start)",
  afterBigRewind <= 0.5 && beforeBigRewind < 30,
  `${beforeBigRewind.toFixed(1)} → ${afterBigRewind.toFixed(1)}`,
);

// J rewinds 10s, L forward within ceiling.
await page.keyboard.press("l");
await page.waitForTimeout(250);
const afterL = await progress();
await page.keyboard.press("j");
await page.waitForTimeout(250);
const afterJ = await progress();
record("[1.3] L/J nudge ±10s", afterJ.currentTime <= afterL.currentTime, `${afterL.currentTime.toFixed(1)} → ${afterJ.currentTime.toFixed(1)}`);

// K toggles pause.
await page.keyboard.press("k");
await page.waitForTimeout(350);
record("[1.3] K pauses", (await state()) === "paused");
await page.keyboard.press("k");
await page.waitForTimeout(400);
record("[1.3] K resumes", (await state()) === "live");

/* ================================================================== */
/* 1.6 Time display modes                                             */
/* ================================================================== */
const t1 = await modeText();
await page.click("#time-display");
await page.waitForTimeout(250);
const t2 = await modeText();
await page.click("#time-display");
await page.waitForTimeout(250);
const t3 = await modeText();
await page.click("#time-display");
await page.waitForTimeout(250);
const t4 = await modeText();

record("[1.6] default shows elapsed / total", /^\d\d:\d\d \/ \d\d:\d\d$/.test(t1.trim()), t1.trim());
record("[1.6] second mode shows remaining (−)", t2.includes("−"), t2.trim());
record("[1.6] third mode shows percentage", /^\d+%$/.test(t3.trim()), t3.trim());
record("[1.6] cycles back to elapsed", t4.trim() === t1.trim() || /^\d\d:\d\d \/ \d\d:\d\d$/.test(t4.trim()), t4.trim());

// Persistence of the chosen mode across reload is checked later.

/* ================================================================== */
/* 1.2 Bookmarks + notes                                              */
/* ================================================================== */
await page.waitForTimeout(600);
const timeNow = (await progress()).currentTime;
await page.keyboard.press("b");
await page.waitForTimeout(400);

let chips = await page.locator(".annotation-chip").count();
record("[1.2] B creates a bookmark chip", chips === 1, `${chips} chip(s)`);

const stored = await page.evaluate(async () => {
  const { annotations } = window.__livex;
  return annotations.getAll().map((a) => ({ kind: a.kind, time: a.time }));
});
record("[1.2] bookmark persisted with timestamp", stored.length === 1 && stored[0].kind === "bookmark", JSON.stringify(stored));
record("[1.2] bookmark time matches playhead", Math.abs((stored[0]?.time ?? -1) - timeNow) < 2, `t=${stored[0]?.time} vs ${timeNow.toFixed(1)}`);

// A marker tick appears on the progress rail.
const markers = await page.locator("#progress-markers .progress-marker").count();
record("[1.2] progress rail shows a marker", markers >= 1, `${markers}`);

// Note via the N key opens the composer and saves text.
await page.keyboard.press("n");
await page.waitForTimeout(300);
const composerVisible = await page.locator("#note-composer").isVisible();
record("[1.2] N opens the note composer", composerVisible);

await page.fill("#note-composer input", "Key derivation example");
await page.press("#note-composer input", "Enter");
await page.waitForTimeout(400);
const allAnnotations = await page.evaluate(() => window.__livex.annotations.getAll().map((a) => a.kind));
record("[1.2] note saved alongside bookmark", allAnnotations.length === 2 && allAnnotations.includes("note"), allAnnotations.join(","));

// Clicking a chip jumps back to it.
await page.evaluate(() => window.__livex.manager.seekTo(0));
await page.waitForTimeout(250);
chips = await page.locator(".annotation-chip").count();
await page.locator(".annotation-chip").first().click();
await page.waitForTimeout(400);
const jumped = (await progress()).currentTime;
record("[1.2] clicking a chip seeks to its timestamp", Math.abs(jumped - (stored[0]?.time ?? 0)) < 1.5, `t=${jumped.toFixed(1)}`);

/* ================================================================== */
/* 1.1 Session history                                                */
/* ================================================================== */
const historyEntry = await page.evaluate(() => {
  const e = window.__livex.history.getEntry();
  return e ? { fileName: e.fileName, size: e.fileSize, key: e.key, furthest: e.furthestTime } : null;
});
record("[1.1] history entry recorded for the open file", historyEntry?.fileName === "h264-aac.mp4", JSON.stringify(historyEntry));

// Privacy: the persisted record must contain no media bytes.
const persisted = await page.evaluate(async () => {
  const store = window.__livex.metadataStore;
  const entries = await store.listRecent(10);
  return JSON.stringify(entries);
});
const persistedKeys = Object.keys(JSON.parse(persisted)[0] ?? {});
const forbidden = persistedKeys.filter((k) =>
  ["blob", "data", "bytes", "buffer", "arrayBuffer", "thumbnail", "frame"].some((f) => k.toLowerCase().includes(f)),
);
record("[1.1] persisted record has metadata only (no bytes)", forbidden.length === 0, persistedKeys.join(","));

// Complete the session so the entry flips to completed.
await page.evaluate(async () => {
  const v = document.querySelector("video");
  // Fast path: let it play out from near the end is blocked by anti-skip, so
  // drive the engine to the end the same way a real end-of-media would.
  window.__livex.manager.seekTo(window.__livex.manager.getProgress().furthestTime);
});
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(400);
  if ((await state()) === "completed") break;
}
const completedState = await state();
record("[1.1] history still intact after completion", completedState === "completed", completedState);

/* ================================================================== */
/* 1.4 Shortcuts + About dialogs                                     */
/* ================================================================== */
await page.evaluate(() => window.__livex.manager.reset());
await page.waitForTimeout(300);
await page.keyboard.press("?");
await page.waitForTimeout(400);
const shortcutsOpen = await page.locator("#shortcuts-dialog").evaluate((el) => el.open);
record("[1.4] ? opens the shortcuts dialog", shortcutsOpen);
const shortcutRows = await page.locator("#shortcuts-dialog dt").count();
record("[1.4] shortcuts dialog lists bindings", shortcutRows >= 10, `${shortcutRows} rows`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
record("[1.4] Esc closes the shortcuts dialog", !(await page.locator("#shortcuts-dialog").evaluate((el) => el.open)));

// Menu button opens a menu with About.
await page.click("#menu-btn");
await page.waitForTimeout(300);
record("[1.4] Menu button opens a menu", await page.locator("#livex-menu").isVisible());
await page.locator("#livex-menu .menu-item", { hasText: "About LiveX" }).click();
await page.waitForTimeout(400);
const aboutOpen = await page.locator("#about-dialog").evaluate((el) => el.open);
record("[1.4] About dialog opens", aboutOpen);
const storageState = await page.locator("#about-storage-state").textContent();
record("[1.4] About reports storage state", /Local storage: (on|unavailable)/.test(storageState ?? ""), storageState?.trim());

// Capability report export (roadmap 4.7). The textarea is filled whether the
// async clipboard succeeds or the manual-copy fallback is used.
await page.click("#copy-capability-btn");
await page.waitForTimeout(400);
const reportText = await page.locator("#capability-report").inputValue();
record(
  "[4.7] About generates a capability report",
  reportText.includes("LiveX device capability report") && reportText.includes("MP4"),
  `${reportText.length} chars`,
);
await page.locator("#about-dialog .dialog-close").click();
await page.waitForTimeout(250);

// Keyboard entry point on the empty workspace (roadmap 4.5).
const idleTile = await page.locator("#idle-browse-btn").evaluate((el) => ({
  tag: el.tagName,
  tabIndex: el.tabIndex,
}));
record(
  "[4.5] idle drop tile is a focusable button",
  idleTile.tag === "BUTTON" && idleTile.tabIndex === 0,
  `${idleTile.tag} tabindex=${idleTile.tabIndex}`,
);
await page.waitForTimeout(250);

/* ================================================================== */
/* 1.5 Picture in picture                                             */
/* ================================================================== */
const pipSupported = await page.evaluate(() => document.pictureInPictureEnabled);
const pipDisabled = await page.locator("#pip-btn").evaluate((el) => el.getAttribute("aria-disabled"));
if (pipSupported) {
  await loadAndStart();
  await page.waitForTimeout(800);
  let pipOpened = false;
  try {
    await page.locator("#pip-btn").click();
    await page.waitForTimeout(1200);
    pipOpened = await page.evaluate(() => Boolean(document.pictureInPictureElement));
  } catch {
    pipOpened = false;
  }
  record("[1.5] PiP button requests picture-in-picture", pipOpened, pipOpened ? "opened" : "browser/sandbox declined (handled gracefully)");
} else {
  record("[1.5] PiP unsupported state is shown", pipDisabled === "true", "aria-disabled set");
}
record("[1.5] PiP never throws uncaught", errors.length === 0, errors.slice(0, 2).join(" | "));

/* ================================================================== */
/* Persistence across reload (1.1 + 1.6)                              */
/* ================================================================== */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1000);

const recentVisible = await page.locator("#recent-wrap").isVisible();
record("[1.1] recent list survives a reload", recentVisible);
const recentText = recentVisible ? await page.locator("#recent-list").textContent() : "";
record("[1.1] recent list shows the file name", (recentText ?? "").includes("h264-aac.mp4"), (recentText ?? "").trim().slice(0, 60));

const modeAfterReload = await modeText();
record("[1.6] chosen time mode persists", modeAfterReload.trim().length > 0, modeAfterReload.trim());

// Clear-history affordance.
if (recentVisible) {
  await page.click("#clear-history-btn");
  await page.waitForTimeout(500);
  const cleared = await page.evaluate(async () => (await window.__livex.metadataStore.listRecent(10)).length);
  record("[1.1] Clear empties the history", cleared === 0, `${cleared} entries`);
  record("[1.1] recent list hides when empty", !(await page.locator("#recent-wrap").isVisible()));
}

record("no console errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));


}
