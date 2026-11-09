/**
 * The KiCad board exporter: a board document into a `.kicad_pcb` (KiCad 9 format, which KiCad 9 and 10 open), the
 * `.kicad_pro` beside it (board setup minimums, net classes and their nets, violation severities) and a `.kicad_dru`
 * (the custom rules). Written from KiCad's published file-format documentation and as the inverse of this package's
 * importer (kicad/board.ts, kicad/rules.ts, kicad/condition.ts); no KiCad code.
 *
 * Coordinates: a board point (x, y) in nanometers, +Y up, is the KiCad point x_mm = (x + offset.x) / 1e6,
 * y_mm = -(y + offset.y) / 1e6, written exactly (integer nanometers as decimal millimeters). The offset is the
 * import record's when the board came from a file (so the export lands where the source was), else the board's
 * center goes to (150, 100) mm. Footprint children are written in KiCad's footprint frame, the importer's frame
 * turned back: a top footprint's local Y is negated, a bottom footprint's local numbers are kept and its angle is
 * the document's less 180 degrees; pad and text angles are absolute, as KiCad stores them.
 *
 * Everything the document does not hold, or holds in another form, is in the report (approximated or dropped);
 * nothing is dropped silently.
 */
import {
  arcCenter,
  copperLayers,
  footprintKey,
  netClassOf,
  normAngle,
  padId,
  padKeys,
  padWorldSide,
  recordsOfKind,
  sha1Hex,
  sideLayer,
  type AnyLayer,
  type BoardDocument,
  type CopperLayer,
  type DerivedZoneFill,
  type FootprintGraphic,
  type FootprintRec,
  type FootprintText,
  type KeepoutRec,
  type LayerRec,
  type NetclassRec,
  type Pad,
  type Point,
  type RuleCondition,
  type RuleRec,
  type Vertex,
  type ZoneFillEntry,
  type ZoneRec,
} from "@protoboardai/board";
import { arcSweep, pointInPolygon } from "../geom.js";
import { KICAD_DEFAULT_SEVERITY, KICAD_VIOLATION_TYPE } from "./rules.js";

/** The record kinds the exporter writes (any other kind is reported as not written). */
const EXPORTED_KINDS = new Set<string>(["board", "layer", "outline", "cutout", "footprint", "track", "via", "zone", "keepout", "graphic", "text", "netclass", "rule"]);

/** The KiCad file format version written (KiCad 9; KiCad 10 opens it). */
export const KICAD_EXPORT_VERSION = 20241229;
/** Where a board without an import record offset is centered in KiCad, millimeters. */
export const KICAD_EXPORT_DEFAULT_CENTER = { x: 150, y: 100 } as const;

export interface KicadExportOptions {
  /** A board point plus this is the KiCad point (nanometers, +Y up): the import record's offset. Default: the board's center at (150, 100) mm. */
  offset?: { x: number; y: number };
  /** The zone fill to write into the zones (the board's derived fill); without it zones are written unfilled. */
  fills?: DerivedZoneFill | readonly ZoneFillEntry[];
  /** The file's base name (the project's file name and the title); default: the board's name. */
  name?: string;
  /** Source rules the import could not express (the import record's `rulesNotEvaluated`): reported as not in the export. */
  notEvaluated?: readonly { name: string; reason: string }[];
  /**
   * Groups of object ids (pads `pad:<footprint key>:<pad key>`, or records) the source gave one KiCad UUID (the import
   * record's `sharedIds`): each group gets one UUID again, so KiCad reports it once as it did on the source.
   */
  sharedIds?: readonly (readonly string[])[];
  /** Keep `sharedIds` sharing one UUID (DEFAULT true); false gives every object its own. */
  keepSharedIds?: boolean;
}

export interface KicadExportReportItem {
  level: "info" | "approximated" | "dropped";
  message: string;
  count?: number;
}

export interface KicadExport {
  /** The `.kicad_pcb` text. */
  pcb: string;
  /** The `.kicad_pro` text (JSON). */
  pro: string;
  /** The `.kicad_dru` text, when the board has custom rules. */
  dru?: string;
  report: KicadExportReportItem[];
  stats: { footprints: number; pads: number; tracks: number; arcs: number; vias: number; zones: number; ruleAreas: number; graphics: number; texts: number; nets: number; netclasses: number; customRules: number; fillPolygons: number };
}

// ---------------------------------------------------------------- numbers

/** Integer nanometers as exact decimal millimeters (no binary rounding). */
export function mmExact(nm: number): string {
  const n = Math.round(nm);
  const a = Math.abs(n);
  const i = Math.floor(a / 1_000_000);
  const f = a % 1_000_000;
  const s = f ? `${i}.${String(f).padStart(6, "0").replace(/0+$/, "")}` : String(i);
  return n < 0 ? `-${s}` : s;
}
/** Integer millidegrees as exact decimal degrees. */
const degExact = (mdeg: number): string => {
  const n = normAngle(Math.round(mdeg));
  const i = Math.floor(n / 1000);
  const f = n % 1000;
  return f ? `${i}.${String(f).padStart(3, "0").replace(/0+$/, "")}` : String(i);
};
/** A ratio or plain number, to 9 decimals. */
const plain = (v: number): string => {
  const s = v.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
};
/** An s-expression string. */
const q = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
/** A deterministic UUID for an object. */
function uuid(key: string): string {
  const h = sha1Hex(`protoboard-kicad-export:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------- layers

const COPPER_NAME = (l: CopperLayer): string => (l === "top" ? "F.Cu" : l === "bottom" ? "B.Cu" : `In${l.slice(5)}.Cu`);
const DRAWING_NAME: Record<string, string> = {
  top_silkscreen: "F.SilkS",
  bottom_silkscreen: "B.SilkS",
  top_soldermask: "F.Mask",
  bottom_soldermask: "B.Mask",
  top_paste: "F.Paste",
  bottom_paste: "B.Paste",
  top_fabrication: "F.Fab",
  bottom_fabrication: "B.Fab",
  top_courtyard: "F.CrtYd",
  bottom_courtyard: "B.CrtYd",
  edge_cuts: "Edge.Cuts",
  user_notes: "Dwgs.User",
};
const layerName = (l: AnyLayer): string => (DRAWING_NAME[l] ?? COPPER_NAME(l as CopperLayer));

/** KiCad 9's layer table: copper F.Cu 0, B.Cu 2, In<n>.Cu 2 + 2n; the technical and user layers after. */
function layerTable(copper: readonly CopperLayer[]): string[] {
  const rows: string[] = [];
  for (const l of copper) {
    const id = l === "top" ? 0 : l === "bottom" ? 2 : 2 + 2 * Number(l.slice(5));
    rows.push(`(${id} ${q(COPPER_NAME(l))} signal)`);
  }
  rows.push(
    `(9 "F.Adhes" user "F.Adhesive")`,
    `(11 "B.Adhes" user "B.Adhesive")`,
    `(13 "F.Paste" user)`,
    `(15 "B.Paste" user)`,
    `(5 "F.SilkS" user "F.Silkscreen")`,
    `(7 "B.SilkS" user "B.Silkscreen")`,
    `(1 "F.Mask" user)`,
    `(3 "B.Mask" user)`,
    `(17 "Dwgs.User" user "User.Drawings")`,
    `(19 "Cmts.User" user "User.Comments")`,
    `(21 "Eco1.User" user "User.Eco1")`,
    `(23 "Eco2.User" user "User.Eco2")`,
    `(25 "Edge.Cuts" user)`,
    `(27 "Margin" user)`,
    `(31 "F.CrtYd" user "F.Courtyard")`,
    `(29 "B.CrtYd" user "B.Courtyard")`,
    `(35 "F.Fab" user)`,
    `(33 "B.Fab" user)`,
  );
  return rows;
}

// ---------------------------------------------------------------- the report

class ExportReport {
  private readonly entries = new Map<string, { level: KicadExportReportItem["level"]; what: string; why: string; count: number }>();
  add(level: KicadExportReportItem["level"], what: string, why: string, count = 1): void {
    if (count <= 0) return;
    const key = `${level}\u0000${what}\u0000${why}`;
    const e = this.entries.get(key);
    if (e) e.count += count;
    else this.entries.set(key, { level, what, why, count });
  }
  dropped(what: string, why: string, count = 1): void {
    this.add("dropped", what, why, count);
  }
  approximated(what: string, why: string, count = 1): void {
    this.add("approximated", what, why, count);
  }
  info(what: string, why: string, count = 1): void {
    this.add("info", what, why, count);
  }
  items(): KicadExportReportItem[] {
    const rank = { dropped: 0, approximated: 1, info: 2 } as const;
    return [...this.entries.values()].sort((a, b) => rank[a.level] - rank[b.level]).map((e) => ({ level: e.level, message: `${e.count} ${e.what}: ${e.why}`, count: e.count }));
  }
}

// ---------------------------------------------------------------- geometry helpers

/**
 * The point halfway along an arc from `start` to `end` with a signed sweep (millidegrees), on whole nanometers (as
 * KiCad stores it): of the lattice points next to the exact mid point, the nearest one through which the arc's sweep
 * reads back as `sweep` (a mid point rounded blindly moves a small arc's sweep by a millidegree).
 */
function arcMid(start: Point, end: Point, sweep: number): Point {
  const c = arcCenter(start, end, sweep);
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a = a0 + ((sweep / 1000) * Math.PI) / 180 / 2;
  const mx = c.x + c.r * Math.cos(a);
  const my = c.y + c.r * Math.sin(a);
  let best: Point | undefined;
  let bestD = Infinity;
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const p = { x: Math.round(mx) + dx, y: Math.round(my) + dy };
      if (arcSweep(start, p, end) !== sweep) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  return best ?? { x: Math.round(mx), y: Math.round(my) };
}

/**
 * A polygon with holes as one ring with each hole joined to the outside by a zero-width bridge (the form KiCad saves
 * fill in): holes in order of their leftmost point, each bridged from that point leftward to the nearest edge.
 */
export function fracture(outer: readonly Point[], holes: readonly (readonly Point[])[]): { ring: Point[]; unbridged: number } {
  let ring: Point[] = [...outer];
  let unbridged = 0;
  const sorted = holes
    .filter((h) => h.length >= 3)
    .map((h) => {
      let li = 0;
      h.forEach((p, i) => {
        if (p.x < h[li].x || (p.x === h[li].x && p.y < h[li].y)) li = i;
      });
      return { h, li };
    })
    .sort((a, b) => a.h[a.li].x - b.h[b.li].x || a.h[a.li].y - b.h[b.li].y);
  for (const { h, li } of sorted) {
    const p = h[li];
    let best: { i: number; x: number } | undefined;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (a.y === b.y) continue;
      if (!((a.y <= p.y && p.y < b.y) || (b.y <= p.y && p.y < a.y))) continue;
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (x > p.x) continue;
      if (!best || x > best.x) best = { i, x };
    }
    if (!best) {
      unbridged++;
      continue;
    }
    const a = ring[best.i];
    const b = ring[(best.i + 1) % ring.length];
    const ix = Math.round(best.x);
    const hit: Point = a.x === ix && a.y === p.y ? a : b.x === ix && b.y === p.y ? b : { x: ix, y: p.y };
    // the hole from its leftmost point round to it again, spliced in after `a`: a bridge out and a bridge back
    const loop = [...h.slice(li), ...h.slice(0, li), p];
    const head = ring.slice(0, best.i + 1);
    const tail = ring.slice(best.i + 1);
    if (hit === a) ring = [...head, ...loop, a, ...tail];
    else if (hit === b) ring = [...head, b, ...loop, ...tail];
    else ring = [...head, hit, ...loop, hit, ...tail];
  }
  return { ring, unbridged };
}

const ringPoints = (flat: readonly number[]): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

// ---------------------------------------------------------------- rules

/** Board setup minimums: the check, the project key. */
const BOARD_SETUP: Partial<Record<RuleRec["check"], string>> = {
  clearance: "min_clearance",
  track_width: "min_track_width",
  via_diameter: "min_via_diameter",
  hole_size: "min_through_hole_diameter",
  annular_ring: "min_via_annular_width",
  hole_clearance: "min_hole_clearance",
  hole_to_hole: "min_hole_to_hole",
  edge_clearance: "min_copper_edge_clearance",
};
/** KiCad 10's board setup defaults (nanometers), as the importer assumes them (kicad/rules.ts). */
const KICAD_SETUP_DEFAULT: Record<string, number> = {
  min_track_width: 200_000,
  min_via_diameter: 500_000,
  min_through_hole_diameter: 300_000,
  min_via_annular_width: 100_000,
  min_hole_clearance: 250_000,
  min_hole_to_hole: 250_000,
  min_copper_edge_clearance: 500_000,
};
/** Net class fields: a target rule's preferred value of these checks. */
const CLASS_PREFERRED: Partial<Record<RuleRec["check"], string>> = { track_width: "track_width", via_diameter: "via_diameter", via_hole: "via_drill", diff_pair_gap: "diff_pair_gap" };
/** Custom rule constraints by check (the importer's map turned around). */
const CONSTRAINT: Partial<Record<RuleRec["check"], string>> = {
  clearance: "clearance",
  physical_clearance: "physical_clearance",
  track_width: "track_width",
  via_diameter: "via_diameter",
  hole_size: "hole_size",
  via_hole: "hole_size",
  annular_ring: "annular_width",
  edge_clearance: "edge_clearance",
  hole_clearance: "hole_clearance",
  hole_to_hole: "hole_to_hole",
  diff_pair_gap: "diff_pair_gap",
  length: "length",
};
const TYPE_NAME: Record<string, string> = { via: "Via", track: "Track", pad: "Pad", zone: "Zone", footprint: "Footprint" };
const PAD_TYPE_NAME = { smd: "SMD", th: "Through-hole", np: "NPTH, mechanical" } as const;

class Unexpressible extends Error {}

interface CondCtx {
  offset: { x: number; y: number };
  className: (ours: string) => string;
}

const lit = (s: string): string => {
  if (/['"\\]/.test(s)) throw new Unexpressible(`the name ${s} has a quote or backslash, which a KiCad condition cannot hold`);
  return `'${s}'`;
};
const orOf = (parts: string[]): string => (parts.length === 1 ? parts[0] : `(${parts.join(" || ")})`);

/** A rule condition as a KiCad condition expression (the inverse of kicad/condition.ts). */
function conditionText(c: RuleCondition, ctx: CondCtx, top = false): string {
  const wrap = (s: string) => (top ? s : `(${s})`);
  if ("all" in c) return c.all.length === 1 ? conditionText(c.all[0], ctx, top) : wrap(c.all.map((x) => conditionText(x, ctx)).join(" && "));
  if ("any" in c) return c.any.length === 1 ? conditionText(c.any[0], ctx, top) : wrap(c.any.map((x) => conditionText(x, ctx)).join(" || "));
  if ("not" in c) return `!(${conditionText(c.not, ctx)})`;
  if ("same_net" in c) return "A.NetName == B.NetName";
  const S = c.side;
  if ("kind" in c)
    return orOf(
      c.kind.map((k) => {
        const t = TYPE_NAME[k];
        if (!t) throw new Unexpressible(`objects of kind ${k} have no KiCad type`);
        return `${S}.Type == '${t}'`;
      }),
    );
  if ("pad_type" in c) return orOf(c.pad_type.map((t) => `${S}.Pad_Type == '${PAD_TYPE_NAME[t]}'`));
  if ("net" in c) return orOf(c.net.map((n) => `${S}.NetName == ${lit(n)}`));
  if ("class" in c) return orOf(c.class.map((k) => `${S}.NetClass == ${lit(ctx.className(k))}`));
  if ("layer" in c) return orOf(c.layer.map((l) => `${S}.Layer == ${lit(layerName(l))}`));
  if ("area" in c) return orOf(c.area.map((a) => `${S}.${c.touch ? "intersectsArea" : "enclosedByArea"}(${lit(a)})`));
  if ("courtyard" in c) return orOf(c.courtyard.map((r) => `${S}.intersectsCourtyard(${lit(r)})`));
  if ("footprint" in c) return orOf(c.footprint.map((r) => `${S}.memberOfFootprint(${lit(r)})`));
  if ("pad" in c) return orOf(c.pad.map((p) => `${S}.Pad_Number == ${lit(p)}`));
  if ("coord" in c) {
    const prop = `${S}.${c.of === "at" ? "Position" : c.of === "start" ? "Start" : "End"}_${c.coord === "x" ? "X" : "Y"}`;
    const parts: string[] = [];
    // KiCad's Y runs down: board y > v is KiCad y < -(v + offset.y)
    const conv = (v: number) => (c.coord === "x" ? v + ctx.offset.x : -(v + ctx.offset.y));
    if (c.gt !== undefined) parts.push(`${prop} ${c.coord === "x" ? ">" : "<"} ${mmExact(conv(c.gt))}mm`);
    if (c.lt !== undefined) parts.push(`${prop} ${c.coord === "x" ? "<" : ">"} ${mmExact(conv(c.lt))}mm`);
    if (!parts.length) throw new Unexpressible("a coordinate term without bounds");
    return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
  }
  throw new Unexpressible(`condition ${JSON.stringify(c).slice(0, 80)} has no KiCad term`);
}

/** The custom rule name a rule came from (`custom rule 'X'`), when the importer made it. */
const customRuleName = (r: RuleRec): string | undefined => /^custom rule '(.*)'$/.exec(r.provenance?.from ?? "")?.[1];

// ---------------------------------------------------------------- the exporter

export function exportKicadBoard(doc: BoardDocument, options: KicadExportOptions = {}): KicadExport {
  const rep = new ExportReport();
  const board = doc.records.get("board");
  const boardName = board?.kind === "board" ? board.name : "board";
  const name = options.name ?? boardName;
  const copper = copperLayers(doc);
  const copperSet = new Set<CopperLayer>(copper);
  const outlineRec = doc.records.get("outline");
  let offset = options.offset;
  if (offset) rep.info("board offset", `coordinates are the board's plus (${mmExact(offset.x)}, ${mmExact(offset.y)}) mm (the import record's offset: the export lands where the source was), Y turned down`);
  else {
    offset = { x: KICAD_EXPORT_DEFAULT_CENTER.x * 1_000_000, y: -KICAD_EXPORT_DEFAULT_CENTER.y * 1_000_000 };
    rep.info("board offset", `no import record offset: the board's origin is placed at (${KICAD_EXPORT_DEFAULT_CENTER.x}, ${KICAD_EXPORT_DEFAULT_CENTER.y}) mm in KiCad, Y turned down`);
  }
  const off = offset;
  const X = (x: number) => mmExact(x + off.x);
  const Y = (y: number) => mmExact(-(y + off.y));
  const XY = (p: Point) => `${X(p.x)} ${Y(p.y)}`;

  // ---- identities: an object's UUID comes from its id; a group the source gave one UUID shares its first member's
  const shared = new Map<string, string>();
  const groups = (options.sharedIds ?? []).filter((g) => g.length > 1 && g.some((id) => doc.records.has(id) || doc.records.has(`fp:${id.split(":")[1]}`)));
  if (groups.length && options.keepSharedIds !== false) {
    for (const g of groups) for (const id of g) shared.set(id, g[0]);
    rep.info("group of objects sharing one UUID", "kept sharing one UUID, as in the source (KiCad reports each group once; the cross-check folds ours to match)", groups.length);
  } else if (groups.length) rep.info("group of objects the source gave one UUID", "each object written with its own UUID (KiCad reports each one; the source reported the group once)", groups.length);
  const U = (id: string) => uuid(shared.get(id) ?? id);

  // ---- nets: the netlist's and every net named on copper, numbered in name order (KiCad 9 numbers them)
  const netNames = new Set<string>(doc.netlist?.nets.map((n) => n.name) ?? []);
  for (const r of doc.records.values()) if ((r.kind === "track" || r.kind === "via" || r.kind === "zone") && r.net) netNames.add(r.net);
  const nets = [...netNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const netNo = new Map(nets.map((n, i) => [n, i + 1]));
  const netRef = (n: string | undefined) => (n && netNo.has(n) ? `(net ${netNo.get(n)})` : "");
  const netFull = (n: string | undefined) => (n && netNo.has(n) ? `(net ${netNo.get(n)} ${q(n)})` : "");

  const out: string[] = [];
  const w = (depth: number, s: string) => out.push(`${"\t".repeat(depth)}${s}`);
  const stats: KicadExport["stats"] = { footprints: 0, pads: 0, tracks: 0, arcs: 0, vias: 0, zones: 0, ruleAreas: 0, graphics: 0, texts: 0, nets: nets.length, netclasses: 0, customRules: 0, fillPolygons: 0 };

  // ---- header
  w(0, "(kicad_pcb");
  w(1, `(version ${KICAD_EXPORT_VERSION})`);
  w(1, `(generator "protoboard")`);
  w(1, `(generator_version "0.2")`);
  w(1, `(general (thickness ${mmExact(board?.kind === "board" ? board.thickness : 1_600_000)}) (legacy_teardrops no))`);
  w(1, `(paper "A4")`);
  w(1, `(title_block (title ${q(boardName)}))`);
  w(1, "(layers");
  for (const row of layerTable(copper)) w(2, row);
  w(1, ")");
  writeSetup();
  w(1, `(net 0 "")`);
  for (const n of nets) w(1, `(net ${netNo.get(n)} ${q(n)})`);

  // ---- fill by zone
  const fillEntries: readonly ZoneFillEntry[] = Array.isArray(options.fills) ? (options.fills as readonly ZoneFillEntry[]) : ((options.fills as DerivedZoneFill | undefined)?.fills ?? []);
  const fillByZone = new Map<string, ZoneFillEntry[]>();
  let looseFill = 0;
  for (const f of fillEntries) {
    if (!f.zone) {
      looseFill++;
      continue;
    }
    const l = fillByZone.get(f.zone) ?? [];
    l.push(f);
    fillByZone.set(f.zone, l);
  }
  if (looseFill) rep.dropped("fill without a zone record", "a KiCad fill belongs to a zone; fill with no zone (a Circuit JSON pour) is not written", looseFill);

  // ---- footprints
  const footprints = recordsOfKind(doc, "footprint") as FootprintRec[];
  const keepoutsByFp = new Map<string, KeepoutRec[]>();
  for (const k of recordsOfKind(doc, "keepout") as KeepoutRec[]) {
    if (!k.footprint || !doc.records.has(k.footprint)) continue;
    const l = keepoutsByFp.get(k.footprint) ?? [];
    l.push(k);
    keepoutsByFp.set(k.footprint, l);
  }
  let textWidth = 0;
  let smdPaste = 0;
  let polyPads = 0;
  let pathGraphics = 0;
  let rotatedRects = 0;
  let hiddenFields = 0;
  let mirroredFpText = 0;
  let pathProps = 0;
  let courtyardsWritten = 0;
  for (const fp of footprints) writeFootprint(fp);
  if (textWidth) rep.approximated("text", "written with its glyph width equal to its height (the document keeps the height only)", textWidth);
  if (smdPaste) rep.info("SMD pad", "written with a paste opening on its side (the document has no field for pads without one)", smdPaste);
  if (polyPads) rep.approximated("polygon pad", "written as a custom pad (a small round anchor inside the polygon, the polygon as its primitive); KiCad's trapezoid and chamfered shapes come back as polygons", polyPads);
  if (pathGraphics) rep.approximated("path graphic", "written as straight line segments, one per step", pathGraphics);
  if (rotatedRects) rep.approximated("rotated rectangle graphic", "written as a polygon of its four corners", rotatedRects);
  if (hiddenFields) rep.info("footprint field", "a reference or value the footprint shows no text for is written as a hidden property, as KiCad requires both", hiddenFields);
  if (mirroredFpText) rep.info("footprint text on a back layer", "written mirrored, as KiCad shows back-side footprint text", mirroredFpText);
  if (pathProps) rep.info("footprint UHD instance path", "written as the hidden property UHD_Instance (the importer does not read it back)", pathProps);
  if (courtyardsWritten) rep.info("footprint courtyard", "written as a courtyard polygon (the footprint had no courtyard graphics)", courtyardsWritten);
  if (footprints.length) rep.info("footprint attribute", "set from its pads (through_hole with a drilled pad, else smd; the document keeps no attributes, so exclude-from-BOM and similar flags are not written)", footprints.length);
  if (footprints.length) rep.info("3D model", "the board document holds no 3D model references; none are written", footprints.length);

  // ---- board outline and cutouts (Edge.Cuts)
  let edgeItems = 0;
  if (outlineRec?.kind === "outline") edgeItems += writeEdges(outlineRec.outline, outlineRec.locked, "outline");
  else rep.dropped("board outline", "the board has none; no Edge.Cuts outline is written (KiCad's DRC reports a missing outline)");
  for (const c of recordsOfKind(doc, "cutout")) edgeItems += writeEdges(c.outline, c.locked, c.id);
  if (edgeItems) rep.approximated("Edge.Cuts line", "drawn 0.05 mm wide (the document keeps the outline's line, not its drawn width)", edgeItems);

  // ---- board graphics and texts
  for (const g of recordsOfKind(doc, "graphic")) {
    let layer = g.layer;
    if (layer === "edge_cuts") {
      rep.approximated("graphic on edge_cuts", "written on Dwgs.User: on Edge.Cuts it would change the board outline", 1);
      layer = "user_notes";
    }
    writeGraphic(1, "gr", { ...g, layer }, XY, g.id, g.locked);
    stats.graphics++;
  }
  for (const t of recordsOfKind(doc, "text")) {
    const just = [t.anchor && t.anchor !== "center" ? t.anchor : "", t.mirrored ? "mirror" : ""].filter(Boolean).join(" ");
    w(1, `(gr_text ${q(t.text)} (at ${XY(t)}${t.rotation ? ` ${degExact(t.rotation)}` : ""}) (layer ${q(layerName(t.layer === "edge_cuts" ? "user_notes" : t.layer))})${t.locked ? " (locked yes)" : ""} (uuid ${q(U(t.id))})`);
    w(2, `(effects (font (size ${mmExact(t.height)} ${mmExact(t.height)})${t.stroke_width ? ` (thickness ${mmExact(t.stroke_width)})` : ""})${just ? ` (justify ${just})` : ""})`);
    w(1, ")");
    textWidth++;
    stats.texts++;
  }

  // ---- tracks and vias
  for (const t of recordsOfKind(doc, "track")) {
    if (!copperSet.has(t.layer)) {
      rep.dropped("track", `on ${t.layer}, which this board does not have`);
      continue;
    }
    const tail = `(width ${mmExact(t.width)}) (layer ${q(COPPER_NAME(t.layer))})${t.locked ? " (locked yes)" : ""} ${netRef(t.net) || "(net 0)"} (uuid ${q(U(t.id))})`;
    if (t.sweep !== undefined) {
      w(1, `(arc (start ${XY(t.start)}) (mid ${XY(arcMid(t.start, t.end, t.sweep))}) (end ${XY(t.end)}) ${tail})`);
      stats.arcs++;
    } else w(1, `(segment (start ${XY(t.start)}) (end ${XY(t.end)}) ${tail})`);
    stats.tracks++;
  }
  let nonThrough = 0;
  let tentedVias = 0;
  for (const v of recordsOfKind(doc, "via")) {
    if (!copperSet.has(v.from_layer) || !copperSet.has(v.to_layer)) {
      rep.dropped("via", `between ${v.from_layer} and ${v.to_layer}, layers this board does not have`);
      continue;
    }
    const through = (v.from_layer === copper[0] && v.to_layer === copper[copper.length - 1]) || (v.to_layer === copper[0] && v.from_layer === copper[copper.length - 1]);
    if (!through) nonThrough++;
    let tent = "";
    if (v.tented) {
      tentedVias++;
      tent = ` (tenting (front ${v.tented === "both" || v.tented === "top" ? "yes" : "no"}) (back ${v.tented === "both" || v.tented === "bottom" ? "yes" : "no"}))`;
    }
    w(1, `(via${through ? "" : " blind"} (at ${XY(v)}) (size ${mmExact(v.outer_diameter)}) (drill ${mmExact(v.hole_diameter)}) (layers ${q(COPPER_NAME(v.from_layer))} ${q(COPPER_NAME(v.to_layer))})${tent}${v.locked ? " (locked yes)" : ""} ${netRef(v.net) || "(net 0)"} (uuid ${q(U(v.id))}))`);
    stats.vias++;
  }
  if (nonThrough) rep.info("blind or buried via", "written with KiCad 9's `blind` keyword, which covers blind and buried vias (its layers say which); the document has no microvia type", nonThrough);
  if (tentedVias) rep.info("via tenting override", "written as the via's own front and back tenting", tentedVias);

  // ---- zones and rule areas
  let unfilled = 0;
  let unbridged = 0;
  for (const z of recordsOfKind(doc, "zone") as ZoneRec[]) writeZone(1, z);
  for (const k of recordsOfKind(doc, "keepout") as KeepoutRec[]) if (!k.footprint || !doc.records.has(k.footprint)) writeKeepout(1, k);
  if (unfilled) rep.approximated("zone without fill", "written unfilled (no fill was given for it): KiCad refills it with `kicad-cli pcb drc --refill-zones` or in the editor; without that its copper connects nothing", unfilled);
  if (unbridged) rep.dropped("zone fill hole", "no edge to bridge it to was found; the hole is not cut from the fill", unbridged);
  const fillSource = !Array.isArray(options.fills) && options.fills ? (options.fills as DerivedZoneFill).source : undefined;
  if (stats.fillPolygons) rep.info("zone fill polygon", `written from the board's fill${fillSource ? ` (${fillSource})` : ""} as KiCad saves fill: one outline per polygon, holes joined to it by zero-width bridges`, stats.fillPolygons);

  w(0, ")");
  const pcb = out.join("\n") + "\n";

  // ---- project and rules
  const { pro, dru } = writeRules();
  // record kinds with no KiCad counterpart: never skipped without a word
  const other = new Map<string, number>();
  for (const r of doc.records.values()) if (!EXPORTED_KINDS.has(r.kind)) other.set(r.kind, (other.get(r.kind) ?? 0) + 1);
  for (const [kind, n] of other) {
    if (kind === "waiver") rep.dropped("waiver", "KiCad keeps DRC exclusions by its own marker ids, which a waiver cannot name; not written, so KiCad's DRC reports the waived findings (the cross-check lists them as waived)", n);
    else rep.dropped(`${kind} record`, "no KiCad counterpart; not written", n);
  }
  for (const n of options.notEvaluated ?? []) rep.dropped("source rule not in the export", `${n.name}: the import could not express it (${n.reason}), so the board does not hold it`);

  return { pcb, pro, ...(dru !== undefined ? { dru } : {}), report: rep.items(), stats };

  // ================================================================= writers

  function writeSetup(): void {
    const layers = (recordsOfKind(doc, "layer") as LayerRec[]).sort((a, b) => a.order - b.order);
    w(1, "(setup");
    if (layers.length) {
      w(2, "(stackup");
      let dielectric = 0;
      let renamed = 0;
      for (const l of layers) {
        const extra = `${l.material ? ` (material ${q(l.material)})` : ""}${l.epsilon_r !== undefined ? ` (epsilon_r ${plain(l.epsilon_r)})` : ""}${l.loss_tangent !== undefined ? ` (loss_tangent ${plain(l.loss_tangent)})` : ""}`;
        if (l.type === "copper") {
          if (!copperSet.has(l.name as CopperLayer)) {
            rep.dropped("stackup layer", `copper layer ${l.name} is not one of the board's copper layers`);
            continue;
          }
          w(3, `(layer ${q(COPPER_NAME(l.name as CopperLayer))} (type "copper") (thickness ${mmExact(l.thickness)}))`);
        } else if (l.type === "soldermask") {
          const top = !/bottom/.test(l.name);
          w(3, `(layer ${q(top ? "F.Mask" : "B.Mask")} (type ${q(top ? "Top Solder Mask" : "Bottom Solder Mask")}) (thickness ${mmExact(l.thickness)})${extra})`);
        } else {
          dielectric++;
          const m = /^(core|prepreg)\d*$/.exec(l.name);
          if (!m) renamed++;
          w(3, `(layer ${q(`dielectric ${dielectric}`)} (type ${q(m ? m[1] : "core")}) (thickness ${mmExact(l.thickness)})${extra})`);
        }
      }
      if (renamed) rep.approximated("stackup dielectric", "named neither core nor prepreg; written as a core", renamed);
      w(3, `(copper_finish "None")`);
      w(3, `(dielectric_constraints no)`);
      w(2, ")");
    } else rep.info("stackup", "the board has no layer records; no stackup is written (KiCad uses its default for the board thickness)");
    w(2, "(pad_to_mask_clearance 0)");
    w(2, "(allow_soldermask_bridges_in_footprints no)");
    w(1, ")");
  }

  /** A graphic shape (footprint frame or world) through a point map. */
  function writeGraphic(depth: number, prefix: "gr" | "fp", g: Omit<FootprintGraphic, "layer"> & { layer: AnyLayer }, P: (p: Point) => string, key: string, locked?: boolean): void {
    const tail = `(stroke (width ${mmExact(g.stroke_width)}) (type solid))`;
    const fill = (closed: boolean) => (closed ? ` (fill ${g.filled ? "yes" : "no"})` : "");
    const end = ` (layer ${q(layerName(g.layer))})${locked ? " (locked yes)" : ""} (uuid ${q(U(key))}))`;
    if (g.shape === "line") w(depth, `(${prefix}_line (start ${P(g.start!)}) (end ${P(g.end!)}) ${tail}${end}`);
    else if (g.shape === "arc") w(depth, `(${prefix}_arc (start ${P(g.start!)}) (mid ${P(arcMid(g.start!, g.end!, g.sweep!))}) (end ${P(g.end!)}) ${tail}${end}`);
    else if (g.shape === "circle") w(depth, `(${prefix}_circle (center ${P(g.center!)}) (end ${P({ x: g.center!.x + g.radius!, y: g.center!.y })}) ${tail}${fill(true)}${end}`);
    else if (g.shape === "rect") {
      const c = g.center!;
      const hw = g.width! / 2;
      const hh = g.height! / 2;
      if (g.rotation) {
        rotatedRects++;
        const [cs, sn] = [Math.cos((g.rotation / 1000) * (Math.PI / 180)), Math.sin((g.rotation / 1000) * (Math.PI / 180))];
        const corners = [
          [-hw, -hh],
          [hw, -hh],
          [hw, hh],
          [-hw, hh],
        ].map(([x, y]) => ({ x: Math.round(c.x + x * cs - y * sn), y: Math.round(c.y + x * sn + y * cs) }));
        w(depth, `(${prefix}_poly (pts ${corners.map((p) => `(xy ${P(p)})`).join(" ")}) ${tail}${fill(true)}${end}`);
      } else {
        const a = { x: Math.round(c.x - hw), y: Math.round(c.y + hh) };
        const b = { x: Math.round(c.x + hw), y: Math.round(c.y - hh) };
        w(depth, `(${prefix}_rect (start ${P(a)}) (end ${P(b)}) ${tail}${fill(true)}${end}`);
      }
    } else if (g.shape === "polygon") {
      w(depth, `(${prefix}_poly (pts ${ptsText(g.points!, P, true)}) ${tail}${fill(true)}${end}`);
    } else if (g.shape === "path") {
      pathGraphics++;
      const pts = g.points!;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (pts[i].sweep !== undefined) w(depth, `(${prefix}_arc (start ${P(pts[i])}) (mid ${P(arcMid(pts[i], pts[i + 1], pts[i].sweep!))}) (end ${P(pts[i + 1])}) ${tail} (layer ${q(layerName(g.layer))})${locked ? " (locked yes)" : ""} (uuid ${q(U(`${key}/${i}`))}))`);
        else w(depth, `(${prefix}_line (start ${P(pts[i])}) (end ${P(pts[i + 1])}) ${tail} (layer ${q(layerName(g.layer))})${locked ? " (locked yes)" : ""} (uuid ${q(U(`${key}/${i}`))}))`);
      }
    }
  }

  /** A `(pts ...)` body: straight vertices as `xy`, arcs as `arc` items (start, mid, end). */
  function ptsText(points: readonly Vertex[], P: (p: Point) => string, closed: boolean): string {
    const parts: string[] = [];
    let prevArc = false;
    points.forEach((v, i) => {
      const next = points[i + 1] ?? (closed ? points[0] : undefined);
      if (v.sweep !== undefined && next) {
        parts.push(`(arc (start ${P(v)}) (mid ${P(arcMid(v, next, v.sweep))}) (end ${P(next)}))`);
        prevArc = true;
      } else {
        if (!prevArc) parts.push(`(xy ${P(v)})`);
        prevArc = false;
      }
    });
    return parts.join(" ");
  }

  /** Edge.Cuts lines and arcs around a contour; returns how many were written. */
  function writeEdges(c: readonly Vertex[], locked: boolean | undefined, key: string): number {
    c.forEach((v, i) => {
      const n = c[(i + 1) % c.length];
      const tail = `(stroke (width 0.05) (type solid)) (layer "Edge.Cuts")${locked ? " (locked yes)" : ""} (uuid ${q(U(`${key}/edge/${i}`))})`;
      if (v.sweep !== undefined) w(1, `(gr_arc (start ${XY(v)}) (mid ${XY(arcMid(v, n, v.sweep))}) (end ${XY(n)}) ${tail})`);
      else w(1, `(gr_line (start ${XY(v)}) (end ${XY(n)}) ${tail})`);
    });
    return c.length;
  }

  function writeFootprint(fp: FootprintRec): void {
    stats.footprints++;
    const bottom = fp.side === "bottom";
    // the KiCad angle (degrees) and the frame maps, the importer's turned around
    const theta = normAngle(fp.rotation - (bottom ? 180_000 : 0));
    const L = (p: Point) => `${mmExact(p.x)} ${mmExact(bottom ? p.y : -p.y)}`;
    const absAngle = (rel: number) => normAngle(bottom ? theta + 180_000 - rel : rel + theta);
    const keys = padKeys(fp);
    const fpKey = footprintKey(fp);
    w(1, `(footprint ${q(fp.footprint)}`);
    w(2, `(layer ${q(bottom ? "B.Cu" : "F.Cu")})`);
    if (fp.locked) w(2, "(locked yes)");
    w(2, `(uuid ${q(U(fp.id))})`);
    w(2, `(at ${XY(fp)}${theta ? ` ${degExact(theta)}` : ""})`);
    // texts: the first reference and value texts are KiCad's Reference and Value properties
    const texts = fp.texts ?? [];
    const refText = texts.find((t) => t.role === "ref" && t.text === fp.ref);
    const valueText = texts.find((t) => t.role === "value" && fp.value !== undefined && t.text === fp.value);
    const textBody = (t: FootprintText, key: string, hide: boolean) => {
      const world = sideLayer(t.layer, fp.side);
      const mirror = /^bottom_/.test(world) || world === "bottom";
      if (!hide) {
        if (mirror) mirroredFpText++;
        textWidth++;
      }
      const just = [t.anchor && t.anchor !== "center" ? t.anchor : "", mirror ? "mirror" : ""].filter(Boolean).join(" ");
      return `(at ${L(t)} ${degExact(absAngle(t.rotation ?? 0))}) (layer ${q(layerName(world))})${hide ? " (hide yes)" : ""} (uuid ${q(U(key))}) (effects (font (size ${mmExact(t.height)} ${mmExact(t.height)})${t.stroke_width ? ` (thickness ${mmExact(t.stroke_width)})` : ""})${just ? ` (justify ${just})` : ""})`;
    };
    const hiddenField = (layer: "top_silkscreen" | "top_fabrication"): FootprintText => ({ layer, text: "-", x: 0, y: 0, height: 1_000_000, stroke_width: 150_000 });
    if (refText) w(2, `(property "Reference" ${q(fp.ref)} ${textBody(refText, `${fp.id}/ref`, false)})`);
    else {
      hiddenFields++;
      w(2, `(property "Reference" ${q(fp.ref)} ${textBody(hiddenField("top_silkscreen"), `${fp.id}/ref`, true)})`);
    }
    if (valueText) w(2, `(property "Value" ${q(fp.value ?? "")} ${textBody(valueText, `${fp.id}/value`, false)})`);
    else {
      hiddenFields++;
      w(2, `(property "Value" ${q(fp.value ?? "")} ${textBody(hiddenField("top_fabrication"), `${fp.id}/value`, true)})`);
    }
    if (fp.supplier_part) w(2, `(property "LCSC" ${q(fp.supplier_part)} ${textBody(hiddenField("top_fabrication"), `${fp.id}/lcsc`, true)})`);
    if (fp.path) {
      pathProps++;
      w(2, `(property "UHD_Instance" ${q(fp.path)} ${textBody(hiddenField("top_fabrication"), `${fp.id}/path`, true)})`);
    }
    const hasTh = fp.pads.some((p) => p.type === "th");
    const hasSmd = fp.pads.some((p) => p.type === "smd");
    if (hasTh || hasSmd) w(2, `(attr ${hasTh ? "through_hole" : "smd"})`);
    texts.forEach((t, i) => {
      if (t === refText || t === valueText) return;
      const text = t.role === "ref" ? "${REFERENCE}" : t.role === "value" ? "${VALUE}" : t.text;
      w(2, `(fp_text user ${q(text)} ${textBody(t, `${fp.id}/text/${i}`, false)})`);
    });
    const worldLayer = (l: AnyLayer) => sideLayer(l, fp.side);
    (fp.graphics ?? []).forEach((g, i) => {
      writeGraphic(2, "fp", { ...g, layer: worldLayer(g.layer) }, L, `${fp.id}/gfx/${i}`);
    });
    if (fp.courtyard && !(fp.graphics ?? []).some((g) => g.layer === "top_courtyard")) {
      courtyardsWritten++;
      w(2, `(fp_poly (pts ${ptsText(fp.courtyard, L, true)}) (stroke (width 0.05) (type solid)) (fill no) (layer ${q(layerName(worldLayer("top_courtyard")))}) (uuid ${q(U(`${fp.id}/courtyard`))}))`);
    }
    fp.pads.forEach((p, i) => writePad(p, keys[i]));
    for (const k of keepoutsByFp.get(fp.id) ?? []) writeKeepout(2, k);
    w(1, ")");

    function writePad(p: Pad, key: string): void {
      stats.pads++;
      const net = doc.padNets.get(padId(fpKey, key));
      const number = p.type === "np" && p.number === "_" ? "" : p.number;
      const extra = `${p.pin ? ` (pinfunction ${q(p.pin)})` : ""}${p.mask_margin !== undefined ? ` (solder_mask_margin ${mmExact(p.mask_margin)})` : ""}${p.paste_margin !== undefined ? ` (solder_paste_margin ${mmExact(p.paste_margin)})` : ""}`;
      const id = ` (uuid ${q(U(padId(fpKey, key)))})`;
      let layers: string;
      if (p.type === "smd") {
        const s = padWorldSide(fp, p) === "top" ? "F" : "B";
        layers = `(layers "${s}.Cu" "${s}.Paste" "${s}.Mask")`;
        smdPaste++;
      } else layers = `(layers "*.Cu" "*.Mask")`;
      const drill = p.type === "smd" ? "" : p.type === "np" ? ` (drill ${mmExact(p.hole_diameter!)})` : p.hole_diameter !== undefined ? ` (drill ${mmExact(p.hole_diameter)})` : ` (drill oval ${mmExact(p.hole_width!)} ${mmExact(p.hole_height!)})`;
      const at = (rel: number) => `(at ${L(p)}${absAngle(rel) ? ` ${degExact(absAngle(rel))}` : ""})`;
      const type = p.type === "smd" ? "smd" : p.type === "th" ? "thru_hole" : "np_thru_hole";
      if (p.type === "np") {
        w(2, `(pad ${q(number)} np_thru_hole circle ${at(p.rotation ?? 0)} (size ${mmExact(p.hole_diameter!)} ${mmExact(p.hole_diameter!)})${drill} ${layers}${extra}${id})`);
        return;
      }
      const nets = netFull(net);
      if (p.shape === "polygon") {
        polyPads++;
        // a custom pad at the footprint's own angle (no turn relative to it): the primitive is the polygon as is
        let pts = p.points!;
        let center: Point = { x: p.x, y: p.y };
        const tess = pts.map((v) => ({ x: v.x, y: v.y }));
        if (!pointInPolygon({ x: 0, y: 0 }, tess)) {
          // the anchor must sit inside the polygon: move the pad's origin to the middle of its box
          const xs = tess.map((v) => v.x);
          const ys = tess.map((v) => v.y);
          const c = { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) };
          if (pointInPolygon(c, tess)) {
            pts = pts.map((v) => ({ ...v, x: v.x - c.x, y: v.y - c.y }));
            center = { x: p.x + c.x, y: p.y + c.y };
            rep.approximated("polygon pad whose origin is outside it", "its origin moved to the middle of its box so KiCad's anchor sits inside", 1);
          } else rep.approximated("polygon pad whose origin is outside it", "written with its anchor outside the polygon (KiCad adds the anchor's small disk to the pad)", 1);
        }
        const angle = degExact(theta);
        w(2, `(pad ${q(number)} ${type} custom (at ${L(center)}${theta ? ` ${angle}` : ""}) (size 0.01 0.01)${drill} ${layers}${nets ? ` ${nets}` : ""}${extra}`);
        w(3, `(options (clearance outline) (anchor circle))`);
        w(3, `(primitives (gr_poly (pts ${ptsText(pts, L, true)}) (width 0) (fill yes)))`);
        w(2, `${id.trim()})`);
        return;
      }
      let size: string;
      let shapeExtra = "";
      if (p.type === "smd") size = p.shape === "circle" ? `${mmExact(2 * p.radius!)} ${mmExact(2 * p.radius!)}` : `${mmExact(p.width!)} ${mmExact(p.height!)}`;
      else size = p.shape === "circle" ? `${mmExact(p.outer_diameter!)} ${mmExact(p.outer_diameter!)}` : `${mmExact(p.outer_width!)} ${mmExact(p.outer_height!)}`;
      if (p.shape === "roundrect") {
        const minSide = p.type === "smd" ? Math.min(p.width!, p.height!) : Math.min(p.outer_width!, p.outer_height!);
        const ratio = minSide > 0 ? Math.min(0.5, (p.corner_radius ?? 0) / minSide) : 0;
        shapeExtra = ` (roundrect_rratio ${plain(ratio)})`;
      }
      w(2, `(pad ${q(number)} ${type} ${p.shape} ${at(p.rotation ?? 0)} (size ${size})${drill} ${layers}${shapeExtra}${nets ? ` ${nets}` : ""}${extra}${id})`);
    }
  }

  function zoneOutline(depth: number, outline: readonly Vertex[], holes: readonly (readonly Vertex[])[] | undefined): void {
    w(depth, `(polygon (pts ${ptsText(outline, XY, true)}))`);
    for (const h of holes ?? []) w(depth, `(polygon (pts ${ptsText(h, XY, true)}))`);
  }

  function zoneLayers(ls: readonly CopperLayer[]): string {
    const names = ls.filter((l) => copperSet.has(l)).map(COPPER_NAME);
    return names.length === 1 ? `(layer ${q(names[0])})` : `(layers ${names.map(q).join(" ")})`;
  }

  function writeZone(depth: number, z: ZoneRec): void {
    stats.zones++;
    const n = z.net && netNo.has(z.net) ? netNo.get(z.net)! : 0;
    w(depth, `(zone (net ${n}) (net_name ${q(n ? z.net! : "")}) ${zoneLayers(z.layers)} (uuid ${q(U(z.id))})${z.name ? ` (name ${q(z.name)})` : ""} (hatch edge 0.5)`);
    if (z.locked) w(depth + 1, "(locked yes)");
    w(depth + 1, `(priority ${z.priority})`);
    const cp = z.pad_connection === "solid" ? "yes " : z.pad_connection === "none" ? "no " : "";
    if (z.clearance === undefined) rep.approximated("zone without its own clearance", "written with clearance 0 (KiCad then applies the net class and board clearances, as the checks do)", 1);
    w(depth + 1, `(connect_pads ${cp}(clearance ${mmExact(z.clearance ?? 0)}))`);
    w(depth + 1, `(min_thickness ${mmExact(z.min_width ?? 250_000)})`);
    w(depth + 1, "(filled_areas_thickness no)");
    const fills = fillByZone.get(z.id) ?? [];
    const hatch = z.fill_mode === "hatch" ? ` (mode hatch)${z.hatch_width ? ` (hatch_thickness ${mmExact(z.hatch_width)})` : ""}${z.hatch_gap ? ` (hatch_gap ${mmExact(z.hatch_gap)})` : ""} (hatch_orientation 0)` : "";
    const islands = z.remove_islands === "never" ? 1 : z.remove_islands === "below_area" ? 2 : 0;
    const area = islands === 2 && z.island_min_area ? ` (island_area_min ${plain(z.island_min_area / 1e12)})` : "";
    w(depth + 1, `(fill${fills.length ? " yes" : ""}${hatch}${z.thermal_gap ? ` (thermal_gap ${mmExact(z.thermal_gap)})` : ""}${z.thermal_spoke_width ? ` (thermal_bridge_width ${mmExact(z.thermal_spoke_width)})` : ""} (island_removal_mode ${islands})${area})`);
    if (z.min_width === undefined) rep.approximated("zone minimum width", "absent from the document; KiCad's 0.25 mm written", 1);
    zoneOutline(depth + 1, z.outline, z.holes);
    if (!fills.length) unfilled++;
    for (const f of fills) {
      if (!copperSet.has(f.layer)) continue;
      for (const poly of f.polygons) {
        const fr = fracture(ringPoints(poly.outer), poly.holes.map(ringPoints));
        unbridged += fr.unbridged;
        stats.fillPolygons++;
        const pts = fr.ring.map((p) => `(xy ${XY(p)})`);
        w(depth + 1, `(filled_polygon (layer ${q(COPPER_NAME(f.layer))})`);
        for (let i = 0; i < pts.length; i += 8) w(depth + 2, `${i === 0 ? "(pts " : ""}${pts.slice(i, i + 8).join(" ")}${i + 8 >= pts.length ? ")" : ""}`);
        w(depth + 1, ")");
      }
    }
    w(depth, ")");
  }

  function writeKeepout(depth: number, k: KeepoutRec): void {
    stats.ruleAreas++;
    const any = k.blocks.tracks || k.blocks.vias || k.blocks.pours || k.blocks.footprints;
    if (k.tier === "policy" && any) rep.approximated("policy keep-out that blocks something", "written as a KiCad rule area, which KiCad enforces (it comes back as a no-go keep-out)", 1);
    if (k.tier === "no_go" && !any) rep.approximated("no-go keep-out that blocks nothing", "written as a KiCad rule area that allows everything (it comes back as a policy keep-out)", 1);
    if (k.description) rep.dropped("keep-out description", "a KiCad rule area has no description field", 1);
    const a = (b: boolean) => (b ? "not_allowed" : "allowed");
    w(depth, `(zone (net 0) (net_name "") ${zoneLayers(k.layers)} (uuid ${q(U(k.id))})${k.name ? ` (name ${q(k.name)})` : ""} (hatch edge 0.5)`);
    if (k.locked) w(depth + 1, "(locked yes)");
    w(depth + 1, "(connect_pads (clearance 0))");
    w(depth + 1, "(min_thickness 0.25)");
    w(depth + 1, "(filled_areas_thickness no)");
    w(depth + 1, `(keepout (tracks ${a(k.blocks.tracks)}) (vias ${a(k.blocks.vias)}) (pads allowed) (copperpour ${a(k.blocks.pours)}) (footprints ${a(k.blocks.footprints)}))`);
    w(depth + 1, "(fill (thermal_gap 0.5) (thermal_bridge_width 0.5))");
    zoneOutline(depth + 1, k.outline, k.holes);
    w(depth, ")");
  }

  // ---------------------------------------------------------------- the project file and the custom rules

  function writeRules(): { pro: string; dru?: string } {
    const classes = recordsOfKind(doc, "netclass") as NetclassRec[];
    // our class name -> KiCad's (the importer keeps KiCad's name in the provenance: `net class <name>`)
    const kicadClass = new Map<string, string>([["default", "Default"]]);
    for (const c of classes) kicadClass.set(c.name, /^net class (.+)$/.exec(c.provenance?.from ?? "")?.[1] ?? c.name);
    const className = (ours: string) => kicadClass.get(ours) ?? ours;
    const ctx: CondCtx = { offset: off, className };

    const rules = (recordsOfKind(doc, "rule") as RuleRec[]).filter((r) => {
      if (r.enabled === false) {
        rep.dropped("disabled rule", "a turned-off rule is not written (KiCad has no off switch for a rule)", 1);
        return false;
      }
      return true;
    });
    const setup: Record<string, number> = {};
    const severities: Record<string, string> = {};
    const classValues = new Map<string, Record<string, number>>();
    const custom: RuleRec[] = [];
    const sevOf = (r: RuleRec) => r.severity ?? (r.tier === "floor" || r.tier === "no_go" ? "error" : "warning");
    const noteSeverity = (r: RuleRec) => {
      const type = KICAD_VIOLATION_TYPE[r.check];
      if (type) severities[type] = sevOf(r);
    };
    let setupMerged = 0;
    let defaultsKept = 0;
    for (const r of rules) {
      const plainApplies = Object.keys(r.applies).length === 0;
      const onlyClass = Object.keys(r.applies).length === 1 && r.applies.classes?.length === 1;
      const prio0 = !r.priority;
      if (r.tier === "floor" && prio0 && plainApplies && BOARD_SETUP[r.check] && r.min !== undefined && r.max === undefined && r.preferred === undefined) {
        const k = BOARD_SETUP[r.check]!;
        noteSeverity(r);
        // a value the import took from KiCad's defaults stays implicit, so KiCad (and a re-import) apply the default again
        if (r.provenance?.from === "board setup (KiCad default)" && KICAD_SETUP_DEFAULT[k] === r.min) {
          defaultsKept++;
          continue;
        }
        if (setup[k] !== undefined) setupMerged++;
        setup[k] = Math.max(setup[k] ?? 0, r.min);
        continue;
      }
      if (r.tier === "floor" && prio0 && onlyClass && r.check === "clearance" && r.min !== undefined && r.max === undefined && r.preferred === undefined) {
        const v = classValues.get(r.applies.classes![0]) ?? {};
        v.clearance = Math.max(v.clearance ?? 0, r.min);
        classValues.set(r.applies.classes![0], v);
        noteSeverity(r);
        continue;
      }
      if (r.tier === "target" && prio0 && onlyClass && CLASS_PREFERRED[r.check] && r.preferred !== undefined && r.min === undefined && r.max === undefined) {
        const v = classValues.get(r.applies.classes![0]) ?? {};
        v[CLASS_PREFERRED[r.check]!] = r.preferred;
        classValues.set(r.applies.classes![0], v);
        continue;
      }
      custom.push(r);
    }
    if (defaultsKept) rep.info("board setup value", "the board took it from KiCad's default; left out of the project so KiCad's default applies again", defaultsKept);
    if (setupMerged) rep.approximated("board-wide minimum", "two or more board-wide floor rules of one check: the largest is written as KiCad's board setup minimum", setupMerged);

    // ---- the project
    const toMm = (nm: number) => Number(mmExact(nm));
    const rulesJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(setup)) rulesJson[k] = toMm(v);
    const known = new Set(classes.map((c) => c.name));
    for (const k of classValues.keys()) if (k !== "default" && !known.has(k)) known.add(k);
    const classList: Record<string, unknown>[] = [];
    const classJson = (ours: string, priority: number) => {
      const v = classValues.get(ours) ?? {};
      const o: Record<string, unknown> = { name: className(ours), priority };
      for (const f of ["clearance", "track_width", "via_diameter", "via_drill", "diff_pair_gap"]) if (v[f] !== undefined) o[f] = toMm(v[f]);
      return o;
    };
    classList.push(classJson("default", 2147483647));
    [...known].forEach((c, i) => classList.push(classJson(c, i)));
    stats.netclasses = known.size;
    const assignments: Record<string, string> = {};
    for (const n of nets) {
      const c = netClassOf(doc, n);
      if (c && c !== "default") {
        assignments[n] = className(c);
        if (!known.has(c)) {
          known.add(c);
          classList.push(classJson(c, classList.length - 1));
          stats.netclasses++;
        }
      }
    }
    const patterns: { netclass: string; pattern: string }[] = [];
    for (const c of classes) for (const p of c.patterns ?? []) patterns.push({ netclass: className(c.name), pattern: p });
    rep.info("violation severity", "KiCad's severities are written for the checks the board's rules set one for; every other KiCad check (silkscreen, courtyards, library and the like) takes KiCad's default, as the document keeps no severity for checks it has no rule for", Object.keys(severities).length || 1);
    const pro = {
      board: { design_settings: { meta: { version: 2 }, rules: rulesJson, rule_severities: severities } },
      meta: { filename: `${name}.kicad_pro`, version: 3 },
      net_settings: { classes: classList, meta: { version: 4 }, netclass_assignments: Object.keys(assignments).length ? assignments : null, netclass_patterns: patterns },
    };

    // ---- custom rules, in precedence order (KiCad: the last matching rule wins)
    const order = [...custom].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    interface Group {
      name: string;
      /** The importer's custom rule this came from (its constraints are written back as one rule). */
      custom: boolean;
      priority: number;
      layer?: string;
      condition?: string;
      severity?: string;
      /** Whether a checked constraint (min, max, disallow) is in it, which the severity applies to. */
      checked: boolean;
      /** Constraint type -> its values (`min`, `max`, `opt`) or a whole disallow constraint. */
      constraints: Map<string, { min?: number; max?: number; opt?: number } | string>;
    }
    const groups: Group[] = [];
    const used = new Set<string>();
    let renumbered = false;
    for (const r of order) {
      try {
        const terms: string[] = [];
        let layer: string | undefined;
        const ap = r.applies;
        if (ap.region) throw new Unexpressible("a rule limited to a drawn region has no KiCad condition");
        if (ap.layers?.length) {
          const cu = ap.layers.filter((l): l is CopperLayer => copperSet.has(l as CopperLayer));
          const set = new Set(cu);
          const outer = copper.filter((l) => l === "top" || l === "bottom");
          const inner = copper.filter((l) => l.startsWith("inner"));
          if (cu.length === ap.layers.length && cu.length === 1) layer = q(COPPER_NAME(cu[0]));
          else if (cu.length === ap.layers.length && set.size === outer.length && outer.every((l) => set.has(l))) layer = "outer";
          else if (cu.length === ap.layers.length && inner.length && set.size === inner.length && inner.every((l) => set.has(l))) layer = "inner";
          else terms.push(orOf(ap.layers.map((l) => `A.Layer == ${lit(layerName(l))}`)));
        }
        if (ap.nets?.length) terms.push(orOf(ap.nets.map((n) => `A.NetName == ${lit(n)}`)));
        if (ap.classes?.length) terms.push(orOf(ap.classes.map((c) => `A.NetClass == ${lit(className(c))}`)));
        if (ap.between) {
          const [a, b] = ap.between;
          if (!TYPE_NAME[a] || !TYPE_NAME[b]) throw new Unexpressible(`a rule between ${a} and ${b} has no KiCad type`);
          terms.push(`(A.Type == '${TYPE_NAME[a]}' && B.Type == '${TYPE_NAME[b]}')`);
        }
        let ctype: string;
        let values: { min?: number; max?: number; opt?: number } | string;
        let when = ap.when;
        if (r.check === "disallow") {
          // the importer writes a disallow rule's object kinds as its first condition term
          let kinds: string[] = ["track", "via", "pad", "zone", "footprint"];
          if (when && "side" in when && "kind" in when && when.side === "A") {
            kinds = when.kind;
            when = undefined;
          } else if (when && "all" in when && when.all[0] && "kind" in when.all[0] && when.all[0].side === "A") {
            kinds = (when.all[0] as { kind: string[] }).kind;
            const rest = when.all.slice(1);
            when = rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : { all: rest };
          } else rep.approximated("disallow rule without object kinds", "written as disallowing tracks, vias, pads, zones and footprints", 1);
          const bad = kinds.filter((k) => !TYPE_NAME[k]);
          if (bad.length) throw new Unexpressible(`KiCad cannot disallow ${bad.join(", ")}`);
          ctype = `disallow ${kinds.join(" ")}`;
          values = `(constraint disallow ${kinds.join(" ")})`;
        } else {
          const c = CONSTRAINT[r.check];
          if (!c) throw new Unexpressible(`no KiCad constraint the importer reads back measures ${r.check} the same way`);
          ctype = c;
          if (r.check === "via_hole") terms.push("A.Type == 'Via'");
          if (r.min === undefined && r.max === undefined && r.preferred === undefined) throw new Unexpressible("the rule has no min, max or preferred value");
          values = { ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}), ...(r.preferred !== undefined ? { opt: r.preferred } : {}) };
          if (r.tier === "target" && (r.min !== undefined || r.max !== undefined)) rep.approximated("target rule with a minimum or maximum", "written as a KiCad constraint, which KiCad checks (it comes back as a floor rule)", 1);
          if (r.tier === "policy") rep.approximated("policy rule", "written as a KiCad custom rule, which KiCad checks at the rule's severity (it comes back as a floor rule)", 1);
          if (r.tier === "no_go") rep.approximated("no-go rule other than a disallow", "written as a KiCad custom rule (it comes back as a floor rule)", 1);
        }
        if (when) terms.push(conditionText(when, ctx, terms.length === 0));
        if (r.check === "via_hole") rep.approximated("via hole rule", "written as KiCad's hole_size limited to vias (it comes back as a hole_size rule)", 1);
        // a rule at priority 0 with a scope combines with the board-wide minimums here; in KiCad a custom rule overrides them
        if (!r.priority && r.tier === "floor") rep.approximated("floor rule with a scope at priority 0", "written as a KiCad custom rule, which overrides the board setup and net class minimums where it applies instead of combining with them", 1);
        const condition = terms.length ? terms.join(" && ") : undefined;
        // the severity clause: only when the rule's differs from what KiCad gives the violation type
        const type = r.check === "disallow" ? "items_not_allowed" : KICAD_VIOLATION_TYPE[r.check];
        const kicadSev = (type && (severities[type] ?? KICAD_DEFAULT_SEVERITY[type])) ?? "error";
        const checked = r.check === "disallow" || r.min !== undefined || r.max !== undefined;
        const severity = !checked ? undefined : sevOf(r) === kicadSev ? undefined : sevOf(r);
        const fromCustom = customRuleName(r);
        const nameFrom = fromCustom ?? r.id.replace(/^rule:/, "");
        const prio = r.priority ?? 0;
        // the constraints of one imported custom rule (same name, place, scope; one severity for its checked ones) go back into one rule
        const g =
          fromCustom !== undefined
            ? groups.find((x) => x.custom && x.name === nameFrom && x.priority === prio && x.layer === layer && x.condition === condition && (!checked || !x.checked || x.severity === severity))
            : undefined;
        if (g) {
          const had = g.constraints.get(ctype);
          if (typeof values !== "string" && had !== undefined && typeof had !== "string") {
            const v = values;
            const clash = (k: "min" | "max" | "opt") => v[k] !== undefined && had[k] !== undefined && had[k] !== v[k];
            if (clash("min") || clash("max") || clash("opt")) throw new Unexpressible(`two values of one ${ctype} constraint in one rule`);
            g.constraints.set(ctype, { ...had, ...v });
          } else g.constraints.set(ctype, values);
          if (checked) {
            g.checked = true;
            if (severity) g.severity = severity;
          }
        } else {
          let gname = nameFrom;
          for (let n = 2; used.has(gname); n++) gname = `${nameFrom} ${n}`;
          used.add(gname);
          groups.push({ name: gname, custom: fromCustom !== undefined, priority: prio, ...(layer ? { layer } : {}), ...(condition ? { condition } : {}), ...(severity ? { severity } : {}), checked, constraints: new Map([[ctype, values]]) });
        }
      } catch (e) {
        if (!(e instanceof Unexpressible)) throw e;
        rep.dropped("rule not written", `${r.id}: ${e.message}`, 1);
      }
    }
    // the importer numbers custom rules by their place in the file: a gap (a rule it could not read) closes up here
    groups.forEach((g, i) => {
      if (g.priority >= 1000 && g.priority !== 1000 + i + 1) renumbered = true;
    });
    if (renumbered) rep.info("custom rule position", "rules the import left out are not in the file, so later rules move up: read back, their ids and priorities renumber (their order, and so KiCad's precedence, is kept)");
    stats.customRules = groups.length;
    let dru: string | undefined;
    if (groups.length) {
      const lines = ["(version 1)", "# Custom rules written by Protoboard's KiCad exporter, in precedence order (in KiCad the last matching rule wins)."];
      for (const g of groups) {
        lines.push(`(rule ${q(g.name)}`);
        if (g.layer) lines.push(`\t(layer ${g.layer})`);
        if (g.condition) lines.push(`\t(condition ${q(g.condition)})`);
        if (g.severity) lines.push(`\t(severity ${g.severity})`);
        for (const [type, v] of g.constraints) {
          if (typeof v === "string") lines.push(`\t${v}`);
          else lines.push(`\t(constraint ${type}${v.min !== undefined ? ` (min ${mmExact(v.min)}mm)` : ""}${v.max !== undefined ? ` (max ${mmExact(v.max)}mm)` : ""}${v.opt !== undefined ? ` (opt ${mmExact(v.opt)}mm)` : ""})`);
        }
        lines[lines.length - 1] += ")";
      }
      dru = lines.join("\n") + "\n";
    }
    return { pro: JSON.stringify(pro, null, 2) + "\n", ...(dru !== undefined ? { dru } : {}) };
  }
}
