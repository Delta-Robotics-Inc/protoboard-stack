/**
 * Connectivity for the incremental checks: the same computation as `computeConnectivity` (connectivity.ts), step
 * for step, over the kept pair scan, with two results kept between edits because they cannot change unless their
 * inputs do: whether a contact joins (a property of its two items, which never change), and each track's dangling
 * ends (kept until copper is added or removed near one of its ends). The union-finds, nets, islands and ratsnest
 * are recomputed every time; they are linear in the board and cheap next to the geometry.
 *
 * Any change to `computeConnectivity` must be made here too; the incremental property test compares the two.
 */
import { byCodeUnit, type Box, type CopperLayer } from "@protoboardai/board";
import { CONTACT_EPS, joinsByEnds, type Anchor, type ConnectivityResult, type Dangling, type Island, type IsolatedIsland, type JoinRule, type MissingLink, type NetConnectivity, type Short, type Unassigned } from "./connectivity.js";
import { pointInPoly, pointShape, shapeGap, type Gap } from "./geom/shape.js";
import type { PairRec } from "./incremental-model.js";
import type { CheckModel, CopperItem } from "./model.js";

/** Union-find over item indexes (as connectivity.ts). */
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

const boxJoin = (...bs: Box[]): Box => ({ minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) });

const center = (it: CopperItem): [number, number] => {
  const c = it.shape.core;
  if (c.t === "pt") return [c.x, c.y];
  const b = it.shape.box;
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};

/** A track's dangling ends, kept per track item. */
export interface TrackEnds {
  dangling: Dangling[];
  undecided: number;
  /** The end caps' boxes (what the dangling test queries). */
  boxes: Box[];
}

/** A short with its sort keys (nets joined, objects joined). */
/** A cluster's shorts through copper without a net, for its nets (joined): every pair, with its key. */
export interface ClusterShorts {
  nets: string;
  keys: string[];
  shorts: SortedShort[];
}

export interface SortedShort {
  s: Short;
  n: string;
  o: string;
  /** Direct shorts: the net pair's key. */
  k?: string;
}

export interface ConnectivityCaches {
  /** Per track item: its dangling ends. */
  ends: WeakMap<CopperItem, TrackEnds>;
  /** Whether copper was added or removed near a box on a layer (invalidates kept track ends). */
  dirty: (layer: CopperLayer, box: Box) => boolean;
  /** Shorts through copper without a net, by cluster (what the cluster is built from) and pair of nets. */
  bridged: Map<string, ClusterShorts>;
  /** The last sort of the shorts: its input, in order, and its output. */
  sorted?: { input: SortedShort[]; output: Short[] };
  /** Each net's ratsnest tree, with the anchors it was made from. */
  trees: Map<string, { sig: Anchor[][]; steps: TreeStep[] }>;
}

/** One link of a ratsnest tree: from anchor `p` of island `i` to anchor `q` of island `j`. */
interface TreeStep {
  i: number;
  p: number;
  j: number;
  q: number;
  length: number;
}

/** The end-cap boxes of a track, as the dangling test queries them. */
export function endBoxes(it: CopperItem): Box[] {
  const e = it.ends!;
  return [pointShape(e[0], e[1], it.shape.r).box, pointShape(e[2], e[3], it.shape.r).box];
}

/**
 * The shorts sorted as connectivity.ts sorts them (by nets, then objects, joined; stable). When the shorts come in
 * exactly as last time (the same objects in the same order), the sort gives what it gave then.
 */
function sortShorts(shorts: SortedShort[], caches: ConnectivityCaches): Short[] {
  const last = caches.sorted;
  if (last && last.input.length === shorts.length && last.input.every((x, i) => x === shorts[i])) return last.output.slice();
  const input = shorts.slice();
  const output = shorts.sort((a, b) => byCodeUnit(a.n, b.n) || byCodeUnit(a.o, b.o)).map((x) => x.s);
  caches.sorted = { input, output };
  return output.slice();
}

/** Compute connectivity from the model and the kept pair scan (contacts in scan order). */
export function connectivityFrom(m: CheckModel, contacts: readonly PairRec[], inputHash: string, join: JoinRule, caches: ConnectivityCaches): ConnectivityResult {
  const n = m.copper.length;
  const phys = new UF(n);
  const byNet = new UF(n);
  const touches = new Int32Array(n);
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
  // shorts with their sort keys (nets and objects joined), as connectivity.ts sorts them
  const shorts: SortedShort[] = [];
  const unassignedMap = new Map<string, Unassigned>();
  const netted = (it: CopperItem) => it.net !== undefined && (it.kind !== "pad" || m.doc.netlist !== undefined);
  let touchingNotJoined = 0;
  for (const c of contacts) {
    const a = c.A;
    const b = c.B;
    phys.union(c.a, c.b);
    let joins: boolean;
    if (a.id === b.id || join === "overlap") joins = true;
    else {
      if (c.joins === undefined) c.joins = joinsByEnds(a, b);
      joins = c.joins;
    }
    if (a.id !== b.id && joins) {
      touches[c.a]++;
      touches[c.b]++;
      joined.push([c.a, c.b]);
    }
    if (a.net !== undefined && a.net === b.net) {
      if (joins) byNet.union(c.a, c.b);
      else touchingNotJoined++;
    } else if (a.net !== undefined && b.net !== undefined) {
      if (a.id === b.id) continue;
      // a direct short is a function of the pair alone: kept on it, frozen (results share it)
      if (!c.short) {
        const [x, y] = a.net < b.net ? [a, b] : [b, a];
        const s: Short = { nets: [x.net!, y.net!], objects: [x.id, y.id].sort(byCodeUnit), box: boxJoin(a.shape.box, b.shape.box), x: c.x, y: c.y, layer: a.layer };
        Object.freeze(s.nets);
        Object.freeze(s.objects);
        Object.freeze(s.box);
        c.short = { s: Object.freeze(s), n: s.nets.join("|"), o: s.objects.join("|"), k: `${s.nets[0]}\u0000${s.nets[1]}` };
      }
      shorts.push(c.short);
    } else if (m.doc.netlist !== undefined || (a.kind !== "pad" && b.kind !== "pad")) {
      const [no, has] = a.net === undefined ? [a, b] : [b, a];
      if (has.net === undefined || !netted(has)) continue;
      const key = `${no.id}\u0000${has.net}`;
      if (!unassignedMap.has(key)) unassignedMap.set(key, { object: no.id, touches: has.id, net: has.net, box: boxJoin(a.shape.box, b.shape.box), x: c.x, y: c.y, layer: a.layer });
    }
  }
  // shorts through copper without a net: only physical clusters holding such copper can have one, so only those
  // are gathered (in the order connectivity.ts visits clusters: by their first item with a net)
  const clusterNone = new Map<number, { ids: string[]; box: Box }>();
  for (const it of m.copper) {
    if (it.net !== undefined) continue;
    const r = phys.find(it.i);
    const c = clusterNone.get(r);
    const b = it.shape.box;
    if (!c) clusterNone.set(r, { ids: [it.id], box: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } });
    else {
      c.ids.push(it.id);
      if (b.minX < c.box.minX) c.box.minX = b.minX;
      if (b.minY < c.box.minY) c.box.minY = b.minY;
      if (b.maxX > c.box.maxX) c.box.maxX = b.maxX;
      if (b.maxY > c.box.maxY) c.box.maxY = b.maxY;
    }
  }
  if (clusterNone.size) {
    const clusterNets = new Map<number, Set<string>>();
    for (const it of m.copper) {
      if (it.net === undefined) continue;
      const r = phys.find(it.i);
      if (!clusterNone.has(r)) continue;
      let s = clusterNets.get(r);
      if (!s) clusterNets.set(r, (s = new Set()));
      s.add(it.net);
    }
    const direct = new Set(shorts.map((s) => s.k ?? `${s.s.nets[0]}\u0000${s.s.nets[1]}`));
    // a cluster's shorts are a function of what it is built from (its copper without a net, box, first item and
    // nets): kept by that, frozen, with their net-pair keys, so a cluster that did not change gives the same
    // objects (and findings) again at the cost of one lookup per pair
    const keptClusters = new Map<string, ClusterShorts>();
    for (const [root, nets] of clusterNets) {
      if (nets.size < 2) continue;
      const no = clusterNone.get(root)!;
      const list = [...nets].sort(byCodeUnit);
      const first = m.copper[root];
      const [x, y] = center(first);
      const objects = [...new Set(no.ids)].sort(byCodeUnit).slice(0, 50);
      const sig = `${first.layer}\u0000${x}\u0000${y}\u0000${no.box.minX}\u0000${no.box.minY}\u0000${no.box.maxX}\u0000${no.box.maxY}\u0000${objects.join("\u0000")}`;
      const netsKey = list.join("\u0001");
      let cl = keptClusters.get(sig) ?? caches.bridged.get(sig);
      if (!cl || cl.nets !== netsKey) {
        const frozenObjects = Object.freeze([...objects]) as string[];
        const frozenBox = Object.freeze({ ...no.box });
        const keys: string[] = [];
        const made: SortedShort[] = [];
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const s: Short = { nets: Object.freeze([list[i], list[j]]) as [string, string], objects: frozenObjects, box: frozenBox, x, y, layer: first.layer, bridged: true };
            keys.push(`${list[i]}\u0000${list[j]}`);
            made.push({ s: Object.freeze(s), n: s.nets.join("|"), o: s.objects.join("|") });
          }
        cl = { nets: netsKey, keys, shorts: made };
      }
      keptClusters.set(sig, cl);
      for (let k = 0; k < cl.keys.length; k++) if (!direct.has(cl.keys[k])) shorts.push(cl.shorts[k]);
    }
    caches.bridged = keptClusters;
  } else caches.bridged = new Map();

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
    const b = it.shape.box;
    if (k === undefined) {
      k = accs.length;
      islandOf.set(r, k);
      accs.push({ net, objects: new Set(), anchors: [], pads: new Set(), hasCopperAnchor: false, first: it, box: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } });
    }
    const acc = accs[k];
    // the island's box grows in place (connectivity.ts joins a new box each time: the same numbers)
    if (b.minX < acc.box.minX) acc.box.minX = b.minX;
    if (b.minY < acc.box.minY) acc.box.minY = b.minY;
    if (b.maxX > acc.box.maxX) acc.box.maxX = b.maxX;
    if (b.maxY > acc.box.maxY) acc.box.maxY = b.maxY;
    acc.objects.add(it.id);
    const akey = it.id;
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
  const links: MissingLink[] = [];
  const trees = new Map<string, { sig: Anchor[][]; steps: TreeStep[] }>();
  const islands: Island[] = [];
  const nets: NetConnectivity[] = [];
  const netNames = new Set<string>([...nodesByNet.keys(), ...(m.doc.netlist ? m.doc.nets.keys() : [])]);
  for (const net of [...netNames].sort(byCodeUnit)) {
    const accsOf = nodesByNet.get(net) ?? [];
    const padCount = m.doc.netlist ? (m.doc.nets.get(net)?.pads.length ?? 0) : 0;
    const missing = Math.max(0, accsOf.length - 1);
    nets.push({ net, pads: padCount, islands: accsOf.length, missing });
    // a net of one island has no links: its sorted nodes are never read
    if (accsOf.length < 2) continue;
    const nodes = accsOf.map((a) => ({ ...a, anchors: [...a.anchors].sort((p, q) => byCodeUnit(p.object, q.object) || p.x - q.x || p.y - q.y), objects: [...a.objects].sort(byCodeUnit) }));
    nodes.sort((p, q) => byCodeUnit(p.objects[0], q.objects[0]));
    const base = islands.length;
    for (const nd of nodes) islands.push({ net, objects: nd.objects, anchors: nd.anchors, pads: nd.pads.size });
    // the tree is a function of the islands' anchors, in order: kept per net, as node and anchor indexes
    const sig = nodes.map((nd) => nd.anchors);
    let tree = caches.trees.get(net);
    const same = (a: Anchor, b: Anchor) => a.object === b.object && a.x === b.x && a.y === b.y && a.layer === b.layer;
    if (!tree || tree.sig.length !== sig.length || tree.sig.some((was, k) => was.length !== sig[k].length || was.some((x, i) => !same(x, sig[k][i])))) {
      const k = nodes.length;
      const inTree = new Uint8Array(k);
      const best = new Float64Array(k).fill(Infinity);
      const bestFrom = new Int32Array(k).fill(-1);
      const bestTo = new Int32Array(k).fill(-1);
      const bestIsland = new Int32Array(k).fill(-1);
      const relax = (i: number) => {
        const pa = nodes[i].anchors;
        for (let j = 0; j < k; j++) {
          if (inTree[j]) continue;
          const qa = nodes[j].anchors;
          for (let pi = 0; pi < pa.length; pi++)
            for (let qi = 0; qi < qa.length; qi++) {
              const d = Math.hypot(pa[pi].x - qa[qi].x, pa[pi].y - qa[qi].y);
              if (d < best[j]) {
                best[j] = d;
                bestFrom[j] = pi;
                bestTo[j] = qi;
                bestIsland[j] = i;
              }
            }
        }
      };
      const steps: TreeStep[] = [];
      inTree[0] = 1;
      relax(0);
      for (let step = 1; step < k; step++) {
        let pick = -1;
        for (let j = 0; j < k; j++) if (!inTree[j] && (pick < 0 || best[j] < best[pick])) pick = j;
        inTree[pick] = 1;
        steps.push({ i: bestIsland[pick], p: bestFrom[pick], j: pick, q: bestTo[pick], length: best[pick] });
        relax(pick);
      }
      tree = { sig, steps };
    }
    trees.set(net, tree);
    for (const st of tree.steps) links.push({ net, from: nodes[st.i].anchors[st.p], to: nodes[st.j].anchors[st.q], length: st.length, islands: [base + st.i, base + st.j] });
  }
  caches.trees = trees;

  // dangling track ends (kept per track) and vias
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
    let kept = caches.ends.get(it);
    if (kept && kept.boxes.some((b) => caches.dirty(it.layer, b))) kept = undefined;
    if (!kept) {
      kept = { dangling: [], undecided: 0, boxes: endBoxes(it) };
      const e = it.ends!;
      const r = it.shape.r;
      for (const [x, y] of [
        [e[0], e[1]],
        [e[2], e[3]],
      ]) {
        const end = pointShape(x, y, r);
        let hit = false;
        cand.length = 0;
        m.grids.get(it.layer)!.query(end.box, (j) => cand.push(j));
        for (const j of cand) {
          if (j === it.i) continue;
          const o = m.copper[j];
          if (o.id === it.id) continue;
          if (shapeGap(end, o.shape, CONTACT_EPS, g) <= CONTACT_EPS) {
            hit = true;
            break;
          }
        }
        if (hit) continue;
        if (inUnfilledZone(it, x, y, [it.layer])) {
          kept.undecided++;
          continue;
        }
        kept.dangling.push({ object: it.id, kind: "track", box: it.shape.box, x, y, layer: it.layer, ...(it.net ? { net: it.net } : {}) });
      }
      caches.ends.set(it, kept);
    }
    for (const d of kept.dangling) dangling.push({ ...d });
    undecided += kept.undecided;
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
    shorts: sortShorts(shorts, caches),
    unassigned: [...unassignedMap.values()].sort((a, b) => byCodeUnit(a.object, b.object) || byCodeUnit(a.net, b.net)),
    dangling,
    isolated,
    missingPins: missingPins.sort(byCodeUnit),
    undecided,
  };
}
