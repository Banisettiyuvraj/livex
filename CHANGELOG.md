# Changelog

All notable changes to LiveX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **Notes & bookmarks export** — the new notes button (also in the menu) opens a
  dialog to copy a lecture's notes, download Markdown with timestamps, download a
  structured JSON backup, or import a backup to restore annotations.
- `AnnotationExport` module with unit tests for Markdown formatting, JSON
  round-trips and backup validation.

---

## [1.4.0] — 2026-11-20

### Added
- **YouTube mode** — paste any YouTube link to run it as a live session (online; disclosed up front before any Google code is fetched).
- Bookmarks (`B`) and timestamped notes (`N`) with resurface-on-playback.
- Continue-where-you-left-off: recent files with progress, stored in `IndexedDB`.
- Resume-interrupted-session offer (explicit, never a silent jump).
- Keyboard-first controls — `J/K/L`, `P` (picture-in-picture), `Z` (focus mode).
- Three time readouts — elapsed / remaining / percentage.
- MP4 chapter support (`chpl` atoms) with clickable chapter chips.
- Playlist queue — drop several files and advance when ready.
- Local subtitle support — `.vtt` and `.srt` converted in memory, never stored.
- Playback integrity report — watched %, skip attempts, longest uninterrupted stretch.
- Local watching statistics in the About dialog.
- `PlaybackAdapter` interface and `YouTubeAdapter` implementation.
- `AnalyticsService`, `AnnotationService`, `PlaylistService`, `SubtitleService`, `SessionHistoryService`.
- Playwright E2E suite: 37 + 69 feature checks across two spec files.
- Vitest unit suite: `MediaProbe`, `SessionState`, `PlaybackErrors`, `formatTime`, chapters, subtitles, analytics, session manager, YouTube source.
- `tools/audit-compatibility.mjs`, `tools/check-dom-ids.mjs`, `tools/verify-youtube.mjs`.
- `docs/YOUTUBE-MODE-PLAN.md`, `docs/EXPANSION-ROADMAP.md`.

### Changed
- `SessionManager` extended with YouTube-aware state paths.
- `WorkspaceUI` wired to all new services.
- `index.html` updated for new UI panels (subtitles, notes, playlist, stats).

---

## [1.2.1] — 2026-11-08

### Fixed
- Production build now renders correctly over `file://` as well as `http://`.
- CSS and JS are fully inlined; zero external requests in `dist/index.html`.

---

## [1.2.0] — 2026-11-08

### Added
- Tailwind CSS and fonts (Inter, JetBrains Mono) are bundled and self-hosted — no CDN, works offline.
- Build verification: `npm run verify` loads the built page both over `http` and `file://` and asserts zero external requests.
- Accessibility pass: ARIA roles and labels on interactive elements.

### Removed
- Dead/placeholder toolbar buttons.

### Fixed
- Platform-aware keyboard shortcut hints (⌘ vs Ctrl).
- Error-state consistency across all failure paths.

---

## [1.1.0] — 2026-11-07

### Added
- **TypeScript + Vite migration** — full type coverage, no runtime changes to the Stitch UI.
- `PlaybackAdapter` interface — engine-agnostic contract.
- `BrowserVideoAdapter` — native `<video>` implementation.
- `WasmMediaAdapter` stub — seam kept for future engines.
- `MediaProbe` — real container/codec detection from magic bytes (MP4, WebM, MKV, MOV, AVI, MPEG-TS/PS).
- `PlaybackCapabilities` — `canPlayType` + probe → accept/reject verdict before mounting the file.
- `PlaybackErrors` — `MediaError` codes → normalized, user-facing messages.
- Object-URL lifecycle management: revoke on replace and on dispose.
- Playwright E2E suite: session state machine, anti-skip, 1× lock, completion semantics, compatibility matrix, offline and privacy checks.
- `docs/UPGRADE-AUDIT.md`, `docs/COMPATIBILITY.md`, `docs/FEASIBILITY-WASM.md`.

---

## [1.0.0] — 2026-11-07

### Added
- Initial release — LiveX v1 (vanilla JS / HTML / CSS).
- Drag-and-drop local video or `Ctrl+O` file picker.
- Simulated live session with `LIVE` / `PAUSED` / `COMPLETED` states.
- Anti-skip: forward-seek ceiling clamped to furthest watched point.
- 1× speed lock.
- Elapsed/total time display.
- Session completion and reset.
- Zero backend, zero upload — videos never leave the device.

---

[1.4.0]: https://github.com/Banisettiyuvraj/livex/compare/v1.2.1...v1.4.0
[1.2.1]: https://github.com/Banisettiyuvraj/livex/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Banisettiyuvraj/livex/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Banisettiyuvraj/livex/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Banisettiyuvraj/livex/releases/tag/v1.0.0
