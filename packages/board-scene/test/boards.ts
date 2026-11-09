/** Small hand-built boards with known answers for the relation tests. */
import { createDocument, mm, type BoardRecord, type FootprintRec, type Netlist, type Provenance } from "@protoboardai/board";

const GEN: Provenance = { by: "generated", tool: "scene-test" };

export const square = (w: number, h: number, cx = 0, cy = 0) => [
  { x: mm(cx - w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy + h / 2) },
  { x: mm(cx - w / 2), y: mm(cy + h / 2) },
];

/** A 0402-style two-pad part: pads 0.56 x 0.62 at +-0.48 mm, courtyard 1.6 x 0.9. */
export function chip(ref: string, x: number, y: number, side: "top" | "bottom" = "top"): FootprintRec {
  return {
    kind: "footprint",
    id: `fp:${ref}`,
    ref,
    footprint: "Test:0402",
    x: mm(x),
    y: mm(y),
    rotation: 0,
    side,
    pads: [
      { number: "1", type: "smd", shape: "rect", x: mm(-0.48), y: 0, width: mm(0.56), height: mm(0.62), layer: "top" },
      { number: "2", type: "smd", shape: "rect", x: mm(0.48), y: 0, width: mm(0.56), height: mm(0.62), layer: "top" },
    ],
    courtyard: square(1.6, 0.9),
    provenance: GEN,
  };
}

export function board(size: [number, number], records: BoardRecord[], netlist?: Netlist) {
  return createDocument(
    [
      { kind: "board", id: "board", name: "Test board", thickness: mm(1.6), copper_layers: 2, origin: "center" },
      { kind: "outline", id: "outline", outline: square(size[0], size[1]), source: { kind: "board" }, provenance: GEN },
      { kind: "rule", id: "rule:target.track_width", tier: "target", check: "track_width", applies: {}, min: mm(0.2), preferred: mm(0.2) },
      { kind: "rule", id: "rule:target.clearance", tier: "target", check: "clearance", applies: {}, min: mm(0.2) },
      ...records,
    ],
    netlist,
  );
}

export const track = (key: string, net: string | undefined, layer: "top" | "bottom", w: number, a: [number, number], b: [number, number]): BoardRecord => ({
  kind: "track",
  id: `trk:${key}`,
  ...(net ? { net } : {}),
  layer,
  width: mm(w),
  start: { x: mm(a[0]), y: mm(a[1]) },
  end: { x: mm(b[0]), y: mm(b[1]) },
  provenance: { by: "hand" },
});

export const via = (key: string, net: string, x: number, y: number): BoardRecord => ({ kind: "via", id: `via:${key}`, net, x: mm(x), y: mm(y), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", provenance: { by: "hand" } });
