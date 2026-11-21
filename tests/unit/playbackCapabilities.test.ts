import { describe, expect, it, vi } from "vitest";
import { PlaybackCapabilityDetector } from "../../src/playback/PlaybackCapabilities";

/**
 * The detector only needs `canPlayType` from the element, so a stub keeps these
 * tests in plain Node (roadmap 3.4). The cache is deliberately per-instance.
 */
function stubDetector(answers: Record<string, string> = {}) {
  const canPlayType = vi.fn((mime: string) => answers[mime] ?? "");
  const detector = new PlaybackCapabilityDetector({
    canPlayType,
  } as unknown as HTMLVideoElement);
  return { detector, canPlayType };
}

describe("PlaybackCapabilityDetector capability cache", () => {
  it("asks the element once per MIME string", () => {
    const { detector, canPlayType } = stubDetector();

    expect(detector.canPlayType("video/mp4")).toBe("");
    expect(detector.canPlayType("video/mp4")).toBe("");
    expect(detector.canPlayType("video/webm")).toBe("");

    expect(canPlayType).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct answers for distinct MIME strings", () => {
    const { detector } = stubDetector({
      "video/mp4": "probably",
      "video/webm": "maybe",
    });

    expect(detector.canPlayType("video/mp4")).toBe("probably");
    expect(detector.canPlayType("video/webm")).toBe("maybe");
    expect(detector.canPlayType("video/ogg")).toBe("");
  });

  it("fills the support matrix from the cache", () => {
    const { detector, canPlayType } = stubDetector({
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"': "probably",
    });

    const first = detector.describeSupport();
    const callsAfterFirst = canPlayType.mock.calls.length;
    const second = detector.describeSupport();

    expect(first).toHaveLength(11);
    expect(first.find((row) => row.label === "MP4 · H.264 + AAC")?.result).toBe("probably");
    expect(first.find((row) => row.label === "AVI")?.result).toBe("not supported");
    expect(second).toEqual(first);
    // The matrix repeats several MIME strings; no second round-trip.
    expect(canPlayType.mock.calls.length).toBe(callsAfterFirst);
  });
});
