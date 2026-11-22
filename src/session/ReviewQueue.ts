/**
 * Lecture review queue.
 *
 * Review mode deliberately sits outside the live-session state machine: it is
 * only opened after a session has completed, and it seeks/plays the loaded file
 * directly. Nothing here is used by SessionManager, so the 1× lock and
 * anti-skip ceiling cannot be weakened by review playback.
 *
 * Each selected bookmark or note becomes a short section: the timestamp plus a
 * fixed window. That makes a queue of predictable "revisit this moment" items
 * without persisting any new data.
 */

import type { Annotation, AnnotationKind } from "../files/LocalMetadataStore";

/** Default length of one review section, in seconds. */
export const REVIEW_WINDOW_SECONDS = 30;

export interface ReviewItem {
  /** Annotation this section came from. */
  annotationId: string;
  kind: AnnotationKind;
  /** Original annotation timestamp. */
  time: number;
  text: string;
  /** Section boundaries in media seconds. */
  start: number;
  end: number;
}

/**
 * Build a review queue from the annotations the user selected.
 *
 * Sections are sorted by start time, clamped to the file, and de-duplicated by
 * annotation id. A non-finite duration (metadata not ready) is treated as a
 * zero-duration clip so the queue still renders predictably.
 */
export function buildReviewQueue(
  annotations: readonly Annotation[],
  durationSeconds: number,
  selectedIds: ReadonlySet<string>,
  windowSeconds = REVIEW_WINDOW_SECONDS,
): ReviewItem[] {
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const window =
    Number.isFinite(windowSeconds) && windowSeconds > 0
      ? windowSeconds
      : REVIEW_WINDOW_SECONDS;

  const seen = new Set<string>();
  const items: ReviewItem[] = [];

  for (const annotation of annotations) {
    if (!selectedIds.has(annotation.id) || seen.has(annotation.id)) continue;
    seen.add(annotation.id);

    const time = Math.max(
      0,
      Number.isFinite(annotation.time) ? annotation.time : 0,
    );
    // Leave a sliver at the end of the file so even an annotation recorded on
    // the final frame gets a non-zero section.
    const start = duration > 0 ? Math.min(time, Math.max(0, duration - 0.1)) : time;
    const end = duration > 0 ? Math.min(duration, start + window) : start + window;

    items.push({
      annotationId: annotation.id,
      kind: annotation.kind,
      time,
      text: annotation.text,
      start,
      end,
    });
  }

  return items.sort((a, b) => a.start - b.start || a.time - b.time);
}
