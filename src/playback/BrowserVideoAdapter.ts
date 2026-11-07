/**
 * Native HTML5 `<video>` playback adapter.
 *
 * This is the baseline engine: it uses the browser's own demuxer/decoder, so it
 * is fast, memory-efficient and needs no extra download. It is also the
 * fallback whenever an optional engine is unavailable.
 *
 * Local-only guarantee: the file is exposed to the element through a
 * `blob:` object URL created from the user's File. No network request carries
 * the video bytes.
 */

import type {
  MediaMetadata,
  PlaybackEngineId,
  PlaybackEventMap,
  PlaybackEventName,
  PlaybackStatus,
} from "../types/media";
import { PlaybackError, fromMediaError } from "./PlaybackErrors";
import {
  PlaybackEventEmitter,
  type PlaybackAdapter,
  type PlaybackListener,
} from "./PlaybackAdapter";
import { extensionOf } from "../files/MediaProbe";

export class BrowserVideoAdapter implements PlaybackAdapter {
  readonly id: PlaybackEngineId = "native";

  private readonly video: HTMLVideoElement;
  private readonly emitter = new PlaybackEventEmitter();
  private readonly cleanups: Array<() => void> = [];

  private objectUrl: string | null = null;
  private metadata: MediaMetadata | null = null;
  private status: PlaybackStatus = "empty";
  private disposed = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.attachElementListeners();
  }

  /* ---------------------------------------------------------------- */
  /* Loading                                                          */
  /* ---------------------------------------------------------------- */

  async load(file: File): Promise<MediaMetadata> {
    this.assertNotDisposed();
    this.releaseObjectUrl();
    this.status = "loading";

    const url = URL.createObjectURL(file);
    this.objectUrl = url;

    this.video.src = url;
    this.video.load();

    const metadata = await this.waitForMetadata(file);
    this.metadata = metadata;
    this.status = "ready";
    this.emitter.emit("loaded", { duration: metadata.duration, metadata });
    return metadata;
  }

  private waitForMetadata(file: File): Promise<MediaMetadata> {
    return new Promise<MediaMetadata>((resolve, reject) => {
      const video = this.video;

      const cleanup = (): void => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        clearTimeout(timer);
      };

      const onLoaded = (): void => {
        cleanup();
        resolve({
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          extension: extensionOf(file.name),
          duration: Number.isFinite(video.duration) ? video.duration : NaN,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
      };

      const onError = (): void => {
        cleanup();
        reject(fromMediaError(video.error));
      };

      // Some containers never fire `loadedmetadata` (unsupported demuxer).
      const timer = window.setTimeout(() => {
        cleanup();
        reject(
          new PlaybackError({
            code: "unsupported-format",
            message: "This video could not be opened by your browser.",
            hint: "The container or codec is not supported natively. Try an MP4 (H.264) or WebM file.",
          }),
        );
      }, 12_000);

      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Transport                                                        */
  /* ---------------------------------------------------------------- */

  async play(): Promise<void> {
    this.assertNotDisposed();
    if (!this.objectUrl) {
      throw new PlaybackError({
        code: "no-file",
        message: "No video is loaded.",
        hint: "Select a video before starting a session.",
      });
    }
    try {
      await this.video.play();
      this.status = "playing";
    } catch (error) {
      // Autoplay rejection is not a media failure; surface it as-is so the
      // session layer can decide (LiveX always starts from a user gesture).
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new PlaybackError({
          code: "invalid-state",
          message: "The browser blocked playback.",
          hint: "Click Start Live Session again to allow playback.",
          cause: error,
        });
      }
      throw fromMediaError(this.video.error, undefined);
    }
  }

  pause(): void {
    this.assertNotDisposed();
    this.video.pause();
    this.status = "paused";
  }

  seek(timeSeconds: number): void {
    this.assertNotDisposed();
    if (!Number.isFinite(timeSeconds)) return;
    const clamped = Math.max(0, Math.min(timeSeconds, this.getDuration() || timeSeconds));
    this.video.currentTime = clamped;
  }

  getCurrentTime(): number {
    return this.video.currentTime;
  }

  getDuration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  getStatus(): PlaybackStatus {
    return this.status;
  }

  setPlaybackRate(rate: number): void {
    this.video.playbackRate = rate;
  }

  getPlaybackRate(): number {
    return this.video.playbackRate;
  }

  setVolume(volume: number): void {
    this.video.volume = Math.max(0, Math.min(1, volume));
  }

  getVolume(): number {
    return this.video.volume;
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  isMuted(): boolean {
    return this.video.muted;
  }

  isReady(): boolean {
    return this.objectUrl !== null && !this.disposed;
  }

  getMetadata(): MediaMetadata | null {
    return this.metadata;
  }

  /** The underlying element, for fullscreen/PiP wiring in the UI layer. */
  getElement(): HTMLVideoElement {
    return this.video;
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                           */
  /* ---------------------------------------------------------------- */

  on<K extends PlaybackEventName>(event: K, listener: PlaybackListener<K>): () => void {
    return this.emitter.on(event, listener);
  }

  private attachElementListeners(): void {
    const video = this.video;

    const add = <K extends keyof HTMLVideoElementEventMap>(
      type: K,
      handler: (event: HTMLVideoElementEventMap[K]) => void,
    ): void => {
      video.addEventListener(type, handler as EventListener);
      this.cleanups.push(() => video.removeEventListener(type, handler as EventListener));
    };

    add("play", () => {
      this.status = "playing";
      this.emitter.emit("play", { time: video.currentTime });
    });

    add("pause", () => {
      // `pause` also fires right before `ended`; keep status accurate.
      if (this.status !== "ended") this.status = "paused";
      this.emitter.emit("pause", { time: video.currentTime });
    });

    add("timeupdate", () => {
      this.emitter.emit("timeupdate", {
        time: video.currentTime,
        duration: this.getDuration(),
      });
    });

    add("seeking", () => {
      this.emitter.emit("seek", { from: video.currentTime, to: video.currentTime });
    });

    add("ratechange", () => {
      this.emitter.emit("ratechange", { rate: video.playbackRate });
    });

    add("volumechange", () => {
      this.emitter.emit("volumechange", {
        volume: video.volume,
        muted: video.muted,
      });
    });

    add("ended", () => {
      this.status = "ended";
      this.emitter.emit("ended", { time: video.currentTime });
    });

    add("error", () => {
      this.status = "error";
      this.emitter.emit("error", fromMediaError(video.error).toDetails());
    });
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                         */
  /* ---------------------------------------------------------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.emitter.clear();

    this.video.pause();
    this.releaseObjectUrl();
    this.video.removeAttribute("src");
    this.video.load();

    this.metadata = null;
    this.status = "empty";
    this.emitter.emit("disposed", {});
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new PlaybackError({
        code: "invalid-state",
        message: "The player has already been disposed.",
      });
    }
  }
}

export type { PlaybackEventMap };
