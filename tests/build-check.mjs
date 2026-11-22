/**
 * Build output smoke test.
 *
 * Guards the "the UI is gone" class of regression: a build that produces a
 * styled, working page when served over http(s) AND when opened directly from
 * disk (`file://`), with zero external requests in both cases.
 *
 * Run after `npm run build`:   node tests/build-check.mjs
 */

import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build` first.");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Static checks on the emitted HTML                                   */
/* ------------------------------------------------------------------ */
const html = readFileSync(join(dist, "index.html"), "utf8");

record(
  "CSS is inlined (no external stylesheet that file:// would block)",
  !html.includes('rel="stylesheet"'),
);
record("script is inlined (no src= module that file:// would block)", !/<script[^>]+src=/.test(html));
record(
  "no crossorigin attributes (they fail over file://)",
  !html.includes("crossorigin"),
);

// Vite inlines the app script into the HTML, and a URL *string* in JavaScript
// (the on-demand YouTube API endpoint, say) is not a resource. Strip script
// bodies so markup attributes and inline CSS are still checked, and let the
// browser checks below prove the page actually fetches nothing external.
const resourceHtml = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
const externalUrls = [...resourceHtml.matchAll(/https?:\/\/[^"')\s]+/g)]
  .map((m) => m[0])
  .filter((u) => !u.startsWith("http://localhost"))
  // SVG/xlink namespaces are identifiers, never fetched.
  .filter((u) => !u.startsWith("http://www.w3.org/"));
// A link href is fine (only followed on click); a resource URL is not.
const resourceUrls = externalUrls.filter((u) => !resourceHtml.includes(`href="${u}"`));
record(
  "no external resource URLs in HTML",
  resourceUrls.length === 0,
  resourceUrls.join(", "),
);

/* ------------------------------------------------------------------ */
/* Serve dist/ locally                                                 */
/* ------------------------------------------------------------------ */
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const file = join(dist, path === "/" ? "index.html" : path);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[join(file).slice(file.lastIndexOf("."))] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(4319, r));
const HTTP_URL = "http://localhost:4319/";

const browser = await chromium.launch();

/** Shared assertions for a loaded page. */
async function assertPage(page, label, { expectExternal }) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const failed = [];
  page.on("requestfailed", (r) => failed.push(`${r.url().split("/").pop()} :: ${r.failure()?.errorText}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(label.startsWith("file") ? pathToFileURL(join(dist, "index.html")).href : HTTP_URL, {
    waitUntil: "load",
  });
  await page.waitForTimeout(1200);

  const style = await page.evaluate(async () => {
    await document.fonts.ready;
    const body = getComputedStyle(document.body);
    const h1 = document.querySelector("#state-idle h1");
    const toolbar = document.querySelector("header nav");
    return {
      bodyBg: body.backgroundColor,
      font: body.fontFamily,
      h1Size: h1 ? getComputedStyle(h1).fontSize : "",
      toolbarBg: toolbar ? getComputedStyle(toolbar).backgroundColor : "",
      cssRules: document.styleSheets[0]?.cssRules?.length ?? 0,
      idleVisible: !document.getElementById("state-idle")?.classList.contains("hidden"),
      fonts: [...document.fonts].filter((f) => f.status === "loaded").length,
    };
  });

  const tag = `[${label}]`;
  record(`${tag} no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  record(`${tag} no failed requests`, failed.length === 0, failed.slice(0, 3).join(" | "));
  record(`${tag} dark theme applied`, style.bodyBg === "rgb(11, 13, 16)", style.bodyBg);
  record(`${tag} Tailwind applied (toolbar styled)`, style.toolbarBg === "rgb(20, 24, 32)", style.toolbarBg);
  record(`${tag} typography applied`, style.h1Size === "30px" && style.font.includes("Inter"), `${style.h1Size} / ${style.font}`);
  record(`${tag} CSS rules present`, style.cssRules > 100, String(style.cssRules));
  record(`${tag} fonts loaded`, style.fonts >= 4, String(style.fonts));
  record(`${tag} idle screen visible`, style.idleVisible === true);

  // The app must actually be wired up (not just pretty markup).
  const wired = await page.evaluate(() => {
    const input = document.getElementById("video-input");
    let opened = false;
    input.click = () => {
      opened = true;
    };
    document.getElementById("open-video-btn")?.click();
    return opened;
  });
  record(`${tag} Open Video is wired`, wired === true);

  const external = requests.filter((u) => /^https?:\/\//.test(u) && !u.startsWith("http://localhost"));
  if (expectExternal === 0) {
    record(`${tag} zero external requests`, external.length === 0, external.slice(0, 3).join(", "));
  }

  // Over file://, every subresource must resolve locally (no ERR_FILE_NOT_FOUND).
  if (label === "file") {
    const remote = requests.filter((u) => /^https?:\/\//.test(u));
    record(`${tag} no remote requests`, remote.length === 0, remote.slice(0, 3).join(", "));
    record(`${tag} fonts resolved locally`, failed.length === 0);
  }

  await page.screenshot({ path: join(here, `build-${label.replace(/[^a-z]/gi, "")}.png`) });
}

const pageHttp = await browser.newPage();
await assertPage(pageHttp, "http", { expectExternal: 0 });

const pageFile = await browser.newPage();
await assertPage(pageFile, "file", { expectExternal: 0 });

await browser.close();
server.close();

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} build checks passed`);
if (failedChecks.length > 0) {
  console.log("\nFailures:");
  for (const f of failedChecks) console.log(` - ${f.name} ${f.detail}`);
  process.exitCode = 1;
}
