/**
 * World geometry of every record (grid units, +Y down): placed symbols with their pins, body and field boxes;
 * label and power symbol boxes; card title boxes; wire segments; derived junctions; and the drawn netlist
 * (contract section 4.2). Computed from the document and cached per document.
 */
import { textWidth } from "@protoboardai/board-scene";
import { byCodeUnit } from "@protoboardai/board";
import { pinKey, type CircuitPart } from "./circuit.ts";
import { isRail, recordsOfKind, type SchematicDocument } from "./document.ts";
import type { CardRecT, LabelRecT, PowerRecT, SymbolRecT, WireRecT } from "./schema.ts";
import { resolveSymbol, type LBox, type ResolvedSymbol } from "./symbols.ts";
import { transformDir, transformPoint, type Dir, type Rotation, type XY } from "./units.ts";

/** Text heights in grid units, one per role (rule C22). */
export const TEXT = { ref: 0.8, value: 0.7, label: 0.65, power: 0.7, title: 1.0, subtitle: 0.7, note: 0.7, pin: 0.5 } as const;

export interface TextBox extends LBox {
  text: string;
  h: number;
  /** anchor point: the vertical middle of the capitals */
  x: number;
  y: number;
  anchor: "left" | "center" | "right";
  /** clockwise degrees (vertical text: 270 reads bottom to top) */
  angle?: number;
}

export interface PlacedPin {
  key: string;
  part: string;
  /** part pin id */
  pin: string;
  /** symbol pin id */
  spin: string;
  at: XY;
  dir: Dir;
  net?: string;
  number: string;
  name: string;
  type: string;
}

export interface PlacedSymbol {
  rec: SymbolRecT;
  part: CircuitPart;
  resolved: ResolvedSymbol;
  /** one entry per symbol pin (its first bound part pin names it); `keys` lists every part pin on it */
  pins: (PlacedPin & { keys: string[] })[];
  body: LBox;
  full: LBox;
  center: XY;
  ref: TextBox;
  value?: TextBox;
}

export const box = (x0: number, y0: number, x1: number, y1: number): LBox => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
export const boxesOverlap = (a: LBox, b: LBox, tol = 0.1): boolean => a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
export const inflateBox = (b: LBox, d: number): LBox => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
export const unionBoxes = (bs: LBox[]): LBox => (bs.length ? bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })) : { x0: 0, y0: 0, x1: 0, y1: 0 });
export const boxContainsPoint = (b: LBox, p: XY, tol = 0): boolean => p[0] >= b.x0 - tol && p[0] <= b.x1 + tol && p[1] >= b.y0 - tol && p[1] <= b.y1 + tol;
export const boxCenter = (b: LBox): XY => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
/** Gap between two boxes (0 when they touch or overlap). */
export function boxGap(a: LBox, b: LBox): number {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  return Math.hypot(dx, dy);
}

export function textBox(text: string, x: number, y: number, h: number, anchor: TextBox["anchor"], angle = 0): TextBox {
  const w = textWidth(text, h);
  if (angle === 90 || angle === 270) {
    // vertical: the text runs along y
    const ya = anchor === "left" ? (angle === 270 ? [y - w, y] : [y, y + w]) : anchor === "right" ? (angle === 270 ? [y, y + w] : [y - w, y]) : [y - w / 2, y + w / 2];
    return { text, h, x, y, anchor, angle, x0: x - h * 0.6, x1: x + h * 0.6, y0: ya[0], y1: ya[1] };
  }
  const x0 = anchor === "left" ? x : anchor === "right" ? x - w : x - w / 2;
  return { text, h, x, y, anchor, ...(angle ? { angle } : {}), x0, x1: x0 + w, y0: y - h * 0.6, y1: y + h * 0.6 };
}

function worldBox(b: LBox, rot: Rotation, mirror: boolean, at: XY): LBox {
  const a = transformPoint([b.x0, b.y0], rot, mirror, at);
  const c = transformPoint([b.x1, b.y1], rot, mirror, at);
  return box(a[0], a[1], c[0], c[1]);
}

/** Where a symbol's fields go (derived, contract 4.1): two-terminal parts above and below, or beside when vertical, unless `fields` places them; boxes at a free corner. */
function fields(rec: SymbolRecT, part: CircuitPart, r: ResolvedSymbol, bodyW: LBox, pins: { at: XY; dir: Dir }[]): { ref: TextBox; value?: TextBox } {
  const value = part.value ?? (part.class === "ic" || part.class === "mcu" || part.class === "module" || part.class === "regulator" || part.class === "connector" ? (part.mpn ?? part.name) : undefined);
  const two = r.pins.length <= 2 && r.family.startsWith("pack:");
  const [cx, cy] = boxCenter(bodyW);
  // a two-terminal part's fields are derived unless the layout or a person placed them (`fields`, as for a box)
  if (two && rec.fields) return boxFields(rec.ref, value, [rec.x + rec.fields.dx, rec.y + rec.fields.dy], rec.fields.anchor);
  if (two) {
    const vertical = rec.rotation === 90 || rec.rotation === 270;
    if (!vertical) {
      const ref = textBox(rec.ref, cx, bodyW.y0 - 0.3 - TEXT.ref / 2, TEXT.ref, "center");
      const val = value ? textBox(value, cx, bodyW.y1 + 0.3 + TEXT.value / 2, TEXT.value, "center") : undefined;
      return { ref, ...(val ? { value: val } : {}) };
    }
    const x = bodyW.x1 + 0.4;
    const ref = textBox(rec.ref, x, cy - (value ? 0.55 : 0), TEXT.ref, "left");
    const val = value ? textBox(value, x, cy + 0.55, TEXT.value, "left") : undefined;
    return { ref, ...(val ? { value: val } : {}) };
  }
  // a box: reference and value on two lines, at the stored offset or above the body's left edge
  const f = rec.fields ?? { dx: Math.floor(bodyW.x0) - rec.x, dy: Math.floor(bodyW.y0) - 2 - rec.y, anchor: "left" as const };
  return boxFields(rec.ref, value, [rec.x + f.dx, rec.y + f.dy], f.anchor);
}

/** A box symbol's fields: the reference at `at`, the value on the line below. */
export function boxFields(ref: string, value: string | undefined, at: XY, anchor: "left" | "right"): { ref: TextBox; value?: TextBox } {
  return { ref: textBox(ref, at[0], at[1], TEXT.ref, anchor), ...(value ? { value: textBox(value, at[0], at[1] + 1, TEXT.value, anchor) } : {}) };
}

const symCache = new WeakMap<object, WeakMap<SymbolRecT, PlacedSymbol>>();

/** A symbol record placed on the sheet. */
export function placeSymbol(doc: SchematicDocument, rec: SymbolRecT): PlacedSymbol | undefined {
  let m = symCache.get(doc.circuit);
  if (!m) symCache.set(doc.circuit, (m = new WeakMap()));
  const hit = m.get(rec);
  if (hit) return hit;
  const part = doc.parts.get(rec.part);
  if (!part) return undefined;
  const hide = rec.hide_unused ? part.pins.filter((p) => p.type !== "nc" && !part.unconnected?.[p.id] && !doc.pinNets.has(pinKey(part.path, p.id))).map((p) => p.id) : [];
  const r = resolveSymbol(part, { ...(rec.variant ? { variant: rec.variant } : {}), ...(rec.symbol ? { symbol: rec.symbol } : {}), ...(hide.length ? { hide } : {}) });
  const at: XY = [rec.x, rec.y];
  const mirror = !!rec.mirror;
  const pins = r.pins.map((sp) => {
    const keys = (r.members.get(sp.id) ?? []).map((pp) => pinKey(part.path, pp));
    const first = keys[0] ? part.pins.find((p) => pinKey(part.path, p.id) === keys[0]) : undefined;
    const p = transformPoint([sp.at[0], sp.at[1]], rec.rotation, mirror, at);
    const dir = transformDir(sp.dir === "none" ? "left" : sp.dir, rec.rotation, mirror);
    const net = keys.map((k) => doc.pinNets.get(k)).find(Boolean);
    return { key: keys[0] ?? pinKey(part.path, `~${sp.id}`), keys, part: part.path, pin: first?.id ?? sp.id, spin: sp.id, at: p, dir, ...(net ? { net } : {}), number: first?.number ?? sp.number ?? sp.id, name: first?.name ?? sp.name, type: first?.type ?? sp.type };
  });
  const body = worldBox(r.body_box, rec.rotation, mirror, at);
  const full = worldBox(r.full_box, rec.rotation, mirror, at);
  const f = fields(rec, part, r, body, pins);
  const placed: PlacedSymbol = { rec, part, resolved: r, pins, body, full, center: boxCenter(body), ...f };
  m.set(rec, placed);
  return placed;
}

const shortCache = new WeakMap<object, Map<string, string>>();

/**
 * The name a label or power symbol shows for a net: the net's name without a trailing note in brackets and without
 * the sub-module path in front ("power/VBAT_SW" shows "VBAT_SW", "2V8 (camera AVDD)" shows "2V8"), when no other
 * net of the circuit would show the same; else the shorter of the two that is unique; else the full name. The
 * record, the netlist and the export keep the full name; only the drawn text is shorter.
 */
export function netLabel(doc: Pick<SchematicDocument, "circuit">, net: string): string {
  let m = shortCache.get(doc.circuit);
  if (!m) {
    m = new Map();
    const names = doc.circuit.nets.map((n) => n.name);
    const strip = (n: string) => n.replace(/\s*\([^()]*\)\s*$/, "").trim() || n;
    const last = (n: string) => strip(n).split("/").pop()! || strip(n);
    const count = (f: (n: string) => string) => {
      const c = new Map<string, number>();
      for (const n of names) c.set(f(n), (c.get(f(n)) ?? 0) + 1);
      return c;
    };
    const full = new Set(names);
    const cl = count(last);
    const cs = count(strip);
    for (const n of names) {
      const a = last(n);
      const b = strip(n);
      m.set(n, cl.get(a) === 1 && (a === n || !full.has(a)) ? a : cs.get(b) === 1 && (b === n || !full.has(b)) ? b : n);
    }
    shortCache.set(doc.circuit, m);
  }
  return m.get(net) ?? net;
}

/** A label's text box: `side` is the direction the text runs from its anchor; with `doc`, the text is the net's shown name. */
export function labelBox(l: Pick<LabelRecT, "net" | "x" | "y" | "side" | "scope">, doc?: Pick<SchematicDocument, "circuit">): TextBox {
  const h = TEXT.label;
  const pad = l.scope === "port" ? 0.6 : 0.3;
  const hh = 0.44;
  const t = doc ? netLabel(doc, l.net) : l.net;
  const w = textWidth(t, h) + 2 * pad;
  switch (l.side) {
    case "right":
      return { ...textBox(t, l.x + pad, l.y, h, "left"), x0: l.x, x1: l.x + w, y0: l.y - hh, y1: l.y + hh };
    case "left":
      return { ...textBox(t, l.x - pad, l.y, h, "right"), x0: l.x - w, x1: l.x, y0: l.y - hh, y1: l.y + hh };
    case "up":
      return { ...textBox(t, l.x, l.y - pad, h, "left", 270), x0: l.x - hh, x1: l.x + hh, y0: l.y - w, y1: l.y };
    case "down":
      return { ...textBox(t, l.x, l.y + pad, h, "left", 90), x0: l.x - hh, x1: l.x + hh, y0: l.y, y1: l.y + w };
  }
}

/** Whether a ground symbol shows its name (only when it is not plain GND). */
export const showGroundName = (net: string): boolean => !/^(GND|0V|VSS)$/i.test(net);

/** A power symbol's glyph box and text box (with `doc`, the text is the net's shown name). */
export function powerBoxes(p: Pick<PowerRecT, "net" | "x" | "y" | "dir" | "style">, doc?: Pick<SchematicDocument, "circuit">): { glyph: LBox; text?: TextBox } {
  const up = p.dir === "up";
  const name = doc ? netLabel(doc, p.net) : p.net;
  if (p.style === "ground") {
    const glyph = up ? box(p.x - 1.4, p.y - 3.2, p.x + 1.4, p.y - 0.2) : box(p.x - 1.4, p.y + 0.2, p.x + 1.4, p.y + 3.2);
    if (!showGroundName(name)) return { glyph };
    const ty = up ? glyph.y0 - 0.3 - TEXT.power / 2 : glyph.y1 + 0.3 + TEXT.power / 2;
    return { glyph, text: textBox(name, p.x, ty, TEXT.power, "center") };
  }
  const glyph = up ? box(p.x - 1.2, p.y - 1.7, p.x + 1.2, p.y - 0.2) : box(p.x - 1.2, p.y + 0.2, p.x + 1.2, p.y + 1.7);
  const ty = up ? glyph.y0 - 0.35 - TEXT.power / 2 : glyph.y1 + 0.35 + TEXT.power / 2;
  return { glyph, text: textBox(name, p.x, ty, TEXT.power, "center") };
}

/** A card's title tag and subtitle boxes. */
export function cardTitleBoxes(c: CardRecT): { tag: LBox; title: TextBox; subtitle?: TextBox } {
  const h = TEXT.title;
  const title = textBox(c.title.toUpperCase(), c.x + 1.1, c.y + 1.2, h, "left");
  const tag = box(c.x + 0.5, c.y + 0.4, title.x1 + 0.6, c.y + 2.0);
  const sub = c.subtitle ? textBox(c.subtitle, tag.x1 + 0.8, c.y + 1.2, TEXT.subtitle, "left") : undefined;
  return { tag, title, ...(sub ? { subtitle: sub } : {}) };
}

export interface Segment {
  wire: string;
  net: string;
  a: XY;
  b: XY;
}

export const segmentsOf = (w: WireRecT): Segment[] => w.points.slice(1).map((p, i) => ({ wire: w.id, net: w.net, a: w.points[i] as XY, b: p as XY }));

/** Whether point p lies on segment s (orthogonal segments, integer or fractional points). */
export function onSegment(p: XY, s: { a: XY; b: XY }, tol = 1e-6): boolean {
  const [x0, x1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
  const [y0, y1] = [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
  if (s.a[0] === s.b[0]) return Math.abs(p[0] - s.a[0]) <= tol && p[1] >= y0 - tol && p[1] <= y1 + tol;
  return Math.abs(p[1] - s.a[1]) <= tol && p[0] >= x0 - tol && p[0] <= x1 + tol;
}

/**
 * Segments indexed for point and box queries: horizontal ones by their y, vertical ones by their x (exact, for
 * integer points), and every segment in buckets of 4 units for box queries.
 */
export class SegmentLookup<S extends { a: XY; b: XY }> {
  private byY = new Map<number, S[]>();
  private byX = new Map<number, S[]>();
  private cells = new Map<string, S[]>();
  constructor(readonly all: readonly S[]) {
    for (const s of all) {
      if (s.a[1] === s.b[1]) push(this.byY, s.a[1], s);
      if (s.a[0] === s.b[0]) push(this.byX, s.a[0], s);
      for (const k of cellsOf(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1]))) push(this.cells, k, s);
    }
  }
  /** Segments the point lies on (ends included). */
  at(p: XY): S[] {
    const out: S[] = [];
    for (const s of this.byY.get(p[1]) ?? []) if (onSegment(p, s)) out.push(s);
    for (const s of this.byX.get(p[0]) ?? []) if (s.a[1] !== s.b[1] && onSegment(p, s)) out.push(s);
    if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) return this.all.filter((s) => onSegment(p, s));
    return out;
  }
  /** Segments whose box meets the box (a superset of those that pass through it). */
  near(b: LBox): S[] {
    const out = new Set<S>();
    for (const k of cellsOf(b.x0, b.y0, b.x1, b.y1)) for (const s of this.cells.get(k) ?? []) out.add(s);
    return [...out];
  }
}
function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}
function cellsOf(x0: number, y0: number, x1: number, y1: number): string[] {
  const out: string[] = [];
  for (let x = Math.floor(x0 / 4); x <= Math.floor(x1 / 4); x++) for (let y = Math.floor(y0 / 4); y <= Math.floor(y1 / 4); y++) out.push(`${x},${y}`);
  return out;
}

/** Whether a segment passes through the inside of a box (touching its edge is not through). */
export function segmentThroughBox(s: { a: XY; b: XY }, b: LBox, tol = 0.05): boolean {
  const [x0, x1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
  const [y0, y1] = [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
  return x0 < b.x1 - tol && x1 > b.x0 + tol && y0 < b.y1 - tol && y1 > b.y0 + tol;
}

/** The interior crossing point of two perpendicular segments, if they cross away from both ends. */
export function crossing(s: Segment, t: Segment): XY | undefined {
  const sh = s.a[1] === s.b[1];
  const th = t.a[1] === t.b[1];
  if (sh === th) return undefined;
  const h = sh ? s : t;
  const v = sh ? t : s;
  const x = v.a[0];
  const y = h.a[1];
  const inH = x > Math.min(h.a[0], h.b[0]) && x < Math.max(h.a[0], h.b[0]);
  const inV = y > Math.min(v.a[1], v.b[1]) && y < Math.max(v.a[1], v.b[1]);
  return inH && inV ? [x, y] : undefined;
}

export interface SheetGeometry {
  /** the segments indexed */
  lookup: SegmentLookup<Segment>;
  symbols: Map<string, PlacedSymbol>;
  /** every part pin key -> its placed symbol pin */
  pins: Map<string, PlacedPin>;
  segments: Segment[];
  junctions: { at: XY; net: string; degree: number }[];
  cards: Map<string, CardRecT>;
}

const geoCache = new WeakMap<SchematicDocument, SheetGeometry>();

export function geometryOf(doc: SchematicDocument): SheetGeometry {
  const hit = geoCache.get(doc);
  if (hit) return hit;
  const symbols = new Map<string, PlacedSymbol>();
  const pins = new Map<string, PlacedPin>();
  for (const s of recordsOfKind(doc, "symbol")) {
    const p = placeSymbol(doc, s);
    if (!p) continue;
    symbols.set(s.id, p);
    for (const pin of p.pins) for (const k of pin.keys) pins.set(k, { ...pin, key: k });
  }
  const wires = recordsOfKind(doc, "wire");
  const segments = wires.flatMap(segmentsOf);
  const cards = new Map(recordsOfKind(doc, "card").map((c) => [c.id, c]));
  const g: SheetGeometry = { lookup: new SegmentLookup(segments), symbols, pins, segments, junctions: junctionsOf(segments, [...symbols.values()].flatMap((s) => s.pins)), cards };
  geoCache.set(doc, g);
  return g;
}

const ptKey = (p: XY) => `${p[0]},${p[1]}`;

/**
 * Derived junctions: a point of one net where three or more wire directions meet (a wire end on another wire's
 * interior, or three ends at a pin or point). `degree` counts the directions (4 is a four-way junction, rule C17).
 */
export function junctionsOf(segments: Segment[], pins: { at: XY; net?: string }[] = []): { at: XY; net: string; degree: number }[] {
  const dirs = new Map<string, { net: string; at: XY; d: Set<string> }>();
  const add = (p: XY, net: string, d: string) => {
    const k = `${net}|${ptKey(p)}`;
    const e = dirs.get(k) ?? { net, at: p, d: new Set<string>() };
    e.d.add(d);
    dirs.set(k, e);
  };
  const byNet = new Map<string, Segment[]>();
  for (const s of segments) {
    const l = byNet.get(s.net) ?? [];
    l.push(s);
    byNet.set(s.net, l);
  }
  for (const [net, segs] of byNet) {
    const points = new Map<string, XY>();
    for (const s of segs) {
      points.set(ptKey(s.a), s.a);
      points.set(ptKey(s.b), s.b);
    }
    for (const p of points.values()) {
      for (const s of segs) {
        if (!onSegment(p, s)) continue;
        const horiz = s.a[1] === s.b[1];
        const lo = horiz ? Math.min(s.a[0], s.b[0]) : Math.min(s.a[1], s.b[1]);
        const hi = horiz ? Math.max(s.a[0], s.b[0]) : Math.max(s.a[1], s.b[1]);
        const v = horiz ? p[0] : p[1];
        if (v > lo) add(p, net, horiz ? "W" : "N");
        if (v < hi) add(p, net, horiz ? "E" : "S");
      }
    }
  }
  // a pin counts as one direction (its lead) where wires meet it
  for (const pin of pins) {
    if (!pin.net) continue;
    const e = dirs.get(`${pin.net}|${ptKey(pin.at)}`);
    if (e) e.d.add("PIN");
  }
  return [...dirs.values()]
    .filter((e) => e.d.size >= 3)
    .map((e) => ({ at: e.at, net: e.net, degree: e.d.size }))
    .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || byCodeUnit(a.net, b.net));
}

/** Union-find over string keys. */
export class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c)!;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

export interface DrawnNetlist {
  /** drawn conductors: each a sorted list of pin keys */
  conductors: string[][];
  /** pin key -> conductor index */
  of: Map<string, number>;
  /** wire id -> conductor index (wires that touch no pin get their own) */
  wireOf: Map<string, number>;
  /** for each conductor, the net names its labels and power symbols carry */
  names: string[][];
  /** label and power symbol id -> conductor index */
  itemOf: Map<string, number>;
}

/**
 * Connectivity from geometry alone: wire segments join at ends and vertices that touch another segment; a pin
 * joins wires through its anchor; labels and power symbols join every item of their net name; a no-connect
 * mark joins nothing. Pins with nothing drawn are conductors of one.
 */
export function drawnNetlist(doc: SchematicDocument, opts: { byName?: boolean } = {}): DrawnNetlist {
  const byName = opts.byName !== false;
  const g = geometryOf(doc);
  const uf = new UnionFind();
  const segs = g.segments;
  // wires: every vertex of a wire is on it; vertices of one wire on another's segment join
  const wires = recordsOfKind(doc, "wire");
  for (const w of wires) uf.find(`w:${w.id}`);
  const vertexOwners = new Map<string, string[]>();
  for (const w of wires)
    for (const p of w.points) {
      const k = ptKey(p as XY);
      const l = vertexOwners.get(k) ?? [];
      l.push(w.id);
      vertexOwners.set(k, l);
    }
  for (const [k, owners] of vertexOwners) {
    const [x, y] = k.split(",").map(Number) as XY;
    for (const s of g.lookup.at([x, y])) for (const o of owners) uf.union(`w:${o}`, `w:${s.wire}`);
  }
  // pins on wires
  for (const [key, pin] of g.pins) {
    uf.find(`p:${key}`);
    for (const s of g.lookup.at(pin.at)) uf.union(`p:${key}`, `w:${s.wire}`);
  }
  // two pins on one anchor point
  const pinAt = new Map<string, string[]>();
  for (const [key, pin] of g.pins) {
    const l = pinAt.get(ptKey(pin.at)) ?? [];
    l.push(key);
    pinAt.set(ptKey(pin.at), l);
  }
  for (const l of pinAt.values()) for (const k of l.slice(1)) uf.union(`p:${l[0]}`, `p:${k}`);
  // labels and power symbols: by name, and to whatever is at their anchor
  const named: { id: string; net: string; at: XY }[] = [
    ...recordsOfKind(doc, "label").map((l) => ({ id: l.id, net: l.net, at: [l.x, l.y] as XY })),
    ...recordsOfKind(doc, "power").map((p) => ({ id: p.id, net: p.net, at: [p.x, p.y] as XY })),
  ];
  for (const n of named) {
    if (byName) uf.union(`n:${n.id}`, `name:${n.net}`);
    for (const s of g.lookup.at(n.at)) uf.union(`n:${n.id}`, `w:${s.wire}`);
    for (const k of pinAt.get(ptKey(n.at)) ?? []) uf.union(`n:${n.id}`, `p:${k}`);
  }
  const roots = new Map<string, number>();
  const conductors: string[][] = [];
  const names: string[][] = [];
  const of = new Map<string, number>();
  const idx = (r: string) => {
    let i = roots.get(r);
    if (i === undefined) {
      i = conductors.length;
      roots.set(r, i);
      conductors.push([]);
      names.push([]);
    }
    return i;
  };
  for (const key of [...g.pins.keys()].sort(byCodeUnit)) {
    const i = idx(uf.find(`p:${key}`));
    conductors[i].push(key);
    of.set(key, i);
  }
  const wireOf = new Map<string, number>();
  for (const w of wires) wireOf.set(w.id, idx(uf.find(`w:${w.id}`)));
  const itemOf = new Map<string, number>();
  for (const n of named) {
    const i = idx(uf.find(`n:${n.id}`));
    itemOf.set(n.id, i);
    if (!names[i].includes(n.net)) names[i].push(n.net);
  }
  return { conductors, of, wireOf, names, itemOf };
}

/** Rail pins and the card a power symbol sits in, for checks. */
export const isRailNet = isRail;
export { recordsOfKind };
