/**
 * Text placement as a search (layout stage 7, the tidy pass; contract section 7). Every label, power symbol and
 * symbol field that overlaps something (a body, other text, a wire through it, a foreign pin under it) gets
 * candidate places scored against everything already placed, and a few min-conflicts passes keep the best:
 *
 *   labels and power symbols  move off their anchor (a pin or a wire end) on a stub of their own net: straight
 *                             out along any free direction, or with one bend, up to `maxStub` units. A stub never
 *                             runs through a body or text, never touches another net's pin, wire end, vertex or
 *                             anchor (no accidental merge) and never runs along another wire; it may cross one at a
 *                             right angle (counted). A label reads outward along the stub's last leg. Staggering on
 *                             fine pin pitch falls out of this: the next power symbol goes past its neighbor's.
 *   fields                    a symbol's reference and value move to the clear side of its body nearest to it.
 *
 * The cost of a candidate: 1000 per conflict (the readability gates C02, C03, C04), then stub length, bends,
 * crossings, vertical text and distance. Deterministic: candidates in a fixed order, ties kept by the first.
 * Used by the layout (card-local) and by the agent's cleanup proposals (sheet coordinates).
 */
import { boxesOverlap, boxGap, labelBox, placeSymbol, powerBoxes, segmentThroughBox, type PlacedSymbol } from "../geometry.ts";
import type { SchematicDocument } from "../document.ts";
import type { SymbolRecT } from "../schema.ts";
import type { LBox } from "../symbols.ts";
import { dirVec, opposite, type Dir, type XY } from "../units.ts";

export interface TLabel {
  kind: "label";
  net: string;
  at: XY;
  side: Dir;
  scope: "local" | "port";
  movable: boolean;
}
export interface TPower {
  kind: "power";
  net: string;
  at: XY;
  dir: "up" | "down";
  style: "rail" | "ground";
  movable: boolean;
}
export interface TSym {
  rec: SymbolRecT;
  g: PlacedSymbol;
  /** whether the layout may move its fields (not pinned) */
  movableFields: boolean;
}
export interface TWire {
  net: string;
  points: XY[];
}
export interface TextState {
  symbols: TSym[];
  labels: TLabel[];
  powers: TPower[];
  wires: TWire[];
}
export interface TextOptions {
  passes?: number;
  maxStub?: number;
  /** only these items may move (default: every movable item with a conflict) */
  only?: Set<TLabel | TPower | TSym>;
}
export interface TextResult {
  moved: number;
  /** items still in conflict after the search */
  remaining: number;
}

type Item = TLabel | TPower;
interface BoxE {
  owner: object;
  box: LBox;
  kind: "body" | "field" | "label" | "power";
}
interface SegE {
  owner: object;
  net: string;
  a: XY;
  b: XY;
}

const C = 4;
const cellKeys = (b: LBox): string[] => {
  const out: string[] = [];
  for (let x = Math.floor(b.x0 / C); x <= Math.floor(b.x1 / C); x++) for (let y = Math.floor(b.y0 / C); y <= Math.floor(b.y1 / C); y++) out.push(`${x},${y}`);
  return out;
};
class Index<T extends { box?: LBox; a?: XY; b?: XY }> {
  private cells = new Map<string, Set<T>>();
  private keysOf = new Map<T, string[]>();
  constructor(private boxOf: (t: T) => LBox) {}
  add(t: T): void {
    const ks = cellKeys(this.boxOf(t));
    this.keysOf.set(t, ks);
    for (const k of ks) {
      let s = this.cells.get(k);
      if (!s) this.cells.set(k, (s = new Set()));
      s.add(t);
    }
  }
  remove(t: T): void {
    for (const k of this.keysOf.get(t) ?? []) this.cells.get(k)?.delete(t);
    this.keysOf.delete(t);
  }
  query(b: LBox): Set<T> {
    const out = new Set<T>();
    for (const k of cellKeys(b)) for (const t of this.cells.get(k) ?? []) out.add(t);
    return out;
  }
}
const segBox = (s: { a: XY; b: XY }): LBox => ({ x0: Math.min(s.a[0], s.b[0]), y0: Math.min(s.a[1], s.b[1]), x1: Math.max(s.a[0], s.b[0]), y1: Math.max(s.a[1], s.b[1]) });
const pk = (p: XY) => `${p[0]},${p[1]}`;
const onSeg = (p: XY, s: { a: XY; b: XY }) => (s.a[0] === s.b[0] ? p[0] === s.a[0] && p[1] >= Math.min(s.a[1], s.b[1]) && p[1] <= Math.max(s.a[1], s.b[1]) : p[1] === s.a[1] && p[0] >= Math.min(s.a[0], s.b[0]) && p[0] <= Math.max(s.a[0], s.b[0]));
const horiz = (s: { a: XY; b: XY }) => s.a[1] === s.b[1];

/** The boxes a label or power symbol draws. */
export function itemBoxes(doc: SchematicDocument, it: Item): LBox[] {
  if (it.kind === "label") return [labelBox({ net: it.net, x: it.at[0], y: it.at[1], side: it.side, scope: it.scope }, doc)];
  const b = powerBoxes({ net: it.net, x: it.at[0], y: it.at[1], dir: it.dir, style: it.style }, doc);
  return [b.glyph, ...(b.text ? [b.text] : [])];
}

/** The live scene of one search: boxes, segments and points, indexed. */
class Scene {
  boxes = new Index<BoxE>((e) => e.box);
  segs = new Index<SegE>((s) => segBox(s));
  /** pins by point */
  pins = new Map<string, { net?: string; dir: Dir }[]>();
  /** label and power anchors by point */
  anchors = new Map<string, { net: string; owner: object }[]>();
  /** wire vertices and ends by point */
  verts = new Map<string, { net: string; owner: object }[]>();
  boxesOf = new Map<object, BoxE[]>();
  segsOf = new Map<object, SegE[]>();
  constructor(
    readonly doc: SchematicDocument,
    readonly st: TextState,
  ) {
    for (const s of st.symbols) {
      this.addBoxes(s, [{ owner: s, box: s.g.body, kind: "body" }]);
      this.addFields(s);
      for (const p of s.g.pins) push(this.pins, pk(p.at), { ...(p.net ? { net: p.net } : {}), dir: p.dir });
    }
    for (const it of [...st.labels, ...st.powers]) this.addItem(it);
    for (const w of st.wires) this.addWire(w, w);
  }
  private addBoxes(owner: object, es: BoxE[]) {
    for (const e of es) this.boxes.add(e);
    this.boxesOf.set(owner, [...(this.boxesOf.get(owner) ?? []), ...es]);
  }
  addFields(s: TSym) {
    const key = fieldOwner(s);
    const es: BoxE[] = [{ owner: key, box: s.g.ref, kind: "field" }, ...(s.g.value ? [{ owner: key, box: s.g.value, kind: "field" as const }] : [])];
    this.addBoxes(key, es);
  }
  removeOwnerBoxes(owner: object) {
    for (const e of this.boxesOf.get(owner) ?? []) this.boxes.remove(e);
    this.boxesOf.delete(owner);
  }
  addItem(it: Item) {
    this.addBoxes(
      it,
      itemBoxes(this.doc, it).map((box) => ({ owner: it, box, kind: it.kind })),
    );
    push(this.anchors, pk(it.at), { net: it.net, owner: it });
  }
  removeItem(it: Item) {
    this.removeOwnerBoxes(it);
    const l = this.anchors.get(pk(it.at));
    if (l) this.anchors.set(pk(it.at), l.filter((x) => x.owner !== it));
  }
  addWire(owner: object, w: TWire) {
    const es: SegE[] = [];
    for (let i = 1; i < w.points.length; i++) es.push({ owner, net: w.net, a: w.points[i - 1], b: w.points[i] });
    for (const e of es) this.segs.add(e);
    this.segsOf.set(owner, [...(this.segsOf.get(owner) ?? []), ...es]);
    for (const p of w.points) push(this.verts, pk(p), { net: w.net, owner });
  }
  removeWire(owner: object, w: TWire) {
    for (const e of this.segsOf.get(owner) ?? []) this.segs.remove(e);
    this.segsOf.delete(owner);
    for (const p of w.points) {
      const l = this.verts.get(pk(p));
      if (l) this.verts.set(pk(p), l.filter((x) => x.owner !== owner));
    }
  }

  /** Conflicts of a set of boxes owned by `owner` (gates C02, C03, C04), and a soft cost (own wire through a label). */
  conflicts(owner: object, boxes: LBox[], net: string | undefined, kind: "label" | "power" | "field"): { n: number; soft: number } {
    let n = 0;
    let soft = 0;
    for (const b of boxes) {
      for (const e of this.boxes.query(b)) if (e.owner !== owner && boxesOverlap(b, e.box, 0.1)) n++;
      for (const s of this.segs.query(b)) {
        if (!segmentThroughBox(s, b, 0.12)) continue;
        if (kind !== "field" && s.net === net) soft += kind === "label" ? 30 : 0;
        else n++;
      }
      if (kind !== "power")
        for (let x = Math.ceil(b.x0); x <= Math.floor(b.x1); x++)
          for (let y = Math.ceil(b.y0); y <= Math.floor(b.y1); y++) {
            if (x <= b.x0 + 0.05 || x >= b.x1 - 0.05 || y <= b.y0 + 0.05 || y >= b.y1 - 0.05) continue;
            for (const p of this.pins.get(`${x},${y}`) ?? []) if (kind === "field" || p.net !== net) n++;
          }
    }
    return { n, soft };
  }

  /**
   * Whether a stub of `net` along `pts` (from the anchor) is clean: through no box, on no other net's pin, anchor,
   * wire point or wire, along no wire of its own net; returns its crossings, or undefined when it is not clean.
   */
  stub(pts: XY[], net: string, self: object, ownBoxes: LBox[]): number | undefined {
    let crossings = 0;
    const a0 = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const s = { a: pts[i - 1], b: pts[i] };
      const sb = segBox(s);
      // a stub never runs through a body or text
      for (const e of this.boxes.query(sb)) if (e.owner !== self && segmentThroughBox(s, e.box, 0.05)) return undefined;
      for (const b of ownBoxes) if (segmentThroughBox(s, b, 0.05)) return undefined;
      // every grid point of the leg: no foreign pin, anchor or wire point; no pin but the anchor's own
      const [dx, dy] = [Math.sign(s.b[0] - s.a[0]), Math.sign(s.b[1] - s.a[1])];
      let p: XY = [s.a[0], s.a[1]];
      for (;;) {
        const at0 = p[0] === a0[0] && p[1] === a0[1];
        if (!at0) {
          if (this.pins.get(pk(p))?.length) return undefined;
          for (const x of this.anchors.get(pk(p)) ?? []) if (x.owner !== self) return undefined;
          for (const v of this.verts.get(pk(p)) ?? []) if (v.owner !== self) return undefined;
        }
        if (p[0] === s.b[0] && p[1] === s.b[1]) break;
        p = [p[0] + dx, p[1] + dy];
      }
      for (const o of this.segs.query(sb)) {
        if (o.owner === self) continue;
        const parallel = horiz(o) === horiz(s);
        if (parallel) {
          // along another wire (any net) beyond the anchor point
          const ov = horiz(s) ? s.a[1] === o.a[1] && Math.min(Math.max(s.a[0], s.b[0]), Math.max(o.a[0], o.b[0])) > Math.max(Math.min(s.a[0], s.b[0]), Math.min(o.a[0], o.b[0])) : s.a[0] === o.a[0] && Math.min(Math.max(s.a[1], s.b[1]), Math.max(o.a[1], o.b[1])) > Math.max(Math.min(s.a[1], s.b[1]), Math.min(o.a[1], o.b[1]));
          if (ov) return undefined;
          continue;
        }
        // our points on another wire (a merge unless it is the anchor on our own net)
        for (const q of [s.a, s.b]) if (onSeg(q, o) && !(q === a0 && o.net === net)) return undefined;
        const h = horiz(s) ? s : o;
        const v = horiz(s) ? o : s;
        const x = v.a[0];
        const y = h.a[1];
        if (x > Math.min(h.a[0], h.b[0]) && x < Math.max(h.a[0], h.b[0]) && y > Math.min(v.a[1], v.b[1]) && y < Math.max(v.a[1], v.b[1])) {
          if (o.net === net) return undefined;
          crossings++;
        }
      }
    }
    return crossings;
  }

  /** The directions a stub may leave an anchor in: along a pin's lead (or across it), never back into the body or along its own wire. */
  exits(at: XY, net: string, self: object): { d: Dir; cost: number }[] {
    const pin = (this.pins.get(pk(at)) ?? []).find((p) => p.net === net);
    const used = new Set<Dir>();
    for (const s of this.segs.query({ x0: at[0], y0: at[1], x1: at[0], y1: at[1] })) {
      if (s.owner === self || !onSeg(at, s)) continue;
      if (horiz(s)) {
        if (Math.max(s.a[0], s.b[0]) > at[0]) used.add("right");
        if (Math.min(s.a[0], s.b[0]) < at[0]) used.add("left");
      } else {
        if (Math.max(s.a[1], s.b[1]) > at[1]) used.add("down");
        if (Math.min(s.a[1], s.b[1]) < at[1]) used.add("up");
      }
    }
    const out: { d: Dir; cost: number }[] = [];
    for (const d of ["right", "left", "up", "down"] as Dir[]) {
      if (used.has(d)) continue;
      if (pin && d === opposite(pin.dir)) continue;
      out.push({ d, cost: pin && d !== pin.dir ? 3 : 0 });
    }
    return out;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

const fieldOwners = new WeakMap<TSym, object>();
const fieldOwner = (s: TSym): object => {
  let o = fieldOwners.get(s);
  if (!o) fieldOwners.set(s, (o = { fieldsOf: s.rec.id }));
  return o;
};

/** Run the search over the state (mutated in place: items move, stubs are appended to `wires`, fields change). */
export function placeText(doc: SchematicDocument, st: TextState, opts: TextOptions = {}): TextResult {
  const sc = new Scene(doc, st);
  const passes = opts.passes ?? 4;
  const maxStub = opts.maxStub ?? 12;
  /** each moved item's anchor and stub, so a later move replaces its own stub */
  const home = new Map<Item, { anchor: XY; stub?: TWire }>();
  let moved = 0;
  const itemConf = (it: Item) => sc.conflicts(it, itemBoxes(doc, it), it.net, it.kind);
  const fieldConf = (s: TSym) => sc.conflicts(fieldOwner(s), [s.g.ref, ...(s.g.value ? [s.g.value] : [])], undefined, "field");
  const allowed = (x: Item | TSym) => (!opts.only || opts.only.has(x)) && ("movable" in x ? x.movable : x.movableFields);

  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    // items in conflict, most conflicts first, then a stable order
    const todo: { x: Item | TSym; n: number; key: string }[] = [];
    for (const it of [...st.powers, ...st.labels]) {
      if (!allowed(it)) continue;
      const c = itemConf(it);
      if (c.n || c.soft) todo.push({ x: it, n: c.n + (c.soft ? 0.5 : 0), key: `${it.kind}|${it.net}|${pk(it.at)}` });
    }
    for (const s of st.symbols) {
      if (!allowed(s)) continue;
      const c = fieldConf(s);
      if (c.n) todo.push({ x: s, n: c.n, key: `field|${s.rec.id}` });
    }
    if (!todo.length) break;
    todo.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const t of todo) {
      if ("rec" in t.x) {
        if (moveFields(t.x)) changed = true;
      } else if (moveItem(t.x)) changed = true;
    }
    if (!changed) break;
  }
  let remaining = 0;
  for (const it of [...st.powers, ...st.labels]) if (itemConf(it).n) remaining++;
  for (const s of st.symbols) if (fieldConf(s).n) remaining++;
  return { moved, remaining };

  function moveItem(it: Item): boolean {
    const now = itemConf(it);
    if (!now.n && !now.soft) return false;
    const h = home.get(it) ?? { anchor: it.at };
    // take the item and its old stub out while it looks
    sc.removeItem(it);
    if (h.stub) sc.removeWire(h.stub, h.stub);
    const A = h.anchor;
    const original = { at: it.at, side: it.kind === "label" ? it.side : undefined };
    const ghost = { kind: "ghost" } as object;
    let best: { pts: XY[]; side?: Dir; cost: number } | undefined;
    const curCost = now.n * 1000 + now.soft;
    const consider = (pts: XY[], firstCost: number) => {
      const end = pts[pts.length - 1];
      const legs = pts.length - 1;
      const last: Dir | undefined = legs ? vecDirOf(pts[pts.length - 2], end) : undefined;
      const sides: Dir[] = it.kind === "label" ? (last ? [last] : sc.exits(A, it.net, ghost).map((e) => e.d)) : [it.kind === "power" ? it.dir : "up"];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
      for (const side of sides) {
        const base = firstCost + len + 3 * Math.max(0, legs - 1) + (it.kind === "label" && (side === "up" || side === "down") ? 4 : 0) + (legs ? 1 : 0);
        if (best && base >= best.cost) continue;
        const cand: Item = it.kind === "label" ? { ...it, at: end, side } : { ...it, at: end };
        const boxes = itemBoxes(doc, cand);
        let cross = 0;
        if (legs) {
          const c = sc.stub(pts, it.net, ghost, boxes);
          if (c === undefined) continue;
          cross = c;
        }
        const cf = sc.conflicts(it, boxes, it.net, it.kind);
        const cost = cf.n * 1000 + cf.soft + base + 2 * cross;
        if (!best || cost < best.cost) best = { pts, side, cost };
      }
    };
    consider([A], 0);
    for (const { d, cost: dc } of sc.exits(A, it.net, ghost)) {
      const v = dirVec(d);
      for (let k = 1; k <= maxStub; k++) {
        const p1: XY = [A[0] + k * v[0], A[1] + k * v[1]];
        consider([A, p1], dc);
        for (const d2 of perpendicular(d)) {
          const w = dirVec(d2);
          for (let k2 = 1; k2 <= Math.min(8, maxStub); k2++) consider([A, p1, [p1[0] + k2 * w[0], p1[1] + k2 * w[1]]], dc);
        }
      }
    }
    // nothing clean with one bend: two bends (out, over the neighbors, and on), shortest first
    if (!best || best.cost >= 1000)
      for (const { d, cost: dc } of sc.exits(A, it.net, ghost)) {
        const v = dirVec(d);
        for (let k = 1; k <= 6; k++) {
          const p1: XY = [A[0] + k * v[0], A[1] + k * v[1]];
          for (const d2 of perpendicular(d)) {
            const w = dirVec(d2);
            for (let k2 = 2; k2 <= 8; k2++) {
              const p2: XY = [p1[0] + k2 * w[0], p1[1] + k2 * w[1]];
              for (const d3 of perpendicular(d2)) {
                const u = dirVec(d3);
                for (let k3 = 1; k3 <= 8; k3++) consider([A, p1, p2, [p2[0] + k3 * u[0], p2[1] + k3 * u[1]]], dc);
              }
            }
          }
        }
      }
    const pick = best as { pts: XY[]; side?: Dir; cost: number } | undefined;
    if (!pick || pick.cost >= curCost - 1e-9) {
      // nothing better: put it back as it was
      if (h.stub) sc.addWire(h.stub, h.stub);
      sc.addItem(it);
      return false;
    }
    if (h.stub) st.wires.splice(st.wires.indexOf(h.stub), 1);
    it.at = pick.pts[pick.pts.length - 1];
    if (it.kind === "label" && pick.side) it.side = pick.side;
    let stub: TWire | undefined;
    if (pick.pts.length > 1) {
      stub = { net: it.net, points: pick.pts };
      st.wires.push(stub);
      sc.addWire(stub, stub);
    }
    home.set(it, { anchor: A, ...(stub ? { stub } : {}) });
    sc.addItem(it);
    void original;
    moved++;
    return true;
  }

  function moveFields(s: TSym): boolean {
    const now = fieldConf(s);
    if (!now.n) return false;
    const owner = fieldOwner(s);
    sc.removeOwnerBoxes(owner);
    const b = s.g.body;
    const hasValue = !!s.g.value;
    const lines = hasValue ? 1 : 0;
    const cands: { dx: number; dy: number; anchor: "left" | "right"; d: number }[] = [];
    const yAbove = Math.floor(b.y0 - 0.6 - lines);
    const yBelow = Math.ceil(b.y1 + 0.6);
    for (let k = 0; k < 4; k++) {
      for (const [x, anchor] of [
        [Math.floor(b.x0), "left"],
        [Math.ceil(b.x1), "right"],
        [Math.floor(b.x0) - 2, "left"],
        [Math.ceil(b.x1) + 2, "right"],
      ] as [number, "left" | "right"][]) {
        cands.push({ dx: x - s.rec.x, dy: yAbove - k - s.rec.y, anchor, d: k + 0.5 });
        cands.push({ dx: x - s.rec.x, dy: yBelow + k - s.rec.y, anchor, d: k + 0.6 });
      }
    }
    for (let k = 0; k < 4; k++)
      for (let y = Math.floor(b.y0); y <= Math.ceil(b.y1) - lines; y++) {
        cands.push({ dx: Math.ceil(b.x1) + 1 + k - s.rec.x, dy: y - s.rec.y, anchor: "left", d: k + 0.3 + Math.abs(y - (b.y0 + b.y1) / 2) * 0.05 });
        cands.push({ dx: Math.floor(b.x0) - 1 - k - s.rec.x, dy: y - s.rec.y, anchor: "right", d: k + 0.4 + Math.abs(y - (b.y0 + b.y1) / 2) * 0.05 });
      }
    let best: { rec: SymbolRecT; g: PlacedSymbol; cost: number } | undefined;
    const curCost = now.n * 1000;
    for (const c of cands) {
      if (best && c.d >= best.cost) continue;
      const rec: SymbolRecT = { ...s.rec, fields: { dx: c.dx, dy: c.dy, anchor: c.anchor } };
      const g = placeSymbol(doc, rec)!;
      const bs = [g.ref, ...(g.value ? [g.value] : [])];
      const cf = sc.conflicts(owner, bs, undefined, "field");
      // nearest its own part (rule C23)
      const own = Math.min(...bs.map((x) => boxGap(x, g.body)));
      let near = 0;
      for (const e of sc.boxes.query({ x0: g.ref.x0 - 3, y0: g.ref.y0 - 3, x1: g.ref.x1 + 3, y1: (g.value ?? g.ref).y1 + 3 })) if (e.kind === "body" && e.owner !== s && bs.some((x) => boxGap(x, e.box) < own - 0.3)) near = 20;
      const cost = cf.n * 1000 + c.d + near;
      if (!best || cost < best.cost) best = { rec, g, cost };
    }
    if (!best || best.cost >= curCost) {
      sc.addFields(s);
      return false;
    }
    s.rec = best.rec;
    s.g = best.g;
    sc.addFields(s);
    moved++;
    return true;
  }
}

const perpendicular = (d: Dir): Dir[] => (d === "left" || d === "right" ? ["up", "down"] : ["right", "left"]);
const vecDirOf = (a: XY, b: XY): Dir => (b[0] > a[0] ? "right" : b[0] < a[0] ? "left" : b[1] > a[1] ? "down" : "up");
