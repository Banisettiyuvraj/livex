# LiveX — Project Context for an AI Collaborator

> **Purpose of this file:** give another AI (or developer) enough context to work
> on LiveX correctly without re-reading the entire repository first. It covers
> what the project is, which repositories it came from, how the code is layered,
> what every major feature does, what is persisted, what is deliberately not
> supported, and which invariants must not be broken.
>
> Last written: 2026-11-22. Project version: **1.4.0**.
> Primary source of truth is always the code plus `README.md`; this document is
> a map, not a replacement.

---

## 1. At a glance

| Field | Value |
| --- | --- |
| Product name | **LiveX** (the UI currently says "Livex" in a few places) |
| Tagline | A local-first simulated live session video player |
| Current version | `1.4.0` (`package.json`, About dialog) |
| Repository | `https://github.com/Banisettiyuvraj/livex` |
| Current branch | `main` |
| License | MIT (`LICENSE`, copyright Yuvraj Banisetti) |
| App type | Static single-page web app. No backend, no accounts, no server-side code |
| Runtime stack | TypeScript + Vite + Tailwind CSS, native browser APIs only |
| Test stack | Vitest (unit), Playwright/Chromium (E2E), custom Node audits |
| Build output | One self-contained `dist/index.html` plus local font files |
| Deployment status | No hosting configuration is committed; the site is not known to be live |
| Main audience | Students watching recorded class/lecture videos |

### One-paragraph summary

LiveX is a browser-based video player that makes a recorded lecture feel like a
live class. The user drops a local video file (or pastes a YouTube link), presses
**Start Live Session**, and watches from the beginning with a simulated `LIVE`
badge. While the session is active, ordinary forward seeking is clamped to the
furthest point already watched, playback speed is locked to 1×, and completion
is only recorded when the video actually ends. Local videos never leave the
device: there is no upload, no backend, no telemetry and no external network
request in local-file mode. It also adds study features around the player:
bookmarks, timestamped notes, chapters, subtitles, a playlist queue, resume
history, focus mode, picture-in-picture and local-only watching statistics.
YouTube support is a separate, explicitly online mode that discloses Google's
embed before loading it.

---

## 2. The problem and product thesis

Recorded lectures can be paused, sped up and skipped, which makes deep watching
hard. LiveX imposes a **personal focus structure** rather than real streaming:

1. A session always starts at `0:00` (unless the user explicitly chooses Resume).
2. Forward seeking beyond the furthest watched point is forced back.
3. Speed is 1×.
4. Completion is honest: only the engine's real `ended` event completes a session.
5. The app reports what actually happened (watched percentage, skip attempts,
   longest uninterrupted stretch) instead of claiming unbreakable enforcement.

The second thesis is **privacy by architecture**. Local files are read with the
File API and exposed to the player as a `blob:` object URL. There is no upload
path in the code. Tailwind and fonts are bundled so the page can run fully
offline. The only online mode is YouTube, and it is opt-in and disclosed.

A deliberate honesty rule runs through the project: **anti-skip is a focus aid,
not DRM**. Client-side restrictions can always be bypassed with developer tools,
and YouTube's cross-origin iframe cannot be clamped at all. The UI and docs must
never imply otherwise.

---

## 3. GitHub repositories and external origins

### 3.1 The project repository

| Repository | Role |
| --- | --- |
| [`Banisettiyuvraj/livex`](https://github.com/Banisettiyuvraj/livex) | The LiveX application itself. `origin` is configured to this URL; local branch `main` tracks it. |

All current application code, tests, docs and assets live in this repository.
Repository visibility should be checked before assuming it is public.

### 3.2 Upstream reference repository

| Repository | Role |
| --- | --- |
| [`syedmugheessali/localplay`](https://github.com/syedmugheessali/localplay) | MIT-licensed local-first video player that inspired LiveX's drag-and-drop/local-playback workflow. A full unmodified clone is vendored at `localplay/` (nested Git repo, currently at commit `37593ba`, "fix: refresh cached theme assets", 2026-08-15). |

Important details:

- `localplay/` is a **reference clone**, not a dependency. It is not imported by
  `src/`, not included in the Vite build, and not part of `dist/`.
- The current LiveX player is a TypeScript rewrite, not a copy of LocalPlay's
  `script.js`.
- LiveX credits LocalPlay in the page footer and in `README.md`.
- The nested `.git` directory makes `localplay/` a repository-inside-a-repository.
  A future maintainer should either turn it into a proper Git submodule or remove
  it from the working tree; it currently adds noise to Git tooling.
- LocalPlay's own feature set is broader/different (snapshots, theater mode,
  etc.). Do not assume LocalPlay files describe LiveX behaviour.

### 3.3 Repositories mentioned but not used

- [`FFmpeg/FFmpeg`](https://github.com/FFmpeg/FFmpeg) and `@ffmpeg/ffmpeg` were
  evaluated in `docs/FEASIBILITY-WASM.md`. **No FFmpeg/WASM engine is bundled.**
  The evaluation was a no-go because of engine size, missing hardware decode,
  performance and static-hosting header constraints.
- No other GitHub repository is a runtime dependency. npm packages are installed
  from the npm registry; GitHub sponsor URLs in `package-lock.json` are metadata,
  not code sources.
- The UI originated as **Google Stitch** exports, not a GitHub repository.The screen exports and design notes are kept under
  `stitch_live_session_simulator/` for design reference only.

---

## 4. Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Markup | Static HTML (`index.html`) | Stitch-exported workspace UI; all screens, dialogs and controls live here |
| Styling | Tailwind CSS 3 + `src/styles/app.css` | Built locally via PostCSS; **no CDN** |
| Fonts | `@fontsource/inter`, `@fontsource/jetbrains-mono` | Self-hosted/bundled; no Google Fonts request |
| Application | TypeScript 5, `strict: true` | No UI framework; direct DOM binding |
| Bundler | Vite 5 | Custom inline-single-file plugin for `file://` support |
| Unit tests | Vitest 2 | Node environment, pure logic, no DOM/IndexedDB |
| Browser tests | Playwright 1.65 | Chromium, manages its own Vite server |
| CI | GitHub Actions | Typecheck, unit, build, audit, Chromium E2E |
| Runtime deps | None | Everything in `devDependencies`; app uses browser APIs |

TypeScript is configured with `noUnusedLocals`, `noUnusedParameters`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`, `isolatedModules` and
`verbatimModuleSyntax`. Sources under `src/` are `.ts`; tests are included in the
typecheck project.

The current visual theme is **dark maroon/red**, not the original purple/grey.
Tailwind token names were kept for compatibility: `accent-purple` is now
`#dc2626` (red) and `accent-purple-light` is `#fca5a5`. Do not "fix" those names
to match their values without updating every usage and test.

Core palette:

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#170c0d` | Page background |
| `surface` | `#241113` | Panels/toolbars |
| `surface-hover` | `#2f171a` | Hover |
| `border` | `#3d2126` | Borders |
| `muted-txt` | `#a19a9a` | Muted copy |
| `accent-purple` | `#dc2626` | Primary red accent |
| `accent-purple-light` | `#fca5a5` | Light red text/icons |
| `live-red` | `#ef4444` | LIVE indicator |

The page also uses a custom dot-grid canvas and bracket decorations defined in
`src/styles/app.css`.

---

## 5. Repository map

```text
livex/
├── index.html                     All app screens, dialogs and static markup (550 lines)
├── src/
│   ├── main.ts                    Composition root: creates adapters, services and UI
│   ├── types/
│   │   ├── media.ts               Session/media/probe/event contracts
│   │   └── globals.ts             webkit fullscreen typings
│   ├── playback/
│   │   ├── PlaybackAdapter.ts     Engine-agnostic interface + typed event emitter
│   │   ├── BrowserVideoAdapter.ts Native <video> engine, blob URL lifecycle
│   │   ├── YouTubeAdapter.ts      YouTube IFrame Player API engine (~1,075 lines)
│   │   ├── WasmMediaAdapter.ts    Fail-closed seam for a future WASM engine
│   │   ├── PlaybackCapabilities.ts canPlayType + probe -> verdict, cached
│   │   └── PlaybackErrors.ts      MediaError -> normalized user-facing errors
│   ├── files/
│   │   ├── LocalFileManager.ts    Extension/MIME gate + probe orchestration
│   │   ├── MediaProbe.ts          Magic-byte container/codec detection (~789 lines)
│   │   ├── ChapterReader.ts       MP4/MOV Nero `chpl` chapter parser
│   │   ├── LocalMetadataStore.ts  IndexedDB history + annotations, fails soft
│   │   └── YouTubeSource.ts       Pure URL/id/start-time parser + embed URL builder
│   ├── session/
│   │   ├── SessionState.ts        State types, transitions, integrity types
│   │   ├── SessionManager.ts      State machine, anti-skip, 1x lock, completion
│   │   ├── SessionHistoryService.ts Recent files + throttled progress persistence
│   │   ├── AnnotationService.ts   Bookmarks, notes, note-crossing events
│   │   ├── PlaylistService.ts     In-memory queue of File handles
│   │   ├── SubtitleService.ts     .vtt/.srt -> WebVTT blob track
│   │   └── AnalyticsService.ts    Pure local stats aggregation
│   ├── ui/
│   │   ├── WorkspaceUI.ts         All DOM binding and feature wiring (~2,147 lines)
│   │   └── format.ts              Time/size/stretch formatting
│   └── styles/
│       └── app.css                Base styles, dot grid, focus mode, dialogs, theme
├── vite-plugins/
│   └── inline-single-file.ts      Inlines CSS/JS for a self-contained build
├── tests/
│   ├── unit/                      10 Vitest suites, 146 tests
│   ├── e2e/
│   │   ├── livex.spec.ts          Core E2E + 12-row compatibility matrix
│   │   ├── features.spec.ts       Harness for Part 1 + Part 2 feature checks
│   │   └── suites/
│   │       ├── part1.mjs          39 detailed feature checks
│   │       └── part2.mjs          69 detailed feature checks
│   ├── fixtures/                  ffmpeg-generated media + VTT/SRT captions
│   └── build-check.mjs            Built-output smoke test over http and file://
├── tools/
│   ├── audit-compatibility.mjs    Fixtures vs spec vs compatibility doc
│   ├── check-dom-ids.mjs          Source-referenced IDs vs markup IDs
│   └── verify-youtube.mjs         Real-Chromium YouTube mode harness (32 checks)
├── docs/
│   ├── TASK-SPEC.md               Original functional specification
│   ├── UPGRADE-AUDIT.md           TypeScript/playback migration audit
│   ├── COMPATIBILITY.md           Measured container/codec matrix
│   ├── FEASIBILITY-WASM.md        Why no WASM engine ships
│   ├── TYPESCRIPT-PLAYBACK-UPGRADE-PLAN.md
│   ├── YOUTUBE-MODE-PLAN.md       YouTube design, trade-offs, ToS notes
│   └── EXPANSION-ROADMAP.md       Shipped v1.3/v1.4 features + open backlog
├── stitch_live_session_simulator/ Original Stitch screen exports (reference only)
├── localplay/                     Unmodified upstream LocalPlay clone (not built)
├── .github/workflows/ci.yml       CI pipeline
├── tailwind.config.js             Local Tailwind palette and fonts
├── postcss.config.js              Tailwind + autoprefixer
├── vite.config.ts                 Single-file/relative-base build config
├── vitest.config.ts                Node unit-test config
├── playwright.config.ts            Dev/prod browser-test harness
├── tsconfig.json                   Strict TypeScript config
├── README.md                      User/developer documentation
├── CHANGELOG.md                   Version history
├── CONTRIBUTING.md                Contribution rules
└── LICENSE                        MIT
```

`dist/` is generated and gitignored. `test-results/` and `tests/*.png` are test
artifacts and are not product assets.

---

## 6. Architecture

### 6.1 Layer diagram

```text
index.html
   │  static Stitch markup + DOM ids
   ▼
src/main.ts  ──────────────────────────────────────────────┐
   │ composition root: chooses engines, constructs services │
   ▼                                                        │
WorkspaceUI (DOM / events / feature wiring)                 │
   │                                                        │
   ├── SessionManager ──► PlaybackAdapter ◄── BrowserVideoAdapter
   │      state machine        interface        YouTubeAdapter
   │      anti-skip                            WasmMediaAdapter (stub)
   │      1x lock
   │      integrity
   │
   ├── LocalFileManager ──► MediaProbe / PlaybackCapabilities
   ├── ChapterReader
   ├── SubtitleService
   ├── PlaylistService
   ├── AnnotationService ─┐
   ├── SessionHistoryService ─┴──► LocalMetadataStore (IndexedDB)
   └── AnalyticsService ──────────► LocalMetadataStore
```

### 6.2 Layering rules

1. **`main.ts` is the only composition root.** It is the one place that decides
   which playback engine drives a session. UI code must never construct an
   engine.
2. **`WorkspaceUI` owns DOM access.** Service/session classes do not query the
   DOM. DOM ids are retrieved through `el()`/`getElementById`; a missing id
   throws immediately and is caught by `tools/check-dom-ids.mjs`.
3. **`SessionManager` depends only on `PlaybackAdapter`.** It has no DOM and no
   knowledge of `HTMLVideoElement`, YouTube or WASM. It can run in Node unit
   tests.
4. **Adapters normalize engine events.** Native `MediaError`s, YouTube state
   changes and future engine failures are translated into the same typed events
   (`loaded`, `play`, `pause`, `timeupdate`, `seek`, `ratechange`, `ended`,
   `volumechange`, `error`, `disposed`).
5. **The privacy boundary lives in `LocalMetadataStore` / adapters.** Video bytes
   enter only via `File` + `URL.createObjectURL`; persistence accepts metadata,
   timestamps and note text only.

### 6.3 Engine swapping

`SessionManager.setAdapter()` switches between the long-lived native and YouTube
adapters. Engines are created once in `main.ts` and reattached when a mode is
re-entered.

**Critical invariant:** `setAdapter()` must **not dispose the incoming adapter**.
An earlier version disposed the outgoing engine and broke returning from YouTube
to a local file ("The player has already been disposed"). Engines are owned by the
composition root; the session switches references and re-subscribes listeners.
Callers return the session to `idle` first.

### 6.4 Typed event flow

`PlaybackAdapter.on(event, listener)` returns an unsubscribe function.
`PlaybackEventEmitter` stores listeners in sets and catches listener exceptions
so one bad DOM handler cannot break playback. `SessionManager` subscribes to the
active adapter and re-subscribes on engine swap while preserving its own
session/progress/error listeners.

---

## 7. Runtime flows

### 7.1 Local file flow

1. **Input:** drag/drop anywhere on the workspace (`#drop-target` plus window
   listeners) or click **Open Video** / the idle tile / `Ctrl+O` (`⌘O` on macOS).
   The hidden file input accepts `video/*` and multiple files.
2. **Cheap validation:** `LocalFileManager.assertLooksLikeVideo()` checks MIME
   (`video/*`) or a known extension. Clearly non-video files are rejected before
   decoding.
3. **Pre-flight probe:** `MediaProbe` reads the first 64 KB and, when needed, up
   to 2 MB from the tail. It identifies the container from magic bytes
   (`ftyp`, EBML, RIFF/AVI, MPEG-TS/PS, Ogg, FLV) and extracts codec ids from
   the container structure. `PlaybackCapabilities` combines that with
   `HTMLVideoElement.canPlayType()` and returns a `supported` verdict plus a
   human-readable reason.
4. **Reject or load:** known-unplayable combinations are rejected before mounting
   with the detected container/codec in the message. Otherwise
   `BrowserVideoAdapter.load(file)` creates a `blob:` URL, assigns `video.src`,
   calls `load()`, and waits for `loadedmetadata` (12-second timeout).
5. **Ready:** metadata is rendered; the session is `ready`. The video does not
   auto-play.
6. **Start:** `SessionManager.start()` seeks to `0`, sets rate `1`, calls
   `play()`, and transitions `ready → live` when the engine reports play.
7. **During playback:** native `timeupdate` updates current time, duration,
   furthest-watched ceiling, integrity counters and the progress UI. A seek past
   the ceiling is clamped and counted as a skip attempt.
8. **Pause/resume:** pause transitions `live → paused`; resume returns to `live`.
   The anti-skip ceiling is preserved.
9. **Completion:** only the engine's `ended` event transitions to `completed`
   (from `live` or `paused`). The end screen shows watched %, skip attempts and
   longest uninterrupted stretch.
10. **Cleanup:** replacing a file or disposing revokes the previous object URL.
    `beforeunload` calls `ui.dispose()`.

### 7.2 YouTube flow

1. **Paste anywhere** on the workspace, use the idle link field, or click
   **Go live**. `firstYouTubeSource()` extracts a URL or bare 11-character id
   from arbitrary pasted text.
2. **Parse and validate** in `YouTubeSource.ts`: accepted hosts are
   `youtube.com`, `youtu.be`, `youtube-nocookie.com`, `m.youtube.com`,
   `music.youtube.com`; accepted paths include `/watch`, `/embed`, `/shorts`,
   `/live`, `/v`; `t=`, `start=` and `#t=` offsets are parsed. Only the validated
   video id is interpolated into the embed URL.
3. **Consent gate:** on first use, a dialog explains that YouTube mode is online,
   Google may set cookies/see the IP, and skipping cannot be enforced. Nothing is
   fetched before the user accepts. The acknowledgement is stored in
   `localStorage` under `livex.youtubeConsent`.
4. **Engine switch:** `main.ts`'s `onEngineChange` attaches `YouTubeAdapter`.
   The adapter injects the IFrame API only after consent and builds a
   `youtube-nocookie.com` embed with `controls=0`, `enablejsapi=1`,
   `playsinline=1`, `rel=0` (and `origin` when available).
5. **Ready, then explicit start:** the link loads into `ready`; **Start Live
   Session** begins playback at `0:00`. The adapter declines to autoplay so the
   session cannot start while the embed is still handshaking.
6. **Session control:** play/pause/seek are mapped to the IFrame API; position is
   polled because YouTube has no fine-grained `timeupdate`. Our own seek paths
   respect the ceiling, but YouTube's cross-origin player remains outside our
   control, so anti-skip is **advisory** in this mode.
7. **Captions:** start off; the shared **CC** button toggles the iframe's caption
   module. There is a known re-enable sequence (`unloadModule("captions")`, track
   selection, reload) documented in the code.
8. **Local-only features step aside:** chapters, local subtitle files,
   bookmarks and PiP are hidden in YouTube mode rather than shown broken. Local
   mode remains unaffected and still makes zero external requests.

### 7.3 Session state machine

States: `idle`, `ready`, `live`, `paused`, `completed`, `error`.

| From | Allowed to |
| --- | --- |
| `idle` | `ready`, `error` |
| `ready` | `live`, `idle`, `error` |
| `live` | `paused`, `completed`, `error`, `idle` |
| `paused` | `live`, `error`, `idle` |
| `completed` | `idle`, `ready` |
| `error` | `idle`, `ready` |

Invalid transitions are logged and ignored. `canTransition()` returns true for
same-state transitions.

Key rules:

- A new local file resets tracking and enters `ready`; it never auto-starts.
- A new session starts at 0 and 1×. The only exception is an **explicit**
  resume from a saved position.
- Forward seeking is clamped to `furthestTime`; rewinding is always allowed.
- `1×` is re-applied on every `ratechange` while `live` or `paused`.
- Completion is only recorded from a real `ended` event. Replacing a file,
  closing the tab or abandoning playback must not count as completion.
- HTML5 fires `pause` immediately before `ended`; `SessionManager` defers the
  pause transition by one macrotask and cancels it when `ended` arrives. This is
  why `paused → completed` is a legal transition.
- YouTube adapter swapping must preserve this behaviour and not dispose engines.

### 7.4 Anti-skip mechanics

- `furthestTime` tracks the largest position reached during `live`.
- `SEEK_TOLERANCE = 0.35s` absorbs timeupdate jitter.
- A seek more than `furthestTime + 0.35 + 0.5s` forward is treated as a skip:
  increment `skipAttempts`, seek back to `furthestTime`, and hold a guard for one
  macrotask so the correction seek does not re-trigger.
- Rewinds are intentional and do not increment skip attempts.
- The UI progress bar is intentionally non-seekable (`cursor-not-allowed`).
- Anti-skip is a focus aid, not tamper-proof DRM.

---

## 8. Data, storage and privacy

### 8.1 Local-file privacy guarantee

- Video bytes are read through the File API and handed to the player only as a
  `blob:` object URL.
- The URL is revoked when the file is replaced and on dispose.
- There is no upload endpoint, no server, no analytics/telemetry, and no
  external request in local-file mode.
- Tailwind CSS and both font families are bundled/self-hosted, so the page works
  offline after load.
- Automated tests abort all non-localhost requests and assert that a full local
  session still plays. Another test asserts zero non-GET requests during a local
  session.

### 8.2 What is stored where

| Data | Storage | Contents | Removable? |
| --- | --- | --- | --- |
| Session history | IndexedDB `livex` v1, `history` store | File name, size, duration, last position, furthest position, completed flag, first/last opened timestamps, total watched seconds | Yes — **Clear saved data** in About |
| Bookmarks/notes | IndexedDB `livex` v1, `annotations` store | Media fingerprint, kind (`bookmark`/`note`), timestamp, note text (max 500 chars), creation time | Yes — per annotation and via **Clear saved data** |
| Time display preference | `localStorage` `livex.timeDisplayMode` | `elapsed` / `remaining` / `percent` | Yes — clear site data |
| YouTube consent | `localStorage` `livex.youtubeConsent` | Acknowledgement flag only | Yes — clear site data |
| Playlist queue | Memory only | `File` handles for the current page | Dies on reload |
| Subtitles | Memory / blob URL | Converted WebVTT text | Revoked on replace/dispose |
| Chapters | Memory | Parsed `chpl` data | Re-read per file |
| YouTube video | Not stored | Only validated id/title in memory | N/A |

### 8.3 Fingerprinting, not content hashing

Local files are identified by:

```text
mediaFingerprint = `${name}::${size}::${duration rounded to 0.1s}`
```

This is intentional: the app must not read/store media content. Consequence:
two different files with the same name, byte size and duration would collide.
Mention this if changing history or annotation semantics.

### 8.4 Storage failure behaviour

`LocalMetadataStore` fails soft. If IndexedDB is unavailable, blocked, private,
or over quota, every operation resolves to empty/no-op, `isAvailable()` is false,
and LiveX still works as a plain player. Do not make persistence a hard
dependency.

### 8.5 YouTube mode is the disclosed exception

- Only YouTube mode contacts Google (`youtube-nocookie.com` embed plus its own
  assets/streams).
- The first YouTube paste shows a one-time disclosure **before** any Google code
  is fetched.
- Local files remain unaffected by the consent flag.
- `file://` local mode works; YouTube embeds need an http(s) origin.
- Hiding YouTube's controls with `controls=0` is documented as a ToS grey area in
  `docs/YOUTUBE-MODE-PLAN.md`. No DRM or enforcement claim is made.

### 8.6 Security notes

- The YouTube parser accepts only an 11-character id from `[A-Za-z0-9_-]`; no
  other pasted text reaches the embed URL. `URL` parsing is used rather than
  string concatenation.
- UI code inserts filenames/note text with `textContent`, not raw HTML.
- The capability report contains version, engine, user agent, platform,
  timestamp and `canPlayType` results — **no filenames, paths or media data**.
- Do not add a backend, upload endpoint, remote logging, or third-party runtime
  script to local mode.

---

## 9. Feature inventory

### 9.1 Core playback and session

- Drag-and-drop or file picker for local videos; multi-select supported.
- Local video loaded via object URL, never uploaded.
- Simulated `LIVE` / `PAUSED` / `SIMULATED LIVE` / `COMPLETED` states.
- Explicit **Start Live Session**; no auto-start.
- Play/pause/resume, volume/mute, fullscreen.
- Playback speed locked to `1×` during a session.
- Forward-seek ceiling with rewinding allowed.
- Completion only from a real `ended` event.
- Session completion/reset and "Open Another Video".
- One `<video>` element, moved between ready and active slots.
- Object URL revocation on replace/dispose.
- Session state announcements through an ARIA live region.

### 9.2 Time and progress

- Elapsed / total time readout.
- Click the time readout to cycle: elapsed → remaining → percentage. Preference
  persists in `localStorage`.
- Progress bar with bookmark/note markers.
- Playback integrity summary at completion:
  - watched percentage,
  - skip attempts,
  - longest uninterrupted stretch.

### 9.3 Bookmarks and timestamped notes

- `B` bookmarks the current time.
- `N` opens an inline note composer at the current time (auto-pauses, resumes
  after save/cancel).
- Bookmarks render as chips and rail ticks; click to jump.
- Notes are capped at 500 characters.
- When playback crosses a note's timestamp going forward, the note appears once
  in a transport bar.
- Stored locally per file fingerprint; never uploaded.
- Notes/bookmarks are hidden in YouTube mode (different media identity).

### 9.4 History, resume and analytics

- "Continue where you left off" list with recent files and progress.
- History stores metadata only, never video.
- Progress flushed at most every 5 seconds and on pause/complete.
- On reopening a previously watched file, an **explicit** resume banner offers
  `Resume` or `Start over`; never a silent jump.
- Resume is offered only if the saved position is at least 5 seconds in and at
  least 10% of the file.
- Resuming moves the anti-skip ceiling to the resume position.
- About dialog shows local-only stats: files, finished count, watch time,
  completion rate, and a nearest-to-done hint.

### 9.5 Keyboard control

| Key | Action |
| --- | --- |
| `Space` / `K` | Play / pause |
| `←` / `→` | Back 5s / forward 5s |
| `Shift + ←` / `→` | Back 30s / forward 30s |
| `J` / `L` | Back 10s / forward 10s |
| `B` | Bookmark current time |
| `N` | Note at current time |
| `P` | Picture in picture |
| `Z` | Focus mode |
| `Shift + N` | Next file in queue |
| `M` | Mute / unmute |
| `F` | Fullscreen |
| `Esc` | Exit fullscreen/focus mode or close dialog |
| `?` | Shortcuts panel |
| `Ctrl/⌘ + O` | Open a video |

Keyboard shortcuts are ignored while typing in an input/textarea. Shortcut hints
are platform-aware (`⌘O` vs `Ctrl+O`).

### 9.6 Picture-in-picture, focus mode and dialogs

- Picture-in-picture uses `requestPictureInPicture()` with a graceful
  unsupported/error announcement.
- Focus mode (`Z`) hides header, footer and controls, leaving the video and a
  low-opacity time pill; `Esc` exits.
- Native `<dialog>` panels: Menu, Keyboard shortcuts, About, YouTube consent.
- About includes version, storage availability, active engine, local stats,
  capability report copy, and **Clear saved data**.

### 9.7 Chapters and playlist

- MP4/MOV chapters are read from Nero `chpl` atoms in `moov/udta`; clickable
  chips jump to chapter starts.
- Chapters are read from the file's existing head/tail read windows; no extra
  full-file read and no generated chapters.
- QuickTime `chap`-track chapters are deliberately out of scope.
- Multi-file drop/multi-select builds an in-memory queue.
- Queue can be cleared, selected, removed and advanced manually.
- **Next in queue** (`Shift+N`) only advances when the user asks; no automatic
  advance on completion, preserving the live-session framing.
- Queue is not persisted; `File` handles die with the page.

### 9.8 Local subtitles

- Load `.vtt` or `.srt` from disk; no subtitle fetching.
- SRT is converted to WebVTT in memory.
- Cue count is validated; empty/broken files produce a non-fatal message.
- Attached as a `<track>` with a `blob:` URL, revoked on replace/file change.
- CC button toggles the native track in local mode.
- Max subtitle file size: 8 MB.
- Local-only; hidden in YouTube mode (YouTube's own CC is used there).

### 9.9 YouTube mode

- Paste a YouTube link anywhere, or use the idle field / **Go live**.
- Accepts `watch?v=`, `youtu.be`, `/embed/`, `/shorts/`, `/live/`, bare ids,
  scheme-less URLs, and `t=`/`start=`/`#t=` offsets.
- Playlist URLs are recognized but not played as a single session.
- One-time online/privacy disclosure before loading Google code.
- Embeds through `youtube-nocookie.com`; `controls=0`; custom LIVE chrome.
- Starts only when the user clicks Start.
- Pause/resume/seek/position/duration mapped through the IFrame API.
- Anti-skip and 1× lock are **best-effort/advisory** in this mode.
- CC toggles YouTube captions.
- Local-only features (chapters, subtitle files, PiP, bookmarks) step aside.
- No downloading, proxying, transcoding or caching of YouTube media.
- Only the video id is held in memory; no YouTube entry is added to local
  history/analytics.

### 9.10 Compatibility diagnosis and reporting

- Real container detection from magic bytes, not extension trust.
- Codec ids extracted for ISO BMFF (MP4/MOV), Matroska/WebM, AVI, MPEG-TS and
  MPEG-PS.
- Known-unplayable combinations rejected before mounting, with a reason naming
  the detected container/codec and a conversion recommendation.
- Runtime `MediaError` codes normalized into specific headings/messages.
- Metadata wait has a 12-second timeout, avoiding an indefinite blank frame.
- **Copy capability report** in About, with clipboard fallback to a selectable
  textarea over `file://` or when clipboard permission is denied.

### 9.11 Accessibility

- Accessible names on icon-only controls.
- `aria-live` session announcer.
- Focus-visible rings on interactive controls.
- Focus is moved to the primary action after a screen change.
- Decorative SVGs and the full-window drop overlay are `aria-hidden`.
- Label on the volume slider and video element.
- The idle visual drop tile is a real `<button>` (`#idle-browse-btn`).
- Contrast tokens were adjusted for WCAG AA.
- Known gap: `prefers-reduced-motion` is not fully honoured; not tested with a
  real screen reader.

---

## 10. Supported media and compatibility

Compatibility is **container + codec + browser/device**, not extension.
`docs/COMPATIBILITY.md` contains the measured 12-row matrix and is enforced
against fixtures by `tools/audit-compatibility.mjs`.

| Container | Typical codecs | Behaviour |
| --- | --- | --- |
| MP4 (`.mp4`) | H.264 + AAC | Plays |
| MP4 | HEVC | Engine/OS-dependent; plays where the platform decodes it |
| MP4 | AV1 | Plays in supporting browsers |
| WebM | VP8/Vorbis, VP9/Opus, AV1/Opus | Plays |
| MKV | H.264 + AAC | Usually plays; browser gets the final say |
| MKV | HEVC | Rejected pre-flight (browser demuxer limitation) |
| MOV | H.264 or HEVC | Plays where supported; `canPlayType` can be misleading |
| AVI | MPEG-4 Part 2/MP3 | Rejected pre-flight with detected codec |
| MPEG-TS | MPEG-2/MPEG audio | Rejected pre-flight with detected codec |
| MPEG-PS | MPEG-2/MPEG audio | Rejected pre-flight with detected codec |
| FLV | — | Rejected; no native browser demuxer |
| Ogg | Theora/Vorbis etc. | Probed; native support varies |

Important nuance: MOV H.264 may report `not supported` from `canPlayType` yet
play once loaded because the element sniffs the ISO BMFF container. Therefore
`canPlayType` is a hint, never the sole verdict. H.264-in-MKV is deliberately not
rejected; the browser decides.

The test environment is Chromium headless on Windows; HEVC rows are marked
`either` because the headless shell and OS decoder support differ. Safari,
Firefox, real hardware HEVC and multi-GB files remain manual checks.

---

## 11. Build, dev and deployment

### 11.1 Commands

```bash
npm install
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc --noEmit && vite build -> dist/
npm run preview        # serve dist/ at http://localhost:4173
npm run typecheck      # tsc --noEmit
npm run test:unit      # Vitest, 10 files / 146 tests
npm test               # Playwright full browser suite
npm run test:features  # Part 1 + Part 2 feature checks
npm run test:build     # build-output smoke test over http and file://
npm run verify         # build + test:build
npm run audit          # compatibility drift + DOM id wiring
npm run verify:youtube # real-Chromium YouTube harness (needs a browser/network)
```

`LIVEX_TARGET=prod npm test` runs the browser suite against the production
bundle on port 4173 and sets `VITE_LIVEX_TEST_HOOKS=1`, which exposes
`window.__livex` for tests. Normal production builds do not expose the hook.

### 11.2 Single-file build

LiveX must work in two shapes:

1. Served over http(s) — static hosting, `npm run preview`.
2. Opened directly from disk — `dist/index.html` via `file://`.

To support `file://`:

- `base: "./"` keeps asset URLs relative.
- `modulePreload: false`.
- CSS is emitted as one file (`cssCodeSplit: false`) and inlined by
  `vite-plugins/inline-single-file.ts`.
- JS is emitted as an IIFE, `inlineDynamicImports: true`, and inlined as a
  classic `<script>`.
- No `crossorigin` attributes.
- Font files remain separate under `dist/assets/`; same-origin font subresources
  load over `file://` where stylesheet/module fetches would fail.

`dist/index.html` contains the full app. Do not introduce runtime `fetch()` calls
for local assets without re-validating `file://`.

### 11.3 Deployment state

- `vite.config.ts` notes GitHub Pages, Netlify and `npm run preview` as target
  shapes, but **no deploy workflow or host config is committed** in this
  snapshot.
- The site is not known to be live. GitHub Pages for the repo returned 404 when
  last checked.
- A production deployment needs a host decision, a build command
  (`npm run build`) and publish directory (`dist`). YouTube mode additionally
  needs an http(s) origin.
- `dist/` is gitignored; deployment should build from source, not commit output.

---

## 12. Testing and quality gates

### 12.1 Unit tests (Vitest)

10 suites, **146 tests**, node environment, milliseconds:

- `mediaProbe` — real fixture bytes to expected container/codec.
- `sessionState` — every transition pair, legal and illegal.
- `sessionManager` — anti-skip, 1× lock, completion, integrity.
- `playbackErrors` — every `MediaError` code to normalized messages.
- `playbackCapabilities` — cache and support matrix.
- `format` — `formatTime` edge cases.
- `chapters` — `chpl` parsing.
- `subtitles` — SRT→VTT and edge cases.
- `analytics` — pure aggregation.
- `youtubeSource` — URL/id/start parsing, playlist recognition, garbage input.

### 12.2 Browser tests (Playwright)

`tests/e2e/livex.spec.ts` covers:

- boot with no console/page errors and one `<video>`;
- all compatibility fixtures;
- `ready → live → paused → live → completed`;
- start at 0, 1× lock, forward seek clamp, rewinding;
- replacing a file does not register completion;
- zero non-GET requests during local playback;
- full session with every external request blocked (offline);
- YouTube consent, blocked-network honesty, remembered choice, non-YouTube
  rejection;
- feature suites: Part 1 (39 checks) and Part 2 (69 checks).

Latest full `npm test` run in this workspace: **31 passed, 1 skipped**. The
skipped test is the real YouTube embed check; `npm run verify:youtube` is the
dedicated harness for that (documented at 32/32, including rendered captions).

### 12.3 Build and audit checks

- `npm run test:build`: loads built output over http and `file://`; asserts no
  page errors, no failed requests, dark theme, Tailwind, typography, CSS rules,
  loaded fonts, idle screen, wired Open Video, and zero external requests. It
  has 26 checks and last passed 26/26.
- `npm run audit`: compatibility fixtures vs spec vs docs, and DOM ids. Latest
  result: **14 media fixtures, 12 spec rows, 12 container+codec pairs, 0 coverage
  gaps; 92 ids in index.html, 76 referenced from src, all present.**
- `npm run verify:youtube`: drives a pasted YouTube link end-to-end in real
  Chromium; exits `2` rather than `1` when the browser cannot launch, so
  "not verified" is not confused with "verified broken".

### 12.4 CI

`.github/workflows/ci.yml` defines typecheck, unit, build, audit and E2E jobs on
Node 22 with Chromium installation.

**Known CI defect:** the workflow currently triggers on `master`,
`upgrade/**`, `feat/**`, `fix/**` and PRs to `master`, but the active branch is
`main`. As written, pushes to `main` may not run CI. This should be corrected to
`main` when the workflow is next touched.

---

## 13. Version history (short)

| Version | Main change |
| --- | --- |
| `1.0.0` (2026-11-07) | Initial vanilla HTML/CSS/JS player, local drag-and-drop, simulated live states, anti-skip, 1× lock |
| `1.1.0` (2026-11-07) | TypeScript + Vite migration, `PlaybackAdapter`, native adapter, real container/codec probe, normalized errors, compatibility matrix |
| `1.2.0` (2026-11-08) | Tailwind and fonts bundled locally, zero external requests, accessibility pass |
| `1.2.1` (2026-11-08) | Fixed unstyled build over `file://` via self-contained inlining |
| `1.3.0` (shipped, see roadmap) | History, bookmarks/notes, keyboard, dialogs, PiP, time modes |
| `1.4.0` (2026-11-20) | YouTube mode, chapters, playlist, subtitles, integrity report, local analytics, resume offer |

`CHANGELOG.md` jumps from `1.2.1` to `1.4.0`; the v1.3 feature set is documented
in `docs/EXPANSION-ROADMAP.md` and present in the code.

---

## 14. Known limitations, non-goals and launch gaps

### Deliberate non-goals

- No backend, database, accounts or authentication.
- No cloud upload/storage, transcoding or proxying.
- No real live streaming.
- No persistent video library; only metadata/history.
- No DRM or tamper-proof skipping. Anti-skip is a focus aid.
- No universal-format claim. Compatibility is measured and explained.
- No large WASM media engine on the default path.
- No analytics/telemetry. Local statistics only.

### Product/technical limits

- YouTube anti-skip and 1× are best-effort; the embed is cross-origin.
- YouTube mode needs an http(s) origin, so it cannot work from `file://`.
- Chapters only support Nero `chpl` atoms in MP4/MOV; QuickTime chapter tracks
  are out of scope.
- Playlist advancement is manual by design.
- File identity is a metadata fingerprint; equal name/size/duration files can
  collide.
- Local storage may be unavailable; features fail soft.
- `prefers-reduced-motion` support is incomplete.
- No real screen-reader testing has been recorded.
- Safari/Firefox, real HEVC hardware and multi-GB files are manual checks.
- `localplay/` is a nested Git repo, not a submodule; decide to formalize or
  remove it.

### Current launch-readiness gaps observed in the repo

These are separate from the core product and should be addressed before a public
launch:

- `<html>` still has the old `bg-[#121212]` class even though the theme is now
  maroon; the body background is correct, but the html class is stale.
- No favicon, meta description, Open Graph/Twitter tags, canonical URL,
  `robots.txt` or sitemap.
- Title/brand casing is inconsistent: `Livex - Live Session Simulator` and
  `Livex` in the UI vs `LiveX` in docs/About.
- No deployment config/workflow is committed.
- CI branch trigger mismatch described in §12.4.
- No 404 page or explicit security headers; host-specific setup remains.

---

## 15. Open roadmap

From `docs/EXPANSION-ROADMAP.md`:

| Item | Status |
| --- | --- |
| Streamed/box-by-box `moov` probe for huge files | Open, low priority |
| Low-memory mode for 4K/large files | Open |
| Dev-only playback-error histogram (never transmitted) | Open |
| `localplay/` submodule decision | Open |
| PWA/service worker for offline app shell | Stretch idea |
| Screen-reader transcript with auto-scroll | Stretch idea |
| Frame-exact bookmark thumbnails | Stretch idea |
| WebGPU scrub-preview strip | Stretch idea |
| Multi-window sessions, study timer | Stretch ideas |
| WASM media engine | **No-go for now**; seam retained |

---

## 16. Orientation for the next AI

### Invariants to preserve

1. **Local mode has zero network requests.** No CDNs, remote fonts, telemetry,
   remote logging, or runtime third-party scripts. Validate with the offline
   Playwright test and `test:build`.
2. **No upload path.** Video bytes stay in `File`/`blob:` URLs. Persistence may
   contain metadata, timestamps and note text, never media or thumbnails.
3. **Anti-skip is honest.** It is a focus aid, not DRM. Do not add enforcement
   or "unskippable" copy. YouTube mode is advisory.
4. **Completion comes from `ended`.** Do not mark completion on pause, unload or
   file replacement.
5. **The UI is engine-agnostic.** New engines implement `PlaybackAdapter`; only
   `main.ts` chooses one.
6. **`setAdapter()` never disposes the incoming engine.** Engines are long-lived
   and owned by the composition root.
7. **`file://` local build must keep working.** Any new asset/fetch/dynamic
   import must be checked against `npm run verify`.
8. **Update tests and docs with behaviour.** New persisted fields require
   privacy review; new formats require a fixture + spec row + compatibility doc
   (the audit enforces this); new DOM ids require `npm run audit`.

### Where to make common changes

| Task | Files to start with |
| --- | --- |
| Add a playback engine | `src/playback/PlaybackAdapter.ts`, new adapter, one line in `src/main.ts` |
| Change session rules | `src/session/SessionManager.ts`, `SessionState.ts`, unit/E2E tests |
| Add a UI feature | `index.html`, `src/ui/WorkspaceUI.ts`, `tools/check-dom-ids.mjs` |
| Add a media format/codec | `src/files/MediaProbe.ts`, `PlaybackCapabilities.ts`, fixture, `livex.spec.ts`, `docs/COMPATIBILITY.md`, run audit |
| Change persistence | `src/files/LocalMetadataStore.ts`, service using it, privacy tests/docs |
| Change YouTube parsing | `src/files/YouTubeSource.ts` + `tests/unit/youtubeSource.test.ts` |
| Change YouTube playback | `src/playback/YouTubeAdapter.ts` + `tools/verify-youtube.mjs` |
| Change build/output | `vite.config.ts`, `vite-plugins/inline-single-file.ts`, `tests/build-check.mjs` |
| Change theme | `tailwind.config.js`, `src/styles/app.css`, hard-coded colors in `index.html`/UI, `tests/build-check.mjs` |

### Suggested handoff prompt

> You are working on LiveX, a local-first simulated live lecture player built
> with strict TypeScript, Vite, Tailwind and native browser APIs. Read
> `context.md` first, then `README.md` and the relevant `docs/` file. Preserve
> these invariants: local-file mode makes zero network requests and never
> uploads/stores media; anti-skip and 1× are focus aids, not DRM; completion only
> comes from a real `ended` event; playback engines sit behind `PlaybackAdapter`
> and only `main.ts` chooses one; `dist/index.html` must work over both http(s)
> and `file://`. Run the smallest relevant check (`npm run typecheck`,
> `npm run test:unit`, `npm run test:build`, `npm test`, `npm run audit`) and do
> not weaken tests to make them pass.

---

## 17. Glossary

| Term | Meaning in LiveX |
| --- | --- |
| **Session** | One simulated live playback run of a video, from start to completion |
| **Live** | State where playback is advancing inside a session (not real streaming) |
| **Anti-skip / ceiling** | Furthest legitimately watched timestamp; forward seeks beyond it are clamped |
| **Furthest time** | Highest position reached while live; the anti-skip ceiling |
| **Integrity report** | Honest end-of-session stats: watched %, skip attempts, longest stretch |
| **Adapter** | Engine implementation behind the `PlaybackAdapter` interface |
| **Probe** | Pre-flight read of container/codec signatures from file bytes |
| **Fingerprint** | `name::size::duration` key used for local history/annotations |
| **Annotation** | A bookmark (time only) or note (time + text) |
| **Capability report** | Plain-text copy of browser support info; contains no media |
| **Native mode** | Local file played by `BrowserVideoAdapter` via `<video>` |
| **YouTube mode** | Explicit online mode using the YouTube IFrame Player API |
| **WASM seam** | `WasmMediaAdapter`, a fail-closed placeholder for a future engine |
| **Stitch export** | Static UI screens generated with Google Stitch and integrated into `index.html` |

---

If anything in this document conflicts with the code, **trust the code**, then
update this file. The most likely places for drift are feature counts, the
compatibility matrix, test totals and deployment state.
