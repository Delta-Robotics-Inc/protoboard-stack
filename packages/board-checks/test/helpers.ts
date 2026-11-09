/** Small hand-built boards for tests: millimeter inputs, nanometer records. */
import { createDocument, mm, type BoardDocument, type BoardRecord, type CopperLayer, type FootprintRec, type Pad, type RuleRec, type TrackRec, type Vertex, type ViaRec, type ZoneRec } from "@protoboardai/board";

const GEN = { by: "generated" as const, tool: "test" };
export const P = (x: number, y: number) => ({ x: mm(x), y: mm(y) });
export const rectV = (w: number, h: number, cx = 0, cy = 0): Vertex[] => [P(cx - w / 2, cy - h / 2), P(cx + w / 2, cy - h / 2), P(cx + w / 2, cy + h / 2), P(cx - w / 2, cy + h / 2)];

const COPPER: Record<number, CopperLayer[]> = { 1: ["top"], 2: ["top", "bottom"], 4: ["top", "inner1", "inner2", "bottom"], 6: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"] };

/** The board record, copper stackup and a rectangular outline (w by h mm, centered). */
export function boardRecords(opts: { layers?: 1 | 2 | 4 | 6; w?: number; h?: number; outline?: boolean } = {}): BoardRecord[] {
  const n = opts.layers ?? 2;
  const recs: BoardRecord[] = [{ kind: "board", id: "board", name: "Test", thickness: mm(1.6), copper_layers: n, origin: "center" }];
  COPPER[n].forEach((l, i) => recs.push({ kind: "layer", id: `layer:${l}`, name: l, type: "copper", order: i * 2, thickness: mm(0.035) }));
  if (opts.outline !== false) recs.push({ kind: "outline", id: "outline", outline: rectV(opts.w ?? 20, opts.h ?? 20), source: { kind: "board" }, provenance: GEN });
  return recs;
}

export const smd = (number: string, x: number, y: number, w: number, h: number, extra: Partial<Pad> = {}): Pad => ({ number, type: "smd", shape: "rect", x: mm(x), y: mm(y), width: mm(w), height: mm(h), layer: "top", ...extra });
export const round = (number: string, x: number, y: number, d: number): Pad => ({ number, type: "smd", shape: "circle", x: mm(x), y: mm(y), radius: mm(d / 2), layer: "top" });
export const th = (number: string, x: number, y: number, od: number, hd: number): Pad => ({ number, type: "th", shape: "circle", x: mm(x), y: mm(y), outer_diameter: mm(od), hole_diameter: mm(hd) });
export const np = (number: string, x: number, y: number, hd: number): Pad => ({ number, type: "np", shape: "circle", x: mm(x), y: mm(y), hole_diameter: mm(hd) });

export function fp(ref: string, x: number, y: number, pads: Pad[], extra: Partial<FootprintRec> = {}): FootprintRec {
  return { kind: "footprint", id: `fp:${ref}`, ref, footprint: `Test:${ref}`, x: mm(x), y: mm(y), rotation: 0, side: "top", pads, provenance: GEN, ...extra };
}

export function trk(key: string, net: string | undefined, layer: CopperLayer, w: number, a: [number, number], b: [number, number], extra: Partial<TrackRec> = {}): TrackRec {
  return { kind: "track", id: `trk:${key}`, ...(net ? { net } : {}), layer, width: mm(w), start: P(...a), end: P(...b), provenance: GEN, ...extra };
}

export function via(key: string, net: string | undefined, x: number, y: number, od = 0.6, hd = 0.3, from: CopperLayer = "top", to: CopperLayer = "bottom"): ViaRec {
  return { kind: "via", id: `via:${key}`, ...(net ? { net } : {}), x: mm(x), y: mm(y), outer_diameter: mm(od), hole_diameter: mm(hd), from_layer: from, to_layer: to, provenance: GEN };
}

export function zone(key: string, net: string | undefined, layers: CopperLayer[], outline: Vertex[]): ZoneRec {
  return { kind: "zone", id: `zone:${key}`, ...(net ? { net } : {}), layers, outline, priority: 0, pad_connection: "solid", fill_mode: "solid", remove_islands: "never", provenance: GEN };
}

export function rule(name: string, tier: RuleRec["tier"], check: RuleRec["check"], min: number | undefined, applies: RuleRec["applies"] = {}, extra: Partial<RuleRec> = {}): RuleRec {
  return { kind: "rule", id: `rule:${name}`, tier, check, applies, ...(min !== undefined ? { min: mm(min) } : {}), ...extra };
}

/** A document with a netlist from `{ net: ["R1.1", ...] }`. */
export function makeDoc(records: BoardRecord[], nets: Record<string, string[]> = {}): BoardDocument {
  return createDocument(records, { source: "fixture", nets: Object.entries(nets).map(([name, pins]) => ({ name, pins })) });
}
