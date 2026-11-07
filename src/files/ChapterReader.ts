/**
 * ChapterReader — extracts chapter markers embedded in an MP4/MOV file.
 *
 * Roadmap 2.3. Two layouts are common:
 *
 *  1. Nero style: a `chpl` box inside `moov/udta`, a flat list of
 *     (start time in 100ns units, title) pairs.
 *  2. QuickTime style: `chap` tracks referencing a text track. Far rarer, and
 *     it needs a second file read, so it is deliberately out of scope.
 *
 * Only the box structure is walked — no media bytes are decoded, nothing is
 * sent anywhere, and the read is bounded by `moov` being inside the head/tail
 * windows we already fetch for codec detection.
 */

export interface Chapter {
  /** Start time in seconds from the beginning of the file. */
  startTime: number;
  title: string;
  /** Index in the chapter list, for stable DOM keys. */
  index: number;
}

/** Nero `chpl` timestamps are in 100-nanosecond units. */
const UNITS_PER_SECOND = 10_000_000;

/**
 * Parse a `chpl` payload (the bytes *after* the 8-byte box header).
 * Returns an empty array when the structure is not what we expect — a malformed
 * chapter list must never break playback.
 */
export function parseChpl(payload: Uint8Array): Chapter[] {
  if (payload.length < 9) return [];

  try {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    // Layout (confirmed against ffmpeg's writer):
    //   version(1) flags(3) reserved(4) chapterCount(1) entries...
    // The version byte is informational only; both observed versions use the
    // same offset for the chapter count.
    let offset = 4; // version + flags
    offset += 4; // reserved

    const count = view.getUint8(offset);
    offset += 1;

    const chapters: Chapter[] = [];
    for (let i = 0; i < count && offset < payload.length; i += 1) {
      if (offset + 8 > payload.length) break;
      // 64-bit start time; the high word is effectively always zero for media.
      const high = view.getUint32(offset);
      const low = view.getUint32(offset + 4);
      const startUnits = high * 2 ** 32 + low;
      offset += 8;

      if (offset >= payload.length) break;
      const titleLength = view.getUint8(offset);
      offset += 1;

      if (offset + titleLength > payload.length) break;
      const titleBytes = payload.subarray(offset, offset + titleLength);
      offset += titleLength;

      const title = decodeUtf8(titleBytes).trim();
      chapters.push({
        startTime: startUnits / UNITS_PER_SECOND,
        title: title || `Chapter ${i + 1}`,
        index: i,
      });
    }

    // Drop chapters whose times are nonsensical rather than showing garbage.
    return chapters
      .filter((chapter) => Number.isFinite(chapter.startTime) && chapter.startTime >= 0)
      .sort((a, b) => a.startTime - b.startTime)
      .map((chapter, index) => ({ ...chapter, index }));
  } catch {
    return [];
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Walk ISO BMFF boxes in a buffer looking for `chpl`. Buffers here are the
 * same head/tail windows `MediaProbe` already reads, so this adds no I/O.
 */
export function findChaptersInBuffer(buf: Uint8Array): Chapter[] {
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let size = view.getUint32(offset);
    const type = ascii(buf, offset + 4, 4);
    let headerSize = 8;

    if (size === 1) {
      // 64-bit largesize.
      if (offset + 16 > buf.length) break;
      const high = view.getUint32(offset + 8);
      const low = view.getUint32(offset + 12);
      size = high * 2 ** 32 + low;
      headerSize = 16;
    } else if (size === 0) {
      // Box extends to end of file.
      size = buf.length - offset;
    }

    if (size < headerSize || offset + size > buf.length) break;

    if (type === "chpl") {
      return parseChpl(buf.subarray(offset + headerSize, offset + size));
    }

    // `chpl` lives inside `moov`, so descend into containers.
    if (type === "moov" || type === "udta") {
      const inner = findChaptersInBuffer(buf.subarray(offset + headerSize, offset + size));
      if (inner.length > 0) return inner;
    }

    offset += size;
  }
  return [];
}

function ascii(buf: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && offset + i < buf.length; i += 1) {
    out += String.fromCharCode(buf[offset + i]!);
  }
  return out;
}

/** Read chapters from a local file, reusing the probe's head/tail strategy. */
export async function readChapters(file: File): Promise<Chapter[]> {
  const headBytes = 64 * 1024;
  const tailBytes = 2 * 1024 * 1024;

  const head = new Uint8Array(await file.slice(0, headBytes).arrayBuffer());
  const fromHead = findChaptersInBuffer(head);
  if (fromHead.length > 0) return fromHead;

  if (file.size <= headBytes) return [];

  const tailStart = Math.max(0, file.size - tailBytes);
  const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
  return findChaptersInBuffer(tail);
}
