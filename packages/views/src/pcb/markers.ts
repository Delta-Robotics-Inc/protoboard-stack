/**
 * Finding markers and the origin mark as SVG text, shared by the layout screen and the headless render page. A
 * marker never relies on color alone: shape, glyph and color together (the concept's kit): an error is a red
 * octagon with a cross, a warning a yellow triangle with "!", a policy cost an orange diamond with "!", info a
 * dashed circle with "?".
 *
 * On the layout screen only the finding in hand (selected, or under the pointer) gets that full marker; every other
 * open item is a small quiet dot (a circle for an error, a diamond for a warning), dots that would touch merge into
 * a numbered cluster, and when the board is zoomed out or dense the dots give way to counts by region. Open
 * connections draw no dot: their ratsnest line is their mark. A click on a cluster or a region count zooms to it.
 */
import { checkWords, mmPair } from "./findings-text.js";
import type { PcbFinding } from "./types.js";

export const MARKER_COLORS = { error: "#ef4444", warning: "#eed202", risk: "#ff7a1a", info: "#8b949e", glyph: "#131313" };

export type MarkerKind = "error" | "warning" | "risk" | "info";

export function markerKind(f: Pick<PcbFinding, "severity" | "tier">): MarkerKind {
  if (f.severity === "error") return "error";
  if (f.severity === "warning") return f.tier === "policy" ? "risk" : "warning";
  return "info";
}

/** One marker centered on (0, 0), `r` its radius in pixels. */
export function markerSvg(kind: MarkerKind, r = 7, ring = false): string {
  const c = MARKER_COLORS;
  const halo = ring ? `<circle r="${r + 4}" fill="none" stroke="${c[kind]}" stroke-width="1.25" opacity="0.6"/>` : "";
  switch (kind) {
    case "error": {
      const k = r * 0.4142;
      const pts = [
        [k, -r],
        [r, -k],
        [r, k],
        [k, r],
        [-k, r],
        [-r, k],
        [-r, -k],
        [-k, -r],
      ]
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(" ");
      const g = r * 0.42;
      return `${halo}<polygon points="${pts}" fill="${c.error}"/><path d="M${-g},${-g}L${g},${g}M${g},${-g}L${-g},${g}" stroke="${c.glyph}" stroke-width="${(r / 4).toFixed(2)}" stroke-linecap="round"/>`;
    }
    case "warning":
      return `${halo}<polygon points="0,${-r * 1.05} ${r * 1.05},${r * 0.85} ${-r * 1.05},${r * 0.85}" fill="${c.warning}" stroke-linejoin="round"/><path d="M0,${-r * 0.35}V${r * 0.3}" stroke="${c.glyph}" stroke-width="${(r / 4.5).toFixed(2)}" stroke-linecap="round"/><circle cy="${r * 0.6}" r="${r / 8}" fill="${c.glyph}"/>`;
    case "risk":
      return `${halo}<polygon points="0,${-r} ${r},0 0,${r} ${-r},0" fill="${c.risk}"/><path d="M0,${-r * 0.45}V${r * 0.15}" stroke="${c.glyph}" stroke-width="${(r / 4.5).toFixed(2)}" stroke-linecap="round"/><circle cy="${r * 0.45}" r="${r / 8}" fill="${c.glyph}"/>`;
    case "info":
      return `${halo}<circle r="${r}" fill="#131313" stroke="${c.info}" stroke-width="1.25" stroke-dasharray="2.5 2"/><text y="${r * 0.38}" text-anchor="middle" font-size="${r * 1.15}" font-family="ui-monospace,monospace" fill="${c.info}">?</text>`;
  }
}

/** The origin mark (board center): a small crosshair in a circle, in the scene's ink. */
export function originSvg(r = 9): string {
  return `<circle r="${r * 0.55}" fill="none" stroke="#d4d4d4" stroke-opacity="0.55" stroke-width="1"/><path d="M${-r},0H${r}M0,${-r}V${r}" stroke="#d4d4d4" stroke-opacity="0.55" stroke-width="1"/>`;
}

// ------------------------------------------------------------------ the screen's marker layer

const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c]!);
const RANK: Record<MarkerKind, number> = { error: 0, risk: 1, warning: 2, info: 3 };
const MONO = "Kode Mono, ui-monospace, monospace";

/** A small quiet dot centered on (0, 0): a filled circle (error), a filled diamond (warning, policy) or a ring (info). */
export function dotSvg(kind: MarkerKind, r = 3.4): string {
  const c = MARKER_COLORS[kind];
  if (kind === "error") return `<circle r="${r}" fill="${c}" stroke="#131313" stroke-width="1.2"/>`;
  if (kind === "info") return `<circle r="${r}" fill="#131313" stroke="${c}" stroke-width="1.2"/>`;
  const d = r * 1.3;
  return `<polygon points="0,${-d} ${d},0 0,${d} ${-d},0" fill="${c}" stroke="#131313" stroke-width="1.1" stroke-linejoin="round"/>`;
}

export interface MarkerLayerOptions {
  /** Canvas size in pixels (what is off it is not drawn). */
  width: number;
  height: number;
  /** The finding in hand: a full marker with its halo. */
  active?: string;
  /** The finding under the pointer: a full marker. */
  hover?: string;
  /** Review mode: the rest recede further. */
  quiet?: boolean;
  /** Pixels per millimeter: below `regionScale` (default 7), counts by region. */
  scale: number;
  regionScale?: number;
  /** More marks than this after the dots that touch are merged (default 160), counts by region. */
  regionCount?: number;
  /** A short tag beside the active marker (review mode: its measure against its limit). */
  tag?: boolean;
}

interface Pt {
  f: Pick<PcbFinding, "id" | "severity" | "tier" | "check" | "measured" | "required">;
  x: number;
  y: number;
  kind: MarkerKind;
}

/** Groups of dots in screen space: one per grid cell (`grid`, counts by region), or per run of dots that would touch. */
function groupDots(pts: readonly Pt[], cell: number, grid: boolean): Map<string, Pt[]> {
  const groups = new Map<string, Pt[]>();
  for (const p of pts) {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    let key = `${cx},${cy}`;
    if (!grid)
      search: for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const k = `${cx + dx},${cy + dy}`;
          const g = groups.get(k);
          if (g && Math.hypot(g[0].x - p.x, g[0].y - p.y) < cell) {
            key = k;
            break search;
          }
        }
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  return groups;
}

/** Severity counts in words, for a cluster's tooltip. */
function countWords(pts: readonly Pt[]): string {
  const n = { error: 0, warning: 0, info: 0 };
  for (const p of pts) n[p.f.severity]++;
  const w = (k: number, one: string) => (k ? `${k} ${one}${k === 1 ? "" : "s"}` : "");
  return [w(n.error, "error"), w(n.warning, "warning"), w(n.info, "note")].filter(Boolean).join(", ");
}

/**
 * The markers of the open findings as SVG text in screen pixels: the active and hovered findings as full markers,
 * the rest as dots, clusters or region counts (see the file comment). Every marker carries `data-finding`, every
 * cluster or count `data-cluster` (its screen box, `x0,y0,x1,y1`), for the canvas's pointer handling.
 */
export function markerLayerSvg(findings: readonly PcbFinding[], toScreen: (nm: { x: number; y: number }) => { x: number; y: number }, o: MarkerLayerOptions): string {
  const pts: Pt[] = [];
  const hot: Pt[] = [];
  for (const f of findings) {
    const p = toScreen(f.location);
    if (p.x < -20 || p.y < -20 || p.x > o.width + 20 || p.y > o.height + 20) continue;
    const pt = { f, x: p.x, y: p.y, kind: markerKind(f) };
    if (f.id === o.active || f.id === o.hover) hot.push(pt);
    else if (f.check !== "unconnected") pts.push(pt);
  }
  pts.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  const out: string[] = [];
  const opacity = o.quiet ? 0.5 : 0.92;
  const touching = groupDots(pts, 13, false);
  const regions = o.scale < (o.regionScale ?? 7) || touching.size > (o.regionCount ?? 160);
  const groups = regions ? groupDots(pts, 120, true) : touching;
  for (const g of groups.values()) {
    if (g.length === 1) {
      const p = g[0];
      out.push(`<g class="marker dot" data-finding="${esc(p.f.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" opacity="${opacity}"><circle r="8" fill="transparent"/>${dotSvg(p.kind)}</g>`);
      continue;
    }
    const xs = g.map((p) => p.x);
    const ys = g.map((p) => p.y);
    const box = `${Math.min(...xs).toFixed(0)},${Math.min(...ys).toFixed(0)},${Math.max(...xs).toFixed(0)},${Math.max(...ys).toFixed(0)}`;
    const cx = xs.reduce((s, v) => s + v, 0) / g.length;
    const cy = ys.reduce((s, v) => s + v, 0) / g.length;
    const title = `<title>${g.length} open item${g.length === 1 ? "" : "s"} here: ${countWords(g)}. Click to zoom in.</title>`;
    if (!regions) {
      const t = String(g.length);
      out.push(`<g class="marker cluster" data-cluster="${box}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})" opacity="${opacity}">${title}<circle r="${t.length > 1 ? 8.5 : 7.5}" fill="#161616" stroke="${MARKER_COLORS[g[0].kind]}" stroke-width="1.4"/><text y="3.2" text-anchor="middle" font-family="${MONO}" font-size="9" fill="#e6e6e6">${t}</text></g>`);
      continue;
    }
    // a region's counts: errors and warnings side by side, each with its own shape
    const errs = g.filter((p) => p.f.severity === "error").length;
    const rest = g.find((p) => p.f.severity !== "error");
    const parts: { kind: MarkerKind; n: number }[] = [...(errs ? [{ kind: "error" as MarkerKind, n: errs }] : []), ...(rest ? [{ kind: rest.kind, n: g.length - errs }] : [])];
    const widths = parts.map((p) => 15 + String(p.n).length * 6.2);
    const w = widths.reduce((s, v) => s + v, 0) + 8;
    let x = -w / 2 + 7;
    const inner = parts
      .map((p, i) => {
        const s = `<g transform="translate(${(x + 3).toFixed(1)},0)">${dotSvg(p.kind, 3)}</g><text x="${(x + 10).toFixed(1)}" y="3.3" font-family="${MONO}" font-size="9.5" fill="#e6e6e6">${p.n}</text>`;
        x += widths[i];
        return s;
      })
      .join("");
    out.push(`<g class="marker region" data-cluster="${box}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})" opacity="${o.quiet ? 0.7 : 1}">${title}<rect x="${(-w / 2).toFixed(1)}" y="-9" width="${w.toFixed(1)}" height="18" rx="9" fill="#161616" fill-opacity="0.92" stroke="#4a4a4a"/>${inner}</g>`);
  }
  // the finding in hand last, on top: the full marker, and in review a quiet tag with its measure
  for (const p of hot) {
    out.push(`<g class="marker hot" data-finding="${esc(p.f.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">${markerSvg(p.kind, 7, p.f.id === o.active)}</g>`);
    if (o.tag && p.f.id === o.active) {
      const t = p.f.measured !== undefined && p.f.required !== undefined ? (([m, r]) => `${m} mm · asks ${r}`)(mmPair(p.f.measured, p.f.required)) : checkWords(p.f.check);
      const w = t.length * 6.1 + 14;
      out.push(`<g transform="translate(${(p.x + 18).toFixed(1)},${(p.y - 24).toFixed(1)})" pointer-events="none"><path d="M-7,15 L0,8" stroke="${MARKER_COLORS[p.kind]}" stroke-width="1" stroke-opacity="0.7"/><rect x="0" y="-9" width="${w.toFixed(1)}" height="17" rx="3" fill="#161616" stroke="${MARKER_COLORS[p.kind]}" stroke-opacity="0.55"/><text x="7" y="3.4" font-family="${MONO}" font-size="9.5" letter-spacing="0.6" fill="${MARKER_COLORS[p.kind]}">${esc(t.toUpperCase())}</text></g>`);
    }
  }
  return out.join("");
}
