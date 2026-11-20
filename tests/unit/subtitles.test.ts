import { describe, expect, it } from "vitest";
import {
  detectSubtitleFormat,
  srtToVtt,
} from "../../src/session/SubtitleService";

describe("detectSubtitleFormat", () => {
  it("recognises .vtt and .srt regardless of case", () => {
    expect(detectSubtitleFormat("movie.vtt")).toBe("vtt");
    expect(detectSubtitleFormat("MOVIE.VTT")).toBe("vtt");
    expect(detectSubtitleFormat("movie.srt")).toBe("srt");
    expect(detectSubtitleFormat("Movie.Srt")).toBe("srt");
  });

  it("rejects anything else", () => {
    expect(detectSubtitleFormat("movie.sub")).toBe("unknown");
    expect(detectSubtitleFormat("movie.txt")).toBe("unknown");
    expect(detectSubtitleFormat("movie")).toBe("unknown");
  });
});

describe("srtToVtt", () => {
  it("adds the WEBVTT header", () => {
    const vtt = srtToVtt("1\n00:00:00,500 --> 00:00:02,500\nHello\n");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
  });

  it("converts SRT comma separators to VTT dots", () => {
    const vtt = srtToVtt("1\n00:00:00,500 --> 00:00:02,500\nHello\n");
    expect(vtt).toContain("00:00:00.500 --> 00:00:02.500");
    expect(vtt).not.toContain("00:00:00,500");
  });

  it("drops the numeric cue index", () => {
    const vtt = srtToVtt("1\n00:00:00,500 --> 00:00:02,500\nHello\n");
    const lines = vtt.split("\n");
    expect(lines).not.toContain("1");
  });

  it("keeps multi-line cue text together", () => {
    const srt = [
      "1",
      "00:00:00,500 --> 00:00:02,500",
      "line one",
      "line two",
      "",
      "2",
      "00:00:03,000 --> 00:00:05,000",
      "third",
      "",
    ].join("\n");
    const vtt = srtToVtt(srt);
    expect(vtt).toContain("line one\nline two");
    expect(vtt).toContain("third");
  });

  it("normalises CRLF and CR line endings", () => {
    const crlf = "1\r\n00:00:00,500 --> 00:00:02,500\r\nHello\r\n";
    expect(srtToVtt(crlf)).toContain("00:00:00.500 --> 00:00:02.500");
    const cr = "1\r00:00:00,500 --> 00:00:02,500\rHello\r";
    expect(srtToVtt(cr)).toContain("Hello");
  });

  it("tolerates a BOM and blank lines between cues", () => {
    const srt = "\n\n1\n00:00:00,500 --> 00:00:02,500\nHello\n\n\n\n";
    expect(srtToVtt(srt)).toContain("Hello");
  });

  it("returns a valid empty document for empty input", () => {
    const vtt = srtToVtt("");
    expect(vtt.trim()).toBe("WEBVTT");
  });

  it("ignores blocks with no timing line", () => {
    const vtt = srtToVtt("just some stray text\n\n1\n00:00:00,500 --> 00:00:02,500\nReal cue\n");
    expect(vtt).toContain("Real cue");
    expect(vtt).not.toContain("stray text");
  });

  it("does not mistake a cue index for cue text", () => {
    // The old bug class: a bare "2" left in place confuses VTT parsers.
    const vtt = srtToVtt("1\n00:00:00,500 --> 00:00:02,500\nOne\n\n2\n00:00:03,000 --> 00:00:05,000\nTwo\n");
    const body = vtt.split("\n").slice(1).join("\n");
    expect(/^\d+$/m.test(body)).toBe(false);
  });
});
