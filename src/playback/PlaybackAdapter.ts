/**
 * Engine-agnostic playback contract.
 *
 * The UI, SessionManager and anti-skip logic talk only to this interface, so a
 * different engine (e.g. a future WebAssembly demuxer/decoder) can be swapped
 * in behind it without touching session or UI code.
 */

import type {
  MediaMetadata,
  PlaybackEngineId,
  PlaybackEventMap,
  PlaybackEventName,
  PlaybackStatus,
} from "../types/media";

export type PlaybackListener<K extends PlaybackEventName> = (
  payload: PlaybackEventMap[K],
) => void;

export interface PlaybackAdapter {
  readonly id: PlaybackEngineId;

  /** Load a local file. Never uploads; implementations read bytes locally. */
  load(file: File): Promise<MediaMetadata>;

  play(): Promise<void>;
  pause(): void;
  seek(timeSeconds: number): void;

  getCurrentTime(): number;
  getDuration(): number;
  getStatus(): PlaybackStatus;

  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;

  setVolume(volume: number): void;
  getVolume(): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;

  /**
   * Optional caption toggle for engines that draw their own captions.
   *
   * The native `<video>` path leaves this undefined and uses
   * `SubtitleService` + a `<track>` instead; YouTube implements it because its
   * captions live inside the cross-origin iframe and cannot be styled or
   * tracked by us. Engines may apply it best-effort.
   */
  setCaptionsEnabled?(enabled: boolean): void;
  areCaptionsEnabled?(): boolean;

  /** True when the adapter can render (e.g. wasm engine ready). */
  isReady(): boolean;

  on<K extends PlaybackEventName>(event: K, listener: PlaybackListener<K>): () => void;

  /** Release object URLs, listeners and engine resources. */
  dispose(): void;
}

/**
 * Tiny typed emitter shared by adapters. Keeps listener bookkeeping in one
 * place so UI code cannot accidentally double-register handlers.
 */
export class PlaybackEventEmitter {
  private listeners = new Map<PlaybackEventName, Set<(payload: never) => void>>();

  on<K extends PlaybackEventName>(
    event: K,
    listener: PlaybackListener<K>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);
    return () => this.off(event, listener);
  }

  off<K extends PlaybackEventName>(event: K, listener: PlaybackListener<K>): void {
    this.listeners.get(event)?.delete(listener as (payload: never) => void);
  }

  emit<K extends PlaybackEventName>(event: K, payload: PlaybackEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as PlaybackListener<K>)(payload);
      } catch (error) {
        console.error(`[playback] listener for "${event}" threw`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
