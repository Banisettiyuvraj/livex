/**
 * WorkspaceUI — binds the existing Stitch-exported DOM to the typed layers.
 *
 * Rules this file follows:
 *  - It never touches playback engine internals; everything goes through
 *    SessionManager / PlaybackAdapter.
 *  - Screen markup, classes and visual design are unchanged from the Stitch
 *    export. Existing IDs are reused as-is.
 *  - No file bytes are logged or sent anywhere.
 */

import type { PlaybackErrorDetails, SessionState } from "../types/media";
import type { SessionManager } from "../session/SessionManager";
import type { SessionProgress } from "../session/SessionState";
import type { PlaybackAdapter } from "../playback/PlaybackAdapter";
import type { LocalFileManager } from "../files/LocalFileManager";
import { PlaybackError } from "../playback/PlaybackErrors";
import { formatFileSize, formatTime } from "./format";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`LiveX UI: missing required element #${id}`);
  return node as T;
}

export interface WorkspaceUIOptions {
  manager: SessionManager;
  adapter: PlaybackAdapter;
  files: LocalFileManager;
  /** Element that receives the `<video>` during an active session. */
  activeVideoSlot: HTMLElement;
  readyVideoSlot: HTMLElement;
}

export class WorkspaceUI {
  private readonly manager: SessionManager;
  private readonly adapter: PlaybackAdapter;
  private readonly files: LocalFileManager;
  private readonly activeVideoSlot: HTMLElement;
  private readonly readyVideoSlot: HTMLElement;
  private readonly video: HTMLVideoElement;

  private readonly screens: Record<SessionState, HTMLElement>;
  private readonly cleanups: Array<() => void> = [];
  private lastFileSummary = "";

  constructor(options: WorkspaceUIOptions) {
    this.manager = options.manager;
    this.adapter = options.adapter;
    this.files = options.files;
    this.activeVideoSlot = options.activeVideoSlot;
    this.readyVideoSlot = options.readyVideoSlot;

    this.screens = {
      idle: el("state-idle"),
      ready: el("state-ready"),
      live: el("state-active"),
      paused: el("state-active"),
      completed: el("state-completed"),
      error: el("state-error"),
    };

    const video = document.getElementById("video");
    if (!(video instanceof HTMLVideoElement)) {
      throw new Error("LiveX UI: #video element is missing");
    }
    this.video = video;

    this.bindManager();
    this.bindDragAndDrop();
    this.bindFilePickers();
    this.bindSessionButtons();
    this.bindPlaybackControls();
    this.bindKeyboard();
    this.bindLifecycle();

    this.render("idle");
  }

  /* ---------------------------------------------------------------- */
  /* State rendering                                                  */
  /* ---------------------------------------------------------------- */

  private bindManager(): void {
    this.cleanups.push(
      this.manager.onSessionChange(({ state }) => {
        this.render(state);
      }),
      this.manager.onProgress((progress) => {
        this.renderProgress(progress);
      }),
      this.manager.onError((details) => {
        this.showError(details);
      }),
    );
  }

  private render(state: SessionState): void {
    const keys: SessionState[] = ["idle", "ready", "live", "paused", "completed", "error"];
    const visible = new Set<HTMLElement>();

    // `live` and `paused` share the active screen.
    const screen = this.screens[state];
    visible.add(screen);

    for (const key of keys) {
      const node = this.screens[key];
      if (visible.has(node)) {
        node.classList.remove("hidden");
        if (key !== "idle") node.classList.add("flex");
      } else {
        node.classList.add("hidden");
      }
    }

    // Idle/ready/completed/error must not keep the active screen flexed.
    for (const key of ["idle", "completed", "error"] as SessionState[]) {
      this.screens[key].classList.remove("flex");
    }

    this.syncVideoSlot(state);
    this.syncStatusBadges(state);
    this.syncSessionButtons(state);
  }

  /**
   * Reparent the single `<video>` element between the ready preview and the
   * active session frame. Keeps exactly one player instance alive (task.md).
   */
  private syncVideoSlot(state: SessionState): void {
    if (state === "ready") {
      if (this.video.parentElement !== this.readyVideoSlot) {
        this.readyVideoSlot.appendChild(this.video);
      }
      return;
    }
    if (state === "live" || state === "paused") {
      if (this.video.parentElement !== this.activeVideoSlot) {
        this.activeVideoSlot.appendChild(this.video);
      }
    }
  }

  private syncStatusBadges(state: SessionState): void {
    const liveBadge = el("live-badge");
    const pausedBadge = el("paused-badge");
    const pauseBtn = el("pause-btn");
    const resumeBtn = el("resume-btn");

    const isLive = state === "live";
    const isPaused = state === "paused";

    liveBadge.classList.toggle("hidden", !isLive);
    pausedBadge.classList.toggle("hidden", !isPaused);
    pauseBtn.classList.toggle("hidden", !isLive);
    resumeBtn.classList.toggle("hidden", !isPaused);
  }

  private syncSessionButtons(_state: SessionState): void {
    const metadata = this.manager.getSnapshot().metadata;
    if (!metadata) return;

    const summary = `${metadata.fileName} · ${formatFileSize(metadata.fileSize)}`;
    if (summary === this.lastFileSummary) return;
    this.lastFileSummary = summary;

    el("filename-ready").textContent = metadata.fileName;
    el("filename-active").textContent = metadata.fileName;
  }

  private renderProgress(progress: SessionProgress): void {
    const fill = el("progress-fill");
    const display = el("time-display");

    const pct = Math.max(0, Math.min(100, progress.fraction * 100));
    fill.style.width = `${pct}%`;
    display.textContent = `${formatTime(progress.currentTime)} / ${formatTime(progress.duration)}`;
  }

  private showError(details: PlaybackErrorDetails): void {
    el("error-message-text").textContent = details.hint
      ? `${details.message} ${details.hint}`
      : details.message;
  }

  /* ---------------------------------------------------------------- */
  /* File input                                                       */
  /* ---------------------------------------------------------------- */

  private bindDragAndDrop(): void {
    const idle = this.screens.idle;

    const onDragEnterOver = (event: DragEvent): void => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (this.manager.getState() === "idle") {
        idle.style.transform = "scale(1.02)";
      }
    };

    const onDragLeaveDrop = (event: DragEvent): void => {
      event.preventDefault();
      idle.style.transform = "scale(1)";
    };

    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.handleFile(file);
    };

    for (const type of ["dragenter", "dragover"] as const) {
      window.addEventListener(type, onDragEnterOver as EventListener);
      this.cleanups.push(() => window.removeEventListener(type, onDragEnterOver as EventListener));
    }
    for (const type of ["dragleave", "drop"] as const) {
      window.addEventListener(type, onDragLeaveDrop as EventListener);
      this.cleanups.push(() => window.removeEventListener(type, onDragLeaveDrop as EventListener));
    }
    window.addEventListener("drop", onDrop);
    this.cleanups.push(() => window.removeEventListener("drop", onDrop));
  }

  private bindFilePickers(): void {
    const input = el<HTMLInputElement>("video-input");

    const open = (): void => input.click();

    const bindOpen = (id: string): void => {
      const button = document.getElementById(id);
      if (!button) return;
      button.addEventListener("click", open);
      this.cleanups.push(() => button.removeEventListener("click", open));
    };

    // The idle screen already calls `input.click()` inline; the rest are ours.
    bindOpen("open-video-btn");
    bindOpen("change-video-btn");
    bindOpen("open-another-btn");
    bindOpen("try-another-btn");

    const onChange = (): void => {
      const file = input.files?.[0];
      input.value = "";
      if (file) void this.handleFile(file);
    };
    input.addEventListener("change", onChange);
    this.cleanups.push(() => input.removeEventListener("change", onChange));
  }

  /** Probe → load → ready, with friendly failures at each step. */
  private async handleFile(file: File): Promise<void> {
    const state = this.manager.getState();
    if (state === "live" || state === "paused") {
      // Replacing a loaded video stops the current session (task.md Phase 5).
      this.adapter.pause();
    }

    try {
      const { probe } = await this.files.inspect(file);

      if (!probe.supported) {
        this.files.setCurrentFile(null);
        this.manager.reset("reset");
        this.showError(this.files.toPlaybackError(probe).toDetails());
        this.render("error");
        return;
      }

      this.lastFileSummary = "";
      this.files.setCurrentFile(file);
      await this.manager.loadFile(file);
      // Real decode failures arrive through the adapter `error` event.
    } catch (error) {
      this.files.setCurrentFile(null);
      const playbackError =
        error instanceof PlaybackError
          ? error
          : new PlaybackError({
              code: "unknown",
              message: "This video could not be opened.",
              hint: "Try another file, or convert it to MP4 (H.264 + AAC).",
              cause: error,
            });
      this.manager.reset("reset");
      this.showError(playbackError.toDetails());
      this.render("error");
    }
  }

  /* ---------------------------------------------------------------- */
  /* Session buttons                                                  */
  /* ---------------------------------------------------------------- */

  private bindSessionButtons(): void {
    const start = el("start-session-btn");
    const pause = el("pause-btn");
    const resume = el("resume-btn");

    const onStart = async (): Promise<void> => {
      try {
        await this.manager.start();
      } catch (error) {
        this.showError(toDetails(error));
        this.render("error");
      }
    };

    const onPause = (): void => this.manager.pause();
    const onResume = async (): Promise<void> => {
      try {
        await this.manager.resume();
      } catch (error) {
        this.showError(toDetails(error));
        this.render("error");
      }
    };

    start.addEventListener("click", () => void onStart());
    pause.addEventListener("click", onPause);
    resume.addEventListener("click", () => void onResume());

    this.cleanups.push(() => {
      start.removeEventListener("click", () => void onStart());
      pause.removeEventListener("click", onPause);
      resume.removeEventListener("click", () => void onResume());
    });
  }

  /* ---------------------------------------------------------------- */
  /* Volume / fullscreen                                              */
  /* ---------------------------------------------------------------- */

  private bindPlaybackControls(): void {
    const volumeBtn = el("volume-btn");
    const volumeSlider = el<HTMLInputElement>("volume-slider");
    const volumeIcon = el("volume-icon");
    const fullscreenBtn = el("fullscreen-btn");
    const fullscreenIcon = el("fullscreen-icon");

    const renderVolume = (volume: number, muted: boolean): void => {
      volumeIcon.textContent = muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊";
      volumeBtn.title = muted ? "Unmute" : "Mute";
    };

    const onSlider = (): void => {
      const value = Number(volumeSlider.value);
      this.adapter.setVolume(value);
      this.adapter.setMuted(value === 0);
    };

    const onMuteToggle = (): void => {
      const muted = !this.adapter.isMuted();
      this.adapter.setMuted(muted);
      volumeSlider.value = String(muted ? 0 : this.adapter.getVolume() || 0.5);
      renderVolume(this.adapter.getVolume(), muted);
    };

    volumeSlider.addEventListener("input", onSlider);
    volumeBtn.addEventListener("click", onMuteToggle);
    this.cleanups.push(
      this.adapter.on("volumechange", ({ volume, muted }) => {
        renderVolume(volume, muted);
      }),
      () => volumeSlider.removeEventListener("input", onSlider),
      () => volumeBtn.removeEventListener("click", onMuteToggle),
    );

    const renderFullscreen = (): void => {
      const isFullscreen = Boolean(
        document.fullscreenElement || document.webkitFullscreenElement,
      );
      fullscreenIcon.textContent = isFullscreen ? "✕" : "⛶";
      fullscreenBtn.title = isFullscreen ? "Exit fullscreen" : "Fullscreen";
    };

    const onFullscreen = async (): Promise<void> => {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
          if (exit) await exit.call(document);
          return;
        }
        const container = this.screens.live;
        const request = container.requestFullscreen ?? container.webkitRequestFullscreen;
        if (request) {
          await request.call(container);
          return;
        }
        if (this.video.webkitEnterFullscreen) this.video.webkitEnterFullscreen();
      } catch {
        // Fullscreen is a progressive enhancement; failure is non-fatal.
        console.warn("[ui] fullscreen request was rejected");
      }
    };

    fullscreenBtn.addEventListener("click", () => void onFullscreen());
    document.addEventListener("fullscreenchange", renderFullscreen);
    document.addEventListener("webkitfullscreenchange", renderFullscreen);
    this.cleanups.push(
      () => fullscreenBtn.removeEventListener("click", () => void onFullscreen()),
      () => document.removeEventListener("fullscreenchange", renderFullscreen),
      () => document.removeEventListener("webkitfullscreenchange", renderFullscreen),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                         */
  /* ---------------------------------------------------------------- */

  private bindKeyboard(): void {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;

      const state = this.manager.getState();

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        el<HTMLInputElement>("video-input").click();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (state === "live") this.manager.pause();
        else if (state === "paused") void this.manager.resume();
        else if (state === "ready") void this.manager.start();
        return;
      }

      if (event.key.toLowerCase() === "m") {
        el("volume-btn").click();
        return;
      }

      if (event.key.toLowerCase() === "f") {
        el("fullscreen-btn").click();
        return;
      }

      if (event.key === "Enter" && state === "ready") {
        void this.manager.start();
      }
    };

    document.addEventListener("keydown", handler);
    this.cleanups.push(() => document.removeEventListener("keydown", handler));
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  private bindLifecycle(): void {
    // Object URLs and engine resources must not outlive the page.
    const onUnload = (): void => {
      this.manager.dispose();
    };
    window.addEventListener("beforeunload", onUnload);
    this.cleanups.push(() => window.removeEventListener("beforeunload", onUnload));
  }

  dispose(): void {
    for (const off of this.cleanups.splice(0)) off();
  }
}

function toDetails(error: unknown): PlaybackErrorDetails {
  if (error instanceof PlaybackError) return error.toDetails();
  if (error instanceof Error) {
    return {
      code: "unknown",
      message: "Something went wrong while starting the session.",
      hint: error.message,
    };
  }
  return { code: "unknown", message: "Something went wrong while starting the session." };
}
