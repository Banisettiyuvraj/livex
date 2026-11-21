/**
 * Playback capability detection.
 *
 * Two responsibilities:
 *  1. Ask the browser what it can play (`HTMLVideoElement.canPlayType`).
 *  2. Turn that into a LiveX verdict per file, using the probed container and
 *     codecs, plus the browser's own `MediaCapabilities` limits where useful.
 *
 * Detection is advisory: the final truth is whether the media element can
 * actually decode and render the file. That is why `supported: true` never
 * bypasses the adapter's real error handling.
 */

import type { MediaContainer, MediaProbeResult } from "../types/media";
import { extensionOf, probeLocalFile } from "../files/MediaProbe";

/** Well-known MIME types tried for each container. */
const CONTAINER_MIME_CANDIDATES: Record<MediaContainer, string[]> = {
  mp4: ['video/mp4; codecs="avc1.42E01E,mp4a.40.2"', "video/mp4", "video/quicktime"],
  webm: ['video/webm; codecs="vp9,opus"', 'video/webm; codecs="vp8,vorbis"', "video/webm"],
  matroska: ["video/x-matroska", 'video/x-matroska; codecs="avc1.42E01E"', "video/webm"],
  avi: ["video/x-msvideo", "video/avi", "video/msvideo"],
  "mpeg-ts": ["video/mp2t"],
  "mpeg-ps": ["video/mpeg", "video/mpg"],
  ogg: ["video/ogg", 'video/ogg; codecs="theora"'],
  flv: ["video/x-flv"],
  unknown: [],
};

/**
 * Codecs that browsers essentially never decode natively in a browser video
 * element today. Used only to explain a failure more precisely.
 */
const KNOWN_UNSUPPORTED_VIDEO = new Set([
  "VfW codec",
  "MPEG-4 Part 2",
  "Xvid",
  "DivX",
  "Motion JPEG",
  "MPEG-2",
]);

export class PlaybackCapabilityDetector {
  private readonly videoElement: HTMLVideoElement;
  /**
   * `canPlayType` answers do not change during a page session, and the same
   * MIME strings are asked repeatedly (per-file probe + the support matrix),
   * so memoise them in memory. Nothing is persisted: a browser update or a
   * restart should be free to give a different answer.
   */
  private readonly canPlayCache = new Map<string, string>();

  constructor(videoElement?: HTMLVideoElement) {
    this.videoElement = videoElement ?? document.createElement("video");
  }

  /** Raw `canPlayType` for a MIME string: "probably" | "maybe" | "". */
  canPlayType(mime: string): string {
    const cached = this.canPlayCache.get(mime);
    if (cached !== undefined) return cached;
    const result = this.videoElement.canPlayType(mime);
    this.canPlayCache.set(mime, result);
    return result;
  }

  /**
   * Full pre-flight check for a local file. Reads only the file's header bytes.
   */
  async probe(file: File): Promise<MediaProbeResult> {
    const containerProbe = await probeLocalFile(file);
    const extension = extensionOf(file.name);
    const mimeType = file.type || "";

    const mimeCandidates = CONTAINER_MIME_CANDIDATES[containerProbe.container];
    const codecQualified = mimeCandidates[0] ?? "";
    const plain = this.pickPlainMime(containerProbe.container, mimeType);

    const canPlayType = {
      mime: plain ? this.canPlayType(plain) : "",
      withCodecs: codecQualified ? this.canPlayType(codecQualified) : "",
      extensionOnly: plain ? this.canPlayType(plain) : "",
    };

    const base: Omit<MediaProbeResult, "supported" | "codecUnknown"> = {
      fileName: file.name,
      extension,
      mimeType,
      container: containerProbe.container,
      videoCodec: containerProbe.videoCodec,
      audioCodec: containerProbe.audioCodec,
      canPlayType,
    };

    // A container we cannot even identify is not a video file we can play.
    if (containerProbe.container === "unknown") {
      return {
        ...base,
        supported: false,
        codecUnknown: true,
        reason: "the file container could not be identified",
      };
    }

    // Hard block: containers no browser can demux natively.
    if (containerProbe.container === "flv") {
      return {
        ...base,
        supported: false,
        codecUnknown: false,
        reason: "Flash Video (FLV) is not supported by browser video elements",
      };
    }

    // Native support signal from the browser.
    const nativeSignal = canPlayType.withCodecs || canPlayType.mime;

    // Codec-level explanation for containers browsers often refuse.
    if (containerProbe.container === "matroska" || containerProbe.container === "avi") {
      const verdict = this.explainNonNativeContainer(containerProbe.container, containerProbe.videoCodec);
      if (verdict) {
        return { ...base, supported: false, codecUnknown: containerProbe.videoCodec === null, reason: verdict };
      }
    }

    // MPEG-TS/PS have no native demuxer in Chromium. Now that the probe names
    // the codec, say which one was found instead of the old generic message.
    // If a browser does claim support, let real playback be the judge.
    if (
      (containerProbe.container === "mpeg-ts" || containerProbe.container === "mpeg-ps") &&
      nativeSignal === ""
    ) {
      const label = containerProbe.container === "mpeg-ts" ? "MPEG-TS" : "MPEG-PS";
      const reason = containerProbe.videoCodec
        ? `${label} with ${containerProbe.videoCodec} video cannot be demuxed by browser video elements`
        : `${label} playback is not supported by browser video elements`;
      return { ...base, supported: false, codecUnknown: containerProbe.videoCodec === null, reason };
    }

    if (containerProbe.videoCodec && KNOWN_UNSUPPORTED_VIDEO.has(containerProbe.videoCodec)) {
      return {
        ...base,
        supported: false,
        codecUnknown: false,
        reason: `${containerProbe.videoCodec} video is not decodable by browser video elements`,
      };
    }

    // `canPlayType` returning "" means "definitely not"; "maybe" is common for
    // MKV/AVI even when the codec will fail, so we do not trust it alone and
    // let real playback decide (the adapter reports a precise error).
    const supported = nativeSignal !== "";

    return {
      ...base,
      supported,
      codecUnknown: containerProbe.videoCodec === null,
      ...(supported ? {} : { reason: "the browser reported no support for this container/codec combination" }),
    };
  }

  /** Copy-ready summary of what this browser reports as playable. */
  describeSupport(): Array<{ label: string; result: string }> {
    const matrix: Array<{ label: string; mime: string }> = [
      { label: "MP4 · H.264 + AAC", mime: 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"' },
      { label: "MP4 · HEVC", mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
      { label: "MP4 · AV1", mime: 'video/mp4; codecs="av01.0.05M.08"' },
      { label: "WebM · VP8 + Vorbis", mime: 'video/webm; codecs="vp8,vorbis"' },
      { label: "WebM · VP9 + Opus", mime: 'video/webm; codecs="vp9,opus"' },
      { label: "WebM · AV1 + Opus", mime: 'video/webm; codecs="av01.0.05M.08,opus"' },
      { label: "MKV · H.264", mime: 'video/x-matroska; codecs="avc1.42E01E"' },
      { label: "MOV · H.264", mime: "video/quicktime" },
      { label: "AVI", mime: "video/x-msvideo" },
      { label: "MPEG-TS", mime: "video/mp2t" },
      { label: "MPEG-PS", mime: "video/mpeg" },
    ];
    return matrix.map(({ label, mime }) => ({
      label,
      result: this.canPlayType(mime) || "not supported",
    }));
  }

  private pickPlainMime(container: MediaContainer, fileMime: string): string {
    if (fileMime && container === "mp4" && fileMime === "video/quicktime") return fileMime;
    const candidates = CONTAINER_MIME_CANDIDATES[container];
    const plain = candidates.find((mime) => !mime.includes("codecs="));
    return plain ?? "";
  }

  private explainNonNativeContainer(
    container: MediaContainer,
    videoCodec: string | null,
  ): string | null {
    // Some browsers (notably recent Safari and some Chromium builds) report
    // "maybe" for Matroska H.264. Treat H.264-in-MKV as worth trying so the
    // browser itself decides, and explain the rest.
    const containerLabel = container === "matroska" ? "Matroska (.mkv)" : "AVI";

    if (container === "matroska" && (videoCodec === "H.264" || videoCodec === null)) {
      return null;
    }
    if (videoCodec === null) {
      return `${containerLabel} playback depends on the codecs inside the file, which could not be read from the first 64 KB`;
    }
    return `${containerLabel} with ${videoCodec} video cannot be demuxed by browser video elements`;
  }
}
