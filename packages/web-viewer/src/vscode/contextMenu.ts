/**
 * The viewer tab's right-click (M9, R1-E, 2026-11-01): no VS Code Cut/Copy/Paste menu over the viewer, and the
 * hook for R2's own context menu. No React and no DOM types here (only the shapes it reads): the extension's tests
 * load it.
 */
import type { ContextMenuPick, FromWebview } from "./protocol.js";

/** DEFAULT (R1-E, M9): a right press that moves more than this many CSS pixels before its release is a pan, not a click. */
export const CONTEXT_MENU_DRAG_PX = 4;

/** What the handler reads of a pointer or mouse event. */
export interface PointerLike {
  button?: number;
  clientX: number;
  clientY: number;
  target?: unknown;
  preventDefault?: () => void;
}

/** What it needs of the element it listens on. */
export interface ListenerTarget {
  addEventListener(type: "pointerdown" | "contextmenu", listener: (e: PointerLike) => void, capture?: boolean): void;
  removeEventListener(type: "pointerdown" | "contextmenu", listener: (e: PointerLike) => void, capture?: boolean): void;
}

/** What it needs of the document: the elements under a point (the 3D view's canvas among them). */
export interface PointDocument {
  elementsFromPoint?(x: number, y: number): ArrayLike<{ tagName: string; getBoundingClientRect?(): { left: number; top: number; width: number; height: number } }>;
}

/** Whether a right-click lands where VS Code's own menu belongs: text a person edits, or a row that names its own menu. */
function ownMenu(target: unknown): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null | undefined;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-vscode-context]');
}

/**
 * M9 (R1-E, 2026-11-01): a right-click on the viewer shows no VS Code Cut/Copy/Paste menu. The default menu is
 * prevented everywhere in the viewer except over text fields and hierarchy rows (those keep VS Code's menus, the
 * rows' `webview/context` items). The right-drag pan is untouched (only the `contextmenu` event is stopped). A
 * right-click that did not drag says where it was and what the 3D view has under the pointer (`contextmenu`), the
 * hook for R2's own context menu. Returns the cleanup.
 */
export function suppressContextMenu(element: ListenerTarget, post: (m: FromWebview) => void, doc: PointDocument | undefined = (globalThis as { document?: PointDocument }).document): () => void {
  let down: { x: number; y: number } | undefined;
  const onDown = (e: PointerLike) => {
    if (e.button === 2) down = { x: e.clientX, y: e.clientY };
  };
  const onMenu = (e: PointerLike) => {
    if (ownMenu(e.target)) return;
    e.preventDefault?.();
    const from = down;
    down = undefined;
    // a pan's release (the right button dragged) is not a click
    if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > CONTEXT_MENU_DRAG_PX) return;
    const hub = (globalThis as unknown as Record<string, { pick?: (fx: number, fy: number) => unknown; view?: string } | undefined>).__uhdViewHub;
    let pick: ContextMenuPick | undefined;
    try {
      // the 3D view's canvas under the pointer, if any: its pick at that point (fractions from its top left)
      const under = doc?.elementsFromPoint ? Array.from(doc.elementsFromPoint(e.clientX, e.clientY)) : [];
      const r = under.find((x) => x.tagName === "CANVAS")?.getBoundingClientRect?.();
      const hit = r && r.width > 0 && r.height > 0 && hub?.pick ? (hub.pick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) as Record<string, unknown> | null) : null;
      if (hit) {
        pick = {
          ...(typeof hit.instancePath === "string" ? { instancePath: hit.instancePath } : {}),
          ...(typeof hit.body === "string" ? { body: hit.body } : {}),
          ...(typeof hit.harness === "string" ? { harness: hit.harness } : {}),
          ...(Number.isInteger(hit.face) ? { face: hit.face as number } : {}),
        };
      }
    } catch {
      // no pick: the menu still knows where it was asked for
    }
    post({ type: "contextmenu", x: e.clientX, y: e.clientY, ...(hub?.view ? { view: hub.view } : {}), ...(pick && Object.keys(pick).length ? { pick } : {}) });
  };
  element.addEventListener("pointerdown", onDown, true);
  element.addEventListener("contextmenu", onMenu);
  return () => {
    element.removeEventListener("pointerdown", onDown, true);
    element.removeEventListener("contextmenu", onMenu);
  };
}
