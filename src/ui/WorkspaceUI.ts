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
import type { SessionHistoryService } from "../session/SessionHistoryService";
import type { AnnotationService } from "../session/AnnotationService";
import { PlaylistService } from "../session/PlaylistService";
import { SubtitleService } from "../session/SubtitleService";
import { AnalyticsService } from "../session/AnalyticsService";
import { readChapters, type Chapter } from "../files/ChapterReader";
import type { Annotation, HistoryEntry } from "../files/LocalMetadataStore";
import { PlaybackError } from "../playback/PlaybackErrors";
import { formatFileSize, formatStretch, formatTime } from "./format";

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
  history: SessionHistoryService;
  annotations: AnnotationService;
}

/** How the elapsed/total readout is formatted (feature 1.6). */
type TimeDisplayMode = "elapsed" | "remaining" | "percent";
const TIME_MODES: TimeDisplayMode[] = ["elapsed", "remaining", "percent"];
const TIME_MODE_STORAGE_KEY = "livex.timeDisplayMode";
/** Never offer to resume within the first few seconds of a file. */
const MIN_RESUME_SECONDS = 5;
/** ...or within this fraction of it, so short clips do not nag. */
const MIN_RESUME_FRACTION = 0.1;

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

  private readonly history: SessionHistoryService;
  private readonly annotations: AnnotationService;
  private readonly playlist = new PlaylistService();
  private readonly subtitles = new SubtitleService();
  private analytics: AnalyticsService | null = null;
  private chapters: Chapter[] = [];
  private timeMode: TimeDisplayMode = "elapsed";
  private noteComposerOpen = false;
  /** Where a half-watched file was left, offered on the ready screen (2.6). */
  private pendingResume: number | null = null;
  private focusMode = false;
  private focusClockTimer: number | null = null;

  constructor(options: WorkspaceUIOptions) {
    this.manager = options.manager;
    this.adapter = options.adapter;
    this.files = options.files;
    this.history = options.history;
    this.annotations = options.annotations;
    this.analytics = new AnalyticsService(options.history.store);
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
    this.bindHistory();
    this.bindAnnotations();
    this.bindResume();
    this.bindPlaylist();
    this.bindSubtitles();
    this.bindDialogs();

    this.applyPlatformShortcuts();
    this.disableUnimplementedToolbarButtons();
    this.restoreTimeMode();

    this.render("idle");
    void this.renderRecent();
  }

  /**
   * The markup ships macOS-style ⌘O labels. On Windows/Linux show Ctrl+O so
   * the hint matches the key the user actually has.
   */
  private applyPlatformShortcuts(): void {
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    const label = isMac ? "⌘O" : "Ctrl+O";
    for (const node of document.querySelectorAll<HTMLElement>('[data-shortcut="mod-o"]')) {
      node.textContent = label;
    }
    const openBtn = document.getElementById("open-video-btn");
    if (openBtn) openBtn.title = `Open Local Video (${label})`;
  }

  /**
   * Toolbar buttons that belong to future features (menu, pan, annotate,
   * bookmark, zoom…) have no handler yet. Make them look and behave
   * unavailable instead of silently doing nothing when clicked.
   */
  private disableUnimplementedToolbarButtons(): void {
    for (const node of document.querySelectorAll<HTMLButtonElement>("button[data-unavailable]")) {
      node.classList.add("is-unavailable");
      node.setAttribute("aria-disabled", "true");
      node.tabIndex = -1;
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* State rendering                                                  */
  /* ---------------------------------------------------------------- */

  private bindManager(): void {
    this.cleanups.push(
      this.manager.onSessionChange(({ state, previous }) => {
        this.render(state);
        this.announceState(state, previous);
        this.onSessionStateForPersistence(state);
      }),
      this.manager.onProgress((progress) => {
        this.renderProgress(progress);
        // Throttled internally, so this is safe on every tick.
        this.history.recordProgress(progress.currentTime, progress.furthestTime);
      }),
      this.manager.onError((details) => {
        this.showError(details);
      }),
    );
  }

  /**
   * Announce session changes to assistive technology. The visible badges are
   * colour/icon only, so without this a screen-reader user gets no feedback.
   */
  private announceState(state: SessionState, previous: SessionState): void {
    const announcer = document.getElementById("session-announcer");
    if (!announcer || state === previous) return;

    const messages: Record<SessionState, string> = {
      idle: "No video selected.",
      ready: "Video ready. Press Start Live Session to begin.",
      live: "Session live. Playback started.",
      paused: "Session paused.",
      completed: "Session completed. You reached the end of the video.",
      error: "Playback error. See the message for details.",
    };

    announcer.textContent = messages[state];
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
    this.syncResumeBanner(state);
    this.syncQueueBadge();
    if (state === "ready") this.renderChapters();
    this.syncFocus(state);
  }

  /* ---------------------------------------------------------------- */
  /* Resume an interrupted session (roadmap 2.6)                      */
  /* ---------------------------------------------------------------- */

  /**
   * Show "Resume at mm:ss" only when this exact file was left part-watched.
   * This is a deliberate exception to "always start at 0:00" and is offered
   * as a choice, never applied silently.
   */
  private syncResumeBanner(state: SessionState): void {
    const banner = document.getElementById("resume-banner");
    if (!banner) return;

    const resumeAt = this.pendingResume;
    const show = state === "ready" && resumeAt !== null && this.isWorthResuming(resumeAt);

    banner.classList.toggle("hidden", !show);
    banner.classList.toggle("flex", show);
    if (!show) return;

    const node = document.getElementById("resume-time");
    if (node) node.textContent = formatTime(resumeAt);
  }

  /**
   * A resume offer is only worth interrupting for when the stop point clears
   * both an absolute and a relative floor — otherwise short clips would prompt
   * after two seconds of playback.
   */
  private isWorthResuming(time: number): boolean {
    const duration = this.manager.getProgress().duration;
    if (!Number.isFinite(time) || time < MIN_RESUME_SECONDS) return false;
    return duration <= 0 ? true : time >= duration * MIN_RESUME_FRACTION;
  }

  private bindResume(): void {
    const accept = document.getElementById("resume-accept-btn");
    const decline = document.getElementById("resume-decline-btn");

    const onAccept = async (): Promise<void> => {
      const target = this.pendingResume;
      if (target === null) return;
      this.pendingResume = null;
      await this.manager.startAt(target);
    };

    const onDecline = (): void => {
      this.pendingResume = null;
      this.syncResumeBanner(this.manager.getState());
      this.announce("Starting from the beginning.");
    };

    accept?.addEventListener("click", () => void onAccept());
    decline?.addEventListener("click", onDecline);
    this.cleanups.push(
      () => accept?.removeEventListener("click", () => void onAccept()),
      () => decline?.removeEventListener("click", onDecline),
    );
  }

  /** Flush watch position to history on meaningful transitions (feature 1.1). */
  private onSessionStateForPersistence(state: SessionState): void {
    if (state === "live") this.pendingResume = null;
    const progress = this.manager.getProgress();

    if (state === "completed") this.renderIntegrity();
    // Focus mode only makes sense while a session is running (2.4).
    if (state !== "live" && state !== "paused" && this.focusMode) this.toggleFocusMode(false);

    if (state === "paused") {
      this.history.recordProgress(progress.currentTime, progress.furthestTime, true);
    } else if (state === "completed") {
      this.history.recordCompletion(progress.duration);
      void this.renderRecent();
    } else if (state === "idle") {
      void this.renderRecent();
    }
  }

  /**
   * Keep keyboard focus inside the visible screen. When a screen is hidden its
   * controls become unreachable, so move focus to the primary action of the
   * new state instead of leaving it on a now-hidden button.
   */
  private syncFocus(state: SessionState): void {
    const active = document.activeElement as HTMLElement | null;
    // Only intervene when focus was lost (hidden element) or is on <body>.
    const lostFocus = !active || active === document.body || active.offsetParent === null;
    if (!lostFocus) return;

    const primary: Partial<Record<SessionState, string>> = {
      ready: "start-session-btn",
      live: "pause-btn",
      paused: "resume-btn",
      completed: "open-another-btn",
      error: "try-another-btn",
    };

    const targetId = primary[state];
    if (targetId) {
      const target = document.getElementById(targetId);
      // `preventScroll` keeps the layout stable; LiveX has no scroll container.
      target?.focus({ preventScroll: true });
    }
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
    display.textContent = this.formatTimeDisplay(progress);

    this.annotations.checkCrossings(
      progress.currentTime,
      this.manager.getState() === "live",
    );
    this.renderPlayheadMarker(progress);
  }

  /** Format the readout according to the current mode (feature 1.6). */
  private formatTimeDisplay(progress: SessionProgress): string {
    const { currentTime, duration } = progress;

    switch (this.timeMode) {
      case "remaining": {
        const left = Math.max(0, duration - currentTime);
        return duration > 0 ? `−${formatTime(left)}` : `−${formatTime(0)}`;
      }
      case "percent":
        return duration > 0 ? `${Math.floor(progress.fraction * 100)}%` : "0%";
      case "elapsed":
      default:
        return `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
  }

  private restoreTimeMode(): void {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(TIME_MODE_STORAGE_KEY);
    } catch {
      // Storage may be blocked; fall back to the default mode.
    }
    if (stored && (TIME_MODES as string[]).includes(stored)) {
      this.timeMode = stored as TimeDisplayMode;
    }
    this.syncTimeModeAffordance();
  }

  private cycleTimeMode(): void {
    const index = TIME_MODES.indexOf(this.timeMode);
    this.timeMode = TIME_MODES[(index + 1) % TIME_MODES.length] ?? "elapsed";
    try {
      window.localStorage.setItem(TIME_MODE_STORAGE_KEY, this.timeMode);
    } catch {
      // Non-fatal: the choice just will not persist.
    }
    this.syncTimeModeAffordance();
    this.renderProgress(this.manager.getProgress());
  }

  private syncTimeModeAffordance(): void {
    const display = document.getElementById("time-display");
    if (!display) return;
    const label = this.timeMode === "elapsed"
      ? "Showing elapsed time. Click for remaining time."
      : this.timeMode === "remaining"
        ? "Showing remaining time. Click for percentage."
        : "Showing percentage. Click for elapsed time.";
    display.title = label;
    display.setAttribute("aria-label", label);
  }

  /** Fill in the end-of-session honesty report (roadmap 2.1). */
  private renderIntegrity(): void {
    const percent = this.manager.getIntegrityPercent();
    const { skipAttempts, longestStretchSeconds } = this.manager.getIntegrity();

    const watched = document.getElementById("integrity-watched");
    if (watched) {
      watched.textContent = `${percent}%`;
      watched.classList.toggle("text-emerald-400", percent >= 90);
      watched.classList.toggle("text-amber-400", percent < 90);
    }

    const skips = document.getElementById("integrity-skips");
    if (skips) {
      skips.textContent = String(skipAttempts);
      skips.classList.toggle("text-amber-400", skipAttempts > 0);
      skips.classList.toggle("text-neutral-200", skipAttempts === 0);
    }

    const stretch = document.getElementById("integrity-stretch");
    if (stretch) stretch.textContent = formatStretch(longestStretchSeconds);
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
      const dropped = [...(event.dataTransfer?.files ?? [])];
      if (dropped.length === 0) return;

      // Dropping several files builds a queue (roadmap 2.3).
      if (dropped.length > 1) {
        this.playlist.set(dropped);
        this.renderPlaylist();
        this.announce(`${dropped.length} files queued.`);
      } else {
        this.playlist.clear();
        this.renderPlaylist();
      }
      void this.handleFile(dropped[0]!);
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
      const picked = [...(input.files ?? [])];
      input.value = "";
      if (picked.length === 0) return;

      // More than one file is a queue (roadmap 2.3); a single file is a drop.
      if (picked.length > 1) {
        this.playlist.set(picked);
        this.renderPlaylist();
        this.announce(`${picked.length} files queued.`);
      } else {
        this.playlist.clear();
        this.renderPlaylist();
      }
      void this.handleFile(picked[0]!);
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
        // Drive the state machine rather than poking the DOM, so the session
        // state and the visible screen never disagree.
        this.manager.reportFailure(this.files.toPlaybackError(probe).toDetails());
        return;
      }

      this.lastFileSummary = "";
      // Chapters belong to the previous file; clear them immediately so a slow
      // parse can never show stale markers for the new video.
      this.chapters = [];
      this.renderChapters();
      // Captions belong to the previous file; drop them on replacement.
      this.subtitles.detachFrom(this.video);
      this.syncSubtitleButton();
      this.files.setCurrentFile(file);
      const metadata = await this.manager.loadFile(file);

      // Record the open for "continue where you left off" and load any notes
      // this file already has (metadata only — never the video).
      const ledger = await this.history.trackOpen(metadata);
      this.pendingResume =
        ledger && !ledger.completed && this.isWorthResuming(ledger.furthestTime)
          ? ledger.furthestTime
          : null;
      // `transition("ready")` already rendered before this point, so the
      // resume banner needs an explicit re-sync once the ledger is known.
      this.syncResumeBanner(this.manager.getState());
      await this.annotations.setMedia(metadata);
      this.annotations.resetCrossingCursor(0);
      this.hideNoteTransport();

      // Chapter parsing is best-effort and never blocks playback.
      void readChapters(file)
        .then((found) => {
          this.chapters = found;
          this.renderChapters();
        })
        .catch(() => {
          this.chapters = [];
          this.renderChapters();
        });
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
      this.manager.reportFailure(playbackError.toDetails());
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

    // Time display cycles elapsed → remaining → percentage (feature 1.6).
    const timeDisplay = document.getElementById("time-display");
    const onTimeMode = (): void => this.cycleTimeMode();
    timeDisplay?.addEventListener("click", onTimeMode);
    this.cleanups.push(() => timeDisplay?.removeEventListener("click", onTimeMode));

    // Focus mode (roadmap 2.4).
    const focusBtn = document.getElementById("focus-btn");
    const onFocus = (): void => this.toggleFocusMode();
    focusBtn?.addEventListener("click", onFocus);
    this.cleanups.push(() => focusBtn?.removeEventListener("click", onFocus));

    // Picture in picture (feature 1.5).
    const pipBtn = document.getElementById("pip-btn");
    const onPip = (): void => void this.togglePictureInPicture();
    pipBtn?.addEventListener("click", onPip);
    this.cleanups.push(() => pipBtn?.removeEventListener("click", onPip));
    if (pipBtn && !document.pictureInPictureEnabled) {
      pipBtn.classList.add("opacity-40");
      pipBtn.setAttribute("title", "Picture in picture is not supported in this browser");
      pipBtn.setAttribute("aria-disabled", "true");
    }

    const renderVolume = (volume: number, muted: boolean): void => {
      volumeIcon.textContent = muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊";
      const label = muted ? "Unmute" : "Mute";
      volumeBtn.title = label;
      volumeBtn.setAttribute("aria-label", label);
      volumeBtn.setAttribute("aria-pressed", String(muted));
      volumeSlider.value = String(muted ? 0 : volume);
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
      const label = isFullscreen ? "Exit fullscreen" : "Fullscreen";
      fullscreenBtn.title = label;
      fullscreenBtn.setAttribute("aria-label", label);
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
      // Never steal keys from a text field, dialog or focused button.
      if (this.isTypingTarget(event.target)) return;
      if (event.target instanceof HTMLButtonElement && event.code === "Space") return;

      const state = this.manager.getState();
      const active = state === "live" || state === "paused";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        el<HTMLInputElement>("video-input").click();
        return;
      }

      // Arrow seeking and YouTube-style J/K/L (feature 1.3).
      const nudge = (delta: number): void => {
        if (!active) return;
        const target = this.manager.getSnapshot().progress.currentTime + delta;
        const ceiling = this.manager.getSnapshot().progress.furthestTime;
        this.manager.seekTo(Math.min(Math.max(0, target), ceiling));
        this.annotations.resetCrossingCursor(this.manager.getProgress().currentTime);
        this.hideNoteTransport();
      };

      switch (event.key) {
        case "ArrowRight":
          if (!active) return;
          event.preventDefault();
          nudge(event.shiftKey ? 30 : 5);
          return;
        case "ArrowLeft":
          if (!active) return;
          event.preventDefault();
          nudge(event.shiftKey ? -30 : -5);
          return;
        case "l":
        case "L":
          if (!active) return;
          event.preventDefault();
          nudge(10);
          return;
        case "j":
        case "J":
          if (!active) return;
          event.preventDefault();
          nudge(-10);
          return;
        default:
          break;
      }

      if (event.code === "Space" || event.key.toLowerCase() === "k") {
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

      if (event.key.toLowerCase() === "p") {
        void this.togglePictureInPicture();
        return;
      }

      if (event.key.toLowerCase() === "z" && active) {
        event.preventDefault();
        this.toggleFocusMode();
        return;
      }

      if (event.key.toLowerCase() === "b" && this.annotations.hasMedia()) {
        event.preventDefault();
        void this.annotations.add("bookmark", this.manager.getProgress().currentTime);
        return;
      }

      // Shift+N jumps to the next queued file (roadmap 2.3).
      if (event.key.toLowerCase() === "n" && event.shiftKey && this.playlist.hasNext()) {
        event.preventDefault();
        void this.advanceQueue();
        return;
      }

      if (event.key.toLowerCase() === "n" && this.annotations.hasMedia()) {
        event.preventDefault();
        this.openNoteComposer();
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
  /* Annotations: bookmarks + timestamped notes (1.2)                 */
  /* ---------------------------------------------------------------- */

  private bindAnnotations(): void {
    const bookmarkBtn = document.getElementById("bookmark-btn");
    const noteBtn = document.getElementById("note-btn");
    const closeNote = document.getElementById("note-transport-close");

    const onBookmark = (): void => {
      if (!this.annotations.hasMedia()) return;
      void this.annotations.add("bookmark", this.manager.getProgress().currentTime);
    };

    const onNote = (): void => {
      if (!this.annotations.hasMedia()) return;
      this.openNoteComposer();
    };

    bookmarkBtn?.addEventListener("click", onBookmark);
    noteBtn?.addEventListener("click", onNote);
    closeNote?.addEventListener("click", () => this.hideNoteTransport());

    this.cleanups.push(
      () => bookmarkBtn?.removeEventListener("click", onBookmark),
      () => noteBtn?.removeEventListener("click", onNote),
      this.annotations.onAnnotationsChange((annotations) => {
        this.renderAnnotations(annotations);
      }),
      this.annotations.onNoteCrossed((annotation) => {
        this.showNoteTransport(annotation);
      }),
    );
  }

  /** Chips under the progress bar plus ticks on the rail. */
  private renderAnnotations(annotations: Annotation[]): void {
    const bar = document.getElementById("annotation-bar");
    const markers = document.getElementById("progress-markers");
    if (!bar || !markers) return;

    bar.replaceChildren();
    markers.replaceChildren();

    const duration = this.manager.getProgress().duration;

    for (const annotation of annotations) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "annotation-chip";
      chip.dataset.kind = annotation.kind;
      chip.title =
        annotation.kind === "bookmark"
          ? `Bookmark at ${formatTime(annotation.time)} — click to jump back`
          : `${formatTime(annotation.time)} — ${annotation.text}\nClick to jump back`;

      const timeLabel = document.createElement("span");
      timeLabel.textContent =
        annotation.kind === "bookmark" ? `★ ${formatTime(annotation.time)}` : `✎ ${formatTime(annotation.time)}`;
      chip.append(timeLabel);

      chip.addEventListener("click", () => {
        // Bookmark clicks are rewind-or-equal jumps, so anti-skip allows them.
        this.manager.seekTo(annotation.time);
        this.annotations.resetCrossingCursor(annotation.time);
        this.hideNoteTransport();
      });

      const remove = document.createElement("span");
      remove.setAttribute("role", "button");
      remove.tabIndex = -1;
      remove.className = "ml-0.5 text-neutral-500 hover:text-red-400";
      remove.textContent = "✕";
      remove.title = "Delete";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.annotations.remove(annotation.id);
      });
      chip.append(remove);

      bar.append(chip);

      if (duration > 0) {
        const marker = document.createElement("div");
        marker.className = "progress-marker";
        marker.style.left = `${Math.min(100, (annotation.time / duration) * 100)}%`;
        marker.style.backgroundColor =
          annotation.kind === "bookmark" ? "#a5a1f8" : "#6965db";
        markers.append(marker);
      }
    }

    // Hint when the file is loaded but has no annotations yet.
    const enabled = this.annotations.hasMedia();
    document.getElementById("bookmark-btn")?.classList.toggle("opacity-40", !enabled);
    document.getElementById("note-btn")?.classList.toggle("opacity-40", !enabled);
  }

  /** Small caret showing exactly where playback is on the rail. */
  private renderPlayheadMarker(progress: SessionProgress): void {
    const markers = document.getElementById("progress-markers");
    if (!markers) return;

    let playhead = markers.querySelector<HTMLElement>("[data-playhead]");
    if (!playhead) {
      playhead = document.createElement("div");
      playhead.dataset.playhead = "1";
      playhead.className = "progress-marker";
      playhead.style.backgroundColor = "#ffffff";
      playhead.style.height = "0.6rem";
      markers.append(playhead);
    }
    playhead.style.left = `${Math.max(0, Math.min(100, progress.fraction * 100))}%`;
  }

  /** Inline composer for a timestamped note at the current position. */
  private openNoteComposer(): void {
    if (this.noteComposerOpen) return;
    this.noteComposerOpen = true;

    const time = this.manager.getProgress().currentTime;
    const bar = document.getElementById("annotation-bar");
    if (!bar) return;

    const wasPlaying = this.manager.getState() === "live";
    if (wasPlaying) this.manager.pause();

    const wrap = document.createElement("form");
    wrap.className = "flex items-center gap-1.5 w-full";
    wrap.id = "note-composer";

    const stamp = document.createElement("span");
    stamp.className = "font-mono text-[10px] text-accent-purple-light shrink-0";
    stamp.textContent = formatTime(time);

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "Note at " + formatTime(time) + "…";
    input.className =
      "flex-1 min-w-0 bg-canvas border border-border rounded-md px-2 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-accent-purple/60";
    input.setAttribute("aria-label", `Note at ${formatTime(time)}`);

    const save = document.createElement("button");
    save.type = "submit";
    save.className =
      "px-2 py-1 rounded-md bg-accent-purple hover:bg-[#7874e4] text-white text-[11px] font-medium shrink-0 focus-ring";
    save.textContent = "Save";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "px-1.5 py-1 text-[11px] text-neutral-400 hover:text-white shrink-0 focus-ring rounded";
    cancel.textContent = "Cancel";

    const close = (): void => {
      this.noteComposerOpen = false;
      wrap.remove();
      if (wasPlaying && this.manager.getState() === "paused") void this.manager.resume();
    };

    wrap.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (text) void this.annotations.add("note", time, text);
      this.noteComposerOpen = false;
      wrap.remove();
      if (wasPlaying && this.manager.getState() === "paused") void this.manager.resume();
    });
    cancel.addEventListener("click", close);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    });

    wrap.append(stamp, input, save, cancel);
    bar.append(wrap);
    input.focus();
  }

  private showNoteTransport(annotation: Annotation): void {
    const transport = document.getElementById("note-transport");
    const timeNode = document.getElementById("note-transport-time");
    const textNode = document.getElementById("note-transport-text");
    if (!transport || !timeNode || !textNode) return;

    timeNode.textContent = formatTime(annotation.time);
    textNode.textContent = annotation.text;
    transport.classList.remove("hidden");
  }

  private hideNoteTransport(): void {
    document.getElementById("note-transport")?.classList.add("hidden");
  }

  /* ---------------------------------------------------------------- */
  /* History: continue where you left off (1.1)                       */
  /* ---------------------------------------------------------------- */

  private bindHistory(): void {
    const clearBtn = document.getElementById("clear-history-btn");
    const onClear = async (): Promise<void> => {
      await this.history.store.clearHistory();
      await this.renderRecent();
      this.announce("Recent files cleared.");
    };
    clearBtn?.addEventListener("click", () => void onClear());
    this.cleanups.push(() => clearBtn?.removeEventListener("click", () => void onClear()));
  }

  /** Renders the "Continue where you left off" list on the idle screen. */
  private async renderRecent(): Promise<void> {
    const wrap = document.getElementById("recent-wrap");
    const list = document.getElementById("recent-list");
    if (!wrap || !list) return;

    const entries = await this.history.listRecent(4);
    const current = this.history.getEntry();
    const visible = entries.filter((entry) => entry.key !== current?.key).slice(0, 3);

    list.replaceChildren();
    if (visible.length === 0) {
      wrap.classList.add("hidden");
      return;
    }
    wrap.classList.remove("hidden");

    for (const entry of visible) {
      list.append(this.buildRecentRow(entry));
    }
  }

  private buildRecentRow(entry: HistoryEntry): HTMLElement {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.title = entry.completed
      ? `${entry.fileName} — completed. Select the same file to replay.`
      : `${entry.fileName} — resume at ${formatTime(entry.lastTime)}`;

    const icon = document.createElement("span");
    icon.className = "text-[11px] shrink-0";
    icon.textContent = entry.completed ? "✓" : "▸";
    icon.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "flex-1 min-w-0 truncate text-xs text-neutral-200";
    name.textContent = entry.fileName;

    const meta = document.createElement("span");
    meta.className = "font-mono text-[10px] text-neutral-500 shrink-0";
    const pct = entry.duration > 0 ? Math.floor((entry.furthestTime / entry.duration) * 100) : 0;
    meta.textContent = entry.completed ? "done" : `${Math.min(100, pct)}%`;

    button.append(icon, name, meta);
    // A remembered file cannot be re-opened by reference (the browser does not
    // expose past File objects), so this is an affordance to pick it again.
    button.addEventListener("click", () => {
      el<HTMLInputElement>("video-input").click();
    });

    li.append(button);
    return li;
  }

  /* ---------------------------------------------------------------- */
  /* Chapters (roadmap 2.3)                                           */
  /* ---------------------------------------------------------------- */

  private renderChapters(): void {
    const bar = document.getElementById("chapter-bar");
    if (!bar) return;

    bar.replaceChildren();
    // One chapter is not worth a row of chrome.
    if (this.chapters.length < 2) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");

    const duration = this.manager.getProgress().duration;

    for (const chapter of this.chapters) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "annotation-chip whitespace-nowrap shrink-0";
      chip.title =
        `${chapter.title} — ${formatTime(chapter.startTime)}` +
        (duration > 0 ? ` (chapter ${chapter.index + 1} of ${this.chapters.length})` : "");

      const label = document.createElement("span");
      label.className = "text-neutral-500 font-mono";
      label.textContent = String(chapter.index + 1).padStart(2, "0");

      const title = document.createElement("span");
      title.textContent = chapter.title;

      chip.append(label, title);
      // Seeking goes through the manager so the anti-skip ceiling still rules.
      chip.addEventListener("click", () => {
        this.manager.seekTo(chapter.startTime);
        this.annotations.resetCrossingCursor(chapter.startTime);
        this.hideNoteTransport();
      });

      bar.append(chip);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Local subtitles (roadmap 2.5)                                    */
  /* ---------------------------------------------------------------- */

  private bindSubtitles(): void {
    const btn = document.getElementById("subtitle-btn");
    const input = document.getElementById("subtitle-input") as HTMLInputElement | null;

    const onButton = (): void => {
      // No track loaded yet → pick a file. Track loaded → toggle visibility.
      if (!this.subtitles.getCurrent()) {
        input?.click();
        return;
      }
      const enabled = !this.subtitles.isToggledOn(this.video);
      this.subtitles.setEnabled(this.video, enabled);
      this.syncSubtitleButton();
      this.announce(enabled ? "Subtitles on." : "Subtitles off.");
    };

    const onChange = async (): Promise<void> => {
      const file = input?.files?.[0];
      if (input) input.value = "";
      if (!file) return;

      try {
        const info = await this.subtitles.load(file);
        this.subtitles.attachTo(this.video, info);
        // `textTracks[0]` appears asynchronously in some engines; poll briefly.
        this.enableTrackWhenReady();
        this.syncSubtitleButton();
        this.announce(`${info.cueCount} subtitle cues loaded from ${info.fileName}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read that subtitle file.";
        this.announce(message);
        console.warn("[ui] subtitle load failed", error);
      }
    };

    const offTrack = this.subtitles.onTrackChange(() => this.syncSubtitleButton());

    btn?.addEventListener("click", onButton);
    input?.addEventListener("change", () => void onChange());
    this.cleanups.push(
      offTrack,
      () => btn?.removeEventListener("click", onButton),
      () => input?.removeEventListener("change", () => void onChange()),
      () => this.subtitles.dispose(),
    );
  }

  /** Some engines populate `textTracks` a tick after the element is attached. */
  private enableTrackWhenReady(attempt = 0): void {
    const tracks = this.video.textTracks;
    if (tracks.length > 0) {
      tracks[0]!.mode = "showing";
      this.syncSubtitleButton();
      return;
    }
    if (attempt > 20) return;
    window.setTimeout(() => this.enableTrackWhenReady(attempt + 1), 50);
  }

  private syncSubtitleButton(): void {
    const btn = document.getElementById("subtitle-btn");
    if (!btn) return;

    const info = this.subtitles.getCurrent();
    const on = info !== null && this.subtitles.isToggledOn(this.video);

    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute(
      "aria-label",
      info
        ? `Subtitles: ${info.fileName} (${on ? "on" : "off"}). Click to toggle.`
        : "Load subtitles (.vtt or .srt)",
    );
    btn.title = info
      ? `${info.fileName} — ${info.cueCount} cues (${on ? "on" : "off"})`
      : "Load subtitles (.vtt or .srt)";
    btn.classList.toggle("text-accent-purple-light", on);
    btn.classList.toggle("border", on);
    btn.classList.toggle("border-accent-purple/50", on);
  }

  /* ---------------------------------------------------------------- */
  /* Playlist queue (roadmap 2.3)                                     */
  /* ---------------------------------------------------------------- */

  private bindPlaylist(): void {
    const nextBtn = document.getElementById("next-in-queue-btn");
    const clearBtn = document.getElementById("playlist-clear-btn");

    const onNext = (): void => void this.advanceQueue();
    const onClear = (): void => {
      this.playlist.clear();
      this.renderPlaylist();
      this.announce("Queue cleared.");
    };

    nextBtn?.addEventListener("click", onNext);
    clearBtn?.addEventListener("click", onClear);
    this.cleanups.push(
      () => nextBtn?.removeEventListener("click", onNext),
      () => clearBtn?.removeEventListener("click", onClear),
    );
  }

  /** Move to the next queued file and start a fresh session for it. */
  private async advanceQueue(): Promise<void> {
    const next = this.playlist.advance();
    if (!next) {
      this.announce("Nothing left in the queue.");
      return;
    }
    this.renderPlaylist();
    await this.handleFile(next.file);
    if (this.manager.getState() === "ready") await this.manager.start();
  }

  private renderPlaylist(): void {
    const wrap = document.getElementById("playlist-wrap");
    const list = document.getElementById("playlist-list");
    if (!wrap || !list) return;

    const items = this.playlist.all();
    list.replaceChildren();

    if (items.length < 2) {
      wrap.classList.add("hidden");
    } else {
      wrap.classList.remove("hidden");
      const activeIndex = this.playlist.activeIndex();

      items.forEach((item, index) => {
        const li = document.createElement("li");
        const row = document.createElement("div");
        row.className =
          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left " +
          (index === activeIndex
            ? "bg-accent-purple/15 border-accent-purple/50"
            : "bg-surface/70 border-border");

        const num = document.createElement("span");
        num.className = "font-mono text-[10px] text-neutral-500 w-4 shrink-0";
        num.textContent = String(index + 1);

        const name = document.createElement("span");
        name.className = "flex-1 min-w-0 truncate text-xs text-neutral-200";
        name.textContent = item.file.name;

        const size = document.createElement("span");
        size.className = "font-mono text-[10px] text-neutral-500 shrink-0";
        size.textContent = formatFileSize(item.file.size);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-neutral-500 hover:text-red-400 text-[10px] shrink-0 focus-ring rounded px-0.5";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", `Remove ${item.file.name} from the queue`);
        remove.addEventListener("click", () => {
          this.playlist.remove(item.id);
          this.renderPlaylist();
        });

        row.append(num, name, size, remove);

        if (index !== activeIndex) {
          // Clicking a later item jumps the queue there.
          row.classList.add("cursor-pointer", "hover:border-neutral-500", "transition-colors");
          row.addEventListener("click", (event) => {
            if (event.target === remove) return;
            this.playlist.select(item.id);
            this.renderPlaylist();
          });
        }

        li.append(row);
        list.append(li);
      });
    }

    this.syncQueueBadge();
  }

  private syncQueueBadge(): void {
    const badge = document.getElementById("queue-badge");
    const nextBtn = document.getElementById("next-in-queue-btn");
    const total = this.playlist.size();
    const index = this.playlist.activeIndex();

    if (badge) {
      const show = total > 1;
      badge.classList.toggle("hidden", !show);
      if (show) badge.textContent = `${index + 1} / ${total}`;
    }

    if (nextBtn) {
      const show = this.playlist.hasNext();
      nextBtn.classList.toggle("hidden", !show);
      nextBtn.classList.toggle("flex", show);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Dialogs: shortcuts, menu and about (1.4)                         */
  /* ---------------------------------------------------------------- */

  private bindDialogs(): void {
    const shortcuts = document.getElementById("shortcuts-dialog") as HTMLDialogElement | null;
    const about = document.getElementById("about-dialog") as HTMLDialogElement | null;

    for (const dialog of [shortcuts, about]) {
      if (!dialog) continue;
      for (const closeBtn of dialog.querySelectorAll(".dialog-close")) {
        closeBtn.addEventListener("click", () => dialog.close());
      }
      // Click on the backdrop (outside the panel) closes.
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    this.openShortcuts = (): void => {
      if (!shortcuts || shortcuts.open) return;
      shortcuts.showModal();
    };
    this.openAbout = (): void => {
      if (!about) return;
      this.populateAbout();
      about.showModal();
    };
    this.openMenu = (): void => this.showMenu();

    const menuBtn = document.getElementById("menu-btn");
    if (menuBtn) {
      const onMenu = (): void => this.openMenu();
      menuBtn.addEventListener("click", onMenu);
      this.cleanups.push(() => menuBtn.removeEventListener("click", onMenu));
    }

    const clearAll = document.getElementById("clear-all-data-btn");
    const onClearAll = async (): Promise<void> => {
      await this.history.store.clearAll();
      await this.annotations.setMedia(null);
      await this.renderRecent();
      about?.close();
    };
    clearAll?.addEventListener("click", () => void onClearAll());

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        const openDialog = document.querySelector("dialog[open]");
        if (openDialog) {
          (openDialog as HTMLDialogElement).close();
          return;
        }
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
          return;
        }
        if (this.focusMode) this.toggleFocusMode(false);
      }
      if (event.key === "?" && !this.isTypingTarget(event.target)) {
        event.preventDefault();
        this.openShortcuts();
      }
    };
    document.addEventListener("keydown", onKey);
    this.cleanups.push(() => document.removeEventListener("keydown", onKey));
  }

  // Assigned in bindDialogs so the keyboard handler can reach them.
  private openShortcuts: () => void = () => undefined;
  private openAbout: () => void = () => undefined;
  private openMenu: () => void = () => undefined;

  private populateAbout(): void {
    void this.renderAnalytics();
    const store = this.history.store;
    const stateNode = document.getElementById("about-storage-state");
    if (stateNode) {
      stateNode.textContent = store.isAvailable()
        ? "Local storage: on (metadata only)"
        : `Local storage: unavailable — ${store.getUnavailableReason() ?? "unknown reason"}`;
    }
    const engineNode = document.getElementById("about-engine");
    if (engineNode) engineNode.textContent = this.adapter.id;
  }

  /** Local watching statistics drawn from the history store (roadmap 2.2). */
  private async renderAnalytics(): Promise<void> {
    if (!this.analytics) return;
    const summary = await this.analytics.getSummary();

    const set = (id: string, value: string): void => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };

    set("analytics-files", String(summary.fileCount));
    set("analytics-completed", String(summary.completedCount));
    set("analytics-watched", formatStretch(summary.totalWatchedSeconds));
    set("analytics-rate", summary.fileCount === 0 ? "—" : `${Math.round(summary.completionRate * 100)}%`);

    const hint = document.getElementById("analytics-hint");
    if (hint) {
      if (summary.fileCount === 0) {
        hint.textContent = "Nothing recorded yet. Statistics appear after you watch something.";
      } else if (summary.almostDone) {
        hint.textContent = `Almost done: ${summary.almostDone.fileName}.`;
      } else {
        const pct = Math.round(summary.averageCoverage * 100);
        hint.textContent = `You watch about ${pct}% of each file on average.`;
      }
    }
  }

  /** Lightweight menu: no new markup, built on demand and anchored top-left. */
  private showMenu(): void {
    document.getElementById("livex-menu")?.remove();

    const anchor = document.getElementById("menu-btn");
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();

    const menu = document.createElement("div");
    menu.id = "livex-menu";
    menu.className =
      "fixed z-50 w-56 p-1.5 rounded-xl bg-surface border border-border shadow-2xl flex flex-col";
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.setAttribute("role", "menu");

    const items: Array<{ label: string; hint: string; run: () => void }> = [
      {
        label: "Open video",
        hint: "⌘O",
        run: () => el<HTMLInputElement>("video-input").click(),
      },
      { label: "Keyboard shortcuts", hint: "?", run: () => this.openShortcuts() },
      {
        label: `Picture in picture`,
        hint: document.pictureInPictureEnabled ? "P" : "n/a",
        run: () => void this.togglePictureInPicture(),
      },
      { label: "About LiveX", hint: "", run: () => this.openAbout() },
    ];

    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.setAttribute("role", "menuitem");

      const label = document.createElement("span");
      label.textContent = item.label;
      const hint = document.createElement("span");
      hint.className = "font-mono text-[10px] text-neutral-500";
      hint.textContent = item.hint;

      button.append(label, hint);
      button.addEventListener("click", () => {
        menu.remove();
        item.run();
      });
      menu.append(button);
    }

    document.body.append(menu);

    const dismiss = (event: Event): void => {
      if (event instanceof MouseEvent && menu.contains(event.target as Node)) return;
      menu.remove();
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("keydown", onEscape, true);
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") dismiss(event);
    };
    // Defer so the click that opened the menu does not immediately close it.
    setTimeout(() => {
      document.addEventListener("click", dismiss, true);
      document.addEventListener("keydown", onEscape, true);
    }, 0);

    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }

  /* ---------------------------------------------------------------- */
  /* Focus mode (roadmap 2.4)                                         */
  /* ---------------------------------------------------------------- */

  private toggleFocusMode(force?: boolean): void {
    const state = this.manager.getState();
    if (state !== "live" && state !== "paused") {
      this.announce("Focus mode is available during a session.");
      return;
    }

    const next = force ?? !document.body.classList.contains("focus-mode");
    document.body.classList.toggle("focus-mode", next);
    this.focusMode = next;

    const btn = document.getElementById("focus-btn");
    if (btn) btn.setAttribute("aria-pressed", String(next));

    if (next) {
      this.renderFocusClock();
      this.focusClockTimer = window.setInterval(() => this.renderFocusClock(), 500);
      this.announce("Focus mode on. Press Z or Escape to exit.");
    } else if (this.focusClockTimer !== null) {
      window.clearInterval(this.focusClockTimer);
      this.focusClockTimer = null;
      this.announce("Focus mode off.");
    }
  }

  private renderFocusClock(): void {
    const node = document.getElementById("focus-time");
    if (!node) return;
    const { currentTime, duration } = this.manager.getProgress();
    node.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  }

  /* ---------------------------------------------------------------- */
  /* Picture in picture (1.5)                                         */
  /* ---------------------------------------------------------------- */

  private async togglePictureInPicture(): Promise<void> {
    if (!document.pictureInPictureEnabled) {
      this.announce("Picture in picture is not available in this browser.");
      return;
    }
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (this.video.readyState === 0) {
        this.announce("Load a video before opening picture in picture.");
        return;
      }
      await this.video.requestPictureInPicture();
    } catch (error) {
      // Rejected by the browser (gesture requirements, unsupported codec path).
      console.warn("[ui] picture in picture unavailable", error);
      this.announce("Picture in picture could not be opened.");
    }
  }

  private announce(message: string): void {
    const announcer = document.getElementById("session-announcer");
    if (announcer) announcer.textContent = message;
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const tag = (target as HTMLElement | null)?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
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
    if (this.focusClockTimer !== null) {
      window.clearInterval(this.focusClockTimer);
      this.focusClockTimer = null;
    }
    document.body.classList.remove("focus-mode");
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
