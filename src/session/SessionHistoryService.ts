/**
 * Session history — "continue where you left off".
 *
 * Records metadata about past sessions (never the video itself) so the workspace
 * can offer to resume a file the user opened before. See the privacy boundary in
 * `LocalMetadataStore`.
 *
 * Write strategy: history is flushed on meaningful events only (session state
 * changes and a coarse timeupdate tick), not on every frame, so IndexedDB is not
 * hammered during playback.
 */

import type { MediaMetadata } from "../types/media";
import {
  LocalMetadataStore,
  mediaFingerprint,
  type HistoryEntry,
} from "../files/LocalMetadataStore";

/** Persist the watch position at most this often during playback. */
const FLUSH_INTERVAL_MS = 5000;

export interface SessionHistory {
  store: LocalMetadataStore;
  getEntry(): HistoryEntry | null;
  trackOpen(metadata: MediaMetadata): Promise<HistoryEntry | null>;
  recordProgress(currentTime: number, furthestTime: number, force?: boolean): void;
  recordCompletion(duration: number): void;
  listRecent(limit?: number): Promise<HistoryEntry[]>;
}

export class SessionHistoryService implements SessionHistory {
  readonly store: LocalMetadataStore;

  private entry: HistoryEntry | null = null;
  private lastFlushAt = 0;
  private pendingTime = 0;
  private pendingFurthest = 0;
  private sessionStartWallClock = 0;

  constructor(store?: LocalMetadataStore) {
    this.store = store ?? new LocalMetadataStore();
  }

  getEntry(): HistoryEntry | null {
    return this.entry;
  }

  /**
   * Called when a file is loaded into the player. Returns the stored record so
   * the caller can offer to resume a half-watched file (roadmap 2.6).
   */
  async trackOpen(metadata: MediaMetadata): Promise<HistoryEntry | null> {
    const key = mediaFingerprint(metadata.fileName, metadata.fileSize, metadata.duration);
    const existing = await this.store.getHistory(key);
    const now = Date.now();

    this.entry = existing
      ? {
          ...existing,
          duration: Number.isFinite(metadata.duration) ? metadata.duration : existing.duration,
          lastOpenedAt: now,
        }
      : {
          key,
          fileName: metadata.fileName,
          fileSize: metadata.fileSize,
          duration: Number.isFinite(metadata.duration) ? metadata.duration : 0,
          furthestTime: 0,
          lastTime: 0,
          completed: false,
          firstOpenedAt: now,
          lastOpenedAt: now,
          watchedSeconds: 0,
        };

    this.sessionStartWallClock = now;
    await this.store.putHistory(this.entry);
    return this.entry;
  }

  /** Throttled position flush. `force` bypasses the throttle (pause/complete). */
  recordProgress(currentTime: number, furthestTime: number, force = false): void {
    if (!this.entry) return;

    this.pendingTime = currentTime;
    this.pendingFurthest = Math.max(this.pendingFurthest, furthestTime);

    const now = Date.now();
    if (!force && now - this.lastFlushAt < FLUSH_INTERVAL_MS) return;
    this.lastFlushAt = now;

    void this.flush();
  }

  recordCompletion(duration: number): void {
    if (!this.entry) return;
    this.entry.completed = true;
    this.entry.furthestTime = Math.max(this.entry.furthestTime, duration);
    this.entry.lastTime = duration;
    this.pendingTime = duration;
    this.pendingFurthest = Math.max(this.pendingFurthest, duration);
    void this.flush();
  }

  async listRecent(limit = 5): Promise<HistoryEntry[]> {
    return this.store.listRecent(limit);
  }

  private async flush(): Promise<void> {
    if (!this.entry) return;

    const elapsedSeconds = Math.max(
      0,
      Math.round((Date.now() - this.sessionStartWallClock) / 1000),
    );

    this.entry.lastTime = this.pendingTime;
    this.entry.furthestTime = Math.max(this.entry.furthestTime, this.pendingFurthest);
    this.entry.watchedSeconds += Math.min(elapsedSeconds, 3600);
    this.sessionStartWallClock = Date.now();

    await this.store.putHistory({ ...this.entry });
  }
}
