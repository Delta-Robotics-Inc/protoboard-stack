/**
 * Our board to tscircuit's SimpleRouteJson (the autorouter's published input format, millimeters) and its traces
 * back to routed copper. The autorouter has no lock flag for existing copper in the pinned version, so every
 * existing track and via goes in as an obstacle (connected to its net when the net is in scope, so routes may join
 * it); locks are verified after the run. Rectangles approximate what the format cannot hold, and every
 * approximation or omission is listed in `unexpressed`.
 */
import { copperLayers, padsOf, recordsOfKind, viaLayers, type Pad } from "@protoboardai/board";
import { netConstraint } from "../../constraints.js";
import { flattenContour, isAxisRect, polygonBox, trackPieces, type P } from "../../geom.js";
import type { RoutedSegment, RoutedVia } from "../../ops.js";
import type { RouteJob } from "../../types.js";

// The subset of the format this adapter writes and reads (the package's own types are not imported here so the
// converter stays usable without loading the autorouter).
export interface SrjObstacle {
  obstacleId?: string;
  type: "rect";
  shape?: "circle";
  layers: string[];
  center: { x: number; y: number };
  width: number;
  height: number;
  connectedTo: string[];
  isNonPlatedHole?: boolean;
}
export type SrjPoint = { x: number; y: number; layer: string; pointId?: string } | { x: number; y: number; layers: string[]; pointId?: string };
export interface SrjConnection {
  name: string;
  netConnectionName?: string;
  nominalTraceWidth?: number;
  pointsToConnect: SrjPoint[];
}
export interface SimpleRouteJsonIn {
  layerCount: number;
  minTraceWidth: number;
  nominalTraceWidth?: number;
  minViaDiameter?: number;
  minViaPadDiameter?: number;
  minViaHoleDiameter?: number;
  defaultObstacleMargin?: number;
  minTraceToPadEdgeClearance?: number;
  minBoardEdgeClearance?: number;
  allowViaInPad?: boolean;
  obstacles: SrjObstacle[];
  connections: SrjConnection[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  outline?: { x: number; y: number }[];
}
export type SrjRoutePoint =
  | { route_type: "wire"; x: number; y: number; width: number; layer: string }
  | { route_type: "via"; x: number; y: number; from_layer: string; to_layer: string; via_diameter?: number; via_hole_diameter?: number }
  | { route_type: string; [k: string]: unknown };
export interface SrjTrace {
  type: "pcb_trace";
  pcb_trace_id: string;
  connection_name: string;
  route: SrjRoutePoint[];
}

const MM = 1_000_000;
const mm = (nm: number) => nm / MM;
const nm = (v: number) => Math.round(v * MM);

/** A connection name that is never a prefix of another (`pbn1x`, `pbn10x`). */
export const connectionName = (i: number) => `pbn${i}x`;

/** Axis-aligned squares covering a straight copper piece (one rectangle when it is axis-aligned). */
function pieceRects(a: P, b: P, width: number): { cx: number; cy: number; w: number; h: number }[] {
  if (a.x === b.x || a.y === b.y) {
    const minX = Math.min(a.x, b.x) - width / 2;
    const maxX = Math.max(a.x, b.x) + width / 2;
    const minY = Math.min(a.y, b.y) - width / 2;
    const maxY = Math.max(a.y, b.y) + width / 2;
    return [{ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }];
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / (width / 2)));
  const out: { cx: number; cy: number; w: number; h: number }[] = [];
  for (let i = 0; i <= n; i++) out.push({ cx: a.x + ((b.x - a.x) * i) / n, cy: a.y + ((b.y - a.y) * i) / n, w: width, h: width });
  return out;
}

/** Horizontal strips covering a polygon (its box when it is an axis-aligned rectangle). */
function polygonRects(points: P[], strips = 16): { cx: number; cy: number; w: number; h: number }[] {
  const b = polygonBox(points);
  if (isAxisRect(points)) return [{ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY }];
  const out: { cx: number; cy: number; w: number; h: number }[] = [];
  const h = (b.maxY - b.minY) / strips;
  for (let i = 0; i < strips; i++) {
    const y0 = b.minY + h * i;
    const y1 = y0 + h;
    // the polygon's x extent over this strip, from edge crossings and vertices inside it
    const xs: number[] = [];
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const q = points[(k + 1) % points.length];
      if (p.y >= y0 && p.y <= y1) xs.push(p.x);
      for (const y of [y0, y1])
        if ((p.y - y) * (q.y - y) < 0) xs.push(p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y));
    }
    if (xs.length < 2) continue;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    out.push({ cx: (minX + maxX) / 2, cy: (y0 + y1) / 2, w: maxX - minX, h });
  }
  return out;
}

/** A pad as a rectangle or circle obstacle (box of a rotated or polygon pad). */
function padShape(pad: Pad, worldRotation: number, box: { minX: number; minY: number; maxX: number; maxY: number }, center: P): { w: number; h: number; circle: boolean; approximated: boolean } {
  if (pad.type === "np") return { w: pad.hole_diameter!, h: pad.hole_diameter!, circle: true, approximated: false };
  if (pad.shape === "circle") {
    const d = pad.type === "th" ? pad.outer_diameter! : 2 * pad.radius!;
    return { w: d, h: d, circle: true, approximated: false };
  }
  const quarter = worldRotation % 90_000 === 0;
  if (pad.shape !== "polygon" && quarter) {
    const w = pad.type === "th" ? pad.outer_width! : pad.width!;
    const h = pad.type === "th" ? pad.outer_height! : pad.height!;
    const swap = (worldRotation / 90_000) % 2 === 1;
    return { w: swap ? h : w, h: swap ? w : h, circle: false, approximated: pad.shape === "oval" || pad.shape === "roundrect" };
  }
  return { w: Math.max(2 * Math.max(center.x - box.minX, box.maxX - center.x), 1), h: Math.max(2 * Math.max(center.y - box.minY, box.maxY - center.y), 1), circle: false, approximated: true };
}

export interface SrjConversion {
  srj: SimpleRouteJsonIn;
  /** Connection name to net name. */
  nets: Map<string, string>;
  unexpressed: string[];
}

/** The SimpleRouteJson for a job. */
export function jobToSrj(job: Pick<RouteJob, "doc" | "nets" | "layers" | "constraints" | "region">): SrjConversion {
  const doc = job.doc;
  const stack = copperLayers(doc);
  const unexpressed: string[] = [];
  const c = job.constraints;
  const nets = new Map<string, string>();
  const connOf = new Map<string, string>();
  const connections: SrjConnection[] = [];
  job.nets.forEach((n, i) => {
    const name = connectionName(i);
    const points: SrjPoint[] = [];
    let unreachable = false;
    for (const a of n.islands) {
      const ls = a.layers.filter((l) => job.layers.includes(l));
      if (!ls.length) unreachable = true;
      else points.push(ls.length === 1 ? { x: mm(a.x), y: mm(a.y), layer: ls[0], pointId: a.object } : { x: mm(a.x), y: mm(a.y), layers: ls, pointId: a.object });
    }
    if (unreachable) unexpressed.push(`net ${n.net}: a piece of it is only on a layer outside the scope; that piece is left open`);
    if (points.length < 2) return;
    nets.set(name, n.net);
    connOf.set(n.net, name);
    connections.push({ name, netConnectionName: name, nominalTraceWidth: mm(netConstraint(c, n.net).width.plan), pointsToConnect: points });
  });
  const touchable = (net: string | undefined) => (net && connOf.has(net) ? [connOf.get(net)!] : []);
  // existing copper joins its net only when it is part of a pad island: same-net copper that touches no pad (a
  // dangling track on the other layer under a pad, say) is a plain obstacle, or the router would take it for the pad
  const inIsland = new Set(job.nets.flatMap((n) => n.objects));
  const touchableCopper = (id: string, net: string | undefined) => (inIsland.has(id) ? touchable(net) : []);

  const obstacles: SrjObstacle[] = [];
  let approxPads = 0;
  for (const fp of recordsOfKind(doc, "footprint"))
    for (const p of padsOf(fp, stack)) {
      const net = doc.padNets.get(p.id);
      const layers = p.pad.type === "smd" ? p.layers : [...stack];
      const s = padShape(p.pad, p.rotation, p.box, p);
      if (s.approximated) approxPads++;
      obstacles.push({ obstacleId: p.id, type: "rect", ...(s.circle ? { shape: "circle" as const } : {}), layers, center: { x: mm(p.x), y: mm(p.y) }, width: mm(s.w), height: mm(s.h), connectedTo: p.pad.type === "np" ? [] : touchable(net), ...(p.pad.type === "np" ? { isNonPlatedHole: true } : {}) });
    }
  if (approxPads) unexpressed.push(`${approxPads} pad(s) (rotated, rounded, oval or polygon) are rectangles around their shape in the router input`);
  let diagonal = 0;
  for (const t of recordsOfKind(doc, "track")) {
    const pieces = trackPieces(t);
    pieces.forEach(([a, b], k) => {
      const rects = pieceRects(a, b, t.width);
      if (rects.length > 1) diagonal++;
      rects.forEach((r, j) => obstacles.push({ obstacleId: `${t.id}#${k}.${j}`, type: "rect", layers: [t.layer], center: { x: mm(r.cx), y: mm(r.cy) }, width: mm(r.w), height: mm(r.h), connectedTo: touchableCopper(t.id, t.net) }));
    });
  }
  if (diagonal) unexpressed.push(`${diagonal} existing diagonal or arc track piece(s) are chains of squares in the router input`);
  for (const v of recordsOfKind(doc, "via"))
    obstacles.push({ obstacleId: v.id, type: "rect", shape: "circle", layers: viaLayers(doc, v.from_layer, v.to_layer), center: { x: mm(v.x), y: mm(v.y) }, width: mm(v.outer_diameter), height: mm(v.outer_diameter), connectedTo: touchableCopper(v.id, v.net) });
  for (const k of c.keepouts) {
    if (k.tier !== "no_go") continue;
    if (!(k.blocks.tracks && k.blocks.vias)) {
      if (k.blocks.tracks || k.blocks.vias) unexpressed.push(`keep-out ${k.id} blocks only ${k.blocks.tracks ? "tracks" : "vias"}: the autorouter's obstacles block both, so it is left out and checked after`);
      continue;
    }
    const flat = flattenContour(k.outline);
    const rects = polygonRects(flat.points);
    if (flat.approximated || !isAxisRect(flat.points)) unexpressed.push(`keep-out ${k.id} is approximated by ${rects.length} rectangle(s)`);
    rects.forEach((r, j) => obstacles.push({ obstacleId: `${k.id}#${j}`, type: "rect", layers: k.layers.filter((l) => stack.includes(l)), center: { x: mm(r.cx), y: mm(r.cy) }, width: mm(r.w), height: mm(r.h), connectedTo: [] }));
  }
  for (const cut of recordsOfKind(doc, "cutout")) {
    const rects = polygonRects(flattenContour(cut.outline).points);
    rects.forEach((r, j) => obstacles.push({ obstacleId: `${cut.id}#${j}`, type: "rect", layers: [...stack], center: { x: mm(r.cx), y: mm(r.cy) }, width: mm(r.w), height: mm(r.h), connectedTo: [] }));
  }

  const outlineRec = doc.records.get("outline");
  const outlinePts = outlineRec?.kind === "outline" ? flattenContour(outlineRec.outline).points : undefined;
  let box = outlinePts ? polygonBox(outlinePts) : polygonBox(obstacles.flatMap((o) => [{ x: nm(o.center.x - o.width / 2), y: nm(o.center.y - o.height / 2) }, { x: nm(o.center.x + o.width / 2), y: nm(o.center.y + o.height / 2) }]));
  if (job.region) {
    const r = flattenContour(job.region).points;
    const rb = polygonBox(r);
    box = { minX: Math.max(box.minX, rb.minX), minY: Math.max(box.minY, rb.minY), maxX: Math.min(box.maxX, rb.maxX), maxY: Math.min(box.maxY, rb.maxY) };
    if (!isAxisRect(r)) unexpressed.push("the region is not a rectangle: the router is bounded by its box");
  }
  const excluded = stack.filter((l) => !job.layers.includes(l));
  if (excluded.length) {
    obstacles.push({ obstacleId: "scope-layers", type: "rect", layers: excluded, center: { x: mm((box.minX + box.maxX) / 2), y: mm((box.minY + box.maxY) / 2) }, width: mm(box.maxX - box.minX), height: mm(box.maxY - box.minY), connectedTo: [] });
    unexpressed.push(`layers outside the scope (${excluded.join(", ")}) are blocked by an obstacle, which also blocks vias through them`);
  }
  const widths = job.nets.map((n) => netConstraint(c, n.net).width.floor);
  const clearances = new Set(job.nets.map((n) => netConstraint(c, n.net).clearance.plan));
  if (clearances.size > 1 || [...clearances].some((v) => v !== c.defaults.clearance.plan))
    unexpressed.push(`per-net clearance (${[...clearances].map((v) => mm(v)).join(", ")} mm): the autorouter takes one clearance, ${mm(c.defaults.clearance.plan)} mm; checked after`);
  unexpressed.push("track width: the autorouter may neck below the plan down to the minimum trace width (the floor)");
  if (c.noGoRules.some((r) => r.check !== "via_in_pad")) for (const r of c.noGoRules.filter((r) => r.check !== "via_in_pad")) unexpressed.push(`no-go rule ${r.id} (${r.check}): not in the router input; checked after`);
  const srj: SimpleRouteJsonIn = {
    layerCount: stack.length,
    minTraceWidth: mm(Math.min(c.defaults.width.floor, ...widths)),
    nominalTraceWidth: mm(c.defaults.width.plan),
    minViaDiameter: mm(c.via.outer.plan),
    minViaPadDiameter: mm(c.via.outer.plan),
    minViaHoleDiameter: mm(c.via.hole.plan),
    defaultObstacleMargin: mm(c.defaults.clearance.plan),
    minTraceToPadEdgeClearance: mm(c.defaults.clearance.plan),
    minBoardEdgeClearance: mm(c.edgeClearance.plan),
    allowViaInPad: false,
    obstacles,
    connections,
    bounds: { minX: mm(box.minX), maxX: mm(box.maxX), minY: mm(box.minY), maxY: mm(box.maxY) },
    ...(outlinePts && !job.region ? { outline: outlinePts.map((p) => ({ x: mm(p.x), y: mm(p.y) })) } : {}),
  };
  return { srj, nets, unexpressed };
}

/** The net a connection name belongs to (output names carry suffixes such as `_mst0`). */
export function netOfConnection(name: string, nets: Map<string, string>): string | undefined {
  const exact = nets.get(name);
  if (exact) return exact;
  const m = /^(pbn\d+x)/.exec(name);
  return m ? nets.get(m[1]) : undefined;
}

/** The autorouter's traces as routed copper (nanometers). Jumpers and through-obstacle hops are dropped and counted. */
export function srjTracesToRouted(traces: readonly SrjTrace[], nets: Map<string, string>, via: { outer: number; hole: number }): { segments: RoutedSegment[]; vias: RoutedVia[]; messages: string[] } {
  const segments: RoutedSegment[] = [];
  const vias: RoutedVia[] = [];
  const messages: string[] = [];
  let unsupported = 0;
  let implicitVias = 0;
  for (const t of traces) {
    const net = netOfConnection(t.connection_name, nets);
    if (!net) {
      messages.push(`trace ${t.pcb_trace_id} has connection ${t.connection_name}, which is not one of this job's`);
      continue;
    }
    let prev: { x: number; y: number; layer: string; width: number } | undefined;
    for (const p of t.route) {
      if (p.route_type === "wire") {
        const w = p as { x: number; y: number; width: number; layer: string };
        const cur = { x: nm(w.x), y: nm(w.y), layer: w.layer, width: nm(w.width) };
        if (prev && prev.layer !== cur.layer) {
          // a layer change without a via step: the copper needs one where the layers meet
          vias.push({ net, x: prev.x, y: prev.y, outer: via.outer, hole: via.hole, from: prev.layer, to: cur.layer });
          implicitVias++;
          prev = { ...prev, layer: cur.layer };
        }
        if (prev && (prev.x !== cur.x || prev.y !== cur.y)) segments.push({ net, layer: cur.layer, width: Math.max(prev.width, cur.width), start: { x: prev.x, y: prev.y }, end: { x: cur.x, y: cur.y } });
        prev = cur;
      } else if (p.route_type === "via") {
        const v = p as { x: number; y: number; from_layer: string; to_layer: string; via_diameter?: number; via_hole_diameter?: number };
        vias.push({ net, x: nm(v.x), y: nm(v.y), outer: v.via_diameter ? nm(v.via_diameter) : via.outer, hole: v.via_hole_diameter ? nm(v.via_hole_diameter) : via.hole, from: v.from_layer, to: v.to_layer });
        prev = undefined;
      } else {
        unsupported++;
        prev = undefined;
      }
    }
  }
  if (implicitVias) messages.push(`${implicitVias} layer change(s) without a via step in the autorouter output were given a via`);
  if (unsupported) messages.push(`${unsupported} jumper or through-obstacle step(s) in the autorouter output were dropped (not board copper)`);
  return { segments, vias, messages };
}

