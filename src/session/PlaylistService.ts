/**
 * PlaylistService — a queue of local files played back-to-back.
 *
 * Roadmap 2.3. Deliberately narrow: it holds `File` handles chosen by the user
 * in this page session and an index. Nothing is persisted, and the queue dies
 * with the page, because a `File` handle cannot be revived later anyway.
 */

export interface PlaylistItem {
  /** Stable id for DOM keys; not persisted. */
  id: string;
  file: File;
}

export class PlaylistService {
  private items: PlaylistItem[] = [];
  private index = -1;
  private counter = 0;

  /** Replace the whole queue (multi-select or drop). */
  set(files: File[]): void {
    this.items = files.map((file) => ({ id: `q${(this.counter += 1)}`, file }));
    this.index = this.items.length > 0 ? 0 : -1;
  }

  /** Append files to the end of the queue. */
  append(files: File[]): void {
    for (const file of files) {
      this.items.push({ id: `q${(this.counter += 1)}`, file });
    }
    if (this.index < 0 && this.items.length > 0) this.index = 0;
  }

  all(): readonly PlaylistItem[] {
    return this.items;
  }

  size(): number {
    return this.items.length;
  }

  activeIndex(): number {
    return this.index;
  }

  active(): PlaylistItem | null {
    return this.items[this.index] ?? null;
  }

  hasNext(): boolean {
    return this.index >= 0 && this.index < this.items.length - 1;
  }

  /** Move to the next item and return it, or null at the end of the queue. */
  advance(): PlaylistItem | null {
    if (!this.hasNext()) return null;
    this.index += 1;
    return this.active();
  }

  /** Move to a specific item (clicking it in the queue). */
  select(id: string): PlaylistItem | null {
    const next = this.items.findIndex((item) => item.id === id);
    if (next < 0) return null;
    this.index = next;
    return this.active();
  }

  remove(id: string): void {
    const at = this.items.findIndex((item) => item.id === id);
    if (at < 0) return;
    this.items.splice(at, 1);
    if (this.items.length === 0) {
      this.index = -1;
    } else if (at < this.index) {
      this.index -= 1;
    } else if (this.index >= this.items.length) {
      this.index = this.items.length - 1;
    }
  }

  clear(): void {
    this.items = [];
    this.index = -1;
  }
}
