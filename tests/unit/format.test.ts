import { describe, expect, it } from "vitest";
import { formatFileSize, formatStretch, formatTime } from "../../src/ui/format";

describe("formatTime", () => {
  it("formats sub-hour times as mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(599)).toBe("09:59");
  });

  it("adds an hours component past 60 minutes", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
    expect(formatTime(36000)).toBe("10:00:00");
  });

  it("floors fractional seconds rather than rounding up", () => {
    expect(formatTime(1.99)).toBe("00:01");
    expect(formatTime(59.999)).toBe("00:59");
  });

  it("returns 00:00 for values that are not usable", () => {
    expect(formatTime(Number.NaN)).toBe("00:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("00:00");
    expect(formatTime(-5)).toBe("00:00");
  });
});

describe("formatStretch", () => {
  it("uses seconds below one minute", () => {
    expect(formatStretch(0)).toBe("0m");
    expect(formatStretch(1)).toBe("1s");
    expect(formatStretch(45)).toBe("45s");
    expect(formatStretch(59)).toBe("59s");
  });

  it("uses minutes below one hour", () => {
    expect(formatStretch(60)).toBe("1m");
    expect(formatStretch(840)).toBe("14m");
    expect(formatStretch(3599)).toBe("59m");
  });

  it("pads the minutes once hours are involved", () => {
    expect(formatStretch(3600)).toBe("1h 00m");
    expect(formatStretch(3720)).toBe("1h 02m");
    expect(formatStretch(7325)).toBe("2h 02m");
  });

  it("treats bad input as zero", () => {
    expect(formatStretch(Number.NaN)).toBe("0m");
    expect(formatStretch(-10)).toBe("0m");
  });
});

describe("formatFileSize", () => {
  it("scales through the units", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("keeps byte-level values exact", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });
});
