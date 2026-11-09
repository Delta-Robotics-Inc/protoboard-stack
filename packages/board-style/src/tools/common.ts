/** Helpers the style tools share: groups, side layers, board area, text boxes and placement search. */
import { footprintToWorld, padsOf, recordsOfKind, type BoardDocument, type FootprintRec, type Side, type Vertex } from "@protoboardai/board";
import { flattenContour, type Shape } from "@protoboardai/board-checks";
import { capsuleRing, difference, nm, ringArea2, ringsOf, textAdvance, type Polygon, type Ring } from "../geom.js";
import { tok, tokNum, tokText, type ResolvedStyle } from "../resolve.js";
import { boxShape, type BoardSpace, type Clearances } from "../space.js";
import type { TextClass } from "../tokens.js";

export const silkLayer = (side: Side): "top_silkscreen" | "bottom_silkscreen" => (side === "top" ? "top_silkscreen" : "bottom_silkscreen");

export interface Group {
  key: string;
  title: string;
  members: FootprintRec[];
}

/** Groups by UHD instance path: the first `depth` segments name the group. Footprints without a path are left out. */
export function groupsOf(doc: BoardDocument, depth: number, explicit?: { key: string; title?: string; members: string[] }[]): Group[] {
  const fps = recordsOfKind(doc, "footprint");
  if (explicit) {
    const byId = new Map(fps.map((f) => [f.id, f]));
    return explicit.map((g) => ({ key: g.key, title: g.title ?? titleOf(g.key), members: g.members.map((m) => byId.get(m)).filter((f): f is FootprintRec => !!f) }));
  }
  const map = new Map<string, FootprintRec[]>();
  for (const f of fps) {
    if (!f.path) continue;
    const segs = f.path.split("/");
    const key = segs.slice(0, Math.min(depth, Math.max(1, segs.length - 1))).join("/");
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, members]) => ({ key, title: titleOf(key), members: members.sort((a, b) => (a.id < b.id ? -1 : 1)) }));
}

export const titleOf = (key: string): string => key.split("/").pop()!.replace(/[_-]+/g, " ").trim();

/** Apply a text class's case. */
export const cased = (text: string, c: TextClass): string => (c.case === "upper" ? text.toUpperCase() : text);

/** A footprint's courtyard in world coordinates (or its pads' box grown by 0.25 mm). */
export function courtyardRing(fp: FootprintRec): Ring {
  if (fp.courtyard) {
    const r = flattenContour(fp.courtyard, (x, y) => {
      const w = footprintToWorld(fp, { x, y });
      return [w.x, w.y];
    }).map(Math.round);
    return ringArea2(r) < 0 ? reverseRing(r) : r;
  }
  const pads = padsOf(fp);
  const g = nm(0.25);
  const minX = Math.min(...pads.map((p) => p.box.minX)) - g;
  const minY = Math.min(...pads.map((p) => p.box.minY)) - g;
  const maxX = Math.max(...pads.map((p) => p.box.maxX)) + g;
  const maxY = Math.max(...pads.map((p) => p.box.maxY)) + g;
  return [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
}

export function reverseRing(r: Ring): Ring {
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i], r[i + 1]);
  return out;
}

export function ringBox(r: Ring): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < r.length; i += 2) {
    b.minX = Math.min(b.minX, r[i]);
    b.maxX = Math.max(b.maxX, r[i]);
    b.minY = Math.min(b.minY, r[i + 1]);
    b.maxY = Math.max(b.maxY, r[i + 1]);
  }
  return b;
}

/** The board outline and cutouts as rings (outline counterclockwise, cutouts clockwise). */
export function boardRings(doc: BoardDocument): { outline?: Ring; cutouts: Ring[] } {
  const o = doc.records.get("outline");
  const outline = o?.kind === "outline" ? normalizeCcw(flattenContour(o.outline).map(Math.round)) : undefined;
  const cutouts = recordsOfKind(doc, "cutout").map((c) => reverseRing(normalizeCcw(flattenContour(c.outline).map(Math.round))));
  return { ...(outline ? { outline } : {}), cutouts };
}
const normalizeCcw = (r: Ring): Ring => (ringArea2(r) < 0 ? reverseRing(r) : r);

/** The board area shrunk by `d` from every edge (outline and cutouts). */
export function boardInset(doc: BoardDocument, d: number): Polygon[] {
  const { outline, cutouts } = boardRings(doc);
  if (!outline) return [];
  const caps: Ring[] = [];
  for (const r of [outline, ...cutouts]) {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      caps.push(capsuleRing(r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1], d, 4));
    }
  }
  return difference([outline, ...cutouts], caps);
}
export const insetRings = (doc: BoardDocument, d: number): Ring[] => ringsOf(boardInset(doc, d));

/** The clearances most silk uses, from tokens (nm). */
export function silkClearances(style: ResolvedStyle, o: { silk?: boolean; courtyard?: boolean } = {}): Clearances {
  return {
    pad: nm(tokNum(style, "silk.clearance.pad")),
    edge: nm(tokNum(style, "silk.clearance.edge")),
    ...(o.silk === false ? {} : { silk: nm(tokNum(style, "silk.clearance.silk")) }),
    ...(o.courtyard ? { courtyard: nm(tokNum(style, "silk.clearance.courtyard")) } : {}),
  };
}

/** A text class in nanometers. */
export function textClassNm(style: ResolvedStyle, path: string): { height: number; stroke: number; cls: TextClass } {
  const c = tokText(style, path);
  return { height: nm(c.height), stroke: nm(c.stroke), cls: c };
}

/** The ink box of a text (nm) at a rotation of 0 or 90 degrees: width along the reading direction, height across. */
export function textBox(text: string, height: number, stroke: number): { w: number; h: number } {
  return { w: textAdvance(text, height) + stroke, h: height + stroke };
}

/** The shape of a text box centered on (x, y), rotated by `rotMdeg`. */
export const textShape = (x: number, y: number, w: number, h: number, rotMdeg = 0): Shape => boxShape(x, y, w, h, ((rotMdeg / 1000) * Math.PI) / 180);

/** Substitute ${NAME}, ${REV}, ${MOTTO}, ${DATE} and ${YEAR}. */
export function fillTemplate(t: string, vars: Record<string, string>): string {
  return t.replace(/\$\{([A-Z]+)\}/g, (_, k: string) => vars[k] ?? "").replace(/\s+/g, " ").trim();
}

/** A placement search: the first candidate (best score first) whose shapes are clear. */
export function firstClear<C>(cands: C[], score: (c: C) => number, clear: (c: C) => boolean): C | undefined {
  const order = cands.map((c, i) => ({ c, s: score(c), i })).sort((a, b) => a.s - b.s || a.i - b.i);
  for (const o of order) if (clear(o.c)) return o.c;
  return undefined;
}

export const vertices = (pts: [number, number][]): Vertex[] => pts.map(([x, y]) => ({ x, y }));

/** Common options of the drawing tools. */
export interface DrawOptions {
  /** Re-draw records a person edited by hand (default: keep them and report). */
  force?: boolean;
}

/** The side layers a side-list token names. */
export const sidesOf = (style: ResolvedStyle, path: string): Side[] => {
  const v = tok<string>(style, path);
  return v === "both" ? ["top", "bottom"] : [v as Side];
};

/** Where on a board side there is room: candidate centers on a grid over the board area, nearest to `prefer` first. */
export function gridCandidates(space: BoardSpace, step: number): [number, number][] {
  const r = space.model.region;
  if (!r) return [];
  const out: [number, number][] = [];
  for (let x = Math.ceil(r.box.minX / step) * step; x <= r.box.maxX; x += step) for (let y = Math.ceil(r.box.minY / step) * step; y <= r.box.maxY; y += step) out.push([x, y]);
  return out;
}

/**
 * A free spot for a box of w by h (nm) on a side: grid positions over the board, nearest to `prefer` first, whose box
 * clears pads, silk, courtyards (when the clearances name them) and the edge. `extra` may veto a spot.
 */
export function findSpot(space: BoardSpace, side: Side, w: number, h: number, prefer: [number, number], clr: Clearances, o: { step?: number; extra?: (x: number, y: number) => boolean; ignore?: { footprints?: ReadonlySet<string>; ids?: ReadonlySet<string> } } = {}): [number, number] | undefined {
  const r = space.model.region;
  if (!r) return undefined;
  const step = o.step ?? 250_000;
  const cands: [number, number, number][] = [];
  for (let x = Math.ceil((r.box.minX + w / 2) / step) * step; x <= r.box.maxX - w / 2; x += step)
    for (let y = Math.ceil((r.box.minY + h / 2) / step) * step; y <= r.box.maxY - h / 2; y += step) cands.push([x, y, Math.hypot(x - prefer[0], y - prefer[1])]);
  cands.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  for (const [x, y] of cands) {
    if (space.blocker(textShape(x, y, w, h), side, clr, o.ignore ?? {})) continue;
    if (o.extra && !o.extra(x, y)) continue;
    return [x, y];
  }
  return undefined;
}

/** A point at fractions (fx, fy) of the board's box, seen from `side` (bottom is mirrored left to right). */
export function boardPoint(space: BoardSpace, side: Side, fx: number, fy: number): [number, number] {
  const b = space.model.region?.box ?? { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  const x = side === "bottom" ? b.maxX - fx * (b.maxX - b.minX) : b.minX + fx * (b.maxX - b.minX);
  return [Math.round(x), Math.round(b.minY + fy * (b.maxY - b.minY))];
}
