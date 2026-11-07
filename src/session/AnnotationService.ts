/**
 * Bookmarks and timestamped notes ("annotations").
 *
 * Stored locally per media fingerprint, never uploaded. Bookmarks are the
 * lightweight "revisit 04:12" markers; notes carry text and surface as a
 * transport message when playback passes their timestamp.
 */

import {
  LocalMetadataStore,
  mediaFingerprint,
  type Annotation,
  type AnnotationKind,
} from "../files/LocalMetadataStore";
import type { MediaMetadata } from "../types/media";

export type AnnotationChangeListener = (annotations: Annotation[]) => void;
/** Fired when playback crosses a note's timestamp. */
export type NoteCrossedListener = (annotation: Annotation) => void;

let idCounter = 0;

export class AnnotationService {
  private readonly store: LocalMetadataStore;
  private mediaKey = "";
  private annotations: Annotation[] = [];
  private lastCrossedTime = 0;

  private readonly changeListeners = new Set<AnnotationChangeListener>();
  private readonly crossedListeners = new Set<NoteCrossedListener>();

  constructor(store?: LocalMetadataStore) {
    this.store = store ?? new LocalMetadataStore();
  }

  /** Point the service at a newly loaded file and load its annotations. */
  async setMedia(metadata: MediaMetadata | null): Promise<void> {
    this.annotations = [];
    this.lastCrossedTime = 0;
    this.mediaKey = metadata
      ? mediaFingerprint(metadata.fileName, metadata.fileSize, metadata.duration)
      : "";

    if (!this.mediaKey) {
      this.emitChange();
      return;
    }

    this.annotations = await this.store.listAnnotations(this.mediaKey);
    this.emitChange();
  }

  getAll(): Annotation[] {
    return [...this.annotations];
  }

  getBookmarks(): Annotation[] {
    return this.annotations.filter((a) => a.kind === "bookmark");
  }

  getNotes(): Annotation[] {
    return this.annotations.filter((a) => a.kind === "note");
  }

  hasMedia(): boolean {
    return this.mediaKey !== "";
  }

  async add(kind: AnnotationKind, time: number, text = ""): Promise<Annotation | null> {
    if (!this.mediaKey) return null;

    idCounter += 1;
    const annotation: Annotation = {
      id: `${this.mediaKey}:${Date.now().toString(36)}-${idCounter}`,
      mediaKey: this.mediaKey,
      kind,
      time: Math.max(0, Math.round(time * 10) / 10),
      text: text.trim().slice(0, 500),
      createdAt: Date.now(),
    };

    this.annotations = [...this.annotations, annotation].sort((a, b) => a.time - b.time);
    this.emitChange();
    await this.store.putAnnotation(annotation);
    return annotation;
  }

  async remove(id: string): Promise<void> {
    this.annotations = this.annotations.filter((a) => a.id !== id);
    this.emitChange();
    await this.store.deleteAnnotation(id);
  }

  /**
   * Called on each timeupdate. Emits a note event when playback passes a note's
   * timestamp going forward, so the UI can surface it once.
   */
  checkCrossings(currentTime: number, playing: boolean): void {
    if (!playing) {
      this.lastCrossedTime = currentTime;
      return;
    }

    const from = this.lastCrossedTime;
    const to = currentTime;
    // A backwards jump (rewind) resets the window without firing.
    if (to < from) {
      this.lastCrossedTime = to;
      return;
    }

    for (const annotation of this.annotations) {
      if (annotation.kind !== "note") continue;
      if (annotation.time > from && annotation.time <= to) {
        for (const listener of this.crossedListeners) listener(annotation);
      }
    }

    this.lastCrossedTime = to;
  }

  /** Ensure a note at `time` does not re-fire immediately after jumping there. */
  resetCrossingCursor(time: number): void {
    this.lastCrossedTime = time;
  }

  onAnnotationsChange(listener: AnnotationChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onNoteCrossed(listener: NoteCrossedListener): () => void {
    this.crossedListeners.add(listener);
    return () => this.crossedListeners.delete(listener);
  }

  private emitChange(): void {
    const snapshot = this.getAll();
    for (const listener of this.changeListeners) listener(snapshot);
  }
}
