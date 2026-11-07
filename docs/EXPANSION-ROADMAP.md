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

All six items are implemented and covered by `tests/features.mjs` (36 checks).
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

## Part 2 — Meaningful product features (medium effort)

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

## Part 3 — Playback depth (the technical roadmap)

### 3.1 Wire the `WasmMediaAdapter` when the gate passes

The seam exists and fails closed today. See `docs/FEASIBILITY-WASM.md`. Revisit
only if: (a) evidence shows non-native formats are a large share of real drops,
(b) COOP/COEP headers become available **or** single-threaded decode reaches
near-real-time, and (c) a canvas + WebAudio presenter is budgeted.

If it happens: lazy-load only after a native failure, behind a flag, and never on
the default path.

### 3.2 Codec detail for AVI / TS / PS

The probe currently cannot name codecs in those containers (says "container
unsupported"). A minimal AVI `hdrl`/`strf` reader and an MPEG-TS PMT parser would
turn those into precise messages and make the compatibility matrix complete.

- Cost: medium (~200 LOC each, well-scoped).

### 3.3 Streamed probe for large files

Today: 64 KB head + up to 2 MB tail. For 10 GB files this is fine, but a proper
`moov` *scan* (box-by-box seeking rather than loading a 2 MB tail) would reduce
memory and handle `moov` anywhere. Low priority but clean.

### 3.4 Capability cache

`canPlayType` results per container/codec are stable for a session. Cache them in
memory (and optionally `localStorage`) to skip repeated probing.

### 3.5 Better memory behaviour on huge files

Object URLs are cheap, but decoding a 4K file on a low-RAM device is not. Add a
"low memory" mode that avoids the tail read and preloads `metadata` only.

---

## Part 4 — Engineering quality

### 4.1 Unit tests (currently only E2E)

We have 37 browser checks but no unit tests. The highest-value units:

- `MediaProbe` — fixture bytes → expected container/codec (already have fixtures!).
- `SessionState` — every transition pair, including illegal ones.
- `PlaybackErrors` — every `MediaError` code → correct message.
- `formatTime` — edge cases (`NaN`, `0`, `> 1h`).

Vitest runs these in milliseconds versus Playwright's seconds.

### 4.2 Make the E2E suite self-contained

`tests/e2e.mjs` currently needs a manually started dev server and a
`window.__livex` dev hook (absent in prod builds). Move to `@playwright/test`
with a `webServer` config so `npm test` just works, in dev **and** against `dist`.

### 4.3 Bundle Tailwind locally

Today the page pulls Tailwind from a CDN plus Google Fonts — the only outbound
requests in the app. Building Tailwind locally makes the page **fully offline**,
shrinks the CSS massively, and removes the CDN as a failure/privacty talking point.
This is the single best privacy/WAF story improvement available.

- Cost: low. `tailwindcss` + a small config mirroring the inline `theme.extend`.

### 4.4 Delete dead files

`style.css` is an unreferenced legacy LocalPlay sheet (493 lines, linked by
nothing) and `script.js` is the pre-upgrade reference. Move both to a
`legacy/` folder or delete. `localplay/` is a full nested git repo — make it a
proper submodule or drop it.

### 4.5 Accessibility pass

- The workspace drop zone is not keyboard-reachable; add a focusable
  "drop or browse" target.
- Live region (`aria-live="polite"`) for state changes (LIVE/PAUSED/COMPLETED)
  so screen readers announce them.
- Verify contrast on `text-neutral-500` over `#121212`.
- Focus-visible rings are currently removed by `select-none` styling choices.

### 4.6 Structured error reporting (still local)

A `PlaybackErrorCode` histogram in dev builds only. Never send it anywhere.

### 4.7 Telemetry-free "compatibility report" export

A "Copy device capability report" button in dev/support mode that exports the
`canPlayType` matrix as text — lets users report playback issues without
uploading a file. Directly supports the "no universal support" honesty stance.

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

## Recommended sequence

1. **Part 4.3 + 4.4 + 4.5** — offline Tailwind, delete dead files, a11y pass.
   Cheap, and it hardens the foundation.
2. **1.3 + 1.4 + 1.5** — keyboard, shortcuts panel, PiP. Visible polish, low risk.
3. **1.1 + 2.1** — local history + skip-attempt reporting. Makes sessions mean something.
4. **2.5 + 2.3** — subtitles, then chapters/playlist.
5. **4.1 + 4.2** — unit tests and a self-contained test runner, before the surface grows.
6. Re-evaluate **3.1** only with real evidence.

### What to keep refusing

- No backend, no uploads, no accounts — the local-only promise is the product.
- No DRM claims; anti-skip is a focus aid, not enforcement.
- No universal-format promises; keep reporting measured compatibility.
- No large media engine on the default path.
