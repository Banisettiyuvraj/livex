/**
 * Local metadata persistence (IndexedDB).
 *
 * PRIVACY BOUNDARY — read this before adding fields:
 *   ✅ Allowed: file name, size, duration, timestamps, watch positions, note text.
 *   ❌ Forbidden: video/audio bytes, decoded frames, thumbnails from the file,
 *      or anything that could reconstruct the media.
 *
 * LiveX's promise is that videos never leave the device and are never stored by
 * the app. This store keeps *notes about* a video, which is a different thing.
 * Everything here is local to the browser profile and never transmitted.
 *
 * The whole module fails soft: if IndexedDB is unavailable (private mode, quota,
 * disabled storage) every operation resolves to an empty/no-op result so the
 * app keeps working as a pure player.
 */

const DB_NAME = "livex";
const DB_VERSION = 1;

export const STORE_HISTORY = "history";
export const STORE_ANNOTATIONS = "annotations";

/** A past session, keyed by a stable hash of the file identity. */
export interface HistoryEntry {
  /** Stable identity: name + size + duration (see {@link mediaFingerprint}). */
  key: string;
  fileName: string;
  fileSize: number;
  duration: number;
  /** Furthest legitimately watched position, in seconds. */
  furthestTime: number;
  /** Last playback position, in seconds. */
  lastTime: number;
  /** Whether the user ever reached the end. */
  completed: boolean;
  /** First time this file was opened (epoch ms). */
  firstOpenedAt: number;
  /** Most recent time this file was opened (epoch ms). */
  lastOpenedAt: number;
  /** Total seconds actually watched across sessions. */
  watchedSeconds: number;
}

export type AnnotationKind = "bookmark" | "note";

export interface Annotation {
  /** `<mediaKey>:<id>` — unique per record. */
  id: string;
  mediaKey: string;
  kind: AnnotationKind;
  /** Position in the media, in seconds. */
  time: number;
  /** Empty string for plain bookmarks. */
  text: string;
  createdAt: number;
}

/**
 * Stable identity for a local file.
 *
 * The `File` object cannot be re-selected by identity across sessions, so we
 * hash the properties a user will not accidentally change: name, byte size and
 * duration (rounded to 0.1s to absorb container rounding).
 */
export function mediaFingerprint(name: string, size: number, duration: number): string {
  const rounded = Number.isFinite(duration) ? Math.round(duration * 10) / 10 : 0;
  return `${name}::${size}::${rounded}`;
}

export class LocalMetadataStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private unavailableReason: string | null = null;

  /** True when persistence is usable; the UI uses this to hide affordances. */
  isAvailable(): boolean {
    return this.unavailableReason === null;
  }

  getUnavailableReason(): string | null {
    return this.unavailableReason;
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === "undefined") {
        this.unavailableReason = "This browser has no IndexedDB support.";
        resolve(null);
        return;
      }

      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        this.unavailableReason = "Local storage is blocked in this browser mode.";
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const store = db.createObjectStore(STORE_HISTORY, { keyPath: "key" });
          store.createIndex("lastOpenedAt", "lastOpenedAt");
        }
        if (!db.objectStoreNames.contains(STORE_ANNOTATIONS)) {
          const store = db.createObjectStore(STORE_ANNOTATIONS, { keyPath: "id" });
          store.createIndex("mediaKey", "mediaKey");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.unavailableReason = "Local storage could not be opened.";
        resolve(null);
      };
      request.onblocked = () => {
        this.unavailableReason = "Local storage is blocked by another tab.";
        resolve(null);
      };
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | null,
  ): Promise<T | null> {
    const db = await this.open();
    if (!db) return null;

    return new Promise<T | null>((resolve) => {
      let request: IDBRequest<T> | null = null;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, mode);
        request = run(tx.objectStore(storeName));
      } catch {
        resolve(null);
        return;
      }

      if (!request) {
        tx.oncomplete = () => resolve(null);
        return;
      }

      request.onsuccess = () => resolve(request!.result);
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  }

  /* ---------------------------------------------------------------- */
  /* History                                                          */
  /* ---------------------------------------------------------------- */

  async getHistory(key: string): Promise<HistoryEntry | null> {
    const entry = await this.withStore<HistoryEntry>(STORE_HISTORY, "readonly", (store) =>
      store.get(key),
    );
    return entry ?? null;
  }

  async putHistory(entry: HistoryEntry): Promise<void> {
    await this.withStore(STORE_HISTORY, "readwrite", (store) => store.put(entry));
  }

  /** Most recently opened files first. */
  async listRecent(limit = 5): Promise<HistoryEntry[]> {
    const all = await this.withStore<HistoryEntry[]>(STORE_HISTORY, "readonly", (store) =>
      store.getAll() as IDBRequest<HistoryEntry[]>,
    );
    if (!all) return [];
    return all
      .slice()
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, limit);
  }

  async clearHistory(): Promise<void> {
    await this.withStore(STORE_HISTORY, "readwrite", (store) => store.clear());
  }

  /* ---------------------------------------------------------------- */
  /* Annotations                                                      */
  /* ---------------------------------------------------------------- */

  async listAnnotations(mediaKey: string): Promise<Annotation[]> {
    const db = await this.open();
    if (!db) return [];

    const rows = await new Promise<Annotation[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_ANNOTATIONS, "readonly");
        const index = tx.objectStore(STORE_ANNOTATIONS).index("mediaKey");
        const request = index.getAll(mediaKey) as IDBRequest<Annotation[]>;
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });

    return rows.sort((a, b) => a.time - b.time);
  }

  async putAnnotation(annotation: Annotation): Promise<void> {
    await this.withStore(STORE_ANNOTATIONS, "readwrite", (store) => store.put(annotation));
  }

  /** Every stored annotation, across all media. Used to de-duplicate imports. */
  async listAllAnnotations(): Promise<Annotation[]> {
    const all = await this.withStore<Annotation[]>(STORE_ANNOTATIONS, "readonly", (store) =>
      store.getAll() as IDBRequest<Annotation[]>,
    );
    return all ?? [];
  }

  /** Restore a batch in one transaction. */
  async putAnnotations(annotations: readonly Annotation[]): Promise<void> {
    if (annotations.length === 0) return;
    const db = await this.open();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_ANNOTATIONS, "readwrite");
        const store = tx.objectStore(STORE_ANNOTATIONS);
        for (const annotation of annotations) store.put(annotation);
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async deleteAnnotation(id: string): Promise<void> {
    await this.withStore(STORE_ANNOTATIONS, "readwrite", (store) => store.delete(id));
  }

  async clearAnnotations(mediaKey: string): Promise<void> {
    const db = await this.open();
    if (!db) return;
    const existing = await this.listAnnotations(mediaKey);
    for (const annotation of existing) await this.deleteAnnotation(annotation.id);
  }

  /** Wipe everything this app stored. Used by the About dialog. */
  async clearAll(): Promise<void> {
    await this.clearHistory();
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_ANNOTATIONS, "readwrite");
        tx.objectStore(STORE_ANNOTATIONS).clear();
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
