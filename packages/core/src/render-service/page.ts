/**
 * What the render service does inside the viewer page (PB-1180), as small
 * steps over a CDP browser: open a level, pick a tab, wait for it to draw,
 * turn the document mode on (no chrome), set an exact zoom on a 2D tab, set
 * the 3D view state, read `window.__cad.observe()`, pick, overlay, compare
 * frames.
 *
 * The page is the stack's web viewer as `protoboard dev` serves it (the same
 * shell `views check` opens): tabs are `[role=tablist] [role=tab]` buttons
 * whose tooltip starts with the view's title, the active view is the
 * `[role=tabpanel]`, the 3D tab exposes `window.__cad`.
 */
import type { Browser } from "../cdp.js";
import type { Bounds, RefNode } from "./project.js";
import type { CameraState, ViewState } from "./schema.js";

/** The browser surface the steps need (a fake implements it in tests). */
export type PageBrowser = Pick<Browser, "navigate" | "evaluate" | "setViewport" | "capture" | "takeErrors">;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In the page: a tab button's view title (its tooltip is "<title>[ · planned][: description]"). */
const TITLE = `(b.getAttribute('data-tooltip') || '').split(/ · |: /)[0].trim()`;
export const TABS = `[...document.querySelectorAll('[role=tablist] [role=tab]')].map((b) => ${TITLE})`;
export const ACTIVE = `(document.querySelector('[role=tabpanel]')?.getAttribute('aria-label') || '')`;

/** The page URL for a level and theme (`drill` is the instance path with commas, as the shell reads it). */
export function levelUrl(base: string, level: string, theme: string): string {
  const q = new URLSearchParams({ theme });
  if (level) q.set("drill", level.split("/").join(","));
  return `${base}${base.includes("?") ? "&" : "?"}${q.toString()}`;
}

/** Waits until the shell shows its tabs; returns their titles. */
export async function waitForTabs(b: PageBrowser, timeoutMs: number): Promise<string[]> {
  let shown: string[] = [];
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; await sleep(200)) {
    shown = await b.evaluate<string[]>(TABS);
    if (shown.length) return shown;
  }
  return shown;
}

/** The tab's title for an id: the resolver's answer, else a case-insensitive match on the titles shown (`3d` → `3D`). */
export function matchTitle(view: string, shown: string[], resolved?: string): string | undefined {
  if (resolved && shown.includes(resolved)) return resolved;
  const v = view.toLowerCase();
  return shown.find((t) => t.toLowerCase() === v) ?? shown.find((t) => t.toLowerCase().replace(/[^a-z0-9]/g, "") === v.replace(/[^a-z0-9]/g, ""));
}

/** Clicks a tab by title and waits until its panel is the active one. */
export async function activateTab(b: PageBrowser, title: string, timeoutMs = 10000): Promise<void> {
  if ((await b.evaluate<string>(ACTIVE)) === title) return;
  await b.evaluate(`[...document.querySelectorAll('[role=tablist] [role=tab]')].find((b) => ${TITLE} === ${JSON.stringify(title)})?.click()`);
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; await sleep(100)) if ((await b.evaluate<string>(ACTIVE)) === title) return;
  throw new Error(`the ${title} tab did not open`);
}

/** In the page: what the active panel holds (drawings, rows, an empty state). Same reading as `views check`. */
export const PANEL = `(() => {
  const panel = document.querySelector('[role=tabpanel]');
  if (!panel) return { panel: false };
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 150; };
  const drawings = panel.querySelectorAll('.react-flow__node').length + [...panel.querySelectorAll('svg')].filter((s) => big(s) && s.querySelectorAll('*').length > 20).length
    + [...panel.querySelectorAll('canvas')].filter(big).length;
  const rows = panel.querySelectorAll('[role=row], tr, [data-line]').length;
  const empties = [...panel.querySelectorAll('div.flex.flex-col.items-center.justify-center.text-center')]
    .filter((e) => e.offsetParent !== null && e.querySelector('.uppercase'))
    .map((e) => e.querySelector('.uppercase').textContent.trim());
  return { panel: true, drawings, rows, empties, cad: !!panel.querySelector('.cad-view') };
})()`;

export interface PanelState {
  panel: boolean;
  drawings?: number;
  rows?: number;
  empties?: string[];
  cad?: boolean;
}

/** In the page: the 3D view has loaded every model and its last frame is settled. */
export const CAD_SETTLED = `!!(window.__cad && window.__cad.ready && window.__cad.ready() && window.__cad.settled())`;

/**
 * Waits for the active tab to draw: the 3D tab until `__cad` is ready and
 * settled, another tab until it has a drawing or rows and the count holds
 * across two looks (or shows an empty state for 3 s). Returns how long it
 * took, and whether it timed out.
 */
export async function waitDrawn(b: PageBrowser, view: string, timeoutMs: number): Promise<{ ms: number; timedOut: boolean; panel: PanelState }> {
  const t0 = Date.now();
  let panel: PanelState = { panel: false };
  let last = -1;
  let stable = 0;
  while (Date.now() - t0 < timeoutMs) {
    panel = await b.evaluate<PanelState>(PANEL);
    if (panel.cad || view === "3d") {
      if (await b.evaluate<boolean>(CAD_SETTLED)) return { ms: Date.now() - t0, timedOut: false, panel };
      await sleep(150);
      continue;
    }
    const n = (panel.drawings ?? 0) + (panel.rows ?? 0);
    if ((panel.empties ?? []).length && !n && Date.now() - t0 > 3000) return { ms: Date.now() - t0, timedOut: false, panel };
    stable = n > 0 && n === last ? stable + 1 : 0;
    last = n;
    if (stable >= 2) return { ms: Date.now() - t0, timedOut: false, panel };
    await sleep(250);
  }
  return { ms: Date.now() - t0, timedOut: true, panel };
}

/** The document mode's stylesheet: the active view fills the page; header, panels, toolbars, legends, toasts and the dev pill are hidden. */
export const DOC_CSS = `
[role=tabpanel] { position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147482000 !important; margin: 0 !important; }
header, nav[aria-label=Views], nav[aria-label=Level], #pb-dev, [data-chrome], [role=status], [role=alert], .toast, [data-sonner-toaster],
.uhd-hierarchy-dock, .uhd-hierarchy, section[aria-label=Hierarchy],
[role=tabpanel] [role=toolbar], [role=tabpanel] aside, [role=tabpanel] .inspector, [role=tabpanel] .uhd-toolbar, [role=tabpanel] .uhd-legend,
[role=tabpanel] .cad-scope, [role=tabpanel] .react-flow__attribution, [role=tabpanel] .react-flow__minimap, [role=tabpanel] .react-flow__controls,
[role=tabpanel] .react-flow__background { display: none !important; }
`;

/** Turns the document mode on (idempotent) or off. */
export async function setDocumentMode(b: PageBrowser, on: boolean): Promise<void> {
  await b.evaluate(`(() => {
    let s = document.getElementById('pb-capture-doc');
    if (${on} && !s) { s = document.createElement('style'); s.id = 'pb-capture-doc'; s.textContent = ${JSON.stringify(DOC_CSS)}; document.head.appendChild(s); }
    if (!${on} && s) s.remove();
    window.dispatchEvent(new Event('resize'));
    return true;
  })()`);
}

/** Two animation frames (layout and a draw after a change). */
export const FRAMES = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`;

/** The drawing area of the active view in CSS px: the 3D canvas, else the panel. */
export async function viewRect(b: PageBrowser): Promise<{ x: number; y: number; width: number; height: number }> {
  return b.evaluate(`(() => {
    const panel = document.querySelector('[role=tabpanel]');
    const cs = panel ? [...panel.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height) : [];
    const r = cs[0] && cs[0].width > 50 ? cs[0] : (panel || document.body).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
}

/**
 * Sets the 3D view state and draws once (`window.__cad.set`, which renders
 * synchronously), then waits until the view is settled again. `set` takes the
 * capture keys (azimuth, elevation, distance, target, explode, labels) and,
 * since W2-A's view state, its keys too (camera, selection, highlight,
 * isolation, visibility, sections); other keys are passed unchanged.
 */
export async function applyCadState(b: PageBrowser, state: ViewState, timeoutMs: number): Promise<number> {
  const t0 = Date.now();
  await b.evaluate(`(() => { window.__cad.set(${JSON.stringify({ snap: true, ...state })}); return true; })()`);
  await b.evaluate(FRAMES);
  for (; Date.now() - t0 < timeoutMs; await sleep(100)) if (await b.evaluate<boolean>(CAD_SETTLED)) break;
  // the settled frame is drawn on demand: draw it once more so the canvas holds it for the capture
  await b.evaluate(`(() => { const c = window.__cad; c.set({ snap: true }); return true; })()`);
  return Date.now() - t0;
}

export interface Observed {
  camera: CameraState;
  nodes: (RefNode & { kind?: string; placeholder?: boolean })[];
  counts?: Record<string, number>;
  seq?: number;
}

/** The viewer's whole view state (W2-A's `__cad.get()`), when it offers it. */
export async function viewStateOf(b: PageBrowser): Promise<Record<string, unknown> | undefined> {
  return b.evaluate(`(() => window.__cad && typeof window.__cad.get === 'function' ? window.__cad.get() : undefined)()`);
}

export async function observeCad(b: PageBrowser): Promise<Observed | undefined> {
  return b.evaluate<Observed | undefined>(`(() => window.__cad && window.__cad.observe ? window.__cad.observe() : undefined)()`);
}

/** The viewer's own projection, when it offers one (`__cad.project(points)` → [[x, y, depth]] in CSS px of the canvas). */
export async function viewerProjection(b: PageBrowser, points: [number, number, number][]): Promise<[number, number, number][] | undefined> {
  return b.evaluate(`(() => window.__cad && typeof window.__cad.project === 'function' ? window.__cad.project(${JSON.stringify(points)}) : undefined)()`);
}

/**
 * Whether a node is hidden at a point of the view: the viewer's pick (its
 * BVH) at the point; hidden when the nearest hit is another part that lies
 * clearly in front of the node's centre.
 */
export async function hiddenAt(b: PageBrowser, rect: { x: number; y: number; width: number; height: number }, node: { instancePath: string; bounds: Bounds | null }, cssPx: [number, number], cam: CameraState): Promise<boolean | undefined> {
  const fx = (cssPx[0] - rect.x) / rect.width;
  const fy = (cssPx[1] - rect.y) / rect.height;
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return undefined;
  const hit = await b.evaluate<{ instancePath?: string; distance?: number } | null>(`(() => window.__cad && window.__cad.pick ? window.__cad.pick(${fx}, ${fy}) : null)()`);
  if (!hit) return false;
  const own = !!hit.instancePath && (hit.instancePath === node.instancePath || hit.instancePath.startsWith(`${node.instancePath}/`) || node.instancePath.startsWith(`${hit.instancePath}/`));
  if (own || !node.bounds || hit.distance === undefined) return !own;
  const [a, z] = node.bounds;
  const c = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (a[2] + z[2]) / 2];
  const toCentre = Math.hypot(c[0] - cam.position[0], c[1] - cam.position[1], c[2] - cam.position[2]);
  const halfDiag = Math.hypot(z[0] - a[0], z[1] - a[1], z[2] - a[2]) / 2;
  return hit.distance < toCentre - halfDiag;
}

/**
 * A 2D tab at an exact zoom: reads the diagram's extent in flow units from
 * the React Flow viewport (nodes, edges, edge labels), and returns the CSS
 * size that holds it at `zoom` with `padding`. `applyDiagramZoom` then sets
 * the viewport transform so the drawing starts at the padding.
 */
export async function diagramExtent(b: PageBrowser): Promise<{ minX: number; minY: number; maxX: number; maxY: number; scale: number } | undefined> {
  return b.evaluate(`(() => {
    const vp = document.querySelector('[role=tabpanel] .react-flow__viewport');
    if (!vp) return undefined;
    const m = /translate\\(([-\\d.e]+)px,\\s*([-\\d.e]+)px\\)\\s*scale\\(([-\\d.e]+)\\)/.exec(vp.style.transform || '');
    if (!m) return undefined;
    const tx = +m[1], ty = +m[2], s = +m[3];
    const pane = vp.parentElement.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const els = vp.querySelectorAll('.react-flow__node, .react-flow__edge path, .react-flow__edgelabel-renderer > *');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      minX = Math.min(minX, (r.left - pane.left - tx) / s); minY = Math.min(minY, (r.top - pane.top - ty) / s);
      maxX = Math.max(maxX, (r.right - pane.left - tx) / s); maxY = Math.max(maxY, (r.bottom - pane.top - ty) / s);
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY, scale: s } : undefined;
  })()`);
}

export async function applyDiagramZoom(b: PageBrowser, ext: { minX: number; minY: number }, zoom: number, padding: number): Promise<boolean> {
  const transform = `translate(${padding - ext.minX * zoom}px, ${padding - ext.minY * zoom}px) scale(${zoom})`;
  // React Flow writes its own transform back (a fit after the resize): hold ours while the capture runs
  const ok = await b.evaluate<boolean>(`(() => {
    const vp = document.querySelector('[role=tabpanel] .react-flow__viewport');
    if (!vp) return false;
    window.__pbZoomLock?.disconnect();
    const want = ${JSON.stringify(transform)};
    vp.style.transform = want;
    const lock = new MutationObserver(() => { if (vp.style.transform !== want) vp.style.transform = want; });
    lock.observe(vp, { attributes: true, attributeFilter: ['style'] });
    window.__pbZoomLock = lock;
    return true;
  })()`);
  if (!ok) return false;
  await b.evaluate(FRAMES);
  await sleep(250);
  await b.evaluate(FRAMES);
  return true;
}

/** Lets React Flow own its transform again. */
export async function releaseDiagramZoom(b: PageBrowser): Promise<void> {
  await b.evaluate(`(() => { window.__pbZoomLock?.disconnect(); window.__pbZoomLock = undefined; return true; })()`);
}

/** Draws `svg` over the page (CSS px box `width` x `height`), for a burned capture; `removeOverlay` takes it off. */
export async function addOverlay(b: PageBrowser, svg: string, width: number, height: number): Promise<void> {
  await b.evaluate(`(() => {
    document.getElementById('pb-capture-overlay')?.remove();
    const d = document.createElement('div');
    d.id = 'pb-capture-overlay';
    d.style.cssText = 'position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:2147483600;pointer-events:none;';
    d.innerHTML = ${JSON.stringify(svg)};
    const s = d.querySelector('svg'); if (s) { s.setAttribute('width', '${width}'); s.setAttribute('height', '${height}'); }
    document.body.appendChild(d);
    return true;
  })()`);
  await b.evaluate(FRAMES);
}

export async function removeOverlay(b: PageBrowser): Promise<void> {
  await b.evaluate(`(() => { document.getElementById('pb-capture-overlay')?.remove(); return true; })()`);
}

/**
 * In the page: the share of pixels that differ between two images (base64,
 * any format the browser decodes), compared at most 512 px wide; 1 when the
 * sizes differ. Also the share of pixels unlike the most common colour of the
 * second image (ink: near 0 is a blank frame).
 */
export const PIXEL_DIFF = `async (a, b) => {
  const load = async (src) => { if (!src) return null; const i = new Image(); i.src = src; await i.decode(); return i; };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.min(512, ib.width), h = Math.max(1, Math.round(ib.height * w / ib.width));
  const read = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
  const db = read(ib);
  const counts = new Map();
  for (let i = 0; i < db.length; i += 4) { const k = (db[i] >> 3) << 10 | (db[i + 1] >> 3) << 5 | (db[i + 2] >> 3); counts.set(k, (counts.get(k) || 0) + 1); }
  let bg = 0, most = -1; for (const [k, n] of counts) if (n > most) { most = n; bg = k; }
  const br = (bg >> 10) << 3, bgG = ((bg >> 5) & 31) << 3, bb = (bg & 31) << 3;
  let ink = 0; for (let i = 0; i < db.length; i += 4) if (Math.abs(db[i] - br) > 24 || Math.abs(db[i + 1] - bgG) > 24 || Math.abs(db[i + 2] - bb) > 24) ink++;
  let changed = 1;
  if (ia && ia.width * ib.height === ib.width * ia.height) {
    const da = read(ia); let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 16 || Math.abs(da[i + 1] - db[i + 1]) > 16 || Math.abs(da[i + 2] - db[i + 2]) > 16) n++;
    changed = n / (da.length / 4);
  }
  return { changed, ink: ink / (db.length / 4) };
}`;

const mime = (buf: Buffer) => (buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : "image/webp");
const dataUrl = (buf: Buffer) => `data:${mime(buf)};base64,${buf.toString("base64")}`;

/** Compares two frames in the page (see PIXEL_DIFF). */
export async function compareFrames(b: PageBrowser, previous: Buffer | undefined, next: Buffer): Promise<{ changed: number; ink: number }> {
  return b.evaluate(`(${PIXEL_DIFF})(${JSON.stringify(previous ? dataUrl(previous) : "")}, ${JSON.stringify(dataUrl(next))})`);
}

/** Width and height of a PNG, JPEG or WebP from its header (no decoder). */
export function imageSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length > 24 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return undefined;
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  return undefined;
}
