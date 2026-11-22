import { chromium } from "playwright";
import { resolve } from "node:path";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(700);
await page.setInputFiles("#video-input", resolve("tests/fixtures/h264-long-40s.mp4"));
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const { annotations, manager } = window.__livex;
  await annotations.add("bookmark", 5);
  await annotations.add("note", 12, "Revisit the derivation");
  await annotations.add("bookmark", 24);
  await manager.startAt(39.4);
});
for (let i = 0; i < 80; i += 1) {
  if ((await page.evaluate(() => window.__livex.manager.getState())) === "completed") break;
  await page.waitForTimeout(250);
}
await page.click("#review-session-btn");
await page.waitForTimeout(200);
console.log(
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".review-check")];
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of list) {
        if (rule.cssText?.includes("checkbox") || rule.cssText?.includes("review-check")) {
          rules.push(rule.cssText);
        }
      }
    }
    return {
      nodes: nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          checked: node.checked,
          background: style.backgroundColor,
          border: style.borderColor,
          matchesChecked: node.matches(":checked"),
          matchesReviewChecked: node.matches(".review-check:checked"),
          html: node.outerHTML,
        };
      }),
      rules: rules.slice(-12),
    };
  }),
);
await page.click("#review-start-btn");
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector("video")?.pause());
await page.screenshot({ path: ".tmp-unslop/08-mobile-player.png", fullPage: true });
await browser.close();
