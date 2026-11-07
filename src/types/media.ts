/**
 * Core media + session types for LiveX.
 *
 * These types are the contract between the UI, the session layer and the
 * playback adapters. Nothing in here knows about HTMLVideoElement specifics or
 * about any optional WebAssembly engine — see `src/playback/` for that.
 */

/** Session lifecycle states required by the product spec (task.md §Phase 3). */
export type SessionState =
  | "idle"
  | "ready"
  | "live"
  | "paused"
  | "completed"
  | "error";

/** Which playback implementation is currently driving the session. */
export type PlaybackEngineId = "native" | "wasm";

/** High-level playback status reported by an adapter. */
export type PlaybackStatus =
  | "empty"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

/** Metadata known about the currently selected local file. */
export interface MediaMetadata {
  fileName: string;
  /** Byte size as reported by the File object. */
  fileSize: number;
  /** MIME type reported by the browser (may be empty for dragged MKVs). */
  mimeType: string;
  /** Lower-cased container extension without the dot, e.g. "mkv". */
  extension: string;
  /** Duration in seconds, or NaN while unknown. */
  duration: number;
  videoWidth: number;
  videoHeight: number;
}

/** Result of the pre-flight capability check for one file. */
export interface MediaProbeResult {
  fileName: string;
  extension: string;
  mimeType: string;
  /** Container identified from the file's magic bytes (signature). */
  container: MediaContainer;
  /** Video/audio codec ids extracted from the container, when readable. */
  videoCodec: string | null;
  audioCodec: string | null;
  /** `canPlayType()` values gathered for this file's MIME/extension. */
  canPlayType: { mime: string; withCodecs: string; extensionOnly: string };
  /** Final verdict. */
  supported: boolean;
  /** Human-readable reason when `supported` is false. */
  reason?: string;
  /** True when the codec could not be determined from the container. */
  codecUnknown: boolean;
}

export type MediaContainer =
  | "mp4"
  | "webm"
  | "matroska"
  | "avi"
  | "mpeg-ts"
  | "mpeg-ps"
  | "ogg"
  | "flv"
  | "unknown";

export interface VideoTrackInfo {
  width: number;
  height: number;
}

/** Normalized playback errors (see src/playback/PlaybackErrors.ts). */
export type PlaybackErrorCode =
  | "unsupported-format"
  | "unsupported-codec"
  | "decode-failed"
  | "network-failed"
  | "aborted"
  | "no-file"
  | "invalid-state"
  | "fullscreen-failed"
  | "unknown";

export interface PlaybackErrorDetails {
  code: PlaybackErrorCode;
  /** Short user-facing message (safe to render, contains no file contents). */
  message: string;
  /** Optional extra technical hint, shown small under the message. */
  hint?: string;
  /** Underlying reason for debugging; never contains file bytes. */
  cause?: unknown;
}

/** Normalized playback events emitted by a PlaybackAdapter. */
export interface PlaybackEventMap {
  /** The adapter now owns a decodable source. */
  loaded: { duration: number; metadata: MediaMetadata };
  /** Playback was requested and started. */
  play: { time: number };
  pause: { time: number };
  timeupdate: { time: number; duration: number };
  seek: { from: number; to: number };
  ratechange: { rate: number };
  ended: { time: number };
  volumechange: { volume: number; muted: boolean };
  error: PlaybackErrorDetails;
  /** Adapter resources were released. */
  disposed: Record<string, never>;
}

export type PlaybackEventName = keyof PlaybackEventMap;
