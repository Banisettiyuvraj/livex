/**
 * Real-browser verification of YouTube mode.
 *
 * Serves the app with the same dev-style HTML (so `window.__livex` exists) and
 * drives a pasted YouTube link end to end. This is the check that proves the
 * embed actually talks to us — typechecking and unit tests cannot.
 *
 * Run: node tools/verify-youtube.mjs
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { build as esbuild } from "esbuild";
const ROOT = process.cwd();
const VIDEO_ID = "dQw4w9WgXcQ";

/**
 * Compile the real entry with esbuild's JS API (in-process) so this harness
 * exercises the actual application code, not a copy. The CSS import is stubbed
 * because nothing here asserts on styling.
 */
const stubCss = {
  name: "stub-css",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "css-stub" }));
    build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: "", loader: "js" }));
  },
};

const bundleResult = await esbuild({
  entryPoints: [join(ROOT, "src", "main.ts")],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  logLevel: "silent",
  plugins: [stubCss],
  // Same switch a real test build uses: keeps the `window.__livex` test hook.
  define: {
    "import.meta.env.DEV": "true",
    "import.meta.env.VITE_LIVEX_TEST_HOOKS": '"1"',
  },
});

const bundled = bundleResult.outputFiles?.[0]?.text ?? "";
const APP_JS = bundled;

const entryHtml = readFileSync(join(ROOT, "index.html"), "utf8").replace(
  /<script type="module" src="\/src\/main\.ts"><\/script>/,
  '<script type="module" src="/__livex-app.js"></script>',
);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Serve the transformed entry plus real assets, so paths resolve over http. */
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  if (pathname === "/__livex-app.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(APP_JS);
    return;
  }

  let file = join(ROOT, pathname);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  } catch {
    res.writeHead(404).end("not found");
    return;
  }

  try {
    const body = pathname === "/index.html" ? Buffer.from(entryHtml) : await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(500).end("read error");
  }
});

await new Promise((resolve) => server.listen(5199, resolve));
const origin = "http://localhost:5199";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// This harness itself needs the same origin rule the adapter enforces.
const hasDevHook = /\/src\/main\.ts/.test(readFileSync(join(ROOT, "index.html"), "utf8"));
if (!hasDevHook) {
  console.error("index.html no longer references /src/main.ts — update this harness.");
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  // The browser could not be launched here, so we cannot reach a verdict.
  // Exit 2 so a caller can distinguish "not verified" from "verified broken".
  console.error(`\nUNABLE TO VERIFY: ${error.message.split("\n")[0]}`);
  server.close();
  process.exit(2);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  // Record what the page asks YouTube for.
  const network = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/youtube|ytimg|google|gstatic/.test(u)) network.push(u);
  });

  await page.goto(origin + "/", { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const state = () => page.evaluate(() => window.__livex?.manager?.getState() ?? "no-hook");
  const engine = () => page.evaluate(() => window.__livex?.manager?.getEngineId() ?? "none");

  check("app boots with the dev hook", (await state()) === "idle", await state());
  check("local engine is the default", (await engine()) === "native", await engine());

  // --- no Google traffic before consent -------------------------------------
  const beforeConsent = network.length;

  await page.fill("#youtube-input", `https://youtu.be/${VIDEO_ID}`);
  await page.locator("#youtube-input").dispatchEvent("change");
  await page.waitForTimeout(600);

  const dialogVisible = await page.locator("#youtube-consent").isVisible();
  check("first link shows the disclosure", dialogVisible);
  check(
    "no Google request before consent",
    network.length === beforeConsent,
    `${network.length - beforeConsent} request(s)`,
  );

  // --- consent, then the real load -----------------------------------------
  if (dialogVisible) await page.click("#youtube-consent-continue");

  let loaded = "timeout";
  for (let i = 0; i < 60; i += 1) {
    const s = await state();
    if (s === "ready" || s === "error") {
      loaded = s;
      break;
    }
    await page.waitForTimeout(500);
  }

  // Loading and starting are deliberately separate: the LIVE session must
  // begin at 0:00 on the user's Start click, not while the embed is setting up.
  check("a session loads from the pasted link", loaded === "ready", `state=${loaded}`);

  const iframe = page.locator(".livex-yt-host iframe").first();
  const iframeCount = await page.locator("iframe").count();
  check("exactly one player iframe exists", iframeCount === 1, `${iframeCount} iframe(s)`);
  check("the iframe is inside the video slot", (await iframe.count()) === 1);

  if ((await iframe.count()) === 1) {
    const src = await iframe.getAttribute("src");
    check("embed points at the pasted video", Boolean(src?.includes(VIDEO_ID)), src ?? "no src");
    check("embed is the cookie-reduced host", Boolean(src?.includes("youtube-nocookie")), src ?? "");
    check("embed hides YouTube's own controls", Boolean(src?.includes("controls=0")), src ?? "");
    check("postMessage channel is enabled", Boolean(src?.includes("enablejsapi=1")), src ?? "");
    // The API requires an origin for the postMessage handshake.
    check("origin parameter is sent", Boolean(src?.includes("origin=")), src ?? "");
  }

  if (loaded === "ready") {
    await page.click("#start-session-btn");
    let live = "timeout";
    for (let i = 0; i < 20; i += 1) {
      const s = await state();
      if (s === "live" || s === "error") {
        live = s;
        break;
      }
      await page.waitForTimeout(300);
    }
    check("Start begins the pasted session", live === "live", `state=${live}`);
  }

  const progress = await page.evaluate(() => window.__livex.manager.getProgress());
  check("duration is read from the player", progress.duration > 0, `${progress.duration}s`);
  check(
    "playback position advances",
    await (async () => {
      const a = await page.evaluate(() => window.__livex.manager.getProgress().currentTime);
      await page.waitForTimeout(3000);
      const b = await page.evaluate(() => window.__livex.manager.getProgress().currentTime);
      return b > a;
    })(),
    JSON.stringify(progress),
  );

  const badges = await page.evaluate(() => ({
    live: !document.getElementById("live-badge").classList.contains("hidden"),
    chip: document.getElementById("source-chip").textContent,
  }));
  check("LIVE badge is shown", badges.live === true);
  check("source chip says YouTube", badges.chip === "YouTube", badges.chip ?? "");

  // --- captions start off and the CC button toggles them --------------------
  const cc = page.locator("#subtitle-btn");
  check("CC control is shown in YouTube mode", await cc.isVisible());
  check(
    "captions start off",
    (await cc.getAttribute("aria-pressed")) === "false",
    await cc.getAttribute("aria-pressed") ?? "",
  );

  await cc.click();
  await page.waitForTimeout(1_200);
  const captionsOn = await page.evaluate(() => {
    const adapter = window.__livex.manager.getAdapter();
    const track = adapter.player?.getOption?.("captions", "track");
    return {
      state: adapter.areCaptionsEnabled?.() ?? false,
      pressed: document.getElementById("subtitle-btn").getAttribute("aria-pressed"),
      track: track && typeof track === "object" ? track : null,
    };
  });
  check(
    "CC selects a caption track",
    captionsOn.state === true &&
      captionsOn.pressed === "true" &&
      Boolean(captionsOn.track?.languageCode),
    JSON.stringify(captionsOn),
  );

  // Selecting a track is not the same as seeing captions: seek to a lyric and
  // wait for YouTube to paint a caption segment inside the iframe.
  await page.evaluate(() => window.__livex.manager.getAdapter().seek(22));
  const ytFrame = page.frames().find((frame) => frame.url().includes("youtube"));
  let captionSegments = 0;
  let captionText = "";
  for (let i = 0; i < 20 && captionSegments === 0; i += 1) {
    await page.waitForTimeout(500);
    if (!ytFrame) continue;
    const segments = ytFrame.locator(".ytp-caption-segment");
    captionSegments = await segments.count();
    if (captionSegments > 0) captionText = (await segments.allInnerTexts()).join(" ");
  }
  check(
    "captions actually render in the iframe",
    captionSegments > 0,
    captionText || "no caption segment",
  );

  await cc.click();
  await page.waitForTimeout(600);
  const captionsOff = await page.evaluate(() => ({
    state: window.__livex.manager.getAdapter().areCaptionsEnabled?.() ?? false,
    pressed: document.getElementById("subtitle-btn").getAttribute("aria-pressed"),
  }));
  check(
    "CC turns captions off again",
    captionsOff.state === false && captionsOff.pressed === "false",
    JSON.stringify(captionsOff),
  );

  // --- pause / resume through our own controls ------------------------------
  await page.click("#pause-btn");
  await page.waitForTimeout(900);
  check("pause reaches the iframe player", (await state()) === "paused", await state());
  await page.click("#resume-btn");
  await page.waitForTimeout(900);
  check("resume returns to live", (await state()) === "live", await state());

  // --- a second paste while live replaces the player cleanly --------------
  // The same-engine swap must leave live/paused for idle, or the later ready
  // transition is rejected and the old session stays on screen.
  await page.evaluate((url) => {
    const data = new DataTransfer();
    data.setData("text/plain", url);
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, `https://youtu.be/${VIDEO_ID}`);

  let reloaded = "timeout";
  for (let i = 0; i < 60; i += 1) {
    const s = await state();
    if (s === "ready" || s === "error") {
      reloaded = s;
      break;
    }
    await page.waitForTimeout(500);
  }
  const afterRepaste = await page.evaluate(() => ({
    iframes: document.querySelectorAll("iframe").length,
    errorText: document.getElementById("error-message-text")?.textContent ?? "",
    hosts: document.querySelectorAll(".livex-yt-host").length,
  }));
  check("a second paste reloads into ready", reloaded === "ready", `state=${reloaded} error="${afterRepaste.errorText}"`);
  check("a second paste leaves exactly one player", afterRepaste.iframes === 1 && afterRepaste.hosts === 1, JSON.stringify(afterRepaste));

  if (reloaded === "ready") {
    await page.click("#start-session-btn");
    await page.waitForTimeout(1200);
    check("the replaced player starts", (await state()) === "live", await state());
  }

  // --- local files must be unaffected --------------------------------------
  await page.setInputFiles("#video-input", join(ROOT, "tests", "fixtures", "h264-aac.mp4"));
  let localState = "timeout";
  for (let i = 0; i < 40; i += 1) {
    localState = await page.evaluate(() => window.__livex?.manager?.getState() ?? "no-hook");
    if (localState === "ready" || localState === "error") break;
    await page.waitForTimeout(400);
  }
  const afterLocal = await page.evaluate(() => ({
    state: window.__livex?.manager?.getState() ?? "no-hook",
    engine: window.__livex?.manager?.getEngineId() ?? "none",
    errorText: document.getElementById("error-message-text")?.textContent ?? "",
    videoSrc: (() => {
      const v = document.querySelector("video");
      return v ? (v.currentSrc || v.src || "none").slice(0, 24) : "no-video";
    })(),
    videoReadyState: document.querySelector("video")?.readyState ?? -1,
  }));
  check("a local file switches back to the native engine", afterLocal.engine === "native", afterLocal.engine);
  check("the embed is removed on switch", (await page.locator("iframe").count()) === 0);
  check(
    "local file reaches ready",
    afterLocal.state === "ready",
    `state=${afterLocal.state} error="${afterLocal.errorText}" src=${afterLocal.videoSrc} readyState=${afterLocal.videoReadyState}`,
  );

  // The local session must still actually start (the regression guard).
  if (afterLocal.state === "ready") {
    await page.click("#start-session-btn");
    await page.waitForTimeout(1200);
    const localLive = await page.evaluate(() => window.__livex.manager.getState());
    check("the local session starts after YouTube mode", localLive === "live", localLive);
  }

  check("no page errors during the run", errors.length === 0, errors.slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  server.close();
}
