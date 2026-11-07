/**
 * Lightweight local file probing.
 *
 * Reads only the first few kilobytes of the user's file with `File.slice()` +
 * `arrayBuffer()`. Nothing is copied wholesale into JS memory and nothing is
 * sent anywhere. The goal is not to be a full demuxer: it identifies the
 * container from magic bytes and, for MP4/MOV and Matroska/WebM, extracts the
 * codec fourccs needed to give an accurate "your browser cannot decode X"
 * message instead of a generic failure.
 *
 * A container extension never proves playability — container + codec +
 * browser/device is what matters.
 */

import type { MediaContainer } from "../types/media";

const HEAD_BYTES = 64 * 1024;
/** Extra window read from the tail of the file to find a trailing `moov`. */
const TAIL_BYTES = 2 * 1024 * 1024;

export interface ContainerProbe {
  container: MediaContainer;
  videoCodec: string | null;
  audioCodec: string | null;
}

export async function probeLocalFile(file: File): Promise<ContainerProbe> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());

  const container = detectContainer(head, file.name);

  // MP4/MOV writers commonly put `mdat` before `moov` ("not faststart"), so
  // the index box can be far outside the head window. Only for MP4 do we pay
  // for a second read from the tail of the file.
  let isoBuffer: Uint8Array | null = null;
  if (container === "mp4" && !containsMoov(head)) {
    const tailStart = Math.max(0, file.size - TAIL_BYTES);
    const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());
    if (containsMoov(tail)) isoBuffer = tail;
  }

  const codecs = readCodecs(head, container, isoBuffer);

  return { container, ...codecs };
}

function containsMoov(buf: Uint8Array): boolean {
  // `moov` only ever appears as a box type, so a byte search is sufficient.
  return indexOfAscii(buf, "moov") !== -1;
}

function indexOfAscii(buf: Uint8Array, needle: string): number {
  const n = needle.length;
  const limit = buf.length - n;
  for (let i = 0; i <= limit; i += 1) {
    let match = true;
    for (let j = 0; j < n; j += 1) {
      if (buf[i + j] !== needle.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* Container detection                                                 */
/* ------------------------------------------------------------------ */

function detectContainer(head: Uint8Array, fileName: string): MediaContainer {
  // ISO Base Media (MP4/MOV/M4V): "....ftyp"
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    return "mp4";
  }
  // Matroska / WebM: EBML magic 1A 45 DF A3 — tell them apart by DocType.
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const docType = ascii(head, 0, Math.min(head.length, 4096));
    if (docType.includes("webm")) return "webm";
    return "matroska";
  }
  // RIFF....AVI
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "AVI ") {
    return "avi";
  }
  // RIFF....(WAVE)
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") {
    return "unknown";
  }
  // OggS
  if (ascii(head, 0, 4) === "OggS") {
    return "ogg";
  }
  // FLV
  if (ascii(head, 0, 3) === "FLV") {
    return "flv";
  }
  // MPEG program stream: 00 00 01 BA
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0xba) {
    return "mpeg-ps";
  }
  // MPEG transport stream: sync byte 0x47 every 188 bytes
  if (head[0] === 0x47 && (head.length < 377 || head[188] === 0x47)) {
    return "mpeg-ts";
  }
  // MPEG elementary stream start code 00 00 01 B3 (sequence header)
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0xb3) {
    return "mpeg-ps";
  }

  // Fall back to the extension so a truncated/unusual header still gets a
  // reasonable label rather than "unknown".
  const ext = extensionOf(fileName);
  switch (ext) {
    case "mp4":
    case "m4v":
    case "mov":
      return "mp4";
    case "mkv":
      return "matroska";
    case "webm":
      return "webm";
    case "avi":
      return "avi";
    case "ts":
    case "mts":
    case "m2ts":
      return "mpeg-ts";
    case "mpg":
    case "mpeg":
    case "vob":
      return "mpeg-ps";
    case "ogv":
    case "ogg":
      return "ogg";
    case "flv":
      return "flv";
    default:
      return "unknown";
  }
}

export function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Codec extraction                                                    */
/* ------------------------------------------------------------------ */

function readCodecs(
  head: Uint8Array,
  container: MediaContainer,
  isoBuffer: Uint8Array | null = null,
): { videoCodec: string | null; audioCodec: string | null } {
  switch (container) {
    case "mp4":
      return readIsoBmffCodecs(head, isoBuffer);
    case "matroska":
    case "webm":
      return readMatroskaCodecs(head);
    case "avi":
      return readAviCodecs(head);
    default:
      return { videoCodec: null, audioCodec: null };
  }
}

/**
 * ISO BMFF (MP4/MOV/M4V): scan 4-byte boxes for `stsd` sample entries. The
 * first entry's fourcc is the video/audio codec id (e.g. `avc1`, `hvc1`,
 * `vp09`, `av01`, `mp4a`).
 */
function readIsoBmffCodecs(
  head: Uint8Array,
  tail: Uint8Array | null = null,
): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const result: { videoCodec: string | null; audioCodec: string | null } = {
    videoCodec: null,
    audioCodec: null,
  };

  // Prefer the head; fall back to the tail window when `moov` lives past it.
  const buffers = tail ? [head, tail] : [head];
  for (const buf of buffers) {
    scanIsoBmffBox(buf, 0, buf.length, result);
    if (result.videoCodec || result.audioCodec) break;
  }

  return result;
}

function scanIsoBmffBox(
  buf: Uint8Array,
  start: number,
  end: number,
  result: { videoCodec: string | null; audioCodec: string | null },
): void {
  let offset = start;
  while (offset + 8 <= end) {
    const size = readU32(buf, offset);
    const type = ascii(buf, offset + 4, offset + 8);
    if (size < 8 || offset + size > end) {
      // Truncated final box (typical when scanning a head window): stop here
      // for this level but keep whatever was already collected.
      break;
    }

    if (type === "stsd") {
      // stsd: 8-byte box header, 4 version/flags, 4 entry count, then entries.
      let entry = offset + 16;
      while (entry + 8 <= offset + size) {
        const entryType = ascii(buf, entry + 4, entry + 8);
        const handler = classifySampleEntry(entryType);
        if (handler === "vide" && !result.videoCodec) result.videoCodec = entryType;
        if (handler === "soun" && !result.audioCodec) result.audioCodec = entryType;
        const entrySize = readU32(buf, entry);
        if (entrySize < 8) break;
        entry += entrySize;
      }

      // `hdlr` boxes in the same stbl are not always present before stsd (it
      // normally is); if they were skipped the sample-entry tables below still
      // resolve the common codecs correctly.
    }

    // Recurse into container boxes that can hold stsd.
    if (["trak", "mdia", "minf", "stbl", "moov"].includes(type)) {
      scanIsoBmffBox(buf, offset + 8, offset + size, result);
    }

    offset += size;
  }
}

/**
 * Classify an `stsd` sample entry by its fourcc. ISO BMFF does not mark video
 * vs audio inside the sample entry itself, so a lookup table of known video and
 * audio codec fourccs is the practical way to separate the two lists without a
 * full box parser.
 */
const VIDEO_FOURCCS = new Set([
  "avc1", "avc3", "hvc1", "hev1", "vp08", "vp09", "av01", "mp4v", "dvh1",
  "dvhe", "encv", "jpeg", "png ", "ap4h", "apch", "apcn", "apcs", "apco",
  "ap4x", "s263", "h263", "mjpa", "mjpb",
]);

const AUDIO_FOURCCS = new Set([
  "mp4a", "opus", "Opus", "ac-3", "ec-3", "alac", "fLaC", "sowt", "twos",
  "lpcm", "ipcm", "fpcm", "in24", "in32", "fl32", "fl64", "samr", "sawb",
  "enca", "dtsc", "dtse", "dtsh",
]);

function classifySampleEntry(fourcc: string): "vide" | "soun" | null {
  if (VIDEO_FOURCCS.has(fourcc)) return "vide";
  if (AUDIO_FOURCCS.has(fourcc)) return "soun";
  return null;
}

function readMatroskaCodecs(head: Uint8Array): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const text = ascii(head, 0, head.length);
  return {
    videoCodec: normalizeMatroskaCodec(findMatroskaCodecID(text, ["V_"], ["V_MS/VFW"])),
    audioCodec: normalizeMatroskaCodec(findMatroskaCodecID(text, ["A_"], ["A_MS/ACM"])),
  };
}

function findMatroskaCodecID(
  text: string,
  prefixes: string[],
  _fallbacks: string[],
): string | null {
  for (const prefix of prefixes) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(prefix, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + 1;

      let end = idx;
      while (end < text.length && end - idx < 48) {
        const chCode = text.charCodeAt(end);
        // CodecIDs are printable ASCII (A-Z, a-z, 0-9, '_', '/', '.', '-').
        const printable =
          (chCode >= 0x41 && chCode <= 0x5a) ||
          (chCode >= 0x61 && chCode <= 0x7a) ||
          (chCode >= 0x30 && chCode <= 0x39) ||
          chCode === 0x5f ||
          chCode === 0x2f ||
          chCode === 0x2e ||
          chCode === 0x2d;
        if (!printable) break;
        end += 1;
      }

      const candidate = text.slice(idx, end);
      // The EBML payload that follows a CodecID immediately returns to binary,
      // so trailing bytes of the *next* element can be mis-read as ASCII. Keep
      // only candidates that are a known codec or exactly two path segments
      // more than the prefix (e.g. "A_OPUS", "V_MPEG4/ISO/AVC").
      if (KNOWN_MATROSKA_CODECS.has(candidate) || isPlausibleCodecId(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

const KNOWN_MATROSKA_CODECS = new Set([
  "V_MPEG4/ISO/AVC",
  "V_MPEGH/ISO/HEVC",
  "V_VP8",
  "V_VP9",
  "V_AV1",
  "V_MPEG2",
  "V_MPEG4/ISO/ASP",
  "V_MS/VFW",
  "V_THEORA",
  "A_AAC",
  "A_OPUS",
  "A_VORBIS",
  "A_AC3",
  "A_EAC3",
  "A_DTS",
  "A_MPEG/L3",
  "A_FLAC",
  "A_PCM/INT/LIT",
  "A_MS/ACM",
]);

/**
 * EBML strings are length-prefixed, so a trailing byte from the following
 * binary payload frequently looks printable. Reject candidates that do not
 * resolve to a known codec id, and strip a known id out of a longer match.
 */
function isPlausibleCodecId(candidate: string): boolean {
  for (const known of KNOWN_MATROSKA_CODECS) {
    if (candidate.startsWith(known)) return true;
  }
  return false;
}

function exactMatroskaCodec(candidate: string): string {
  for (const known of KNOWN_MATROSKA_CODECS) {
    if (candidate.startsWith(known)) return known;
  }
  return candidate;
}

function normalizeMatroskaCodec(codecId: string | null): string | null {
  if (!codecId) return null;
  const exact = exactMatroskaCodec(codecId);
  const table: Record<string, string> = {
    "V_MPEG4/ISO/AVC": "H.264",
    "V_MPEGH/ISO/HEVC": "HEVC",
    "V_VP8": "VP8",
    "V_VP9": "VP9",
    "V_AV1": "AV1",
    "V_MPEG2": "MPEG-2",
    "V_MPEG4/ISO/ASP": "MPEG-4 Part 2",
    "V_MS/VFW/FOURCC": "VfW codec",
    "A_AAC": "AAC",
    "A_OPUS": "Opus",
    "A_VORBIS": "Vorbis",
    "A_AC3": "AC-3",
    "A_EAC3": "E-AC-3",
    "A_DTS": "DTS",
    "A_MPEG/L3": "MP3",
    "A_FLAC": "FLAC",
    "A_PCM/INT/LIT": "PCM",
    "A_MS/ACM": "ACM audio",
  };
  return table[exact] ?? exact;
}

function readAviCodecs(head: Uint8Array): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const text = ascii(head, 0, head.length);
  const fourcc = text.includes("H264") ? "H.264" : text.includes("XVID") ? "Xvid" : text.includes("DIVX") ? "DivX" : text.includes("MJPG") ? "Motion JPEG" : null;
  const audio = text.includes("MP3") ? "MP3" : text.includes("AC3") ? "AC-3" : text.includes("PCM") ? "PCM" : null;
  return { videoCodec: fourcc, audioCodec: audio };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function ascii(buf: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < Math.min(end, buf.length); i += 1) {
    const byte = buf[i];
    if (byte === undefined) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

function readU32(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) << 24) |
    ((buf[offset + 1] ?? 0) << 16) |
    ((buf[offset + 2] ?? 0) << 8) |
    (buf[offset + 3] ?? 0)
  ) >>> 0;
}
