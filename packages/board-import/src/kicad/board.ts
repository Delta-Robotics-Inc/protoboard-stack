/**
 * The KiCad board importer: a `.kicad_pcb` (KiCad 7 to 10 files) into a board document, its netlist and the zone
 * fill the file was saved with. Written from KiCad's published file-format documentation; no KiCad code.
 *
 * Coordinates: KiCad stores millimeters with +Y down; the document stores integer nanometers with +Y up, so Y is
 * negated, then the board is centered on its outline's box (the offset is in the result and the report).
 * Footprint-frame coordinates: a top footprint's children keep KiCad's local coordinates with Y negated; a bottom
 * footprint's children are stored by KiCad already mirrored, so they keep KiCad's local numbers as they are and the
 * footprint turns by its angle plus 180 degrees (the core's transform mirrors left to right, contract section 2).
 */
import polygonClipping, { type Polygon as ClipPolygon } from "polygon-clipping";
import {
  deg,
  footprintKey,
  footprintToWorld,
  mm,
  normAngle,
  padId,
  padKeys,
  sideLayer,
  type AnyLayer,
  type BoardRec,
  type CopperLayer,
  type FootprintGraphic,
  type FootprintRec,
  type FootprintText,
  type GraphicRec,
  type KeepoutRec,
  type LayerRec,
  type Netlist,
  type Pad,
  type Point,
  type Side,
  type TextRec,
  type Vertex,
  type ZoneRec,
} from "@protoboardai/board";
import { assemble, emptyDraft, type Draft } from "../assemble.js";
import { unfracture, type FillEntry } from "../fill.js";
import { arcSweep, ccwContour, circleContour, dedupeContour, joinEdges, pointInPolygon, polygonArea, reverseContour, tessellate, validContour, type Edge } from "../geom.js";
import { Reporter } from "../report.js";
import { atomsOf, flag, head, isList, kid, kids, num, numOf, parseSexpr, str, val, xyOf, type SList } from "../sexpr.js";
import type { BoardImportResult } from "../types.js";
import { KicadLayers } from "./layers.js";
import { mapKicadRules } from "./rules.js";

export const KICAD_IMPORTER_ID = "kicad";
const PROV = { by: "imported", tool: "kicad" } as const;

export interface KicadImportOptions {
  /** The board's name (default: "imported board"). */
  name?: string;
  /** The `.kicad_pro` beside the board, as text: net classes and board constraints. */
  project?: string;
  /** The `.kicad_dru` beside the board, as text: custom rules. */
  rules?: string;
  /** How far apart two Edge.Cuts end points may be and still join, nanometers (default 1000: 1 micrometer). */
  tolerance?: number;
  /** Center the board on the origin (default true). */
  recenter?: boolean;
}

type Map2 = (x: number, y: number) => Point;
/** A point map with Y scaled by `ysign` (KiCad millimeters to nanometers). */
const mapWith =
  (ysign: 1 | -1): Map2 =>
  (x, y) => ({ x: mm(x) || 0, y: ysign * mm(y) || 0 });
const WORLD = mapWith(-1);

/** The angle KiCad shows a footprint text at (millidegrees): its angle, less 180 degrees when in (90, 270]. */
export function uprightAngle(degrees: number): number {
  const a = normAngle(deg(degrees));
  return a > 90_000 && a <= 270_000 ? a - 180_000 : a;
}

/** KiCad's rotation of a local point by `a` degrees (counterclockwise as seen on its Y-down screen). */
function rotK(x: number, y: number, a: number): [number, number] {
  if (!a) return [x, y];
  const r = (a * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c + y * s, -x * s + y * c];
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** A ring in KiCad local millimeters; `mid` is a point on the arc from this vertex to the next. */
type KRing = { x: number; y: number; mid?: [number, number] }[];

/** A ring turned into vertices through a point map (arcs keep their sweep). */
function ringToVertices(ring: KRing, map: Map2): Vertex[] {
  const out: Vertex[] = ring.map((v, i) => {
    const p = map(v.x, v.y);
    if (!v.mid) return p;
    const n = ring[(i + 1) % ring.length];
    const sw = arcSweep(p, map(v.mid[0], v.mid[1]), map(n.x, n.y));
    return sw !== undefined ? { ...p, sweep: sw } : p;
  });
  return dedupeContour(out);
}

/** A rectangle with rounded or chamfered corners, centered, in KiCad local millimeters (clockwise on screen). */
function cornerRing(w: number, h: number, round: number, chamfer: number, chamfered: Set<string>): KRing {
  const corners: { name: string; p: [number, number]; u: [number, number]; v: [number, number] }[] = [
    { name: "top_left", p: [-w / 2, -h / 2], u: [0, -1], v: [1, 0] },
    { name: "top_right", p: [w / 2, -h / 2], u: [1, 0], v: [0, 1] },
    { name: "bottom_right", p: [w / 2, h / 2], u: [0, 1], v: [-1, 0] },
    { name: "bottom_left", p: [-w / 2, h / 2], u: [-1, 0], v: [0, -1] },
  ];
  const ring: KRing = [];
  for (const c of corners) {
    const ch = chamfered.has(c.name) && chamfer > 0;
    const k = ch ? chamfer : round;
    if (k <= 0) {
      ring.push({ x: c.p[0], y: c.p[1] });
      continue;
    }
    const before = { x: c.p[0] - c.u[0] * k, y: c.p[1] - c.u[1] * k };
    const after = { x: c.p[0] + c.v[0] * k, y: c.p[1] + c.v[1] * k };
    if (ch) ring.push(before, after);
    else {
      const cx = before.x + c.v[0] * k;
      const cy = before.y + c.v[1] * k;
      const dx = c.p[0] - cx;
      const dy = c.p[1] - cy;
      const l = Math.hypot(dx, dy);
      ring.push({ ...before, mid: [cx + (dx / l) * k, cy + (dy / l) * k] }, after);
    }
  }
  return ring;
}

/** Points of a circle in KiCad local millimeters. */
const disk = (cx: number, cy: number, r: number, n = 32): [number, number][] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as [number, number]);
/** A thick segment (rounded ends) as a polygon. */
function stadium(a: [number, number], b: [number, number], w: number): [number, number][] {
  const r = w / 2;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const pts: [number, number][] = [];
  // the cap around b, then the cap around a
  for (let i = 0; i <= 8; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / 8;
    pts.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / 8;
    pts.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
  }
  return pts;
}
/** A cubic Bezier as points (16 steps). */
function bezier(p: [number, number][], steps = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
      u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
    ]);
  }
  return out;
}

/** A `(pts ...)` list as a ring: `xy` points and `arc` items (start, mid, end). */
function ptsRing(pts: SList | undefined): KRing {
  const ring: KRing = [];
  for (const c of pts?.slice(1) ?? []) {
    if (!isList(c)) continue;
    if (c[0] === "xy") {
      const p = xyOf(c);
      if (p) ring.push({ x: p[0], y: p[1] });
    } else if (c[0] === "arc") {
      const s = xyOf(kid(c, "start"));
      const m = xyOf(kid(c, "mid"));
      const e = xyOf(kid(c, "end"));
      if (s && m && e) ring.push({ x: s[0], y: s[1], mid: m }, { x: e[0], y: e[1] });
    }
  }
  return ring;
}
/** A ring as plain points (arcs tessellated), for polygon unions. */
function ringPoints(ring: KRing): { pts: [number, number][]; arcs: boolean } {
  const out: [number, number][] = [];
  let arcs = false;
  const MAP: Map2 = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  ring.forEach((v, i) => {
    out.push([v.x, v.y]);
    if (v.mid) {
      arcs = true;
      const n = ring[(i + 1) % ring.length];
      const vs = ringToVertices([v, n], MAP);
      const t = tessellate([{ ...vs[0] }, { x: n.x * 1e6, y: n.y * 1e6 }], 5);
      for (const p of t.slice(1, -1)) out.push([p.x / 1e6, p.y / 1e6]);
    }
  });
  return { pts: out, arcs };
}

interface FpCtx {
  side: Side;
  /** KiCad footprint angle, degrees. */
  theta: number;
  /** KiCad local millimeters to the footprint frame. */
  loc: Map2;
  /** A KiCad absolute angle (degrees) to a rotation in the footprint frame (millidegrees). */
  relRot: (a: number) => number;
  ref: string;
  src: string;
}

export function importKicadPcb(text: string, options: KicadImportOptions = {}): BoardImportResult {
  const t0 = performance.now();
  const rep = new Reporter();
  const root = parseSexpr(text);
  if (root[0] !== "kicad_pcb") throw new Error(`not a KiCad board: the file starts with (${String(root[0])} ...)`);
  const version = val(root, "version") ?? "";
  rep.info("KiCad board file", `format ${version || "unknown"}${version && Number(version) < 20221018 ? " (older than KiCad 7: read as best effort)" : ""}`);
  const layers = new KicadLayers(root);
  const copper = layers.copper;
  {
    // KiCad identifies items by UUID: two items with one UUID are reported by its DRC as one item
    const seen = new Set<string>();
    let dup = 0;
    for (const m of text.matchAll(/\(uuid\s+"?([0-9A-Fa-f-]{8,})"?\s*\)/g)) {
      if (seen.has(m[1])) dup++;
      else seen.add(m[1]);
    }
    if (dup) rep.info("item sharing its UUID with another", "both are imported; KiCad identifies items by UUID and its DRC reports such a pair as one item, so a KiCad cross-check can show the other as ours only", { count: dup });
  }
  const at = (l: SList | undefined) => `line ${l?.line ?? "?"}`;

  // ---- nets: KiCad 9 and earlier number them in a header table; KiCad 10 writes names
  const headerNets = new Map<string, string>();
  for (const e of kids(root, "net")) if (e.length >= 3) headerNets.set(str(e[1]) ?? "", str(e[2]) ?? "");
  const usedNets = new Set<string>();
  for (const n of headerNets.values()) if (n) usedNets.add(n);
  const netOf = (e: SList): string | undefined => {
    const named = kid(e, "net_name");
    let name: string | undefined;
    if (named) name = str(named[1]);
    else {
      const ne = kid(e, "net");
      if (!ne) return undefined;
      if (ne.length >= 3) name = str(ne[2]);
      else {
        const v = str(ne[1]);
        name = headerNets.size && v !== undefined && headerNets.has(v) ? headerNets.get(v) : headerNets.size && /^\d+$/.test(v ?? "") ? "" : v;
      }
    }
    if (!name) return undefined;
    usedNets.add(name);
    return name;
  };

  // ---- board and stackup
  const thicknessMm = numOf(kid(root, "general"), "thickness");
  if (thicknessMm === undefined) rep.approximated("board thickness", "absent from the file; 1.6 mm (KiCad's default) used");
  const board: BoardRec = { kind: "board", id: "board", name: clip(options.name ?? "imported board", 120), thickness: mm(thicknessMm ?? 1.6), copper_layers: Math.max(1, copper.length), origin: "center", provenance: PROV };
  const draft: Draft = emptyDraft(board);
  readStackup(kid(kid(root, "setup"), "stackup"), layers, draft.layers, rep);

  // ---- outline edges (world), filled by board graphics and footprints
  const edges: Edge[] = [];
  const closedLoops: { contour: Vertex[]; source: string }[] = [];

  const fpRefs = new Set<string>();
  /** Pad ids by the pad's KiCad UUID: KiCad treats pads sharing one as one item. */
  const padsByUuid = new Map<string, string[]>();
  const pins = new Map<string, Set<string>>();
  const addPin = (net: string, pin: string) => {
    const s = pins.get(net) ?? new Set<string>();
    s.add(pin);
    pins.set(net, s);
  };

  // ---- top-level items
  for (const e of root.slice(1)) {
    if (!isList(e)) continue;
    const h = head(e) ?? "";
    switch (h) {
      case "version":
      case "generator":
      case "generator_version":
      case "general":
      case "paper":
      case "title_block":
      case "layers":
      case "setup":
      case "net":
      case "embedded_fonts":
        break;
      case "footprint":
      case "module":
        readFootprint(e);
        break;
      case "segment":
      case "arc":
        readTrack(e, h === "arc");
        break;
      case "via":
        readVia(e);
        break;
      case "zone":
        readZone(e);
        break;
      case "gr_line":
      case "gr_arc":
      case "gr_circle":
      case "gr_rect":
      case "gr_poly":
      case "gr_curve":
        readBoardGraphic(e, h.slice(3));
        break;
      case "gr_text":
        readBoardText(e);
        break;
      case "gr_text_box":
      case "gr_textbox":
        rep.dropped("text box", "text boxes are not modeled", { source: at(e) });
        break;
      case "dimension":
        rep.dropped("dimension", "dimensions are not modeled", { source: at(e) });
        break;
      case "group":
        rep.info("group", "groups are not modeled; their members are imported on their own", { source: at(e) });
        break;
      case "generated":
        rep.info("generated item (tuning pattern)", "the generator's parameters are not modeled; its copper is imported as tracks", { source: at(e) });
        break;
      case "property":
        rep.dropped("board property", "board properties (text variables) are not modeled", { source: at(e) });
        break;
      case "embedded_files":
        rep.dropped("embedded files block", "embedded files are not modeled", { source: at(e) });
        break;
      default:
        rep.dropped(`${h} item`, "not modeled by the board document", { source: at(e) });
    }
  }

  // ---- outline and cutouts
  readOutline();

  // ---- netlist
  const mapped = mapKicadRules({ project: options.project, dru: options.rules, nets: [...usedNets].sort(), copper, copperOf: (n) => layers.copperOf(n) }, rep);
  draft.netclasses = mapped.netclasses;
  draft.rules = mapped.rules;
  const netlist: Netlist = {
    source: "kicad",
    nets: [...usedNets].sort().map((name) => ({ name, ...(mapped.netClass.get(name) ? { class: mapped.netClass.get(name) } : {}), pins: [...(pins.get(name) ?? [])].sort() })),
  };

  const done = assemble(draft, { netlist, source: "kicad", rep, recenter: options.recenter });
  const signed = (v: number) => (v < 0 ? `- ${-v}` : `+ ${v}`);
  rep.info("board offset", `the board was centered on its outline (offset ${done.offset.x}, ${done.offset.y} nm); KiCad's coordinates are x_mm = (x ${signed(done.offset.x)}) / 1e6, y_mm = -(y ${signed(done.offset.y)}) / 1e6`);
  if (done.stats.arcs) rep.info("track arc", "stored as exact end points and a sweep rounded to 0.001 degree (the center is derived)", { count: done.stats.arcs });
  return { ...done, document: done.document, netlist, report: rep.items(), summary: rep.summary(), rulesNotEvaluated: mapped.notEvaluated, sharedSourceIds: [...padsByUuid.values()].filter((l) => l.length > 1), importer: KICAD_IMPORTER_ID, ms: performance.now() - t0 };

  // ================================================================= readers

  function readTrack(e: SList, isArc: boolean): void {
    const layer = layers.copperOf(val(e, "layer"));
    const s = xyOf(kid(e, "start"));
    const en = xyOf(kid(e, "end"));
    const w = numOf(e, "width");
    if (!layer || !s || !en || !(w! > 0)) {
      rep.dropped(isArc ? "track arc" : "track segment", "no copper layer, end points or width", { source: at(e) });
      return;
    }
    const start = WORLD(s[0], s[1]);
    const end = WORLD(en[0], en[1]);
    const net = netOf(e);
    let sweep: number | undefined;
    if (isArc) {
      const m = xyOf(kid(e, "mid"));
      sweep = m ? arcSweep(start, WORLD(m[0], m[1]), end) : undefined;
      if (sweep === undefined) rep.approximated("track arc", "its three points are collinear or repeat; imported as a straight segment", { source: at(e) });
    }
    draft.tracks.push({ kind: "track", ...(net ? { net } : {}), layer, width: mm(w!), start, end, ...(sweep !== undefined ? { sweep } : {}), ...(flag(e, "locked") ? { locked: true as const } : {}), provenance: PROV });
  }

  function readVia(e: SList): void {
    const p = xyOf(kid(e, "at"));
    const size = numOf(e, "size");
    const drill = numOf(e, "drill");
    if (!p || !(size! > 0) || !(drill! > 0)) {
      rep.dropped("via", "no position, size or drill", { source: at(e) });
      return;
    }
    const ls = layers.expand(atomsOf(e, "layers")).map((n) => layers.copperOf(n)).filter((x): x is CopperLayer => !!x);
    const order = (l: CopperLayer) => copper.indexOf(l);
    const sorted = ls.length >= 2 ? [...ls].sort((a, b) => order(a) - order(b)) : [copper[0], copper[copper.length - 1]];
    const from = sorted[0];
    const to = sorted[sorted.length - 1];
    const typeAtom = str(e[1]);
    const kind = typeAtom === "micro" || val(e, "type") === "micro" ? "micro" : from === copper[0] && to === copper[copper.length - 1] ? "through" : from === copper[0] || to === copper[copper.length - 1] ? "blind" : "buried";
    rep.info(`${kind} via`, "imported", { count: 1 });
    if (kid(e, "padstack")) rep.approximated("via padstack", "per-layer via sizes are not modeled; the via's main size is used", { source: at(e) });
    let tented: "both" | "top" | "bottom" | "none" | undefined;
    const t = kid(e, "tenting");
    if (t) {
      const front = t.includes("front") || val(t, "front") === "yes";
      const back = t.includes("back") || val(t, "back") === "yes";
      tented = front && back ? "both" : front ? "top" : back ? "bottom" : "none";
    }
    const net = netOf(e);
    draft.vias.push({ kind: "via", ...(net ? { net } : {}), ...WORLD(p[0], p[1]), outer_diameter: mm(size!), hole_diameter: mm(drill!), from_layer: from, to_layer: to, ...(tented ? { tented } : {}), ...(flag(e, "locked") ? { locked: true as const } : {}), provenance: PROV });
  }

  function readZone(e: SList, footprintId?: string): void {
    const src = at(e);
    const zl = layers.copperLayersOf(e);
    const polys = kids(e, "polygon");
    if (!polys.length) {
      rep.dropped("zone", "no outline polygon", { source: src });
      return;
    }
    const outline = validContour(ccwContour(ringToVertices(ptsRing(kid(polys[0], "pts")), WORLD)));
    if (!outline) {
      rep.dropped("zone", "its outline has fewer than three points", { source: src });
      return;
    }
    // KiCad writes a zone's holes (a ring-shaped area) as the polygons after the first: each is a hole in it
    const holes: Vertex[][] = [];
    if (polys.length > 1) {
      const outerPts = tessellate(outline);
      for (const p of polys.slice(1)) {
        const h = validContour(ringToVertices(ptsRing(kid(p, "pts")), WORLD));
        if (!h) {
          rep.dropped("zone hole", "fewer than three points", { source: src });
          continue;
        }
        if (!tessellate(h).every((q) => pointInPolygon(q, outerPts))) {
          rep.dropped("zone hole", "not inside the zone's outline; KiCad reads the polygons after the first as holes, so it removes nothing there", { source: src });
          continue;
        }
        // a hole runs clockwise
        holes.push(reverseContour(ccwContour(h)));
      }
      if (holes.length) rep.info("zone or rule area with holes", "imported with its holes", { count: 1 });
    }
    const holed = holes.length ? { holes } : {};
    const keep = kid(e, "keepout");
    const placement = kid(e, "placement");
    const locked = flag(e, "locked") ? { locked: true as const } : {};
    const name = val(e, "name");
    if (name && name.length > 120) rep.approximated("zone name", "cut to 120 characters", { source: src });
    const named = name ? { name: clip(name, 120) } : {};
    if (keep || placement) {
      // a rule area
      if (!zl.length) {
        rep.dropped("rule area", "on no copper layer", { source: src });
        return;
      }
      const not = (k: string) => val(keep, k) === "not_allowed";
      const blocks = { tracks: not("tracks"), vias: not("vias"), pours: not("copperpour"), footprints: not("footprints") };
      if (not("pads")) rep.approximated("rule area blocking pads", "a keep-out cannot block pads alone; its other blocks are kept", { source: src });
      if (placement && val(placement, "enabled") === "yes") rep.dropped("placement rule area setting", "placement rule areas (sheet or class placement) are not modeled", { source: src });
      const any = blocks.tracks || blocks.vias || blocks.pours || blocks.footprints;
      if (!any) rep.info("rule area that blocks nothing", "kept as a policy keep-out (KiCad uses such areas in custom rules)", { source: src });
      const k: Omit<KeepoutRec, "id"> = { kind: "keepout", outline, ...holed, layers: zl, blocks, tier: any ? "no_go" : "policy", ...(footprintId ? { footprint: footprintId } : {}), ...named, ...locked, provenance: PROV };
      draft.keepouts.push(k);
      return;
    }
    if (!zl.length) {
      rep.dropped("zone", "on no copper layer", { source: src });
      return;
    }
    const net = netOf(e);
    const cp = kid(e, "connect_pads");
    const mode = str(cp?.[1]);
    const pad_connection = mode === "yes" || mode === "full" ? "solid" : mode === "no" ? "none" : "thermal";
    if (mode === "thru_hole_only") rep.approximated("zone pad connection", "thermal reliefs for through-hole pads only (solid for SMD) is not modeled; thermal used", { source: src });
    const fillE = kid(e, "fill");
    const hatch = val(fillE, "mode") === "hatch";
    const clearance = numOf(cp, "clearance");
    const minW = numOf(e, "min_thickness");
    const gap = numOf(fillE, "thermal_gap");
    const spoke = numOf(fillE, "thermal_bridge_width");
    const islandMode = numOf(fillE, "island_removal_mode") ?? 0;
    const islandArea = numOf(fillE, "island_area_min");
    if (val(fillE, "smoothing") && val(fillE, "smoothing") !== "none") rep.approximated("zone corner smoothing", "chamfered or filleted zone corners are not modeled; the corners stay sharp", { source: src });
    if (hatch && (kid(fillE, "hatch_orientation") && numOf(fillE, "hatch_orientation") !== 0)) rep.approximated("zone hatch orientation", "the hatch angle is not modeled", { source: src });
    const priority = numOf(e, "priority") ?? 0;
    if (priority > 1000) rep.approximated("zone priority", "above 1000; clamped to 1000", { source: src });
    if (kid(e, "attr") && kid(kid(e, "attr"), "teardrop")) rep.info("teardrop zone", "imported as a zone", { source: src });
    if (footprintId) rep.info("zone inside a footprint", "imported as a board zone", { source: src });
    const rec: Omit<ZoneRec, "id"> = {
      kind: "zone",
      ...(net ? { net } : {}),
      layers: zl,
      outline,
      ...holed,
      priority: Math.min(1000, Math.max(0, Math.round(priority))),
      ...(clearance !== undefined ? { clearance: mm(clearance) } : {}),
      ...(minW! > 0 ? { min_width: mm(minW!) } : {}),
      pad_connection,
      ...(gap! > 0 ? { thermal_gap: mm(gap!) } : {}),
      ...(spoke! > 0 ? { thermal_spoke_width: mm(spoke!) } : {}),
      fill_mode: hatch ? "hatch" : "solid",
      ...(hatch && numOf(fillE, "hatch_thickness")! > 0 ? { hatch_width: mm(numOf(fillE, "hatch_thickness")!) } : {}),
      ...(hatch && numOf(fillE, "hatch_gap")! > 0 ? { hatch_gap: mm(numOf(fillE, "hatch_gap")!) } : {}),
      remove_islands: islandMode === 1 ? "never" : islandMode === 2 ? "below_area" : "always",
      ...(islandMode === 2 && islandArea! > 0 ? { island_min_area: Math.round(islandArea! * 1e12) } : {}),
      ...named,
      ...locked,
      provenance: PROV,
    };
    // the saved fill: one entry per layer
    const byLayer = new Map<CopperLayer, FillEntry["polygons"]>();
    for (const fp of kids(e, "filled_polygon")) {
      const l = layers.copperOf(val(fp, "layer"));
      if (!l) continue;
      const pts = ringToVertices(ptsRing(kid(fp, "pts")), WORLD);
      if (pts.length < 3) continue;
      const list = byLayer.get(l) ?? [];
      list.push(unfracture(pts.some((v) => v.sweep !== undefined) ? tessellate(pts).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) : pts));
      byLayer.set(l, list);
    }
    const uuid = val(e, "uuid") ?? val(e, "tstamp") ?? src;
    draft.zones.push({ rec, fills: [...byLayer.entries()].map(([layer, polygons]) => ({ source: uuid, ...(net ? { net } : {}), layer, polygons })) });
  }

  /** A graphic shape (line, arc, circle, rect, poly, curve) through a point map; undefined when degenerate. */
  function shapeOf(e: SList, kind: string, map: Map2, src: string): Omit<FootprintGraphic, "layer"> | undefined {
    const stroke = kid(e, "stroke");
    const sw = mm(numOf(stroke, "width") ?? numOf(e, "width") ?? 0);
    const stroke_width = sw > 0 ? sw : 0;
    const fe = kid(e, "fill");
    const fv = str(fe?.[1]) ?? (isList(fe?.[1]) ? str((fe![1] as SList)[1]) : undefined);
    const hatched = fv === "hatch" || fv === "reverse_hatch" || fv === "cross_hatch";
    if (hatched) rep.approximated("hatched graphic fill", "drawn as a solid fill", { source: src });
    const filled = fv === "yes" || fv === "solid" || fv === "true" || hatched ? { filled: true as const } : {};
    const P = (l: SList | undefined) => {
      const p = xyOf(l);
      return p ? map(p[0], p[1]) : undefined;
    };
    if (kind === "line") {
      const a = P(kid(e, "start"));
      const b = P(kid(e, "end"));
      return a && b ? { shape: "line", start: a, end: b, stroke_width } : undefined;
    }
    if (kind === "arc") {
      const a = P(kid(e, "start"));
      const m = P(kid(e, "mid"));
      const b = P(kid(e, "end"));
      if (!a || !b) return undefined;
      if (!m) {
        rep.dropped("arc graphic", "no mid point (a KiCad 5 arc)", { source: src });
        return undefined;
      }
      const sweep = arcSweep(a, m, b);
      if (sweep === undefined) {
        rep.approximated("arc graphic", "collinear points; imported as a line", { source: src });
        return { shape: "line", start: a, end: b, stroke_width };
      }
      return { shape: "arc", start: a, end: b, sweep, stroke_width };
    }
    if (kind === "circle") {
      const c = P(kid(e, "center"));
      const b = P(kid(e, "end"));
      if (!c || !b) return undefined;
      const radius = Math.round(Math.hypot(b.x - c.x, b.y - c.y));
      return radius > 0 ? { shape: "circle", center: c, radius, stroke_width, ...filled } : undefined;
    }
    if (kind === "rect") {
      const a = P(kid(e, "start"));
      const b = P(kid(e, "end"));
      if (!a || !b) return undefined;
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      if (numOf(e, "radius")! > 0) rep.approximated("rounded rectangle graphic", "the corner radius is not modeled", { source: src });
      if (!width || !height) return { shape: "line", start: a, end: b, stroke_width };
      return { shape: "rect", center: { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }, width, height, stroke_width, ...filled };
    }
    if (kind === "poly") {
      const pts = ringToVertices(ptsRing(kid(e, "pts")), map);
      return pts.length >= 2 ? { shape: "polygon", points: pts, stroke_width, ...filled } : undefined;
    }
    if (kind === "curve") {
      const cp = (kid(e, "pts")?.slice(1) ?? []).filter(isList).map((x) => xyOf(x)).filter((x): x is [number, number] => !!x);
      if (cp.length !== 4) return undefined;
      rep.approximated("Bezier curve", "drawn as a path of 16 straight steps", { source: src });
      return { shape: "path", points: bezier(cp).map(([x, y]) => map(x, y)), stroke_width };
    }
    return undefined;
  }

  /** Text effects to the text fields shared by board and footprint texts. */
  function textFields(e: SList, src: string): { height: number; stroke_width?: number; anchor?: "left" | "right"; mirrored: boolean; hidden: boolean } {
    const eff = kid(e, "effects");
    const font = kid(eff, "font");
    const size = kid(font, "size");
    let h = num(size?.[1]);
    if (!(h > 0)) {
      rep.approximated("text without a size", "1 mm used", { source: src });
      h = 1;
    }
    const th = numOf(font, "thickness");
    const just = kid(eff, "justify") ?? [];
    const hidden = flag(e, "hide") || (eff ? flag(eff, "hide") : false);
    return { height: mm(h), ...(th! > 0 ? { stroke_width: mm(th!) } : {}), ...(just.includes("left") ? { anchor: "left" as const } : just.includes("right") ? { anchor: "right" as const } : {}), mirrored: just.includes("mirror"), hidden };
  }

  function readBoardGraphic(e: SList, kind: string): void {
    const src = at(e);
    const lname = val(e, "layer");
    if (lname === "Edge.Cuts") {
      addEdge(shapeOf(e, kind, WORLD, src), src);
      return;
    }
    const l = layers.layerOf(lname);
    if (!l) {
      rep.dropped("board graphic", `on layer ${lname ?? "(none)"}, which has no home in the board document`, { source: src });
      return;
    }
    if (l.user) rep.approximated("graphic on a KiCad user layer", "drawn on user_notes", { source: src });
    const g = shapeOf(e, kind, WORLD, src);
    if (!g) {
      rep.dropped("board graphic", "degenerate (missing points or zero size)", { source: src });
      return;
    }
    draft.graphics.push({ kind: "graphic", layer: l.layer, ...g, ...(flag(e, "locked") ? { locked: true as const } : {}), provenance: PROV } as Omit<GraphicRec, "id">);
  }

  function readBoardText(e: SList): void {
    const src = at(e);
    const text = str(e[1]) ?? "";
    const l = layers.layerOf(val(e, "layer"));
    const p = kid(e, "at");
    const xy = xyOf(p);
    if (!text || !l || !xy) {
      rep.dropped("board text", !text ? "empty" : !l ? "on a layer with no home in the board document" : "no position", { source: src });
      return;
    }
    if (l.user) rep.approximated("text on a KiCad user layer", "drawn on user_notes", { source: src });
    const f = textFields(e, src);
    if (f.hidden) {
      rep.dropped("hidden board text", "hidden texts are not modeled", { source: src });
      return;
    }
    if (text.length > 500) rep.approximated("board text", "cut to 500 characters", { source: src });
    const rotation = normAngle(deg(num(p![3]) || 0));
    const rec: Omit<TextRec, "id"> = { kind: "text", layer: l.layer, text: clip(text, 500), ...WORLD(xy[0], xy[1]), height: f.height, ...(f.stroke_width ? { stroke_width: f.stroke_width } : {}), ...(rotation ? { rotation } : {}), ...(f.anchor ? { anchor: f.anchor } : {}), ...(f.mirrored ? { mirrored: true as const } : {}), ...(flag(e, "locked") ? { locked: true as const } : {}), provenance: PROV };
    draft.texts.push(rec);
  }

  /** An Edge.Cuts shape (world) into the outline's edges or closed loops. */
  function addEdge(g: Omit<FootprintGraphic, "layer"> | undefined, src: string): void {
    if (!g) {
      rep.dropped("Edge.Cuts item", "degenerate", { source: src });
      return;
    }
    if (g.shape === "line") edges.push({ a: g.start!, b: g.end!, source: src });
    else if (g.shape === "arc") edges.push({ a: g.start!, b: g.end!, sweep: g.sweep, source: src });
    else if (g.shape === "circle") closedLoops.push({ contour: circleContour(g.center!.x, g.center!.y, g.radius!), source: src });
    else if (g.shape === "rect") {
      const { x, y } = g.center!;
      const w = g.width! / 2;
      const h = g.height! / 2;
      closedLoops.push({ contour: [{ x: x - w, y: y - h }, { x: x + w, y: y - h }, { x: x + w, y: y + h }, { x: x - w, y: y + h }].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), source: src });
    } else if (g.shape === "polygon") {
      const c = validContour(dedupeContour(g.points!));
      if (c) closedLoops.push({ contour: c, source: src });
      else rep.dropped("Edge.Cuts polygon", "fewer than three points", { source: src });
    } else if (g.shape === "path") {
      const pts = g.points!;
      for (let i = 0; i + 1 < pts.length; i++) edges.push({ a: pts[i], b: pts[i + 1], source: src });
    }
  }

  function readOutline(): void {
    const tol = options.tolerance ?? 1000;
    const j = joinEdges(edges, tol);
    if (j.gaps) rep.approximated("Edge.Cuts joint", `end points up to ${Math.round(j.maxGap)} nm apart joined`, { count: j.gaps });
    for (const chain of j.open) rep.dropped("Edge.Cuts chain", `${chain.length} edge(s) that do not close into a loop`, { source: chain[0]?.source });
    const loops = [...closedLoops.map((l) => ({ contour: l.contour, sources: [l.source] })), ...j.loops]
      .map((l) => ({ contour: validContour(l.contour), sources: l.sources }))
      .filter((l): l is { contour: Vertex[]; sources: string[] } => !!l.contour)
      .map((l) => ({ ...l, poly: tessellate(l.contour) }))
      .map((l) => ({ ...l, area: Math.abs(polygonArea(l.poly)) }))
      .sort((a, b) => b.area - a.area);
    if (!loops.length) {
      rep.dropped("board outline", "no closed Edge.Cuts outline found");
      return;
    }
    const outer = loops[0];
    draft.outline = { kind: "outline", id: "outline", outline: ccwContour(outer.contour), source: { kind: "board" }, provenance: PROV };
    for (const l of loops.slice(1)) {
      if (pointInPolygon(l.poly[0], outer.poly)) draft.cutouts.push({ kind: "cutout", outline: ccwContour(l.contour), provenance: PROV });
      else rep.dropped("Edge.Cuts loop outside the board outline", "a board has one outline; a second board region is not modeled", { source: l.sources[0] });
    }
  }

  function readFootprint(e: SList): void {
    const src = at(e);
    const lib = str(e[1]) ?? "unknown";
    const fileSide: Side = val(e, "layer") === "B.Cu" ? "bottom" : "top";
    // A footprint whose SMD pads all sit on the other side (tscircuit's exporter writes bottom parts that way) is
    // imported on the side of its pads; every point keeps its KiCad position.
    let own = 0;
    let other = 0;
    for (const p of kids(e, "pad")) {
      if (str(p[2]) !== "smd" && str(p[2]) !== "connect") continue;
      const cu = layers.expand(atomsOf(p, "layers"));
      if (cu.includes(fileSide === "top" ? "F.Cu" : "B.Cu")) own++;
      else if (cu.includes(fileSide === "top" ? "B.Cu" : "F.Cu")) other++;
    }
    const side: Side = other > 0 && own === 0 ? (fileSide === "top" ? "bottom" : "top") : fileSide;
    if (side !== fileSide) rep.approximated("footprint with all its SMD pads on the other side", `imported as a ${side} footprint (every point keeps its position; the footprint's own side flips)`, { source: src });
    const atE = kid(e, "at");
    const [fx, fy] = xyOf(atE) ?? [0, 0];
    const theta = num(atE?.[3]) || 0;
    const loc = mapWith(side === "top" ? -1 : 1);
    const relRot = (a: number) => normAngle(side === "bottom" ? deg(theta) + 180_000 - deg(a) : deg(a) - deg(theta));
    const props = kids(e, "property");
    const prop = (name: string) => props.find((p) => str(p[1]) === name);
    const fpText = (type: string) => kids(e, "fp_text").find((t) => str(t[1]) === type);
    const rawRef = str(prop("Reference")?.[2]) ?? str(fpText("reference")?.[2]) ?? "";
    let ref = rawRef.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z]/.test(ref)) ref = `X${ref}`;
    const baseRef = ref;
    for (let n = 2; fpRefs.has(ref); n++) ref = `${baseRef}_${n}`;
    fpRefs.add(ref);
    if (ref !== rawRef) rep.approximated("footprint reference renamed", "references are letters, digits and _ and unique on the board", { source: `${rawRef || "(empty)"} -> ${ref}` });
    const id = `fp:${ref}`;
    const ctx: FpCtx = { side, theta, loc, relRot, ref, src };
    const value = str(prop("Value")?.[2]) ?? str(fpText("value")?.[2]);
    let supplier: string | undefined;
    for (const p of props) {
      const n = str(p[1]) ?? "";
      const v = (str(p[2]) ?? "").trim();
      if (/lcsc|jlc|supplier/i.test(n) && /^C\d+$/.test(v)) supplier = v;
    }
    const pads: Pad[] = [];
    const padUuids: (string | undefined)[] = [];
    const graphics: FootprintGraphic[] = [];
    const texts: FootprintText[] = [];
    const courtyardEdges: Edge[] = [];
    const courtyardLoops: Vertex[][] = [];
    const fpEdgeShapes: Omit<FootprintGraphic, "layer">[] = [];
    let hiddenTexts = 0;
    let hiddenProps = 0;
    let uprighted = 0;
    const zones: SList[] = [];

    const addText = (t: SList, text: string, role: FootprintText["role"]) => {
      const tsrc = at(t);
      const l = layers.layerOf(val(t, "layer"));
      const p = kid(t, "at");
      const xy = xyOf(p);
      if (!text || !l || !xy) return;
      const f = textFields(t, tsrc);
      if (f.hidden) {
        if (role === "user" && head(t) === "property") hiddenProps++;
        else hiddenTexts++;
        return;
      }
      // the file's angle is the text's angle on the board (checked against kicad-cli SVG output, KiCad 10, locked and
      // unlocked texts alike); KiCad shows footprint text upright, so an angle in (90, 270] degrees reads as 180 less
      const shown = uprightAngle(num(p![3]) || 0);
      if (shown !== normAngle(deg(num(p![3]) || 0))) uprighted++;
      const rotation = relRot(shown / 1000);
      const pos = loc(xy[0], xy[1]);
      texts.push({ layer: sideLayer(l.layer, side), text: clip(text, 500), x: pos.x, y: pos.y, height: f.height, ...(f.stroke_width ? { stroke_width: f.stroke_width } : {}), ...(rotation ? { rotation } : {}), ...(f.anchor ? { anchor: f.anchor } : {}), ...(role ? { role } : {}) });
    };

    for (const c of e.slice(1)) {
      if (!isList(c)) continue;
      const h = head(c) ?? "";
      if (h === "property") {
        const name = str(c[1]);
        const role = name === "Reference" ? "ref" : name === "Value" ? "value" : "user";
        addText(c, role === "ref" ? ref : str(c[2]) ?? "", role);
      } else if (h === "fp_text") {
        const type = str(c[1]);
        const t = str(c[2]) ?? "";
        addText(c, type === "reference" ? ref : t, type === "reference" || t === "${REFERENCE}" ? "ref" : type === "value" || t === "${VALUE}" ? "value" : "user");
      } else if (h === "fp_text_box" || h === "fp_textbox") rep.dropped("footprint text box", "text boxes are not modeled", { source: at(c) });
      else if (/^fp_(line|arc|circle|rect|poly|curve)$/.test(h)) {
        const kind = h.slice(3);
        const lname = val(c, "layer");
        const gs = shapeOf(c, kind, loc, at(c));
        if (lname === "Edge.Cuts") {
          if (gs) fpEdgeShapes.push(gs);
          continue;
        }
        const l = layers.layerOf(lname);
        if (!l) {
          rep.dropped("footprint graphic", `on layer ${lname ?? "(none)"}, which has no home in the board document`, { source: at(c) });
          continue;
        }
        if (!gs) {
          rep.dropped("footprint graphic", "degenerate (missing points or zero size)", { source: at(c) });
          continue;
        }
        if (l.user) rep.approximated("footprint graphic on a KiCad user layer", "drawn on user_notes", { source: at(c) });
        const layer = sideLayer(l.layer, side);
        graphics.push({ layer, ...gs });
        if (layer === "top_courtyard") {
          if (gs.shape === "line") courtyardEdges.push({ a: gs.start!, b: gs.end! });
          else if (gs.shape === "arc") courtyardEdges.push({ a: gs.start!, b: gs.end!, sweep: gs.sweep });
          else if (gs.shape === "circle") courtyardLoops.push(circleContour(gs.center!.x, gs.center!.y, gs.radius!));
          else if (gs.shape === "rect") {
            const { x, y } = gs.center!;
            const w = gs.width! / 2;
            const hh = gs.height! / 2;
            courtyardLoops.push([{ x: x - w, y: y - hh }, { x: x + w, y: y - hh }, { x: x + w, y: y + hh }, { x: x - w, y: y + hh }].map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));
          } else if (gs.shape === "polygon" && gs.points!.length >= 3) courtyardLoops.push(gs.points!);
        }
      } else if (h === "pad") {
        const r = readPad(c, ctx);
        if (r) {
          pads.push(r.pad);
          padUuids.push(val(c, "uuid") ?? val(c, "tstamp"));
          if (r.net) addPin(r.net, `${ref}.${r.pad.number}`);
        }
      } else if (h === "zone") zones.push(c);
      else if (h === "model") rep.dropped("3D model reference", "3D models are not modeled by the board document", { source: at(c) });
      else if (h === "attr") {
        const a = c.slice(1).filter((x) => typeof x === "string") as string[];
        const extra = a.filter((x) => !["smd", "through_hole"].includes(x));
        if (extra.length) rep.dropped("footprint attribute", `${extra.join(", ")} not modeled`, { source: at(c) });
      } else if (h === "group") rep.info("group inside a footprint", "not modeled", { source: at(c) });
      else if (h === "dimension") rep.dropped("dimension", "dimensions are not modeled", { source: at(c) });
      else if (["solder_mask_margin", "solder_paste_margin", "solder_paste_ratio", "solder_paste_margin_ratio", "clearance", "zone_connect", "thermal_width", "thermal_gap"].includes(h)) rep.dropped("footprint-wide pad setting", `${h} is not modeled (pads keep their own values)`, { source: at(c) });
      else if (h === "net_tie_pad_groups") rep.dropped("net tie pad group", "net ties are not modeled", { source: at(c) });
    }
    if (uprighted) rep.info("footprint text turned upright", "stored at the angle KiCad shows it (KiCad keeps footprint text readable; angles over 90 and up to 270 degrees turn by 180)", { count: uprighted, source: src });
    if (hiddenTexts) rep.dropped("hidden footprint text", "hidden texts are not modeled (the reference and value stay in the footprint's fields)", { count: hiddenTexts, source: src });
    if (hiddenProps) rep.dropped("hidden footprint property", "footprint properties other than the reference, value and supplier part are not modeled", { count: hiddenProps, source: src });

    let courtyard: Vertex[] | undefined;
    const cj = joinEdges(courtyardEdges, 1000);
    const cloops = [...courtyardLoops, ...cj.loops.map((l) => l.contour)].map((c) => validContour(c)).filter((c): c is Vertex[] => !!c);
    if (cloops.length) {
      cloops.sort((a, b) => Math.abs(polygonArea(tessellate(b))) - Math.abs(polygonArea(tessellate(a))));
      courtyard = ccwContour(cloops[0]);
      if (cloops.length > 1) rep.approximated("courtyard with several loops", "the largest is the footprint's courtyard (all stay as graphics)", { source: src });
    }

    const fp: FootprintRec = {
      kind: "footprint",
      id,
      ref,
      footprint: clip(lib, 200),
      ...(value ? { value: clip(value, 200) } : {}),
      ...(supplier ? { supplier_part: supplier } : {}),
      ...WORLD(fx, fy),
      rotation: normAngle(deg(theta) + (side === "bottom" ? 180_000 : 0)),
      side,
      pads,
      ...(courtyard ? { courtyard } : {}),
      ...(graphics.length ? { graphics: graphics.slice(0, 5000) } : {}),
      ...(texts.length ? { texts: texts.slice(0, 100) } : {}),
      ...(flag(e, "locked") ? { locked: true as const } : {}),
      provenance: PROV,
    };
    if (graphics.length > 5000) rep.dropped("footprint graphic", "more than 5000 in one footprint", { count: graphics.length - 5000, source: src });
    if (texts.length > 100) rep.dropped("footprint text", "more than 100 in one footprint", { count: texts.length - 100, source: src });
    draft.footprints.push(fp);
    const keys = padKeys(fp);
    padUuids.forEach((u, i) => {
      if (!u) return;
      const l = padsByUuid.get(u) ?? [];
      l.push(padId(footprintKey(fp), keys[i]));
      padsByUuid.set(u, l);
    });
    // footprint Edge.Cuts items join the board outline, in world coordinates
    const toWorld = (p: Point) => {
      const w = footprintToWorld(fp, p);
      return { x: Math.round(w.x), y: Math.round(w.y) };
    };
    for (const g of fpEdgeShapes) {
      const sweep = g.sweep !== undefined && side === "bottom" ? -g.sweep : g.sweep;
      const world: Omit<FootprintGraphic, "layer"> = {
        ...g,
        ...(g.start ? { start: toWorld(g.start) } : {}),
        ...(g.end ? { end: toWorld(g.end) } : {}),
        ...(g.center ? { center: toWorld(g.center) } : {}),
        ...(g.points ? { points: g.points.map((v) => ({ ...toWorld(v), ...(v.sweep !== undefined ? { sweep: side === "bottom" ? -v.sweep : v.sweep } : {}) })) } : {}),
        ...(sweep !== undefined ? { sweep } : {}),
      };
      if (g.shape === "rect") {
        // a rotated rectangle: its corners as a polygon
        const w = g.width! / 2;
        const h = g.height! / 2;
        const c = g.center!;
        world.shape = "polygon";
        world.points = [
          { x: c.x - w, y: c.y - h },
          { x: c.x + w, y: c.y - h },
          { x: c.x + w, y: c.y + h },
          { x: c.x - w, y: c.y + h },
        ].map(toWorld);
        delete world.center;
        delete world.width;
        delete world.height;
      }
      addEdge(world, `${src} (footprint ${ref})`);
    }
    if (fpEdgeShapes.length) rep.info("footprint Edge.Cuts item", "joined into the board outline and cutouts", { count: fpEdgeShapes.length, source: src });
    for (const z of zones) readZone(z, id);
  }

  function readPad(c: SList, f: FpCtx): { pad: Pad; net?: string } | undefined {
    const src = at(c);
    let number = str(c[1]) ?? "";
    const type = str(c[2]);
    const shape = str(c[3]);
    if (!number) number = "_";
    if (/\s/.test(number)) {
      rep.approximated("pad number with spaces", "spaces replaced by _", { source: src });
      number = number.replace(/\s+/g, "_");
    }
    number = clip(number, 40);
    const atE = kid(c, "at");
    const [ax, ay] = xyOf(atE) ?? [0, 0];
    const alpha = num(atE?.[3]) || 0;
    const size = kid(c, "size");
    const w = num(size?.[1]);
    const h = num(size?.[2]);
    const names = layers.expand(atomsOf(c, "layers"));
    const cu = names.filter((n) => layers.copperOf(n));
    const drillE = kid(c, "drill");
    let drill: { w: number; h: number; oval: boolean } | undefined;
    if (drillE) {
      const vals = drillE.slice(1).filter((x): x is string => typeof x === "string" && x !== "oval").map(Number).filter((v) => Number.isFinite(v));
      if (vals.length) drill = { w: vals[0], h: vals[1] ?? vals[0], oval: drillE.includes("oval") && (vals[1] ?? vals[0]) !== vals[0] };
      if (kid(drillE, "offset") && xyOf(kid(drillE, "offset"))?.some((v) => v !== 0)) rep.approximated("pad drill offset", "the hole is placed at the pad center", { source: src });
    }
    const center = f.loc(ax, ay);
    const rotation = f.relRot(alpha);
    const base = { number, x: center.x, y: center.y, ...(rotation ? { rotation } : {}) };
    const mask = numOf(c, "solder_mask_margin");
    const paste = numOf(c, "solder_paste_margin");
    const margins = { ...(mask !== undefined ? { mask_margin: mm(mask) } : {}), ...(paste !== undefined ? { paste_margin: mm(paste) } : {}) };
    if (numOf(c, "solder_paste_margin_ratio") || numOf(c, "solder_paste_ratio")) rep.dropped("pad paste ratio", "only an absolute paste margin is modeled", { source: src });
    if (kid(c, "zone_connect")) rep.dropped("pad zone connection override", "per-pad zone connection is not modeled (the zone's applies)", { source: src });
    if (kid(c, "padstack")) rep.approximated("pad padstack", "per-layer pad shapes are not modeled; the front shape is used", { source: src });
    const pinfn = str(kid(c, "pinfunction")?.[1]);
    const pin = pinfn ? { pin: clip(pinfn, 80) } : {};
    const net = netOf(c);
    const W = mm(w);
    const H = mm(h);

    let kind: Pad["type"];
    let smdSide: "top" | "bottom" = "top";
    if (type === "smd" || type === "connect") {
      kind = "smd";
      if (type === "connect") rep.approximated("connector (edge) pad", "imported as an SMD pad", { source: src });
      const own = f.side === "top" ? "F.Cu" : "B.Cu";
      const other = f.side === "top" ? "B.Cu" : "F.Cu";
      if (!cu.length) {
        rep.dropped("pad without copper", "a paste or mask aperture with no copper is not a pad", { source: src });
        return undefined;
      }
      if (!cu.includes(own) && !cu.includes(other)) {
        rep.dropped("SMD pad on inner copper only", "an SMD pad sits on an outer copper layer", { source: src });
        return undefined;
      }
      // a pad on the other face of its footprint keeps its footprint-frame position with layer "bottom"
      smdSide = cu.includes(own) ? "top" : "bottom";
      if (smdSide === "bottom") rep.info("SMD pad on its footprint's other side", "kept on the opposite side (pad layer bottom in the footprint frame)", { source: src });
      if (cu.length > 1) rep.approximated("SMD pad on several copper layers", "kept on its footprint's side only", { source: src });
      const onTop = (smdSide === "top") === (f.side === "top");
      if (!names.includes(onTop ? "F.Paste" : "B.Paste") && type === "smd") rep.info("SMD pad without a paste opening", "the board document has no field for it", { source: src });
    } else if (type === "thru_hole") kind = "th";
    else if (type === "np_thru_hole") kind = "np";
    else {
      rep.dropped("pad", `type ${type} not known`, { source: src });
      return undefined;
    }
    if ((kind === "th" || kind === "np") && !(drill && drill.w > 0)) {
      rep.dropped("pad", "a hole without a drill size", { source: src });
      return undefined;
    }
    if (!(w > 0) || !(h > 0)) {
      if (kind !== "np") {
        rep.dropped("pad", "no size", { source: src });
        return undefined;
      }
    }
    const hole = kind === "th" ? (drill!.oval ? { hole_width: mm(drill!.w), hole_height: mm(drill!.h) } : { hole_diameter: mm(drill!.w) }) : {};
    const outer = { outer_width: W, outer_height: H };
    const smdOrTh = (shapeFields: Partial<Pad>, thShape?: Partial<Pad>): Pad =>
      (kind === "smd" ? { ...base, type: "smd", layer: smdSide, ...shapeFields, ...margins, ...pin } : { ...base, type: "th", ...(thShape ?? shapeFields), ...hole, ...margins, ...pin }) as Pad;

    if (kind === "np") {
      if (drill!.oval) rep.approximated("non-plated slot", "a non-plated hole has one diameter; the slot's width is used", { source: src });
      return { pad: { ...base, type: "np", shape: "circle", hole_diameter: mm(drill!.w), ...margins } as Pad };
    }

    /** A polygon pad from a ring in pad-local millimeters (before the pad's rotation). */
    const polygonPad = (ring: KRing): Pad | undefined => {
      const ar = alpha - f.theta;
      const toFp: Map2 = (x, y) => {
        const [rx, ry] = rotK(x, y, ar);
        const p = f.loc(ax + rx, ay + ry);
        return { x: p.x - center.x, y: p.y - center.y };
      };
      const points = validContour(ccwContour(ringToVertices(ring, toFp)));
      if (!points) return undefined;
      const { rotation: _r, ...b } = base;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const bw = Math.max(...xs) - Math.min(...xs);
      const bh = Math.max(...ys) - Math.min(...ys);
      if (kind === "smd") return { ...b, type: "smd", shape: "polygon", points, layer: smdSide, ...margins, ...pin } as Pad;
      return { ...b, type: "th", shape: "polygon", points, outer_width: Math.max(1, bw), outer_height: Math.max(1, bh), ...hole, ...margins, ...pin } as Pad;
    };

    let pad: Pad | undefined;
    if (shape === "circle") {
      if (kind === "smd") {
        if (Math.abs(w - h) > 1e-9) rep.approximated("circle pad with unequal size", "the width is the diameter", { source: src });
        pad = smdOrTh({ shape: "circle", radius: Math.round(W / 2) });
      } else if (drill!.oval) {
        rep.approximated("round pad with a slot", "imported as an oval pad of the same size", { source: src });
        pad = smdOrTh({}, { shape: "oval", ...outer });
      } else pad = smdOrTh({}, { shape: "circle", outer_diameter: W });
    } else if (shape === "rect" || shape === "oval") {
      pad = smdOrTh({ shape, width: W, height: H }, { shape, ...outer });
    } else if (shape === "roundrect") {
      const rr = numOf(c, "roundrect_rratio") ?? 0.25;
      const cr = numOf(c, "chamfer_ratio") ?? 0;
      const corners = new Set((kid(c, "chamfer")?.slice(1) ?? []).filter((x): x is string => typeof x === "string"));
      if (cr > 0 && corners.size) {
        pad = polygonPad(cornerRing(w, h, rr * Math.min(w, h), cr * Math.min(w, h), corners));
      } else {
        const corner_radius = Math.round(rr * Math.min(W, H));
        pad = smdOrTh({ shape: "roundrect", width: W, height: H, corner_radius }, { shape: "roundrect", ...outer, corner_radius });
      }
    } else if (shape === "trapezoid") {
      const d = kid(c, "rect_delta");
      const dx = num(d?.[1]) || 0;
      const dy = num(d?.[2]) || 0;
      // corners as KiCad draws them (checked against kicad-cli SVG output, KiCad 10): in its local frame, Y down,
      // delta x makes the left side taller and delta y makes the lower side (+Y) wider
      rep.info("trapezoid pad", "converted to an exact polygon (delta x widens the left side, delta y the lower side, as KiCad draws it)", { source: src });
      pad = polygonPad([
        { x: -(w + dy) / 2, y: (h + dx) / 2 },
        { x: -(w - dy) / 2, y: -(h + dx) / 2 },
        { x: (w - dy) / 2, y: -(h - dx) / 2 },
        { x: (w + dy) / 2, y: (h - dx) / 2 },
      ]);
    } else if (shape === "custom") {
      pad = customPad(c, w, h, polygonPad, src);
    } else {
      rep.dropped("pad", `shape ${shape} not known`, { source: src });
      return undefined;
    }
    if (!pad) {
      rep.dropped("pad", "its shape could not be built", { source: src });
      return undefined;
    }
    return { pad, ...(net ? { net } : {}) };
  }

  /** A custom pad: its anchor (rectangle or circle) united with its primitives, as one polygon. */
  function customPad(c: SList, w: number, h: number, polygonPad: (ring: KRing) => Pad | undefined, src: string): Pad | undefined {
    const anchor = val(kid(c, "options"), "anchor") ?? "rect";
    const geoms: [number, number][][] = [];
    geoms.push(anchor === "circle" ? disk(0, 0, w / 2) : ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as [number, number][]));
    let tess = false;
    for (const p of kid(c, "primitives")?.slice(1) ?? []) {
      if (!isList(p)) continue;
      const ph = head(p);
      const width = numOf(p, "width") ?? numOf(kid(p, "stroke"), "width") ?? 0;
      const filled = ["yes", "solid"].includes(val(p, "fill") ?? "");
      if (ph === "gr_poly") {
        const r = ringPoints(ptsRing(kid(p, "pts")));
        if (r.arcs) tess = true;
        if (width > 0) rep.approximated("custom pad polygon with an outline width", "the outline width is not added", { source: src });
        if (r.pts.length >= 3) geoms.push(r.pts);
      } else if (ph === "gr_rect") {
        const a = xyOf(kid(p, "start"));
        const b = xyOf(kid(p, "end"));
        if (a && b) geoms.push([a, [b[0], a[1]], b, [a[0], b[1]]]);
      } else if (ph === "gr_circle") {
        const cc = xyOf(kid(p, "center"));
        const e = xyOf(kid(p, "end"));
        if (cc && e) {
          tess = true;
          if (!filled && width > 0) rep.approximated("custom pad ring primitive", "drawn as a full disk", { source: src });
          geoms.push(disk(cc[0], cc[1], Math.hypot(e[0] - cc[0], e[1] - cc[1]) + width / 2));
        }
      } else if (ph === "gr_line") {
        const a = xyOf(kid(p, "start"));
        const b = xyOf(kid(p, "end"));
        if (a && b && width > 0) {
          tess = true;
          geoms.push(stadium(a, b, width));
        }
      } else if (ph === "gr_arc") {
        const a = xyOf(kid(p, "start"));
        const m = xyOf(kid(p, "mid"));
        const b = xyOf(kid(p, "end"));
        if (a && m && b && width > 0) {
          tess = true;
          const r = ringPoints([{ x: a[0], y: a[1], mid: m }, { x: b[0], y: b[1] }]).pts;
          const pts: [number, number][] = [...r, b];
          for (let i = 0; i + 1 < pts.length; i++) geoms.push(stadium(pts[i], pts[i + 1], width));
        }
      } else if (ph === "gr_curve") {
        const cp = (kid(p, "pts")?.slice(1) ?? []).filter(isList).map((x) => xyOf(x)).filter((x): x is [number, number] => !!x);
        if (cp.length === 4 && width > 0) {
          tess = true;
          const pts = bezier(cp);
          for (let i = 0; i + 1 < pts.length; i++) geoms.push(stadium(pts[i], pts[i + 1], width));
        }
      } else if (ph !== "gr_bbox" && ph !== "gr_vector") rep.dropped("custom pad primitive", `${ph} not known`, { source: src });
    }
    if (tess) rep.approximated("custom pad with curved primitives", "curves become straight steps of at most 5 degrees", { source: src });
    let ring: [number, number][];
    if (geoms.length === 1) ring = geoms[0];
    else {
      const [first, ...rest] = geoms.map((g): ClipPolygon => [g]);
      const u = polygonClipping.union(first, ...rest);
      if (!u.length) return undefined;
      if (u.length > 1) rep.approximated("custom pad in several pieces", "only the largest piece is kept", { source: src });
      const area = (r: [number, number][]) => Math.abs(polygonArea(r.map(([x, y]) => ({ x, y }))));
      const best = [...u].sort((a, b) => area(b[0]) - area(a[0]))[0];
      if (best.length > 1) rep.approximated("custom pad with holes", "the holes are filled", { source: src });
      ring = best[0].slice(0, -1);
    }
    return polygonPad(ring.map(([x, y]) => ({ x, y })));
  }
}

/** The stackup's copper, dielectric and solder mask layers, top to bottom. */
function readStackup(stack: SList | undefined, layers: KicadLayers, out: LayerRec[], rep: Reporter): void {
  if (!stack) {
    rep.info("stackup", "the file has none; no layer records (the board's copper count stands)");
    return;
  }
  let order = 0;
  let dielectric = 0;
  for (const l of kids(stack, "layer")) {
    const name = str(l[1]) ?? "";
    const type = val(l, "type") ?? "";
    let t = numOf(l, "thickness");
    const sub = kids(l, "addsublayer");
    if (sub.length) {
      t = (t ?? 0) + sub.reduce((s, x) => s + (numOf(x, "thickness") ?? 0), 0);
      rep.approximated("stackup sublayers", "a dielectric's sublayers are summed into one layer with the first material", { source: name });
    }
    const material = val(l, "material");
    const er = numOf(l, "epsilon_r");
    const lt = numOf(l, "loss_tangent");
    const extra = { ...(material && material !== "Not specified" ? { material: material.slice(0, 60) } : {}), ...(er! > 0 ? { epsilon_r: er } : {}), ...(lt! >= 0 && lt !== undefined ? { loss_tangent: lt } : {}) };
    const cu = layers.copperOf(name);
    let ours: string;
    let lt2: LayerRec["type"];
    if (cu) {
      ours = cu;
      lt2 = "copper";
    } else if (/dielectric/i.test(name) || type === "core" || type === "prepreg") {
      dielectric++;
      ours = `${type === "core" ? "core" : type === "prepreg" ? "prepreg" : "dielectric"}${dielectric}`;
      lt2 = "dielectric";
    } else if (name === "F.Mask" || name === "B.Mask") {
      ours = name === "F.Mask" ? "top_mask" : "bottom_mask";
      lt2 = "soldermask";
    } else continue; // silkscreen and paste are not stack layers
    if (!(t! > 0)) {
      rep.dropped("stackup layer", "no thickness", { source: name });
      continue;
    }
    out.push({ kind: "layer", id: `layer:${ours}`, name: ours, type: lt2, order: order++, thickness: mm(t!), ...(lt2 === "copper" ? {} : extra) });
  }
}
