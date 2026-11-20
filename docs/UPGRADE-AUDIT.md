# LiveX — Upgrade Audit Report

**Scope:** Phase A audit of the pre-upgrade LiveX project, the baseline playback
limitations, the TypeScript migration that was applied, and the go/no-go decision
for a WebAssembly media engine.

Companion docs: [COMPATIBILITY.md](./COMPATIBILITY.md) (measured matrix),
[FEASIBILITY-WASM.md](./FEASIBILITY-WASM.md) (engine spike), [README.md](../README.md).

---

## 1. What the project was before the upgrade

| Area | Finding |
| --- | --- |
| Framework | None. One static `index.html` + `script.js` + `style.css`. |
| Build system | None. `index.html` loaded Stitch-exported markup with the Tailwind **CDN** and a single classic `<script src="script.js">`. |
| UI source | Google Stitch exports in `stitch_live_session_simulator/` (7 screens). `index.html` is the integrated, working version. |
| Player | A single `<video>` element moved between the *ready* and *active* frames; playback via `HTMLVideoElement` + `blob:` object URL. |
| Drag & drop | `window`-level `dragenter/dragover/dragleave/drop` handlers with a full-viewport receiver. |
| Session logic | Plain `script.js`: string state variable, `setState()` toggling `hidden` classes, `timeupdate`-driven progress, `seeking`-driven anti-skip. |
| `style.css` | **Dead file** — a leftover LocalPlay stylesheet linked by nothing. Left in place (still unreferenced) to avoid unrelated churn. |
| `localplay/` | Unmodified upstream reference clone (MIT). Baseline ONLY; not imported by the app. |
| Privacy | Already local-first: no fetch/XHR, no upload endpoint, no storage. `beforeunload` revoked the object URL. |
| Baseline run | Confirmed working before any change (syntax check + browser run). Backup commit `1f43d02` on branch `master`. |

### Baseline playback limitation (the actual problem)

The only gate on a dropped file was the **extension**:

```js
const videoExtensions = ['mp4','webm','mov','mkv','avi','m4v','ogv'];
```

`avi`, `mkv`, `mpg`, `ts` were therefore *accepted*, set as the video source, and
only then failed with a generic `MEDIA_ERR_SRC_NOT_SUPPORTED` message
("This video format is not supported by your browser"). There was:

- no container inspection, so a `.mkv` was treated as playable regardless of codec;
- no codec identification, so the error could not say *what* was unsupported;
- no distinction between "wrong file type" and "right container, undecodable codec";
- no way to tell a user whether converting to H.264 would fix it.

Everything was also untyped: DOM lookups, state strings and event payloads had no
compile-time checks, and `script.js` mixed UI, session rules and engine calls in
one 539-line file.

---

## 2. What was changed

### 2.1 TypeScript foundation (Phase B)

- Added **Vite + TypeScript 5** with `strict: true`, `noUnusedLocals`,
  `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- `index.html` now loads one module entry: `<script type="module" src="/src/main.ts">`.
- **The Stitch markup and styling were not touched** — same IDs, classes,
  Tailwind CDN config and inline `<style>` block. Only the single script tag changed.
- `script.js` remains on disk as the pre-upgrade reference; it is no longer
  loaded. The compiled logic lives in `src/`.

### 2.2 Layers (Phase B/C)

```text
src/
  main.ts                      composition root (chooses the engine)
  types/
    media.ts                   SessionState, MediaMetadata, probe results, errors, events
    globals.ts                 webkit-* fullscreen typings
  playback/
    PlaybackAdapter.ts         engine-agnostic interface + typed event emitter
    BrowserVideoAdapter.ts     native HTML5 engine (baseline)
    WasmMediaAdapter.ts        optional engine seam (not bundled — see feasibility doc)
    PlaybackCapabilities.ts    canPlayType + probe → verdict
    PlaybackErrors.ts          MediaError → normalized PlaybackError
  session/
    SessionState.ts            state machine + legal transitions
    SessionManager.ts          states, anti-skip ceiling, 1× lock, completion
  files/
    LocalFileManager.ts        validation + probe orchestration
    MediaProbe.ts              magic-byte container/codec reader (64 KB head only)
  ui/
    WorkspaceUI.ts             binds existing DOM to the layers above
    format.ts                  time / size formatting
```

`WorkspaceUI` never touches engine internals; `SessionManager` never touches the
DOM. Swapping in another engine only requires implementing `PlaybackAdapter` and
changing one line in `main.ts`.

### 2.3 Playback compatibility improvements (Phase C/D)

1. **Container detection from magic bytes**, not the extension: `ftyp` (MP4/MOV),
   EBML (MKV/WebM, split by DocType), `RIFF…AVI`, `OggS`, `FLV`, MPEG-TS sync
   byte, MPEG-PS/ES start codes.
2. **Codec identification** for the containers that matter:
   - ISO BMFF: walks `moov/trak/mdia/minf/stbl/stsd` and resolves the sample-entry
     fourcc (`avc1`, `hvc1`, `vp09`, `av01`, `mp4a`, `opus`, …);
   - Matroska: finds `CodecID` (`V_MPEG4/ISO/AVC`, `V_MPEGH/ISO/HEVC`, `V_VP9`,
     `V_AV1`, `A_OPUS`, …) and maps it to a friendly codec name;
   - AVI: VfW fourcc hints (`H264`, `XVID`, `DIVX`, `MPGJ`, `MP3`, `AC3`).
3. **Honest pre-flight verdicts.** Known-undecodable combinations are rejected
   *before* the file is mounted, with the reason spelled out (e.g. *"Matroska
   (.mkv) with HEVC video cannot be demuxed by browser video elements"*).
   H.264-in-MKV is deliberately *not* rejected — some browsers do play it, so the
   engine gets the final say.
4. **Precise runtime errors.** `MediaError` codes are mapped to normalized
   `PlaybackError`s, and the probe data is folded into the hint so the message
   names the detected container/codecs.
5. **A 12-second metadata timeout**, so an unsupported demuxer produces a clear
   message instead of an indefinite empty frame.

**Explicitly not done:** no decoder was written, no format was added to the
"promised" list, and no universal-support claim is made. A container extension
still does not guarantee playback — see COMPATIBILITY.md.

### 2.4 Session and anti-skip (Phase F)

Behaviour preserved, but rebuilt as a real state machine:

- `SESSION_TRANSITIONS` rejects illegal moves (e.g. `completed → live`).
- Anti-skip keeps a `furthestTime` ceiling and snaps the engine back on any seek
  past `ceiling + 0.5s`; rewinding is allowed by design.
- 1× rate lock re-applies on every `ratechange` during live/paused.
- Completion fires only from the engine's real `ended` event.

**Bug found and fixed during verification:** HTML5 fires `pause` *immediately
before* `ended`. The first implementation transitioned `live → paused` on that
`pause`, after which `ended` could no longer reach `completed`. `SessionManager`
now defers the pause transition by one macrotask and cancels it when `ended`
arrives. This is why the state machine tolerates `paused → completed` as well.

### 2.5 Privacy (Phase G)

Unchanged and strengthened: one `blob:` object URL created from the `File`,
revoked on replace/dispose; a single ablation point (`BrowserVideoAdapter.dispose`);
no storage, no telemetry, no fetch. Verified by automated test — see below.

---

## 3. Verification

`npm run build` → typecheck clean, **26.6 kB JS (8.8 kB gzip)**.

`tests/e2e/livex.spec.ts` → **37/37 checks pass** in Chromium via Playwright, covering:

- boot with no console/page errors; exactly one `<video>` instance;
- all 12 fixtures of the compatibility matrix (see COMPATIBILITY.md);
- `ready → live → paused → live → completed` with the correct badges;
- playback starts at 0 and advances; rate forced back to 1× after an external
  attempt to set 2×;
- a forward seek is snapped back to the ceiling (requested 5.00s → landed 2.37s);
- rewinding works;
- replacing the file does **not** register as completion;
- video source is a `blob:` URL and **zero non-GET requests** were made during
  the entire run — no upload, convert or transcode endpoint was contacted.

Not verified automatically: real-device/OS HEVC behaviour outside Chromium,
Safari-specific `webkitEnterFullscreen`, and multi-GB files. These are listed as
manual checks in COMPATIBILITY.md.

---

## 4. WebAssembly engine verdict

**No — not integrated.** Details and numbers in
[FEASIBILITY-WASM.md](./FEASIBILITY-WASM.md). Summary:

The gap that actually blocks users in Chromium is **HEVC (and MPEG-2 / MPEG-4
Part 2)** in a browser that does not ship those decoders. Closing it with
FFmpeg.wasm means a large engine download and, because FFmpeg.wasm cannot use
hardware decode, decoding on the main thread/wasm heap with a JS-side presenter.
The cost lands on every user — including the majority whose MP4/WebM files already
play natively — while the benefit is limited to a small set of codecs that
`<video>` refuses.

Per the plan's own gate ("Do not integrate a large media engine before testing
feasibility"), the seam exists (`WasmMediaAdapter`, `PlaybackAdapter`) but no
engine is bundled. If it is revisited, the recommended candidate is **FFmpeg.wasm
(`@ffmpeg/ffmpeg` + `@ffmpeg/core`, LGPL build)** with a *lazy, opt-in* load —
loaded only after a native failure, never on the default path.

---

## 5. Deferred / follow-ups

- `localplay/` remains an untouched upstream reference clone (make it a proper
  submodule or drop it).

### Completed since the first pass (v1.2)

- **Tailwind bundled locally** — `tailwind.config.js` mirrors the previous CDN
  config; the inline `<style>` block moved to `src/styles/app.css`.
- **Fonts self-hosted** via `@fontsource/inter` + `@fontsource/jetbrains-mono`
  (latin subsets, only the weights used: 400/500/600 and 400/500).
- **`style.css` and `script.js` deleted** — both were unreferenced.
- **Accessibility pass** — see §6 below.
- **Result: zero external requests.** Verified twice: a normal load shows 7
  requests, all to localhost; and a test that aborts every non-localhost request
  still plays a full session, with all fonts loaded and the theme intact.

---

## 6. Accessibility (v1.2)

Audited against the running app, then fixed:

| Issue | Fix |
| --- | --- |
| 2 icon-only buttons had no accessible name | `aria-label` on volume/fullscreen, kept in sync with state (`Mute`/`Unmute`, `Fullscreen`/`Exit fullscreen`) |
| `<video>` had no accessible name | `aria-label="Session video"` |
| Session changes were colour/icon only — invisible to screen readers | `#session-announcer` live region (`role="status"`, `aria-live="polite"`, `aria-atomic`) announcing idle/ready/live/paused/completed/error |
| Decorative SVGs announced as images | 18 SVGs marked `aria-hidden="true"` |
| No visible keyboard focus | `.focus-ring` (`:focus-visible`, `#a5a1f8`, 2px offset) on 10 interactive controls |
| Focus could be stranded on a hidden screen after a state change | `syncFocus()` moves focus to the primary action of the new state |
| Decorative drop overlay exposed to AT | `aria-hidden="true"` (keyboard users use the toolbar Open Video button) |
| Volume slider unlabelled | `aria-label="Volume"` |

Contrast check: `--muted-txt` (#8e8e93) on `#121212` measures **5.75:1**, above
the 4.5:1 AA threshold for body text.

Remaining known gaps: `prefers-reduced-motion` is not yet honoured (the
`animate-pulse-dot` LIVE indicator pulses unconditionally), and the app has not
been tested with a real screen reader.

---

## 7. Regression: unstyled build over `file://` (fixed in v1.2.1)

**Symptom:** after bundling Tailwind locally, opening the built page directly
(`double-click dist/index.html`) showed the markup with **no styling at all** —
transparent body, no dark theme, no layout.

**Cause:** two independent `file://` restrictions, not a Tailwind problem:

1. Vite emitted `<link rel="stylesheet" crossorigin href="./assets/index-*.css">`.
   The `crossorigin` attribute forces a CORS check; `file://` has origin `null`,
   so the fetch fails and **zero CSS rules** apply. The JS module failed the same
   way (`net::ERR_FAILED` on both assets).
2. Even without `crossorigin`, `file://` refuses ES module graph imports, so the
   app could never boot from disk.

Both were invisible over HTTP, which is why the earlier checks passed.

**Fix:** the build now emits one self-contained `dist/index.html`:

- `rollupOptions.output.format: "iife"` — the inlined script is valid as a
  *classic* script, the only kind `file://` executes;
- `cssCodeSplit: false`, `modulePreload: false`, `inlineDynamicImports: true`;
- `vite-plugins/inline-single-file.ts` — a `generateBundle` hook that inlines the
  CSS into `<style>` and the JS into `<script>`, and rewrites relative `url(./…)`
  font references to `assets/…` because the stylesheet now lives at the site root
  instead of inside `assets/`.

Result: `dist/index.html` is ~70 kB and works identically over `file://` and http.

**Guard:** `tests/build-check.mjs` (`npm run test:build`) loads the built page
both ways and asserts dark theme, toolbar styling, typography, CSS rule count,
fonts loaded, and that "Open Video" is actually wired — plus zero external
requests. Verified that reverting the fix produces 3 failures, so the guard is
real and not decorative.

**Note on fonts:** woff/woff2 stay as separate files under `dist/assets/`. They
load fine over `file://` because same-origin font subresources are not subject to
the stylesheet CORS rule. Only the stylesheet and module script had to be inlined.
