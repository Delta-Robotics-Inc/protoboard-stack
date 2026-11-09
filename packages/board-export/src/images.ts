/**
 * The image half of every output pair: SVG drawn from what was written (Gerbers and drill files read back, the CPL
 * and BOM rows, the IPC-D-356 records, the DXF entities) and PNG through `@protoboardai/board-scene` (resvg) when it is
 * available. All text is stroke paths; the same input gives the same bytes.
 */
import { readDxf } from "@protoboardai/board";
import { pngAvailable, svgToPng } from "@protoboardai/board-scene";
import type { BomLine, PlacementRow } from "./assembly.js";
import type { ExcellonRead } from "./drill.js";
import { degText, mmText } from "./format.js";
import type { Pt } from "./geom.js";
import { arcPoints, type GerberRead } from "./gerber/read.js";
import { extentOf, f, label, objectsSvg, type Box } from "./gerber/svg.js";
import type { Ipc356Read } from "./ipc356.js";

const BG = "#10151b";
const FG = "#cfd6dd";
const DIM = "#6b7783";
const OK = "#4cc38a";
const WARN = "#f5a524";
const FAIL = "#f2555a";
const BLUE = "#3fa7d6";

/** A board-frame drawing area: the box shown, the margin, and the screen size in millimeters. */
interface Frame {
  box: Box;
  margin: number;
  wMm: number;
  hMm: number;
}
function frameOf(box: Box, extraBottomMm = 0): Frame {
  const margin = Math.max(1.5e6, 0.04 * Math.max(box.maxX - box.minX, box.maxY - box.minY));
  return { box, margin, wMm: (box.maxX - box.minX + 2 * margin) / 1e6, hMm: (box.maxY - box.minY + 2 * margin) / 1e6 + extraBottomMm };
}
/** A board point (nm) in screen millimeters (y down). */
const sx = (fr: Frame, x: number) => (x - fr.box.minX + fr.margin) / 1e6;
const sy = (fr: Frame, y: number) => (fr.box.maxY + fr.margin - y) / 1e6;

function wrap(fr: { wMm: number; hMm: number }, body: string, pxPerMm = 20): string {
  const scale = Math.min(pxPerMm, 2576 / Math.max(fr.wMm, fr.hMm));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(fr.wMm * scale)}" height="${Math.round(fr.hMm * scale)}" viewBox="0 0 ${fr.wMm.toFixed(4)} ${fr.hMm.toFixed(4)}">`,
    `<rect x="0" y="0" width="${fr.wMm.toFixed(4)}" height="${fr.hMm.toFixed(4)}" fill="${BG}"/>`,
    body,
    "</svg>",
    "",
  ].join("\n");
}

/** The outline (a read profile file) drawn faintly inside a frame. */
function outlineLayer(fr: Frame, profile: GerberRead | undefined, color = DIM): string {
  if (!profile) return "";
  return `<g transform="translate(${f(-fr.box.minX + fr.margin)} ${f(fr.box.maxY + fr.margin)}) scale(1 -1)">${objectsSvg(profile, color, "o")}</g>`;
}

const boxOfProfile = (profile: GerberRead | undefined, pts: Pt[]): Box => {
  const b = profile ? extentOf(profile) : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  if (!Number.isFinite(b.minX)) return { minX: -5e6, minY: -5e6, maxX: 5e6, maxY: 5e6 };
  return b;
};

/** A legend block of text lines under a drawing. */
function legend(lines: { text: string; color?: string; mark?: string }[], x: number, y: number, h: number, maxW = Infinity): string {
  return lines
    .map((l, i) => {
      const room = maxW - x - (l.mark ? h * 1.6 : 0);
      const lh = Math.min(h, (room * 6) / Math.max(1, l.text.length * 5.5));
      return `${l.mark ?? ""}${label(l.text, x + (l.mark ? h * 1.6 : 0), y + i * h * 1.7, lh, l.color ?? FG)}`;
    })
    .join("");
}

const SYMBOLS = ["circle", "cross", "square", "x", "triangle", "diamond", "plus-circle", "hexagon"] as const;
function symbol(kind: (typeof SYMBOLS)[number], x: number, y: number, r: number, color: string, w: number): string {
  const s = `fill="none" stroke="${color}" stroke-width="${w.toFixed(3)}"`;
  const p = (pts: [number, number][]) => `<path d="M${pts.map(([a, b]) => `${(x + a * r).toFixed(3)} ${(y + b * r).toFixed(3)}`).join("L")}Z" ${s}/>`;
  switch (kind) {
    case "circle":
      return `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${r.toFixed(3)}" ${s}/>`;
    case "cross":
      return `<path d="M${(x - r).toFixed(3)} ${y.toFixed(3)}L${(x + r).toFixed(3)} ${y.toFixed(3)}M${x.toFixed(3)} ${(y - r).toFixed(3)}L${x.toFixed(3)} ${(y + r).toFixed(3)}" ${s}/>`;
    case "square":
      return p([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    case "x":
      return `<path d="M${(x - r).toFixed(3)} ${(y - r).toFixed(3)}L${(x + r).toFixed(3)} ${(y + r).toFixed(3)}M${(x - r).toFixed(3)} ${(y + r).toFixed(3)}L${(x + r).toFixed(3)} ${(y - r).toFixed(3)}" ${s}/>`;
    case "triangle":
      return p([[0, -1], [1, 0.8], [-1, 0.8]]);
    case "diamond":
      return p([[0, -1], [1, 0], [0, 1], [-1, 0]]);
    case "plus-circle":
      return `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${r.toFixed(3)}" ${s}/><path d="M${(x - r).toFixed(3)} ${y.toFixed(3)}L${(x + r).toFixed(3)} ${y.toFixed(3)}" ${s}/>`;
    case "hexagon":
      return p([[1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87]]);
  }
}

/** Drill map: every hole read back from the drill files, one symbol per tool, over the outline, with the tool table. */
export function drillMapSvg(files: { name: string; read: ExcellonRead; plated: string }[], profile: GerberRead | undefined, caption: string): string {
  const pts: Pt[] = files.flatMap((x) => x.read.holes.map((h) => ({ x: h.x, y: h.y })));
  const box = boxOfProfile(profile, pts);
  const tools: { file: string; t: number; d: number; plated: string; count: number; slots: number; fn: string }[] = [];
  for (const fl of files) for (const [t, tool] of fl.read.tools) tools.push({ file: fl.name, t, d: tool.d, plated: fl.plated, count: fl.read.holes.filter((h) => h.tool === t && !h.slot).length, slots: fl.read.holes.filter((h) => h.tool === t && h.slot).length, fn: (tool.attrs[".AperFunction"] ?? []).slice(-1)[0] ?? "" });
  const h = Math.max(1, (box.maxX - box.minX) / 1e6 / 45);
  const fr = frameOf(box, (tools.length + 3) * h * 1.7 + h);
  const r = Math.max(0.25, h * 0.35);
  let body = outlineLayer(fr, profile);
  const colors = [BLUE, WARN, OK, FAIL, "#c792ea", "#7fdbca", "#f78c6c", "#e0e0e0"];
  tools.forEach((t, i) => {
    const k = SYMBOLS[i % SYMBOLS.length];
    const c = colors[i % colors.length];
    const fl = files.find((x) => x.name === t.file)!;
    for (const hole of fl.read.holes) {
      if (hole.tool !== t.t) continue;
      if (hole.slot) body += `<path d="M${sx(fr, hole.slot.a.x).toFixed(3)} ${sy(fr, hole.slot.a.y).toFixed(3)}L${sx(fr, hole.slot.b.x).toFixed(3)} ${sy(fr, hole.slot.b.y).toFixed(3)}" stroke="${c}" stroke-width="${(t.d / 1e6).toFixed(3)}" stroke-linecap="round" opacity="0.6"/>`;
      body += symbol(k, sx(fr, hole.x), sy(fr, hole.y), r, c, r * 0.3);
    }
  });
  const y0 = fr.hMm - (tools.length + 2) * h * 1.7;
  const lines = [{ text: caption, color: FG }, ...tools.map((t, i) => ({ text: `${t.file} T${t.t} ${mmText(t.d, 3)} MM ${t.plated.toUpperCase()} ${t.fn.toUpperCase()} ${t.count} HOLES${t.slots ? ` ${t.slots} SLOTS` : ""}`, color: colors[i % colors.length], mark: symbol(SYMBOLS[i % SYMBOLS.length], 1 + r, y0 + (i + 1) * h * 1.7, r, colors[i % colors.length], r * 0.3) }))];
  body += legend(lines, 1, y0, h, fr.wMm - 1);
  return wrap(fr, body);
}

/** Placement overlay: each placed part at its CPL position with a tick in its written rotation, colored by correction status. */
export function cplOverlaySvg(rows: PlacementRow[], profile: GerberRead | undefined, origin: Pt, caption: string, hasTable: boolean): string {
  const placed = rows.filter((r) => !r.noBom);
  const pts = placed.map((r) => ({ x: r.x + origin.x, y: r.y + origin.y }));
  const box = boxOfProfile(profile, pts);
  const h = Math.max(0.6, (box.maxX - box.minX) / 1e6 / 60);
  const fr = frameOf(box, 5 * h * 1.7 + h);
  let body = outlineLayer(fr, profile);
  for (const r of placed) {
    const x = sx(fr, r.x + origin.x);
    const y = sy(fr, r.y + origin.y);
    const status = r.dnp || r.hand ? DIM : !hasTable ? BLUE : r.correction.source === "none" ? FAIL : r.correction.source === "package" ? WARN : OK;
    const a = (r.rotationOut / 1000) * (Math.PI / 180);
    const len = h * 1.6;
    const filled = r.side === "top";
    body += `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${(h * 0.35).toFixed(3)}" fill="${filled ? status : "none"}" stroke="${status}" stroke-width="${(h * 0.12).toFixed(3)}"/>`;
    body += `<path d="M${x.toFixed(3)} ${y.toFixed(3)}L${(x + len * Math.cos(a)).toFixed(3)} ${(y - len * Math.sin(a)).toFixed(3)}" stroke="${status}" stroke-width="${(h * 0.15).toFixed(3)}" stroke-linecap="round"/>`;
    body += label(r.ref, x + h * 0.5, y - h * 0.6, h * 0.8, r.dnp ? DIM : FG);
  }
  const y0 = fr.hMm - 4.5 * h * 1.7;
  body += legend(
    [
      { text: caption },
      { text: hasTable ? "GREEN: ROTATION FROM A VERIFIED ENTRY OR THE FAB LIBRARY  AMBER: PACKAGE PATTERN  RED: NOT VERIFIED" : "ROTATIONS AS WRITTEN (NO CORRECTION TABLE FOR THIS PROFILE)", color: DIM },
      { text: "FILLED: TOP SIDE  HOLLOW: BOTTOM SIDE  TICK: WRITTEN ROTATION  GRAY: DNP OR HAND PLACED", color: DIM },
    ],
    1,
    y0,
    h,
    fr.wMm - 1,
  );
  return wrap(fr, body);
}

/** BOM as a table image (first 60 lines). */
export function bomTableSvg(lines: BomLine[], caption: string): string {
  const h = 2.2;
  const cols = [
    { t: "ITEM", w: 10, v: (l: BomLine) => String(l.item) },
    { t: "QTY", w: 9, v: (l: BomLine) => String(l.quantity) },
    { t: "DESIGNATORS", w: 60, v: (l: BomLine) => l.refs.join(",") },
    { t: "VALUE", w: 34, v: (l: BomLine) => l.value },
    { t: "FOOTPRINT", w: 40, v: (l: BomLine) => l.package },
    { t: "LCSC", w: 22, v: (l: BomLine) => l.lcsc ?? "" },
    { t: "CLASS", w: 18, v: (l: BomLine) => l.libraryClass ?? "" },
    { t: "NOTES", w: 60, v: (l: BomLine) => [l.dnp ? "DNP" : "", l.consigned ? "CONSIGNED" : "", l.hand ? "HAND" : "", ...l.flags].filter(Boolean).join("; ") },
  ];
  const shown = lines.slice(0, 60);
  const W = cols.reduce((s, c) => s + c.w, 0) + 4;
  const H = (shown.length + 3) * h * 1.8 + 4 + (lines.length > shown.length ? h * 1.8 : 0);
  const fit = (s: string, w: number) => {
    const n = Math.floor(w / (h * 0.92));
    return s.length > n ? `${s.slice(0, Math.max(1, n - 2))}..` : s;
  };
  let body = label(caption, 2, 2 + h, h, FG);
  let x = 2;
  for (const c of cols) {
    body += label(c.t, x, 2 + h * 2.8, h * 0.85, DIM);
    x += c.w;
  }
  shown.forEach((l, i) => {
    let cx = 2;
    const y = 2 + h * (4.6 + i * 1.8);
    const bad = l.flags.length > 0;
    for (const c of cols) {
      body += label(fit(c.v(l), c.w - 1), cx, y, h * 0.85, c.t === "NOTES" && bad ? WARN : l.dnp ? DIM : FG);
      cx += c.w;
    }
  });
  if (lines.length > shown.length) body += label(`${lines.length - shown.length} MORE LINES IN THE FILE`, 2, H - h, h * 0.85, DIM);
  return wrap({ wMm: W, hMm: H }, body, 8);
}

/** IPC-D-356 test points read back over the outline: surface pads, drilled pads and vias. */
export function ipc356Svg(read: Ipc356Read, profile: GerberRead | undefined, origin: Pt, caption: string): string {
  const pts = read.records.map((r) => ({ x: r.x + origin.x, y: r.y + origin.y }));
  const box = boxOfProfile(profile, pts);
  const h = Math.max(0.8, (box.maxX - box.minX) / 1e6 / 50);
  const fr = frameOf(box, 4 * h * 1.7);
  let body = outlineLayer(fr, profile);
  const nets = new Set(read.records.map((r) => r.net).filter((n) => n !== "N/C"));
  for (const r of read.records) {
    const c = r.via ? OK : r.type === "317" ? WARN : r.type === "367" ? DIM : BLUE;
    const rad = Math.max(0.15, Math.min(r.w, r.h) / 2e6);
    body += `<circle cx="${sx(fr, r.x + origin.x).toFixed(3)}" cy="${sy(fr, r.y + origin.y).toFixed(3)}" r="${rad.toFixed(3)}" fill="${c}" opacity="${r.net === "N/C" ? 0.35 : 0.9}"/>`;
  }
  const y0 = fr.hMm - 3.3 * h * 1.7;
  const n = (t: string) => read.records.filter((r) => r.type === t && !r.via).length;
  body += legend([{ text: caption }, { text: `BLUE: ${n("327")} SURFACE PADS  AMBER: ${n("317")} DRILLED PADS  GREEN: ${read.records.filter((r) => r.via).length} VIAS  ${nets.size} NETS`, color: DIM }], 1, y0, h, fr.wMm - 1);
  return wrap(fr, body);
}

/** The DXF read back with the board package's DXF reader, edges by layer. */
export function dxfSvg(text: string, caption: string): string {
  const layerColor: Record<string, string> = { OUTLINE: FG, CUTOUTS: FG, PADS_TOP: FAIL, PADS_BOTTOM: BLUE, HOLES: OK, COURTYARD_TOP: "#c792ea", COURTYARD_BOTTOM: "#7fdbca" };
  const parts: string[] = [];
  const all: Pt[] = [];
  const byLayer = new Map<string, Pt[][]>();
  for (const layer of Object.keys(layerColor)) {
    let read;
    try {
      read = readDxf(text, { layers: [layer] });
    } catch {
      continue;
    }
    const paths: Pt[][] = [];
    for (const e of read.edges) {
      const pts = e.sweep !== undefined ? [e.a, ...arcFlat(e.a, e.b, e.sweep)] : [e.a, e.b];
      paths.push(pts);
      all.push(...pts);
    }
    byLayer.set(layer, paths);
  }
  const box = boxOfProfile(undefined, all);
  const h = Math.max(0.8, (box.maxX - box.minX) / 1e6 / 50);
  const fr = frameOf(box, 2.5 * h * 1.7);
  for (const [layer, paths] of byLayer) {
    const d = paths.map((p) => `M${p.map((q) => `${sx(fr, q.x).toFixed(3)} ${sy(fr, q.y).toFixed(3)}`).join("L")}`).join("");
    if (d) parts.push(`<path d="${d}" fill="none" stroke="${layerColor[layer]}" stroke-width="${(h * 0.08).toFixed(3)}"/>`);
  }
  const counts = [...byLayer].filter(([, p]) => p.length).map(([l, p]) => `${l} ${p.length}`).join("  ");
  parts.push(legend([{ text: caption }, { text: counts, color: DIM }], 1, fr.hMm - 2 * h * 1.7, h, fr.wMm - 1));
  return wrap(fr, parts.join(""));
}

function arcFlat(a: Pt, b: Pt, sweep: number): Pt[] {
  // reuse the reader's arc flattening through an equivalent center
  const theta = (sweep / 1000) * (Math.PI / 180);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const hgt = chord / 2 / Math.tan(theta / 2);
  const cx = (a.x + b.x) / 2 + (-(b.y - a.y) / chord) * hgt;
  const cy = (a.y + b.y) / 2 + ((b.x - a.x) / chord) * hgt;
  return arcPoints(a, b, { cx, cy, ccw: sweep > 0 }).slice(1);
}

export interface PreflightImageItem {
  group: string;
  title: string;
  status: "pass" | "warn" | "fail" | "info" | "skip";
}

/** The pre-flight report as a checklist image. */
export function preflightSvg(items: PreflightImageItem[], caption: string, verdict: string): string {
  const h = 2.4;
  const W = 230;
  let y = 4 + h;
  let body = label(caption, 3, y, h * 1.2, FG);
  y += h * 2;
  body += label(verdict, 3, y, h, verdict.startsWith("READY") ? OK : verdict.startsWith("OVERRIDDEN") ? WARN : FAIL);
  y += h * 2.2;
  let group = "";
  for (const it of items) {
    if (it.group !== group) {
      group = it.group;
      y += h * 0.6;
      body += label(group.toUpperCase(), 3, y, h * 0.85, DIM);
      y += h * 1.7;
    }
    const c = it.status === "pass" ? OK : it.status === "warn" ? WARN : it.status === "fail" ? FAIL : DIM;
    const mark = it.status === "pass" ? "OK" : it.status === "warn" ? "!" : it.status === "fail" ? "X" : "-";
    body += label(mark, 5, y, h, c, "left", h * 0.16);
    const t = it.title.length > 95 ? `${it.title.slice(0, 93)}..` : it.title;
    body += label(t, 12, y, h * 0.9, it.status === "fail" ? FAIL : FG);
    y += h * 1.7;
  }
  return wrap({ wMm: W, hMm: y + h }, body, 8);
}

/** Rasterize when PNG output is available here. */
export function pngOf(svg: string): Uint8Array | undefined {
  if (!pngAvailable()) return undefined;
  return svgToPng(svg).png;
}

export { degText };
