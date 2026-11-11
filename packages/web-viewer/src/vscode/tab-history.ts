/**
 * A viewer tab's own back and forward (R2-E, walkthrough F1, 2026-11-02). Kevin: "there needs to be a back button
 * for all of Protoboard"; "I want the default mode to change the current window".
 *
 * Two histories meet in the header's back and forward buttons:
 * - the viewer's own (R2-A, uhd-viewer `cad/nav/history.ts`): inside the 3D view, the levels drilled into and the
 *   parts framed or isolated; it says `canBack` / `canForward` (`uhd-viewer:history`) and moves on
 *   `uhd-viewer:historyGo`;
 * - the tab's (this file): the places the 3D view's history does not see: a change of view (Diagram, 3D, BOM, a
 *   domain view) and a change of level outside the 3D view (a diagram drill, a breadcrumb).
 *
 * Back on the 3D view goes through the viewer's history first, then the tab's; Forward the other way round (the
 * tab's places are older than the 3D view's). On any other view only the tab's history counts: the viewer's history
 * lives on while the 3D view is hidden, and a Back there must not move a view nobody sees.
 *
 * No React and no VS Code API here: the extension's tests import this file too.
 */
import type { TabLocation } from "./protocol.js";

/** DEFAULT (R2-E): places a tab keeps each way; the oldest drop past this (the viewer keeps 50 too). */
export const MAX_TAB_HISTORY = 50;

export interface TabHistory {
  /** Older places, the nearest last. */
  back: TabLocation[];
  /** Places Back left, the nearest last. */
  forward: TabLocation[];
}

export const emptyTabHistory = (): TabHistory => ({ back: [], forward: [] });

const same = (a: TabLocation | undefined, b: TabLocation | undefined) => !!a && !!b && a.path === b.path && a.view === b.view;

/**
 * Whether a move from one place to another is the tab's to remember: a change of view, or a change of level on a
 * view that is not 3D (a level change inside the 3D view is the viewer's own history, when the viewer keeps one:
 * `viewerKeeps3d`; a viewer from before R2-A says nothing, and the tab remembers 3D levels itself).
 */
export function tabRecords(from: TabLocation, to: TabLocation, viewerKeeps3d = true): boolean {
  if (same(from, to)) return false;
  if (from.view !== to.view) return true;
  return from.view !== "3d" || !viewerKeeps3d;
}

/** A move the person made (not a step back or forward): `from` goes on the back list, the forward list empties. */
export function recordMove(h: TabHistory, from: TabLocation, to: TabLocation, viewerKeeps3d = true): TabHistory {
  if (!tabRecords(from, to, viewerKeeps3d)) return h;
  const back = same(h.back[h.back.length - 1], from) ? h.back : [...h.back, { path: from.path, view: from.view }];
  return { back: back.slice(-MAX_TAB_HISTORY), forward: [] };
}

/** One step of the tab's history from `here`: the place to show and the history after it, or undefined at an end. */
export function stepTab(h: TabHistory, here: TabLocation, delta: -1 | 1): { to: TabLocation; history: TabHistory } | undefined {
  const from = delta < 0 ? [...h.back] : [...h.forward];
  let to = from.pop();
  // a place equal to where the tab is now (the 3D view's own steps came back to it) is passed over
  while (to && same(to, here)) to = from.pop();
  if (!to) return undefined;
  const other = delta < 0 ? h.forward : h.back;
  const pushed = same(other[other.length - 1], here) ? other : [...other, { path: here.path, view: here.view }];
  const history = delta < 0 ? { back: from, forward: pushed.slice(-MAX_TAB_HISTORY) } : { back: pushed.slice(-MAX_TAB_HISTORY), forward: from };
  return { to, history };
}

/** What the viewer's own history allows now (`uhd-viewer:history`), as far as the header needs it. */
export interface ViewerHistoryFlags {
  canBack: boolean;
  canForward: boolean;
}

/** Where Back goes: the viewer's 3D history, the tab's, or nowhere. */
export function backGoesTo(view: string, viewer: ViewerHistoryFlags | null | undefined, h: TabHistory, here: TabLocation): "viewer" | "tab" | "none" {
  if (view === "3d" && viewer?.canBack) return "viewer";
  return stepTab(h, here, -1) ? "tab" : "none";
}

/** Where Forward goes: the tab's history first (its places are older), then the viewer's 3D history. */
export function forwardGoesTo(view: string, viewer: ViewerHistoryFlags | null | undefined, h: TabHistory, here: TabLocation): "viewer" | "tab" | "none" {
  if (stepTab(h, here, 1)) return "tab";
  return view === "3d" && viewer?.canForward ? "viewer" : "none";
}

/** A tab history as the webview's saved state holds it (anything else: empty). */
export function parseTabHistory(v: unknown): TabHistory {
  const list = (x: unknown): TabLocation[] =>
    Array.isArray(x)
      ? x
          .filter((l): l is TabLocation => !!l && typeof l === "object" && typeof (l as TabLocation).path === "string" && typeof (l as TabLocation).view === "string" && (l as TabLocation).path.length <= 1024 && (l as TabLocation).view.length <= 64)
          .slice(-MAX_TAB_HISTORY)
          .map((l) => ({ path: l.path, view: l.view }))
      : [];
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { back: list(o.back), forward: list(o.forward) };
}
