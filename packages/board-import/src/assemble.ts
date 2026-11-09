/**
 * The last steps every importer shares: center the board on the origin, give imported and generated objects their
 * deterministic ids (contract section 3), validate every record against the core's schema (a record that fails is
 * dropped and reported, so the document always loads), and build the document and its derived fill.
 */
import {
  AnyRecord,
  contourBox,
  createDocument,
  deterministicKey,
  emptyBox,
  isEmptyBox,
  addPoint,
  unionBox,
  boundsOf,
  createZoneFill,
  Netlist as NetlistSchema,
  type BoardRec,
  type BoardRecord,
  type CutoutRec,
  type FootprintRec,
  type GraphicRec,
  type KeepoutRec,
  type LayerRec,
  type Netlist,
  type NetclassRec,
  type OutlineRec,
  type Point,
  type RuleRec,
  type TextRec,
  type TrackRec,
  type Vertex,
  type ViaRec,
  type ZoneRec,
} from "@protoboardai/board";
import { shiftFill, type DerivedFill, type FillEntry } from "./fill.js";
import type { Reporter } from "./report.js";
import type { ImportStats } from "./types.js";

type NoId<T> = Omit<T, "id">;

export interface Draft {
  board: BoardRec;
  layers: LayerRec[];
  outline?: OutlineRec;
  cutouts: NoId<CutoutRec>[];
  footprints: FootprintRec[];
  tracks: NoId<TrackRec>[];
  vias: NoId<ViaRec>[];
  /** Zones with the fill each was saved with (entries without `zone`; it is filled in here). */
  zones: { rec: NoId<ZoneRec>; fills: Omit<FillEntry, "zone">[] }[];
  /** Fills with no zone record (Circuit JSON pours). */
  looseFills: FillEntry[];
  keepouts: NoId<KeepoutRec>[];
  graphics: NoId<GraphicRec>[];
  texts: NoId<TextRec>[];
  netclasses: NetclassRec[];
  rules: RuleRec[];
}

export const emptyDraft = (board: BoardRec): Draft => ({ board, layers: [], cutouts: [], footprints: [], tracks: [], vias: [], zones: [], looseFills: [], keepouts: [], graphics: [], texts: [], netclasses: [], rules: [] });

const shiftPt = (p: Point, dx: number, dy: number): Point => ({ x: p.x - dx, y: p.y - dy });
const shiftContour = (c: readonly Vertex[], dx: number, dy: number): Vertex[] => c.map((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));

/** Move every world coordinate of the draft by (-dx, -dy). Footprint-frame coordinates do not move. */
function shiftDraft(d: Draft, dx: number, dy: number): void {
  if (!dx && !dy) return;
  if (d.outline) d.outline = { ...d.outline, outline: shiftContour(d.outline.outline, dx, dy) };
  d.cutouts = d.cutouts.map((c) => ({ ...c, outline: shiftContour(c.outline, dx, dy) }));
  d.footprints = d.footprints.map((f) => ({ ...f, x: f.x - dx, y: f.y - dy }));
  d.tracks = d.tracks.map((t) => ({ ...t, start: shiftPt(t.start, dx, dy), end: shiftPt(t.end, dx, dy) }));
  d.vias = d.vias.map((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  d.zones = d.zones.map((z) => ({ ...z, rec: { ...z.rec, outline: shiftContour(z.rec.outline, dx, dy) } }));
  d.keepouts = d.keepouts.map((k) => ({ ...k, outline: shiftContour(k.outline, dx, dy) }));
  d.graphics = d.graphics.map((g) => ({
    ...g,
    ...(g.start ? { start: shiftPt(g.start, dx, dy) } : {}),
    ...(g.end ? { end: shiftPt(g.end, dx, dy) } : {}),
    ...(g.center ? { center: shiftPt(g.center, dx, dy) } : {}),
    ...(g.points ? { points: shiftContour(g.points, dx, dy) } : {}),
  }));
  d.texts = d.texts.map((t) => ({ ...t, x: t.x - dx, y: t.y - dy }));
  d.rules = d.rules.map((r) => (r.applies.region ? { ...r, applies: { ...r.applies, region: shiftContour(r.applies.region, dx, dy) } } : r));
  for (const z of d.zones) shiftFill(z.fills as FillEntry[], dx, dy);
  shiftFill(d.looseFills, dx, dy);
}

/** The point the board is centered on: its outline's box center, else the box of everything placed. */
function centerOf(d: Draft, rep: Reporter): Point {
  if (d.outline) {
    const b = contourBox(d.outline.outline);
    return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
  }
  let b = emptyBox();
  for (const f of d.footprints) addPoint(b, f.x, f.y);
  for (const t of d.tracks) {
    addPoint(b, t.start.x, t.start.y);
    addPoint(b, t.end.x, t.end.y);
  }
  for (const v of d.vias) addPoint(b, v.x, v.y);
  for (const z of d.zones) b = unionBox(b, contourBox(z.rec.outline));
  if (isEmptyBox(b)) return { x: 0, y: 0 };
  rep.approximated("board without an outline", "centered on the box of its footprints and copper instead");
  return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
}

const identity = (r: Record<string, unknown>): Record<string, unknown> => {
  const { kind: _k, id: _i, provenance: _p, locked: _l, ...rest } = r;
  return rest;
};

export interface Assembled {
  document: ReturnType<typeof createDocument>;
  fill: DerivedFill;
  offset: Point;
  stats: ImportStats;
}

export function assemble(d: Draft, opts: { netlist: Netlist; source: DerivedFill["source"]; rep: Reporter; recenter?: boolean; tag?: string }): Assembled {
  const rep = opts.rep;
  const offset = opts.recenter === false ? { x: 0, y: 0 } : centerOf(d, rep);
  shiftDraft(d, offset.x, offset.y);

  const used = new Set<string>();
  let collisions = 0;
  const idFor = (prefix: string, rec: Record<string, unknown>): string => {
    const base = deterministicKey(prefix, identity(rec), opts.tag);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}~${n}`;
    if (id !== base) collisions++;
    used.add(id);
    return id;
  };
  const records: BoardRecord[] = [d.board, ...d.layers];
  if (d.outline) records.push(d.outline);
  for (const r of [...d.footprints, ...d.netclasses, ...d.rules]) {
    used.add(r.id);
    records.push(r);
  }
  for (const c of d.cutouts) records.push({ ...c, id: idFor("cutout", c) } as CutoutRec);
  for (const t of d.tracks) records.push({ ...t, id: idFor("trk", t) } as TrackRec);
  for (const v of d.vias) records.push({ ...v, id: idFor("via", v) } as ViaRec);
  for (const k of d.keepouts) records.push({ ...k, id: idFor("kpo", k) } as KeepoutRec);
  for (const g of d.graphics) records.push({ ...g, id: idFor("gfx", g) } as GraphicRec);
  for (const t of d.texts) records.push({ ...t, id: idFor("txt", t) } as TextRec);
  const fills: FillEntry[] = [];
  for (const z of d.zones) {
    const id = idFor("zone", z.rec);
    records.push({ ...z.rec, id } as ZoneRec);
    for (const f of z.fills) fills.push({ zone: id, ...f });
  }
  fills.push(...d.looseFills);
  if (collisions) rep.info("object with an exact twin", "imported with the twin's id plus ~2, ~3 (the source has identical copies)", { count: collisions });

  // every record must pass the core's schema; one that does not is left out and reported
  const valid: BoardRecord[] = [];
  const validZones = new Set<string>();
  for (const r of records) {
    const res = AnyRecord.safeParse(r);
    if (res.success) {
      valid.push(r);
      if (r.kind === "zone") validZones.add(r.id);
      continue;
    }
    const issue = res.error.issues[0];
    rep.dropped(`${r.kind} record`, `fails the board schema (${issue.path.join(".") || "record"}: ${issue.message})`, { id: r.id });
  }
  const zoneFills = fills.filter((f) => !f.zone || validZones.has(f.zone));

  const netlist = NetlistSchema.parse(opts.netlist);
  const document = createDocument(valid, netlist);
  const made = createZoneFill(document, opts.source, zoneFills);
  const fill: DerivedFill = made.fill;
  if (made.droppedRings) rep.dropped("zone fill ring", "fewer than three points after removing repeats", { count: made.droppedRings });

  const count = (k: BoardRecord["kind"]) => valid.filter((r) => r.kind === k).length;
  const stats: ImportStats = {
    footprints: count("footprint"),
    pads: valid.reduce((s, r) => s + (r.kind === "footprint" ? r.pads.length : 0), 0),
    tracks: count("track"),
    arcs: valid.filter((r) => r.kind === "track" && r.sweep !== undefined).length,
    vias: count("via"),
    zones: count("zone"),
    keepouts: count("keepout"),
    nets: netlist.nets.length,
    graphics: count("graphic"),
    texts: count("text"),
    cutouts: count("cutout"),
    netclasses: count("netclass"),
    rules: count("rule"),
    layers: count("layer"),
    fillPolygons: fill.fills.reduce((s, f) => s + f.polygons.length, 0),
  };
  // boundsOf is the core's: a record it cannot measure is a sign of a bad record (kept, but noted)
  for (const r of valid) if (r.kind !== "board" && r.kind !== "layer" && r.kind !== "netclass" && r.kind !== "rule" && !boundsOf(r)) rep.info("record without a box", "the core could not measure it", { id: r.id });
  return { document, fill, offset, stats };
}
