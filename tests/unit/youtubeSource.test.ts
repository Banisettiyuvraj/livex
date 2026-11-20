import { describe, expect, it } from "vitest";
import {
  buildEmbedUrl,
  firstYouTubeSource,
  parseTimeParam,
  parseYouTubeUrl,
  type YouTubeSource,
} from "../../src/files/YouTubeSource";

/** A real, well-formed id used throughout. */
const ID = "dQw4w9WgXcQ";

describe("parseYouTubeUrl — accepted forms", () => {
  it("parses a standard watch link", () => {
    const result = parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}`);
    expect(result.ok).toBe(true);
    if (result.ok && result.source.kind === "video") {
      expect(result.source.videoId).toBe(ID);
      expect(result.source.startAt).toBe(0);
    }
  });

  it("parses a scheme-less watch link", () => {
    const result = parseYouTubeUrl(`youtube.com/watch?v=${ID}`);
    expect(result.ok && result.source.kind === "video").toBe(true);
  });

  it("parses a youtu.be short link", () => {
    const result = parseYouTubeUrl(`https://youtu.be/${ID}`);
    expect(result.ok).toBe(true);
    if (result.ok && result.source.kind === "video") expect(result.source.videoId).toBe(ID);
  });

  it("parses /embed/ links", () => {
    const result = parseYouTubeUrl(`https://www.youtube.com/embed/${ID}`);
    expect(result.ok && result.source.kind === "video" && result.source.videoId === ID).toBe(true);
  });

  it("parses /shorts/ links", () => {
    const result = parseYouTubeUrl(`https://www.youtube.com/shorts/${ID}`);
    expect(result.ok && result.source.kind === "video" && result.source.videoId === ID).toBe(true);
  });

  it("parses /live/ links", () => {
    const result = parseYouTubeUrl(`https://www.youtube.com/live/${ID}`);
    expect(result.ok && result.source.kind === "video" && result.source.videoId === ID).toBe(true);
  });

  it("parses a bare video id", () => {
    const result = parseYouTubeUrl(ID);
    expect(result.ok && result.source.kind === "video" && result.source.videoId === ID).toBe(true);
  });

  it("parses mobile, music and nocookie hosts", () => {
    for (const host of ["m.youtube.com", "music.youtube.com", "youtube-nocookie.com"]) {
      const result = parseYouTubeUrl(`https://${host}/watch?v=${ID}`);
      expect(result.ok, host).toBe(true);
    }
  });

  it("ignores unrelated query parameters", () => {
    const result = parseYouTubeUrl(
      `https://www.youtube.com/watch?v=${ID}&list=PLabc&index=3&pp=xyz`,
    );
    expect(result.ok && result.source.kind === "video" && result.source.videoId === ID).toBe(true);
  });
});

describe("parseYouTubeUrl — start offsets", () => {
  const cases: Array<[string, number]> = [
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://youtu.be/${ID}?t=90s`, 90],
    [`https://youtu.be/${ID}?t=1m30s`, 90],
    [`https://youtu.be/${ID}?t=1h2m3s`, 3723],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/embed/${ID}?start=45`, 45],
    [`https://www.youtube.com/watch?v=${ID}#t=75`, 75],
  ];

  for (const [url, expected] of cases) {
    it(`${url} → ${expected}s`, () => {
      const result = parseYouTubeUrl(url);
      expect(result.ok).toBe(true);
      if (result.ok && result.source.kind === "video") expect(result.source.startAt).toBe(expected);
    });
  }
});

describe("parseTimeParam", () => {
  it("handles clock form", () => {
    expect(parseTimeParam("1:30")).toBe(90);
    expect(parseTimeParam("1:02:03")).toBe(3723);
    expect(parseTimeParam("0:45")).toBe(45);
  });

  it("handles unit form", () => {
    expect(parseTimeParam("2h")).toBe(7200);
    expect(parseTimeParam("5m")).toBe(300);
    expect(parseTimeParam("30s")).toBe(30);
  });

  it("returns 0 rather than NaN for junk", () => {
    expect(parseTimeParam("")).toBe(0);
    expect(parseTimeParam("abc")).toBe(0);
    expect(parseTimeParam("1:xx")).toBe(0);
    expect(parseTimeParam(undefined)).toBe(0);
    expect(parseTimeParam(":")).toBe(0);
  });
});

describe("parseYouTubeUrl — rejections", () => {
  it("rejects an empty paste", () => {
    expect(parseYouTubeUrl("   ").ok).toBe(false);
  });

  it("rejects non-YouTube hosts", () => {
    for (const url of [
      "https://vimeo.com/12345",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      // Look-alike host must not pass the suffix check.
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    ]) {
      const result = parseYouTubeUrl(url);
      expect(result.ok, url).toBe(false);
    }
  });

  it("rejects non-http protocols", () => {
    for (const url of [`javascript:alert(1)//youtu.be/${ID}`, `file:///etc/passwd`]) {
      expect(parseYouTubeUrl(url).ok, url).toBe(false);
    }
  });

  it("rejects a watch link with no v parameter", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch").ok).toBe(false);
  });

  it("rejects an id that is the wrong length", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=tooShort").ok).toBe(false);
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=wayTooLongToBeAnId").ok).toBe(false);
  });

  it("rejects an id with illegal characters", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=abc def ghij").ok).toBe(false);
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}<script>`).ok).toBe(false);
  });

  it("never throws on hostile input", () => {
    const hostile = [
      "",
      "://",
      "https://",
      "\u0000",
      "' OR 1=1--",
      `<img src=x onerror=alert(1)>`,
      "youtu.be/" + "a".repeat(5000),
    ];
    for (const input of hostile) {
      expect(() => parseYouTubeUrl(input), input).not.toThrow();
      expect(() => firstYouTubeSource(input), input).not.toThrow();
    }
  });
});

describe("parseYouTubeUrl — playlists", () => {
  it("recognises a playlist-only link", () => {
    const result = parseYouTubeUrl("https://www.youtube.com/playlist?list=PLrAXtmRdnEQy6nuLMHjMZOz59Oq8o6zQv");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.kind).toBe("playlist");
  });
});

describe("firstYouTubeSource — extraction from pasted text", () => {
  it("finds a link inside surrounding prose", () => {
    const result = firstYouTubeSource(`Watch this: https://youtu.be/${ID} — it is great`);
    expect(result.ok && result.source.kind === "video" && result.source.videoId === ID).toBe(true);
  });

  it("finds a bare id line", () => {
    const result = firstYouTubeSource(ID);
    expect(result.ok && result.source.kind === "video").toBe(true);
  });

  it("still rejects text with no YouTube link", () => {
    expect(firstYouTubeSource("just some notes about the lecture").ok).toBe(false);
  });
});

describe("buildEmbedUrl", () => {
  const source: YouTubeSource = { kind: "video", videoId: ID, startAt: 0 };

  it("builds a nocookie embed with the js api enabled", () => {
    const url = buildEmbedUrl(source);
    expect(url.startsWith("https://www.youtube-nocookie.com/embed/" + ID)).toBe(true);
    expect(url).toContain("enablejsapi=1");
  });

  it("includes start only when non-zero", () => {
    expect(buildEmbedUrl(source)).not.toContain("start=");
    expect(buildEmbedUrl({ ...source, startAt: 90 })).toContain("start=90");
  });

  it("passes origin through when provided", () => {
    expect(buildEmbedUrl(source, { origin: "http://localhost:5173" })).toContain(
      "origin=http%3A%2F%2Flocalhost%3A5173",
    );
  });

  it("never lets an unvalidated id through the parser", () => {
    // The id reaching buildEmbedUrl always came from a parser success.
    const parsed = parseYouTubeUrl("https://youtu.be/" + ID);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.source.kind === "video") {
      expect(buildEmbedUrl(parsed.source)).toContain(ID);
    }
  });
});
