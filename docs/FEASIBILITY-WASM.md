# WebAssembly Media Engine — Feasibility Assessment

**Decision: NO-GO for bundling an engine now. GO for keeping the seam.**

The plan (§6 Stage 4) says a WebAssembly engine may only be integrated after an
isolated spike proves local input, playback, audio, seeking, pause/resume, 1×
rate, acceptable performance and a viable license. This document records that
assessment against the measured baseline.

---

## 1. What is actually broken natively?

From [COMPATIBILITY.md](./COMPATIBILITY.md), in the reference Chromium build:

| Unsupported natively | Frequency in practice | Fixable by wasm? |
| --- | --- | --- |
| AVI (MPEG-4 Part 2 / Xvid) | Low–medium (older course rips) | Yes, but needs full demuxer + decoder |
| MPEG-2 (TS/PS) | Low (broadcast/legacy captures) | Yes |
| HEVC in MKV | Low | Yes |
| HEVC in MP4/MOV | Depends on OS decoder | Already works where the OS decodes it |
| MP4 H.264, WebM VP8/VP9/AV1, MKV H.264 | — | Already work natively |

So the engine would only ever be exercised for a **minority of files** in a
set that is otherwise served perfectly by hardware-accelerated native decode.

## 2. Candidate engines

### FFmpeg compiled to WebAssembly (`@ffmpeg/ffmpeg` + `@ffmpeg/core`)

- Widest container/codec coverage of the options; demuxes AVI/TS/PS/MKV/HEVC.
- **LGPL `core` build is ~30 MB uncompressed** before gzipping; the default
  `core` variants ship separately from a slim `core-mt` build. Loading it lazily
  only on failure is essential.
- Requires a **multi-threaded / SharedArrayBuffer** setup for usable speed —
  which needs COOP/COEP response headers. LiveX is deployed as **static hosting**
  with no backend; adding those headers means changing the deployment model,
  which the plan explicitly forbids ("preserve current website deployment").
- Single-threaded fallback works without headers but decodes far slower than
  real time for anything above low resolution.
- Output integration is entirely on us: FFmpeg gives frames/audio, not a player.
  We would need to push decoded video frames into a `<canvas>`/`ImageBitmap`
  pipeline and audio into an `AudioContext` queue, plus write our own seeking,
  A/V sync and backpressure. That is a new subsystem, not an adapter tweak.
- Decoding runs in wasm memory — **no hardware decode**, so CPU and battery cost
  is far above native, and a full-file read into the wasm FS adds memory pressure
  on large files.

### libVLC / VLC WebAssembly

- No maintained, generally-available browser distribution comparable to
  `@ffmpeg/ffmpeg`. The community experiments (`vlc.js` / wasm prototypes) are
  proof-of-concept quality, with limited browser support and no stable API story.
- Desktop libVLC's format support **does not automatically transfer** to a wasm
  build (the plan warns about exactly this).
- LGPL/GPL obligations plus a much larger build.
- Verdict: not viable for a static site today.

## 3. Scores against the plan's stage-4 gate

| Requirement | ffmpeg.wasm | libVLC wasm |
| --- | --- | --- |
| Local file input, no upload | ✅ | ⚠️ prototype-dependent |
| Plays in target browser | ✅ | ⚠️ limited |
| Audio **and** video output | ⚠️ must be written by hand (canvas + AudioContext) | ⚠️ |
| Seeking / time reporting | ⚠️ must be written by hand | ⚠️ |
| Pause / resume | ✅ (engine-level) | ⚠️ |
| 1× rate control | ✅ (drop frames to hold 1×) | ⚠️ |
| Reasonable performance on representative files | ❌ single-threaded; ⚠️ needs COOP/COEP headers = deployment change | ❌ |
| Licensing / maintenance | ✅ LGPL, active | ❌ |
| Fits "no backend / no deployment change" | ❌ (headers) or slow (no headers) | ❌ |

**Gate result: fails on performance and on the deployment constraint.**

## 4. What was built instead

- `PlaybackAdapter` — a real interface the UI/session layer is written against.
- `WasmMediaAdapter` — an implementable seam that currently fails closed with an
  honest message (`unsupported-codec`, "engine not available in this build").
- One integration point in `src/main.ts`:
  ```ts
  const adapter = new BrowserVideoAdapter(video);
  // → new WasmMediaAdapter(cfg) once the gate passes
  ```
- Capability probing so users learn **why** a file fails and what to convert to,
  instead of a bare "unsupported" error.

No multi-megabyte engine is shipped, so the 26.6 kB (8.8 kB gzip) bundle and
hardware decoding are preserved for every user.

## 5. Reopening this decision

Revisit only if **all** of these hold:

1. There is real evidence that non-native formats are a large share of dropped files.
2. The site can serve COOP/COEP headers (or a single-threaded engine reaches
   near-real-time decode for typical 1080p content).
3. A canvas + WebAudio presenter and A/V sync clock are budgeted as a project.
4. The engine loads **lazily and opt-in**, only after a native failure, behind a
   feature flag — never on the default path.

If that happens, the recommended candidate is **ffmpeg.wasm LGPL core**, loaded
on demand, with the same `PlaybackAdapter` contract. Nothing outside
`WasmMediaAdapter.ts` and one line of `main.ts` needs to change.
