/**
 * The Atlas camera: where the view looks (x, y in graph units at the
 * canvas's center) and its zoom k (screen pixels per graph unit), easing
 * toward a target (tx, ty, tk) so a fit or a zoom button glides.
 *
 * The pointer moves it with some mass: a wheel turn gives the zoom a
 * velocity that eases in and coasts out about the pointer (`wheelImpulse`),
 * and a pan let go while moving flings on and slows by friction
 * (`fling`). `stepCamera` runs one frame of all of it. A fit, a zoom button
 * or a new press stops any coasting (`stopCamera`).
 *
 * Plain arithmetic with no imports: the drawing views' `zoomAbout`
 * (drawing/usePanZoom.ts) is the same rule, but its module brings the
 * viewer's component library (React DOM) with it.
 */

export interface Camera {
  x: number;
  y: number;
  k: number;
  tx: number;
  ty: number;
  tk: number;
  /** Pan velocity, CSS pixels per frame (a fling). */
  vx?: number;
  vy?: number;
  /** Zoom velocity, in natural-log units per frame, about the anchor (ax, ay), CSS pixels on the canvas. */
  vz?: number;
  ax?: number;
  ay?: number;
}

export const ZOOM = { min: 0.3, max: 4, ease: 0.14, wheel: 1.0016, step: 1.35, fitMax: 2.6 } as const;

/**
 * The camera's mass: each frame the zoom velocity keeps `zoomFriction` of
 * itself and a fling's speed keeps `panFriction`; motion below `rest`
 * stops. A wheel turn's whole zoom (spread over the coast) equals the zoom
 * the same turn gives at once (`wheelZoom`).
 */
export const INERTIA = { zoomFriction: 0.86, panFriction: 0.9, rest: 0.02, maxFling: 60 } as const;

export const newCamera = (): Camera => ({ x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1 });

const clampZoom = (k: number) => Math.max(ZOOM.min, Math.min(ZOOM.max, k));

/** A canvas point (CSS pixels from its top left) in graph units. */
export function toWorld(cam: Camera, sx: number, sy: number, w: number, h: number): [number, number] {
  return [(sx - w / 2) / cam.k + cam.x, (sy - h / 2) / cam.k + cam.y];
}

/** A graph point on the canvas (CSS pixels from its top left). */
export function toScreen(cam: Camera, x: number, y: number, w: number, h: number): [number, number] {
  return [(x - cam.x) * cam.k + w / 2, (y - cam.y) * cam.k + h / 2];
}

/** Pixels a fit keeps clear at each side of the canvas. */
export interface FitInsets {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/** Two opposite insets, scaled down together when they would leave less than a third of `size`. */
function fitSides(size: number, a: number, b: number): [number, number] {
  const most = (size * 2) / 3;
  const sum = Math.max(0, a) + Math.max(0, b);
  if (sum <= most || sum === 0) return [Math.max(0, a), Math.max(0, b)];
  const f = most / sum;
  return [Math.max(0, a) * f, Math.max(0, b) * f];
}

/** Stop any coasting (a fling, a wheel's zoom): a fit, a button or a new press takes over. */
export function stopCamera(cam: Camera): void {
  cam.vx = 0;
  cam.vy = 0;
  cam.vz = 0;
}

/**
 * Aim at the box around `boxes` (each a center and a radius), with `pad`
 * pixels of margin, zoom clamped to 0.3-2.6. `instant`: there at once,
 * else the camera eases there. `left`, `right`, `top` and `bottom` keep that
 * many pixels clear at each side (floating panels, the minimap): the boxes
 * fit in what is left (an inset that would leave less than a third of the
 * canvas is reduced to that).
 */
export function fitTo(cam: Camera, boxes: readonly { x: number; y: number; r: number }[], w: number, h: number, pad: number, instant = false, insets: FitInsets = {}): void {
  if (!boxes.length) return;
  stopCamera(cam);
  const [left, right] = fitSides(w, insets.left ?? 0, insets.right ?? 0);
  const [top, bottom] = fitSides(h, insets.top ?? 0, insets.bottom ?? 0);
  const free = w - left - right;
  const freeH = h - top - bottom;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x - b.r);
    x1 = Math.max(x1, b.x + b.r);
    y0 = Math.min(y0, b.y - b.r);
    y1 = Math.max(y1, b.y + b.r);
  }
  let k = Math.min((free - pad * 2) / Math.max(x1 - x0, 1), (freeH - pad * 2) / Math.max(y1 - y0, 1));
  k = Math.max(ZOOM.min, Math.min(k, ZOOM.fitMax));
  // the boxes' center drawn at the center of the free area
  cam.tx = (x0 + x1) / 2 - (left - right) / 2 / k;
  cam.ty = (y0 + y1) / 2 - (top - bottom) / 2 / k;
  cam.tk = k;
  if (instant) {
    cam.x = cam.tx;
    cam.y = cam.ty;
    cam.k = k;
  }
}

/** Zoom about a canvas point by a wheel's deltaY at once: the graph point under the pointer stays put. */
export function wheelZoom(cam: Camera, sx: number, sy: number, deltaY: number, w: number, h: number): void {
  const k = clampZoom(cam.tk * Math.pow(ZOOM.wheel, -deltaY));
  const [wx, wy] = toWorld(cam, sx, sy, w, h);
  cam.k = cam.tk = k;
  // the graph point (wx, wy) is drawn under the pointer again
  cam.x = cam.tx = wx - (sx - w / 2) / k;
  cam.y = cam.ty = wy - (sy - h / 2) / k;
}

/**
 * A wheel turn with inertia: the zoom gains a velocity about the pointer,
 * eases in and coasts out over the next frames (`stepCamera`). The whole
 * zoom of one turn equals `wheelZoom`'s for the same `deltaY`.
 */
export function wheelImpulse(cam: Camera, sx: number, sy: number, deltaY: number): void {
  cam.vx = 0;
  cam.vy = 0;
  // a fit or a button's glide stops where the camera is: the wheel takes over
  cam.tx = cam.x;
  cam.ty = cam.y;
  cam.tk = cam.k;
  cam.vz = (cam.vz ?? 0) + -deltaY * Math.log(ZOOM.wheel) * (1 - INERTIA.zoomFriction);
  cam.ax = sx;
  cam.ay = sy;
}

/** Let a pan go with a velocity (CSS pixels per frame, the pointer's): the view coasts on and slows. */
export function fling(cam: Camera, vx: number, vy: number): void {
  const s = Math.hypot(vx, vy);
  const f = s > INERTIA.maxFling ? INERTIA.maxFling / s : 1;
  cam.vx = vx * f;
  cam.vy = vy * f;
  cam.vz = 0;
}

/** Ease the zoom toward `factor` times its target (the + and - buttons and keys), about the center. */
export function zoomBy(cam: Camera, factor: number): void {
  stopCamera(cam);
  cam.tk = clampZoom(cam.tk * factor);
}

/** Pan by a pointer's movement in CSS pixels (the graph follows the pointer). */
export function panBy(cam: Camera, dx: number, dy: number): void {
  cam.x -= dx / cam.k;
  cam.y -= dy / cam.k;
  cam.tx = cam.x;
  cam.ty = cam.y;
}

/** One frame: a wheel's coasting zoom, a fling's coasting pan, else the glide toward the target. Whether the camera still moves. */
export function stepCamera(cam: Camera, w: number, h: number): boolean {
  let moving = false;
  const vz = cam.vz ?? 0;
  if (Math.abs(vz) > 1e-4) {
    const k = clampZoom(cam.k * Math.exp(vz));
    const sx = cam.ax ?? w / 2;
    const sy = cam.ay ?? h / 2;
    const [wx, wy] = toWorld(cam, sx, sy, w, h);
    cam.k = cam.tk = k;
    cam.x = cam.tx = wx - (sx - w / 2) / k;
    cam.y = cam.ty = wy - (sy - h / 2) / k;
    // at a limit the zoom stops at once
    cam.vz = k === ZOOM.min || k === ZOOM.max ? 0 : vz * INERTIA.zoomFriction;
    moving = true;
  } else cam.vz = 0;
  const vx = cam.vx ?? 0;
  const vy = cam.vy ?? 0;
  if (Math.abs(vx) + Math.abs(vy) > INERTIA.rest) {
    panBy(cam, vx, vy);
    cam.vx = vx * INERTIA.panFriction;
    cam.vy = vy * INERTIA.panFriction;
    moving = true;
  } else {
    cam.vx = 0;
    cam.vy = 0;
  }
  if (moving) return true;
  return easeCamera(cam);
}

/** One frame of easing toward the target; whether the camera is still moving. */
export function easeCamera(cam: Camera): boolean {
  if (Math.abs(cam.tx - cam.x) > 0.05 || Math.abs(cam.ty - cam.y) > 0.05 || Math.abs(cam.tk - cam.k) > 0.0005) {
    cam.x += (cam.tx - cam.x) * ZOOM.ease;
    cam.y += (cam.ty - cam.y) * ZOOM.ease;
    cam.k += (cam.tk - cam.k) * ZOOM.ease;
    return true;
  }
  return false;
}

/** Jump to the target (not live: no glide). */
export function snapCamera(cam: Camera): void {
  cam.x = cam.tx;
  cam.y = cam.ty;
  cam.k = cam.tk;
}
