import { describe, expect, it } from "vitest";
import {
  ANNOTATION_BACKUP_FORMAT,
  annotationsToMarkdown,
  buildAnnotationBackup,
  parseAnnotationBackup,
  serializeAnnotationBackup,
} from "../../src/session/AnnotationExport";
import { mediaFingerprint, type Annotation } from "../../src/files/LocalMetadataStore";

const NOW = new Date("2026-11-23T10:00:00.000Z");

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "media:one",
    mediaKey: "media",
    kind: "note",
    time: 65,
    text: "Remember this",
    createdAt: Date.UTC(2026, 10, 20),
    ...overrides,
  };
}

describe("annotationsToMarkdown", () => {
  it("writes a readable document sorted by timestamp", () => {
    const markdown = annotationsToMarkdown(
      "Lecture 1.mp4",
      [
        annotation({ id: "b", kind: "note", time: 130, text: "Second point" }),
        annotation({ id: "a", kind: "bookmark", time: 4, text: "" }),
      ],
      NOW,
    );

    expect(markdown).toContain("# Lecture 1.mp4 — notes");
    expect(markdown).toContain("_Exported from LiveX on 2026-11-23._");
    expect(markdown).toContain("_1 bookmark · 1 note_");
    expect(markdown.indexOf("## 00:04 — Bookmark")).toBeLessThan(
      markdown.indexOf("## 02:10 — Note"),
    );
    expect(markdown).toContain("Second point");
  });

  it("includes hours and a visible fallback for empty note text", () => {
    const markdown = annotationsToMarkdown(
      "long.mp4",
      [annotation({ time: 3661, text: "   " })],
      NOW,
    );
    expect(markdown).toContain("## 1:01:01 — Note");
    expect(markdown).toContain("_No note text._");
  });

  it("handles a lecture with no annotations", () => {
    const markdown = annotationsToMarkdown("Empty.mp4", [], NOW);
    expect(markdown).toContain("# Empty.mp4 — notes");
    expect(markdown).toContain("_No bookmarks or notes for this lecture._");
  });
});

describe("annotation backup JSON", () => {
  it("round-trips annotations and media through parse", () => {
    const media = { fileName: "Lecture 1.mp4", fileSize: 1234, duration: 600 };
    const annotations = [
      annotation({ id: "media:one" }),
      annotation({ id: "media:two", kind: "bookmark", time: 3, text: "" }),
    ];

    const json = serializeAnnotationBackup(buildAnnotationBackup(media, annotations, NOW));
    const parsed = JSON.parse(json);

    expect(parsed.format).toBe(ANNOTATION_BACKUP_FORMAT);
    expect(parsed.exportedAt).toBe(NOW.toISOString());

    const result = parseAnnotationBackup(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.media).toEqual(media);
    expect(result.annotations).toEqual([
      {
        ...annotations[1],
        time: 3,
      },
      annotations[0],
    ]);
  });

  it("derives a media key from the backup media when a row has none", () => {
    const media = { fileName: "Talk.mp4", fileSize: 42, duration: 90 };
    const json = JSON.stringify({
      annotations: [{ kind: "bookmark", time: 12, text: "" }],
      media,
    });

    const result = parseAnnotationBackup(json, NOW.getTime());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.annotations[0]?.mediaKey).toBe(mediaFingerprint("Talk.mp4", 42, 90));
    expect(result.annotations[0]?.createdAt).toBe(NOW.getTime());
    expect(result.annotations[0]?.id).toContain(":import-0-");
  });

  it("accepts a bare array of annotations", () => {
    const result = parseAnnotationBackup(
      JSON.stringify([{ kind: "note", mediaKey: "m", time: 1, text: "hi" }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.annotations).toHaveLength(1);
  });

  it("rejects invalid JSON, foreign formats and empty backups", () => {
    expect(parseAnnotationBackup("{")).toEqual({ ok: false, error: "That file is not valid JSON." });
    expect(parseAnnotationBackup(JSON.stringify({ format: "other", annotations: [] }))).toEqual({
      ok: false,
      error: "That file is not a LiveX notes backup.",
    });
    expect(parseAnnotationBackup(JSON.stringify({ hello: "world" }))).toEqual({
      ok: false,
      error: "That file does not contain any notes or bookmarks.",
    });
    expect(parseAnnotationBackup(JSON.stringify({ annotations: [{}] }))).toEqual({
      ok: false,
      error: "No bookmarks or notes could be read from that file.",
    });
  });

  it("drops malformed rows and clamps text and timestamps", () => {
    const result = parseAnnotationBackup(
      JSON.stringify({
        annotations: [
          { kind: "bookmark", mediaKey: "m", time: -1 },
          { kind: "unknown", mediaKey: "m", time: 2 },
          { kind: "note", mediaKey: "m", time: 2.34, text: "x".repeat(900) },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.time).toBe(2.3);
    expect(result.annotations[0]?.text).toHaveLength(500);
  });
});
