/**
 * Hazard zones: the theme's one stripe pattern, only on declared no-go keep-outs of the kinds the theme lists
 * (antenna, keying flat, UV emitter, high voltage, no metal, hot surface), with the kind's tag as a knockout tag.
 * Stripes are filled silk clipped to the keep-out (less its holes), inside the board's edge clearance, clear of pads,
 * vias and holes by the pad clearance, and clear of the tag. A keep-out's kind comes from the call, else from words
 * in its name or description.
 */
import { recordsOfKind, type BoardDocument, type KeepoutRec, type Side } from "@protoboardai/board";
import { pointInPoly, polyCore, type Shape } from "@protoboardai/board-checks";
import { grow } from "@protoboardai/board-fill";
import { changeSet, ignoredByTool, type Desired, type Skipped, type StyleChangeSet } from "../changeset.js";
import { capsuleRing, difference, intersection, keyhole, knockoutTag, nm, rectRing, ringArea2, ringsOf, simplifyRing, union, verticesToRing, type Polygon, type Ring } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { BoardSpace, ringShape } from "../space.js";
import { HAZARD_KINDS, type HazardKind } from "../tokens.js";
import { boardInset, reverseRing, ringBox, silkClearances, silkLayer, textClassNm, textShape, vertices, type DrawOptions } from "./common.js";

export interface HazardOptions extends DrawOptions {
  /** Kinds by keep-out id (overrides the words in its name). */
  kinds?: Record<string, HazardKind>;
}

const WORDS: [RegExp, HazardKind][] = [
  [/antenna|\brf\b|radio/i, "antennaKeepout"],
  [/no[ -]?metal/i, "noMetal"],
  [/\buv\b|uv-?c|ultraviolet/i, "uvEmitter"],
  [/high[ -]?voltage|\bhv\b|mains/i, "highVoltage"],
  [/\bhot\b|heat|thermal/i, "hotSurface"],
  [/keying|\bflat\b/i, "keyingFlat"],
];

/** A keep-out's hazard kind: the call's, else from its name and description, else none. */
export function hazardKindOf(k: KeepoutRec, kinds?: Record<string, HazardKind>): HazardKind | undefined {
  if (kinds?.[k.id] && HAZARD_KINDS.includes(kinds[k.id])) return kinds[k.id];
  const words = `${k.name ?? ""} ${k.description ?? ""}`;
  for (const [re, kind] of WORDS) if (re.test(words)) return kind;
  return undefined;
}

const TAG_PAD = 200_000;

/** A board-checks shape grown by `g`, as rings. */
export function shapeRings(s: Shape, g: number): Ring[] {
  const k = s.core;
  const r = s.r + g;
  if (k.t === "pt") {
    const out: number[] = [];
    for (let i = 0; i < 16; i++) out.push(Math.round(k.x + r * Math.cos((Math.PI * i) / 8)), Math.round(k.y + r * Math.sin((Math.PI * i) / 8)));
    return [out];
  }
  if (k.t === "seg") return [capsuleRing(k.ax, k.ay, k.bx, k.by, r, 8)];
  if (k.t === "poly") {
    const rings = k.rings.map((x) => Array.from(x, Math.round));
    const outer = ringArea2(rings[0]) < 0 ? reverseRing(rings[0]) : rings[0];
    const holes = rings.slice(1).map((h) => (ringArea2(h) > 0 ? reverseRing(h) : h));
    return r > 0 ? ringsOf(grow([{ outer, holes }], r, 10_000)) : [outer, ...holes];
  }
  // an arc: short strokes along it
  const out: Ring[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const t0 = k.a0 + (k.sw * i) / n;
    const t1 = k.a0 + (k.sw * (i + 1)) / n;
    out.push(capsuleRing(k.cx + k.r * Math.cos(t0), k.cy + k.r * Math.sin(t0), k.cx + k.r * Math.cos(t1), k.cy + k.r * Math.sin(t1), r, 4));
  }
  return out;
}

export function styleHazard(doc: BoardDocument, style: ResolvedStyle, o: HazardOptions = {}): StyleChangeSet {
  const kinds = new Set(tok<string[]>(style, "hazard.zones"));
  const sides = ((v) => (v === "both" ? ["top", "bottom"] : [v]))(tok<string>(style, "hazard.sides")) as Side[];
  const stripe = nm(tokNum(style, "hazard.stripe"));
  const gap = nm(tokNum(style, "hazard.gap"));
  const angle = tokNum(style, "hazard.angle");
  const outlineOn = tok<boolean>(style, "hazard.outline");
  const line = nm(tokNum(style, "silk.line"));
  const clr = silkClearances(style, { silk: false });
  const tcls = textClassNm(style, "type.class.warning");
  const space = new BoardSpace(doc, { ignoreSilk: ignoredByTool(doc, "hazard") });
  const inset = ringsOf(boardInset(doc, clr.edge));
  const desired: Desired[] = [];
  const skipped: Skipped[] = [];
  const zones: { id: string; kind: HazardKind; side: Side; tag?: string; stripes: number }[] = [];
  for (const k of recordsOfKind(doc, "keepout")) {
    const kind = hazardKindOf(k, o.kinds);
    if (!kind) continue;
    if (k.tier !== "no_go") {
      skipped.push({ what: k.id, reason: `a ${k.tier} keep-out: the pattern marks declared no-go zones only`, objects: [k.id] });
      continue;
    }
    if (!kinds.has(kind)) {
      skipped.push({ what: k.id, reason: `${kind} is not in hazard.zones`, objects: [k.id] });
      continue;
    }
    for (const side of sides) {
      if (!k.layers.includes(side)) continue;
      const layer = silkLayer(side);
      let region = difference([ccw(verticesToRing(k.outline).map(Math.round))], (k.holes ?? []).map((h) => ccw(verticesToRing(h).map(Math.round))));
      if (inset.length) region = intersection(ringsOf(region), inset);
      if (!region.length) {
        skipped.push({ what: `${k.id} (${side})`, reason: "the zone lies outside the board's edge clearance", objects: [k.id] });
        continue;
      }
      const rb = region.map((p) => ringBox(p.outer)).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
      const blockers = space.near({ minX: rb.minX - clr.pad - nm(2), minY: rb.minY - clr.pad - nm(2), maxX: rb.maxX + clr.pad + nm(2), maxY: rb.maxY + clr.pad + nm(2) }, side, ["pad", "via", "hole"]);
      const blockRings = blockers.flatMap((b) => shapeRings(b.shape, clr.pad));
      // the tag: inside the zone, clear of pads, nearest the zone's middle
      const tagText = tok<string>(style, `hazard.tag.${kind}`);
      let tagRing: Ring | undefined;
      if (tagText) {
        const probe = knockoutTag(tagText, { x: 0, y: 0, height: tcls.height, stroke: tcls.stroke, pad: TAG_PAD });
        const core = polyCore(ringsOf(region));
        const mid: [number, number] = [(rb.minX + rb.maxX) / 2, (rb.minY + rb.maxY) / 2];
        const cands: [number, number, number][] = [];
        const step = 250_000;
        for (let x = rb.minX + probe.w / 2; x <= rb.maxX - probe.w / 2; x += step) for (let y = rb.minY + probe.h / 2; y <= rb.maxY - probe.h / 2; y += step) cands.push([Math.round(x), Math.round(y), Math.hypot(x - mid[0], y - mid[1])]);
        cands.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
        for (const [x, y] of cands) {
          const corners = [
            [x - probe.w / 2, y - probe.h / 2],
            [x + probe.w / 2, y - probe.h / 2],
            [x + probe.w / 2, y + probe.h / 2],
            [x - probe.w / 2, y + probe.h / 2],
          ];
          if (!corners.every(([px, py]) => pointInPoly(core, px, py))) continue;
          if (space.blocker(textShape(x, y, probe.w, probe.h), side, { pad: clr.pad, edge: clr.edge })) continue;
          const t = knockoutTag(tagText, { x, y, height: tcls.height, stroke: tcls.stroke, pad: TAG_PAD, ...(side === "bottom" ? { mirrored: true } : {}) });
          tagRing = t.ring;
          for (const c of t.contours) desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pts(c)), stroke_width: 0, filled: true });
          space.addSilk(`hazard-tag:${k.id}`, side, [ringShape(t.ring)]);
          break;
        }
        if (!tagRing) skipped.push({ what: `${k.id} (${side}) tag`, reason: "no spot inside the zone clears pads for the tag", objects: [k.id] });
      }
      // stripes: bands at the angle over the zone's box, clipped
      const bands: Ring[] = [];
      const period = stripe + gap;
      const cx = (rb.minX + rb.maxX) / 2;
      const cy = (rb.minY + rb.maxY) / 2;
      const span = Math.hypot(rb.maxX - rb.minX, rb.maxY - rb.minY) + period * 2;
      const a = (angle * Math.PI) / 180;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      for (let d = -span / 2; d <= span / 2; d += period) bands.push(rectRing(Math.round(cx + nx * d), Math.round(cy + ny * d), span, stripe, angle));
      const away = [...blockRings, ...(tagRing ? [grow([{ outer: tagRing, holes: [] }], gap, 10_000)].flatMap(ringsOf) : [])];
      const stripes = difference(ringsOf(intersection(ringsOf(region), ringsOf(union(bands)))), away).filter((p) => Math.abs(ringArea2(p.outer)) > 2 * line * line);
      for (const p of stripes) desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pts(simplifyRing(keyhole(p)))), stroke_width: 0, filled: true });
      if (outlineOn)
        for (const p of region) {
          const ring = simplifyRing(p.outer);
          desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pts(ring)), stroke_width: line });
        }
      zones.push({ id: k.id, kind, side, ...(tagRing ? { tag: tagText } : {}), stripes: stripes.length });
    }
  }
  return changeSet("hazard", `Mark ${zones.length} hazard zone${zones.length === 1 ? "" : "s"} in the ${style.theme.name} pattern`, "stripe declared hazard zones", doc, desired, { skipped, report: { zones }, ...(o.force ? { force: true } : {}) });
}

const ccw = (r: Ring): Ring => (ringArea2(r) < 0 ? reverseRing(r) : r);
const pts = (r: Ring): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
  return out;
};
export type { Polygon };
