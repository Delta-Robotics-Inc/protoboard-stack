/**
 * Opening in place or in a new tab (R2-E, walkthrough F1, 2026-11-02). Kevin: "I want the default mode to change the
 * current window and the secondary right-click mode to open in a new tab; maybe we can change that in the settings".
 * No VS Code API here: the tests import it.
 *
 * - The viewer's `uhd-viewer:navigate` (R2-A: a double-click is `replace`, Ctrl+double-click and the menu's "Open in
 *   new tab" are `newTab`): `replace` moves the tab in place while `viewer.openModelsInPlace` is on (DEFAULT), else
 *   a new tab, as before. A module opens on its 3D view in the tab (`go`); a model artifact of a part with no body of
 *   its own opens in the CAD viewer tab, in the same editor group (not beside it), so VS Code's own Go Back returns.
 * - The older `uhd-viewer:openModule` (a viewer from before R2-A, the hierarchy's "Open in New Tab") stays a new tab.
 * - An Inspector card (the 3D model card, a STEP or GLB card): in place unless Ctrl was held (the page tells the
 *   click's modifiers, inspectorView.ts) or the setting is off.
 */
import type { ArtifactEntry } from "./artifacts.js";
import type { NavigateTarget } from "../../web-viewer/src/vscode/protocol.js";

export type NavDecision =
  /** Show the module on its 3D view in this tab. */
  | { kind: "go"; path: string; view: "3d" }
  /** A new viewer tab on the module's 3D view, beside nothing (VS Code's own placement). */
  | { kind: "tab"; path: string; view: "3d" }
  /** A model file of a part: the CAD viewer tab, in this tab's group (`sameGroup`) or beside it. */
  | { kind: "model"; defId: string; artifactId: string; path?: string; sameGroup: boolean };

export function decideNavigate(m: { target: NavigateTarget; how: "replace" | "newTab" }, inPlace: boolean): NavDecision {
  const here = m.how === "replace" && inPlace;
  if ("module" in m.target) return here ? { kind: "go", path: m.target.module, view: "3d" } : { kind: "tab", path: m.target.module, view: "3d" };
  return { kind: "model", ...m.target.model, sameGroup: here };
}

/**
 * What an Inspector card's model opens in place: the module's own 3D view when the file is that module's body (its
 * role, or a STEP or GLB named `body`/`board` as the stack writes them), else the file itself in the CAD viewer tab.
 */
export function cardOpensModule(a: Pick<ArtifactEntry, "role" | "format" | "resolved" | "filePath">): boolean {
  const file = (a.resolved ?? a.filePath ?? "").replace(/\\/g, "/").toLowerCase();
  const cad = /\.(step|stp|glb|gltf)$/.test(file) || ["step", "stp", "glb", "gltf"].includes((a.format ?? "").toLowerCase());
  if (!cad) return false;
  if (a.role === "body" || a.role === "model") return true;
  return /\/(body|board)\.(step|stp|glb|gltf)$/.test(file);
}

/** The click's modifiers as the Inspector page last said them, if they are about this click (DEFAULT: 1.5 s). */
export function clickWantsNewTab(last: { newTab: boolean; at: number } | undefined, now = Date.now()): boolean {
  return !!last && now - last.at < 1500 && last.newTab;
}
