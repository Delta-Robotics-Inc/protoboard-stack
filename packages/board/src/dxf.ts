/**
 * A minimal reader of ASCII DXF drawings for board outlines, written from the published DXF reference (group code
 * pairs, the HEADER and ENTITIES sections, and the LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE/VERTEX/SEQEND
 * entities). It turns a drawing into closed loops of vertices in integer nanometers, the outline being the largest
 * loop and the cutouts the loops inside it. Anything it does not use is counted in `skipped` with a reason.
 *
 * Also here: small contour helpers (arc flattening, signed area with arcs, point in polygon) the operations share.
 */
import { arcCenter, boxCenter, contourBox, rotatePoint } from "./geometry.js";
import type { Vertex } from "./schema.js";

// ---------------------------------------------------------------- contour helpers

export interface XY {
  x: number;
  y: number;
}

/** Points along an arc from `start` to `end` with a signed sweep (millidegrees), `start` excluded, `end` included. */
export function arcPoints(start: XY, end: XY, sweep: number, maxStep = 5_000): XY[] {
  const c = arcCenter(start as Vertex, end as Vertex, sweep);
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
  const out: XY[] = [];
  for (let i = 1; i < n; i++) {
    const r = rotatePoint({ x: start.x - c.x, y: start.y - c.y }, (sweep * i) / n);
    out.push({ x: c.x + r.x, y: c.y + r.y });
  }
  out.push({ x: end.x, y: end.y });
  return out;
}

/** A closed contour as a polygon: arcs become chords of at most `maxStep` millidegrees (default 5 degrees). */
export function flattenContour(vertices: readonly Vertex[], maxStep = 5_000): XY[] {
  const out: XY[] = [];
  vertices.forEach((v, i) => {
    out.push({ x: v.x, y: v.y });
    if (v.sweep !== undefined) {
      const next = vertices[(i + 1) % vertices.length];
      const pts = arcPoints(v, next, v.sweep, maxStep);
      pts.pop();
      out.push(...pts);
    }
  });
  return out;
}

/** The signed area of a closed contour, arcs included exactly (counterclockwise is positive), square nanometers. */
export function contourArea(vertices: readonly Vertex[]): number {
  let a = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % vertices.length];
    a += p.x * q.y - q.x * p.y;
    if (p.sweep !== undefined) {
      const theta = (p.sweep / 1000) * (Math.PI / 180);
      const chord = Math.hypot(q.x - p.x, q.y - p.y);
      const s = Math.sin(Math.abs(theta) / 2);
      if (chord > 0 && s > 0) {
        const r = chord / (2 * s);
        a += r * r * (theta - Math.sin(theta)); // twice the circular segment's signed area
      }
    }
  }
  return a / 2;
}

/** Whether a point is inside a polygon (ray casting; a point on an edge may go either way). */
export function pointInPolygon(p: XY, poly: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The distance from a point to a segment. */
export function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The distance between two segments (0 when they cross or touch). */
export function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** The same contour traversed the other way (each arc keeps its curve: its sweep is negated). */
export function reverseContour(vertices: readonly Vertex[]): Vertex[] {
  const n = vertices.length;
  const out: Vertex[] = [];
  for (let k = 0; k < n; k++) {
    const v = vertices[(n - k) % n];
    const sweep = vertices[(2 * n - k - 1) % n].sweep;
    out.push(sweep !== undefined ? { x: v.x, y: v.y, sweep: -sweep } : { x: v.x, y: v.y });
  }
  return out;
}

// ---------------------------------------------------------------- reader

export type DxfUnits = "mm" | "in" | "cm" | "m";
const NM_PER_UNIT: Record<DxfUnits, number> = { mm: 1e6, in: 25.4e6, cm: 1e7, m: 1e9 };
/** $INSUNITS codes this reader knows (0 is unitless). */
const INSUNITS: Record<number, DxfUnits> = { 1: "in", 4: "mm", 5: "cm", 6: "m" };

/** The drawing could not be read (malformed, binary, or no closed loop). */
export class DxfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DxfError";
  }
}

export interface DxfSkipped {
  type: string;
  count: number;
  reason: string;
}

/** An edge in nanometers (not rounded): a straight line, or an arc when `sweep` (millidegrees, counterclockwise positive) is set. */
export interface DxfEdge {
  a: XY;
  b: XY;
  sweep?: number;
  /** The entity it came from, for messages. */
  type: string;
}

export interface DxfReadOptions {
  /** `auto` (default): `$INSUNITS` from the header, else millimeters. */
  units?: "mm" | "in" | "auto";
  /** DXF layer names (group 8) to read; default all. */
  layers?: readonly string[];
}

export interface DxfRead {
  units: DxfUnits;
  edges: DxfEdge[];
  /** Entities read into edges. */
  entities: number;
  skipped: DxfSkipped[];
}

interface Group {
  code: number;
  value: string;
}
interface Entity {
  type: string;
  line: number;
  groups: Group[];
}

class Skips {
  private map = new Map<string, DxfSkipped>();
  add(type: string, reason: string, n = 1): void {
    const key = `${type}\u0000${reason}`;
    const s = this.map.get(key);
    if (s) s.count += n;
    else this.map.set(key, { type, count: n, reason });
  }
  list(): DxfSkipped[] {
    return [...this.map.values()];
  }
}

function parseGroups(text: string): { groups: Group[]; lines: number[] } {
  if (text.startsWith("AutoCAD Binary DXF")) throw new DxfError("binary DXF is not supported; save the drawing as ASCII DXF");
  const raw = text.split(/\r\n|\r|\n/);
  if (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
  const groups: Group[] = [];
  const lines: number[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const c = raw[i].trim();
    if (!/^-?\d+$/.test(c)) throw new DxfError(`line ${i + 1}: a group code (an integer) was expected, found ${JSON.stringify(c.slice(0, 40))}`);
    groups.push({ code: Number(c), value: raw[i + 1].trim() });
    lines.push(i + 1);
  }
  return { groups, lines };
}

/** The sections of the file: name to the groups between `2 <name>` and `0 ENDSEC`. */
function sections(groups: Group[], lines: number[]): Map<string, { groups: Group[]; lines: number[] }> {
  const out = new Map<string, { groups: Group[]; lines: number[] }>();
  let i = 0;
  while (i < groups.length) {
    const g = groups[i];
    if (g.code === 0 && g.value === "SECTION" && groups[i + 1]?.code === 2) {
      const name = groups[i + 1].value;
      let j = i + 2;
      while (j < groups.length && !(groups[j].code === 0 && (groups[j].value === "ENDSEC" || groups[j].value === "EOF"))) j++;
      if (!out.has(name)) out.set(name, { groups: groups.slice(i + 2, j), lines: lines.slice(i + 2, j) });
      i = j + 1;
    } else i++;
  }
  return out;
}

function entitiesOf(section: { groups: Group[]; lines: number[] }): Entity[] {
  const out: Entity[] = [];
  let cur: Entity | undefined;
  section.groups.forEach((g, k) => {
    if (g.code === 0) {
      cur = { type: g.value, line: section.lines[k], groups: [] };
      out.push(cur);
    } else cur?.groups.push(g);
  });
  return out;
}

function headerUnits(section: { groups: Group[] } | undefined): number | undefined {
  if (!section) return undefined;
  const gs = section.groups;
  for (let i = 0; i < gs.length; i++) {
    if (gs[i].code === 9 && gs[i].value === "$INSUNITS") {
      const v = gs[i + 1];
      if (v && v.code === 70 && /^-?\d+$/.test(v.value)) return Number(v.value);
      return undefined;
    }
  }
  return undefined;
}

const num = (e: Entity, code: number, fallback?: number): number => {
  const g = e.groups.find((x) => x.code === code);
  if (!g) {
    if (fallback !== undefined) return fallback;
    throw new DxfError(`${e.type} at line ${e.line}: group ${code} is missing`);
  }
  const v = Number(g.value);
  if (!Number.isFinite(v)) throw new DxfError(`${e.type} at line ${e.line}: group ${code} is not a number (${JSON.stringify(g.value.slice(0, 40))})`);
  return v;
};
const str = (e: Entity, code: number): string | undefined => e.groups.find((x) => x.code === code)?.value;

/** A bulge (tan of a quarter of the included angle) as a sweep in millidegrees; 0 means straight. */
export function bulgeToSweep(bulge: number): number {
  const s = Math.round(((4 * Math.atan(bulge) * 180) / Math.PI) * 1000);
  return Math.max(-360_000, Math.min(360_000, s));
}

/**
 * Read the drawing's outline entities as edges in nanometers. Throws `DxfError` when the text is not an ASCII DXF
 * with an ENTITIES section or a number is malformed.
 */
export function readDxf(text: string, options: DxfReadOptions = {}): DxfRead {
  const { groups, lines } = parseGroups(text);
  const secs = sections(groups, lines);
  const ents = secs.get("ENTITIES");
  if (!ents) throw new DxfError("no ENTITIES section: this is not an ASCII DXF drawing");
  const code = headerUnits(secs.get("HEADER"));
  let units: DxfUnits;
  if (options.units && options.units !== "auto") units = options.units;
  else if (code === undefined || code === 0) units = "mm";
  else if (INSUNITS[code]) units = INSUNITS[code];
  else throw new DxfError(`$INSUNITS is ${code}, which this reader does not convert (it reads 1 inch, 4 mm, 5 cm, 6 m); pass units: "mm" or "in"`);
  const k = NM_PER_UNIT[units];
  const layers = options.layers ? new Set(options.layers) : undefined;
  const skips = new Skips();
  const edges: DxfEdge[] = [];
  let used = 0;
  const list = entitiesOf(ents);

  /** The OCS of a planar entity: identity, or mirrored in x when the extrusion is (0, 0, -1); undefined when tilted. */
  const ocs = (e: Entity): 1 | -1 | undefined => {
    const ex = num(e, 210, 0);
    const ey = num(e, 220, 0);
    const ez = num(e, 230, 1);
    if (Math.abs(ex) > 1e-9 || Math.abs(ey) > 1e-9 || Math.abs(Math.abs(ez) - 1) > 1e-9) return undefined;
    return ez > 0 ? 1 : -1;
  };
  const pt = (x: number, y: number, m: 1 | -1 = 1): XY => ({ x: m * x * k, y: y * k });
  const addPolyline = (type: string, verts: { x: number; y: number; bulge: number }[], closed: boolean, m: 1 | -1) => {
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const n = verts[i + 1] ?? (closed ? verts[0] : undefined);
      if (!n) break;
      const sweep = v.bulge ? bulgeToSweep(v.bulge) * m : 0;
      edges.push({ a: pt(v.x, v.y, m), b: pt(n.x, n.y, m), ...(sweep ? { sweep } : {}), type });
    }
  };

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.type === "EOF") continue;
    // the vertices of a POLYLINE belong to it
    let vertices: Entity[] = [];
    if (e.type === "POLYLINE") {
      let j = i + 1;
      while (j < list.length && list[j].type === "VERTEX") j++;
      vertices = list.slice(i + 1, j);
      if (list[j]?.type === "SEQEND") j++;
      i = j - 1;
    } else if (e.type === "VERTEX" || e.type === "SEQEND") {
      skips.add(e.type, "outside a POLYLINE");
      continue;
    }
    const layer = str(e, 8) ?? "0";
    if (layers && !layers.has(layer)) {
      skips.add(e.type, "on a layer that was not selected");
      continue;
    }
    switch (e.type) {
      case "LINE": {
        edges.push({ a: pt(num(e, 10), num(e, 20)), b: pt(num(e, 11), num(e, 21)), type: "LINE" });
        used++;
        break;
      }
      case "ARC":
      case "CIRCLE": {
        const m = ocs(e);
        if (!m) {
          skips.add(e.type, "not in the XY plane (tilted extrusion)");
          break;
        }
        const cx = num(e, 10);
        const cy = num(e, 20);
        const r = num(e, 40);
        if (!(r > 0)) {
          skips.add(e.type, "radius is not positive");
          break;
        }
        const at = (deg: number): XY => pt(cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180), m);
        let a0 = 0;
        let span = 360;
        if (e.type === "ARC") {
          a0 = num(e, 50);
          const a1 = num(e, 51);
          span = (((a1 - a0) % 360) + 360) % 360;
          if (span === 0) span = 360;
        }
        const sweep = Math.round(span * 1000);
        if (sweep >= 360_000) {
          // a whole circle: two half circles
          edges.push({ a: at(a0), b: at(a0 + 180), sweep: 180_000 * m, type: e.type });
          edges.push({ a: at(a0 + 180), b: at(a0), sweep: 180_000 * m, type: e.type });
        } else if (sweep > 0) edges.push({ a: at(a0), b: at(a0 + span), sweep: sweep * m, type: e.type });
        else {
          skips.add(e.type, "zero sweep");
          break;
        }
        used++;
        break;
      }
      case "LWPOLYLINE": {
        const m = ocs(e);
        if (!m) {
          skips.add(e.type, "not in the XY plane (tilted extrusion)");
          break;
        }
        const verts: { x: number; y: number; bulge: number }[] = [];
        let cur: { x: number; y: number; bulge: number } | undefined;
        for (const g of e.groups) {
          const v = Number(g.value);
          if ((g.code === 10 || g.code === 20 || g.code === 42) && !Number.isFinite(v)) throw new DxfError(`LWPOLYLINE at line ${e.line}: group ${g.code} is not a number`);
          if (g.code === 10) {
            cur = { x: v, y: 0, bulge: 0 };
            verts.push(cur);
          } else if (g.code === 20 && cur) cur.y = v;
          else if (g.code === 42 && cur) cur.bulge = v;
        }
        if (verts.length < 2) {
          skips.add(e.type, "fewer than two vertices");
          break;
        }
        addPolyline(e.type, verts, (num(e, 70, 0) & 1) === 1, m);
        used++;
        break;
      }
      case "POLYLINE": {
        const flags = num(e, 70, 0);
        if (flags & (16 | 64)) {
          skips.add(e.type, "a polygon or polyface mesh, not an outline");
          break;
        }
        const m = flags & 8 ? 1 : ocs(e);
        if (!m) {
          skips.add(e.type, "not in the XY plane (tilted extrusion)");
          break;
        }
        const verts = vertices.filter((v) => (num(v, 70, 0) & 16) === 0).map((v) => ({ x: num(v, 10), y: num(v, 20), bulge: num(v, 42, 0) }));
        if (verts.length < 2) {
          skips.add(e.type, "fewer than two vertices");
          break;
        }
        addPolyline(e.type, verts, (flags & 1) === 1, m);
        used++;
        break;
      }
      case "INSERT":
        skips.add(e.type, "block references are not expanded; explode blocks before export");
        break;
      case "SPLINE":
      case "ELLIPSE":
        skips.add(e.type, "this curve type is not read; convert it to a polyline or arcs before export");
        break;
      default:
        skips.add(e.type, "not an outline entity (LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE are read)");
    }
  }
  return { units, edges, entities: used, skipped: skips.list() };
}

// ---------------------------------------------------------------- joining

export interface DxfJoin {
  /** Closed loops in nanometers (rounded), as traversed; each has at least three vertices. */
  loops: Vertex[][];
  /** Chains that did not close. */
  open: number;
  skipped: DxfSkipped[];
}

/** Split every arc of a loop in two until it has at least three vertices (a circle read as two halves). */
function splitArcs(loop: Vertex[]): Vertex[] {
  let cur = loop;
  for (let pass = 0; pass < 3 && cur.length < 3; pass++) {
    const next: Vertex[] = [];
    cur.forEach((v, i) => {
      const n = cur[(i + 1) % cur.length];
      if (v.sweep === undefined || Math.abs(v.sweep) < 2) {
        next.push(v);
        return;
      }
      const s1 = Math.trunc(v.sweep / 2);
      const s2 = v.sweep - s1;
      const c = arcCenter(v, n, v.sweep);
      const r = rotatePoint({ x: v.x - c.x, y: v.y - c.y }, s1);
      next.push({ x: v.x, y: v.y, sweep: s1 }, { x: Math.round(c.x + r.x), y: Math.round(c.y + r.y), sweep: s2 });
    });
    cur = next;
  }
  return cur;
}

/**
 * Join edges whose ends lie within `tolerance` nanometers into closed loops (a walk over the graph of ends). An arc
 * walked from its end to its start keeps its curve (its sweep is negated). Chains that do not close are counted in
 * `open`; edges shorter than the tolerance are skipped.
 */
export function joinEdges(edges: readonly DxfEdge[], tolerance: number): DxfJoin {
  const skips = new Skips();
  const tol = Math.max(tolerance, 0);
  const cell = Math.max(tol, 1);
  const nodes: XY[] = [];
  const grid = new Map<string, number[]>();
  const nodeOf = (p: XY): number => {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);
    let best = -1;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const n of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const d = Math.hypot(nodes[n].x - p.x, nodes[n].y - p.y);
          if (d <= tol && d < bestD) {
            best = n;
            bestD = d;
          }
        }
    if (best >= 0) return best;
    nodes.push({ x: p.x, y: p.y });
    const key = `${gx},${gy}`;
    grid.set(key, [...(grid.get(key) ?? []), nodes.length - 1]);
    return nodes.length - 1;
  };
  interface E {
    a: number;
    b: number;
    sweep?: number;
    used: boolean;
  }
  const es: E[] = [];
  const at = new Map<number, number[]>();
  for (const e of edges) {
    const a = nodeOf(e.a);
    const b = nodeOf(e.b);
    if (a === b) {
      skips.add(e.type, "shorter than the joining tolerance");
      continue;
    }
    es.push({ a, b, ...(e.sweep !== undefined ? { sweep: e.sweep } : {}), used: false });
    at.set(a, [...(at.get(a) ?? []), es.length - 1]);
    at.set(b, [...(at.get(b) ?? []), es.length - 1]);
  }
  const junctions = [...at.values()].filter((l) => l.length > 2).length;
  if (junctions) skips.add("junction", "more than two ends meet at a point; joined in file order", junctions);

  interface Step {
    from: number;
    to: number;
    sweep?: number;
  }
  const orient = (e: E, from: number): Step => (e.a === from ? { from: e.a, to: e.b, ...(e.sweep !== undefined ? { sweep: e.sweep } : {}) } : { from: e.b, to: e.a, ...(e.sweep !== undefined ? { sweep: -e.sweep } : {}) });
  const nextAt = (node: number): number | undefined => (at.get(node) ?? []).find((i) => !es[i].used);

  const loops: Vertex[][] = [];
  let open = 0;
  es.forEach((first) => {
    if (first.used) return;
    first.used = true;
    const steps: Step[] = [orient(first, first.a)];
    let node = first.b;
    let closed = false;
    for (;;) {
      if (node === steps[0].from) {
        closed = true;
        break;
      }
      const i = nextAt(node);
      if (i === undefined) break;
      es[i].used = true;
      const s = orient(es[i], node);
      steps.push(s);
      node = s.to;
    }
    if (!closed) {
      // extend backward from the first edge's start so the whole chain is used up
      let back = steps[0].from;
      for (let i = nextAt(back); i !== undefined; i = nextAt(back)) {
        es[i].used = true;
        back = orient(es[i], back).to;
      }
      open++;
      return;
    }
    const loop: Vertex[] = [];
    for (const s of steps) {
      const p = nodes[s.from];
      const v: Vertex = { x: Math.round(p.x), y: Math.round(p.y) };
      const q = nodes[s.to];
      if (Math.round(q.x) === v.x && Math.round(q.y) === v.y) continue;
      if (s.sweep !== undefined && s.sweep !== 0) v.sweep = s.sweep;
      loop.push(v);
    }
    const full = splitArcs(loop);
    if (full.length < 3) skips.add("loop", "fewer than three vertices after rounding");
    else loops.push(full);
  });
  return { loops, open, skipped: skips.list() };
}

// ---------------------------------------------------------------- outline

export interface DxfOutlineOptions extends DxfReadOptions {
  /** Joining tolerance in nanometers (default 10,000). */
  tolerance?: number;
  /** `center` (default): translate so the outline's box center is (0, 0); `keep`: the drawing's coordinates. */
  origin?: "center" | "keep";
  /** Loops inside the outline become cutouts (default true). */
  cutouts?: boolean;
}

export interface DxfOutlineReport {
  entities: number;
  loops: number;
  outline: { vertices: number; area: number };
  cutouts: number;
  skipped: DxfSkipped[];
  open: number;
  units: DxfUnits;
}

export interface DxfOutline {
  /** Counterclockwise. */
  outline: Vertex[];
  /** Clockwise, by decreasing area. */
  cutouts: Vertex[][];
  report: DxfOutlineReport;
}

/**
 * A board outline and its cutouts from a DXF drawing: the largest closed loop (by absolute area, arcs included) is
 * the outline, made counterclockwise; loops wholly inside it are cutouts, made clockwise; everything else is in
 * `report.skipped` with a reason. Throws `DxfError` when nothing closes.
 */
export function dxfOutline(text: string, options: DxfOutlineOptions = {}): DxfOutline {
  const read = readDxf(text, options);
  const joined = joinEdges(read.edges, options.tolerance ?? 10_000);
  const skips = new Skips();
  for (const s of [...read.skipped, ...joined.skipped]) skips.add(s.type, s.reason, s.count);
  if (!joined.loops.length) throw new DxfError(`no closed loop in the drawing (${read.entities} entities read, ${joined.open} open chain${joined.open === 1 ? "" : "s"}); raise the tolerance or close the outline`);
  const loops = joined.loops.map((l) => ({ l, area: contourArea(l) })).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const outer = loops[0];
  let outline = outer.area < 0 ? reverseContour(outer.l) : outer.l;
  const poly = flattenContour(outline);
  const accepted: { l: Vertex[]; poly: XY[]; area: number }[] = [];
  for (const { l, area } of loops.slice(1)) {
    const pts = flattenContour(l);
    const inside = pts.filter((p) => pointInPolygon(p, poly)).length;
    if (inside === 0) skips.add("loop", "outside the outline");
    else if (inside < pts.length) skips.add("loop", "crosses the outline");
    else if (options.cutouts === false) skips.add("loop", "inside the outline, but cutouts: false");
    else if (accepted.some((c) => pts.every((p) => pointInPolygon(p, c.poly)))) skips.add("loop", "inside another cutout (an island)");
    else accepted.push({ l: area > 0 ? reverseContour(l) : l, poly: pts, area: Math.abs(area) });
  }
  let cutouts = accepted.map((c) => c.l);
  if ((options.origin ?? "center") === "center") {
    const c = boxCenter(contourBox(outline));
    const shift = (vs: Vertex[]) => vs.map((v) => ({ ...v, x: v.x - c.x, y: v.y - c.y }));
    outline = shift(outline);
    cutouts = cutouts.map(shift);
  }
  return {
    outline,
    cutouts,
    report: {
      entities: read.entities,
      loops: joined.loops.length,
      outline: { vertices: outline.length, area: Math.round(Math.abs(outer.area)) },
      cutouts: cutouts.length,
      skipped: skips.list(),
      open: joined.open,
      units: read.units,
    },
  };
}
