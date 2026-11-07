/** Session-layer types kept separate from playback types. */

import type { MediaMetadata, SessionState } from "../types/media";

export interface SessionProgress {
  currentTime: number;
  duration: number;
  /** Fraction 0..1, safe when duration is unknown (returns 0). */
  fraction: number;
  /** Furthest legitimately reached position — the anti-skip ceiling. */
  furthestTime: number;
}

export interface SessionSnapshot {
  state: SessionState;
  metadata: MediaMetadata | null;
  progress: SessionProgress;
  playbackRate: number;
  integrity: SessionIntegrity;
}

/**
 * Honest self-reporting that replaces a hard anti-skip wall (roadmap 2.1).
 *
 * Anti-skip is a focus aid, never DRM — client-side limits are always
 * bypassable. Instead of pretending otherwise, we count attempts and show the
 * user what actually happened.
 */
export interface SessionIntegrity {
  /** Times the user tried to jump past the ceiling. */
  skipAttempts: number;
  /** Total seconds of playback that never ran forwards past the ceiling. */
  watchedSeconds: number;
  /** Longest unbroken stretch of real playback, in seconds. */
  longestStretchSeconds: number;
}

export type SessionChangeReason =
  | "init"
  | "file-loaded"
  | "started"
  | "paused"
  | "resumed"
  | "resumed-at"
  | "ended"
  | "advanced"
  | "error"
  | "reset";

export interface SessionChangeEvent {
  state: SessionState;
  previous: SessionState;
  reason: SessionChangeReason;
  snapshot: SessionSnapshot;
}

/** Allowed transitions. Keeps invalid moves out of the UI. */
export const SESSION_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  // `error` is reachable from `idle` because a file can fail validation
  // before any session exists.
  idle: ["ready", "error"],
  ready: ["live", "idle", "error"],
  live: ["paused", "completed", "error", "idle"],
  paused: ["live", "error", "idle"],
  // Playlist advancement goes completed → ready without a trip through idle.
  completed: ["idle", "ready"],
  error: ["idle", "ready"],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  if (from === to) return true;
  return SESSION_TRANSITIONS[from].includes(to);
}
