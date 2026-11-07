/**
 * Placeholder for an optional WebAssembly media engine (FFmpeg.wasm,
 * libVLC-wasm, …).
 *
 * Status: NOT INTEGRATED. See docs/FEASIBILITY-WASM.md for the spike results
 * and the go/no-go decision. The plan requires a feasibility spike to pass
 * before a multi-megabyte engine ships, so this adapter exists to:
 *
 *   1. prove the UI/session layer can be driven by a non-native engine without
 *      changes (the abstraction is real, not aspirational), and
 *   2. fail closed with a clear, honest message instead of pretending to
 *      support codecs the browser cannot decode.
 *
 * To integrate a candidate engine later, implement `PlaybackAdapter` here
 * (load / play / pause / seek / events) and register it in
 * `PlaybackController` behind a feature flag. Nothing outside this file should
 * need to change.
 */

import type {
  MediaMetadata,
  PlaybackEngineId,
  PlaybackEventMap,
  PlaybackEventName,
  PlaybackStatus,
} from "../types/media";
import { PlaybackError } from "./PlaybackErrors";
import {
  PlaybackEventEmitter,
  type PlaybackAdapter,
  type PlaybackListener,
} from "./PlaybackAdapter";

export interface WasmEngineConfig {
  /** Display name used in messages and docs. */
  name: string;
  /** Why the engine is not active yet (surfaced to developers only). */
  unavailableReason: string;
}

export const DEFAULT_WASM_CONFIG: WasmEngineConfig = {
  name: "WebAssembly media engine",
  unavailableReason:
    "No WebAssembly media engine is bundled. Native browser playback is the supported engine.",
};

export class WasmMediaAdapter implements PlaybackAdapter {
  readonly id: PlaybackEngineId = "wasm";

  private readonly emitter = new PlaybackEventEmitter();
  private readonly config: WasmEngineConfig;
  private disposed = false;

  constructor(config: WasmEngineConfig = DEFAULT_WASM_CONFIG) {
    this.config = config;
  }

  load(_file: File): Promise<MediaMetadata> {
    return Promise.reject(this.unavailable());
  }

  play(): Promise<void> {
    return Promise.reject(this.unavailable());
  }

  pause(): void {
    /* no-op: nothing is decoding */
  }

  seek(_timeSeconds: number): void {
    /* no-op: nothing is decoding */
  }

  getCurrentTime(): number {
    return 0;
  }

  getDuration(): number {
    return 0;
  }

  getStatus(): PlaybackStatus {
    return "empty";
  }

  setPlaybackRate(_rate: number): void {
    /* no-op */
  }

  getPlaybackRate(): number {
    return 1;
  }

  setVolume(_volume: number): void {
    /* no-op */
  }

  getVolume(): number {
    return 1;
  }

  setMuted(_muted: boolean): void {
    /* no-op */
  }

  isMuted(): boolean {
    return false;
  }

  /** Always false: no engine binary is present in this build. */
  isReady(): boolean {
    return false;
  }

  on<K extends PlaybackEventName>(event: K, listener: PlaybackListener<K>): () => void {
    return this.emitter.on(event, listener);
  }

  dispose(): void {
    this.disposed = true;
    this.emitter.clear();
    this.emitter.emit("disposed", {} as PlaybackEventMap["disposed"]);
  }

  private unavailable(): PlaybackError {
    if (this.disposed) {
      return new PlaybackError({
        code: "invalid-state",
        message: "The playback engine has been disposed.",
      });
    }
    return new PlaybackError({
      code: "unsupported-codec",
      message: `${this.config.name} is not available in this build.`,
      hint: this.config.unavailableReason,
    });
  }
}
