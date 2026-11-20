import { beforeAll, describe, expect, it } from "vitest";
import {
  PlaybackError,
  fromMediaError,
  noFileError,
  unsupportedFileError,
} from "../../src/playback/PlaybackErrors";
import type { MediaProbeResult } from "../../src/types/media";

/**
 * `fromMediaError` reads the `MediaError` constants, which only exist in a
 * browser. They are plain numbers in the spec, so define them for the test run
 * rather than pulling in a whole DOM implementation.
 */
beforeAll(() => {
  const mediaError = {
    MEDIA_ERR_ABORTED: 1,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: 3,
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
  };
  Object.assign(globalThis, { MediaError: mediaError });
});

const probe: MediaProbeResult = {
  fileName: "clip.mp4",
  extension: "mp4",
  mimeType: "video/mp4",
  container: "mp4",
  videoCodec: "hevc",
  audioCodec: "aac",
  canPlayType: { mime: "maybe", withCodecs: "probably", extensionOnly: "maybe" },
  supported: false,
  codecUnknown: false,
};

function mediaError(code: number): MediaError {
  return { code, message: "" } as MediaError;
}

describe("PlaybackError", () => {
  it("keeps the code and message", () => {
    const error = new PlaybackError({ code: "decode-failed", message: "Nope" });
    expect(error.code).toBe("decode-failed");
    expect(error.message).toBe("Nope");
    expect(error.name).toBe("PlaybackError");
  });

  it("omits an empty hint from the serialized details", () => {
    const error = new PlaybackError({ code: "unknown", message: "Boom" });
    expect(error.toDetails()).not.toHaveProperty("hint");
  });

  it("includes the hint when present", () => {
    const error = new PlaybackError({ code: "unknown", message: "Boom", hint: "Try again" });
    expect(error.toDetails().hint).toBe("Try again");
  });
});

describe("fromMediaError", () => {
  it("maps an abort to a retryable error", () => {
    const error = fromMediaError(mediaError(1));
    expect(error.code).toBe("aborted");
    expect(error.hint).toContain("again");
  });

  it("maps a network failure to a re-select hint", () => {
    const error = fromMediaError(mediaError(2));
    expect(error.code).toBe("network-failed");
    expect(error.hint).toContain("Select it again");
  });

  it("maps a decode failure and names the codecs it can see", () => {
    const error = fromMediaError(mediaError(3), probe);
    expect(error.code).toBe("decode-failed");
    expect(error.hint).toContain("hevc");
    expect(error.hint).toContain("aac");
  });

  it("falls back to a generic hint when no probe is available", () => {
    const error = fromMediaError(mediaError(3));
    expect(error.code).toBe("decode-failed");
    expect(error.hint).toContain("damaged");
  });

  it("maps an unsupported source", () => {
    const error = fromMediaError(mediaError(4), probe);
    expect(error.code).toBe("unsupported-format");
    expect(error.hint).toContain("container: mp4");
  });

  it("treats a missing MediaError as an unknown failure", () => {
    expect(fromMediaError(null).code).toBe("unknown");
    expect(fromMediaError(undefined).code).toBe("unknown");
  });

  it("never fires with an undefined code", () => {
    // Every branch returns a PlaybackError with a real code.
    for (const code of [1, 2, 3, 4, undefined]) {
      const error = fromMediaError(code ? mediaError(code) : null);
      expect(error.code).toBeTruthy();
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe("factory helpers", () => {
  it("explains a non-video file by name", () => {
    const error = unsupportedFileError("notes.txt");
    expect(error.code).toBe("unsupported-format");
    expect(error.hint).toContain("notes.txt");
  });

  it("explains that nothing is loaded yet", () => {
    const error = noFileError();
    expect(error.code).toBe("no-file");
    expect(error.hint).toContain("Open Video");
  });
});
