/**
 * LocalFileManager — owns everything about the user's selected file.
 *
 * Privacy contract (see plan §7): bytes are read locally through the File API.
 * Nothing here performs a network request, persists the file, or logs file
 * contents. Only the file name, size and type are ever used in messages.
 */

import type { MediaProbeResult } from "../types/media";
import { PlaybackCapabilityDetector } from "../playback/PlaybackCapabilities";
import { PlaybackError, unsupportedFileError } from "../playback/PlaybackErrors";
import { extensionOf } from "./MediaProbe";

/** Extensions LiveX will attempt, mapped to a friendly label. */
const SUPPORTED_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "avi",
  "ogv",
  "ogg",
  "mpg",
  "mpeg",
  "ts",
  "m2ts",
  "mts",
]);

export interface ValidatedFile {
  file: File;
  probe: MediaProbeResult;
}

export class LocalFileManager {
  private readonly detector: PlaybackCapabilityDetector;
  private current: File | null = null;

  constructor(detector?: PlaybackCapabilityDetector) {
    this.detector = detector ?? new PlaybackCapabilityDetector();
  }

  /**
   * Cheap check before any decoding is attempted: is this plausibly a video?
   * Throws a normalized PlaybackError when it is not.
   */
  assertLooksLikeVideo(file: File): void {
    const extension = extensionOf(file.name);
    const mimeLooksVideo = file.type.startsWith("video/");
    const extensionKnown = SUPPORTED_EXTENSIONS.has(extension);

    if (!mimeLooksVideo && !extensionKnown) {
      throw unsupportedFileError(file.name);
    }
  }

  /**
   * Probe the file locally and return the capability verdict.
   * Does not load it into the player.
   */
  async inspect(file: File): Promise<ValidatedFile> {
    this.assertLooksLikeVideo(file);
    const probe = await this.detector.probe(file);
    return { file, probe };
  }

  /** Turn a failed probe into a user-facing error. */
  toPlaybackError(probe: MediaProbeResult): PlaybackError {
    const codecParts: string[] = [];
    if (probe.videoCodec) codecParts.push(`${probe.videoCodec} video`);
    if (probe.audioCodec) codecParts.push(`${probe.audioCodec} audio`);

    return new PlaybackError({
      code: probe.codecUnknown ? "unsupported-format" : "unsupported-codec",
      message: "This video cannot be played in this browser.",
      hint: [
        probe.reason ? capitalize(probe.reason) : null,
        codecParts.length > 0 ? `Detected ${codecParts.join(" + ")}.` : null,
        "Convert it to MP4 (H.264 + AAC) or WebM (VP9 + Opus) for guaranteed playback.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  getCurrentFile(): File | null {
    return this.current;
  }

  setCurrentFile(file: File | null): void {
    this.current = file;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
