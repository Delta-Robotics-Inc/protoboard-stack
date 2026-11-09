/** Synthetic boards for the style tests (the Airnode C3 fixture comes from the board core). */
import { createDocument, mm, type BoardDocument, type BoardRecord, type FootprintRec, type Pad } from "@protoboardai/board";

const smd = (number: string, x: number, y: number, w: number, h: number): Pad => ({ number, type: "smd", shape: "rect", x: mm(x), y: mm(y), width: mm(w), height: mm(h), layer: "top" });

function chip(ref: string, path: string, x: number, y: number, side: "top" | "bottom" = "top"): FootprintRec {
  return {
    kind: "footprint",
    id: `fp:${path}`,
    ref,
    path,
    footprint: "Test:R_0603",
    x: mm(x),
    y: mm(y),
    rotation: 0,
    side,
    pads: [smd("1", -0.8, 0, 0.8, 0.95), smd("2", 0.8, 0, 0.8, 0.95)],
    courtyard: [
      { x: mm(-1.2), y: mm(-0.65) },
      { x: mm(1.2), y: mm(-0.65) },
      { x: mm(1.2), y: mm(0.65) },
      { x: mm(-1.2), y: mm(0.65) },
    ],
    texts: [{ layer: "top_silkscreen", text: "REF", x: 0, y: mm(1.3), height: mm(0.8), stroke_width: mm(0.12), role: "ref" }],
    provenance: { by: "generated", tool: "style-test" },
  };
}

const layers: BoardRecord[] = [
  { kind: "layer", id: "layer:top", name: "top", type: "copper", order: 0, thickness: mm(0.035) },
  { kind: "layer", id: "layer:core1", name: "core1", type: "dielectric", order: 1, thickness: mm(1.5) },
  { kind: "layer", id: "layer:bottom", name: "bottom", type: "copper", order: 2, thickness: mm(0.035) },
];

/** A round board, 40 mm across, with two groups of parts and a pad near the edge (for the edge ring). */
export function roundBoard(): BoardDocument {
  const r = mm(20);
  return createDocument([
    { kind: "board", id: "board", name: "Disc", thickness: mm(1.6), copper_layers: 2, origin: "center" },
    ...layers,
    { kind: "outline", id: "outline", outline: [{ x: r, y: 0, sweep: 180_000 }, { x: -r, y: 0, sweep: 180_000 }], source: { kind: "board" } },
    chip("R1", "led/r1", -4, 2),
    chip("D1", "led/d1", -4, 5),
    chip("R2", "sense/r2", 5, -3),
    chip("C1", "sense/c1", 5, -6),
    chip("J1", "edge/j1", 0, -17.5),
    chip("R9", "back/r9", 0, 6, "bottom"),
    chip("R10", "back/r10", 3, 6, "bottom"),
  ]);
}

/** One footprint with pads 0.2 mm apart (a fine-pitch part for the mask web guard). */
export function finePitchBoard(): BoardDocument {
  const fp: FootprintRec = {
    kind: "footprint",
    id: "fp:U1",
    ref: "U1",
    footprint: "Test:QFN-fine",
    x: 0,
    y: 0,
    rotation: 0,
    side: "top",
    pads: [smd("1", -0.25, 0, 0.3, 0.8), smd("2", 0.25, 0, 0.3, 0.8)],
    provenance: { by: "generated" },
  };
  return createDocument([
    { kind: "board", id: "board", name: "Fine", thickness: mm(1.6), copper_layers: 2, origin: "center" },
    ...layers,
    { kind: "outline", id: "outline", outline: [{ x: mm(-5), y: mm(-5) }, { x: mm(5), y: mm(-5) }, { x: mm(5), y: mm(5) }, { x: mm(-5), y: mm(5) }], source: { kind: "board" } },
    fp,
  ]);
}
