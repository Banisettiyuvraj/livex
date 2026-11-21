# LiveX Compatibility Matrix (measured)

> A container extension does **not** imply playback. Compatibility is
> **container + codec + browser/device**. Every row below was measured, not assumed.

## Test environment

| Field | Value |
| --- | --- |
| Browser | Chromium 158.0.8127.18 (Playwright headless shell) |
| OS | Windows 11 x64 |
| Engine | Native `HTMLVideoElement` (`BrowserVideoAdapter`) |
| Fixtures | `tests/fixtures/*` — generated with ffmpeg 9.0.2, 320×240, ~6 s |
| Harness | `npm test` (Playwright, Chromium) |

> Chromium headless does **not** include HEVC. Desktop Chrome/Edge on Windows
> usually do (via the OS Media Foundation decoder), and Safari supports HEVC.
> Treat the HEVC rows as "engine/OS dependent", which is exactly why LiveX
> probes instead of trusting the extension.

## Matrix

| # | Container | Video | Audio | Probe detects | Pre-flight | Actual playback |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | MP4 (`.mp4`) | H.264 (`avc1`) | AAC (`mp4a`) | mp4 / avc1 / mp4a | allowed | **Plays** |
| 2 | MP4 (`.mp4`) | HEVC (`hvc1`) | AAC | mp4 / hvc1 / mp4a | allowed | **Plays** (test host decodes HEVC) |
| 3 | WebM | VP8 | Vorbis | webm / VP8 / Vorbis | allowed | **Plays** |
| 4 | WebM | VP9 | Opus | webm / VP9 / Opus | allowed | **Plays** |
| 5 | WebM | AV1 | Opus | webm / AV1 / Opus | allowed | **Plays** |
| 6 | MKV | H.264 | AAC | matroska / H.264 / AAC | allowed | **Plays** |
| 7 | MKV | HEVC | AAC | matroska / HEVC / AAC | **rejected** | Not playable |
| 8 | MOV | H.264 (`avc1`) | AAC | mp4 / avc1 / mp4a | allowed | **Plays** |
| 9 | MOV | HEVC (`hev1`) | AAC | mp4 / hev1 / mp4a | allowed | **Plays** |
| 10 | AVI | MPEG-4 Part 2 | MP3 | avi / MPEG-4 Part 2 / MP3 | **rejected** | Not playable |
| 11 | MPEG-TS | MPEG-2 | MPEG audio | mpeg-ts / MPEG-2 / MPEG audio | **rejected** | Not playable |
| 12 | MPEG-PS | MPEG-2 | MPEG audio | mpeg-ps / MPEG-2 / MPEG audio | **rejected** | Not playable |

Rows 7, 10, 11, 12 are rejected **before** the file is mounted, with a message
naming the detected container and codec — this is the core improvement over the
previous generic "not supported by your browser".

## `canPlayType` report from the test browser

| Combination | `canPlayType` |
| --- | --- |
| MP4 · H.264 + AAC | `probably` |
| MP4 · HEVC | `not supported` |
| MP4 · AV1 | `probably` |
| WebM · VP8 + Vorbis | `probably` |
| WebM · VP9 + Opus | `probably` |
| WebM · AV1 + Opus | `probably` |
| MKV · H.264 | `probably` |
| MOV · H.264 | `not supported` |
| AVI | `not supported` |
| MPEG-TS | `not supported` |
| MPEG-PS | `not supported` |

Note that MOV H.264 reports `not supported` for the `video/quicktime` MIME yet
**plays fine** once loaded — the element sniffs the actual ISO BMFF container.
That is why `canPlayType` is treated as a hint, never as the final verdict.

## Known limitations (documented, not hidden)

- **Containers that browsers refuse outright:** AVI, FLV, MPEG-PS/TS. The probe
  gives a precise explanation, but LiveX cannot play them natively.
- **Codecs without browser decoders:** MPEG-2, MPEG-4 Part 2 (DivX/Xvid),
  HEVC without platform support, and some MKV subtitle-attachment cases.
- **MKV** is only as good as its contents. H.264-in-MKV works in most Chromium
  builds; HEVC-in-MKV does not.
- **AVI/TS/PS codec-level detail** is read from `hdrl/strf`, the PAT/PMT, and
  the PS sequence header. These containers still cannot be demuxed by browser
  video elements, but the rejection names the codec that was found.

## Manual checks still to run (not automatable here)

- [ ] HEVC MP4/MOV on Safari (macOS/iOS) and on Windows Chrome/Edge with hardware HEVC.
- [ ] MOV H.264 on Safari.
- [ ] A multi-GB MP4 on a low-memory device (watch for object-URL memory pressure).
- [ ] Safari-specific `webkitEnterFullscreen` on iOS.
- [ ] Firefox: MKV/WebM/MP4 rows.

## How to add a row

1. Generate a fixture: `ffmpeg -i input ... tests/fixtures/<name>`.
2. Add it to `MATRIX` in `tests/e2e/livex.spec.ts` with
   `expect: "play" | "fail" | "either"`.
3. Run `npm test` (the Playwright `webServer` starts Vite for you — no manual
   `npm run dev` step).
4. Update this table with the measured outcome and browser/OS.

`node tools/audit-compatibility.mjs` checks that every fixture is both asserted
in the spec and documented here, so this table cannot silently drift.
