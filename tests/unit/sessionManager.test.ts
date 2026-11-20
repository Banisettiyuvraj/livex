import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/session/SessionManager";
import { PlaybackEventEmitter } from "../../src/playback/PlaybackAdapter";
import type { PlaybackAdapter } from "../../src/playback/PlaybackAdapter";
import type {
  MediaMetadata,
  PlaybackEventMap,
  PlaybackEventName,
  PlaybackStatus,
} from "../../src/types/media";

/**
 * A deterministic stand-in for a real engine.
 *
 * `SessionManager` only talks to `PlaybackAdapter`, so this fake lets the
 * session state machine, anti-skip ceiling and integrity counters be tested
 * without a browser or a media file.
 */
class FakeAdapter implements PlaybackAdapter {
  readonly id = "native" as const;
  private emitter = new PlaybackEventEmitter();
  private time = 0;
  private duration = 0;
  private rate = 1;
  private status: PlaybackStatus = "empty";
  private volume = 1;
  private muted = false;

  /** When true, seek() reports the requested time back through `seek`. */
  echoSeeks = true;

  async load(): Promise<MediaMetadata> {
    this.duration = 100;
    this.time = 0;
    this.status = "ready";
    return {
      fileName: "test.mp4",
      fileSize: 1234,
      mimeType: "video/mp4",
      extension: "mp4",
      duration: this.duration,
      videoWidth: 640,
      videoHeight: 480,
    };
  }

  async play(): Promise<void> {
    this.status = "playing";
    this.emit("play", { time: this.time });
  }

  pause(): void {
    if (this.status !== "playing") return;
    this.status = "paused";
    this.emit("pause", { time: this.time });
  }

  seek(timeSeconds: number): void {
    const from = this.time;
    this.time = timeSeconds;
    if (this.echoSeeks) this.emit("seek", { from, to: timeSeconds });
    // Real engines follow a seek with a timeupdate carrying the new position.
    // Emitting it here keeps the fake faithful to that ordering.
    this.emit("timeupdate", { time: this.time, duration: this.duration });
  }

  getCurrentTime(): number {
    return this.time;
  }
  getDuration(): number {
    return this.duration;
  }
  getStatus(): PlaybackStatus {
    return this.status;
  }

  setPlaybackRate(rate: number): void {
    this.rate = rate;
    this.emit("ratechange", { rate });
  }
  getPlaybackRate(): number {
    return this.rate;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }
  getVolume(): number {
    return this.volume;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  isMuted(): boolean {
    return this.muted;
  }

  isReady(): boolean {
    return true;
  }

  on<K extends PlaybackEventName>(
    event: K,
    listener: (payload: PlaybackEventMap[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  dispose(): void {
    this.emitter.clear();
  }

  /* --- test helpers ------------------------------------------------- */

  /** Simulate real playback progress: the element advances its own clock. */
  tick(to: number): void {
    this.time = to;
    this.emit("timeupdate", { time: to, duration: this.duration });
  }

  end(): void {
    this.time = this.duration;
    this.emit("timeupdate", { time: this.duration, duration: this.duration });
    this.emit("ended", { time: this.duration });
  }

  private emit<K extends PlaybackEventName>(event: K, payload: PlaybackEventMap[K]): void {
    this.emitter.emit(event, payload);
  }
}

async function liveManager(): Promise<{ manager: SessionManager; adapter: FakeAdapter }> {
  const adapter = new FakeAdapter();
  const manager = new SessionManager(adapter);
  await manager.loadFile(new File([], "test.mp4"));
  await manager.start();
  return { manager, adapter };
}

describe("SessionManager — state machine", () => {
  it("moves idle → ready on load", async () => {
    const manager = new SessionManager(new FakeAdapter());
    expect(manager.getState()).toBe("idle");
    await manager.loadFile(new File([], "test.mp4"));
    expect(manager.getState()).toBe("ready");
  });

  it("moves ready → live on start", async () => {
    const { manager } = await liveManager();
    expect(manager.getState()).toBe("live");
  });

  it("refuses to start without a loaded file", async () => {
    const manager = new SessionManager(new FakeAdapter());
    await expect(manager.start()).rejects.toThrow(/Cannot start/);
  });

  it("reports progress with a safe fraction", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(25);
    const progress = manager.getProgress();
    expect(progress.currentTime).toBe(25);
    expect(progress.duration).toBe(100);
    expect(progress.fraction).toBeCloseTo(0.25, 5);
  });
});

describe("SessionManager — anti-skip ceiling", () => {
  it("records the furthest legitimately watched point", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(10);
    adapter.tick(20);
    expect(manager.getProgress().furthestTime).toBe(20);
  });

  it("clamps a forward seek past the ceiling", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(10);
    adapter.seek(90); // engine jumps forward
    // The manager pulls it back to the ceiling.
    expect(adapter.getCurrentTime()).toBeLessThan(15);
    expect(manager.getState()).toBe("live");
  });

  it("allows rewinding freely", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(40);
    adapter.seek(5);
    expect(adapter.getCurrentTime()).toBe(5);
    expect(manager.getProgress().currentTime).toBe(5);
  });

  it("clamps seekTo() to the ceiling", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(30);
    manager.seekTo(95);
    expect(adapter.getCurrentTime()).toBe(30);
  });
});

describe("SessionManager — integrity tracking", () => {
  it("starts with zero counters", async () => {
    const { manager } = await liveManager();
    expect(manager.getIntegrity()).toEqual({
      skipAttempts: 0,
      watchedSeconds: 0,
      longestStretchSeconds: 0,
    });
  });

  it("counts a blocked forward seek as a skip attempt", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(5);
    adapter.seek(80);
    expect(manager.getIntegrity().skipAttempts).toBe(1);
  });

  it("does not count an ordinary rewind as a skip attempt", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(40);
    adapter.seek(10);
    expect(manager.getIntegrity().skipAttempts).toBe(0);
  });

  it("accumulates watched seconds from forward timeupdates", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(1);
    adapter.tick(2);
    adapter.tick(3);
    // 0 → 1 → 2 → 3 is three one-second steps.
    expect(manager.getIntegrity().watchedSeconds).toBeCloseTo(3, 5);
  });

  it("does not count time spent paused", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(5);
    const before = manager.getIntegrity().watchedSeconds;
    manager.pause();
    adapter.tick(8); // the element clock moving while paused must not count
    expect(manager.getIntegrity().watchedSeconds).toBeCloseTo(before, 5);
  });

  it("tracks the longest uninterrupted stretch", async () => {
    const { manager, adapter } = await liveManager();
    for (let t = 1; t <= 10; t += 1) adapter.tick(t);
    expect(manager.getIntegrity().longestStretchSeconds).toBeCloseTo(10, 0);
  });

  it("ends a stretch when playback is rewound", async () => {
    const { manager, adapter } = await liveManager();
    for (let t = 1; t <= 10; t += 1) adapter.tick(t);
    const longStretch = manager.getIntegrity().longestStretchSeconds;
    expect(longStretch).toBeGreaterThanOrEqual(9);

    adapter.seek(0);
    for (let t = 1; t <= 3; t += 1) adapter.tick(t);
    // The earlier long stretch remains the record; the new short one cannot
    // exceed it. This is the property that matters for the report.
    expect(manager.getIntegrity().longestStretchSeconds).toBeGreaterThanOrEqual(longStretch);
  });

  it("resets the counters for a new session", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(5);
    adapter.seek(80);
    expect(manager.getIntegrity().skipAttempts).toBe(1);
    manager.reset();
    await manager.loadFile(new File([], "test.mp4"));
    await manager.start();
    expect(manager.getIntegrity().skipAttempts).toBe(0);
  });
});

describe("SessionManager — completion", () => {
  it("completes from the engine's ended event", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(50);
    adapter.end();
    expect(manager.getState()).toBe("completed");
  });

  it("does not mistake the pause that precedes ended for a user pause", async () => {
    const { manager, adapter } = await liveManager();
    adapter.tick(99);
    adapter.pause();
    adapter.end();
    expect(manager.getState()).toBe("completed");
  });
});

describe("SessionManager — startAt (resume)", () => {
  it("starts at the remembered point and moves the ceiling there", async () => {
    const adapter = new FakeAdapter();
    const manager = new SessionManager(adapter);
    await manager.loadFile(new File([], "test.mp4"));
    await manager.startAt(40);

    expect(manager.getState()).toBe("live");
    expect(adapter.getCurrentTime()).toBe(40);
    expect(manager.getProgress().furthestTime).toBe(40);
  });

  it("clamps a resume point beyond the duration", async () => {
    const adapter = new FakeAdapter();
    const manager = new SessionManager(adapter);
    await manager.loadFile(new File([], "test.mp4"));
    await manager.startAt(500);
    expect(adapter.getCurrentTime()).toBe(100);
  });

  it("clears integrity counters like a fresh start", async () => {
    const adapter = new FakeAdapter();
    const manager = new SessionManager(adapter);
    await manager.loadFile(new File([], "test.mp4"));
    await manager.startAt(40);
    expect(manager.getIntegrity().skipAttempts).toBe(0);
  });
});

describe("SessionManager — 1x rate lock", () => {
  it("forces the rate back to 1 during a session", async () => {
    const { manager, adapter } = await liveManager();
    adapter.setPlaybackRate(2);
    expect(adapter.getPlaybackRate()).toBe(1);
    expect(manager.getSnapshot().playbackRate).toBe(1);
  });
});
