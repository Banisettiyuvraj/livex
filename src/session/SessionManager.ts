/**
 * SessionManager — the simulated live-session brain.
 *
 * Owns:
 *  - the session state machine (idle/ready/live/paused/completed/error)
 *  - anti-skip enforcement (forward seek ceiling)
 *  - the 1× playback-rate lock
 *  - completion detection from the *engine's* `ended` event
 *  - progress snapshots the UI can render
 *
 * It depends only on `PlaybackAdapter`, so it works identically for the native
 * element and for any future WebAssembly engine.
 *
 * Note: anti-skip is a personal productivity control, not DRM. Client-side
 * restrictions can always be bypassed with developer tools.
 */

import type {
  MediaMetadata,
  PlaybackErrorDetails,
  SessionState,
} from "../types/media";
import type { PlaybackAdapter } from "../playback/PlaybackAdapter";
import type {
  SessionChangeEvent,
  SessionChangeReason,
  SessionProgress,
  SessionSnapshot,
} from "./SessionState";
import { canTransition } from "./SessionState";

/** Forward-seek tolerance in seconds (absorbs timeupdate jitter). */
const SEEK_TOLERANCE = 0.35;
/** How far past the ceiling a seek must go before we treat it as an attack. */
const SEEK_BLOCK_THRESHOLD = 0.5;

export type SessionListener = (event: SessionChangeEvent) => void;
export type ProgressListener = (progress: SessionProgress) => void;
export type ErrorListener = (details: PlaybackErrorDetails) => void;

export class SessionManager {
  private readonly adapter: PlaybackAdapter;

  private state: SessionState = "idle";
  private metadata: MediaMetadata | null = null;
  private furthestTime = 0;
  private currentTime = 0;
  private duration = 0;
  private playbackRate = 1;

  private guardSeek = false;
  private engineEnded = false;
  private pendingPauseTransition: number | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  private readonly sessionListeners = new Set<SessionListener>();
  private readonly progressListeners = new Set<ProgressListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  constructor(adapter: PlaybackAdapter) {
    this.adapter = adapter;
    this.subscribeToAdapter();
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                       */
  /* ---------------------------------------------------------------- */

  getState(): SessionState {
    return this.state;
  }

  getSnapshot(): SessionSnapshot {
    return {
      state: this.state,
      metadata: this.metadata,
      progress: this.getProgress(),
      playbackRate: this.playbackRate,
    };
  }

  getProgress(): SessionProgress {
    const duration = this.duration || 0;
    return {
      currentTime: this.currentTime,
      duration,
      fraction: duration > 0 ? Math.min(1, this.currentTime / duration) : 0,
      furthestTime: this.furthestTime,
    };
  }

  /** Register a new local file and move idle/error/completed → ready. */
  async loadFile(file: File): Promise<MediaMetadata> {
    this.resetTracking();
    this.metadata = await this.adapter.load(file);

    this.duration = this.adapter.getDuration() || this.metadata.duration || 0;
    this.currentTime = 0;
    this.furthestTime = 0;
    this.playbackRate = 1;
    this.adapter.setPlaybackRate(1);

    this.transition("ready", "file-loaded");
    return this.metadata;
  }

  /** Start (or restart) the session from 0:00 at 1×. */
  async start(): Promise<void> {
    if (this.state !== "ready" && this.state !== "completed") {
      throw new Error(`Cannot start a session from state "${this.state}"`);
    }

    this.furthestTime = 0;
    this.currentTime = 0;
    this.playbackRate = 1;
    this.engineEnded = false;
    this.adapter.setPlaybackRate(1);
    this.adapter.seek(0);

    await this.adapter.play();
    this.transition("live", "started");
  }

  pause(): void {
    if (this.state !== "live") return;
    this.adapter.pause();
    this.transition("paused", "paused");
  }

  async resume(): Promise<void> {
    if (this.state !== "paused") return;
    await this.adapter.play();
    this.transition("live", "resumed");
  }

  /** Rewind is allowed by design; forward jumping past the ceiling is not. */
  seekTo(timeSeconds: number): void {
    const clampedTarget = Math.max(0, Math.min(timeSeconds, this.furthestTime));
    this.adapter.seek(clampedTarget);
    this.currentTime = clampedTarget;
    this.emitProgress();
  }

  /** Reset to idle and release the loaded file. */
  reset(reason: SessionChangeReason = "reset"): void {
    this.resetTracking();
    this.metadata = null;
    if (this.state !== "idle") this.transition("idle", reason);
    else this.emitProgress();
  }

  onSessionChange(listener: SessionListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  dispose(): void {
    for (const off of this.unsubscribers.splice(0)) off();
    this.sessionListeners.clear();
    this.progressListeners.clear();
    this.errorListeners.clear();
    this.adapter.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* Adapter wiring                                                   */
  /* ---------------------------------------------------------------- */

  private subscribeToAdapter(): void {
    const { adapter } = this;

    this.unsubscribers.push(
      adapter.on("timeupdate", (payload) => {
        this.currentTime = payload.time;
        if (payload.duration > 0) this.duration = payload.duration;
        this.trackFurthest();
        this.emitProgress();
      }),

      adapter.on("play", () => {
        if (this.state === "paused") this.transition("live", "resumed");
        else if (this.state === "ready") this.transition("live", "started");
      }),

      // The element fires `pause` immediately before `ended`. Treating that as
      // a user pause would drop the session into `paused` and lose the
      // completion transition, so defer briefly and re-check.
      adapter.on("pause", () => {
        if (this.state !== "live") return;
        this.pendingPauseTransition = window.setTimeout(() => {
          this.pendingPauseTransition = null;
          if (this.state === "live" && !this.engineEnded) {
            this.transition("paused", "paused");
          }
        }, 0);
      }),

      adapter.on("seek", () => {
        this.enforceAntiSkip();
      }),

      adapter.on("ratechange", (payload) => {
        // Hard 1× lock during an active session.
        if (payload.rate !== 1 && (this.state === "live" || this.state === "paused")) {
          adapter.setPlaybackRate(1);
          this.playbackRate = 1;
          return;
        }
        this.playbackRate = adapter.getPlaybackRate();
      }),

      adapter.on("ended", () => {
        this.engineEnded = true;
        if (this.pendingPauseTransition !== null) {
          window.clearTimeout(this.pendingPauseTransition);
          this.pendingPauseTransition = null;
        }
        // Completion is only valid from an active (live/paused) session, i.e.
        // the engine reported a real end-of-playback.
        if (this.state === "live" || this.state === "paused") {
          this.currentTime = this.duration || adapter.getCurrentTime();
          this.furthestTime = Math.max(this.furthestTime, this.currentTime);
          this.emitProgress();
          this.transition("completed", "ended");
        }
      }),

      adapter.on("error", (details) => {
        this.fail(details);
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Anti-skip                                                        */
  /* ---------------------------------------------------------------- */

  private trackFurthest(): void {
    if (this.state !== "live") return;
    if (this.currentTime > this.furthestTime) {
      this.furthestTime = this.currentTime;
    }
  }

  /**
   * If the engine is now positioned beyond the furthest legitimately watched
   * point, put it back. Runs on every seek so mouse, keyboard and programmatic
   * jumps are all covered.
   */
  private enforceAntiSkip(): void {
    if (this.guardSeek) return;
    if (this.state !== "live" && this.state !== "paused") return;

    const requested = this.adapter.getCurrentTime();
    const ceiling = this.furthestTime + SEEK_TOLERANCE;

    if (requested > ceiling + SEEK_BLOCK_THRESHOLD) {
      this.guardSeek = true;
      const clamped = Math.max(0, this.furthestTime);
      this.adapter.seek(clamped);
      this.currentTime = clamped;
      this.emitProgress();
      // Release the guard on the next macrotask so the echo seek settles first.
      window.setTimeout(() => {
        this.guardSeek = false;
      }, 0);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                        */
  /* ---------------------------------------------------------------- */

  private fail(details: PlaybackErrorDetails): void {
    if (this.state === "error") return;
    this.transition("error", "error");
    for (const listener of [...this.errorListeners]) listener(details);
  }

  private transition(next: SessionState, reason: SessionChangeReason): void {
    const previous = this.state;
    if (previous === next) {
      this.emitProgress();
      return;
    }
    if (!canTransition(previous, next)) {
      console.warn(`[session] illegal transition ${previous} → ${next}, ignored`);
      return;
    }

    this.state = next;
    const event: SessionChangeEvent = {
      state: next,
      previous,
      reason,
      snapshot: this.getSnapshot(),
    };

    for (const listener of [...this.sessionListeners]) listener(event);
    this.emitProgress();
  }

  private emitProgress(): void {
    const progress = this.getProgress();
    for (const listener of [...this.progressListeners]) listener(progress);
  }

  private resetTracking(): void {
    this.furthestTime = 0;
    this.currentTime = 0;
    this.duration = 0;
    this.playbackRate = 1;
    this.guardSeek = false;
    this.engineEnded = false;
    if (this.pendingPauseTransition !== null) {
      window.clearTimeout(this.pendingPauseTransition);
      this.pendingPauseTransition = null;
    }
  }
}