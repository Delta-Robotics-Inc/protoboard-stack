/**
 * @protoboardai/web-viewer: Protoboard's browser shell (docs/specs/viewer-stack.md).
 *
 *   import { mountWebViewer } from "@protoboardai/web-viewer";  // or dist/web-viewer.js
 *   const viewer = mountWebViewer(el, { bundleUrl, themeChoice: "protoboard-dark", ...hostCallbacks });
 *
 * The handle is the viewer's (`focus`, `select`, `drill`, `setView`, `post`,
 * `update`): hosts drive it with the same messages as the plain viewer.
 */
import "@deltarobotics/uhd-viewer/components.css";
import "./styles.css";
import { renderViewer, type ViewerHandle } from "@deltarobotics/uhd-viewer/components";
import { WebShell, type WebViewerOptions } from "./Shell.js";

export { WebShell, type WebViewerOptions };
export { createDevPartsData, type DevPartsOptions } from "./partsData.js";
export type { ViewerHandle };

export function mountWebViewer(element: HTMLElement, options: WebViewerOptions): ViewerHandle {
  if (!options.bundle && !options.bundleUrl) throw new Error("mountWebViewer: give a bundle or a bundleUrl");
  // the pair view is a tab of the shell's own: the viewer hands it over (and tells a host too)
  const pairRequests = new EventTarget();
  const hostPair = options.onOpenPair;
  return renderViewer(
    element,
    {
      ...options,
      pairRequests,
      onOpenPair: (request) => {
        pairRequests.dispatchEvent(new CustomEvent("open", { detail: request }));
        hostPair?.(request);
      },
    },
    WebShell,
  );
}
