/**
 * What the interactive tools draw over the board (screen pixels, SVG strings, no DOM): the route draft (the fixed
 * part in its layer's color, the active segment in the selection blue, the clearance halo around the head, vias,
 * highlight-mode collisions ringed in the fail red), a drag's detached tracks and collisions, a polygon being drawn
 * (zone, keep-out, rip region), the outline's vertex handles, and the route callout's card (HTML). The layout screen
 * writes these into a layer of its own and redraws it per cursor move, without re-rendering the screen.
 *
 * Colors: blue only for the active segment (and the selection the screen draws); check red only for collisions.
 */
import { padsOf, parsePadId, type BoardDocument } from "./board.js";
import type { RouteCallout, RouteDraft } from "./edit/tools.js";
import { boxOfIds, FAIL, SELECT, WARN, type ScreenMap } from "./overlay.js";

const NM = 1e-6;
const f1 = (v: number) => v.toFixed(1);
const esc = (s: string) => s.replace(/[<&>"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;", '"': "&quot;" })[c]!);
const MONO = `font-family="Kode Mono, ui-monospace, monospace"`;

/** Board colors of copper layers (as the crops draw them), a little lighter for a draft. */
export function layerColor(layer: string): string {
  return layer === "top" ? "#c4544a" : layer === "bottom" ? "#5679ad" : "#a8963c";
}

/** The board box (millimeters) of an object id, pads included. */
export function objectBox(doc: BoardDocument, id: string): [number, number, number, number] | undefined {
  const pad = parsePadId(id);
  if (pad) {
    const fp = doc.records.get(pad.footprint);
    if (fp?.kind !== "footprint") return undefined;
    const p = padsOf(fp).find((q) => q.id === id);
    return p ? [p.box.minX * NM, p.box.minY * NM, p.box.maxX * NM, p.box.maxY * NM] : undefined;
  }
  return boxOfIds(doc, [id]);
}

/** The route draft: fixed segments, the head, the active segment in blue with its clearance halo, vias, collisions. */
export function routeDraftSvg(doc: BoardDocument, d: RouteDraft, m: ScreenMap, o: { mode: "walkaround" | "highlight"; via: { outer: number } }): string {
  const out: string[] = [];
  const pts = d.points;
  const wPx = Math.max(1.5, d.width.value * NM * m.scale);
  const haloPx = Math.max(wPx + 4, (d.width.value + 2 * d.clearance.value) * NM * m.scale);
  // the active segment: the last segment with length
  let ai = -1;
  for (let i = pts.length - 1; i > 0; i--)
    if (pts[i].layer === pts[i - 1].layer && (pts[i].x !== pts[i - 1].x || pts[i].y !== pts[i - 1].y)) {
      ai = i;
      break;
    }
  const S = pts.map((p) => m.toScreen(p.x * NM, p.y * NM));
  // the halo: the clearance band around the active segment, and a ring at the head's end
  if (ai > 0) {
    const a = S[ai - 1];
    const b = S[ai];
    out.push(`<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" stroke="#e6e6e6" stroke-opacity="0.07" stroke-width="${f1(haloPx)}" stroke-linecap="round"/>`);
    out.push(`<circle cx="${f1(b.x)}" cy="${f1(b.y)}" r="${f1(haloPx / 2)}" fill="none" stroke="#e6e6e6" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 3"/>`);
  }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].layer !== pts[i - 1].layer) continue;
    const a = S[i - 1];
    const b = S[i];
    const active = i === ai;
    const color = active ? SELECT : layerColor(pts[i].layer);
    out.push(`<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" stroke="${color}" stroke-opacity="${active ? 0.9 : 0.8}" stroke-width="${f1(wPx)}" stroke-linecap="round"/>`);
  }
  // vias where the draft changes layer
  const vr = Math.max(3, (o.via.outer * NM * m.scale) / 2);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].layer === pts[i - 1].layer || pts[i].x !== pts[i - 1].x || pts[i].y !== pts[i - 1].y) continue;
    out.push(`<circle cx="${f1(S[i].x)}" cy="${f1(S[i].y)}" r="${f1(vr)}" fill="#a7a7a2" fill-opacity="0.85" stroke="#e6e6e6" stroke-width="1"/><circle cx="${f1(S[i].x)}" cy="${f1(S[i].y)}" r="${f1(vr * 0.45)}" fill="#131313"/>`);
  }
  // the start and a snapped end
  if (S[0]) out.push(`<circle cx="${f1(S[0].x)}" cy="${f1(S[0].y)}" r="3" fill="#e6e6e6"/>`);
  if (d.snapped) {
    const c = m.toScreen(d.snapped.x * NM, d.snapped.y * NM);
    out.push(`<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="${f1(Math.max(6, wPx))}" fill="none" stroke="${d.reached ? SELECT : "#e6e6e6"}" stroke-width="1.25"/>`);
  }
  // highlight collisions: the other copper ringed in the check red
  if (o.mode === "highlight") {
    for (const c of d.collisions) {
      const b = objectBox(doc, c.id);
      if (!b) continue;
      const p = m.toScreen(b[0], b[3]);
      const q = m.toScreen(b[2], b[1]);
      const x = Math.min(p.x, q.x) - 3;
      const y = Math.min(p.y, q.y) - 3;
      out.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(Math.abs(q.x - p.x) + 6)}" height="${f1(Math.abs(q.y - p.y) + 6)}" rx="3" fill="${FAIL}" fill-opacity="0.12" stroke="${FAIL}" stroke-width="1.25" stroke-dasharray="4 2"/>`);
    }
  }
  if (d.stuck) {
    const c = m.toScreen(d.stuck.at.x * NM, d.stuck.at.y * NM);
    out.push(`<circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="7" fill="none" stroke="${WARN}" stroke-width="1.25" stroke-dasharray="3 2"/>`);
  }
  return out.join("");
}

/** The screen point where the route callout's leader starts (the active segment's middle), if there is one. */
export function calloutAnchor(d: RouteDraft, m: ScreenMap): { x: number; y: number } | undefined {
  const pts = d.points;
  for (let i = pts.length - 1; i > 0; i--)
    if (pts[i].layer === pts[i - 1].layer && (pts[i].x !== pts[i - 1].x || pts[i].y !== pts[i - 1].y)) {
      const a = m.toScreen(pts[i - 1].x * NM, pts[i - 1].y * NM);
      const b = m.toScreen(pts[i].x * NM, pts[i].y * NM);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  return pts[0] ? m.toScreen(pts[0].x * NM, pts[0].y * NM) : undefined;
}

/**
 * Where the route callout's card goes: beside the draft, never over it (left, right, above, below, in that order,
 * the first that fits the canvas's free area), else as close as the area allows. Screen pixels.
 */
export function placeCard(draft: { x0: number; y0: number; x1: number; y1: number }, anchor: { x: number; y: number }, size: { w: number; h: number }, area: { left: number; top: number; right: number; bottom: number }): { x: number; y: number } {
  const gap = 44;
  // the card's title sits on a shelf above it: a card below the draft keeps clear of it too
  const below = 64;
  const { w, h } = size;
  const cy = (y: number) => Math.max(area.top, Math.min(y, area.bottom - h));
  const cx = (x: number) => Math.max(area.left, Math.min(x, area.right - w));
  const cands = [
    { x: draft.x0 - gap - w, y: cy(anchor.y - h / 2) },
    { x: draft.x1 + gap, y: cy(anchor.y - h / 2) },
    { x: cx(anchor.x - w / 2), y: draft.y0 - gap - h },
    { x: cx(anchor.x - w / 2), y: draft.y1 + below },
  ];
  const fits = (c: { x: number; y: number }) => c.x >= area.left && c.x + w <= area.right && c.y >= area.top && c.y + h <= area.bottom;
  return cands.find(fits) ?? { x: cx(cands[1].x), y: cy(cands[1].y) };
}

/** The leader from the active segment to the card (blue: it belongs to the active segment). */
export function leaderSvg(from: { x: number; y: number }, card: { x: number; y: number; w: number; h: number }, title: string): string {
  const shelfY = card.y - 4;
  const toRight = card.x > from.x;
  const ex = toRight ? card.x : card.x + card.w;
  // a card straight above or below the segment: a vertical leg to its nearer edge; beside it: up to the shelf, then across
  const over = from.x >= card.x && from.x <= card.x + card.w;
  const leg = over ? `M${f1(from.x)},${f1(from.y)} V${f1(from.y < card.y ? shelfY - 14 : card.y + card.h)}` : `M${f1(from.x)},${f1(from.y)} V${f1(shelfY)} H${f1(ex)}`;
  return `<path d="${leg}" fill="none" stroke="${SELECT}" stroke-width="1.25"/><circle cx="${f1(from.x)}" cy="${f1(from.y)}" r="2.5" fill="${SELECT}"/><text x="${f1(toRight ? card.x : card.x + card.w)}" y="${f1(shelfY - 6)}" text-anchor="${toRight ? "start" : "end"}" fill="${SELECT}" ${MONO} font-size="10" letter-spacing="1">${esc(title.toUpperCase())}</text>`;
}

/** The route callout's card body (HTML; the styles are the screen's `.pcb-callout` and `.pcb-routecard`). */
export function routeCardHtml(c: RouteCallout): string {
  const rows = c.rows
    .map(
      (r) =>
        `<div class="row${r.tone ? ` ${r.tone}` : ""}"><span class="k">${esc(r.label)}</span><span class="v">${esc(r.value)}</span>${r.chip ? `<span class="pcb-chip">${esc(r.chip)}</span>` : ""}${r.from ? `<span class="from">${esc(r.from)}</span>` : ""}</div>`,
    )
    .join("");
  return `<div class="hd"><span class="sw"></span><b>${esc(c.head.toUpperCase())}</b><i>${esc(c.mode)}</i></div>${rows}${c.note ? `<p class="note">${esc(c.note)}</p>` : ""}${c.flag ? `<p class="flag ${c.flag.tone}">${esc(c.flag.text)}</p>` : ""}<div class="keys">${c.keys.map((k) => `<span class="pcb-chip">${esc(k)}</span>`).join("")}</div>`;
}

/** A drag's preview notes: detached tracks dashed in the warning yellow with a tag, new clearance violations ringed. */
export function dragNotesSvg(doc: BoardDocument, c: { detached: { track: string; pad: string; reason: string; with?: string }[]; collisions: { id: string; against: string }[]; ok: boolean }, m: ScreenMap): string {
  const out: string[] = [];
  for (const d of c.detached) {
    const t = doc.records.get(d.track);
    if (t?.kind !== "track") continue;
    const a = m.toScreen(t.start.x * NM, t.start.y * NM);
    const b = m.toScreen(t.end.x * NM, t.end.y * NM);
    out.push(`<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" stroke="${WARN}" stroke-width="${f1(Math.max(2, t.width * NM * m.scale + 3))}" stroke-opacity="0.35" stroke-linecap="round" stroke-dasharray="5 3"/>`);
  }
  if (c.detached.length) {
    const b = boxOfIds(doc, c.detached.map((d) => d.track));
    if (b) {
      const p = m.toScreen(b[0], b[1]);
      const why = [...new Set(c.detached.map((d) => (d.reason === "short" ? `short${d.with ? ` with ${d.with}` : ""}` : "locked")))].slice(0, 2).join(", ");
      const tag = `${c.detached.length} track${c.detached.length === 1 ? "" : "s"} stay · ${why}`;
      out.push(`<g transform="translate(${f1(p.x)},${f1(p.y + 20)})"><rect x="0" y="-12" width="${f1(tag.length * 6 + 16)}" height="16" rx="3" fill="#161616" stroke="${WARN}" stroke-opacity="0.6"/><text x="8" y="0" fill="${WARN}" ${MONO} font-size="9.5" letter-spacing="0.8">${esc(tag.toUpperCase())}</text></g>`);
    }
  }
  const seen = new Set<string>();
  for (const x of c.collisions) {
    if (seen.has(x.against)) continue;
    seen.add(x.against);
    const b = objectBox(doc, x.against);
    if (!b) continue;
    const p = m.toScreen((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    out.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="9" fill="none" stroke="${FAIL}" stroke-width="1.25" stroke-dasharray="3 2"/>`);
  }
  return out.join("");
}

/** A polygon being drawn (nanometers): its corners, the edge to the cursor, closed back to the first corner. */
export function polygonSvg(pts: readonly { x: number; y: number }[], cursor: { x: number; y: number } | undefined, m: ScreenMap, o: { color: string; label: string; hatch?: boolean }): string {
  const all = cursor ? [...pts, cursor] : [...pts];
  if (!all.length) return "";
  const S = all.map((p) => m.toScreen(p.x * NM, p.y * NM));
  const d = `M${S.map((p) => `${f1(p.x)},${f1(p.y)}`).join("L")}${S.length > 2 ? "Z" : ""}`;
  const out = [`<path d="${d}" fill="${o.color}" fill-opacity="${o.hatch ? 0.1 : 0.06}" stroke="${o.color}" stroke-width="1.25" stroke-dasharray="5 3"/>`];
  for (const p of S.slice(0, pts.length)) out.push(`<rect x="${f1(p.x - 3)}" y="${f1(p.y - 3)}" width="6" height="6" fill="#161616" stroke="${o.color}" stroke-width="1.25"/>`);
  const top = S[0];
  const label = o.label.toUpperCase();
  out.push(`<rect x="${f1(top.x + 6)}" y="${f1(top.y - 22)}" width="${f1(label.length * 6 + 14)}" height="16" rx="3" fill="#161616" stroke="${o.color}" stroke-opacity="0.6"/><text x="${f1(top.x + 13)}" y="${f1(top.y - 11)}" fill="${o.color}" ${MONO} font-size="9.5" letter-spacing="0.8">${esc(label)}</text>`);
  return out.join("");
}

/** The outline's vertex handles (the one under the pointer or being dragged in blue). */
export function outlineHandlesSvg(vs: readonly { x: number; y: number }[], m: ScreenMap, hot?: number, moved?: { index: number; x: number; y: number }): string {
  const out: string[] = [];
  const pts = vs.map((v, i) => (moved && moved.index === i ? { x: moved.x, y: moved.y } : v));
  if (moved) {
    const S = pts.map((p) => m.toScreen(p.x * NM, p.y * NM));
    out.push(`<path d="M${S.map((p) => `${f1(p.x)},${f1(p.y)}`).join("L")}Z" fill="none" stroke="#e6e6e6" stroke-width="1.25" stroke-dasharray="5 3"/>`);
  }
  pts.forEach((p, i) => {
    const s = m.toScreen(p.x * NM, p.y * NM);
    const on = i === hot || moved?.index === i;
    out.push(`<rect x="${f1(s.x - 4)}" y="${f1(s.y - 4)}" width="8" height="8" fill="${on ? SELECT : "#161616"}" stroke="${on ? SELECT : "#e6e6e6"}" stroke-width="1.25"/>`);
  });
  return out.join("");
}

/** A straight line being drawn (silkscreen), nanometers. */
export function lineSvg(a: { x: number; y: number }, b: { x: number; y: number }, m: ScreenMap, strokeNm: number): string {
  const p = m.toScreen(a.x * NM, a.y * NM);
  const q = m.toScreen(b.x * NM, b.y * NM);
  return `<line x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(q.x)}" y2="${f1(q.y)}" stroke="#e6e6e6" stroke-opacity="0.85" stroke-width="${f1(Math.max(1.25, strokeNm * NM * m.scale))}" stroke-linecap="round"/>`;
}
