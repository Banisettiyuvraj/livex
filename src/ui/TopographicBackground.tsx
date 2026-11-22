import { createRoot, type Root } from "react-dom/client";
import { Example } from "../Example";

export { Example };

let root: Root | null = null;

export function mountTopographicBackground(host: HTMLElement): () => void {
  root ??= createRoot(host);
  root.render(<Example />);

  // Forward pointer events from the window to the host element
  // so the topographic hover/rings effect responds across the whole site,
  // even over UI overlays and drop targets.
  const handlePointer = (event: PointerEvent) => {
    const flowHost = host.querySelector<HTMLElement>(".topographic-flow");
    if (flowHost) {
      flowHost.dispatchEvent(new PointerEvent(event.type, event));
    }
  };

  window.addEventListener("pointermove", handlePointer, { passive: true });
  window.addEventListener("pointerdown", handlePointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", handlePointer, { passive: true });

  return () => {
    window.removeEventListener("pointermove", handlePointer);
    window.removeEventListener("pointerdown", handlePointer);
    document.documentElement.removeEventListener("pointerleave", handlePointer);
    root?.unmount();
    root = null;
  };
}
