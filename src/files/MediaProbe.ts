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
    case "mpeg-ts":
      return readMpegTsCodecs(head);
    case "mpeg-ps":
      return readMpegPsCodecs(head);
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

/* ------------------------------------------------------------------ */
/* AVI — RIFF hdrl / strl / strf                                       */
/* ------------------------------------------------------------------ */

interface AviStream {
  type: string;
  handler: string;
  formatStart: number;
  formatSize: number;
}

/**
 * AVI stores the real codec ids in `hdrl → strl`:
 *   - `strh.fccType` says video (`vids`) or audio (`auds`)
 *   - `strf` holds a BITMAPINFOHEADER (`biCompression` fourcc) for video or a
 *     WAVEFORMATEX (`wFormatTag`) for audio
 * A printable-byte search over the file can easily match payload data, so only
 * fall back to it when the structured header could not be read at all.
 */
function readAviCodecs(head: Uint8Array): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const streams: AviStream[] = [];

  const walk = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      const id = ascii(head, offset, offset + 4);
      const size = readU32LE(head, offset + 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + size;
      // The head window can cut the final chunk short; keep what we have.
      if (dataEnd > end) break;

      if (id === "LIST" && dataStart + 4 <= dataEnd) {
        const listType = ascii(head, dataStart, dataStart + 4);
        if (listType === "strl") {
          const stream = readAviStrl(head, dataStart + 4, dataEnd);
          if (stream) streams.push(stream);
        } else {
          walk(dataStart + 4, dataEnd);
        }
      }

      // RIFF chunks are word-aligned: an odd size has one pad byte.
      offset = dataEnd + (size & 1);
    }
  };
  walk(12, head.length);

  const video = streams.find((stream) => stream.type === "vids");
  const audio = streams.find((stream) => stream.type === "auds");
  const videoCodec = video ? aviVideoCodec(head, video) : null;
  const audioCodec = audio ? aviAudioCodec(head, audio) : null;

  // Unusual/truncated AVI: keep the old best-effort labels rather than nothing.
  if (!videoCodec && !audioCodec) return readAviAsciiFallback(head);
  return { videoCodec, audioCodec };
}

function readAviStrl(head: Uint8Array, start: number, end: number): AviStream | null {
  let type = "";
  let handler = "";
  let formatStart = -1;
  let formatSize = 0;

  let offset = start;
  while (offset + 8 <= end) {
    const id = ascii(head, offset, offset + 4);
    const size = readU32LE(head, offset + 4);
    const dataStart = offset + 8;
    if (dataStart + size > end) break;

    if (id === "strh" && size >= 8) {
      type = ascii(head, dataStart, dataStart + 4);
      handler = ascii(head, dataStart + 4, dataStart + 8);
    } else if (id === "strf") {
      formatStart = dataStart;
      formatSize = size;
    }
    offset = dataStart + size + (size & 1);
  }

  if (!type && formatStart < 0) return null;
  return { type, handler, formatStart, formatSize };
}

const AVI_VIDEO_CODECS: Record<string, string> = {
  FMP4: "MPEG-4 Part 2",
  MP4V: "MPEG-4 Part 2",
  MP4S: "MPEG-4 Part 2",
  XVID: "MPEG-4 Part 2",
  DIVX: "MPEG-4 Part 2",
  DX50: "MPEG-4 Part 2",
  DIV3: "MPEG-4 Part 2",
  "3IV2": "MPEG-4 Part 2",
  H264: "H.264",
  X264: "H.264",
  AVC1: "H.264",
  DAVC: "H.264",
  HEVC: "HEVC",
  H265: "HEVC",
  HVC1: "HEVC",
  HEV1: "HEVC",
  MJPG: "Motion JPEG",
  JPEG: "Motion JPEG",
  VP80: "VP8",
  VP90: "VP9",
  AV01: "AV1",
  HFYU: "HuffYUV",
  IV50: "Indeo 5",
  IV41: "Indeo 4",
  IV32: "Indeo 3",
  "RGB ": "Uncompressed RGB",
  DIB: "Uncompressed RGB",
};

function aviVideoCodec(head: Uint8Array, stream: AviStream): string | null {
  // BITMAPINFOHEADER.biCompression sits at byte 16. Fall back to strh's
  // fccHandler when the format block is too short (some old encoders).
  let fourcc = stream.handler;
  if (stream.formatStart >= 0 && stream.formatSize >= 20) {
    const candidate = ascii(head, stream.formatStart + 16, stream.formatStart + 20);
    if (isPrintableFourcc(candidate)) fourcc = candidate;
  }
  const trimmed = fourcc.trim();
  if (!trimmed) return null;
  return AVI_VIDEO_CODECS[trimmed.toUpperCase()] ?? (isPrintableFourcc(fourcc) ? trimmed : null);
}

const AVI_AUDIO_CODECS: Record<number, string> = {
  0x0001: "PCM",
  0x0003: "IEEE float",
  0x0006: "A-law",
  0x0007: "μ-law",
  0x0050: "MP2",
  0x0055: "MP3",
  0x00ff: "AAC",
  0x0161: "WMA",
  0x0162: "WMA Pro",
  0x2000: "AC-3",
  0x2001: "DTS",
  0x704f: "Opus",
  0xf1ac: "FLAC",
};

function aviAudioCodec(head: Uint8Array, stream: AviStream): string | null {
  if (stream.formatStart < 0 || stream.formatSize < 2) return null;
  let tag = readU16LE(head, stream.formatStart);
  // WAVE_FORMAT_EXTENSIBLE stores the real tag in the SubFormat GUID.
  if (tag === 0xfffe && stream.formatSize >= 26) {
    tag = readU16LE(head, stream.formatStart + 24);
  }
  return AVI_AUDIO_CODECS[tag] ?? null;
}

function readAviAsciiFallback(head: Uint8Array): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const text = ascii(head, 0, head.length);
  const fourcc = text.includes("H264")
    ? "H.264"
    : text.includes("XVID")
      ? "MPEG-4 Part 2"
      : text.includes("DIVX")
        ? "MPEG-4 Part 2"
        : text.includes("MJPG")
          ? "Motion JPEG"
          : null;
  const audio = text.includes("MP3") ? "MP3" : text.includes("AC3") ? "AC-3" : text.includes("PCM") ? "PCM" : null;
  return { videoCodec: fourcc, audioCodec: audio };
}

/* ------------------------------------------------------------------ */
/* MPEG-TS — PAT → PMT                                                 */
/* ------------------------------------------------------------------ */

interface TsSection {
  pid: number;
  start: number;
  length: number;
  tableId: number;
}

/** Read the first section beginning in a transport packet (PUSI set). */
function readTsSection(head: Uint8Array, packetStart: number, packetSize: number): TsSection | null {
  const packetEnd = Math.min(head.length, packetStart + packetSize);
  if (packetStart + 4 > packetEnd || head[packetStart] !== 0x47) return null;
  // Payload-unit-start indicator: only this packet begins a new section.
  if ((head[packetStart + 1]! & 0x40) === 0) return null;

  const pid = ((head[packetStart + 1]! & 0x1f) << 8) | head[packetStart + 2]!;
  const adaptation = (head[packetStart + 3]! >> 4) & 0x03;
  let payload = packetStart + 4;
  if ((adaptation & 0x02) !== 0) payload += 1 + head[payload]!;
  if ((adaptation & 0x01) === 0 || payload + 3 > packetEnd) return null;

  // `pointer_field` says where the section starts after any previous tail.
  const sectionStart = payload + 1 + head[payload]!;
  if (sectionStart + 3 > packetEnd) return null;

  const tableId = head[sectionStart]!;
  const length = ((head[sectionStart + 1]! & 0x0f) << 8) | head[sectionStart + 2]!;
  // PAT/PMT sections are tiny; reject a wild length rather than misread.
  if (length < 9 || length > 1021) return null;
  return { pid, start: sectionStart, length, tableId };
}

const TS_STREAM_TYPES: Record<number, { name: string; kind: "video" | "audio" }> = {
  0x01: { name: "MPEG-1", kind: "video" },
  0x02: { name: "MPEG-2", kind: "video" },
  0x10: { name: "MPEG-4 Part 2", kind: "video" },
  0x1b: { name: "H.264", kind: "video" },
  0x24: { name: "HEVC", kind: "video" },
  0x03: { name: "MPEG audio", kind: "audio" },
  0x04: { name: "MPEG audio", kind: "audio" },
  0x0f: { name: "AAC", kind: "audio" },
  0x11: { name: "AAC", kind: "audio" },
  0x81: { name: "AC-3", kind: "audio" },
  0x82: { name: "DTS", kind: "audio" },
  0x87: { name: "E-AC-3", kind: "audio" },
  0x8a: { name: "DTS", kind: "audio" },
};

function readMpegTsCodecs(head: Uint8Array): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  const packetSize = detectTsPacketSize(head);
  if (!packetSize) return { videoCodec: null, audioCodec: null };

  let pmtPid: number | null = null;
  const sections: TsSection[] = [];
  for (let offset = 0; offset + packetSize <= head.length; offset += packetSize) {
    const section = readTsSection(head, offset, packetSize);
    if (section) sections.push(section);
  }

  // PAT: program entries start after the 8-byte section header.
  for (const section of sections) {
    if (section.tableId !== 0x00) continue;
    const end = section.start + 3 + section.length - 4; // drop CRC32
    for (let entry = section.start + 8; entry + 4 <= end; entry += 4) {
      const program = readU16BE(head, entry);
      const pid = readU16BE(head, entry + 2) & 0x1fff;
      if (program !== 0) {
        pmtPid = pid;
        break;
      }
    }
    if (pmtPid !== null) break;
  }

  const pmt = pmtPid === null ? null : sections.find((s) => s.pid === pmtPid && s.tableId === 0x02);
  if (!pmt) return { videoCodec: null, audioCodec: null };

  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  const programInfoLength = readU16BE(head, pmt.start + 10) & 0x0fff;
  const end = pmt.start + 3 + pmt.length - 4;
  let entry = pmt.start + 12 + programInfoLength;
  while (entry + 5 <= end) {
    const streamType = head[entry]!;
    const esInfoLength = readU16BE(head, entry + 3) & 0x0fff;
    const mapped = TS_STREAM_TYPES[streamType];
    if (mapped?.kind === "video" && !videoCodec) videoCodec = mapped.name;
    if (mapped?.kind === "audio" && !audioCodec) audioCodec = mapped.name;
    entry += 5 + esInfoLength;
  }

  return { videoCodec, audioCodec };
}

function detectTsPacketSize(head: Uint8Array): number | null {
  // 188 is the standard; M2TS adds a 4-byte timestamp, TS-over-204 adds RS.
  for (const size of [188, 192, 204]) {
    if (head.length > size && head[0] === 0x47 && head[size] === 0x47) return size;
  }
  return head[0] === 0x47 ? 188 : null;
}

/* ------------------------------------------------------------------ */
/* MPEG-PS — program stream map / sequence header                      */
/* ------------------------------------------------------------------ */

function readMpegPsCodecs(head: Uint8Array): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;

  // A program stream map names the elementary streams where the muxer wrote one.
  const psm = findStartCode(head, 0xbc);
  if (psm >= 0) {
    const length = readU16BE(head, psm + 4);
    const mapEnd = Math.min(head.length, psm + 6 + length);
    // 1 byte flags, 2 bytes program info length, then that many descriptors.
    let entry = psm + 9 + (readU16BE(head, psm + 7) & 0x0fff) + 2;
    while (entry + 4 <= mapEnd) {
      const streamType = head[entry]!;
      const infoLength = readU16BE(head, entry + 2) & 0x0fff;
      const mapped = TS_STREAM_TYPES[streamType];
      if (mapped?.kind === "video" && !videoCodec) videoCodec = mapped.name;
      if (mapped?.kind === "audio" && !audioCodec) audioCodec = mapped.name;
      entry += 4 + infoLength;
    }
  }

  // Without a PSM, the sequence header still separates MPEG-1 from MPEG-2.
  if (!videoCodec) {
    const sequence = findStartCode(head, 0xb3);
    if (sequence >= 0) {
      videoCodec = hasStartCodeNear(head, 0xb5, sequence + 4, sequence + 64) ? "MPEG-2" : "MPEG-1";
    }
  }

  if (!audioCodec && hasMpegAudioStream(head)) audioCodec = "MPEG audio";
  return { videoCodec, audioCodec };
}

/** First offset of a 00 00 01 <id> start code, or -1. */
function findStartCode(buf: Uint8Array, id: number): number {
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === 0x00 && buf[i + 1] === 0x00 && buf[i + 2] === 0x01 && buf[i + 3] === id) {
      return i;
    }
  }
  return -1;
}

function hasStartCodeNear(buf: Uint8Array, id: number, start: number, end: number): boolean {
  const limit = Math.min(end, buf.length - 4);
  for (let i = start; i <= limit; i += 1) {
    if (buf[i] === 0x00 && buf[i + 1] === 0x00 && buf[i + 2] === 0x01 && buf[i + 3] === id) {
      return true;
    }
  }
  return false;
}

/** MPEG audio lives in elementary stream ids 0xC0–0xDF. */
function hasMpegAudioStream(buf: Uint8Array): boolean {
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === 0x00 && buf[i + 1] === 0x00 && buf[i + 2] === 0x01) {
      const id = buf[i + 3]!;
      if (id >= 0xc0 && id <= 0xdf) return true;
    }
  }
  return false;
}

function isPrintableFourcc(value: string): boolean {
  if (value.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
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

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] ?? 0) |
    ((buf[offset + 1] ?? 0) << 8) |
    ((buf[offset + 2] ?? 0) << 16) |
    ((buf[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function readU16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] ?? 0) | ((buf[offset + 1] ?? 0) << 8);
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] ?? 0) << 8) | (buf[offset + 1] ?? 0);
}
