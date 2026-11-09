/**
 * Copper connectivity: which copper touches which, per layer, joined across layers by vias and plated pads, then
 * per net. From it: the ratsnest (the fewest missing links that would join each net, as pad-to-pad or
 * island-to-island pairs with locations), shorts (copper of two nets touching, directly or through unassigned
 * copper), copper without a net touching a net, dangling track ends and vias, and zone fill islands that touch
 * nothing of their net.
 *
 * Semantics, stated so the numbers can be checked:
 *
 * - Two pieces of copper on the same layer touch when their shapes touch or overlap (gap at most
 *   `CONTACT_EPS`). Touching copper of two nets is a short, whatever the shapes.
 * - Touching copper of one net joins (rule `ends`, the default) when a track joins by its end: the end cap of a
 *   track (the half-width disc at its end) touches the other copper, or another track's end cap touches it, or the
 *   center of a pad or via lies in the track (a track that only grazes a pad or via, or crosses another track,
 *   along its length does not join it); pads, vias and zone fill join anything they overlap.
 *   KiCad's ratsnest counts tracks this way (seen on real boards), so the two can be compared item by item.
 *   Rule `overlap` joins any touching copper instead (physical contact). A via or a plated pad joins its own
 *   copper on every layer it spans.
 * - A net's islands are joined through copper of that net. A track, via or zone fill without a net that joins
 *   copper of exactly one net carries that net (as KiCad does when it loads such a board); the contact is still
 *   reported as unassigned copper. Copper without a net that meets two nets joins neither (it is a short), and a
 *   pad the netlist does not name never carries a net.
 * - Ratsnest nodes are islands holding a pad, a track or a via. The missing links are a minimum spanning tree over
 *   them by the shortest distance between their anchor points (pad centers, track ends, via centers); a net with
 *   k such islands has k - 1 missing links. The status line's "unconnected" is the number of links.
 * - Zone fill connects only when fill polygons are given (see fills.ts). Without them a zone connects nothing,
 *   and the result lists those zones; a track end or via inside such a zone of its own net is not called
 *   dangling, because the fill would decide it.
 */
import { byCodeUnit, type Box, type CopperLayer } from "@protoboardai/board";
import { pointInPoly, pointShape, shapeGap, type Gap } from "./geom/shape.js";
import type { CheckModel, CopperItem } from "./model.js";

/** Copper closer than this (nm) is touching. */
export const CONTACT_EPS = 1;

export interface Anchor {
  /** The object the anchor is on (a pad id, track id or via id). */
  object: string;
  x: number;
  y: number;
  layer: CopperLayer;
}

export interface MissingLink {
  net: string;
  from: Anchor;
  to: Anchor;
  /** Straight-line distance between the anchors (nm). */
  length: number;
  /** Indexes into `islands` of the two islands the link joins. */
  islands: [number, number];
}

export interface Island {
  net: string;
  /** Object ids in the island, sorted. */
  objects: string[];
  anchors: Anchor[];
  pads: number;
}

export interface Short {
  nets: [string, string];
  /** The objects' box. */
  box: Box;
  /** The two touching objects; for a short through unassigned copper, the unassigned objects. */
  objects: string[];
  x: number;
  y: number;
  layer: CopperLayer;
  /** True when the nets meet only through copper without a net. */
  bridged?: true;
}

export interface Unassigned {
  /** The copper without a net. */
  object: string;
  box: Box;
  /** The netted copper it touches. */
  touches: string;
  net: string;
  x: number;
  y: number;
  layer: CopperLayer;
}

export interface Dangling {
  object: string;
  box: Box;
  kind: "track" | "via";
  x: number;
  y: number;
  layer: CopperLayer;
  /** For a via: how many of its layers have other copper touching it. */
  connectedLayers?: number;
  net?: string;
}

export interface IsolatedIsland {
  net: string;
  box: Box;
  objects: string[];
  x: number;
  y: number;
  layer: CopperLayer;
}

export interface NetConnectivity {
  net: string;
  pads: number;
  /** Islands with a pad, track or via. */
  islands: number;
  missing: number;
}

/** How touching copper of one net joins: by track ends (as KiCad counts) or by any overlap. */
export type JoinRule = "ends" | "overlap";

export interface ConnectivityResult {
  /** The hash of the input the result was computed from (records, netlist, fills). */
  inputHash: string;
  /** The join rule used. */
  join: JoinRule;
  /** Touching same-net copper not joined under the `ends` rule (a track crossing a pad or track without ending in it). */
  touchingNotJoined: number;
  /** Copper items without a net that took the one net they join. */
  propagated: number;
  /** Object id to the net it carries by contact (objects without a net of their own only), sorted by id. */
  carried: Record<string, string>;
  /** Whether a netlist gave the pads their nets. */
  netlist: boolean;
  /** `provided`: every zone had fill; `partial`: some had; `absent`: none had; `no-zones`: the board has none. */
  zoneFill: "provided" | "partial" | "absent" | "no-zones";
  /** Zones without fill, treated as connecting nothing. */
  zonesWithoutFill: string[];
  /** The status line's number: missing links over all nets. */
  unconnected: number;
  links: MissingLink[];
  /** Ratsnest islands of every net that has missing links (links point into this list). */
  islands: Island[];
  nets: NetConnectivity[];
  shorts: Short[];
  unassigned: Unassigned[];
  dangling: Dangling[];
  isolated: IsolatedIsland[];
  /** Netlist pins with no pad on the board. */
  missingPins: string[];
  /** Track ends and vias not judged because they sit in a zone of their net that has no fill. */
  undecided: number;
}

/** Union-find over item indexes. */
class UF {
  private readonly p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
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

/** A pair of copper items on one layer closer than the search radius. */
export interface NearPair {
  a: number;
  b: number;
  gap: number;
  x: number;
  y: number;
}

export interface PairScan {
  /** Pairs touching (gap at most CONTACT_EPS). */
  contacts: NearPair[];
  /** Pairs of different nets (or without a net) closer than `radius` but not touching. */
  near: NearPair[];
  radius: number;
}

/**
 * One pass over every layer: for each pair of copper items whose boxes come within `radius`, the exact gap. Pairs
 * on the same net are measured only for contact. Pairs of the same object (a zone's fill parts) are measured for
 * contact only.
 */
export function scanPairs(m: CheckModel, radius: number): PairScan {
  const contacts: NearPair[] = [];
  const near: NearPair[] = [];
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const cand: number[] = [];
  for (const layer of m.layers) {
    const grid = m.grids.get(layer)!;
    for (const a of m.copper) {
      if (a.layer !== layer) continue;
      const r = Math.max(radius, CONTACT_EPS);
      cand.length = 0;
      grid.query({ minX: a.shape.box.minX - r, minY: a.shape.box.minY - r, maxX: a.shape.box.maxX + r, maxY: a.shape.box.maxY + r }, (j) => {
        if (j > a.i) cand.push(j);
      });
      cand.sort((x, y) => x - y);
      for (const j of cand) {
        const b = m.copper[j];
        const same = a.id === b.id || (a.net !== undefined && a.net === b.net);
        const limit = same ? CONTACT_EPS : r;
        const d = shapeGap(a.shape, b.shape, limit, g);
        if (d <= CONTACT_EPS) contacts.push({ a: a.i, b: j, gap: d, x: g.x, y: g.y });
        else if (!same && d < radius) near.push({ a: a.i, b: j, gap: d, x: g.x, y: g.y });
      }
    }
  }
  return { contacts, near, radius };
}

const boxJoin = (...bs: Box[]): Box => ({ minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) });

const center = (it: CopperItem): [number, number] => {
  const c = it.shape.core;
  if (c.t === "pt") return [c.x, c.y];
  const b = it.shape.box;
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};

/** Whether a track's end cap (the half-width disc at an end) touches a copper item. */
function capTouches(t: CopperItem, x: number, y: number, it: CopperItem): boolean {
  return shapeGap(pointShape(x, y, t.shape.r), it.shape, CONTACT_EPS) <= CONTACT_EPS;
}

/** Whether two touching items of one net join under the `ends` rule. */
export function joinsByEnds(a: CopperItem, b: CopperItem): boolean {
  if (a.kind === "track" || b.kind === "track") {
    const [t, o] = a.kind === "track" ? [a, b] : [b, a];
    const e = t.ends!;
    if (capTouches(t, e[0], e[1], o) || capTouches(t, e[2], e[3], o)) return true;
    if (o.kind === "track") {
      const f = o.ends!;
      return capTouches(o, f[0], f[1], t) || capTouches(o, f[2], f[3], t);
    }
    // a pad's or via's center lying in the track's copper (a track routed through the middle of a pad)
    if (o.kind === "pad" || o.kind === "via") {
      const c = o.shape.core;
      const [x, y] = c.t === "pt" ? [c.x, c.y] : [(o.shape.box.minX + o.shape.box.maxX) / 2, (o.shape.box.minY + o.shape.box.maxY) / 2];
      return shapeGap(pointShape(x, y, 0), t.shape, CONTACT_EPS) <= CONTACT_EPS;
    }
    return false;
  }
  return true;
}

/** Compute connectivity from the model and the pair scan. */
export function computeConnectivity(m: CheckModel, scan: PairScan, inputHash: string, join: JoinRule = "ends"): ConnectivityResult {
  const n = m.copper.length;
  const phys = new UF(n);
  const byNet = new UF(n);
  const touches = new Int32Array(n);
  // the same object on several layers (vias, plated pads) is one piece of copper
  const firstOf = new Map<string, number>();
  const none = new UF(n);
  for (const it of m.copper) {
    if (it.kind === "zone") continue;
    const f = firstOf.get(it.id);
    if (f === undefined) firstOf.set(it.id, it.i);
    else {
      phys.union(f, it.i);
      byNet.union(f, it.i);
      none.union(f, it.i);
    }
  }
  const joined: [number, number][] = [];
  const shorts: Short[] = [];
  const unassignedMap = new Map<string, Unassigned>();
  const netted = (it: CopperItem) => it.net !== undefined && (it.kind !== "pad" || m.doc.netlist !== undefined);
  let touchingNotJoined = 0;
  for (const c of scan.contacts) {
    const a = m.copper[c.a];
    const b = m.copper[c.b];
    phys.union(c.a, c.b);
    const joins = a.id === b.id || join === "overlap" || joinsByEnds(a, b);
    if (a.id !== b.id && joins) {
      touches[c.a]++;
      touches[c.b]++;
      joined.push([c.a, c.b]);
    }
    if (a.net !== undefined && a.net === b.net) {
      if (joins) byNet.union(c.a, c.b);
      else touchingNotJoined++;
    }
    else if (a.net !== undefined && b.net !== undefined) {
      if (a.id === b.id) continue;
      const [x, y] = a.net < b.net ? [a, b] : [b, a];
      shorts.push({ nets: [x.net!, y.net!], objects: [x.id, y.id].sort(byCodeUnit), box: boxJoin(a.shape.box, b.shape.box), x: c.x, y: c.y, layer: a.layer });
    } else if (m.doc.netlist !== undefined || (a.kind !== "pad" && b.kind !== "pad")) {
      // one side has no net
      const [none, has] = a.net === undefined ? [a, b] : [b, a];
      if (has.net === undefined || !netted(has)) continue;
      const key = `${none.id}\u0000${has.net}`;
      if (!unassignedMap.has(key)) unassignedMap.set(key, { object: none.id, touches: has.id, net: has.net, box: boxJoin(a.shape.box, b.shape.box), x: c.x, y: c.y, layer: a.layer });
    }
  }
  // shorts through copper without a net: a physical cluster holding two nets with no direct contact between them
  const clusterNets = new Map<number, Set<string>>();
  const clusterNone = new Map<number, string[]>();
  const clusterBox = new Map<number, Box>();
  for (const it of m.copper) {
    const r = phys.find(it.i);
    if (it.net !== undefined) {
      let s = clusterNets.get(r);
      if (!s) clusterNets.set(r, (s = new Set()));
      s.add(it.net);
    } else {
      const l = clusterNone.get(r) ?? [];
      l.push(it.id);
      clusterNone.set(r, l);
      const b = clusterBox.get(r);
      clusterBox.set(r, b ? boxJoin(b, it.shape.box) : it.shape.box);
    }
  }
  const direct = new Set(shorts.map((s) => `${s.nets[0]}\u0000${s.nets[1]}`));
  for (const [root, nets] of clusterNets) {
    if (nets.size < 2) continue;
    const none = clusterNone.get(root);
    if (!none?.length) continue;
    const list = [...nets].sort(byCodeUnit);
    const first = m.copper[root];
    const [x, y] = center(first);
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}\u0000${list[j]}`;
        if (direct.has(key)) continue;
        shorts.push({ nets: [list[i], list[j]], objects: [...new Set(none)].sort(byCodeUnit).slice(0, 50), box: clusterBox.get(root)!, x, y, layer: first.layer, bridged: true });
      }
  }

  // net propagation: copper without a net (not pads) takes the one net its joined cluster meets
  const carries = (it: CopperItem) => it.net === undefined && it.kind !== "pad";
  for (const [i, j] of joined) if (carries(m.copper[i]) && carries(m.copper[j])) none.union(i, j);
  const met = new Map<number, Set<string>>();
  for (const [i, j] of joined) {
    const [x, y] = carries(m.copper[i]) ? [m.copper[i], m.copper[j]] : [m.copper[j], m.copper[i]];
    if (!carries(x) || carries(y) || !netted(y)) continue;
    const r = none.find(x.i);
    let s = met.get(r);
    if (!s) met.set(r, (s = new Set()));
    s.add(y.net!);
  }
  const eff: (string | undefined)[] = m.copper.map((it) => it.net);
  let propagated = 0;
  const carried: Record<string, string> = {};
  for (const it of m.copper) {
    if (!carries(it)) continue;
    const s = met.get(none.find(it.i));
    if (s?.size === 1) {
      eff[it.i] = [...s][0];
      carried[it.id] = eff[it.i]!;
      propagated++;
    }
  }
  if (propagated) for (const [i, j] of joined) if (eff[i] !== undefined && eff[i] === eff[j] && (m.copper[i].net === undefined || m.copper[j].net === undefined)) byNet.union(i, j);

  // per-net islands
  const islandOf = new Map<number, number>();
  interface Acc {
    net: string;
    objects: Set<string>;
    anchors: Anchor[];
    pads: Set<string>;
    hasCopperAnchor: boolean;
    first: CopperItem;
    box: Box;
  }
  const accs: Acc[] = [];
  const anchored = new Set<string>();
  for (const it of m.copper) {
    const net = eff[it.i];
    if (net === undefined) continue;
    if (it.kind === "pad" && m.doc.netlist === undefined) continue;
    const r = byNet.find(it.i);
    let k = islandOf.get(r);
    if (k === undefined) {
      k = accs.length;
      islandOf.set(r, k);
      accs.push({ net, objects: new Set(), anchors: [], pads: new Set(), hasCopperAnchor: false, first: it, box: it.shape.box });
    }
    const acc = accs[k];
    acc.box = boxJoin(acc.box, it.shape.box);
    acc.objects.add(it.id);
    const akey = `${it.id}`;
    if (it.kind === "pad") {
      acc.pads.add(it.id);
      if (!anchored.has(akey)) {
        anchored.add(akey);
        const p = m.pads.get(it.id)!;
        acc.anchors.push({ object: it.id, x: p.x, y: p.y, layer: it.layer });
      }
    } else if (it.kind === "track") {
      acc.hasCopperAnchor = true;
      if (!anchored.has(akey)) {
        anchored.add(akey);
        const e = it.ends!;
        acc.anchors.push({ object: it.id, x: e[0], y: e[1], layer: it.layer }, { object: it.id, x: e[2], y: e[3], layer: it.layer });
      }
    } else if (it.kind === "via") {
      acc.hasCopperAnchor = true;
      if (!anchored.has(akey)) {
        anchored.add(akey);
        const c = it.shape.core as { x: number; y: number };
        acc.anchors.push({ object: it.id, x: c.x, y: c.y, layer: it.layer });
      }
    }
  }
  const isolated: IsolatedIsland[] = [];
  const nodesByNet = new Map<string, Acc[]>();
  for (const a of accs) {
    if (!a.pads.size && !a.hasCopperAnchor) {
      const [x, y] = center(a.first);
      isolated.push({ net: a.net, objects: [...a.objects].sort(byCodeUnit), box: a.box, x, y, layer: a.first.layer });
      continue;
    }
    const l = nodesByNet.get(a.net) ?? [];
    l.push(a);
    nodesByNet.set(a.net, l);
  }
  // nets the netlist names whose pads have no copper on any layer still count their pads (np pads have none)
  const links: MissingLink[] = [];
  const islands: Island[] = [];
  const nets: NetConnectivity[] = [];
  const netNames = new Set<string>([...nodesByNet.keys(), ...(m.doc.netlist ? m.doc.nets.keys() : [])]);
  for (const net of [...netNames].sort(byCodeUnit)) {
    const nodes = (nodesByNet.get(net) ?? []).map((a) => ({ ...a, anchors: [...a.anchors].sort((p, q) => byCodeUnit(p.object, q.object) || p.x - q.x || p.y - q.y), objects: [...a.objects].sort(byCodeUnit) }));
    nodes.sort((p, q) => byCodeUnit(p.objects[0], q.objects[0]));
    const padCount = m.doc.netlist ? (m.doc.nets.get(net)?.pads.length ?? 0) : 0;
    const missing = Math.max(0, nodes.length - 1);
    nets.push({ net, pads: padCount, islands: nodes.length, missing });
    if (nodes.length < 2) continue;
    const base = islands.length;
    for (const nd of nodes) islands.push({ net, objects: nd.objects, anchors: nd.anchors, pads: nd.pads.size });
    // Prim's algorithm over islands, distance = closest anchor pair
    const k = nodes.length;
    const inTree = new Uint8Array(k);
    const best = new Float64Array(k).fill(Infinity);
    const bestFrom: (Anchor | undefined)[] = new Array(k);
    const bestTo: (Anchor | undefined)[] = new Array(k);
    const bestIsland = new Int32Array(k).fill(-1);
    const relax = (i: number) => {
      for (let j = 0; j < k; j++) {
        if (inTree[j]) continue;
        for (const p of nodes[i].anchors)
          for (const q of nodes[j].anchors) {
            const d = Math.hypot(p.x - q.x, p.y - q.y);
            if (d < best[j]) {
              best[j] = d;
              bestFrom[j] = p;
              bestTo[j] = q;
              bestIsland[j] = i;
            }
          }
      }
    };
    inTree[0] = 1;
    relax(0);
    for (let step = 1; step < k; step++) {
      let pick = -1;
      for (let j = 0; j < k; j++) if (!inTree[j] && (pick < 0 || best[j] < best[pick])) pick = j;
      inTree[pick] = 1;
      links.push({ net, from: bestFrom[pick]!, to: bestTo[pick]!, length: best[pick], islands: [base + bestIsland[pick], base + pick] });
      relax(pick);
    }
  }

  // dangling track ends and vias
  const dangling: Dangling[] = [];
  let undecided = 0;
  const g: Gap = { gap: 0, x: 0, y: 0 };
  const inUnfilledZone = (it: CopperItem, x: number, y: number, layers: CopperLayer[]) => {
    if (it.net === undefined) return false;
    for (const z of m.unfilledZones) {
      const zo = m.zoneOutlines.get(z)!;
      if (zo.net !== it.net || !zo.layers.some((l) => layers.includes(l))) continue;
      if (pointInPoly(zo.poly, x, y)) return true;
    }
    return false;
  };
  const cand: number[] = [];
  for (const it of m.copper) {
    if (it.kind !== "track") continue;
    const e = it.ends!;
    const r = it.shape.r;
    for (const [x, y] of [
      [e[0], e[1]],
      [e[2], e[3]],
    ]) {
      const end = pointShape(x, y, r);
      let joined = false;
      cand.length = 0;
      m.grids.get(it.layer)!.query(end.box, (j) => cand.push(j));
      for (const j of cand) {
        if (j === it.i) continue;
        const o = m.copper[j];
        if (o.id === it.id) continue;
        if (shapeGap(end, o.shape, CONTACT_EPS, g) <= CONTACT_EPS) {
          joined = true;
          break;
        }
      }
      if (joined) continue;
      if (inUnfilledZone(it, x, y, [it.layer])) {
        undecided++;
        continue;
      }
      dangling.push({ object: it.id, kind: "track", box: it.shape.box, x, y, layer: it.layer, ...(it.net ? { net: it.net } : {}) });
    }
  }
  const viaItems = new Map<string, CopperItem[]>();
  for (const it of m.copper)
    if (it.kind === "via") {
      const l = viaItems.get(it.id) ?? [];
      l.push(it);
      viaItems.set(it.id, l);
    }
  for (const [id, items] of [...viaItems].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    const connected = items.filter((it) => touches[it.i] > 0).length;
    if (connected >= 2) continue;
    const c = items[0].shape.core as { x: number; y: number };
    if (inUnfilledZone(items[0], c.x, c.y, items.map((i) => i.layer))) {
      undecided++;
      continue;
    }
    dangling.push({ object: id, kind: "via", box: items[0].shape.box, x: c.x, y: c.y, layer: items[0].layer, connectedLayers: connected, ...(items[0].net ? { net: items[0].net } : {}) });
  }

  const zones = m.filledZones.length + m.unfilledZones.length;
  const missingPins: string[] = [];
  if (m.doc.netlist) for (const info of m.doc.nets.values()) for (const p of info.missing) missingPins.push(p);
  return {
    inputHash,
    join,
    touchingNotJoined,
    propagated,
    carried: Object.fromEntries(Object.entries(carried).sort((p, q) => byCodeUnit(p[0], q[0]))),
    netlist: m.doc.netlist !== undefined,
    zoneFill: zones === 0 ? "no-zones" : m.unfilledZones.length === 0 ? "provided" : m.filledZones.length === 0 ? "absent" : "partial",
    zonesWithoutFill: [...m.unfilledZones],
    unconnected: links.length,
    links,
    islands,
    nets,
    shorts: shorts.sort((a, b) => byCodeUnit(a.nets.join("|"), b.nets.join("|")) || byCodeUnit(a.objects.join("|"), b.objects.join("|"))),
    unassigned: [...unassignedMap.values()].sort((a, b) => byCodeUnit(a.object, b.object) || byCodeUnit(a.net, b.net)),
    dangling,
    isolated,
    missingPins: missingPins.sort(byCodeUnit),
    undecided,
  };
}
