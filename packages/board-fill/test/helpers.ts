/** Builders for hand-made boards, a seeded random source, and the synthetic six-layer board for timing. */
import { createDocument, mm, type BoardDocument, type BoardRecord, type CopperLayer, type FootprintRec, type Netlist, type Pad, type Provenance, type RuleRec, type Vertex, type ZoneRec } from "@protoboardai/board";

export const GEN: Provenance = { by: "generated", tool: "board-fill-test" };

export const rect = (w: number, h: number, cx = 0, cy = 0): Vertex[] => [
  { x: mm(cx - w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy + h / 2) },
  { x: mm(cx - w / 2), y: mm(cy + h / 2) },
];

export function stackRecords(copper: CopperLayer[]): BoardRecord[] {
  const out: BoardRecord[] = [{ kind: "board", id: "board", name: "test board", thickness: mm(1.6), copper_layers: copper.length, origin: "center" }];
  copper.forEach((l, i) => {
    out.push({ kind: "layer", id: `layer:${l}`, name: l, type: "copper", order: 2 * i, thickness: mm(0.035) });
    if (i < copper.length - 1) out.push({ kind: "layer", id: `layer:core${i + 1}`, name: `core${i + 1}`, type: "dielectric", order: 2 * i + 1, thickness: mm(0.2) });
  });
  return out;
}

export function zone(key: string, net: string | undefined, layers: CopperLayer[], outline: Vertex[], extra: Partial<ZoneRec> = {}): ZoneRec {
  return {
    kind: "zone",
    id: `zone:${key}`,
    ...(net !== undefined ? { net } : {}),
    layers,
    outline,
    priority: 0,
    pad_connection: "thermal",
    fill_mode: "solid",
    remove_islands: "always",
    provenance: GEN,
    ...extra,
  };
}

export const rule = (key: string, tier: RuleRec["tier"], check: RuleRec["check"], min: number, applies: RuleRec["applies"] = {}): RuleRec => ({ kind: "rule", id: `rule:${key}`, tier, check, applies, min });

export const smd = (number: string, x: number, y: number, w: number, h: number, extra: Partial<Pad> = {}): Pad => ({ number, type: "smd", shape: "rect", x: mm(x), y: mm(y), width: mm(w), height: mm(h), ...extra });

export function footprint(ref: string, x: number, y: number, pads: Pad[], extra: Partial<FootprintRec> = {}): FootprintRec {
  return { kind: "footprint", id: `fp:${ref}`, ref, footprint: "Test:FP", x: mm(x), y: mm(y), rotation: 0, side: "top", pads, provenance: GEN, ...extra };
}

export function track(key: string, net: string | undefined, layer: CopperLayer, w: number, x0: number, y0: number, x1: number, y1: number, sweep?: number): BoardRecord {
  return { kind: "track", id: `trk:${key}`, ...(net !== undefined ? { net } : {}), layer, width: mm(w), start: { x: mm(x0), y: mm(y0) }, end: { x: mm(x1), y: mm(y1) }, ...(sweep !== undefined ? { sweep } : {}), provenance: GEN };
}

export function via(key: string, net: string | undefined, x: number, y: number, d = 0.6, hole = 0.3, from: CopperLayer = "top", to: CopperLayer = "bottom"): BoardRecord {
  return { kind: "via", id: `via:${key}`, ...(net !== undefined ? { net } : {}), x: mm(x), y: mm(y), outer_diameter: mm(d), hole_diameter: mm(hole), from_layer: from, to_layer: to, provenance: GEN };
}

/** A two-layer board W x H mm with a global clearance and edge clearance rule, plus the given records. */
export function board(records: BoardRecord[], opts: { w?: number; h?: number; clearance?: number; edge?: number; netlist?: Netlist; copper?: CopperLayer[]; outline?: Vertex[] } = {}): BoardDocument {
  const w = opts.w ?? 20;
  const h = opts.h ?? 20;
  return createDocument(
    [
      ...stackRecords(opts.copper ?? ["top", "bottom"]),
      { kind: "outline", id: "outline", outline: opts.outline ?? rect(w, h), source: { kind: "board" }, provenance: GEN },
      rule("clearance", "target", "clearance", mm(opts.clearance ?? 0.2)),
      rule("edge", "floor", "edge_clearance", mm(opts.edge ?? 0.3)),
      ...records,
    ],
    opts.netlist ?? { source: "fixture", nets: [] },
  );
}

/** A small deterministic random source (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A synthetic six-layer board, 100 x 80 mm: 40 footprints (120 pads), about 1,000 tracks on all layers, 230 through
 * vias, and six large zones (one per layer, ground and power, thermal reliefs, island removal, optional minimum width).
 */
export function synthetic6(opts: { minWidth?: number; seed?: number } = {}): BoardDocument {
  const rnd = prng(opts.seed ?? 7);
  const copper: CopperLayer[] = ["top", "inner1", "inner2", "inner3", "inner4", "bottom"];
  const W = 100;
  const H = 80;
  const records: BoardRecord[] = [];
  const nets: Netlist["nets"] = [
    { name: "GND", pins: [] },
    { name: "+3V3", pins: [] },
  ];
  for (let i = 0; i < 120; i++) nets.push({ name: `S${i}`, pins: [] });
  const netOf = (name: string) => nets.find((n) => n.name === name)!;
  // footprints: 30 two-pad parts and 10 eight-pad parts on the outer layers
  for (let i = 0; i < 40; i++) {
    const x = Math.round((rnd() - 0.5) * (W - 12) * 10) / 10;
    const y = Math.round((rnd() - 0.5) * (H - 12) * 10) / 10;
    const ref = i < 30 ? `R${i + 1}` : `U${i - 29}`;
    const side = rnd() < 0.3 ? "bottom" : "top";
    const pads: Pad[] = [];
    if (i < 30) {
      pads.push(smd("1", -0.8, 0, 0.8, 0.95), smd("2", 0.8, 0, 0.8, 0.95));
    } else {
      for (let k = 0; k < 4; k++) pads.push(smd(String(k + 1), -2.5, -1.5 + k, 1.2, 0.5));
      for (let k = 0; k < 4; k++) pads.push(smd(String(k + 5), 2.5, 1.5 - k, 1.2, 0.5));
    }
    records.push(footprint(ref, x, y, pads, { side, rotation: Math.floor(rnd() * 4) * 90_000 }));
    pads.forEach((p, k) => {
      const n = k === 0 ? "GND" : k === 1 && i >= 30 ? "+3V3" : `S${Math.floor(rnd() * 120)}`;
      netOf(n).pins.push(`${ref}.${p.number}`);
    });
  }
  // tracks: short random runs on every layer
  for (let i = 0; i < 1000; i++) {
    const layer = copper[i % 6];
    const x = (rnd() - 0.5) * (W - 6);
    const y = (rnd() - 0.5) * (H - 6);
    const len = 1 + rnd() * 8;
    const dir = Math.floor(rnd() * 8) * (Math.PI / 4);
    const net = `S${Math.floor(rnd() * 120)}`;
    records.push(track(`t${i}`, net, layer, 0.2, x, y, Math.max(-W / 2 + 2, Math.min(W / 2 - 2, x + len * Math.cos(dir))), Math.max(-H / 2 + 2, Math.min(H / 2 - 2, y + len * Math.sin(dir)))));
  }
  for (let i = 0; i < 230; i++) {
    const net = i % 3 === 0 ? "GND" : i % 3 === 1 ? "+3V3" : `S${Math.floor(rnd() * 120)}`;
    records.push(via(`v${i}`, net, (rnd() - 0.5) * (W - 6), (rnd() - 0.5) * (H - 6)));
  }
  copper.forEach((l, i) => {
    const net = i === 2 || i === 4 ? "+3V3" : "GND";
    records.push(zone(`z${i}`, net, [l], rect(W - 1, H - 1), { clearance: mm(0.25), thermal_gap: mm(0.3), thermal_spoke_width: mm(0.3), ...(opts.minWidth ? { min_width: mm(opts.minWidth) } : {}) }));
  });
  return board(records, { w: W, h: H, copper, netlist: { source: "fixture", nets } });
}

const NETS = ["GND", "A", "B"];

/** A random 20 x 20 mm board: pads of every shape and rotation, tracks and arcs, vias on three nets, one ground zone. */
export function randomBoard(seed: number, minWidth?: number): { doc: BoardDocument; obstacles: string[] } {
  const rnd = prng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const at = () => Math.round((rnd() - 0.5) * 16 * 1000) / 1000;
  const records: BoardRecord[] = [];
  const nl: Netlist = { source: "fixture", nets: NETS.map((name) => ({ name, pins: [] })) };
  const obstacles: string[] = [];
  for (let i = 0; i < 12; i++) {
    const shape = pick(["rect", "roundrect", "circle", "oval"] as const);
    const w = 0.3 + rnd() * 1.2;
    const h = 0.3 + rnd() * 1.2;
    const p: Pad =
      shape === "circle"
        ? { number: "1", type: "smd", shape, x: 0, y: 0, radius: mm(w / 2) }
        : { number: "1", type: "smd", shape, x: 0, y: 0, width: mm(w), height: mm(h), rotation: Math.floor(rnd() * 360) * 1000, ...(shape === "roundrect" ? { corner_radius: mm(Math.min(w, h) / 4) } : {}) };
    const ref = `P${i}`;
    const net = pick(NETS);
    records.push(footprint(ref, at(), at(), [p], { rotation: Math.floor(rnd() * 4) * 90_000, side: rnd() < 0.2 ? "bottom" : "top" }));
    nl.nets.find((n) => n.name === net)!.pins.push(`${ref}.1`);
    if (net !== "GND") obstacles.push(`fp:${ref}`);
  }
  for (let i = 0; i < 8; i++) {
    const net = pick(NETS);
    const x = at();
    const y = at();
    const arc = rnd() < 0.3 ? (rnd() < 0.5 ? 1 : -1) * Math.round((20 + rnd() * 150) * 1000) : undefined;
    records.push(track(`t${i}`, net, "top", 0.15 + rnd() * 0.25, x, y, Math.max(-8, Math.min(8, x + (rnd() - 0.5) * 8)), Math.max(-8, Math.min(8, y + (rnd() - 0.5) * 8)), arc));
    if (net !== "GND") obstacles.push(`trk:t${i}`);
  }
  for (let i = 0; i < 6; i++) {
    const net = pick(NETS);
    records.push(via(`v${i}`, net, at(), at()));
    if (net !== "GND") obstacles.push(`via:v${i}`);
  }
  records.push(via("anchor", "GND", 9, 9, 0.4, 0.2));
  records.push(zone("z", "GND", ["top"], rect(19, 19), { thermal_gap: mm(0.25), thermal_spoke_width: mm(0.3), ...(minWidth ? { min_width: mm(minWidth) } : {}) }));
  return { doc: board(records, { clearance: 0.15 + rnd() * 0.15, netlist: nl }), obstacles };
}
