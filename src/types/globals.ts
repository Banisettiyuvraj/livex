/** Global type augmentation for LiveX-specific DOM/browser APIs. */

export {};

declare global {
  interface HTMLVideoElement {
    webkitEnterFullscreen?: () => void;
    webkitExitFullscreen?: () => void;
    webkitDisplayingFullscreen?: boolean;
  }

  interface HTMLElement {
    webkitRequestFullscreen?: () => Promise<void> | void;
  }

  interface Document {
    webkitExitFullscreen?: () => Promise<void> | void;
    webkitFullscreenElement?: Element | null;
  }

  interface WindowEventMap {
    webkitbeginfullscreen: Event;
    webkitendfullscreen: Event;
  }

  interface DocumentEventMap {
    webkitfullscreenchange: Event;
  }
}
