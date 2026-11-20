import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { probeLocalFile } from "../../src/files/MediaProbe";

/**
 * Probe tests against the real fixture files (roadmap 4.1).
 *
 * The probe reads through the File API, so each fixture is wrapped in a `File`
 * built from the bytes on disk. Node 20+ provides `File` globally.
 *
 * Note on codec strings: the two container families report codecs differently
 * and that is intentional —
 *   - MP4/MOV exposes the raw sample-entry fourcc (`avc1`, `hvc1`, `av01`),
 *     because that is what the browser's own error reporting would show.
 *   - Matroska/WebM normalises its `CodecID` to a friendly name (`H.264`).
 * Assertions below pin the *current* contract so a silent change is caught.
 */
const FIXTURES = join(process.cwd(), "tests", "fixtures");

function fixture(name: string): File {
  const bytes = readFileSync(join(FIXTURES, name));
  return new File([bytes], name);
}

describe("probeLocalFile — containers", () => {
  it("detects MP4", async () => {
    const probe = await probeLocalFile(fixture("h264-aac.mp4"));
    expect(probe.container).toBe("mp4");
  });

  it("detects Matroska", async () => {
    const probe = await probeLocalFile(fixture("h264-aac.mkv"));
    expect(probe.container).toBe("matroska");
  });

  it("distinguishes WebM from Matroska by DocType", async () => {
    const probe = await probeLocalFile(fixture("vp9-opus.webm"));
    expect(probe.container).toBe("webm");
  });

  it("treats QuickTime MOV as ISO BMFF", async () => {
    const probe = await probeLocalFile(fixture("h264.mov"));
    expect(probe.container).toBe("mp4");
  });

  it("detects AVI", async () => {
    const probe = await probeLocalFile(fixture("mpeg4.avi"));
    expect(probe.container).toBe("avi");
  });

  it("detects MPEG-TS", async () => {
    const probe = await probeLocalFile(fixture("mpeg2.ts"));
    expect(probe.container).toBe("mpeg-ts");
  });
});

describe("probeLocalFile — MP4 codecs use raw fourcc", () => {
  it("names H.264 and AAC in MP4", async () => {
    const probe = await probeLocalFile(fixture("h264-aac.mp4"));
    expect(probe.videoCodec).toBe("avc1");
    expect(probe.audioCodec).toBe("mp4a");
  });

  it("names HEVC in MP4", async () => {
    const probe = await probeLocalFile(fixture("hevc-aac.mp4"));
    expect(probe.videoCodec).toBe("hvc1");
  });
});

describe("probeLocalFile — Matroska codecs are normalised", () => {
  it("names H.264 and AAC in MKV", async () => {
    // Regression: the parser used to walk past the audio codec id into the
    // next box and report "A_VORBISV". It must stop at a known codec.
    const probe = await probeLocalFile(fixture("h264-aac.mkv"));
    expect(probe.videoCodec).toBe("H.264");
    expect(probe.audioCodec).toBe("AAC");
  });

  it("names HEVC in MKV", async () => {
    const probe = await probeLocalFile(fixture("hevc-aac.mkv"));
    expect(probe.videoCodec).toBe("HEVC");
  });
});

describe("probeLocalFile — WebM codecs", () => {
  it("names VP9 and Opus", async () => {
    const probe = await probeLocalFile(fixture("vp9-opus.webm"));
    expect(probe.videoCodec).toBe("VP9");
    expect(probe.audioCodec).toBe("Opus");
  });

  it("names VP8 and Vorbis", async () => {
    const probe = await probeLocalFile(fixture("vp8-vorbis.webm"));
    expect(probe.videoCodec).toBe("VP8");
    expect(probe.audioCodec).toBe("Vorbis");
  });

  it("names AV1", async () => {
    const probe = await probeLocalFile(fixture("av1-opus.webm"));
    expect(probe.videoCodec).toBe("AV1");
  });
});

describe("probeLocalFile — robustness", () => {
  it("returns 'unknown' rather than throwing for a non-video file", async () => {
    const file = new File([new TextEncoder().encode("not a video at all")], "note.txt");
    const probe = await probeLocalFile(file);
    expect(probe.container).toBe("unknown");
    expect(probe.videoCodec).toBeNull();
    expect(probe.audioCodec).toBeNull();
  });

  it("never throws on an empty file", async () => {
    // An empty file with an .mp4 name still probes as mp4 via extension
    // fallback; what matters is that it does not throw.
    const probe = await probeLocalFile(new File([], "empty.mp4"));
    expect(probe.container).toBeDefined();
    expect(probe.videoCodec).toBeNull();
  });

  it("reads chapters-bearing MP4 without corrupting codec detection", async () => {
    const probe = await probeLocalFile(fixture("h264-chapters.mp4"));
    expect(probe.container).toBe("mp4");
    expect(probe.videoCodec).toBe("avc1");
  });
});
