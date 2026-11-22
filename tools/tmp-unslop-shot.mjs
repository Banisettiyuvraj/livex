import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const out = resolve(".tmp-unslop");
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("console error:", msg.text());
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/01-idle.png`, fullPage: true });

await page.setInputFiles("#video-input", resolve("tests/fixtures/h264-long-40s.mp4"));
await page.waitForTimeout(1100);
await page.screenshot({ path: `${out}/02-ready.png`, fullPage: true });

await page.click("#start-session-btn");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/03-live.png`, fullPage: true });

const review = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await review.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await review.waitForTimeout(700);
await review.setInputFiles("#video-input", resolve("tests/fixtures/h264-long-40s.mp4"));
await review.waitForTimeout(900);
await review.evaluate(async () => {
  const { annotations, manager } = window.__livex;
  await annotations.add("bookmark", 5);
  await annotations.add("note", 12, "Revisit the derivation");
  await annotations.add("bookmark", 24);
  await manager.startAt(39.4);
});

for (let i = 0; i < 80; i += 1) {
  if ((await review.evaluate(() => window.__livex.manager.getState())) === "completed") break;
  await review.waitForTimeout(250);
}
await review.waitForTimeout(400);
await review.screenshot({ path: `${out}/04-completed.png`, fullPage: true });

await review.click("#review-session-btn");
await review.waitForTimeout(250);
await review.screenshot({ path: `${out}/05-review-setup.png`, fullPage: true });

await review.click("#review-start-btn");
await review.waitForTimeout(800);
await review.evaluate(() => document.querySelector("video")?.pause());
await review.screenshot({ path: `${out}/06-review-player.png`, fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await mobile.waitForTimeout(700);
await mobile.setInputFiles("#video-input", resolve("tests/fixtures/h264-long-40s.mp4"));
await mobile.waitForTimeout(900);
await mobile.evaluate(async () => {
  const { annotations, manager } = window.__livex;
  await annotations.add("bookmark", 5);
  await annotations.add("note", 12, "Revisit the derivation");
  await annotations.add("bookmark", 24);
  await manager.startAt(39.4);
});
for (let i = 0; i < 80; i += 1) {
  if ((await mobile.evaluate(() => window.__livex.manager.getState())) === "completed") break;
  await mobile.waitForTimeout(250);
}
await mobile.click("#review-session-btn");
await mobile.waitForTimeout(200);
await mobile.screenshot({ path: `${out}/07-mobile-review.png`, fullPage: true });

await browser.close();
console.log(out);
