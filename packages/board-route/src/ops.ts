/** Router geometry to board operations (`track.add`, `via.add`), with repeats of existing copper dropped. */
import { copperLayers, recordsOfKind, type BoardDocument, type CopperLayer, type OpCall, type Provenance, type Transaction } from "@protoboardai/board";
import { dist, type P } from "./geom.js";

export interface RoutedSegment {
  net: string;
  layer: string;
  width: number;
  start: P;
  end: P;
}

export interface RoutedVia {
  net: string;
  x: number;
  y: number;
  outer: number;
  hole: number;
  from?: string;
  to?: string;
}

const SAME = 1_000; // 1 micrometer

const sameSeg = (a: { start: P; end: P }, b: { start: P; end: P }) =>
  (dist(a.start, b.start) <= SAME && dist(a.end, b.end) <= SAME) || (dist(a.start, b.end) <= SAME && dist(a.end, b.start) <= SAME);

/**
 * Operations adding routed copper: one `track.add` and one `via.add` (in chunks of 5000). Coordinates are rounded to
 * whole nanometers; zero-length pieces, repeats, copper that already exists (same net, layer, width and ends) and
 * copper on a layer or net the board does not have are dropped and counted in `dropped`.
 */
export function routedToOps(doc: BoardDocument, segments: readonly RoutedSegment[], vias: readonly RoutedVia[]): { ops: OpCall[]; segments: number; vias: number; dropped: string[] } {
  const layers = copperLayers(doc);
  const dropped: string[] = [];
  const existingTracks = recordsOfKind(doc, "track");
  const existingVias = recordsOfKind(doc, "via");
  const netOk = (n: string) => !doc.netlist || doc.nets.has(n);
  const segs: { net: string; layer: CopperLayer; width: number; start: P; end: P }[] = [];
  for (const s of segments) {
    const start = { x: Math.round(s.start.x), y: Math.round(s.start.y) };
    const end = { x: Math.round(s.end.x), y: Math.round(s.end.y) };
    const width = Math.round(s.width);
    if (start.x === end.x && start.y === end.y) continue;
    if (!layers.includes(s.layer as CopperLayer)) {
      dropped.push(`segment on layer ${s.layer}, which this board does not have`);
      continue;
    }
    if (!netOk(s.net)) {
      dropped.push(`segment of net ${s.net}, which is not in the netlist`);
      continue;
    }
    if (width <= 0) {
      dropped.push(`segment of net ${s.net} with width ${width}`);
      continue;
    }
    const seg = { net: s.net, layer: s.layer as CopperLayer, width, start, end };
    if (segs.some((o) => o.net === seg.net && o.layer === seg.layer && o.width === seg.width && sameSeg(o, seg))) continue;
    if (existingTracks.some((t) => t.sweep === undefined && t.net === seg.net && t.layer === seg.layer && t.width === seg.width && sameSeg(t, seg))) continue;
    segs.push(seg);
  }
  const vs: { net: string; x: number; y: number; outer_diameter: number; hole_diameter: number; from_layer?: CopperLayer; to_layer?: CopperLayer }[] = [];
  for (const v of vias) {
    const at = { x: Math.round(v.x), y: Math.round(v.y) };
    if (!netOk(v.net)) {
      dropped.push(`via of net ${v.net}, which is not in the netlist`);
      continue;
    }
    if (vs.some((o) => o.net === v.net && dist(o, at) <= SAME)) continue;
    if (existingVias.some((o) => o.net === v.net && dist(o, at) <= SAME)) continue;
    let from = v.from as CopperLayer | undefined;
    let to = v.to as CopperLayer | undefined;
    if (from && to) {
      if (!layers.includes(from) || !layers.includes(to)) {
        from = undefined;
        to = undefined;
      } else if (layers.indexOf(from) > layers.indexOf(to)) [from, to] = [to, from];
      if (from === to) {
        from = undefined;
        to = undefined;
      }
      // a via that spans the whole stack is written as a through via (the default)
      if (from === layers[0] && to === layers[layers.length - 1]) {
        from = undefined;
        to = undefined;
      }
    }
    const outer = Math.round(v.outer);
    const hole = Math.round(v.hole);
    if (!(hole > 0 && outer > hole)) {
      dropped.push(`via of net ${v.net} with outer ${outer} nm and hole ${hole} nm`);
      continue;
    }
    vs.push({ net: v.net, ...at, outer_diameter: outer, hole_diameter: hole, ...(from && to ? { from_layer: from, to_layer: to } : {}) });
  }
  const ops: OpCall[] = [];
  for (let i = 0; i < segs.length; i += 5000) ops.push({ op: "track.add", segments: segs.slice(i, i + 5000).map((s) => ({ net: s.net, layer: s.layer, width: s.width, start: s.start, end: s.end })) });
  for (let i = 0; i < vs.length; i += 5000) ops.push({ op: "via.add", vias: vs.slice(i, i + 5000) });
  return { ops, segments: segs.length, vias: vs.length, dropped };
}

/** Totals of what a list of operations adds. */
export function opsTotals(ops: readonly OpCall[]): { segments: number; vias: number; length: number } {
  let segments = 0;
  let vias = 0;
  let length = 0;
  for (const op of ops) {
    if (op.op === "track.add") for (const s of op.segments as { start: P; end: P }[]) {
      segments++;
      length += dist(s.start, s.end);
    }
    if (op.op === "via.add") vias += (op.vias as unknown[]).length;
  }
  return { segments, vias, length: Math.round(length) };
}

/** Provenance of routed copper: the tool with its version and the run. */
export function routedProvenance(tool: string, version: string, run: string): Provenance {
  return { by: "routed", tool: `${tool} ${version}`.slice(0, 120), run: run.slice(0, 120) };
}

/** A transaction of router operations (the caller applies it as the router actor). */
export function routerTransaction(batchId: string, label: string, ops: OpCall[], provenance: Provenance, extra: Partial<Transaction> = {}): Transaction {
  return { batchId: batchId.replace(/[^\w.:-]/g, "_").slice(0, 200), label, ops, provenance, ...extra };
}
