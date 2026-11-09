/**
 * The 2D view: a center in board millimeters, a scale in CSS pixels per millimeter, and whether the board is seen
 * from below (mirrored left to right). Screen coordinates are CSS pixels from the canvas's top left, y down; the
 * board is +Y up.
 */
import type { Rect } from "./geom.js";

export interface View {
  cx: number;
  cy: number;
  /** CSS pixels per millimeter. */
  s: number;
  /** Seen from the bottom: x mirrored. */
  flip: boolean;
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4000;

export function toScreen(v: View, w: number, h: number, x: number, y: number): { x: number; y: number } {
  return { x: w / 2 + (v.flip ? -1 : 1) * (x - v.cx) * v.s, y: h / 2 - (y - v.cy) * v.s };
}

export function toWorld(v: View, w: number, h: number, sx: number, sy: number): { x: number; y: number } {
  return { x: v.cx + ((v.flip ? -1 : 1) * (sx - w / 2)) / v.s, y: v.cy - (sy - h / 2) / v.s };
}

/** Space floating panels cover on each side of the canvas (CSS pixels). */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/** The view that shows `rect` whole in the part of the canvas the insets leave clear, with a margin. */
export function fitRect(rect: Rect, w: number, h: number, insets: Insets = NO_INSETS, flip = false, margin = 0.92): View {
  let cw = w - insets.left - insets.right;
  let ch = h - insets.top - insets.bottom;
  let ins = insets;
  // a small canvas: fit under the panels instead of into a sliver
  if (cw < w / 3 || ch < h / 3) {
    cw = w;
    ch = h;
    ins = NO_INSETS;
  }
  const rw = Math.max(1e-3, rect[2] - rect[0]);
  const rh = Math.max(1e-3, rect[3] - rect[1]);
  const s = clampScale(Math.min(cw / rw, ch / rh) * margin);
  // the clear area's center, in screen pixels, is where the rect's center goes
  const sx = ins.left + cw / 2;
  const sy = ins.top + ch / 2;
  const mx = (rect[0] + rect[2]) / 2;
  const my = (rect[1] + rect[3]) / 2;
  return { cx: mx - ((flip ? -1 : 1) * (sx - w / 2)) / s, cy: my + (sy - h / 2) / s, s, flip };
}

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom by `factor` keeping the board point under the screen point (sx, sy) where it is. */
export function zoomAbout(v: View, w: number, h: number, sx: number, sy: number, factor: number): View {
  const p = toWorld(v, w, h, sx, sy);
  const s = clampScale(v.s * factor);
  const next = { ...v, s };
  const q = toWorld(next, w, h, sx, sy);
  return { ...next, cx: v.cx + (p.x - q.x), cy: v.cy + (p.y - q.y) };
}

/** Pan by a screen delta. */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - ((v.flip ? -1 : 1) * dx) / v.s, cy: v.cy + dy / v.s };
}

/** The board rectangle the canvas shows. */
export function visibleRect(v: View, w: number, h: number): Rect {
  const a = toWorld(v, w, h, 0, 0);
  const b = toWorld(v, w, h, w, h);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

/** A grid step at least `minPx` on screen: the base grid times 1, 2, 5, 10, 20, 50 ... */
export function gridStep(base: number, s: number, minPx = 12): number {
  let step = base;
  const mult = [2, 2.5, 2];
  let i = 0;
  while (step * s < minPx && step < 1e6) step *= mult[i++ % 3];
  return step;
}
