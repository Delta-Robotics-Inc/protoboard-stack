/**
 * A small copper model of the board for routing: which pads, tracks and vias of each net already touch (islands),
 * and the clearance between copper of different nets. It builds router inputs and the basic scorer; it is not the
 * board's check engine (inject `@protoboardai/board-checks` or another scorer for real scores). Zones connect
 * nothing here (their fill is derived data this package does not compute).
 */
import { byCodeUnit, copperLayers, padsOf, recordsOfKind, viaLayers, type BoardDocument, type Box, type CopperLayer } from "@protoboardai/board";
import { dist, pointSegDist, segBoxDist, segSegDist, trackLength, trackPieces, type P } from "./geom.js";
import type { BoardScorer, IslandAnchor, ScorerReport } from "./types.js";

export type CopperItem =
  | { kind: "pad"; id: string; net?: string; layers: CopperLayer[]; box: Box; center: P }
  | { kind: "track"; id: string; net?: string; layers: CopperLayer[]; pieces: [P, P][]; width: number; box: Box; locked: boolean }
  | { kind: "via"; id: string; net?: string; layers: CopperLayer[]; center: P; r: number; box: Box; locked: boolean };

export interface CopperModel {
  items: CopperItem[];
  byNet: Map<string, CopperItem[]>;
  layers: CopperLayer[];
}

const growBox = (b: Box, d: number): Box => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const meets = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const shareLayer = (a: readonly string[], b: readonly string[]) => a.some((l) => b.includes(l));

/** Every pad, track and via of the board, with nets (pads from the netlist). */
export function copperModel(doc: BoardDocument): CopperModel {
  const layers = copperLayers(doc);
  const items: CopperItem[] = [];
  for (const fp of recordsOfKind(doc, "footprint")) {
    for (const p of padsOf(fp, layers)) {
      if (!p.layers.length) continue;
      const net = doc.padNets.get(p.id);
      items.push({ kind: "pad", id: p.id, ...(net ? { net } : {}), layers: p.layers, box: p.box, center: { x: p.x, y: p.y } });
    }
  }
  for (const t of recordsOfKind(doc, "track")) {
    const pieces = trackPieces(t);
    let box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [a, b] of pieces) box = { minX: Math.min(box.minX, a.x, b.x), minY: Math.min(box.minY, a.y, b.y), maxX: Math.max(box.maxX, a.x, b.x), maxY: Math.max(box.maxY, a.y, b.y) };
    items.push({ kind: "track", id: t.id, ...(t.net ? { net: t.net } : {}), layers: [t.layer], pieces, width: t.width, box: growBox(box, t.width / 2), locked: !!t.locked });
  }
  for (const v of recordsOfKind(doc, "via")) {
    const r = v.outer_diameter / 2;
    items.push({ kind: "via", id: v.id, ...(v.net ? { net: v.net } : {}), layers: viaLayers(doc, v.from_layer, v.to_layer), center: { x: v.x, y: v.y }, r, box: { minX: v.x - r, minY: v.y - r, maxX: v.x + r, maxY: v.y + r }, locked: !!v.locked });
  }
  const byNet = new Map<string, CopperItem[]>();
  for (const it of items) {
    if (!it.net) continue;
    const l = byNet.get(it.net) ?? [];
    l.push(it);
    byNet.set(it.net, l);
  }
  return { items, byNet, layers };
}

/** The gap between two copper items on a shared layer (0 or less: touching), or Infinity when they share no layer. */
export function copperGap(a: CopperItem, b: CopperItem): number {
  if (!shareLayer(a.layers, b.layers)) return Infinity;
  if (a.kind === "pad" && b.kind === "pad") {
    const dx = Math.max(0, a.box.minX - b.box.maxX, b.box.minX - a.box.maxX);
    const dy = Math.max(0, a.box.minY - b.box.maxY, b.box.minY - a.box.maxY);
    return Math.hypot(dx, dy);
  }
  if (a.kind === "pad" || b.kind === "pad") {
    const pad = (a.kind === "pad" ? a : b) as Extract<CopperItem, { kind: "pad" }>;
    const o = a.kind === "pad" ? b : a;
    if (o.kind === "track") return Math.min(...o.pieces.map(([p, q]) => segBoxDist(p, q, pad.box))) - o.width / 2;
    if (o.kind === "via") return segBoxDist(o.center, o.center, pad.box) - o.r;
    return Infinity;
  }
  if (a.kind === "track" && b.kind === "track") {
    let d = Infinity;
    for (const [p, q] of a.pieces) for (const [r, s] of b.pieces) d = Math.min(d, segSegDist(p, q, r, s));
    return d - a.width / 2 - b.width / 2;
  }
  if (a.kind === "via" && b.kind === "via") return dist(a.center, b.center) - a.r - b.r;
  const via = (a.kind === "via" ? a : b) as Extract<CopperItem, { kind: "via" }>;
  const tr = (a.kind === "track" ? a : b) as Extract<CopperItem, { kind: "track" }>;
  return Math.min(...tr.pieces.map(([p, q]) => pointSegDist(via.center, p, q))) - via.r - tr.width / 2;
}

class UF {
  private readonly p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const x = this.find(a);
    const y = this.find(b);
    if (x !== y) this.p[Math.max(x, y)] = Math.min(x, y);
  }
}

export interface Island {
  net: string;
  items: CopperItem[];
  hasPad: boolean;
}

/** The islands of one net: groups of its pads, tracks and vias that touch, sorted by their first object id. */
export function netIslands(model: CopperModel, net: string): Island[] {
  const items = [...(model.byNet.get(net) ?? [])].sort((a, b) => byCodeUnit(a.id, b.id));
  const uf = new UF(items.length);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      if (!meets(growBox(items[i].box, 1), items[j].box)) continue;
      if (copperGap(items[i], items[j]) <= 1) uf.union(i, j);
    }
  const groups = new Map<number, CopperItem[]>();
  items.forEach((it, i) => {
    const r = uf.find(i);
    const g = groups.get(r) ?? [];
    g.push(it);
    groups.set(r, g);
  });
  return [...groups.values()].map((g) => ({ net, items: g, hasPad: g.some((x) => x.kind === "pad") })).sort((a, b) => byCodeUnit(a.items[0].id, b.items[0].id));
}

/** Missing connections of a net: its islands minus one (islands with a pad, track or via), when it has a pad. */
export function missingOf(islands: Island[]): number {
  return islands.some((i) => i.hasPad) ? Math.max(0, islands.length - 1) : 0;
}

/** Every net with the islands it still has to join (pad islands only: copper islands without a pad are left alone). */
export function openNetIslands(doc: BoardDocument, model = copperModel(doc)): Map<string, Island[]> {
  const out = new Map<string, Island[]>();
  for (const net of [...doc.nets.keys()].sort(byCodeUnit)) {
    const isl = netIslands(model, net).filter((i) => i.hasPad);
    if (isl.length > 1) out.set(net, isl);
  }
  return out;
}

/**
 * One anchor per island: the pad nearest the centroid of the net's other islands (a track end when the island has
 * no pad). Deterministic.
 */
export function islandAnchors(islands: Island[]): IslandAnchor[] {
  const centers = islands.map((isl) => {
    const pts = isl.items.map((i) => (i.kind === "track" ? i.pieces[0][0] : i.center));
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  });
  return islands.map((isl, k) => {
    const others = centers.filter((_, j) => j !== k);
    const target = others.length ? { x: others.reduce((s, p) => s + p.x, 0) / others.length, y: others.reduce((s, p) => s + p.y, 0) / others.length } : centers[k];
    const pads = isl.items.filter((i): i is Extract<CopperItem, { kind: "pad" }> => i.kind === "pad");
    if (pads.length) {
      const best = [...pads].sort((a, b) => dist(a.center, target) - dist(b.center, target) || byCodeUnit(a.id, b.id))[0];
      return { object: best.id, x: best.center.x, y: best.center.y, layers: [...best.layers] };
    }
    const first = isl.items[0];
    const p = first.kind === "track" ? first.pieces[0][0] : first.center;
    return { object: first.id, x: Math.round(p.x), y: Math.round(p.y), layers: [...first.layers] };
  });
}

/** Pairs of copper items of different nets closer than `clearance` (shorts at gap 0 or less), via a 1 mm grid. */
export function clearancePairs(model: CopperModel, clearance: number): { a: string; b: string; gap: number }[] {
  const cell = 1_000_000;
  const grid = new Map<string, number[]>();
  const items = model.items;
  items.forEach((it, i) => {
    const b = growBox(it.box, clearance);
    for (let gx = Math.floor(b.minX / cell); gx <= Math.floor(b.maxX / cell); gx++)
      for (let gy = Math.floor(b.minY / cell); gy <= Math.floor(b.maxY / cell); gy++) {
        const k = `${gx},${gy}`;
        const l = grid.get(k) ?? [];
        l.push(i);
        grid.set(k, l);
      }
  });
  const seen = new Set<string>();
  const out: { a: string; b: string; gap: number }[] = [];
  for (const list of grid.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const a = items[list[x]];
        const b = items[list[y]];
        if (a.net === b.net && a.net !== undefined) continue;
        if (a.kind === "pad" && b.kind === "pad") continue; // pad to pad spacing is placement, not routing
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!meets(growBox(a.box, clearance), b.box)) continue;
        const gap = copperGap(a, b);
        if (gap < clearance) out.push({ a: a.id < b.id ? a.id : b.id, b: a.id < b.id ? b.id : a.id, gap });
      }
  return out.sort((p, q) => byCodeUnit(p.a, q.a) || byCodeUnit(p.b, q.b));
}

/**
 * A basic scorer for tests and for hosts without checks: open = missing connections from the islands above,
 * errors = pairs of different-net copper closer than `clearance` (default 0.1 mm). It is approximate (pads are
 * boxes, zones connect nothing); production callers inject the board checks.
 */
export function basicScorer(clearance = 100_000): BoardScorer {
  return (doc): ScorerReport => {
    const model = copperModel(doc);
    let open = 0;
    const openNets: string[] = [];
    for (const net of [...doc.nets.keys()].sort(byCodeUnit)) {
      const m = missingOf(netIslands(model, net));
      if (m > 0) {
        open += m;
        openNets.push(net);
      }
    }
    const pairs = clearancePairs(model, clearance);
    return { open, errors: pairs.length, openNets, errorIds: pairs.map((p) => `${p.a}|${p.b}`) };
  };
}

/** Vias and total track length of a board (the third and fourth parts of the score). */
export function copperTotals(doc: BoardDocument): { vias: number; length: number } {
  let length = 0;
  for (const t of recordsOfKind(doc, "track")) length += trackLength(t);
  return { vias: recordsOfKind(doc, "via").length, length: Math.round(length) };
}
