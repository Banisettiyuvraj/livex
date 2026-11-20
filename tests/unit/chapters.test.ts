import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findChaptersInBuffer, parseChpl, readChapters } from "../../src/files/ChapterReader";

const FIXTURES = join(process.cwd(), "tests", "fixtures");

function fixture(name: string): File {
  return new File([readFileSync(join(FIXTURES, name))], name);
}

/**
 * Build a `chpl` payload the way ffmpeg writes it:
 *   version(1) flags(3) reserved(4) count(1) entries
 * with each entry = start(8, 100ns units) + titleLength(1) + title.
 *
 * This was verified by dumping bytes from a real ffmpeg output; the layout is
 * widely misquoted in secondary sources.
 */
function buildChpl(chapters: Array<{ start: number; title: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const titles = chapters.map((c) => encoder.encode(c.title));
  const size = 9 + chapters.reduce((sum, _, i) => sum + 9 + titles[i]!.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  view.setUint8(0, 1); // version
  view.setUint8(4, 0); // reserved (4 bytes at offset 4..7)
  view.setUint8(8, chapters.length);

  let offset = 9;
  chapters.forEach((chapter, i) => {
    const units = Math.round(chapter.start * 10_000_000);
    view.setUint32(offset, Math.floor(units / 2 ** 32));
    view.setUint32(offset + 4, units >>> 0);
    offset += 8;
    const title = titles[i]!;
    view.setUint8(offset, title.length);
    offset += 1;
    out.set(title, offset);
    offset += title.length;
  });

  return out;
}

describe("parseChpl", () => {
  it("parses a well-formed chapter list", () => {
    const payload = buildChpl([
      { start: 0, title: "Intro" },
      { start: 8, title: "Middle" },
      { start: 16, title: "End" },
    ]);
    const chapters = parseChpl(payload);
    expect(chapters).toHaveLength(3);
    expect(chapters.map((c) => c.title)).toEqual(["Intro", "Middle", "End"]);
    expect(chapters.map((c) => c.startTime)).toEqual([0, 8, 16]);
    expect(chapters.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("converts 100ns units to seconds", () => {
    const payload = buildChpl([{ start: 12.5, title: "Half" }]);
    expect(parseChpl(payload)[0]!.startTime).toBeCloseTo(12.5, 6);
  });

  it("sorts by start time and reindexes", () => {
    const payload = buildChpl([
      { start: 20, title: "Later" },
      { start: 5, title: "Earlier" },
    ]);
    const chapters = parseChpl(payload);
    expect(chapters.map((c) => c.title)).toEqual(["Earlier", "Later"]);
    expect(chapters.map((c) => c.index)).toEqual([0, 1]);
  });

  it("substitutes a placeholder for an empty title", () => {
    const payload = buildChpl([{ start: 0, title: "" }]);
    expect(parseChpl(payload)[0]!.title).toBe("Chapter 1");
  });

  it("returns an empty list for a truncated payload", () => {
    const payload = buildChpl([{ start: 0, title: "Intro" }]);
    expect(parseChpl(payload.subarray(0, 6))).toEqual([]);
  });

  it("returns an empty list for junk bytes rather than throwing", () => {
    expect(parseChpl(new Uint8Array([1, 2]))).toEqual([]);
    expect(parseChpl(new Uint8Array(0))).toEqual([]);
    expect(parseChpl(new Uint8Array(64).fill(0xff))).toEqual([]);
  });
});

describe("findChaptersInBuffer", () => {
  it("finds a chpl box nested inside moov/udta", () => {
    const chpl = buildBox("chpl", buildChpl([{ start: 0, title: "Inside" }]));
    const udta = buildBox("udta", chpl);
    const moov = buildBox("moov", udta);

    const chapters = findChaptersInBuffer(moov);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("Inside");
  });

  it("finds a chpl box at the top level of the buffer", () => {
    const chpl = buildBox("chpl", buildChpl([{ start: 0, title: "Flat" }]));
    expect(findChaptersInBuffer(chpl)[0]!.title).toBe("Flat");
  });

  it("returns an empty list when there is no chpl", () => {
    const ftyp = buildBox("ftyp", new Uint8Array([0, 0, 0, 0]));
    expect(findChaptersInBuffer(ftyp)).toEqual([]);
  });

  it("skips a large sibling box without walking into it", () => {
    const mdat = buildBox("mdat", new Uint8Array(1024));
    const chpl = buildBox("chpl", buildChpl([{ start: 1, title: "After mdat" }]));
    const moov = buildBox("moov", buildBox("udta", chpl));
    const buffer = concat(mdat, moov);
    expect(findChaptersInBuffer(buffer)[0]!.title).toBe("After mdat");
  });

  it("stops rather than looping when a box size is nonsense", () => {
    const bad = new Uint8Array(16);
    new DataView(bad.buffer).setUint32(0, 4); // size smaller than a header
    expect(findChaptersInBuffer(bad)).toEqual([]);
  });
});

describe("readChapters", () => {
  it("reads real chapters out of the fixture file", async () => {
    const chapters = await readChapters(fixture("h264-chapters.mp4"));
    expect(chapters.map((c) => c.title)).toEqual([
      "Introduction",
      "Main Argument",
      "Conclusion",
    ]);
    expect(chapters.map((c) => c.startTime)).toEqual([0, 8, 16]);
  });

  it("returns an empty list for a file with no chapters", async () => {
    expect(await readChapters(fixture("h264-aac.mp4"))).toEqual([]);
  });

  it("returns an empty list for a non-MP4 file", async () => {
    expect(await readChapters(fixture("h264-aac.mkv"))).toEqual([]);
  });

  it("never throws on a tiny file", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "tiny.mp4");
    expect(await readChapters(file)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

/** Build a complete ISO BMFF box: 8-byte header (size + type) then payload. */
function buildBox(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
