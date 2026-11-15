/**
 * The extension's System Map panel (`WebviewConfig.mode === "sysmap"`): the
 * System Map alone, full window, with no project, no bundle and no dev
 * server. Same script and stylesheet as a viewer tab (the extension ships no
 * other file), same theme (the VS Code shell's adapter, ./Shell.tsx), and the
 * map from the extension (./sysmapData.ts).
 */
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@deltarobotics/uhd-viewer/components";
import { SystemMap, type HostAdapter } from "@protoboardai/views";
import { vscodeShellThemeAdapter } from "./Shell.js";
import { createVsCodeSysmapData, type VsCodeSysmapData } from "./sysmapData.js";
import type { FromWebview, ToWebview } from "./protocol.js";

interface VsCodeApi {
  postMessage(message: unknown): void;
}

function SystemMapPage({ data, post }: { data: VsCodeSysmapData; post: (m: FromWebview) => void }) {
  const adapter = useMemo(() => vscodeShellThemeAdapter(), []);
  const host = useMemo<HostAdapter>(() => ({ kind: "vscode", notify: (message, severity) => post({ type: "notify", message, ...(severity ? { severity } : {}) }) }), [post]);
  return (
    <ThemeProvider adapter={adapter} className="pb-vscode pb-sysmap">
      <div className="relative size-full overflow-hidden bg-background text-fg">
        <SystemMap data={data} host={host} />
      </div>
    </ThemeProvider>
  );
}

/** The page's `--vscode-*` variables and body classes (the answer to `reportTheme`, in a viewer tab too). */
export function themeReport(doc: Document = document): Extract<FromWebview, { type: "theme" }> {
  const style = doc.documentElement.style;
  const vars: Record<string, string> = {};
  for (let i = 0; i < style.length; i++) {
    const k = style[i];
    if (k.startsWith("--vscode-")) vars[k] = style.getPropertyValue(k).trim();
  }
  return { type: "theme", vars, classes: [...doc.body.classList], ...(doc.body.dataset.vscodeThemeId ? { themeId: doc.body.dataset.vscodeThemeId } : {}) };
}

/** Mount the System Map in `element` (the page's #viewer); messages from the extension go to its data. */
export function mountVsCodeSystemMap(element: HTMLElement, vscode: VsCodeApi) {
  const post = (m: FromWebview) => vscode.postMessage(m);
  const data = createVsCodeSysmapData(post);
  window.addEventListener("message", (e) => {
    const m = e.data as ToWebview | undefined;
    if (!m || typeof m !== "object") return;
    if (m.type === "sysmap") data.receive(m);
    // the extension's tests read the token set the panel got, as for a viewer tab
    else if (m.type === "reportTheme") post(themeReport());
  });
  const root = createRoot(element);
  root.render(<SystemMapPage data={data} post={post} />);
  post({ type: "ready" });
  return { data, unmount: () => root.unmount() };
}
