# LiveX — YouTube Mode: Implementation Plan

**Status: IMPLEMENTED AND VERIFIED (v1.5).** Built, wired, and exercised in a
real Chromium by `npm run verify:youtube` (23/23 checks: disclosure fires before
any Google request, the embed loads the pasted id, playback advances, pause and
resume reach the iframe player, switching back to a local file restores the
native engine). This document is kept as the design record and as the place
where the trade-offs are stated, because this feature changes two of LiveX's
headline promises.

**A regression this verification caught, worth remembering:** the first version
of `SessionManager.setAdapter()` disposed the outgoing adapter. Because the
engines are long-lived objects owned by `main.ts` and reattached on re-entry,
picking a local file after a YouTube video left the app holding a disposed
native player — "The player has already been disposed." Static checks and
typechecking all passed; only a real browser run found it. `setAdapter()` now
never disposes the engine it is swapping in.

---

## 0. What was actually built

| File | Role |
| --- | --- |
| `src/files/YouTubeSource.ts` | URL parsing/validation → `{ videoId, startAt }`; pure, no DOM |
| `src/playback/YouTubeAdapter.ts` | `PlaybackAdapter` implemented on the IFrame Player API |
| `SessionManager.loadYouTube()` / `setAdapter()` | engine-agnostic entry point and engine swap |
| `WorkspaceUI.bindYouTubePaste()` | paste capture, consent, busy/error states |
| `index.html` | link field, source chip, one-time disclosure dialog |
| `src/styles/app.css` | `body.youtube-mode` chrome rules |

Behaviour: pasting a YouTube link anywhere on the workspace (or using the idle
field / **Go live**) loads the video and starts a LIVE session immediately — the
paste is the user gesture, so there is no second click. Local files are
unchanged and still start from the **Start Live Session** button.

**Decisions taken:**

1. **YouTube's own controls stay visible** (`controls=1`). That is what "the same
   as YouTube" means to a user, and it keeps the embed inside YouTube's terms.
   Our LIVE chrome sits *around* the player, never instead of it.
2. **The one-time disclosure is required** before the first link loads, and
   nothing — not even the API script — is fetched before the user accepts.
3. **Local mode is untouched.** YouTube is a second engine attached on demand;
   the local-file path still loads zero external bytes.
4. **Anti-skip is advisory in this mode**, and the UI does not claim otherwise:
   with YouTube's controls visible the user can always scrub there. Our ceiling
   still applies to our own seek paths, and the integrity report still counts
   real watch time.

**Known limits, stated rather than hidden:**

- Chapters, subtitles, bookmark chips and PiP are local-file features and are
  hidden in YouTube mode rather than shown as broken.
- The 1× lock is best-effort: YouTube decides which rates a video supports.
- `youtube-nocookie.com` is used as the embed host to reduce cookie writes; if
  Google's player ever refuses it, switch `buildEmbedUrl()` to `www.youtube.com`.

---

## 1. The request

> If the user copies a YouTube link and pastes it into our site, treat that
> YouTube video as a simulated live session.

## 2. Verdict up front

**Buildable — but only as an explicitly gated second mode, and our anti-skip
guarantee weakens from "enforced" to "our chrome requests it".**

Three findings drive the design:

| # | Finding | Consequence |
| --- | --- | --- |
| 1 | YouTube's ToS permits embedding (*"You may also show YouTube videos through the embeddable YouTube player"*) but forbids circumventing features that *"limit the use of the Service"*. `controls=0` is a documented, supported parameter, so hiding the player chrome is legitimate — but using it specifically to lock out YouTube's own seek bar is hostile use of a sanctioned knob. | **Recommendation: do not hide the controls.** Keep YouTube's player intact and honest; add our LIVE framing *around* it. |
| 2 | LiveX's docs and README promise **"zero external requests"** and **"works fully offline"**, and two automated tests enforce it. A YouTube embed cannot honour that by definition. | The promise must be re-scoped to **local-file mode**. YouTube mode is explicitly online, disclosed, and opt-in. |
| 3 | Anti-skip on YouTube is **not enforceable**. The video lives in a cross-origin iframe; the user can open youtube.com, or use any other client. | Presentation must never imply DRM. This is consistent with the existing stance — anti-skip is already documented as a focus aid. |

**If any of those three is unacceptable, the honest answer is: don't build this.**
The rest of the plan assumes they are acceptable.

## 3. What is actually achievable (verified against YouTube's docs)

| Capability | Available? | Mechanism |
| --- | --- | --- |
| Embed a pasted video | ✅ | IFrame Player API (`YT.Player`, `videoId`) |
| Play / pause | ✅ | `playVideo()` / `pauseVideo()` |
| Custom seek bar that clamps forward jumps | ✅ | `seekTo()` + our existing ceiling logic in `SessionManager` |
| Read position / duration | ✅ | `getCurrentTime()` / `getDuration()` (approximate; polled or via `onStateChange`) |
| Detect real end-of-video | ✅ | `onStateChange` → `YT.PlayerState.ENDED` — maps to our `ended` event, so completion semantics survive |
| Lock 1× | ✅ | `setPlaybackRate(1)` — but see the caveat below |
| Suppress YouTube's keyboard shortcuts | ✅ | `disablekb=1` |
| Hide YouTube chrome / branding | ⚠️ | `controls=0` works, but `modestbranding`/`showinfo` are **deprecated and non-functional** — residual branding stays regardless |
| Guarantee no forward skip | ❌ | Cross-origin iframe + the user can leave the page entirely |
| No network requests | ❌ | Impossible |
| Keep our subtitles/chapters features | ❌ | Different player; `ChapterReader`/`SubtitleService` do not apply |

**Caveat on the 1× lock.** YouTube's IFrame API does not guarantee that
`setPlaybackRate` is honoured for every video (rate availability depends on the
video). The lock therefore becomes best-effort: we call it and re-assert it, but
we cannot promise the engine obeys. The UI must not claim otherwise.

## 4. Architecture

The existing seam does most of the work: `SessionManager` depends only on
`PlaybackAdapter`, so a YouTube engine is a new adapter, not a new subsystem.

```
src/playback/YouTubeAdapter.ts   implements PlaybackAdapter via YT.Player
src/files/YouTubeSource.ts       URL parsing/validation -> { videoId, startAt }
                      |
   main.ts: pick the adapter from the pasted source (the ONE place that decides)
                      |
   SessionManager (unchanged: states, ceiling, 1x lock, completion, integrity)
                      |
   WorkspaceUI (mode-aware: swaps the video slot for an iframe slot)
```

### Adapter mapping

| PlaybackAdapter member | YouTube implementation |
| --- | --- |
| `load(file)` | Not applicable — add `loadVideo({ videoId, startAt })` |
| `play()` / `pause()` | `playVideo()` / `pauseVideo()` |
| `seek(t)` | `seekTo(t, true)` |
| `getCurrentTime()` / `getDuration()` | `getCurrentTime()` / `getDuration()` |
| `setPlaybackRate(1)` | `setPlaybackRate(1)` (best effort) |
| `dispose()` | `destroy()` + **remove the injected `<script>`** |
| `ended` event | `onStateChange` → `ENDED` |
| `timeupdate` | `setInterval` poll (~250 ms) or `onStateChange`; YouTube has no fine-grained time event |

### The one interface change

`SessionManager` currently hardcodes "a session starts at 0:00" and reads
duration from the adapter at load. YouTube needs two small, engine-agnostic
additions:

1. `startAt` becomes meaningful for YouTube too — shared with the existing
   resume feature (roadmap 2.6), so no new concept.
2. A `PlaybackSourceKind` (`"local-file" | "youtube"`) so the UI, history and
   privacy disclosure can branch. Keep it on the adapter, not in the UI.

## 5. Privacy and product-impact delta

This is the part that needs your decision, not mine.

| Property | Today (local file) | After YouTube mode |
| --- | --- | --- |
| Network requests | Zero, enforced by 2 tests | youtube.com / ytimg.com / googlevideo.com streams |
| Offline | Works | Local mode only |
| Cookies / tracking | None | Google may set cookies; YouTube's own docs note that `autoplay=1` triggers *"playback data collection and sharing"* on page load |
| IP / device fingerprint | Not shared | Shared with Google |
| Anti-skip | Clamped in-engine | Advisory only |
| `file://` support | Works (self-contained build) | Degrades — needs an http(s) origin for the embed |

**Mitigations to build in:**

- YouTube mode is **opt-in per paste**, never automatic.
- A **one-time consent notice** on first YouTube paste, stating plainly: this
  loads Google's player, Google may set cookies and see your IP, and skipping
  cannot be enforced. Persist only the dismissal flag.
- Prefer `https://www.youtube-nocookie.com` as the embed host (with a documented
  fallback to `youtube.com` if the API misbehaves there) to reduce cookie writes.
- Re-scope the README claim to "**local files never leave your device and the app
  makes zero external requests in local-file mode**" — the honest version.
- Files are unaffected: history/annotations keep storing only metadata, and
  YouTube entries store a **videoId + renameable title**, never media.

## 6. Test impact (must be updated in the same change, not after)

| Test | Today | Required change |
| --- | --- | --- |
| `livex.spec.ts` → "never sends a network request carrying video bytes" | asserts zero non-local GETs | Parametrise: local mode = unchanged; YouTube mode = allow `youtube.com`/`ytimg.com`/`googlevideo.com` only |
| `livex.spec.ts` → "works with every external request blocked (offline)" | aborts all external | Split into two tests: local mode still plays offline; YouTube mode fails with a clear, friendly message |
| `build-check.mjs` → `externalUrls` must be empty | enforces no external URLs in `dist` | The YouTube API `<script>` is injected at runtime, so this can stay — **verify**, do not assume |
| New unit tests | — | URL parsing: `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, `&t=`/`#t=`, playlist links, garbage input, non-YouTube input, XSS-ish input |
| New E2E | — | paste → consent → iframe with correct `videoId`; live/paused/completed states; forward seek clamped by our chrome |

E2E against real YouTube is **flaky by nature** (ads, consent walls, geo blocks,
rate limits). Prefer: unit-test the parser exhaustively, and E2E-test the
adapter against a **stubbed `YT` object** rather than the live service.

## 7. Phases

| Phase | Work | Deliverable |
| --- | --- | --- |
| **0. Spike** | Prove the embed works in this app: `YT.Player` in the existing slot, `controls=0` vs visible, `youtube-nocookie` viability, whether `ENDED` and `getCurrentTime()` behave, and how fast it loads. | A throwaway page + a written verdict. **Stop here if the spike fails.** |
| **1. Parser** | `YouTubeSource.ts`: parse/validate/normalise; reject non-YouTube and ambiguous input. Pure, zero DOM. | Unit tests green; no UI change. |
| **2. Adapter** | `YouTubeAdapter` implementing `PlaybackAdapter`; `loadVideo`; event mapping; `dispose` removes the script. | `SessionManager` drives it unmodified. |
| **3. Wiring + gate** | Paste handler on the workspace; consent notice; mode flag; engine choice in `main.ts`. | Pasting a link starts a session. |
| **4. UI** | LIVE/PAUSED/COMPLETED badges (existing), "YouTube" source chip, integrity report in advisory wording, error copy for unavailable/private/blocked videos. | Visually consistent with local mode. |
| **5. Features** | History/resume by `videoId`; bookmarks (time-based). **Explicitly out of scope:** subtitles, chapters, 1× guarantee. | Parity where the engine allows. |
| **6. Tests + docs** | The table in §6; README/roadmap/privacy updates. | Claims match reality. |

## 8. Deliberate non-goals

- ❌ Downloading, ripping, transcoding or proxying YouTube media — a **direct ToS
  breach** (automated access / reproducing Content) and out of the question.
- ❌ Hiding YouTube branding (`modestbranding` is dead anyway).
- ❌ Batch-importing a YouTube playlist as our queue in v1 — adds scope, and each
  entry brings its own network footprint.
- ❌ Claiming enforcement. Copy must say the skip ceiling applies to our UI only.

## 9. Open decisions for you

1. **Controls visible (recommended) or `controls=0`?** Visible is defensible and
   honest; hidden is a better "live" illusion but leans on a sanctioned parameter
   to defeat YouTube's own UI.
2. **Consent notice: required or a one-line hint?** Required is slower but keeps
   the privacy story credible.
3. **Separate mode, or replace local-only entirely?** The plan assumes a mode
   switch: local stays the default and keeps every current guarantee.

## 10. Recommendation

Proceed to **Phase 0 only**, with a decision gate. The spike is cheap, and it
answers the questions that decide whether Phases 1–6 are worth the erosion of
the "zero external requests / fully offline" guarantee — which is currently one
of LiveX's strongest, most defensible properties.
