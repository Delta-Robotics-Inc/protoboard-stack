/**
 * DXF for mechanical CAD: the board outline and cutouts, and optionally pads, holes and courtyards, as an ASCII DXF
 * (R12 entity set: LINE, ARC, CIRCLE) in millimeters with `$INSUNITS` 4, written from Autodesk's DXF reference.
 * Arcs stay arcs. Layers: `OUTLINE`, `CUTOUTS`, `PADS_TOP`, `PADS_BOTTOM`, `HOLES`, `COURTYARD_TOP`, `COURTYARD_BOTTOM`.
 */
import { arcCenter, copperLayers, footprintToWorld, padsOf, recordsOfKind, rotatePoint, type BoardDocument, type Vertex } from "@protoboardai/board";
import { mmText } from "./format.js";
import type { Pt } from "./geom.js";

export interface DxfOptions {
  origin?: Pt;
  /** Pad outlines on `PADS_TOP` and `PADS_BOTTOM` (default false). */
  pads?: boolean;
  /** Drilled holes as circles on `HOLES` (default false). */
  holes?: boolean;
  /** Footprint courtyards (default false). */
  courtyards?: boolean;
}

const LAYERS = ["OUTLINE", "CUTOUTS", "PADS_TOP", "PADS_BOTTOM", "HOLES", "COURTYARD_TOP", "COURTYARD_BOTTOM"];
const COLORS: Record<string, number> = { OUTLINE: 7, CUTOUTS: 7, PADS_TOP: 1, PADS_BOTTOM: 5, HOLES: 3, COURTYARD_TOP: 6, COURTYARD_BOTTOM: 4 };

/** Angle in degrees, 6 decimals, in [0, 360). */
const ang = (rad: number): string => {
  let d = (rad * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  const s = (Math.round(d * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "");
  return s === "360" ? "0" : s;
};

/** Write the DXF text. */
export function writeDxf(doc: BoardDocument, options: DxfOptions = {}): string {
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const X = (nm: number) => mmText(nm - ox, 6);
  const Y = (nm: number) => mmText(nm - oy, 6);
  const ents: string[] = [];
  const line = (layer: string, a: Pt, b: Pt) => ents.push("0", "LINE", "8", layer, "10", X(a.x), "20", Y(a.y), "30", "0", "11", X(b.x), "21", Y(b.y), "31", "0");
  const circle = (layer: string, c: Pt, r: number) => ents.push("0", "CIRCLE", "8", layer, "10", X(c.x), "20", Y(c.y), "30", "0", "40", mmText(r, 6));
  const arc = (layer: string, a: Pt, b: Pt, sweep: number) => {
    const c = arcCenter({ x: a.x, y: a.y }, { x: b.x, y: b.y }, sweep);
    const aa = Math.atan2(a.y - c.y, a.x - c.x);
    const ab = Math.atan2(b.y - c.y, b.x - c.x);
    const [s, e] = sweep > 0 ? [aa, ab] : [ab, aa];
    ents.push("0", "ARC", "8", layer, "10", mmText(Math.round(c.x) - ox, 6), "20", mmText(Math.round(c.y) - oy, 6), "30", "0", "40", mmText(Math.round(c.r), 6), "50", ang(s), "51", ang(e));
  };
  const contour = (layer: string, vs: readonly Vertex[]) => {
    vs.forEach((v, i) => {
      const n = vs[(i + 1) % vs.length];
      if (v.sweep !== undefined) arc(layer, v, n, v.sweep);
      else line(layer, v, n);
    });
  };
  const ring = (layer: string, pts: Pt[]) => pts.forEach((p, i) => line(layer, p, pts[(i + 1) % pts.length]));

  const outline = doc.records.get("outline");
  if (outline?.kind === "outline") contour("OUTLINE", outline.outline);
  for (const c of recordsOfKind(doc, "cutout").sort((a, b) => (a.id < b.id ? -1 : 1))) contour("CUTOUTS", c.outline);
  const stack = copperLayers(doc);
  const fps = recordsOfKind(doc, "footprint").sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const fp of fps) {
    if (options.courtyards && fp.courtyard) {
      const pts = fp.courtyard.map((v) => {
        const w = footprintToWorld(fp, v);
        return { x: Math.round(w.x), y: Math.round(w.y) };
      });
      ring(fp.side === "top" ? "COURTYARD_TOP" : "COURTYARD_BOTTOM", pts);
    }
    if (!options.pads && !options.holes) continue;
    for (const wp of padsOf(fp, stack)) {
      const p = wp.pad;
      if (options.holes && p.type !== "smd") {
        const d = p.hole_diameter ?? Math.min(p.hole_width ?? 0, p.hole_height ?? 0);
        if (d > 0) circle("HOLES", wp, d / 2);
      }
      if (!options.pads || p.type === "np") continue;
      const layers = p.type === "smd" ? [wp.layers[0] === stack[0] ? "PADS_TOP" : "PADS_BOTTOM"] : ["PADS_TOP", "PADS_BOTTOM"];
      for (const layer of layers) {
        if (p.shape === "circle") {
          circle(layer, wp, (p.type === "th" ? p.outer_diameter! : 2 * p.radius!) / 2);
          continue;
        }
        if (p.shape === "polygon" && p.points) {
          ring(
            layer,
            p.points.map((v) => {
              const r = rotatePoint(v, p.rotation ?? 0);
              const w = footprintToWorld(fp, { x: p.x + r.x, y: p.y + r.y });
              return { x: Math.round(w.x), y: Math.round(w.y) };
            }),
          );
          continue;
        }
        const w = p.type === "th" ? p.outer_width! : p.width!;
        const h = p.type === "th" ? p.outer_height! : p.height!;
        const corners = [
          [-w / 2, -h / 2],
          [w / 2, -h / 2],
          [w / 2, h / 2],
          [-w / 2, h / 2],
        ].map(([x, y]) => {
          const r = rotatePoint({ x, y }, wp.rotation);
          return { x: Math.round(wp.x + r.x), y: Math.round(wp.y + r.y) };
        });
        ring(layer, corners);
      }
    }
  }
  const head = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "9", "$MEASUREMENT", "70", "1", "0", "ENDSEC"];
  const tables = ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(LAYERS.length)];
  for (const l of LAYERS) tables.push("0", "LAYER", "2", l, "70", "0", "62", String(COLORS[l]), "6", "CONTINUOUS");
  tables.push("0", "ENDTAB", "0", "ENDSEC");
  const body = ["0", "SECTION", "2", "ENTITIES", ...ents, "0", "ENDSEC", "0", "EOF"];
  return `${[...head, ...tables, ...body].join("\n")}\n`;
}
