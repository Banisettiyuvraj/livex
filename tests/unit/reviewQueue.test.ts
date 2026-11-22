import { describe, expect, it } from "vitest";
import {
  REVIEW_WINDOW_SECONDS,
  buildReviewQueue,
} from "../../src/session/ReviewQueue";
import type { Annotation } from "../../src/files/LocalMetadataStore";

const annotation = (
  id: string,
  time: number,
  kind: Annotation["kind"] = "bookmark",
  text = "",
): Annotation => ({
  id,
  mediaKey: "lecture.mp4::1000::60",
  kind,
  time,
  text,
  createdAt: 1,
});

describe("buildReviewQueue", () => {
  it("keeps only selected annotations and preserves their labels", () => {
    const items = buildReviewQueue(
      [
        annotation("a", 12, "bookmark"),
        annotation("b", 40, "note", "Derive the second case"),
        annotation("c", 5),
      ],
      120,
      new Set(["a", "b"]),
    );

    expect(items.map((item) => item.annotationId)).toEqual(["a", "b"]);
    expect(items[1]).toMatchObject({
      kind: "note",
      text: "Derive the second case",
      start: 40,
      end: 70,
    });
  });

  it("sorts sections by timestamp regardless of storage order", () => {
    const items = buildReviewQueue(
      [annotation("late", 50), annotation("early", 10), annotation("middle", 30)],
      120,
      new Set(["late", "early", "middle"]),
    );

    expect(items.map((item) => item.start)).toEqual([10, 30, 50]);
  });

  it("uses a 30-second window and clamps the end to the file duration", () => {
    const items = buildReviewQueue(
      [annotation("near-end", 55)],
      60,
      new Set(["near-end"]),
    );

    expect(REVIEW_WINDOW_SECONDS).toBe(30);
    expect(items[0]).toMatchObject({ start: 55, end: 60 });
  });

  it("leaves a reviewable sliver for an annotation on the final frame", () => {
    const items = buildReviewQueue(
      [annotation("last-frame", 60)],
      60,
      new Set(["last-frame"]),
    );

    expect(items[0]!.start).toBeLessThan(60);
    expect(items[0]!.end).toBe(60);
  });

  it("still builds finite sections when duration is unknown", () => {
    const items = buildReviewQueue(
      [annotation("a", 12)],
      Number.NaN,
      new Set(["a"]),
    );

    expect(items[0]).toMatchObject({ start: 12, end: 42 });
  });

  it("ignores duplicate ids and empty selections", () => {
    const duplicate = annotation("same", 10);
    expect(
      buildReviewQueue([duplicate, { ...duplicate }], 60, new Set(["same"])),
    ).toHaveLength(1);
    expect(buildReviewQueue([duplicate], 60, new Set())).toEqual([]);
  });
});
