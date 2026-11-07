/**
 * AnalyticsService — local-only watching statistics (roadmap 2.2).
 *
 * Everything here is derived on demand from the IndexedDB history store. There
 * is no telemetry, no network call and no aggregation into anything that leaves
 * the device. If the store is unavailable, every figure reports as zero rather
 * than throwing.
 */

import type { HistoryEntry } from "../files/LocalMetadataStore";
import type { LocalMetadataStore } from "../files/LocalMetadataStore";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AnalyticsSummary {
  /** Distinct files ever opened. */
  fileCount: number;
  /** Files the user reached the end of at least once. */
  completedCount: number;
  /** Completion rate 0..1 across all files. */
  completionRate: number;
  /** Total seconds watched across all files and sessions. */
  totalWatchedSeconds: number;
  /** Total media duration across all files, in seconds. */
  totalDurationSeconds: number;
  /** Seconds watched in the last 7 days, estimated from `lastOpenedAt`. */
  awaySecondsLast7Days: number;
  /** Mean fraction of each file watched (0..1). */
  averageCoverage: number;
  /** The most nearly-finished file that is not completed, if any. */
  almostDone: HistoryEntry | null;
}

export const EMPTY_ANALYTICS: AnalyticsSummary = {
  fileCount: 0,
  completedCount: 0,
  completionRate: 0,
  totalWatchedSeconds: 0,
  totalDurationSeconds: 0,
  awaySecondsLast7Days: 0,
  averageCoverage: 0,
  almostDone: null,
};

/** Pure aggregation, exported so it can be unit-tested without IndexedDB. */
export function summarise(entries: HistoryEntry[], now = Date.now()): AnalyticsSummary {
  if (entries.length === 0) return { ...EMPTY_ANALYTICS };

  let completedCount = 0;
  let totalWatchedSeconds = 0;
  let totalDurationSeconds = 0;
  let coverageSum = 0;
  let recentWatched = 0;
  let almostDone: HistoryEntry | null = null;

  for (const entry of entries) {
    if (entry.completed) completedCount += 1;

    totalWatchedSeconds += entry.watchedSeconds;
    totalDurationSeconds += entry.duration;

    const coverage =
      entry.duration > 0 ? Math.min(1, entry.furthestTime / entry.duration) : 0;
    coverageSum += coverage;

    if (now - entry.lastOpenedAt <= 7 * DAY_MS) {
      recentWatched += entry.watchedSeconds;
    }

    if (!entry.completed && coverage >= 0.5 && coverage < 1) {
      if (!almostDone || coverage > (almostDone.duration > 0 ? almostDone.furthestTime / almostDone.duration : 0)) {
        almostDone = entry;
      }
    }
  }

  return {
    fileCount: entries.length,
    completedCount,
    completionRate: completedCount / entries.length,
    totalWatchedSeconds,
    totalDurationSeconds,
    awaySecondsLast7Days: recentWatched,
    averageCoverage: coverageSum / entries.length,
    almostDone,
  };
}

export class AnalyticsService {
  private readonly store: LocalMetadataStore;

  constructor(store: LocalMetadataStore) {
    this.store = store;
  }

  async getSummary(): Promise<AnalyticsSummary> {
    if (!this.store.isAvailable()) return { ...EMPTY_ANALYTICS };
    try {
      // A large limit keeps this a single read; typical libraries are small.
      const entries = await this.store.listRecent(500);
      return summarise(entries);
    } catch {
      return { ...EMPTY_ANALYTICS };
    }
  }
}
