/**
 * YouTube playback adapter — the same `PlaybackAdapter` contract as the native
 * `<video>` engine, implemented on top of Google's IFrame Player API.
 *
 * This is LiveX's first online engine, so the differences from
 * `BrowserVideoAdapter` are stated plainly rather than hidden:
 *
 *   - The video stays on YouTube's servers. Requests go to Google; the app is
 *     no longer offline in this mode. The consent notice in the UI says so.
 *   - Seeking is a *request* to a cross-origin iframe. When YouTube's own
 *     controls are visible the user can always scrub in them, so the anti-skip
 *     ceiling is advisory here, exactly as documented in
 *     `docs/YOUTUBE-MODE-PLAN.md`. It is never described as enforcement.
 *   - `setPlaybackRate` is best-effort: YouTube decides which rates a given
 *     video supports.
 *
 * Failure is graceful. If the IFrame API cannot load (offline, blocked,
 * hostile network) `loadVideo()` rejects with a normalised `PlaybackError`
 * instead of leaving a blank frame, and `dispose()` removes the injected
 * `<script>` so nothing is left behind.
 */

import type {
  MediaMetadata,
  PlaybackEngineId,
  PlaybackEventName,
  PlaybackStatus,
} from "../types/media";
import { PlaybackError } from "./PlaybackErrors";
import {
  PlaybackEventEmitter,
  type PlaybackAdapter,
  type PlaybackListener,
} from "./PlaybackAdapter";
import {
  parseYouTubeUrl,
  type YouTubeSource,
} from "../files/YouTubeSource";

/* ------------------------------------------------------------------ */
/* Minimal typings for the bits of the YT namespace we use             */
/* ------------------------------------------------------------------ */

interface YTPlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  /** Used to rebuild the player at a position after a transient failure. */
  loadVideoById?(options: { videoId: string; startSeconds?: number }): void;
  getVideoData?(): { title?: string; video_id?: string };
  destroy(): void;
}

interface YTPlayerEvent {
  target: YTPlayerLike;
  data?: number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      width?: string | number;
      height?: string | number;
      /** Embed host, e.g. the cookie-reduced youtube-nocookie.com origin. */
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: YTPlayerEvent) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
        onError?: (event: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayerLike;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* ------------------------------------------------------------------ */
/* Script loading                                                      */
/* ------------------------------------------------------------------ */

const API_SRC = "https://www.youtube.com/iframe_api";
/** How long we wait for the IFrame API before giving up honestly. */
const API_TIMEOUT_MS = 12_000;
/** Position poll interval — the API has no fine-grained time event. */
const POLL_MS = 500;
/**
 * How long to wait for `onReady` before probing whether the player is simply
 * slow. That notification is a postMessage round-trip and can be late even when
 * the player is running fine, so this is a probe point, not a verdict.
 */
const READY_TIMEOUT_MS = 12_000;
/** Embed hosts tried in order. Fallback exists because nocookie sometimes stalls. */
const EMBED_HOSTS = ["https://www.youtube-nocookie.com", "https://www.youtube.com"];
/** Transient mid-playback failures we try to ride out before giving up. */
const MAX_RECOVERIES = 2;
/** Within this many seconds of the end, do not bother resuming. */
const RESUME_EPSILON = 3;

/** One shared load of the API per page, not one per player. */
let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("YouTube playback needs a browser document."));
      return;
    }

    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const timer = window.setTimeout(() => {
      reject(new Error("Timed out waiting for the YouTube player script."));
    }, API_TIMEOUT_MS);

    // The API calls this global once the script has finished loading. Chain any
    // existing handler rather than clobbering it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      const yt = window.YT;
      if (!yt?.Player) {
        window.clearTimeout(timer);
        reject(new Error("The YouTube player script loaded without the player API."));
        return;
      }
      window.clearTimeout(timer);
      resolve(yt);
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    if (existing) return; // it is already loading; the global will still fire

    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.dataset.livex = "youtube-api";
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("The YouTube player script could not be loaded."));
    };
    document.head.appendChild(script);
  });

  // A failed load must not poison every later attempt.
  apiPromise.catch(() => {
    apiPromise = null;
  });

  return apiPromise;
}

/** Remove the injected script once nobody is using it. */
function removeApiScript(): void {
  document
    .querySelectorAll('script[data-livex="youtube-api"]')
    .forEach((node) => node.remove());
}

let playerSequence = 0;

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class YouTubeAdapter implements PlaybackAdapter {
  readonly id: PlaybackEngineId = "youtube";

  private readonly container: HTMLElement;
  private readonly emitter = new PlaybackEventEmitter();

  private player: YTPlayerLike | null = null;
  private yt: YTNamespace | null = null;
  private source: YouTubeSource | null = null;
  private metadata: MediaMetadata | null = null;

  private status: PlaybackStatus = "empty";
  private playbackRate = 1;
  private lastTime = 0;
  private volume = 1;
  private muted = false;

  private poll: number | null = null;
  private disposed = false;
  /** Our "live" surface over the iframe. */
  private overlay: HTMLElement | null = null;
  /** Transient failures ridden out since this video was loaded. */
  private recoveries = 0;
  /** Set when the player reports an error before playback ever began. */
  private preReadyErrorCode: number | null = null;
  /**
   * Incremented for every `loadVideo()`. A handshake can take many seconds, and
   * a second paste during that window must cancel the first attempt instead of
   * racing it for `this.player` (the stale attempt could otherwise win the
   * assignment and leave a detached, silent player attached to the session).
   */
  private loadToken = 0;
  /** Rejects an in-flight player creation so it stops touching the DOM. */
  private cancelPendingCreate: (() => void) | null = null;

  /**
   * This engine does not start on its own: `SessionManager` must not auto-play
   * it, or the "live" session would begin partway through.
   */
  readonly autoplaysOnLoad = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /* ---------------------------------------------------------------- */
  /* Loading                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Load a YouTube video by URL or bare id.
   *
   * Resolves once the player is ready and playback has been requested — the
   * caller's paste/click is the user gesture that makes autoplay legal.
   */
  async loadVideo(input: string): Promise<MediaMetadata> {
    this.assertNotDisposed();
    const token = ++this.loadToken;
    // A previous handshake may still be running; cancel it before touching the
    // container so it cannot resolve later and overwrite this load.
    this.cancelPendingCreate?.();
    if (this.player) this.teardownPlayer();

    const parsed = parseYouTubeUrl(input);
    if (!parsed.ok) {
      throw new PlaybackError({
        code: "unsupported-format",
        message: parsed.reason,
        hint: "Paste a link like https://www.youtube.com/watch?v=… or https://youtu.be/…",
      });
    }
    if (parsed.source.kind === "playlist") {
      throw new PlaybackError({
        code: "unsupported-format",
        message: "That link points at a playlist, not a single video.",
        hint: "Open the video you want and copy its own link.",
      });
    }

    this.source = parsed.source;
    this.status = "loading";
    this.recoveries = 0;

    // The IFrame API drops the `origin` parameter when the page has no http(s)
    // origin (`file://`), and YouTube then refuses to talk to the player. Say so
    // rather than showing a player that never responds.
    const origin = window.location.origin;
    if (!origin.startsWith("http")) {
      this.status = "error";
      const failure = new PlaybackError({
        code: "invalid-state",
        message: "YouTube links need the app to be served over http(s).",
        hint: "Open LiveX from a web address or a local server; local files still work from file://.",
      });
      this.emitter.emit("error", failure.toDetails());
      throw failure;
    }

    let yt: YTNamespace;
    try {
      yt = await loadYouTubeApi();
    } catch (error) {
      this.status = "error";
      const failure = new PlaybackError({
        code: "network-failed",
        message: "YouTube could not be reached.",
        hint:
          "LiveX needs a connection for YouTube links. Local files still play fully offline.",
        cause: error,
      });
      this.emitter.emit("error", failure.toDetails());
      throw failure;
    }

    if (this.disposed) throw this.disposedError();
    if (token !== this.loadToken) throw this.supersededError();
    this.yt = yt;

    const host = document.createElement("div");
    host.className = "livex-yt-host";
    host.id = `livex-yt-${(playerSequence += 1)}`;

    // The API *replaces* this element with its own <iframe>, so it must not
    // already be an iframe — `buildEmbedUrl` documents the URL the API builds
    // from these same parameters (and is unit-tested for exactly that).
    const frame = document.createElement("div");
    frame.className = "livex-yt-frame";
    frame.id = `${host.id}-frame`;
    frame.setAttribute("title", "YouTube video player");
    host.appendChild(frame);

    // Our own "live" surface. It sits over the iframe, so there is no timeline
    // to grab and nothing to click through to YouTube: this is what makes the
    // session behave like live rather than like a video file.
    const overlay = document.createElement("div");
    overlay.className = "livex-yt-overlay";
    overlay.id = `${host.id}-overlay`;
    overlay.innerHTML =
      '<div class="livex-yt-live">' +
      '<span class="livex-yt-dot"></span><span>LIVE</span>' +
      "</div>" +
      '<div class="livex-yt-hint">Simulated live · no skipping</div>';
    host.appendChild(overlay);
    this.overlay = overlay;

    this.container.replaceChildren(host);

    let player: YTPlayerLike;
    try {
      player = await this.createWithRetry(yt, frame.id, token);
    } catch (error) {
      // A superseded or disposed load must not report anything: the newer load
      // (or the engine swap) owns the screen now.
      if (this.disposed || token !== this.loadToken) throw error;
      this.status = "error";
      // Preserve the player's own diagnosis. A pre-playback error code means
      // the video itself is the problem (unembeddable, removed), and reporting
      // a generic "did not start" hides the actionable reason.
      const failure =
        this.preReadyErrorCode !== null
          ? this.describeError(this.preReadyErrorCode)
          : error instanceof PlaybackError
            ? error
            : new PlaybackError({
                code: "unsupported-format",
                message: "The YouTube player did not start.",
                hint: "Check that the link is a public, embeddable video.",
                cause: error,
              });
      // Guarantee silence before showing the failure: a failed handshake can
      // still leave YouTube's own wrapper elements behind the error screen.
      this.teardownPlayer();
      this.status = "error";
      this.emitter.emit("error", failure.toDetails());
      throw failure;
    }

    if (this.disposed || token !== this.loadToken) {
      // Disposed or superseded while the player was coming up: do not adopt it.
      try {
        player.destroy();
      } catch {
        // best-effort; the container has already moved on
      }
      throw this.supersededError();
    }
    this.player = player;

    const duration = this.player.getDuration();
    const title = this.readTitle();
    this.metadata = {
      fileName: title,
      fileSize: 0, // nothing is downloaded, so there is no local size
      mimeType: "video/youtube",
      extension: "youtube",
      duration: Number.isFinite(duration) && duration > 0 ? duration : NaN,
      // YouTube owns letterboxing; the host fills the slot.
      videoWidth: this.container.clientWidth || 0,
      videoHeight: this.container.clientHeight || 0,
    };

    this.status = "ready";
    this.emitter.emit("loaded", { duration: this.getDuration(), metadata: this.metadata });

    // Deliberately NOT started here. The session goes `ready`, the ready screen
    // offers "Start Live Session", and playback begins on that click — so the
    // LIVE session always starts at 0:00 instead of however long the player sat
    // waiting. `SessionManager` skips its own auto-play for this adapter.
    return this.metadata;
  }

  /**
   * Build the player, retrying the other embed host only when an attempt never
   * came to life at all.
   *
   * Critically, a missing `onReady` is not proof of failure. `onReady` is just a
   * notification; the player object itself answers `getPlayerState()` as soon as
   * the postMessage channel is up. Treating a late notification as a dead player
   * is what killed a *working* embed — audio kept playing underneath the error
   * screen. So a silent-but-alive player is adopted, and only a completely mute
   * one is retried.
   */
  private async createWithRetry(
    yt: YTNamespace,
    frameId: string,
    token: number,
  ): Promise<YTPlayerLike> {
    let lastError: unknown = null;

    for (const host of EMBED_HOSTS) {
      if (this.disposed || token !== this.loadToken) break;
      let adopted = false;
      try {
        const player = await this.createPlayer(yt, frameId, host, token, () => {
          adopted = true;
        });
        if (token === this.loadToken && !this.player) this.player = player;
        return player;
      } catch (error) {
        lastError = error;
        // Disposed or superseded: the newer load owns the container now. Do
        // not silence or rebuild anything it may already be using.
        if (this.disposed || token !== this.loadToken) break;
        // A late `onReady` may still arrive for the attempt we just gave up on.
        // Adopting it beats tearing down a player that is actually running.
        if (adopted) break;
        // A definite startup error (unembeddable, removed video) is settled
        // fact — another host will report exactly the same thing.
        if (this.preReadyErrorCode !== null) break;

        // Silence the failed attempt before rebuilding: leaving a live iframe
        // behind is how video kept playing under an error screen.
        this.stopAudio();
        this.resetFrame(frameId);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("The YouTube player did not become ready on any embed host.");
  }

  /**
   * Is the player object actually responding? Called only after `onReady` has
   * failed to arrive, to decide between "slow" and "dead".
   */
  private async isPlayerAlive(player: YTPlayerLike): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const state = player.getPlayerState();
        if (typeof state === "number" && Number.isFinite(state)) return true;
      } catch {
        // not answering yet
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    return false;
  }

  /** Forcefully silence and detach whatever the previous attempt left behind. */
  private stopAudio(): void {
    try {
      this.player?.destroy();
    } catch {
      // A half-built player can throw; the DOM removal below still applies.
    }
    this.player = null;
    for (const node of this.container.querySelectorAll("iframe")) node.remove();
  }

  /**
   * Recreate the empty target element the API replaces with its iframe.
   *
   * `replaceChildren` is deliberate: the API nests its iframe inside wrapper
   * divs it creates, so clearing only the node we passed would leave the real
   * player in the DOM — still decoding, still audible.
   */
  private resetFrame(frameId: string): void {
    const stale = document.getElementById(frameId);
    const host = document.getElementById(frameId.replace(/-frame$/, ""));
    if (!host) {
      stale?.remove();
      return;
    }
    const frame = document.createElement("div");
    frame.className = "livex-yt-frame";
    frame.id = frameId;
    frame.setAttribute("title", "YouTube video player");
    // Anything else in the host (an iframe, its wrappers) is a dead player.
    host.replaceChildren(frame);
  }

  private createPlayer(
    yt: YTNamespace,
    frameId: string,
    host: string,
    token: number,
    onAdopted: () => void,
  ): Promise<YTPlayerLike> {
    return new Promise<YTPlayerLike>((resolve, reject) => {
      let ready = false;
      let settled = false;
      let player: YTPlayerLike | null = null;
      this.preReadyErrorCode = null;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.cancelPendingCreate === cancel) this.cancelPendingCreate = null;
        fn();
      };

      // `loadVideo()` calls this when a newer load or a dispose supersedes us.
      // Settling here frees the timer immediately instead of leaving it to
      // fire against a container that now belongs to a different player.
      const cancel = (): void => {
        settle(() => reject(new Error("The YouTube player load was superseded.")));
      };
      this.cancelPendingCreate = cancel;

      const adopt = (): void => {
        ready = true;
        onAdopted();
        settle(() => resolve(player as YTPlayerLike));
      };

      const timer = window.setTimeout(() => {
        void (async () => {
          // No notification — but is the player actually there?
          if (player && (await this.isPlayerAlive(player))) {
            // Adopt it. It is running; refusing it would only break playback.
            adopt();
            return;
          }
          if (this.disposed || token !== this.loadToken) {
            settle(() => reject(new Error("The YouTube player load was superseded.")));
            return;
          }
          settle(() => reject(new Error(`The YouTube player never started on ${host}.`)));
        })();
      }, READY_TIMEOUT_MS);

      // The API replaces this element with its own iframe; the URL is built from
      // these parameters and validated against `buildEmbedUrl()` in unit tests.
      player = new yt.Player(frameId, {
        width: "100%",
        height: "100%",
        videoId: this.source?.videoId,
        host,
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          // No related-video wall: the point is a live session, not a feed.
          rel: 0,
          // Hidden controls remove the scrubber and the end-screen clutter.
          // Playback is driven by our own chrome through the JS API.
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          autoplay: 0,
          start: this.source?.startAt ?? 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            adopt();
          },
          onStateChange: (event) => this.handleStateChange(event.data ?? -1),
          onError: (event) => {
            const code = event.data ?? 0;
            if (!ready) {
              // Before any playback, an error code is definitive (the video
              // cannot be embedded). Record it, then let the promise settle so
              // the caller reports the real reason instead of a timeout.
              this.preReadyErrorCode = code;
              settle(() => reject(new Error(`Player error ${code} during startup.`)));
              return;
            }
            this.handlePlayerError(code);
          },
        },
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* YT event mapping                                                 */
  /* ---------------------------------------------------------------- */

  private handleStateChange(state: number): void {
    if (this.disposed) return;
    const yt = this.yt;
    if (!yt) return;

    if (state === yt.PlayerState.PLAYING) {
      this.status = "playing";
      this.startPolling();
      this.syncOverlay();
      this.emitter.emit("play", { time: this.getCurrentTime() });
      return;
    }

    if (state === yt.PlayerState.PAUSED) {
      this.status = "paused";
      this.stopPolling();
      this.syncOverlay();
      // As with the native element, `pause` precedes `ended`; SessionManager
      // already defers and re-checks its ended flag before treating a pause as
      // a user action.
      this.emitter.emit("pause", { time: this.getCurrentTime() });
      return;
    }

    if (state === yt.PlayerState.BUFFERING) {
      this.status = "buffering";
      this.startPolling();
      return;
    }

    if (state === yt.PlayerState.ENDED) {
      this.status = "ended";
      this.stopPolling();
      const time = this.getDuration() || this.getCurrentTime();
      this.lastTime = time;
      this.emitter.emit("ended", { time });
      return;
    }

    // UNSTARTED / CUED — ready but not playing.
    if (this.status === "loading" || this.status === "empty") this.status = "ready";
  }

  private handlePlayerError(code: number): void {
    if (this.disposed) return;

    // Mid-playback failures are usually transient (a stalled segment, an ad
    // that could not load, a dropped connection). Reload the same video at the
    // position we reached rather than dropping the user out of the session.
    if (this.recoveries < MAX_RECOVERIES && this.source) {
      const resumeAt = this.getCurrentTime();
      const duration = this.getDuration();
      if (duration > 0 && resumeAt < duration - RESUME_EPSILON && this.player?.loadVideoById) {
        this.recoveries += 1;
        this.status = "buffering";
        try {
          this.player.loadVideoById({ videoId: this.source.videoId, startSeconds: resumeAt });
          this.lastTime = resumeAt;
          // Anti-skip ceiling follows us back to where we were.
          this.emitter.emit("seek", { from: resumeAt, to: resumeAt });
          return;
        } catch {
          // fall through to reporting the failure
        }
      }
    }

    this.status = "error";
    this.stopPolling();
    // Prefer the code the player actually gave us over a generic "it did not
    // start", so the message names the real cause.
    this.emitter.emit(
      "error",
      this.describeError(this.preReadyErrorCode ?? code).toDetails(),
    );
  }

  /** Reflect the paused/playing state on the live surface. */
  private syncOverlay(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const playing = this.status === "playing" || this.status === "buffering";
    overlay.classList.toggle("livex-yt-overlay--active", playing);
    const hint = overlay.querySelector<HTMLElement>(".livex-yt-hint");
    if (hint) {
      hint.textContent = playing
        ? "Simulated live · no skipping"
        : this.status === "paused"
          ? "Paused"
          : "Ready to go live";
    }
  }

  private describeError(code: number): PlaybackError {
    const shared = { hint: "See the video's availability on YouTube." };
    switch (code) {
      case 2:
        return new PlaybackError({
          code: "unsupported-format",
          message: "That YouTube link is not valid.",
          ...shared,
        });
      case 5:
        return new PlaybackError({
          code: "decode-failed",
          message: "This video cannot play in the embedded YouTube player.",
          hint: "The video's owner has not allowed embedding.",
        });
      case 100:
        return new PlaybackError({
          code: "unsupported-format",
          message: "This video is unavailable or private.",
          ...shared,
        });
      case 101:
      case 150:
        return new PlaybackError({
          code: "unsupported-format",
          message: "The owner does not allow this video to be embedded.",
          hint: "Open it on YouTube instead.",
        });
      default:
        return new PlaybackError({
          code: "unknown",
          message: "The YouTube player reported a problem.",
          hint: `Player error code ${code}.`,
        });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Position polling                                                 */
  /* ---------------------------------------------------------------- */

  private startPolling(): void {
    if (this.poll !== null || this.disposed) return;
    this.poll = window.setInterval(() => {
      if (this.disposed || !this.player) return;
      const time = this.getCurrentTime();
      if (Math.abs(time - this.lastTime) < 0.05) return;
      this.lastTime = time;
      this.emitter.emit("timeupdate", { time, duration: this.getDuration() });
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll === null) return;
    window.clearInterval(this.poll);
    this.poll = null;
  }

  /* ---------------------------------------------------------------- */
  /* Transport                                                        */
  /* ---------------------------------------------------------------- */

  async play(): Promise<void> {
    this.assertNotDisposed();
    if (!this.player) throw this.noVideoError();
    this.player.playVideo();
    this.startPolling();
  }

  pause(): void {
    this.assertNotDisposed();
    this.player?.pauseVideo();
  }

  /**
   * Seeking is only ever driven by our own chrome (the gone-transport), and
   * every call is reported as a seek event so `SessionManager.enforceAntiSkip`
   * can clamp anything past the furthest legitimately watched point — the same
   * rule the native engine gets.
   */
  seek(timeSeconds: number): void {
    if (!this.player || !Number.isFinite(timeSeconds)) return;
    const clamped = Math.max(0, timeSeconds);
    this.player.seekTo(clamped, true);
    this.lastTime = clamped;
    this.emitSeek(clamped);
  }

  private emitSeek(time: number): void {
    this.emitter.emit("seek", { from: this.lastTime, to: time });
  }

  getCurrentTime(): number {
    const value = this.player?.getCurrentTime();
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  getDuration(): number {
    const value = this.player?.getDuration();
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  }

  getStatus(): PlaybackStatus {
    return this.status;
  }

  setPlaybackRate(rate: number): void {
    if (!this.player) return;
    try {
      this.player.setPlaybackRate(rate);
    } catch {
      // Some videos reject rate changes; the 1x lock is best-effort here.
    }
    this.playbackRate = rate;
    this.emitter.emit("ratechange", { rate });
  }

  getPlaybackRate(): number {
    const value = this.player?.getPlaybackRate();
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : this.playbackRate;
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volume = clamped;
    // The iframe API takes 0-100.
    this.player?.setVolume(Math.round(clamped * 100));
    this.emitter.emit("volumechange", { volume: clamped, muted: this.muted });
  }

  getVolume(): number {
    const value = this.player?.getVolume();
    return typeof value === "number" && Number.isFinite(value) ? value / 100 : this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.player?.mute();
    else this.player?.unMute();
    this.emitter.emit("volumechange", { volume: this.volume, muted });
  }

  isMuted(): boolean {
    const value = this.player?.isMuted();
    return typeof value === "boolean" ? value : this.muted;
  }

  isReady(): boolean {
    return this.player !== null && !this.disposed;
  }

  /** MediaMetadata in the shape the rest of the app already understands. */
  getMetadata(): MediaMetadata | null {
    return this.metadata;
  }

  /**
   * No local file exists, so `load()` cannot work. Present for interface
   * compatibility and to fail with a clear message rather than silently.
   */
  async load(): Promise<MediaMetadata> {
    throw new PlaybackError({
      code: "invalid-state",
      message: "This player only accepts YouTube links.",
      hint: "Paste a YouTube URL, or open a local file with the local engine.",
    });
  }

  /** The player container, so the UI can place or hide it. */
  getElement(): HTMLElement {
    return this.container;
  }

  on<K extends PlaybackEventName>(event: K, listener: PlaybackListener<K>): () => void {
    return this.emitter.on(event, listener);
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                         */
  /* ---------------------------------------------------------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPolling();
    this.teardownPlayer();
    this.emitter.clear();
    this.emitter.emit("disposed", {});
    // Only reclaim the injected script when no other YouTube player remains.
    if (document.querySelectorAll(".livex-yt-host").length === 0) removeApiScript();
  }

  /** Destroy the player and empty the slot without marking ourselves disposed. */
  private teardownPlayer(): void {
    this.stopPolling();
    // Reject any handshake still in flight, so its timer cannot resolve later
    // and attach a player to a slot that has already been emptied.
    this.cancelPendingCreate?.();
    // `destroy()` is a postMessage round-trip and can be a no-op if the player
    // is mid-initialisation, so the iframe removal is what actually guarantees
    // no audio survives a teardown.
    this.stopAudio();
    this.overlay = null;
    this.status = "empty";
    this.preReadyErrorCode = null;
    this.container.replaceChildren();
  }

  private readTitle(): string {
    const data = this.player?.getVideoData?.();
    const title = data?.title?.trim();
    if (title) return title;
    return this.source ? `YouTube · ${this.source.videoId}` : "YouTube video";
  }

  private noVideoError(): PlaybackError {
    return new PlaybackError({
      code: "no-file",
      message: "No YouTube video is loaded.",
      hint: "Paste a YouTube link to begin.",
    });
  }

  /** Thrown when a newer paste (or a dispose) replaced an in-flight load. */
  private supersededError(): PlaybackError {
    return new PlaybackError({
      code: "aborted",
      message: "The YouTube player load was superseded.",
    });
  }

  private disposedError(): PlaybackError {
    return new PlaybackError({
      code: "invalid-state",
      message: "The player has already been disposed.",
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw this.disposedError();
  }
}
