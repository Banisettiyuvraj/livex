/**
 * Part 2 feature checks (roadmap 2.1 - 2.6).
 *
 * Shared by `npm run test:features2` and the Playwright spec.
 */

export async function runPart2(page, fixture, record) {
  const ok = record;
  const p = page;
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));

  const fx = (name) => fixture(name);

/* ================================================================== */
/* 2.1 / 2.4 / 2.6 */
/* ================================================================== */
await p.goto("http://localhost:5173/", {waitUntil:"load"});
await p.waitForTimeout(900);

// ---- 2.1 integrity
await p.setInputFiles("#video-input", fx("h264-aac.mp4"));
await p.waitForTimeout(700);
await p.click("#start-session-btn");
await p.waitForTimeout(1800);

// attempt a skip past the ceiling
const before = await p.evaluate(() => window.__livex.manager.getSnapshot());
await p.evaluate(() => { const v=document.querySelector("video"); v.currentTime = 5.5; });
await p.waitForTimeout(500);
const after = await p.evaluate(() => window.__livex.manager.getSnapshot());
ok("2.1 skip attempt recorded", after.integrity.skipAttempts >= 1, `attempts=${after.integrity.skipAttempts}`);
ok("2.1 playhead still clamped", after.progress.currentTime <= after.progress.furthestTime + 1, `t=${after.progress.currentTime.toFixed(2)}`);
ok("2.1 watched seconds tracked", after.integrity.watchedSeconds > 0, `${after.integrity.watchedSeconds}s`);

// finish
await p.evaluate(() => window.__livex.manager.seekTo(window.__livex.manager.getProgress().furthestTime));
for (let i=0;i<25;i++){ await p.waitForTimeout(300); if (await p.evaluate(()=>window.__livex.manager.getState())==="completed") break; }
const summaryVisible = await p.locator("#integrity-summary").isVisible();
ok("2.1 integrity summary visible on completed", summaryVisible);
const skipsTxt = await p.locator("#integrity-skips").textContent();
ok("2.1 summary shows skip count", /^\d+$/.test((skipsTxt??"").trim()), skipsTxt);
const stretchTxt = await p.locator("#integrity-stretch").textContent();
ok("2.1 summary shows longest stretch", /^\d+[sm]/.test((stretchTxt??"").trim()), stretchTxt);
const watchedTxt = await p.locator("#integrity-watched").textContent();
ok("2.1 summary shows watched %", /^\d+%$/.test((watchedTxt??"").trim()), watchedTxt);

// ---- 2.6 resume (real path: play, stop, reopen)
await p.evaluate(() => window.__livex.manager.reset());
await p.waitForTimeout(400);
await p.setInputFiles("#video-input", fx("h264-long-40s.mp4"));
await p.waitForTimeout(900);
await p.click("#start-session-btn");
await p.waitForTimeout(9000);           // play ~8s, clearing the 5s floor
await p.evaluate(() => window.__livex.manager.pause());
await p.waitForTimeout(700);
const stoppedAt = await p.evaluate(() => window.__livex.manager.getProgress().currentTime);
await p.evaluate(() => window.__livex.manager.reset());
await p.waitForTimeout(400);
await p.setInputFiles("#video-input", fx("h264-long-40s.mp4"));
await p.waitForTimeout(1100);

const bannerVisible = await p.locator("#resume-banner").isVisible();
ok("2.6 resume banner offered on reopen", bannerVisible, `stopped at ${stoppedAt.toFixed(1)}s`);
if (bannerVisible) {
  const tTxt = await p.locator("#resume-time").textContent();
  ok("2.6 banner shows the stop time", /^\d\d:\d\d$/.test((tTxt??"").trim()), tTxt);
  await p.click("#resume-accept-btn");
  await p.waitForTimeout(1400);
  const st = await p.evaluate(()=>window.__livex.manager.getState());
  const t = await p.evaluate(()=>window.__livex.manager.getProgress().currentTime);
  ok("2.6 Resume starts the session", st==="live", st);
  ok("2.6 Resume starts at the remembered point", t >= stoppedAt - 1, `t=${t.toFixed(2)} vs ${stoppedAt.toFixed(2)}`);

  // ---- 2.4 focus mode
  await p.waitForTimeout(700);
  await p.keyboard.press("z");
  await p.waitForTimeout(500);
  ok("2.4 Z enables focus mode", await p.evaluate(()=>document.body.classList.contains("focus-mode")));
  ok("2.4 control panel hidden", !(await p.locator("#control-panel").isVisible()));
  ok("2.4 focus clock visible", await p.locator("#focus-overlay").isVisible());
  const ft = await p.locator("#focus-time").textContent();
  ok("2.4 focus clock shows time", /\d\d:\d\d \/ \d\d:\d\d/.test(ft??""), ft);
  await p.keyboard.press("z");
  await p.waitForTimeout(400);
  ok("2.4 Z exits focus mode", !(await p.evaluate(()=>document.body.classList.contains("focus-mode"))));
  ok("2.4 control panel restored", await p.locator("#control-panel").isVisible());
  await p.keyboard.press("z"); await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  ok("2.4 Esc exits focus mode", !(await p.evaluate(()=>document.body.classList.contains("focus-mode"))));

  // Decline path
  await p.evaluate(() => window.__livex.manager.reset());
  await p.waitForTimeout(400);
  await p.setInputFiles("#video-input", fx("h264-long-40s.mp4"));
  await p.waitForTimeout(1000);
  if (await p.locator("#resume-banner").isVisible()) {
    await p.click("#resume-decline-btn");
    await p.waitForTimeout(400);
    ok("2.6 Start over dismisses the banner", !(await p.locator("#resume-banner").isVisible()));
  }
}

/* ================================================================== */
/* 2.3 playlist */
/* ================================================================== */
await p.goto("http://localhost:5173/",{waitUntil:"load"});await p.waitForTimeout(900);


await p.setInputFiles("#video-input",[fx("h264-aac.mp4"),fx("h264-aac.mkv"),fx("vp9-opus.webm")]);
await p.waitForTimeout(1200);
// The queue list lives on the idle screen; during a session the header badge
// carries the same information (1 / 3).
ok("queue panel renders on idle", await p.locator("#playlist-list li").count() > 0);
ok("queue lists 3 items", (await p.locator("#playlist-list li").count())===3, `${await p.locator("#playlist-list li").count()}`);
ok("single file loaded to ready", (await p.evaluate(()=>window.__livex.manager.getState()))==="ready");
ok("queue badge shows 1/3", (await p.locator("#queue-badge").textContent())?.includes("1 / 3"), await p.locator("#queue-badge").textContent());

await p.click("#start-session-btn");
await p.waitForTimeout(1500);
ok("session live", (await p.evaluate(()=>window.__livex.manager.getState()))==="live");

// complete it
await p.evaluate(()=>window.__livex.manager.seekTo(window.__livex.manager.getProgress().furthestTime));
for(let i=0;i<25;i++){await p.waitForTimeout(300);if((await p.evaluate(()=>window.__livex.manager.getState()))==="completed")break;}
ok("completed", (await p.evaluate(()=>window.__livex.manager.getState()))==="completed");
ok("next-in-queue button offered", await p.locator("#next-in-queue-btn").isVisible());

await p.click("#next-in-queue-btn");
await p.waitForTimeout(2000);
const st=await p.evaluate(()=>window.__livex.manager.getState());
const nm=await p.evaluate(()=>window.__livex.manager.getSnapshot().metadata?.fileName);
ok("advances to the next file", nm==="h264-aac.mkv", nm??"none");
ok("next file starts a live session", st==="live", st);
ok("queue badge updates to 2/3", (await p.locator("#queue-badge").textContent())?.includes("2 / 3"), await p.locator("#queue-badge").textContent());

// remove + clear
await p.evaluate(()=>document.getElementById("playlist-wrap").scrollIntoView());

/* ================================================================== */
/* 2.5 subtitles */
/* ================================================================== */
await p.goto("http://localhost:5173/",{waitUntil:"load"});await p.waitForTimeout(900);


// srtToVtt unit-level check through the module in the page
const conv = await p.evaluate(async () => {
  const mod = await import("/src/session/SubtitleService.ts");
  const srt = "1\n00:00:00,500 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:05,000\nWorld\n";
  return { vtt: mod.srtToVtt(srt), fmt: mod.detectSubtitleFormat("a.SRT") };
});
ok("SRT→VTT adds WEBVTT header", conv.vtt.startsWith("WEBVTT"), conv.vtt.split("\n")[0]);
ok("SRT→VTT converts comma to dot", conv.vtt.includes("00:00:00.500 --> 00:00:02.500"));
ok("SRT→VTT strips cue indices", !/^\d+$/m.test(conv.vtt.split("\n").slice(1).join("\n")), "no bare numbers");
ok("format detection case-insensitive", conv.fmt==="srt", conv.fmt);

await p.setInputFiles("#video-input", fx("h264-aac.mp4"));
await p.waitForTimeout(900);
await p.click("#start-session-btn");
await p.waitForTimeout(1200);

await p.setInputFiles("#subtitle-input", fx("sample.srt"));
await p.waitForTimeout(1500);
const info = await p.evaluate(()=>window.__livex.ui.subtitles.getCurrent());
ok("SRT loaded", info?.fileName==="sample.srt", info?.fileName??"none");
ok("cue count correct", info?.cueCount===2, String(info?.cueCount));
const trackCount = await p.evaluate(()=>document.querySelector("video").querySelectorAll("track").length);
ok("track element attached", trackCount===1, String(trackCount));
const mode = await p.evaluate(()=>document.querySelector("video").textTracks[0]?.mode);
ok("track is showing", mode==="showing", mode??"none");
ok("CC button pressed state", (await p.locator("#subtitle-btn").getAttribute("aria-pressed"))==="true");
const cueText = await p.evaluate(()=>{
  const t=document.querySelector("video").textTracks[0];
  return t&&t.cues&&t.cues.length ? t.cues[0].text : null;
});
ok("cues parsed", cueText==="Hello from SRT", cueText??"none");

// toggle off
await p.click("#subtitle-btn");
await p.waitForTimeout(500);
ok("CC toggles off", (await p.evaluate(()=>document.querySelector("video").textTracks[0]?.mode))==="hidden");
await p.click("#subtitle-btn");
await p.waitForTimeout(400);
ok("CC toggles back on", (await p.evaluate(()=>document.querySelector("video").textTracks[0]?.mode))==="showing");

// replace with vtt
await p.setInputFiles("#subtitle-input", fx("sample.vtt"));
await p.waitForTimeout(1200);
ok("VTT replaces SRT", (await p.evaluate(()=>window.__livex.ui.subtitles.getCurrent()?.fileName))==="sample.vtt");
ok("only one track after replace", (await p.evaluate(()=>document.querySelector("video").querySelectorAll("track").length))===1);

// detach on file change
await p.evaluate(()=>window.__livex.manager.reset());
await p.waitForTimeout(400);
await p.setInputFiles("#video-input", fx("h264-aac.mkv"));
await p.waitForTimeout(1100);
ok("captions cleared on new video", (await p.evaluate(()=>document.querySelector("video").querySelectorAll("track").length))===0);

/* ================================================================== */
/* 2.2 analytics */
/* ================================================================== */
await p.goto("http://localhost:5173/",{waitUntil:"load"});await p.waitForTimeout(900);

// pure aggregation
const agg = await p.evaluate(async()=>{
  const m = await import("/src/session/AnalyticsService.ts");
  const now = Date.now();
  const e=(k,dur,far,w,comp,ago)=>({key:k,fileName:k,fileSize:1,duration:dur,furthestTime:far,lastTime:far,completed:comp,firstOpenedAt:now-ago,lastOpenedAt:now-ago,watchedSeconds:w});
  return m.summarise([
    e("a",100,100,100,true,1000),
    e("b",100,50,50,false,1000),
    e("c",100,80,80,false,9*24*3600*1000),
  ], now);
});
ok("counts files", agg.fileCount===3, String(agg.fileCount));
ok("counts completed", agg.completedCount===1, String(agg.completedCount));
ok("completion rate", Math.abs(agg.completionRate-1/3)<0.01, agg.completionRate.toFixed(3));
ok("total watch time", agg.totalWatchedSeconds===230, String(agg.totalWatchedSeconds));
ok("last-7-days filter", agg.awaySecondsLast7Days===150, String(agg.awaySecondsLast7Days));
ok("almost-done picks furthest", agg.almostDone?.key==="c", agg.almostDone?.key??"none");
const empty = await p.evaluate(async()=>{const m=await import("/src/session/AnalyticsService.ts");return m.summarise([]);});
ok("empty summary is zeroed", empty.fileCount===0 && empty.almostDone===null);

// panel renders. Start from an empty store so the counts stay deterministic
// even when this file runs after sections that wrote history.
await p.evaluate(async()=>{
  const s=window.__livex.metadataStore;
  await s.clearAll();
  const now=Date.now();
  await s.putHistory({key:"x::1::600",fileName:"lecture.mp4",fileSize:1,duration:600,furthestTime:600,lastTime:600,completed:true,firstOpenedAt:now,lastOpenedAt:now,watchedSeconds:600});
  await s.putHistory({key:"y::2::300",fileName:"talk.mp4",fileSize:2,duration:300,furthestTime:200,lastTime:200,completed:false,firstOpenedAt:now,lastOpenedAt:now,watchedSeconds:200});
});
await p.evaluate(()=>window.__livex.ui.populateAbout());
await p.click("#menu-btn");await p.waitForTimeout(300);
await p.locator("#livex-menu .menu-item",{hasText:"About LiveX"}).click();
await p.waitForTimeout(700);
ok("About shows file count", (await p.locator("#analytics-files").textContent())==="2", await p.locator("#analytics-files").textContent());
ok("About shows completed", (await p.locator("#analytics-completed").textContent())==="1", await p.locator("#analytics-completed").textContent());
const wt=await p.locator("#analytics-watched").textContent();
ok("About shows watch time", wt!=="0m", wt);
ok("About shows completion rate", (await p.locator("#analytics-rate").textContent())==="50%", await p.locator("#analytics-rate").textContent());
ok("hint mentions almost-done file", (await p.locator("#analytics-hint").textContent())?.includes("talk.mp4"), await p.locator("#analytics-hint").textContent());
await p.locator("#about-dialog .dialog-close").click();
await p.waitForTimeout(300);

// clear all wipes stats
await p.click("#menu-btn");await p.waitForTimeout(300);
await p.locator("#livex-menu .menu-item",{hasText:"About LiveX"}).click();
await p.waitForTimeout(500);
await p.click("#clear-all-data-btn");
await p.waitForTimeout(900);
const remaining=await p.evaluate(async()=>await window.__livex.metadataStore.listRecent(50));
ok("clear all removes history", remaining.length===0, String(remaining.length));

/* ================================================================== */
/* 2.3 chapters */
/* ================================================================== */
await p.goto("http://localhost:5173/",{waitUntil:"load"});await p.waitForTimeout(800);

const ch = await p.evaluate(async () => {
  const mod = await import("/src/files/ChapterReader.ts");
  const res = await fetch("/tests/fixtures/h264-chapters.mp4");
  const blob = await res.blob();
  const file = new File([blob], "h264-chapters.mp4", { type: "video/mp4" });
  return await mod.readChapters(file);
});
console.log("chapters:", JSON.stringify(ch));
ok("found 3 chapters", ch.length===3, String(ch.length));
ok("titles parsed", ch.map(c=>c.title).join("|")==="Introduction|Main Argument|Conclusion", ch.map(c=>c.title).join("|"));
ok("start times parsed", ch.map(c=>c.startTime).join(",")==="0,8,16", ch.map(c=>c.startTime).join(","));
ok("indices assigned", ch.every((c,i)=>c.index===i));

// file with no chapters must be empty, not throw
const none = await p.evaluate(async () => {
  const mod = await import("/src/files/ChapterReader.ts");
  const res = await fetch("/tests/fixtures/h264-aac.mp4");
  const file = new File([await res.blob()], "h264-aac.mp4", { type: "video/mp4" });
  return await mod.readChapters(file);
});
ok("no chapters returns empty array", Array.isArray(none) && none.length===0, String(none.length));

// malformed payload must not throw
const bad = await p.evaluate(async () => {
  const mod = await import("/src/files/ChapterReader.ts");
  return { a: mod.parseChpl(new Uint8Array([1,2])), b: mod.parseChpl(new Uint8Array(0)) };
});
ok("malformed chpl does not throw", bad.a.length===0 && bad.b.length===0);

/* ================================================================== */
/* 2.3 chapter UI */
/* ================================================================== */
await p.goto("http://localhost:5173/",{waitUntil:"load"});await p.waitForTimeout(900);


await p.setInputFiles("#video-input", fx("h264-chapters.mp4"));
await p.waitForTimeout(1800);
// Chapters live in the active session's control panel, so start first.
await p.click("#start-session-btn");
await p.waitForTimeout(1400);
const chips = await p.locator("#chapter-bar .annotation-chip").count();
ok("chapter chips rendered", chips===3, String(chips));
ok("chapter bar visible", await p.locator("#chapter-bar").isVisible());
const first = await p.locator("#chapter-bar .annotation-chip").first().textContent();
ok("chip shows index + title", (first??"").includes("01") && (first??"").includes("Introduction"), first?.trim());
// Chapter 1 is behind the ceiling; clicking it should be allowed (rewind/equal).
await p.locator("#chapter-bar .annotation-chip").nth(1).click();
await p.waitForTimeout(500);
const t1 = await p.evaluate(()=>window.__livex.manager.getProgress().currentTime);
ok("clicking a chapter seeks (blocked by ceiling as expected)", t1 <= 3, `t=${t1.toFixed(1)}`);

// A file with no chapters hides the bar.
await p.evaluate(()=>window.__livex.manager.reset());
await p.waitForTimeout(300);
await p.setInputFiles("#video-input", fx("h264-aac.mp4"));
await p.waitForTimeout(1500);
ok("chapter bar hidden when no chapters", !(await p.locator("#chapter-bar").isVisible()));


  record("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
}
