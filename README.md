# LiveX

A local-first **simulated live session** video player. Drop a class video onto
the workspace — or paste a YouTube link — and watch it as a "live" session that
can't be skipped ahead.

- Local videos **never leave your device** — no upload, no backend, no accounts.
- Local mode **works fully offline** — Tailwind and fonts are bundled; zero
  external requests. (YouTube links are the one online mode, and say so.)
- **TypeScript** application layer, built with Vite.
- Playback behind a swappable **playback adapter interface** — two engines ship:
  native `<video>` for local files, and the YouTube IFrame player for links.
- Real container/codec detection, so unsupported files fail with a reason.
- A copyable **device capability report** in About — plain text, no file names
  or media — so playback problems can be reported without uploading anything.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle in dist/
npm run preview    # serve the build → http://localhost:4173
npm run verify     # build, then check the output over http AND file://
npm run typecheck  # tsc --noEmit
npm run test:unit  # fast unit tests (Vitest)
npm test           # full browser suite (Playwright starts Vite for you)
```

`dist/index.html` is **self-contained** — CSS and JS are inlined — so you can
also just double-click it. It renders identically over `file://` and over http.

Use **Open Video** (`⌘O` / `Ctrl+O`) or drop a file anywhere on the workspace.
To watch a YouTube video as a live session, just **paste the link** anywhere on
the workspace — no need to find a field.

## Two modes

| | Local file | YouTube link |
| --- | --- | --- |
| How to start | Drop / Open Video, then Start Live Session | Paste the link, then Start Live Session |
| Network | **None.** Zero external requests | Streams from YouTube/Google |
| Offline | Works | Needs a connection |
| Anti-skip | Clamped in the playing engine | **Advisory** — the embed is cross-origin; our ceiling only covers our own seek paths |
| Chapters, subtitles, PiP, bookmarks | Yes | Local-file features hidden; **CC** toggles YouTube captions |

The first YouTube paste shows a one-time notice explaining the online behaviour
before anything is fetched. Local files are never affected by it.

## What it supports

| Plays natively | Rejected with a clear reason |
| --- | --- |
| MP4 (H.264, HEVC where the OS decodes it, AV1) | AVI |
| WebM (VP8, VP9, AV1) | MPEG-2 (`.ts`, `.mpg`) |
| MOV (H.264, HEVC) | FLV |
| MKV with H.264 | MKV with codecs the browser can't demux (e.g. HEVC) |

A container extension does not guarantee playback — it is always
**container + codec + browser**. Measured results, per row, are in
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Architecture

```text
index.html (Stitch UI markup — unchanged visuals)
        │
        └── src/main.ts                  composition root: picks the engine
              │  imports styles/app.css  (bundled Tailwind + self-hosted fonts)
              │
              ├── src/ui/WorkspaceUI.ts        binds existing DOM ↔ layers
        ├── src/session/SessionManager.ts states, anti-skip, 1× lock, completion
        ├── src/files/                   LocalFileManager + magic-byte MediaProbe
        └── src/playback/
              PlaybackAdapter.ts         engine-agnostic interface
              BrowserVideoAdapter.ts     native <video> (baseline)
              WasmMediaAdapter.ts        optional engine seam (not bundled)
              PlaybackCapabilities.ts    canPlayType + probe → verdict
              PlaybackErrors.ts          MediaError → normalized errors
```

The UI never calls the engine directly, and the session layer never touches the
DOM. Swapping engines touches `PlaybackAdapter` + one line in `main.ts`.

## Features

- Drag-and-drop or `Ctrl+O` local video, nothing uploaded.
- **Paste a YouTube link** to run it as a live session (online mode — see below).
- Simulated live session with `LIVE` / `PAUSED` / `COMPLETED` states.
- **Anti-skip** forward-seek ceiling with a 1× speed lock.
- **Bookmarks and timestamped notes** — `B` to bookmark, `N` to write a note;
  notes resurface as you play past them.
- **Take your notes with you** — export a lecture as Markdown or a JSON backup,
  copy all notes in one click, and import a backup to restore bookmarks and notes.
- **Continue where you left off** — recent files with progress, stored locally.
- **Resume an interrupted session** — an explicit offer, never a silent jump.
- **Keyboard-first control** — arrows, `J/K/L`, `P` for picture-in-picture.
- **Picture in picture** and fullscreen.
- **Focus mode** (`Z`) — hides every distraction except the timer.
- **Three time readouts** — elapsed / remaining / percentage.
- **Chapters** read from MP4 `chpl` atoms and shown as clickable chips.
- **Playlist queue** — drop several files, advance when you are ready.
- **Local subtitles** — `.vtt` or `.srt` from disk, converted in memory.
- **Playback integrity report** — watched %, skip attempts and longest
  uninterrupted stretch, instead of a silent, unenforceable wall.
- **Your watching stats** — local-only totals in the About dialog.
- Real container + codec detection, so unsupported files say *why* — including
  the codec found inside AVI (`hdrl`/`strf`), MPEG-TS (PAT/PMT) and MPEG-PS
  (sequence header).

## Keyboard

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
| `Shift + N` | Next file in the queue |
| `M` / `F` | Mute / fullscreen |
| `Esc` | Exit fullscreen or close dialog |
| `?` | Shortcuts panel |
| `Ctrl/⌘ + O` | Open a video |

## Session rules

- States: `idle → ready → live ⇄ paused → completed`, plus `error`.
- Playback always starts at `0:00` for a new session and stays locked to **1×**.
- Forward seeking past the furthest watched point is snapped back; rewinding is
  allowed. Completion is only recorded from a real `ended` event.

> Anti-skip is a personal productivity control, **not DRM**. Anything enforced in
> the browser can be bypassed with developer tools.

## Privacy

**This section is about local-file mode, which is the default and keeps every
original guarantee.** YouTube mode is the one exception and is disclosed up
front: it loads Google's player, so Google may set cookies and see your IP, and
the video is streamed rather than read from your disk.

Video bytes are read through the File API and exposed to the player only as a
`blob:` object URL, revoked on replace and on dispose. There is no upload
endpoint, no storage of video, and no telemetry. The automated test asserts that
**zero non-GET requests** occur during a full local session.

**In local-file mode the page makes zero external requests.** Tailwind CSS and
both font families (Inter, JetBrains Mono) are bundled and self-hosted, so LiveX
works completely **offline** once loaded — verified by a test that aborts every
non-localhost request and still plays a full session. The YouTube API script is
only ever injected after the user accepts the disclosure, so no Google code is
fetched by a local session.

### What is saved locally

Two things, both opt-in and both removable from **Menu → About LiveX → Clear
saved data**:

1. **Session history** — file name, size, duration, last position and furthest
   position, per file. Stored in IndexedDB. The About dialog aggregates these
   into local watching statistics.
2. **Bookmarks and notes** — timestamp plus your note text (capped at 500
   characters), keyed to the same file fingerprint. Exports are written only
   when you ask for them; a JSON backup contains the same annotation records
   and the file's name/size/duration fingerprint, never media bytes.

Two small `localStorage` keys remember the time-display mode you chose and
whether you have accepted the YouTube disclosure. Neither contains media.

Subtitles and chapters are read per file and never stored. The playlist queue
holds `File` handles for the current page only. A YouTube video is not stored or
cached by LiveX at all — only its id, in memory, for the session, and its title
in the tab.

**No video, audio, frame or thumbnail data is ever written to disk.** Files are
identified by a `name::size::duration` fingerprint, not by content; the test
suite asserts that no persisted record contains media-shaped fields. If the
browser blocks IndexedDB (private mode, storage pressure), both features switch
themselves off and LiveX remains a plain player.

## Build verification

```bash
npm run verify   # build + verify the output works over http AND file://
```

`npm run test:build` loads the built page two ways and asserts the theme,
typography, fonts, CSS and app wiring are all present, with zero external
requests. This guards against emitting a build that renders as an unstyled page.

## Tests

The Playwright config starts Vite for you, so there is no separate terminal:

```bash
npm run test:unit      # Vitest, pure logic — milliseconds
npm test               # full browser suite (Playwright + Chromium)
npm run test:features  # Part 1 features only
npm run test:features2 # Part 2 features only
npm run test:all       # unit, then browser
npm run audit          # fixture/doc drift + DOM-id wiring
```

Also:

- `npm run verify:youtube` — drives a pasted YouTube link end to end in a real
  Chromium (disclosure → embed → playback → pause/resume → back to a local
  file). It needs to launch a browser, so run it outside a restricted sandbox.
  It exits `2` rather than `1` when it cannot launch, so "not verified" is never
  confused with "verified broken".

Four suites:

- `npm run test:unit` — Vitest: `MediaProbe` against the real fixtures,
  `SessionState` transition pairs, `PlaybackErrors` mappings, `formatTime` edge
  cases, plus chapters, subtitles, analytics and the session manager.
- `npm test` runs `tests/e2e/livex.spec.ts` — session state machine, anti-skip,
  the 1× lock, completion semantics, the compatibility matrix, offline behaviour
  and privacy.
- `tests/e2e/features.spec.ts` — the Part 1 and Part 2 feature checks (39 + 69),
  whose assertion bodies live in `tests/e2e/suites/` and are imported by the spec.
- `npm run verify` — build, then verify the output over http **and** `file://`.

Fixtures are generated with ffmpeg and live in `tests/fixtures/`.

To run the same browser suite against the production bundle, set
`LIVEX_TARGET=prod` (the config then builds, serves `dist/` on 4173 and sets
`VITE_LIVEX_TEST_HOOKS=1`):

```bash
LIVEX_TARGET=prod npm test
```

The test hook is tree-shaken out of normal builds.

`node tools/audit-compatibility.mjs` cross-checks that every fixture is both
asserted in the spec and documented in `docs/COMPATIBILITY.md`.

## Docs

- [docs/UPGRADE-AUDIT.md](docs/UPGRADE-AUDIT.md) — what changed and why
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — measured format matrix
- [docs/FEASIBILITY-WASM.md](docs/FEASIBILITY-WASM.md) — why no wasm engine ships
- [docs/YOUTUBE-MODE-PLAN.md](docs/YOUTUBE-MODE-PLAN.md) — YouTube mode design,
  its terms/privacy constraints, and what it does not guarantee
- [docs/TASK-SPEC.md](docs/TASK-SPEC.md) — original functional spec
- [docs/TYPESCRIPT-PLAYBACK-UPGRADE-PLAN.md](docs/TYPESCRIPT-PLAYBACK-UPGRADE-PLAN.md) — TypeScript + playback upgrade plan
- [CHANGELOG.md](CHANGELOG.md) — version history
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guide

## Attribution

Playback workflow inspired by [LocalPlay](https://github.com/syedmugheessali/localplay) (MIT).
The `localplay/` folder is an unmodified upstream reference clone and is not
part of the build.
