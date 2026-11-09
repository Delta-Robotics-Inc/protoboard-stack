/**
 * What the layout screen draws over the board in SVG (screen pixels), beside the WebGL drawing: proposals as blue
 * ghosts (dashed copper, the selection blue: a proposal is a selection waiting for a decision), the diagnosis's rule
 * areas shaded by tier with its failed attempts in red and its probe in green (check colors: fail and pass), an
 * agent's leased region as a dashed blue frame with its tag, and the small board crops of the review queue. Pure
 * string builders; no DOM.
 */
import { boundsOf, padsOf, recordsOfKind, type BoardDocument } from "./board.js";
import type { DiagnosisArea, GhostCopper } from "./types.js";

export interface ScreenMap {
  /** Board millimeters to screen pixels. */
  toScreen(x: number, y: number): { x: number; y: number };
  /** Pixels per millimeter. */
  scale: number;
}

const NM = 1e-6;
const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c]!);
export const SELECT = "#5aa9ff";
export const FAIL = "#ef4444";
export const PASS = "#22c55e";
export const WARN = "#eed202";

/** Copper as dashed lines and circles in one color (a ghost, an attempt, a probe). */
export function copperSvg(g: GhostCopper, m: ScreenMap, color: string, options: { dash?: string; opacity?: number; minPx?: number } = {}): string {
  const out: string[] = [];
  const op = options.opacity ?? 0.85;
  const dash = options.dash ?? "5 3";
  for (const s of g.segments) {
    const a = m.toScreen(s.start.x * NM, s.start.y * NM);
    const b = m.toScreen(s.end.x * NM, s.end.y * NM);
    const w = Math.max(options.minPx ?? 1.5, s.width * NM * m.scale);
    out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-opacity="${(op * 0.35).toFixed(2)}" stroke-width="${w.toFixed(1)}" stroke-linecap="round"/>`);
    out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${color}" stroke-opacity="${op}" stroke-width="1.25" stroke-dasharray="${dash}"/>`);
  }
  for (const v of g.vias) {
    const c = m.toScreen(v.x * NM, v.y * NM);
    const r = Math.max(3, (v.outer_diameter * NM * m.scale) / 2);
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" fill-opacity="${(op * 0.25).toFixed(2)}" stroke="${color}" stroke-opacity="${op}" stroke-width="1.25" stroke-dasharray="3 2"/>`);
  }
  return out.join("");
}

/** A dashed frame with a tag (a proposal's or a lease's region), board millimeters. */
export function frameSvg(rect: [number, number, number, number], m: ScreenMap, tag: string, color = SELECT): string {
  const a = m.toScreen(rect[0], rect[3]);
  const b = m.toScreen(rect[2], rect[1]);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const tw = Math.max(40, tag.length * 6.2 + 14);
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${color}" fill-opacity="0.05" stroke="${color}" stroke-width="1.25" stroke-dasharray="5 4"/><rect x="${x.toFixed(1)}" y="${(y - 18).toFixed(1)}" width="${tw.toFixed(1)}" height="16" rx="3" fill="#161616" stroke="${color}" stroke-opacity="0.6"/><text x="${(x + 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" fill="${color}" font-family="Kode Mono, ui-monospace, monospace" font-size="9.5" letter-spacing="0.8">${esc(tag.toUpperCase())}</text>`;
}

const TIER_STYLE: Record<DiagnosisArea["tier"], { color: string; hatch: string; dash: string }> = {
  floor: { color: "#e6e6e6", hatch: "none", dash: "2 3" },
  target: { color: "#a3a3a3", hatch: "none", dash: "6 3" },
  policy: { color: WARN, hatch: "url(#pcb-hatch-policy)", dash: "3 3" },
  no_go: { color: FAIL, hatch: "url(#pcb-hatch-nogo)", dash: "0" },
};

/** Rule areas shaded by tier, with their names. */
export function areasSvg(areas: readonly DiagnosisArea[], m: ScreenMap): string {
  const defs = `<defs><pattern id="pcb-hatch-policy" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${WARN}" stroke-opacity="0.35" stroke-width="1.5"/></pattern><pattern id="pcb-hatch-nogo" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${FAIL}" stroke-opacity="0.4" stroke-width="1.5"/></pattern></defs>`;
  const out: string[] = [defs];
  for (const a of areas) {
    if (a.outline.length < 3) continue;
    const st = TIER_STYLE[a.tier];
    const pts = a.outline.map((v) => m.toScreen(v.x * NM, v.y * NM));
    const d = `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z`;
    out.push(`<path d="${d}" fill="${st.hatch === "none" ? st.color : st.hatch}" fill-opacity="${st.hatch === "none" ? 0.05 : 1}" stroke="${st.color}" stroke-opacity="0.85" stroke-width="1.25" ${st.dash !== "0" ? `stroke-dasharray="${st.dash}"` : ""}/>`);
    const top = pts.reduce((b, p) => (p.y < b.y || (p.y === b.y && p.x < b.x) ? p : b), pts[0]);
    const label = `${a.name} · ${a.tier === "no_go" ? "no-go" : a.tier}`;
    out.push(`<rect x="${(top.x + 4).toFixed(1)}" y="${(top.y - 17).toFixed(1)}" width="${(label.length * 6 + 12).toFixed(1)}" height="15" rx="3" fill="#161616" stroke="${st.color}" stroke-opacity="0.6"/><text x="${(top.x + 10).toFixed(1)}" y="${(top.y - 6.5).toFixed(1)}" fill="${st.color}" font-family="Kode Mono, ui-monospace, monospace" font-size="9" letter-spacing="0.6">${esc(label.toUpperCase())}</text>`);
  }
  return out.join("");
}

/** The board box (millimeters) of a set of ids (pads, records); undefined when none is on the board. */
export function boxOfIds(doc: BoardDocument, ids: readonly string[]): [number, number, number, number] | undefined {
  let r: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const rec = doc.records.get(id);
    if (!rec) continue;
    const b = boundsOf(rec);
    if (!b) continue;
    r = [Math.min(r[0], b.minX * NM), Math.min(r[1], b.minY * NM), Math.max(r[2], b.maxX * NM), Math.max(r[3], b.maxY * NM)];
  }
  return r[0] <= r[2] ? r : undefined;
}

/** What an agent's lease covers, as one box: its region, the footprints under its roots, the copper of its nets. */
export function leaseBox(doc: BoardDocument, lease: { roots: string[]; nets: string[]; region?: { box: { minX: number; minY: number; maxX: number; maxY: number } } }): [number, number, number, number] | undefined {
  if (lease.region) return [lease.region.box.minX * NM, lease.region.box.minY * NM, lease.region.box.maxX * NM, lease.region.box.maxY * NM];
  const ids: string[] = [];
  for (const fp of recordsOfKind(doc, "footprint")) {
    const path = fp.path ?? fp.ref;
    if (lease.roots.some((root) => root === "" || path === root || path.startsWith(`${root}/`))) ids.push(fp.id);
  }
  for (const r of doc.records.values()) if ((r.kind === "track" || r.kind === "via" || r.kind === "zone") && r.net && lease.nets.includes(r.net)) ids.push(r.id);
  return boxOfIds(doc, ids);
}

/**
 * A small crop of the board around a box (nanometers) as an SVG: outline, tracks, vias and pads in board colors,
 * the objects of interest in blue, a ghost when given. For the review queue's cards and list.
 */
export function cropSvg(doc: BoardDocument, box: { minX: number; minY: number; maxX: number; maxY: number }, options: { width: number; height: number; focus?: readonly string[]; ghost?: GhostCopper; marker?: { x: number; y: number }; pad?: number } = { width: 240, height: 120 }): string {
  const W = options.width;
  const H = options.height;
  const padMm = options.pad ?? 1.5;
  const cx = ((box.minX + box.maxX) / 2) * NM;
  const cy = ((box.minY + box.maxY) / 2) * NM;
  const span = Math.max((box.maxX - box.minX) * NM + padMm * 2, ((box.maxY - box.minY) * NM + padMm * 2) * (W / H), 3);
  const s = W / span;
  const m: ScreenMap = { toScreen: (x, y) => ({ x: W / 2 + (x - cx) * s, y: H / 2 - (y - cy) * s }), scale: s };
  const vis = { minX: (cx - W / 2 / s) / NM, maxX: (cx + W / 2 / s) / NM, minY: (cy - H / 2 / s) / NM, maxY: (cy + H / 2 / s) / NM };
  const meets = (b: { minX: number; minY: number; maxX: number; maxY: number } | undefined) => !!b && b.maxX >= vis.minX && b.minX <= vis.maxX && b.maxY >= vis.minY && b.minY <= vis.maxY;
  const focus = new Set(options.focus ?? []);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#131313"/>`];
  const outline = doc.records.get("outline");
  if (outline?.kind === "outline") {
    const pts = outline.outline.map((v) => m.toScreen(v.x * NM, v.y * NM));
    out.push(`<path d="M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}Z" fill="#1b1b1a" stroke="#d4d4d4" stroke-width="1.2"/>`);
  }
  const color = (layer: string) => (layer === "top" ? "#a13e35" : layer === "bottom" ? "#3c5f8f" : "#8a7a2e");
  for (const t of recordsOfKind(doc, "track")) {
    if (!meets(boundsOf(t))) continue;
    const a = m.toScreen(t.start.x * NM, t.start.y * NM);
    const b = m.toScreen(t.end.x * NM, t.end.y * NM);
    const on = focus.has(t.id);
    out.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${on ? SELECT : color(t.layer)}" stroke-width="${Math.max(1, t.width * NM * s).toFixed(1)}" stroke-linecap="round"/>`);
  }
  for (const fp of recordsOfKind(doc, "footprint")) {
    for (const p of padsOf(fp)) {
      if (!meets(p.box)) continue;
      const a = m.toScreen(p.box.minX * NM, p.box.maxY * NM);
      const b = m.toScreen(p.box.maxX * NM, p.box.minY * NM);
      const on = focus.has(p.id) || focus.has(fp.id);
      out.push(`<rect x="${a.x.toFixed(1)}" y="${a.y.toFixed(1)}" width="${Math.max(1, b.x - a.x).toFixed(1)}" height="${Math.max(1, b.y - a.y).toFixed(1)}" rx="1" fill="${on ? SELECT : "#b18738"}" fill-opacity="${on ? 0.9 : 0.85}"/>`);
    }
  }
  for (const v of recordsOfKind(doc, "via")) {
    if (!meets(boundsOf(v))) continue;
    const c = m.toScreen(v.x * NM, v.y * NM);
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${Math.max(1.5, (v.outer_diameter * NM * s) / 2).toFixed(1)}" fill="#a7a7a2"/>`);
  }
  if (options.ghost) out.push(copperSvg(options.ghost, m, SELECT, { minPx: 1 }));
  if (options.marker) {
    const c = m.toScreen(options.marker.x * NM, options.marker.y * NM);
    out.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="7" fill="none" stroke="${FAIL}" stroke-width="1.5" stroke-dasharray="3 2"/>`);
  }
  out.push("</svg>");
  return out.join("");
}
