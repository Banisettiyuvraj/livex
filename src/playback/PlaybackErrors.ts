/**
 * Normalized, user-facing playback errors.
 *
 * Every adapter converts engine-specific failures into these so the session
 * layer and the UI never need to know about MediaError, FFmpeg exit codes, etc.
 */

import type {
  PlaybackErrorCode,
  PlaybackErrorDetails,
  MediaProbeResult,
} from "../types/media";

export class PlaybackError extends Error implements PlaybackErrorDetails {
  readonly code: PlaybackErrorCode;
  readonly hint?: string;
  readonly cause?: unknown;

  constructor(details: PlaybackErrorDetails) {
    super(details.message);
    this.name = "PlaybackError";
    this.code = details.code;
    if (details.hint !== undefined) this.hint = details.hint;
    this.cause = details.cause;
  }

  toDetails(): PlaybackErrorDetails {
    const details: PlaybackErrorDetails = {
      code: this.code,
      message: this.message,
      cause: this.cause,
    };
    if (this.hint) details.hint = this.hint;
    return details;
  }
}

/** Map a numeric HTMLMediaElement error code to a normalized PlaybackError. */
export function fromMediaError(
  mediaError: MediaError | null | undefined,
  probe?: MediaProbeResult,
): PlaybackError {
  const code = mediaError?.code;
  const codecLabel = describeCodecs(probe);

  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return new PlaybackError({
        code: "aborted",
        message: "Video playback was aborted.",
        hint: "Try loading the file again.",
        cause: mediaError,
      });
    case MediaError.MEDIA_ERR_NETWORK:
      return new PlaybackError({
        code: "network-failed",
        message: "The browser could not read the video file.",
        hint: "The file may have moved or become unreadable. Select it again.",
        cause: mediaError,
      });
    case MediaError.MEDIA_ERR_DECODE:
      return new PlaybackError({
        code: "decode-failed",
        message: "This video could not be decoded by your browser.",
        hint: codecLabel
          ? `Detected ${codecLabel}. Your browser cannot decode it natively.`
          : "The file may be damaged, or it uses a codec your browser does not support.",
        cause: mediaError,
      });
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return new PlaybackError({
        code: "unsupported-format",
        message: "This video format is not supported by your browser.",
        hint: codecLabel
          ? `Detected ${codecLabel}.`
          : "Container or codec may be unsupported in this browser.",
        cause: mediaError,
      });
    default:
      return new PlaybackError({
        code: "unknown",
        message: "An error occurred while playing the video.",
        cause: mediaError,
      });
  }
}

export function unsupportedFileError(fileName: string): PlaybackError {
  return new PlaybackError({
    code: "unsupported-format",
    message: "That file does not look like a video.",
    hint: `“${fileName}” could not be identified as a video container. Choose an MP4, WebM, MOV, MKV, AVI or MPEG file.`,
  });
}

export function noFileError(): PlaybackError {
  return new PlaybackError({
    code: "no-file",
    message: "No video has been selected yet.",
    hint: "Drop a video onto the workspace or use Open Video.",
  });
}

function describeCodecs(probe?: MediaProbeResult): string | null {
  if (!probe) return null;
  const parts: string[] = [];
  if (probe.container !== "unknown") parts.push(`container: ${probe.container}`);
  if (probe.videoCodec) parts.push(`video: ${probe.videoCodec}`);
  if (probe.audioCodec) parts.push(`audio: ${probe.audioCodec}`);
  return parts.length > 0 ? parts.join(", ") : null;
}
