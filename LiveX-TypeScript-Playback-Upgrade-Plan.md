# LiveX — Playback Engine & TypeScript Upgrade Plan

**Document type:** Implementation change plan  
**Project:** LiveX  
**Status:** Existing website and UI are already implemented  
**Purpose:** Upgrade the existing project to TypeScript and improve local video format compatibility without rebuilding the website.

---

## 1. Context and Current State

LiveX already has:
- A website implementation based on the existing `task.md`.
- UI screens designed in Google Stitch and integrated into the project.
- A local video workflow / playback implementation.
- A simulated live-session experience.

The current concern is that playback supports only a limited set of video formats or codecs.

**This is an upgrade to the existing project—not a fresh build.** Preserve the current UI, screens, visual design, and working features unless a change is specifically required.

## 2. Main Change Summary

### Keep
- Existing website and deployment model.
- Existing Stitch-generated screens and visual styling.
- Drag-and-drop / local file selection workflow.
- Live-session UI and current session behavior where it works.
- Local-first privacy model.
- No user accounts or video-upload backend.

### Change
1. Introduce TypeScript into the existing codebase.
2. Refactor playback/session logic into typed modules.
3. Improve video compatibility through a modular playback architecture.
4. Evaluate browser-compatible WebAssembly media engines for formats unsupported by native browser playback.
5. Add explicit playback capability detection and friendly unsupported-format errors.
6. Preserve local playback: video bytes must not be uploaded to any server.
7. Update testing and documentation to reflect real format/codec support.

### Do not do
- Do not redesign or regenerate the UI.
- Do not migrate to Electron or Tauri.
- Do not add a backend or cloud storage.
- Do not upload video files for conversion or decoding.
- Do not promise support for every video format or codec.
- Do not rewrite stable components without a clear need.

---

## 3. Updated Product Goals

### Primary goals
- Keep LiveX as a website running in the user's browser.
- Keep video files on the user's device.
- Use TypeScript for safer, more maintainable application logic.
- Improve support for common video containers and codecs.
- Retain the simulated live-session experience and anti-skip behavior.
- Make playback-engine changes possible without rewriting the UI.

### Compatibility goal
Aim to support the user's common formats—such as MP4, WebM, MOV, MKV, AVI, and MPEG—when the chosen playback engine and codecs allow it.

**Important:** A container extension does not guarantee playback. An MKV file, for example, can contain different video/audio codecs. Compatibility must be measured by container + codec + browser/device combination.

---

## 4. Updated Architecture

Use a layered architecture so the current website remains intact.

```text
Existing LiveX Website
├── Existing Stitch UI (keep)
│   ├── Workspace
│   ├── Toolbar
│   ├── Video area
│   └── Session indicators
│
├── TypeScript Application Layer (introduce)
│   ├── LocalFileManager
│   ├── PlaybackController
│   ├── SessionManager
│   ├── PlaybackCapabilityDetector
│   └── PlaybackErrorHandler
│
├── Playback Adapter Layer (introduce/refactor)
│   ├── BrowserVideoAdapter (current/native HTML5 playback)
│   └── WasmMediaAdapter (optional, only after feasibility test)
│
└── Local user-selected file
    └── Never upload video contents
```

The UI should communicate with the playback adapter and session manager through stable interfaces. Avoid tying the UI directly to one media engine.

---

## 5. TypeScript Migration Plan

### 5.1 Inspect before changing
- Review the existing repository and current `task.md`.
- Identify the framework, build tool, entry points, player implementation, and session logic.
- Identify which parts are plain JavaScript and which are generated UI files.
- Confirm the current website builds and runs before modifying it.
- Make a backup branch or commit before the migration.

### 5.2 Add TypeScript incrementally
- Use the existing build tool if it already supports TypeScript.
- If the project uses Vite, configure TypeScript in the existing Vite project.
- Do not replace the existing framework or build system solely for TypeScript.
- Keep Stitch-exported HTML/CSS and visual assets unchanged.
- Convert core logic files first; migrate UI components only when beneficial.
- Avoid a big-bang rewrite.

### 5.3 Suggested TypeScript modules

```text
src/
  playback/
    PlaybackAdapter.ts
    BrowserVideoAdapter.ts
    PlaybackController.ts
    PlaybackCapabilities.ts
    PlaybackErrors.ts
  session/
    SessionManager.ts
    SessionState.ts
  files/
    LocalFileManager.ts
  types/
    media.ts
```

Adapt these paths to the existing repository; do not force this exact structure if the current project has a better organization.

### 5.4 Type definitions

Define types for:
- Session state.
- Playback state.
- Media metadata.
- Playback capabilities.
- Playback errors.
- Player events.

Example session states:

```ts
export type SessionState =
  | "idle"
  | "ready"
  | "live"
  | "paused"
  | "completed"
  | "error";
```

Use strict typing where practical. Avoid using `any` as a shortcut for media-engine integration; isolate unavoidable third-party types behind adapters.

---

## 6. Playback Compatibility Strategy

### Stage 1 — Audit current support
Before adding a new engine:
- Identify the current player implementation.
- Test actual files that fail.
- Record browser, operating system, file extension, video codec, audio codec, and playback result.
- Separate container issues from codec issues.
- Use browser capability checks where available, such as `HTMLMediaElement.canPlayType()`.

Do not assume the file extension alone tells you whether a file can play.

### Stage 2 — Keep native browser playback as the baseline
Retain HTML5 video for formats supported by the browser.

Advantages:
- Fast to implement.
- Efficient native decoding.
- Low application overhead.
- Simple local-file handling.
- Good compatibility for common browser-supported formats.

### Stage 3 — Research a browser-compatible media engine
If native playback is insufficient, investigate a WebAssembly-based media engine.

#### FFmpeg / FFmpeg WebAssembly
- Open-source media framework.
- Broad container and codec capabilities depending on build configuration.
- Can potentially be compiled to WebAssembly.
- May add substantial download size, memory use, CPU cost, and integration complexity.
- FFmpeg itself is not a complete browser player UI; demuxing, decoding, audio output, rendering, and seeking must be integrated.

Official repository: https://github.com/FFmpeg/FFmpeg

#### VLC / VLC WebAssembly projects
- VLC has broad media support in its desktop implementation.
- Desktop libVLC cannot be directly embedded into an ordinary browser.
- A browser-compatible WebAssembly build or integration is required.
- Investigate project maintenance, browser support, licensing, supported codecs, and API completeness before selecting it.

Official VLC source: https://code.videolan.org/videolan/vlc  
libVLC documentation: https://images.videolan.org/vlc/libvlc.html

**Do not assume desktop VLC's format support automatically carries over to a browser WebAssembly build.**

### Stage 4 — Run a feasibility spike before committing
Create a small isolated prototype using one candidate engine. Do not integrate it into the main application until it demonstrates:
- Local file input without upload.
- Playback in the target browser.
- Audio and video output.
- Seeking / time reporting needed by LiveX.
- Pause and resume.
- Playback speed or a reliable way to keep playback at 1x.
- Reasonable performance on representative files.
- A viable licensing and maintenance story.

If no candidate meets these requirements, keep native playback and clearly document its limitations rather than destabilizing the existing app.

---

## 7. Local-Only File and Privacy Requirements

### Required behavior
- Use browser file selection and drag-and-drop.
- Process selected file data locally.
- Do not send video bytes to API endpoints, telemetry, cloud services, or remote conversion tools.
- Do not persist the video itself in IndexedDB or other storage unless the user explicitly requests that future feature.
- Revoke object URLs when the file is replaced or the player is disposed.
- Do not include file contents in logs or error reports.

### Important distinction
The LiveX website's code may be served from static hosting. This is compatible with local-only video processing.

The privacy requirement applies to video contents: they must not leave the user's device.

### Network verification
During testing:
- Inspect browser Network activity.
- Confirm that selecting and playing a video does not create a request containing the video file.
- Confirm no upload endpoint is called.
- Document any external requests made by the site itself, such as static assets, and keep them separate from video data.

---

## 8. Playback Adapter Interface

Create an interface that isolates player-specific behavior from the UI and session logic.

Illustrative interface:

```ts
export interface PlaybackAdapter {
  load(file: File): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(timeSeconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  dispose(): void;
}
```

Adjust the interface to match the current player and the chosen engine. Some engines may require asynchronous seek, different event subscriptions, or additional methods.

### Adapter requirements
- UI components should not depend on FFmpeg/VLC-specific APIs.
- Session logic should receive normalized playback events.
- Engine errors should be converted to LiveX error types.
- The native browser adapter must continue to work if the optional WebAssembly adapter is unavailable.

---

## 9. Session and Anti-Skip Behavior

Preserve existing session behavior unless the current implementation has bugs.

Required session states:
- `idle`
- `ready`
- `live`
- `paused`
- `completed`
- `error`

Requirements:
- Start from the beginning when a new session starts, unless current product behavior explicitly supports resume.
- Keep playback speed at 1x during a session.
- Prevent ordinary forward seeking beyond the furthest watched position.
- Permit rewind if that matches the existing design.
- Mark completion only after the media engine reports actual end-of-playback.
- Avoid counting file replacement or session abandonment as completion.

Anti-skip behavior is a personal productivity control, not tamper-proof DRM. A user with developer tools or direct access to the application code may bypass client-side restrictions.

---

## 10. Compatibility Test Matrix

Build a test matrix and fill it with real test results.

| Container / file type | Codec examples to test | Status |
|---|---|---|
| MP4 | H.264 + AAC | Test |
| MP4 | HEVC + AAC | Test |
| WebM | VP8 + Opus | Test |
| WebM | VP9 + Opus | Test |
| WebM | AV1 + Opus | Test |
| MKV | H.264 + AAC | Test |
| MKV | HEVC + AAC | Test |
| MOV | H.264 / HEVC | Test |
| AVI | MPEG-4 / other codecs | Test |
| MPEG / TS | MPEG-2 / MPEG-4 | Test |

For each test, record:
- Browser and version.
- Operating system.
- Container.
- Video codec.
- Audio codec.
- Resolution and approximate file size.
- Whether playback, audio, seeking, and session controls work.
- Which engine was used.

Do not mark a format as supported based only on a successful test of a different codec inside the same container.

---

## 11. Performance Requirements

- Keep the existing UI responsive while loading or playing media.
- Avoid unnecessary full-file copies into JavaScript memory.
- Prefer native browser decoding when it works.
- If using WebAssembly, evaluate its download size, memory footprint, CPU usage, and startup latency.
- Test representative large files and high-resolution videos.
- Ensure playback errors do not freeze the UI.
- Clean up engine resources and object URLs on replacement and disposal.

---

## 12. Licensing and Open-Source Review

Before shipping any third-party media engine:
- Identify the exact package, version, and build configuration.
- Review its license and transitive dependencies.
- Check whether optional codecs or plugins change licensing obligations.
- Keep required license notices and attribution.
- Review patent or codec distribution considerations where applicable.

Open-source does not automatically mean unrestricted commercial redistribution.

This plan does not provide legal advice; review the selected distribution before publishing.

---

## 13. Updated Implementation Tasks

### Phase A — Existing Project Audit
- [ ] Review the current website and existing `task.md`.
- [ ] Confirm current framework and build tooling.
- [ ] Identify current player and supported formats.
- [ ] Reproduce the unsupported media examples.
- [ ] Record baseline build and playback behavior.
- [ ] Create a backup branch or commit.

### Phase B — TypeScript Foundation
- [ ] Add TypeScript using the current build system.
- [ ] Add or update TypeScript configuration.
- [ ] Define session and media types.
- [ ] Convert session logic to TypeScript.
- [ ] Convert playback controller logic to TypeScript.
- [ ] Keep Stitch UI and styling unchanged.
- [ ] Confirm the app still builds and runs.

### Phase C — Playback Abstraction
- [ ] Define the playback adapter interface.
- [ ] Implement the current player as a browser adapter.
- [ ] Route UI playback actions through the adapter.
- [ ] Normalize playback events.
- [ ] Normalize media errors.
- [ ] Confirm session logic does not depend on engine-specific APIs.

### Phase D — Compatibility Investigation
- [ ] Create the compatibility test matrix.
- [ ] Test native browser playback.
- [ ] Identify important unsupported codecs.
- [ ] Research FFmpeg WebAssembly and VLC WebAssembly options.
- [ ] Review project maintenance and browser support.
- [ ] Review licenses and build constraints.
- [ ] Build an isolated proof of concept for the strongest candidate.
- [ ] Measure performance and application size.
- [ ] Make a documented go/no-go decision.

### Phase E — Optional WebAssembly Integration
Only proceed if the feasibility spike passes.

- [ ] Add the selected engine behind a separate adapter.
- [ ] Support local file input without upload.
- [ ] Implement video/audio rendering.
- [ ] Implement pause, resume, timing, and seeking.
- [ ] Integrate normalized events with SessionManager.
- [ ] Add engine-specific error handling.
- [ ] Ensure the native adapter remains available as fallback where appropriate.
- [ ] Verify no video upload occurs.

### Phase F — Session Regression Testing
- [ ] Test start, pause, resume, rewind, and completion.
- [ ] Test forward-seek restriction.
- [ ] Test playback-rate restriction.
- [ ] Test switching files.
- [ ] Test errors and recovery.
- [ ] Test resource cleanup.

### Phase G — Final QA
- [ ] Verify existing screens and UI design are preserved.
- [ ] Test all compatibility matrix entries.
- [ ] Test local-only video handling using Network inspection.
- [ ] Test large files.
- [ ] Test supported desktop browsers.
- [ ] Document actual supported formats and known limitations.
- [ ] Update README and original task checklist.

---

## 14. Definition of Done

This upgrade is complete when:

1. The existing LiveX website and screens remain intact.
2. Core application and session logic use TypeScript.
3. Playback is isolated behind an adapter.
4. Existing browser playback continues to work.
5. Local video files are never uploaded.
6. Unsupported media produces clear errors.
7. A WebAssembly engine is integrated only if feasibility and performance are demonstrated.
8. The app's actual compatibility is documented through testing.
9. Session and anti-skip behavior still works.
10. No desktop wrapper or backend has been introduced.

---

## 15. Instructions for the AI Coding Agent

You are modifying an existing LiveX project.

**Do not rebuild the project from scratch.**

Before editing:
1. Inspect the existing repository.
2. Read the current `task.md`.
3. Identify the current player, framework, and build system.
4. Confirm the website works in its current state.
5. Identify exactly which formats fail.

Then implement this plan incrementally.

### Strict constraints
- Preserve existing UI and Stitch screens.
- Preserve current website deployment.
- Keep videos local.
- Do not add Electron, Tauri, or a server backend.
- Do not upload videos for conversion.
- Do not replace stable code without justification.
- Do not claim universal format support.
- Do not integrate a large media engine before testing feasibility.
- Prefer TypeScript for new and refactored application logic.
- Keep the code modular and document major decisions.

**First deliverable:** a short audit report identifying the current playback limitations, proposed TypeScript migration steps, and the most viable browser-compatible media engine candidate. Do not begin a major playback-engine rewrite until that report and feasibility test are complete.
