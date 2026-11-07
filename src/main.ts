/**
 * LiveX application entry point.
 *
 * Composition root: builds the playback adapter, capability detector, session
 * manager and UI, then wires them together. This is the only file that decides
 * *which* playback engine is used, which is what keeps the UI engine-agnostic.
 */

import { BrowserVideoAdapter } from "./playback/BrowserVideoAdapter";
import { PlaybackCapabilityDetector } from "./playback/PlaybackCapabilities";
import { LocalFileManager } from "./files/LocalFileManager";
import { SessionManager } from "./session/SessionManager";
import { WorkspaceUI } from "./ui/WorkspaceUI";

function boot(): void {
  const video = document.getElementById("video");
  if (!(video instanceof HTMLVideoElement)) {
    throw new Error("LiveX: the #video element is missing from the page");
  }

  const readySlot = video.parentElement;
  const activeSlot = document.querySelector<HTMLElement>("#state-active .aspect-video");
  if (!readySlot || !activeSlot) {
    throw new Error("LiveX: video containers are missing from the page");
  }

  // Native playback is the supported baseline engine. A WebAssembly adapter
  // can be substituted here once docs/FEASIBILITY-WASM.md passes its gate.
  const adapter = new BrowserVideoAdapter(video);
  const detector = new PlaybackCapabilityDetector(video);
  const files = new LocalFileManager(detector);
  const manager = new SessionManager(adapter);

  const ui = new WorkspaceUI({
    manager,
    adapter,
    files,
    activeVideoSlot: activeSlot,
    readyVideoSlot: readySlot,
  });

  window.addEventListener("beforeunload", () => ui.dispose());

  if (import.meta.env.DEV) {
    // Developer console helper — capability matrix only, never file contents.
    console.info(
      "%cLiveX dev — native capability report",
      "color:#a5a1f8",
      detector.describeSupport(),
    );
    Object.assign(window, { __livex: { adapter, manager, files, ui } });
  }

  console.info("LiveX ready — local playback only, nothing is uploaded.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
