/**
 * Net completion: which copper of each net touches which, how many links are missing, and the ratsnest lines that
 * would close them. The board checks package is the authority; pass its result as `ConnectivityInput`. Without one
 * the scene estimates connectivity from geometry (copper overlap on a shared layer) and says so: zone fill is not
 * computed, so an item of a zone's net inside the zone's outline on a zone layer counts as joined to the pour.
 */
import type { BoardModel, MPad, MTrack, MVia, MArea } from "./model.js";
import { padSdf } from "./model.js";
import { byStr, dist, pointInPolygon, polyDist, polyPolyDist, type Pt } from "./util.js";

/** One net's islands as the checks package reports them (object and pad ids). */
export interface NetConnectivity {
  net: string;
  islands: string[][];
  /** Missing links: islands with pads, minus one. */
  missing: number;
}
/** One ratsnest line, in the core's units (nanometers). */
export interface RatsnestLink {
  net: string;
  from: { id: string; x: number; y: number; layer?: string };
  to: { id: string; x: number; y: number; layer?: string };
}
/** Connectivity from the checks package (the shape this package assumes; see the README). */
export interface ConnectivityInput {
  source?: string;
  nets: NetConnectivity[];
  ratsnest: RatsnestLink[];
}

export interface RatLink {
  /** A scene-only id: `rat:<net>:<n>`, n from 1 in the net's order. */
  id: string;
  net: string;
  from: { id: string; at: Pt };
  to: { id: string; at: Pt };
  len: number;
}

export interface NetState {
  net: string;
  /** Islands holding at least one pad, each a sorted list of ids; islands sorted by first id. */
  islands: string[][];
  /** Copper islands that touch no pad (dangling copper), each sorted. */
  floating: string[][];
  missing: number;
  status: "complete" | "partial" | "unrouted" | "single" | "empty";
}

export interface ConnectivityResult {
  /** `estimate` (from geometry in this package) or `checks:<source>`. */
  source: string;
  nets: Map<string, NetState>;
  rats: RatLink[];
}

const TOL = 0.001;

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  union(a: string, b: string): void {
    const x = this.find(a);
    const y = this.find(b);
    if (x === y) return;
    // deterministic: the smaller id is the root
    if (x < y) this.parent.set(y, x);
    else this.parent.set(x, y);
  }
}

type Item = { id: string; kind: "pad"; pad: MPad } | { id: string; kind: "track"; t: MTrack } | { id: string; kind: "via"; v: MVia } | { id: string; kind: "zone"; z: MArea };

function touches(a: Item, b: Item): boolean {
  const k = `${a.kind}-${b.kind}`;
  switch (k) {
    case "track-track": {
      const x = (a as Extract<Item, { kind: "track" }>).t;
      const y = (b as Extract<Item, { kind: "track" }>).t;
      return x.layer === y.layer && polyPolyDist(x.pts, y.pts) <= (x.w + y.w) / 2 + TOL;
    }
    case "track-pad":
    case "pad-track": {
      const t = (a.kind === "track" ? a : b) as Extract<Item, { kind: "track" }>;
      const p = (a.kind === "pad" ? a : b) as Extract<Item, { kind: "pad" }>;
      if (!p.pad.layers.includes(t.t.layer)) return false;
      if (padSdf(p.pad.shape, t.t.a) <= t.t.w / 2 + TOL || padSdf(p.pad.shape, t.t.b) <= t.t.w / 2 + TOL) return true;
      return polyDist({ x: p.pad.x, y: p.pad.y }, t.t.pts) <= t.t.w / 2 + TOL;
    }
    case "track-via":
    case "via-track": {
      const t = (a.kind === "track" ? a : b) as Extract<Item, { kind: "track" }>;
      const v = (a.kind === "via" ? a : b) as Extract<Item, { kind: "via" }>;
      return v.v.layers.includes(t.t.layer) && polyDist({ x: v.v.x, y: v.v.y }, t.t.pts) <= (t.t.w + v.v.d) / 2 + TOL;
    }
    case "via-pad":
    case "pad-via": {
      const v = (a.kind === "via" ? a : b) as Extract<Item, { kind: "via" }>;
      const p = (a.kind === "pad" ? a : b) as Extract<Item, { kind: "pad" }>;
      return p.pad.layers.some((l) => v.v.layers.includes(l)) && padSdf(p.pad.shape, { x: v.v.x, y: v.v.y }) <= v.v.d / 2 + TOL;
    }
    case "via-via": {
      const x = (a as Extract<Item, { kind: "via" }>).v;
      const y = (b as Extract<Item, { kind: "via" }>).v;
      return x.layers.some((l) => y.layers.includes(l)) && dist(x, y) <= (x.d + y.d) / 2 + TOL;
    }
    case "pad-pad": {
      const x = (a as Extract<Item, { kind: "pad" }>).pad;
      const y = (b as Extract<Item, { kind: "pad" }>).pad;
      if (!x.layers.some((l) => y.layers.includes(l))) return false;
      return padSdf(x.shape, { x: y.x, y: y.y }) <= 0 || padSdf(y.shape, { x: x.x, y: x.y }) <= 0;
    }
    default: {
      // zone with anything: inside the outline on a shared layer (fill not computed)
      const z = (a.kind === "zone" ? a : b) as Extract<Item, { kind: "zone" }>;
      const o = a.kind === "zone" ? b : a;
      if (o.kind === "zone") return o.z.layers.some((l) => z.z.layers.includes(l)) && (pointInPolygon(o.z.outline[0], z.z.outline) || pointInPolygon(z.z.outline[0], o.z.outline));
      if (o.kind === "pad") return o.pad.layers.some((l) => z.z.layers.includes(l)) && pointInPolygon({ x: o.pad.x, y: o.pad.y }, z.z.outline);
      if (o.kind === "via") return o.v.layers.some((l) => z.z.layers.includes(l)) && pointInPolygon({ x: o.v.x, y: o.v.y }, z.z.outline);
      if (o.kind === "track") return z.z.layers.includes(o.t.layer) && o.t.pts.some((p) => pointInPolygon(p, z.z.outline));
      return false;
    }
  }
}

/** Points a ratsnest line may start or end at, for an item. */
function anchors(it: Item): { id: string; at: Pt }[] {
  if (it.kind === "pad") return [{ id: it.id, at: { x: it.pad.x, y: it.pad.y } }];
  if (it.kind === "via") return [{ id: it.id, at: { x: it.v.x, y: it.v.y } }];
  if (it.kind === "track") return [
    { id: it.id, at: it.t.a },
    { id: it.id, at: it.t.b },
  ];
  return [];
}

function statusOf(pads: number, copper: number, missing: number): NetState["status"] {
  if (pads === 0) return "empty";
  if (pads === 1) return "single";
  if (missing === 0) return "complete";
  return copper > 0 ? "partial" : "unrouted";
}

/** Estimate every net's connectivity from geometry. */
export function estimateConnectivity(model: BoardModel): ConnectivityResult {
  const nets = new Map<string, NetState>();
  const rats: RatLink[] = [];
  const byNet = new Map<string, Item[]>();
  const add = (net: string | undefined, it: Item) => {
    if (!net) return;
    let l = byNet.get(net);
    if (!l) byNet.set(net, (l = []));
    l.push(it);
  };
  for (const n of model.nets) for (const pid of n.pads) {
    const pad = model.padById.get(pid);
    if (pad) add(n.name, { id: pid, kind: "pad", pad });
  }
  for (const t of model.tracks) add(t.net, { id: t.id, kind: "track", t });
  for (const v of model.vias) add(v.net, { id: v.id, kind: "via", v });
  for (const z of model.zones) add(z.net, { id: z.id, kind: "zone", z });

  for (const n of model.nets) {
    const items = (byNet.get(n.name) ?? []).slice().sort((a, b) => byStr(a.id, b.id));
    const uf = new UnionFind();
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        // a cheap box test first
        const ba = a.kind === "pad" ? a.pad.box : a.kind === "track" ? a.t.box : a.kind === "via" ? a.v.box : a.z.box;
        const bb = b.kind === "pad" ? b.pad.box : b.kind === "track" ? b.t.box : b.kind === "via" ? b.v.box : b.z.box;
        if (ba.minX > bb.maxX + TOL || bb.minX > ba.maxX + TOL || ba.minY > bb.maxY + TOL || bb.minY > ba.maxY + TOL) continue;
        if (touches(a, b)) uf.union(a.id, b.id);
      }
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const r = uf.find(it.id);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = []));
      g.push(it);
    }
    const withPads: Item[][] = [];
    const floating: string[][] = [];
    for (const g of [...groups.values()]) {
      if (g.some((x) => x.kind === "pad")) withPads.push(g);
      else floating.push(g.map((x) => x.id).sort(byStr));
    }
    withPads.sort((a, b) => byStr(a[0].id, b[0].id));
    floating.sort((a, b) => byStr(a[0], b[0]));
    const missing = Math.max(0, withPads.length - 1);
    const copper = items.filter((x) => x.kind !== "pad").length;
    nets.set(n.name, { net: n.name, islands: withPads.map((g) => g.map((x) => x.id).sort(byStr)), floating, missing, status: statusOf(n.pads.length, copper, missing) });
    // ratsnest: Prim's tree over islands, edge = nearest anchors
    if (withPads.length > 1) {
      const anc = withPads.map((g) => g.flatMap(anchors));
      const inTree = new Set<number>([0]);
      let k = 1;
      while (inTree.size < withPads.length) {
        let best: { d: number; from: { id: string; at: Pt }; to: { id: string; at: Pt }; j: number } | undefined;
        for (const i of [...inTree].sort((a, b) => a - b))
          for (let j = 0; j < withPads.length; j++) {
            if (inTree.has(j)) continue;
            for (const a of anc[i])
              for (const b of anc[j]) {
                const d = dist(a.at, b.at);
                if (!best || d < best.d - 1e-9) best = { d, from: a, to: b, j };
              }
          }
        if (!best) break;
        inTree.add(best.j);
        rats.push({ id: `rat:${n.name}:${k++}`, net: n.name, from: best.from, to: best.to, len: best.d });
      }
    }
  }
  return { source: "estimate", nets, rats };
}

/** Use the checks package's connectivity (nanometers) as the scene's. Nets it leaves out are estimated. */
export function fromInput(model: BoardModel, input: ConnectivityInput): ConnectivityResult {
  const est = estimateConnectivity(model);
  const nets = new Map(est.nets);
  for (const n of input.nets) {
    const net = model.netByName.get(n.net);
    const islands = n.islands.map((g) => [...g].sort(byStr)).sort((a, b) => byStr(a[0] ?? "", b[0] ?? ""));
    const withPads = islands.filter((g) => g.some((id) => id.startsWith("pad:")));
    const copper = islands.flat().filter((id) => !id.startsWith("pad:")).length;
    nets.set(n.net, { net: n.net, islands: withPads, floating: islands.filter((g) => !g.some((id) => id.startsWith("pad:"))), missing: n.missing, status: statusOf(net?.pads.length ?? 0, copper, n.missing) });
  }
  const given = new Set(input.nets.map((n) => n.net));
  const counters = new Map<string, number>();
  const rats: RatLink[] = [];
  for (const r of [...input.ratsnest].sort((a, b) => byStr(a.net, b.net) || byStr(a.from.id, b.from.id) || byStr(a.to.id, b.to.id))) {
    const k = (counters.get(r.net) ?? 0) + 1;
    counters.set(r.net, k);
    const from = { id: r.from.id, at: { x: r.from.x / 1e6, y: r.from.y / 1e6 } };
    const to = { id: r.to.id, at: { x: r.to.x / 1e6, y: r.to.y / 1e6 } };
    rats.push({ id: `rat:${r.net}:${k}`, net: r.net, from, to, len: dist(from.at, to.at) });
  }
  for (const r of est.rats) if (!given.has(r.net)) rats.push(r);
  rats.sort((a, b) => byStr(a.net, b.net) || natIdx(a.id) - natIdx(b.id));
  return { source: `checks${input.source ? `:${input.source}` : ""}`, nets, rats };
}

const natIdx = (id: string): number => Number(id.slice(id.lastIndexOf(":") + 1));

export function connectivityOf(model: BoardModel, input?: ConnectivityInput): ConnectivityResult {
  return input ? fromInput(model, input) : estimateConnectivity(model);
}
