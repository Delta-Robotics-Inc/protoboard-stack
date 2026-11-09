/**
 * The headless render page (browser side): one canvas and one marker overlay, driven over DevTools by render.ts.
 * The page keeps its scene between calls, so a run of crops is a view change each, not a reload (the Phase 0
 * benchmark's advice). It also compares two PNGs pixel by pixel for the visual tests.
 */
import { createDocument } from "../../../../board/src/document.js";
import { BoardIndex } from "../../../../board/src/index-spatial.js";
import type { BoardRecord, Netlist } from "../../../../board/src/schema.js";
import type { BoardSnapshot, CopperLayer } from "../board.js";
import { BoardView } from "../boardview.js";
import { NM, type Rect } from "../geom.js";
import { presetGroups, type PresetId } from "../layers.js";
import { markerKind, markerSvg, originSvg } from "../markers.js";
import type { PcbFinding, RatsnestPair, ZoneFill } from "../types.js";
import { fitRect, NO_INSETS } from "../view.js";

export interface PagePayload {
  records: BoardRecord[];
  netlist?: Netlist;
  epoch?: string;
  seq?: number;
}

export interface PageRenderOptions {
  width: number;
  height: number;
  /** Nanometers; default the board's extent. */
  region?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Layer panel rows to show (`cu:top`, `silk:top`, `pads` ...), or a preset name; default the screen's default rows. */
  layers?: string[] | PresetId;
  active?: CopperLayer;
  flip?: boolean;
  grayInactive?: boolean;
  highlightNets?: string[];
  selection?: string[];
  findings?: PcbFinding[];
  ratsnest?: RatsnestPair[];
  fills?: ZoneFill[];
  /** Base grid in millimeters; 0 (default) draws none. */
  grid?: number;
  origin?: boolean;
  /** Fraction of the canvas the region fills (default 0.94). */
  margin?: number;
}

declare global {
  interface Window {
    __pcb: unknown;
  }
}

const host = document.createElement("div");
host.style.cssText = "position:absolute;left:0;top:0;overflow:hidden;background:#131313";
const canvas = document.createElement("canvas");
canvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%";
const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible");
host.append(canvas, svg);
document.body.style.margin = "0";
document.body.style.background = "#131313";
document.body.append(host);

let view: BoardView | undefined;

function snapshotOf(p: PagePayload): BoardSnapshot {
  const doc = createDocument(p.records, p.netlist);
  let query: BoardIndex | undefined;
  return {
    epoch: p.epoch ?? "headless",
    seq: p.seq ?? 0,
    doc,
    version: (id: string) => (doc.records.has(id) ? 1 : 0),
    get query() {
      return (query ??= BoardIndex.build(doc));
    },
  } as BoardSnapshot;
}

async function decode(b64: string): Promise<ImageData> {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

window.__pcb = {
  load(payload: PagePayload) {
    view ??= new BoardView(canvas, { preserveDrawingBuffer: true });
    view.setSnapshot(snapshotOf(payload));
    const counts: Record<string, number> = {};
    for (const o of view.scene!.objects.values()) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    return counts;
  },
  render(o: PageRenderOptions) {
    if (!view?.scene) throw new Error("load a board first");
    const t0 = performance.now();
    host.style.width = `${o.width}px`;
    host.style.height = `${o.height}px`;
    view.resize(o.width, o.height, window.devicePixelRatio || 1);
    const copper = view.scene.copper;
    const groups = o.layers === undefined ? undefined : typeof o.layers === "string" ? presetGroups(o.layers, copper) : new Set(o.layers);
    view.setLayers({ ...(groups ? { groups } : {}), ...(o.active ? { active: o.active } : {}), grayInactive: o.grayInactive ?? true });
    view.setRatsnest(o.ratsnest ?? []);
    view.setFills(o.fills ?? []);
    view.setHighlight(o.highlightNets ?? [], true);
    view.setSelection(o.selection ?? []);
    view.setGrid(o.grid ?? 0);
    const rect: Rect = o.region ? [o.region.minX * NM, o.region.minY * NM, o.region.maxX * NM, o.region.maxY * NM] : view.scene.rect;
    view.setView(fitRect(rect, o.width, o.height, NO_INSETS, o.flip ?? false, o.margin ?? 0.94));
    view.renderNow();
    view.renderer.finish();
    // markers and the origin, in screen pixels
    const parts: string[] = [];
    if (o.origin) {
      const p = view.toScreen(0, 0);
      parts.push(`<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">${originSvg()}</g>`);
    }
    for (const f of o.findings ?? []) {
      const p = view.nmToScreen(f.location);
      if (p.x < -20 || p.y < -20 || p.x > o.width + 20 || p.y > o.height + 20) continue;
      parts.push(`<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">${markerSvg(markerKind(f))}</g>`);
    }
    svg.innerHTML = parts.join("");
    return { ms: performance.now() - t0, view: view.view, stats: view.renderer.stats };
  },
  /**
   * Performance: first paint (document, scene, buffers, upload and the first frame finished on the GPU) and the
   * GPU-synced cost of pan frames (each frame ends in a one-pixel readback, so the GPU's work counts).
   */
  perf(payload: PagePayload, o: { width: number; height: number; frames?: number }) {
    host.style.width = `${o.width}px`;
    host.style.height = `${o.height}px`;
    const t0 = performance.now();
    view ??= new BoardView(canvas, { preserveDrawingBuffer: true });
    view.resize(o.width, o.height, window.devicePixelRatio || 1);
    const snap = snapshotOf(payload);
    view.setSnapshot(snap);
    view.setView(fitRect(view.scene!.rect, o.width, o.height, NO_INSETS, false, 0.94));
    view.renderNow();
    view.renderer.finish();
    const firstPaint = performance.now() - t0;
    const base = view.view;
    const frames: number[] = [];
    const n = o.frames ?? 120;
    const pan = (scale: number) => {
      const out: number[] = [];
      const r = (Math.min(view!.scene!.rect[2] - view!.scene!.rect[0], view!.scene!.rect[3] - view!.scene!.rect[1]) / 4) * (scale > 1 ? 0.5 : 1);
      for (let i = 0; i < n + 5; i++) {
        const a = (i / n) * 2 * Math.PI;
        view!.setView({ ...base, s: base.s * scale, cx: base.cx + r * Math.cos(a), cy: base.cy + r * Math.sin(a) });
        const s0 = performance.now();
        view!.renderNow();
        view!.renderer.finish();
        if (i >= 5) out.push(performance.now() - s0);
      }
      return out;
    };
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return { median: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
    };
    frames.push(...pan(1));
    const fit = stat(frames);
    const zoomed = stat(pan(2));
    const counts = view.buffers!.counts();
    return { firstPaintMs: +firstPaint.toFixed(1), panWholeBoard: fit, panAt2x: zoomed, frames: n, ...counts, gpu: view.renderer.stats.gpu, drawCalls: view.renderer.stats.drawCalls };
  },
  async diff(a: string, b: string, threshold = 24) {
    const [x, y] = await Promise.all([decode(a), decode(b)]);
    if (x.width !== y.width || x.height !== y.height) return { sameSize: false, ratio: 1, mean: 255, nonBackground: 0 };
    let differ = 0;
    let sum = 0;
    let nonBackground = 0;
    for (let i = 0; i < x.data.length; i += 4) {
      const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
      sum += d;
      if (d > threshold) differ++;
      if (Math.abs(x.data[i] - 0x13) + Math.abs(x.data[i + 1] - 0x13) + Math.abs(x.data[i + 2] - 0x13) > 12) nonBackground++;
    }
    const n = x.data.length / 4;
    return { sameSize: true, ratio: differ / n, mean: sum / n, nonBackground: nonBackground / n };
  },
};
