import { describe, expect, it } from "vitest";
import { EMPTY_ANALYTICS, summarise } from "../../src/session/AnalyticsService";
import type { HistoryEntry } from "../../src/files/LocalMetadataStore";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function entry(overrides: Partial<HistoryEntry> & { key: string }): HistoryEntry {
  return {
    fileName: `${overrides.key}.mp4`,
    fileSize: 1000,
    duration: 100,
    furthestTime: 0,
    lastTime: 0,
    completed: false,
    firstOpenedAt: NOW - DAY,
    lastOpenedAt: NOW - DAY,
    watchedSeconds: 0,
    ...overrides,
  };
}

describe("summarise", () => {
  it("returns zeroed figures for no history", () => {
    expect(summarise([], NOW)).toEqual(EMPTY_ANALYTICS);
  });

  it("counts files and completions", () => {
    const summary = summarise(
      [
        entry({ key: "a", completed: true, furthestTime: 100 }),
        entry({ key: "b", furthestTime: 50 }),
        entry({ key: "c", furthestTime: 80 }),
      ],
      NOW,
    );
    expect(summary.fileCount).toBe(3);
    expect(summary.completedCount).toBe(1);
    expect(summary.completionRate).toBeCloseTo(1 / 3, 5);
  });

  it("sums watch time and duration", () => {
    const summary = summarise(
      [entry({ key: "a", watchedSeconds: 100 }), entry({ key: "b", watchedSeconds: 50 })],
      NOW,
    );
    expect(summary.totalWatchedSeconds).toBe(150);
    expect(summary.totalDurationSeconds).toBe(200);
  });

  it("only counts the last seven days for the recent figure", () => {
    const summary = summarise(
      [
        entry({ key: "recent", watchedSeconds: 60, lastOpenedAt: NOW - DAY }),
        entry({ key: "old", watchedSeconds: 500, lastOpenedAt: NOW - 30 * DAY }),
      ],
      NOW,
    );
    expect(summary.awaySecondsLast7Days).toBe(60);
  });

  it("averages coverage across files", () => {
    const summary = summarise(
      [
        entry({ key: "a", duration: 100, furthestTime: 100 }),
        entry({ key: "b", duration: 100, furthestTime: 0 }),
      ],
      NOW,
    );
    expect(summary.averageCoverage).toBeCloseTo(0.5, 5);
  });

  it("clamps coverage so furthestTime beyond duration cannot exceed 1", () => {
    const summary = summarise([entry({ key: "a", duration: 100, furthestTime: 250 })], NOW);
    expect(summary.averageCoverage).toBe(1);
  });

  it("treats a zero-duration file as zero coverage", () => {
    const summary = summarise([entry({ key: "a", duration: 0, furthestTime: 10 })], NOW);
    expect(summary.averageCoverage).toBe(0);
  });

  it("picks the furthest half-watched file as almostDone", () => {
    const summary = summarise(
      [
        entry({ key: "half", duration: 100, furthestTime: 50 }),
        entry({ key: "nearly", duration: 100, furthestTime: 90 }),
      ],
      NOW,
    );
    expect(summary.almostDone?.key).toBe("nearly");
  });

  it("does not consider completed or barely-started files almostDone", () => {
    const done = summarise(
      [entry({ key: "done", duration: 100, furthestTime: 100, completed: true })],
      NOW,
    );
    expect(done.almostDone).toBeNull();

    const barely = summarise([entry({ key: "barely", duration: 100, furthestTime: 10 })], NOW);
    expect(barely.almostDone).toBeNull();
  });

  it("does not mutate the input entries", () => {
    const entries = [entry({ key: "a", duration: 100, furthestTime: 80 })];
    const snapshot = JSON.stringify(entries);
    summarise(entries, NOW);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("returns a fresh object each call", () => {
    const a = summarise([], NOW);
    a.fileCount = 99;
    expect(EMPTY_ANALYTICS.fileCount).toBe(0);
    expect(summarise([], NOW).fileCount).toBe(0);
  });
});
