# LiveX

A local-first **simulated live session** video player. Drop a class video onto
the workspace and watch it as a "live" session that can't be skipped ahead.

- Videos **never leave your device** — no upload, no backend, no accounts.
- **Works fully offline** — Tailwind and fonts are bundled; zero external requests.
- **TypeScript** application layer, built with Vite.
- Native browser playback behind a swappable **playback adapter interface**.
- Real container/codec detection, so unsupported files fail with a reason.

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
```

`dist/index.html` is **self-contained** — CSS and JS are inlined — so you can
also just double-click it. It renders identically over `file://` and over http.

Use **Open Video** (`⌘O` / `Ctrl+O`) or drop a file anywhere on the workspace.

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
- Simulated live session with `LIVE` / `PAUSED` / `COMPLETED` states.
- **Anti-skip** forward-seek ceiling with a 1× speed lock.
- **Bookmarks and timestamped notes** — `B` to bookmark, `N` to write a note;
  notes resurface as you play past them.
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
- Real container + codec detection, so unsupported files say *why*.

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

Video bytes are read through the File API and exposed to the player only as a
`blob:` object URL, revoked on replace and on dispose. There is no upload
endpoint, no storage of video, and no telemetry. The automated test asserts that
**zero non-GET requests** occur during a full session.

**The page makes zero external requests.** Tailwind CSS and both font families
(Inter, JetBrains Mono) are bundled and self-hosted, so LiveX works completely
**offline** once loaded — verified by a test that aborts every non-localhost
request and still plays a full session.

### What is saved locally

Two things, both opt-in and both removable from **Menu → About LiveX → Clear
saved data**:

1. **Session history** — file name, size, duration, last position and furthest
   position, per file. Stored in IndexedDB. The About dialog aggregates these
   into local watching statistics.
2. **Bookmarks and notes** — timestamp plus your note text (capped at 500
   characters), keyed to the same file fingerprint.

A small `localStorage` key remembers only which time-display mode you chose.

Subtitles and chapters are read per file and never stored. The playlist queue
holds `File` handles for the current page only.

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

```bash
npm run dev            # in one terminal
npm test               # in another (Playwright, Chromium)
```

Two suites:

- `npm test` — 37 checks: compatibility matrix, session state machine, anti-skip,
  the 1× lock, completion semantics and privacy.
- `npm run test:features` — 36 checks covering history, bookmarks/notes, the
  keyboard map, dialogs, picture-in-picture and time display modes.
- `npm run test:features2` — 69 checks covering the integrity report, resume,
  focus mode, playlist, chapters, subtitles and analytics.
- `npm run verify` — build, then verify the output over http **and** `file://`.

Fixtures are generated with ffmpeg and live in `tests/fixtures/`.

To run the same suite against the production bundle:

```bash
VITE_LIVEX_TEST_HOOKS=1 npm run build   # exposes window.__livex for tests
npm run preview                          # http://localhost:4173
LIVEX_URL=http://localhost:4173/ npm test
```

The test hook is tree-shaken out of normal builds.

## Docs

- [docs/UPGRADE-AUDIT.md](docs/UPGRADE-AUDIT.md) — what changed and why
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — measured format matrix
- [docs/FEASIBILITY-WASM.md](docs/FEASIBILITY-WASM.md) — why no wasm engine ships
- [task.md](task.md) — original functional spec

## Attribution

Playback workflow inspired by [LocalPlay](https://github.com/syedmugheessali/localplay) (MIT).
The `localplay/` folder is an unmodified upstream reference clone and is not
part of the build.
