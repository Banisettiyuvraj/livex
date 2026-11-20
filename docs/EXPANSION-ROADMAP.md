# LiveX — Expansion & Improvement Suggestions

A prioritised backlog for taking LiveX from "works well for one local video" to a
genuinely useful tool. Each item notes **why**, **what it costs**, and **what it
would need** — so you can pick without re-reading the codebase.

Current state: static site, TypeScript + Vite, native playback behind a
`PlaybackAdapter`, local-only files, ~28 kB JS. No backend, no accounts.

---

## Part 0 — Fixes applied in this pass

So this doc does not repeat solved problems:

| Problem | Fix |
| --- | --- |
| Toolbar buttons (menu, pan, select, annotate, bookmark, settings) did nothing | Marked `data-unavailable`, dimmed, `aria-disabled`, non-focusable. They stay for design fidelity but no longer read as broken. |
| Bottom zoom controls (− / 100% / +) did nothing | Same treatment. |
| Duplicate "Open Video" control on the idle screen | Replaced with a non-interactive "or press ⌘O / Ctrl+O" hint; the toolbar button is the single entry point. |
| Duplicate `video.mp4` placeholder filenames | Removed; the fields now start empty and are filled from real metadata. |
| `⌘O` shown to Windows users | Labels are platform-aware (`Ctrl+O` on Win/Linux) — 3 sites, set once in `WorkspaceUI`. |
| Unsupported file left session state at `idle` while the error screen showed | Pre-flight failures now drive `SessionManager.reportFailure()` → state `error`, so state and screen never disagree. |

---

## Part 1 — High-value, low-risk ✅ SHIPPED in v1.3

All six items are implemented and covered by `tests/e2e/features.spec.ts`
(37 checks, driven by `tests/e2e/suites/part1.mjs`).
See the implementation notes at the end of this section.

These add real utility without touching the architecture or privacy model.

### 1.1 Real session history (IndexedDB, metadata only)

Store **name, duration, furthest-time, completed-at, last-opened** — never the
video bytes. Gives you a "Continue where you left off" list and replaces the
throwaway session with something that has memory.

- Cost: ~150 LOC + `LocalHistoryStore`; fits beside `LocalFileManager`.
- Care: the plan forbids persisting *video*; metadata is a different thing. Make
  that boundary explicit in the store's interface.
- Enables: resume-within-a-session, streaks, "3 sessions this week".

### 1.2 Designated-note-taking ("annotations") — the toolbar finally earns itself

The pen and bookmark buttons already exist in the design. Implement them as
timestamps + text stored locally per file (keyed by name + size + duration hash).

- Bookmark: "revisit 04:12" chips under the progress bar.
- Annotation: a note transport at `t=4:12` shown when playback passes it.
- Cost: medium (~400 LOC), no backend.

### 1.3 Keyboard-first control

Already partial (`Space`, `M`, `F`). Add:

| Key | Action |
| --- | --- |
| `←` / `→` | −5s / +5s (the `→` still respects the anti-skip ceiling) |
| `Shift+←` / `Shift+→` | −30s / +30s |
| `J` / `K` / `L` | Rewind 10s / pause / forward 10s (YouTube muscle memory) |
| `Esc` | Exit fullscreen / dismiss |
| `?` | Shortcut overlay |

- Cost: low (~80 LOC in `bindKeyboard`). High perceived polish.

### 1.4 A real `?` shortcuts panel and an About dialog

Both are one small `<dialog>`. Makes the app feel finished and gives the Menu
button something real to do.

### 1.5 Picture-in-Picture

`requestPictureInPicture()` on the existing element. Lets students keep a lecture
visible while taking notes elsewhere — very natural for this product.

- Cost: low (~40 LOC). Needs a graceful "not supported" state.

### 1.6 Progress and remaining-time display modes

Show `03:12 / 22:40`, or `−19:28` remaining, or percentage. A single toggle in
the control bar. Small change, frequent request.

### Implementation notes (v1.3)

| Item | Where | Notes |
| --- | --- | --- |
| 1.1 history | `src/files/LocalMetadataStore.ts`, `src/session/SessionHistoryService.ts` | IndexedDB, two object stores. Key = `name::size::duration`. Flushes throttled to 5s + on pause/complete. Degrades to a pure player if IndexedDB is blocked. |
| 1.2 annotations | `src/session/AnnotationService.ts`, `WorkspaceUI.renderAnnotations` | Chips + rail ticks. `B` bookmarks, `N` opens an inline composer (auto-pauses, resumes after save). Notes surface once as a transport bar when playback crosses them going forward. |
| 1.3 keyboard | `WorkspaceUI.bindKeyboard` | `←/→` 5s, `Shift+←/→` 30s, `J/K/L`, `Esc`, `?`. All seeking is routed through `SessionManager.seekTo`, so the anti-skip ceiling still applies. |
| 1.4 dialogs | `#shortcuts-dialog`, `#about-dialog`, `WorkspaceUI.showMenu` | Native `<dialog>`; backdrop/Esc close. The Menu button now opens a real menu (Open, Shortcuts, PiP, About). |
| 1.5 PiP | `WorkspaceUI.togglePictureInPicture` | Uses `document.pictureInPictureEnabled` for a graceful unsupported state; failures are caught and announced, never thrown. |
| 1.6 time modes | `WorkspaceUI.formatTimeDisplay` / `cycleTimeMode` | Click the readout to cycle elapsed → remaining → percent. Choice persists in `localStorage` (a display preference, not media data). |

**Design decisions worth keeping:**

- History and notes store a **fingerprint**, not the `File`. Browsers do not expose
  past `File` objects, so a remembered entry can only offer "pick this file again"
  — it cannot silently resume. That limitation is shown honestly in the UI copy.
- `localStorage` is used only for the time-format preference; all media metadata
  lives in IndexedDB so one "Clear saved data" action can wipe it wholesale.
- Existing toolbar buttons (pen, bookmark) were re-enabled rather than adding new
  chrome, so the Stitch design is preserved.

---

## Part 2 — Meaningful product features ✅ SHIPPED in v1.4

### 2.1 "Playback integrity" report instead of a hard anti-skip wall

Anti-skip is a self-discipline tool, and heavy-handed blocking is the #1 thing
users route around. Keep the ceiling, but **log bypasses** (seeking past the
ceiling was attempted at `t`) and show an honest end-of-session summary:

> Watched 92% · 3 skip attempts · longest uninterrupted stretch 14m

This turns an unenforceable restriction into useful self-reporting. It also sets
up stats (2.2) naturally.

- Cost: low–medium. No new subsystem: `SessionManager` already knows the ceiling.

### 2.2 Session analytics (local only)

Per-file and weekly aggregates: watch time, completion rate, average session
length, most-failed-codec. All computed locally from 1.1's store.

- Caveat: do **not** add telemetry. Everything stays on the device.

### 2.3 Chapters and playlist

Two adjacent wins:

- **Chapters**: parse `chapters` from MP4/MKV where present (ffprobe-like read
  of the `chpl`/`chapters` atom) and render a chapter list; combine with 1.2 bookmarks.
- **Playlist**: queue several files; a session runs them in order, advancing on
  `ended`. The state machine already has `completed`; add `advanceTo(next)`.

- Cost: chapters medium (needs a small atom reader), playlist low (UI + queue).

### 2.4 Full-screen "focus mode"

Hide chrome, dim everything but the video, keep only the timer and pause. This
is the "class is running" aesthetic already implied by the LIVE badge. Pure CSS
+ one class toggle; big felt improvement.

### 2.5 Local subtitles / captions

`.vtt`/`.srt` picked from the device (never fetched), attached with
`<track>`. SRT→VTT conversion is ~40 lines. Massive value for lecture content.

### 2.6 Recovery from interrupted sessions

If the tab closes mid-session, offer "Resume at 12:34" on next open (needs 1.1).
Requires a deliberate exception to "always start at 0:00" — make it an explicit
user choice, not a silent resume, to stay true to the spec.

---

### Implementation notes (v1.4)

All six Part 2 items are implemented and covered by
`tests/e2e/features.spec.ts` (69 checks, driven by `tests/e2e/suites/part2.mjs`).

| Item | Where | Notes |
| --- | --- | --- |
| 2.1 integrity | `SessionManager.getIntegrity()`, `#integrity-summary` | Counts skip attempts, media-seconds watched and the longest unbroken forward stretch. Shown on the completed screen. The ceiling still blocks; the report just makes it honest. |
| 2.2 analytics | `src/session/AnalyticsService.ts`, About dialog | Pure `summarise()` over the history store, unit-testable without IndexedDB. Files, finished count, watch time, completion rate and a nearest-to-done hint. |
| 2.3 chapters | `src/files/ChapterReader.ts`, `#chapter-bar` | Walks ISO BMFF boxes for a Nero `chpl` atom inside `moov/udta`. Reuses the probe's head/tail read windows, so no extra I/O. Malformed data returns `[]` rather than throwing. |
| 2.3 playlist | `src/session/PlaylistService.ts`, queue panel + `#queue-badge` | Multi-select or multi-drop builds a queue. A session advances on demand (`Next in queue`, `Shift+N`), not automatically. |
| 2.4 focus mode | `toggleFocusMode()`, `body.focus-mode` | Hides header, footer and the whole control panel; leaves a low-opacity time pill. `Z` toggles, `Esc` exits. |
| 2.5 subtitles | `src/session/SubtitleService.ts`, `#subtitle-btn` | `.vtt` and `.srt` from disk only. SRT is converted to WebVTT in memory; the track is a `blob:` URL revoked on replace and on file change. |
| 2.6 resume | `SessionManager.startAt()`, `#resume-banner` | Explicit offer, never a silent resume. Requires clearing both a 5s floor and 10% of the file so short clips do not nag. The ceiling moves to the resume point. |

**Decisions worth keeping:**

- **Chapters are read, not generated.** ffmpeg's `chpl` writer uses
  `version(1) flags(3) reserved(4) count(1)` — verified by dumping real bytes,
  because the spec is widely misquoted and version 0/1 layouts differ in
  practice.
- **Playlist advancement is manual.** Auto-advance on `ended` would fight the
  "simulated live" framing; the user says when the next item starts.
- **Nothing new is persisted.** The queue holds `File` handles for this page
  session only. Captions and chapters are re-read per file.
- **Subtitle failure is non-fatal.** A bad caption file announces and logs; it
  never disturbs playback or the session state.

---

## Part 3 — Playback depth (the technical roadmap)

### 3.1 Wire the `WasmMediaAdapter` when the gate passes ⛔ NOT NOW

The seam exists and fails closed today. See `docs/FEASIBILITY-WASM.md`. Revisit
only if: (a) evidence shows non-native formats are a large share of real drops,
(b) COOP/COEP headers become available **or** single-threaded decode reaches
near-real-time, and (c) a canvas + WebAudio presenter is budgeted.

If it happens: lazy-load only after a native failure, behind a flag, and never on
the default path.

### 3.2 Codec detail for AVI / TS / PS ⬜ OPEN — recommended next

The probe currently cannot name codecs in those containers (says "container
unsupported"). A minimal AVI `hdrl`/`strf` reader and an MPEG-TS PMT parser would
turn those into precise messages and make the compatibility matrix complete.

- Cost: medium (~200 LOC each, well-scoped).

### 3.3 Streamed probe for large files ⬜ OPEN (low priority)

Today: 64 KB head + up to 2 MB tail. For 10 GB files this is fine, but a proper
`moov` *scan* (box-by-box seeking rather than loading a 2 MB tail) would reduce
memory and handle `moov` anywhere. Low priority but clean.

### 3.4 Capability cache ⬜ OPEN

`canPlayType` results per container/codec are stable for a session. Cache them in
memory (and optionally `localStorage`) to skip repeated probing.

### 3.5 Better memory behaviour on huge files ⬜ OPEN

Object URLs are cheap, but decoding a 4K file on a low-RAM device is not. Add a
"low memory" mode that avoids the tail read and preloads `metadata` only.

---

## Part 6 — YouTube link mode ✅ SHIPPED in v1.5

Paste a YouTube link and it plays as a simulated live session. Full design
record, constraints and non-guarantees: [YOUTUBE-MODE-PLAN.md](./YOUTUBE-MODE-PLAN.md).

| Item | Where | Notes |
| --- | --- | --- |
| URL parsing | `src/files/YouTubeSource.ts` | watch / youtu.be / embed / shorts / live, scheme-less, `t=` and `start=` offsets. Only the validated 11-char id reaches the embed URL |
| Player | `src/playback/YouTubeAdapter.ts` | `PlaybackAdapter` on the IFrame Player API; maps `ENDED`/pause/play, polls position, fails soft offline |
| Engine swap | `SessionManager.setAdapter()` / `loadYouTube()` | exactly one active engine; the outgoing adapter is disposed, listeners preserved |
| Paste + disclosure | `WorkspaceUI.bindYouTubePaste()` | paste anywhere, one-time privacy notice before any Google code loads |
| Mode chrome | `body.youtube-mode` in `app.css` | local-only controls (chapters, captions, PiP, bookmarks) step aside |

**Decisions worth keeping:**

- YouTube's own controls stay visible (`controls=1`). It is what users expect
  from "the same as YouTube", and it keeps the embed within YouTube's terms,
  which permit embedding but forbid circumventing the player.
- The local-file promise is unchanged: no Google code is fetched until the user
  accepts the disclosure, and local sessions still make zero external requests.
- Anti-skip is **advisory** in this mode and the UI says so, because a
  cross-origin iframe cannot be clamped from outside.
- No video is downloaded, proxied or cached — only the id is held, in memory.

---

## Part 4 — Engineering quality

### 4.1 Unit tests ✅ DONE

Implemented: eight Vitest suites under `tests/unit/` covering the pieces that
are pure logic and were previously only reachable through a browser:

- `MediaProbe` — fixture bytes → expected container/codec (uses the real fixtures).
- `SessionState` — every transition pair, including illegal ones.
- `PlaybackErrors` — every `MediaError` code → correct message.
- `format` — `formatTime` edge cases (`NaN`, `0`, `> 1h`).
- plus `sessionManager`, `chapters`, `subtitles`, `analytics`.

Run with `npm run test:unit`. They execute in milliseconds, where the browser
suites take seconds.

### 4.2 Make the E2E suite self-contained ✅ DONE

Implemented: `playwright.config.ts` declares a `webServer`, so `npm test` works
from a clean checkout with no manually started dev server. `testMatch` is
restricted to `tests/e2e/*.spec.ts`; the shared assertion bodies live in
`tests/e2e/suites/part1.mjs` and `part2.mjs` and are imported by
`tests/e2e/features.spec.ts`.

The three standalone runners (`tests/e2e.mjs`, `tests/features.mjs`,
`tests/features2.mjs`) have been **deleted** — they were superseded duplicates
(the feature runners were byte-equivalent to the shared suites, and the E2E
runner's few unique DOM assertions were ported into `livex.spec.ts`).

Pointing the suite at the production bundle needs an env var that is not
portable across shells, so it is documented rather than scripted: set
`LIVEX_TARGET=prod` (the config then builds, serves `dist/` on 4173 and sets
`VITE_LIVEX_TEST_HOOKS=1`).

### 4.3 Bundle Tailwind locally ✅ DONE in v1.2

Done ahead of schedule: `tailwind.config.js` + `postcss.config.js` build the CSS
locally and both font families are self-hosted via `@fontsource/*`, so the page
makes **zero external requests** and works offline. `tests/build-check.mjs`
guards the built output over both `http` and `file://`.

### 4.4 Delete dead files ✅ DONE in v1.2

`style.css` and the pre-upgrade `script.js` are gone. Still open: `localplay/` is
a full nested git repo — make it a proper submodule or drop it, since it is not
part of the build.

### 4.5 Accessibility pass ⬜ OPEN — highest-value remaining item

- The workspace drop zone is not keyboard-reachable; add a focusable
  "drop or browse" target.
- Live region (`aria-live="polite"`) for state changes (LIVE/PAUSED/COMPLETED)
  so screen readers announce them.
- Verify contrast on `text-neutral-500` over `#121212`.
- Focus-visible rings are currently removed by `select-none` styling choices.

### 4.6 Structured error reporting (still local) ⬜ OPEN

A `PlaybackErrorCode` histogram in dev builds only. Never send it anywhere.

### 4.7 Telemetry-free "compatibility report" export ⬜ OPEN

A "Copy device capability report" button in dev/support mode that exports the
`canPlayType` matrix as text — lets users report playback issues without
uploading a file. Directly supports the "no universal support" honesty stance.
`PlaybackCapabilityDetector.describeSupport()` already produces the data.

---

## Part 5 — Stretch / experimental

| Idea | Notes |
| --- | --- |
| WebGPU frame capture for a "thumbnail strip" | Scrub preview frames; expensive, needs care |
| Offline PWA | Service worker caches the app shell; files are already local. Natural fit. |
| Multi-window sessions | Two files, two live sessions side by side — niche but distinctive |
| Local "study timer" overlay | Pomodoro on top of the live session |
| Screen-reader-friendly transcript | Combined with 2.5, auto-scroll to current cue |
| Frame-exact bookmarking | Capture canvas frame at bookmark time as a thumbnail |
| Session replay of notes | Replay annotations as a timeline |

---

## Recommended sequence — status

1. ~~**Part 4.3 + 4.4 + 4.5** — offline Tailwind, delete dead files, a11y pass.~~
   **4.3 and 4.4 done (v1.2). 4.5 still open** and is the highest-value remaining
   item. Cheap, and it hardens the foundation.
2. ~~**1.3 + 1.4 + 1.5** — keyboard, shortcuts panel, PiP.~~ **Done (v1.3).**
3. ~~**1.1 + 2.1** — local history + skip-attempt reporting.~~ **Done (v1.3/v1.4).**
4. ~~**2.5 + 2.3** — subtitles, then chapters/playlist.~~ **Done (v1.4).**
5. ~~**4.1 + 4.2** — unit tests and a self-contained test runner.~~ **Done.**
6. Re-evaluate **3.1** only with real evidence. **Still refused** — see below.
7. **Next up: 3.2** — codec detail for AVI/TS/PS, then **4.5** accessibility.

### Why 3.2 is the next real feature (not 3.1)

`FEASIBILITY-WASM.md` rates AVI/MPEG-2 as *low frequency*, yet those containers
account for 4 of the 14 compatibility fixtures — so the flagship "tell the user
**why** a file failed" behaviour currently degrades to a vague "container
unsupported" for a large share of the tested cases. Reading an AVI `hdrl`/`strf`
header and an MPEG-TS PMT turns those into precise messages for ~200 LOC each,
with no architecture change. It also produces the evidence the 3.1 gate demands:
you cannot claim non-native formats are rare until you can name them.

### What to keep refusing

- No backend, no uploads, no accounts — the local-only promise is the product.
- No DRM claims; anti-skip is a focus aid, not enforcement.
- No universal-format promises; keep reporting measured compatibility.
- No large media engine on the default path.
