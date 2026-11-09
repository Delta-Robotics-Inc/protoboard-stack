/**
 * One PCB document of an EasyEDA Pro project mapped to the board document (contract section 4).
 *
 * Units and axes (see README for the evidence):
 * - lengths are read as mils (0.001 inch, 25,400 nm). The documentation states 0.01 inch; every export checked uses
 *   mils (a 0.5 mm track is 19.685, a 1.6 mm stackup sums to 62.99).
 * - +Y is up and angles are counterclockwise positive in the file's own coordinates, as the documentation states
 *   and the stored text outlines (FONT cache) show, so no axis is negated.
 * - a component at (x, y) with angle a puts a footprint point p at (x, y) + R(a) p on the top, and at
 *   (x, y) + R(a) (px, -py) on the bottom (checked against the track ends on pads of every export). The board
 *   document mirrors bottom footprints left to right, so a bottom footprint gets rotation a + 180.
 * - the board is recentered on the center of its outline's bounding box; the offset is reported.
 */
import {
  AnyRecord,
  COPPER_LAYERS,
  createDocument,
  createZoneFill,
  deg,
  mil,
  Netlist as NetlistSchema,
  normAngle,
  type AnyLayer,
  type BoardDocument,
  type BoardRecord,
  type CopperLayer,
  type DrawingLayer,
  type FootprintGraphic,
  type FootprintRec,
  type FootprintText,
  type GraphicRec,
  type ImportResult,
  type KeepoutRec,
  type LayerRec,
  type Netlist,
  type Pad,
  type Provenance,
  type Vertex,
  type ZoneRec,
} from "@protoboardai/board";
import { ringsToPolygons, type DerivedFill, type FillEntry } from "./fill.js";
import { circleRing, flatten, newNotes, parseComplex, parseSingle, signedArea2, type ParseNotes, type PVertex, type Shape } from "./path.js";
import { idParts, listPcbs, records, type Json, type Obj, type SourceDoc, type SourceProject, type SourceRecord } from "./project.js";
import { Reporter } from "./report.js";

export const IMPORTER_ID = "easyeda-pro";
const PROVENANCE: Provenance = { by: "imported", tool: IMPORTER_ID };
/** Format units in nanometers (see the module comment). */
export const UNIT_NM = 25_400;

export interface ConvertOptions {
  /** The PCB document to import, by uuid or title. Default: the first board's PCB, else the PCB with most records. */
  pcb?: string;
}

export type Handling = "mapped" | "ignored" | "dropped";

export interface EasyEdaImportResult extends ImportResult {
  document: BoardDocument;
  netlist: Netlist;
  /** The fill EasyEDA computed for pours, and FILL copper, as derived data. */
  fill: DerivedFill;
  /** What was subtracted from every source coordinate (nanometers) to center the board. */
  offset: { x: number; y: number };
  format: 2 | 3;
  pcb: { uuid: string; title: string };
  pcbs: { uuid: string; title: string; board?: string; records: number }[];
  /** Every record type read from the PCB document and the footprints it uses, with counts and how it was handled. */
  recordTypes: Record<string, { count: number; handling: Handling }>;
}

/** How each record type is handled. Types not listed are dropped as unknown. */
export const HANDLING: Record<string, Handling> = {
  META: "mapped",
  LAYER: "mapped",
  LAYER_PHYS: "mapped",
  NET: "mapped",
  COMPONENT: "mapped",
  ATTR: "mapped",
  PAD_NET: "mapped",
  PAD: "mapped",
  VIA: "mapped",
  LINE: "mapped",
  ARC: "mapped",
  CARC: "mapped",
  POLY: "mapped",
  FILL: "mapped",
  POUR: "mapped",
  POURED: "mapped",
  REGION: "mapped",
  STRING: "mapped",
  // editor state and settings: nothing on the board
  CANVAS: "ignored",
  ACTIVE_LAYER: "ignored",
  PRIMITIVE: "ignored",
  PREFERENCE: "ignored",
  SILK_OPTS: "ignored",
  GROUP: "ignored",
  ITEM_ORDER: "ignored",
  PROP: "ignored",
  CONNECT: "ignored",
  ELE_PLACEHOLDER: "ignored",
  PANELIZE: "ignored",
  PANELIZE_STAMP: "ignored",
  PANELIZE_SIDE: "ignored",
  RULE_TEMPLATE: "ignored",
  FONT: "ignored",
  META_CREATE: "ignored",
  META_MODIFY: "ignored",
  // content the board document does not model, or whose contents are not documented
  RULE: "dropped",
  RULE_SELECTOR: "dropped",
  DIMENSION: "dropped",
  IMAGE: "dropped",
  OBJ: "dropped",
  TEARDROP: "dropped",
  FPC_FILL: "dropped",
  SHELL: "dropped",
  CREASE: "dropped",
  SHELL_ENTITY: "dropped",
  BOSS: "dropped",
  EQLEN_GRP: "dropped",
  EQLEN: "dropped",
  REUSE_BLOCK: "dropped",
  PARTITION: "dropped",
};

const DROP_REASON: Record<string, string> = {
  RULE: "design rule contents are left to the editor by the documentation (not specified), so rules are not imported",
  RULE_SELECTOR: "rule selectors point at rules, which are not imported",
  DIMENSION: "dimensions are not modeled by the board document",
  IMAGE: "images are not modeled",
  OBJ: "embedded objects are not modeled",
  TEARDROP: "teardrops are derived copper and are not modeled",
  FPC_FILL: "flex stiffeners are not modeled",
  EQLEN_GRP: "equal-length groups are not modeled",
  EQLEN: "equal-length groups are not modeled",
  REUSE_BLOCK: "reuse blocks are not modeled",
  PARTITION: "partitions are not modeled",
};

// ---------------------------------------------------------------- small helpers

const isNum = (v: Json | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: Json | undefined, d = 0): number => (isNum(v) ? v : d);
const str = (v: Json | undefined): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const truthy = (v: Json | undefined): boolean => v === true || v === 1 || v === "1";
const KEY_BAD = /[^A-Za-z0-9_.\-/+~]/g;
const key = (id: string): string => id.replace(KEY_BAD, "_").slice(0, 180) || "_";
const clampSweep = (degrees: number): number | undefined => {
  let s = deg(degrees);
  if (s > 360_000) s = 360_000;
  if (s < -360_000) s = -360_000;
  return s === 0 ? undefined : s;
};

/** Layer types (documented) to the board document's drawing layers. */
const DRAWING: Record<string, DrawingLayer> = {
  TOP_SILK: "top_silkscreen",
  BOT_SILK: "bottom_silkscreen",
  TOP_SOLDER_MASK: "top_soldermask",
  BOT_SOLDER_MASK: "bottom_soldermask",
  TOP_PASTE_MASK: "top_paste",
  BOT_PASTE_MASK: "bottom_paste",
  TOP_ASSEMBLY: "top_fabrication",
  BOT_ASSEMBLY: "bottom_fabrication",
  DOCUMENT: "user_notes",
  MECHANICAL: "user_notes",
};
/** The example numbering of the documentation, used when a document carries no layer table. */
const DEFAULT_LAYER_TYPES: Record<number, string> = {
  1: "TOP",
  2: "BOTTOM",
  3: "TOP_SILK",
  4: "BOT_SILK",
  5: "TOP_SOLDER_MASK",
  6: "BOT_SOLDER_MASK",
  7: "TOP_PASTE_MASK",
  8: "BOT_PASTE_MASK",
  9: "TOP_ASSEMBLY",
  10: "BOT_ASSEMBLY",
  11: "OUTLINE",
  12: "MULTI",
  13: "DOCUMENT",
  14: "MECHANICAL",
};
const flipSide = (l: AnyLayer): AnyLayer => (l === "top" ? "bottom" : l === "bottom" ? "top" : l.startsWith("top_") ? (l.replace("top_", "bottom_") as AnyLayer) : l.startsWith("bottom_") ? (l.replace("bottom_", "top_") as AnyLayer) : l);

interface LayerInfo {
  id: number;
  type: string;
  name: string;
  use: boolean;
  seq: number;
}

function layerTable(doc: SourceDoc | undefined): Map<number, LayerInfo> {
  const out = new Map<number, LayerInfo>();
  for (const r of records(doc, "LAYER")) {
    const parts = idParts(r.id);
    const id = isNum(r.data.layerId) ? r.data.layerId : (parts.find(isNum) as number | undefined);
    if (id === undefined) continue;
    const use = r.data.use !== undefined ? truthy(r.data.use) : isNum(r.data.status) ? (r.data.status & 1) === 1 : true;
    out.set(id, { id, type: str(r.data.layerType), name: str(r.data.layerName), use, seq: r.seq });
  }
  return out;
}

// ---------------------------------------------------------------- the converter

class Converter {
  readonly rep = new Reporter();
  readonly notes: ParseNotes = newNotes();
  readonly out: BoardRecord[] = [];
  readonly fills: FillEntry[] = [];
  readonly netPins = new Map<string, Set<string>>();
  readonly netNames = new Set<string>();
  readonly layers: Map<number, LayerInfo>;
  readonly copperById = new Map<number, CopperLayer>();
  copper: CopperLayer[] = [];
  ox = 0;
  oy = 0;
  readonly usedIds = new Set<string>();
  readonly refs = new Set<string>();
  readonly footprintDocsUsed = new Set<string>();

  constructor(
    readonly p: SourceProject,
    readonly pcb: SourceDoc,
  ) {
    this.layers = layerTable(pcb);
  }

  // ---- coordinates
  X = (v: Json | undefined): number => mil(num(v)) - this.ox;
  Y = (v: Json | undefined): number => mil(num(v)) - this.oy;
  L = (v: Json | undefined): number => mil(num(v));

  uid(prefix: string, raw: string): string {
    let id = `${prefix}:${key(raw)}`;
    for (let n = 2; this.usedIds.has(id); n++) id = `${prefix}:${key(raw)}.${n}`;
    this.usedIds.add(id);
    return id;
  }

  push(r: BoardRecord, source: string): void {
    const v = AnyRecord.safeParse(r);
    if (!v.success) {
      const issue = v.error.issues[0];
      this.rep.dropped(`${r.kind} objects`, `failed the board schema after conversion (${issue.path.join(".")}: ${issue.message})`, { source });
      return;
    }
    this.out.push(v.data as BoardRecord);
  }

  useNet(name: string): string | undefined {
    if (!name) return undefined;
    this.netNames.add(name);
    return name;
  }

  private readonly tables = new WeakMap<SourceDoc, Map<number, LayerInfo>>();
  layerType(id: number, doc?: SourceDoc): string {
    let t: Map<number, LayerInfo> | undefined;
    if (doc && doc !== this.pcb) {
      t = this.tables.get(doc);
      if (!t) this.tables.set(doc, (t = layerTable(doc)));
    }
    const own = t?.get(id);
    return own?.type ?? this.layers.get(id)?.type ?? DEFAULT_LAYER_TYPES[id] ?? `LAYER_${id}`;
  }

  /** A copper layer name for a layer id, or undefined. */
  copperOf(id: number): CopperLayer | undefined {
    return this.copperById.get(id);
  }

  /** The board layer (copper or drawing) for a layer id, or undefined with the layer type. */
  anyLayer(id: number, doc?: SourceDoc): { layer?: AnyLayer; type: string } {
    const type = this.layerType(id, doc);
    if (type === "TOP") return { layer: "top", type };
    if (type === "BOTTOM") return { layer: "bottom", type };
    const c = this.copperOf(id);
    if (c) return { layer: c, type };
    const d = DRAWING[type];
    return d ? { layer: d, type } : { type };
  }

  // ---- stackup

  stackup(): void {
    const inner = [...this.layers.values()].filter((l) => l.use && (l.type === "SIGNAL" || l.type === "PLANE")).sort((a, b) => a.seq - b.seq || a.id - b.id);
    const top = [...this.layers.values()].find((l) => l.type === "TOP") ?? { id: 1, type: "TOP", name: "Top Layer", use: true, seq: 0 };
    const bottom = [...this.layers.values()].find((l) => l.type === "BOTTOM") ?? { id: 2, type: "BOTTOM", name: "Bottom Layer", use: true, seq: 0 };
    if (inner.length > 8) {
      this.rep.dropped("inner copper layers", "the board document has at most 8 inner layers; the extra layers and their copper are left out", { count: inner.length - 8 });
      inner.length = 8;
    }
    this.copperById.set(top.id, "top");
    inner.forEach((l, i) => this.copperById.set(l.id, COPPER_LAYERS[i + 1]));
    this.copperById.set(bottom.id, "bottom");
    this.copper = ["top", ...inner.map((_, i) => COPPER_LAYERS[i + 1]), "bottom"];

    // the physical stack: LAYER_PHYS records in their stored order (zIndex, else order of appearance)
    const phys = records(this.pcb, "LAYER_PHYS")
      .map((r) => ({ r, id: isNum(r.data.layerId) ? r.data.layerId : (idParts(r.id).find(isNum) as number | undefined) }))
      .sort((a, b) => num(a.r.data.zIndex, a.r.seq) - num(b.r.data.zIndex, b.r.seq) || a.r.seq - b.r.seq);
    const stack: Omit<LayerRec, "order">[] = [];
    let dielectrics = 0;
    let defaulted = 0;
    const seenCopper = new Set<string>();
    const copperRec = (name: CopperLayer, t: number): Omit<LayerRec, "order"> => ({ kind: "layer", id: `layer:${name}`, name, type: "copper", thickness: t });
    for (const { r, id } of phys) {
      const t = num(r.data.thickness);
      const type = id === undefined ? "" : this.layerType(id);
      const c = id === undefined ? undefined : this.copperOf(id);
      if (c) {
        if (t <= 0) defaulted++;
        stack.push(copperRec(c, t > 0 ? mil(t) : 35_000));
        seenCopper.add(c);
      } else if (type === "TOP_SOLDER_MASK" || type === "BOT_SOLDER_MASK") {
        if (t > 0) {
          const name = type === "TOP_SOLDER_MASK" ? "top_mask" : "bottom_mask";
          stack.push({ kind: "layer", id: `layer:${name}`, name, type: "soldermask", thickness: mil(t), ...(num(r.data.permittivity) > 0 ? { epsilon_r: num(r.data.permittivity) } : {}) });
        }
      } else if ((type === "SUBSTRATE" || id === undefined || !this.layers.has(id)) && t > 0) {
        dielectrics++;
        const material = str(r.data.material);
        stack.push({
          kind: "layer",
          id: `layer:dielectric${dielectrics}`,
          name: `dielectric${dielectrics}`,
          type: "dielectric",
          thickness: mil(t),
          ...(material ? { material: material.slice(0, 60) } : {}),
          ...(num(r.data.permittivity) > 0 ? { epsilon_r: num(r.data.permittivity) } : {}),
          ...(num(r.data.lossTangent) > 0 ? { loss_tangent: num(r.data.lossTangent) } : {}),
        });
      }
    }
    // every copper layer present and in order, with a dielectric between neighbors
    const ok = this.copper.every((c) => seenCopper.has(c)) && stack.filter((l) => l.type === "copper").map((l) => l.name).join() === this.copper.join();
    let layers: Omit<LayerRec, "order">[] = stack;
    if (!ok) {
      this.rep.approximated("stackup", "the physical layer data does not list every copper layer in order; a default stackup (35 um copper, 1.6 mm total) is used");
      const core = Math.round((1_600_000 - 35_000 * this.copper.length) / Math.max(1, this.copper.length - 1));
      layers = [];
      this.copper.forEach((c, i) => {
        layers.push(copperRec(c, 35_000));
        if (i < this.copper.length - 1) layers.push({ kind: "layer", id: `layer:dielectric${i + 1}`, name: `dielectric${i + 1}`, type: "dielectric", thickness: core });
      });
    } else {
      if (defaulted) this.rep.approximated("copper layer thicknesses", "not given; 35 um used", { count: defaulted });
      // a missing dielectric between two copper layers gets an even share of 1.6 mm
      const fixed: Omit<LayerRec, "order">[] = [];
      layers.forEach((l, i) => {
        fixed.push(l);
        if (l.type !== "copper") return;
        const next = layers.slice(i + 1).find((x) => x.type !== "soldermask");
        if (next?.type === "copper") {
          dielectrics++;
          this.rep.approximated("dielectric layers", "missing between two copper layers; a default thickness is used");
          fixed.push({ kind: "layer", id: `layer:dielectric${dielectrics}`, name: `dielectric${dielectrics}`, type: "dielectric", thickness: Math.round(1_530_000 / Math.max(1, this.copper.length - 1)) });
        }
      });
      layers = fixed;
    }
    const thickness = layers.reduce((s, l) => s + l.thickness, 0);
    layers.forEach((l, order) => this.push({ ...l, order } as LayerRec, "LAYER_PHYS"));
    this.thickness = thickness > 0 ? thickness : 1_600_000;
  }
  thickness = 1_600_000;

  // ---- outline

  outline(): void {
    type Piece = { pts: PVertex[]; src: string; locked: boolean };
    const closed: Piece[] = [];
    const open: Piece[] = [];
    const isOutline = (r: SourceRecord) => this.layerType(num(r.data.layerId)) === "OUTLINE" || r.data.polyType === "BOARD_OUTLINE";
    for (const r of records(this.pcb, "POLY")) {
      if (!isOutline(r)) continue;
      const s = parseSingle(r.data.path, this.notes);
      if (!s) continue;
      if (s.kind === "circle") closed.push({ pts: circleRing(s.cx, s.cy, s.r), src: r.id, locked: truthy(r.data.locked) });
      else (s.closed ? closed : open).push({ pts: s.pts, src: r.id, locked: truthy(r.data.locked) });
    }
    for (const t of ["LINE", "ARC", "CARC"])
      for (const r of records(this.pcb, t)) {
        if (!isOutline(r)) continue;
        const sw = t === "LINE" ? 0 : num(r.data.angle);
        open.push({ pts: [{ x: num(r.data.startX), y: num(r.data.startY), ...(sw ? { sweep: sw } : {}) }, { x: num(r.data.endX), y: num(r.data.endY) }], src: r.id, locked: truthy(r.data.locked) });
      }
    // chain open pieces end to end
    const tol = 0.05;
    const near = (a: PVertex, b: PVertex) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
    const rev = (pts: PVertex[]): PVertex[] => {
      const n = pts.length;
      return pts.map((_, k) => {
        const v = pts[n - 1 - k];
        const s = k < n - 1 ? pts[n - 2 - k].sweep : undefined;
        return { x: v.x, y: v.y, ...(s ? { sweep: -s } : {}) };
      });
    };
    let unclosed = 0;
    const pool = [...open];
    while (pool.length) {
      let chain = pool.shift()!;
      let grew = true;
      while (grew && !(chain.pts.length > 2 && near(chain.pts[0], chain.pts[chain.pts.length - 1]))) {
        grew = false;
        const end = chain.pts[chain.pts.length - 1];
        for (let i = 0; i < pool.length; i++) {
          const q = pool[i];
          const qs = near(q.pts[0], end) ? q.pts : near(q.pts[q.pts.length - 1], end) ? rev(q.pts) : undefined;
          if (!qs) continue;
          // the joint is the chain's end, carrying the sweep of the next piece's first edge
          const merged = [...chain.pts.slice(0, -1), { x: end.x, y: end.y, ...(qs[0].sweep ? { sweep: qs[0].sweep } : {}) }, ...qs.slice(1)];
          chain = { pts: merged, src: chain.src, locked: chain.locked && q.locked };
          pool.splice(i, 1);
          grew = true;
          break;
        }
      }
      // closed: drop the repeated first point (the edge into it stays on the vertex before it)
      if (chain.pts.length > 2 && near(chain.pts[0], chain.pts[chain.pts.length - 1])) closed.push({ pts: chain.pts.slice(0, -1), src: chain.src, locked: chain.locked });
      else unclosed++;
    }
    if (unclosed) this.rep.dropped("board outline pieces", "do not close into a loop", { count: unclosed });
    const rings = closed.map((c) => ({ ...c, flat: flatten({ kind: "ring", pts: c.pts, closed: true }) })).filter((c) => c.flat.length >= 3);
    if (!rings.length) {
      this.rep.approximated("board outline", "no closed outline on the outline layer; the bounding box of the board's objects is used");
      this.outlineRing = undefined;
      return;
    }
    rings.sort((a, b) => Math.abs(signedArea2(b.flat)) - Math.abs(signedArea2(a.flat)));
    const main = rings[0];
    const orient = (r: (typeof rings)[number], ccw: boolean): PVertex[] => (signedArea2(r.flat) > 0 === ccw ? r.pts : reverseRing(r.pts));
    this.outlineRing = { pts: orient(main, true), locked: main.locked, src: main.src };
    this.cutoutRings = rings.slice(1).map((r) => ({ pts: orient(r, false), locked: r.locked, src: r.src }));
    const xs = main.flat.map((p) => p.x);
    const ys = main.flat.map((p) => p.y);
    this.bbox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  outlineRing: { pts: PVertex[]; locked: boolean; src: string } | undefined;
  cutoutRings: { pts: PVertex[]; locked: boolean; src: string }[] = [];
  bbox: { minX: number; maxX: number; minY: number; maxY: number } | undefined;

  contour(pts: PVertex[], local = false): Vertex[] {
    const fx = local ? this.L : this.X;
    const fy = local ? this.L : this.Y;
    const out: Vertex[] = [];
    for (const p of pts) {
      const v: Vertex = { x: fx(p.x), y: fy(p.y) };
      const s = p.sweep ? clampSweep(p.sweep) : undefined;
      if (s) v.sweep = s;
      const last = out[out.length - 1];
      if (last && last.x === v.x && last.y === v.y) {
        if (v.sweep) last.sweep = v.sweep;
        continue;
      }
      out.push(v);
    }
    while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) {
      const l = out.pop()!;
      if (l.sweep) out[out.length - 1].sweep = l.sweep;
    }
    return out;
  }

  writeOutline(): void {
    if (this.outlineRing) {
      const c = this.contour(this.outlineRing.pts);
      if (c.length >= 3) this.push({ kind: "outline", id: "outline", outline: c, source: { kind: "board" }, ...(this.outlineRing.locked ? { locked: true } : {}), provenance: PROVENANCE }, this.outlineRing.src);
      for (const r of this.cutoutRings) {
        const cc = this.contour(r.pts);
        if (cc.length >= 3) this.push({ kind: "cutout", id: this.uid("cutout", r.src), outline: cc, ...(r.locked ? { locked: true } : {}), provenance: PROVENANCE }, r.src);
      }
    }
  }

  // ---- footprints

  readonly padNumbers = new Map<string, Map<string, string>>(); // component id -> raw number -> board number
  readonly refOf = new Map<string, string>();
  readonly padIds = new Map<string, Map<string, string>>(); // component id -> footprint pad record id -> board number

  sanitizeRef(raw: string, fallback: string): string {
    let r = raw.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z]/.test(r)) r = `X${r}`;
    if (!r || r === "X") r = fallback;
    if (r !== raw) this.rep.approximated("reference designators", "changed to letters, digits and underscores starting with a letter", { source: raw || "(empty)" });
    let out = r;
    for (let n = 2; this.refs.has(out); n++) out = `${r}_${n}`;
    if (out !== r) this.rep.approximated("reference designators", "repeated; a suffix was added", { source: r });
    this.refs.add(out);
    return out;
  }

  padNumber(raw: string, i: number): string {
    const s = raw.replace(/[\s:]/g, "_").slice(0, 40);
    return s || `_${i + 1}`;
  }

  /** A footprint document's pad (footprint frame) as a board pad, or undefined when it cannot be one. */
  pad(r: SourceRecord, doc: SourceDoc | undefined, number: string): Pad | undefined {
    const d = r.data;
    const layerT = this.layerType(num(d.layerId), doc);
    const shape = (d.defaultPad && typeof d.defaultPad === "object" && !Array.isArray(d.defaultPad) ? d.defaultPad : {}) as Obj;
    const hole = (d.hole && typeof d.hole === "object" && !Array.isArray(d.hole) ? d.hole : undefined) as Obj | undefined;
    if (Array.isArray(d.specialPad) && d.specialPad.length) this.rep.approximated("pads with per-layer shapes", "only the default pad shape is kept", { source: r.id });
    const pt = str(shape.padType);
    const w = num(shape.width);
    const h = num(shape.height, w);
    const base: Pad = { number, type: "smd", shape: "rect", x: this.L(d.centerX), y: this.L(d.centerY) };
    const rot = normAngle(deg(num(d.padAngle)));
    if (rot) base.rotation = rot;
    // copper shape
    let shapeOk = true;
    let points: Vertex[] | undefined;
    if (pt === "ELLIPSE" || pt === "ROUND") {
      if (Math.abs(w - h) < 1e-6) base.shape = "circle";
      else {
        base.shape = "oval";
        if (pt === "ELLIPSE") this.rep.approximated("elliptical pads", "drawn as ovals (stadiums)", { source: r.id });
      }
    } else if (pt === "OVAL") base.shape = "oval";
    else if (pt === "RECT") {
      const cr = num(shape.radius);
      if (cr > 0) {
        base.shape = "roundrect";
        base.corner_radius = this.L(Math.min(cr, w / 2, h / 2));
      } else base.shape = "rect";
    } else if (pt === "POLYGON" || pt === "POLY" || pt === "NGON") {
      let ring: PVertex[] | undefined;
      if (pt === "NGON") {
        const n = Math.max(3, Math.round(num(shape.sides, 6)));
        const rr = num(shape.diameter) / 2;
        ring = Array.from({ length: n }, (_, k) => ({ x: rr * Math.cos((2 * Math.PI * k) / n), y: rr * Math.sin((2 * Math.PI * k) / n) }));
      } else {
        const s = parseComplex(shape.path, this.notes)[0];
        if (s?.kind === "ring") ring = s.pts;
        else if (s?.kind === "circle") ring = circleRing(s.cx, s.cy, s.r);
      }
      const c = ring ? this.contour(ring, true) : [];
      if (c.length >= 3) {
        base.shape = "polygon";
        points = c;
      } else shapeOk = false;
    } else shapeOk = false;
    if (!shapeOk) {
      this.rep.dropped("pads", `the pad shape ${pt || "(none)"} could not be read`, { source: r.id });
      return undefined;
    }
    const sw = this.L(w);
    const sh = this.L(h);
    const flat = flattenBox(points);
    const ow = points ? flat.w : sw;
    const oh = points ? flat.h : sh;
    if (isNum(d.topSolderExpansion)) base.mask_margin = this.L(d.topSolderExpansion);
    if (isNum(d.topPasteExpansion)) base.paste_margin = this.L(d.topPasteExpansion);
    if (hole && num(hole.width) > 0) {
      const hw = num(hole.width);
      const hh = num(hole.height, hw);
      const rel = normAngle(deg(num(d.relativeAngle)));
      if (Math.abs(num(d.padOffsetX)) > 0.01 || Math.abs(num(d.padOffsetY)) > 0.01) this.rep.approximated("pad holes off the pad center", "the hole is placed at the pad center", { source: r.id });
      const round = Math.abs(hw - hh) < 1e-6;
      const swap = rel === 90_000 || rel === 270_000;
      if (!round && rel % 90_000 !== 0) this.rep.approximated("slotted holes at an angle to their pad", "the slot is aligned with the pad", { source: r.id });
      if (!truthy(d.plated)) {
        if (!round) this.rep.approximated("non-plated slots", "drilled as round holes of the slot's width", { source: r.id });
        if (pt) this.rep.approximated("non-plated holes with a copper shape", "kept as plain holes (the copper ring is not modeled for non-plated holes)", { source: r.id });
        return { number, type: "np", shape: "circle", x: base.x, y: base.y, hole_diameter: this.L(Math.min(hw, hh)) };
      }
      const th: Pad = { ...base, type: "th" };
      delete th.layer;
      if (base.shape === "circle" && round) {
        th.outer_diameter = sw;
        th.hole_diameter = this.L(hw);
      } else {
        if (base.shape === "circle") th.shape = "oval";
        th.outer_width = ow;
        th.outer_height = oh;
        if (points) th.points = points;
        if (round) th.hole_diameter = this.L(hw);
        else {
          th.hole_width = this.L(swap ? hh : hw);
          th.hole_height = this.L(swap ? hw : hh);
        }
      }
      return th;
    }
    // a footprint document is drawn from the top: a BOTTOM pad sits on the side opposite to its footprint's own side
    if (layerT === "BOTTOM") this.rep.info("surface pads on the footprint's other side", "kept on the opposite side (pad layer bottom in the footprint frame)", { source: r.id });
    else if (layerT !== "TOP") this.rep.approximated("surface pads on a non-copper or multi layer", "placed on the footprint's side", { source: r.id });
    const smd: Pad = { ...base, layer: layerT === "BOTTOM" ? "bottom" : "top" };
    if (base.shape === "circle") smd.radius = Math.round(sw / 2);
    else if (points) smd.points = points;
    else {
      smd.width = sw;
      smd.height = sh;
    }
    return smd;
  }

  /** Graphics and texts of a footprint document, in its frame. */
  footprintArt(doc: SourceDoc, compId: string): { graphics: FootprintGraphic[]; texts: FootprintText[] } {
    const graphics: FootprintGraphic[] = [];
    const texts: FootprintText[] = [];
    const layerOf = (r: SourceRecord): AnyLayer | undefined => {
      const { layer, type } = this.anyLayer(num(r.data.layerId), doc);
      if (!layer) {
        if (type === "OUTLINE") this.rep.dropped("footprint shapes on the board outline layer", "footprints cannot change the board outline", { source: `${compId}/${r.id}` });
        else this.rep.dropped(`footprint shapes on ${type} layers`, "this layer type is not documented or has no board layer", { source: r.id });
      }
      return layer;
    };
    for (const t of ["LINE", "ARC", "CARC", "POLY", "FILL"])
      for (const r of records(doc, t)) {
        const layer = layerOf(r);
        if (!layer) continue;
        for (const g of this.shapesOf(r, t, layer, true)) graphics.push(g);
      }
    for (const r of records(doc, "STRING")) {
      const layer = layerOf(r);
      const text = str(r.data.text);
      if (!layer || !text) continue;
      const ft = this.textFields(r.data, layer, true);
      if (ft) texts.push({ ...ft, role: "user" });
    }
    return { graphics, texts };
  }

  /** Graphic shapes of a LINE, ARC, POLY or FILL record (footprint frame when `local`). */
  shapesOf(r: SourceRecord, t: string, layer: AnyLayer, local: boolean): FootprintGraphic[] {
    const fx = local ? this.L : this.X;
    const fy = local ? this.L : this.Y;
    const stroke = Math.max(0, this.L(r.data.width ?? r.data.strokeWidth));
    if (t === "LINE") return [{ layer, shape: "line", start: { x: fx(r.data.startX), y: fy(r.data.startY) }, end: { x: fx(r.data.endX), y: fy(r.data.endY) }, stroke_width: stroke }];
    if (t === "ARC" || t === "CARC") {
      const s = clampSweep(num(r.data.angle));
      return [{ layer, shape: s ? "arc" : "line", start: { x: fx(r.data.startX), y: fy(r.data.startY) }, end: { x: fx(r.data.endX), y: fy(r.data.endY) }, ...(s ? { sweep: s } : {}), stroke_width: stroke }];
    }
    const filled = t === "FILL";
    const shapes = filled ? parseComplex(r.data.path, this.notes) : [parseSingle(r.data.path, this.notes)].filter((s): s is Shape => !!s);
    if (filled && shapes.length > 1) this.rep.approximated("filled shapes with holes on drawing layers", "drawn without their holes", { source: r.id });
    const use = filled ? shapes.slice(0, 1) : shapes;
    const out: FootprintGraphic[] = [];
    for (const s of use) {
      if (s.kind === "circle") {
        out.push({ layer, shape: "circle", center: { x: fx(s.cx), y: fy(s.cy) }, radius: Math.max(1, this.L(s.r)), stroke_width: stroke, ...(filled ? { filled: true as const } : {}) });
        continue;
      }
      const c = this.contour(s.pts, local);
      if (s.closed || filled) {
        if (c.length >= 3) out.push({ layer, shape: "polygon", points: c, stroke_width: stroke, ...(filled ? { filled: true as const } : {}) });
      } else if (c.length >= 2) {
        // an open path: the last vertex carries no sweep
        const pts = c.map((v, i) => (i === c.length - 1 && v.sweep ? { x: v.x, y: v.y } : v));
        out.push({ layer, shape: "path", points: pts, stroke_width: stroke });
      }
    }
    return out;
  }

  textFields(d: Obj, layer: AnyLayer, local: boolean): Omit<FootprintText, "role"> | undefined {
    const text = str(d.text).slice(0, 500);
    const height = this.L(d.fontSize);
    if (!text || height <= 0) return undefined;
    const origin = str(d.origin) || "LEFT_BOTTOM";
    if (!origin.endsWith("BOTTOM")) this.textVertical++;
    const anchor = origin.startsWith("CENTER") ? "center" : origin.startsWith("RIGHT") ? "right" : "left";
    const x = local ? this.L(d.x ?? d.positionX) : this.X(d.x ?? d.positionX);
    const y = local ? this.L(d.y ?? d.positionY) : this.Y(d.y ?? d.positionY);
    const rotation = normAngle(deg(num(d.angle)));
    const sw = this.L(d.strokeWidth);
    return { layer, text, x, y, height, ...(sw > 0 ? { stroke_width: sw } : {}), ...(rotation ? { rotation } : {}), ...(anchor !== "left" ? { anchor } : {}) };
  }
  textVertical = 0;

  footprints(): void {
    const attrsOf = new Map<string, SourceRecord[]>();
    for (const a of records(this.pcb, "ATTR")) {
      const parent = str(a.data.parentId);
      if (!parent) continue;
      const l = attrsOf.get(parent) ?? [];
      l.push(a);
      attrsOf.set(parent, l);
    }
    let n = 0;
    for (const c of records(this.pcb, "COMPONENT")) {
      n++;
      const attrs = attrsOf.get(c.id) ?? [];
      const attr = (k: string) => attrs.find((a) => str(a.data.key).toLowerCase() === k.toLowerCase());
      let fpUuid = str(attr("Footprint")?.data.value);
      let fpDoc = fpUuid ? this.p.docs.get(fpUuid) : undefined;
      // format 2 PCB files may carry a footprint document per component, named "<pcb uuid>_<component id>" in its
      // HEAD line (seen in exports; not in the documentation), while the attribute holds the footprint's title
      if ((!fpDoc || fpDoc.docType !== "FOOTPRINT") && this.p.format === 2) {
        const embedded = this.p.docs.get(`${this.pcb.uuid}_${c.id}`);
        if (embedded?.docType === "FOOTPRINT") {
          fpDoc = embedded;
          fpUuid = embedded.uuid;
          this.rep.info("footprints embedded in the PCB file", "matched to their component by the document name <pcb>_<component> (observed in exports, not documented)");
        }
      }
      if (fpDoc && fpDoc.docType !== "FOOTPRINT") fpDoc = undefined;
      const devUuid = str(attr("Device")?.data.value);
      const device = this.p.devices.get(devUuid) ?? {};
      if (!fpDoc) {
        // the device names its footprint (format 2 project.json documents `footprint_uuid`; format 3 devices carry
        // a Footprint attribute)
        const viaDevice = str(device.Footprint ?? device.footprint_uuid);
        const d = viaDevice ? this.p.docs.get(viaDevice) : undefined;
        if (d?.docType === "FOOTPRINT") {
          fpDoc = d;
          fpUuid = d.uuid;
          this.rep.info("footprints found through their device", "the component has no Footprint attribute; the device's footprint is used");
        }
      }
      if (fpDoc) this.footprintDocsUsed.add(fpDoc.uuid);
      const ref = this.sanitizeRef(str(attr("Designator")?.data.value) || str(device.Designator).replace(/\?$/, "") || "", `X${n}`);
      this.refOf.set(c.id, ref);
      const side = this.layerType(num(c.data.layerId)) === "BOTTOM" ? "bottom" : "top";
      const a = num(c.data.angle);
      const rotation = normAngle(deg(side === "bottom" ? a + 180 : a));
      if (!fpDoc)
        this.rep.dropped(
          "component footprints",
          fpUuid ? "the footprint document the Footprint attribute names is not in the export; placed without pads" : "no Footprint attribute names a footprint document; placed without pads",
          { source: c.id },
        );
      // pads
      const pads: Pad[] = [];
      const numbers = new Map<string, string>();
      const byPadId = new Map<string, string>();
      records(fpDoc, "PAD").forEach((pr, i) => {
        const raw = str(pr.data.num);
        const number = this.padNumber(raw, i);
        if (number !== raw) this.rep.approximated("pad numbers", "empty, or with spaces or colons; changed", { source: `${ref}:${raw}` });
        const pad = this.pad(pr, fpDoc, number);
        if (pad) {
          pads.push(pad);
          if (!numbers.has(raw)) numbers.set(raw, number);
          byPadId.set(pr.id, number);
        }
      });
      this.padNumbers.set(c.id, numbers);
      this.padIds.set(c.id, byPadId);
      for (const t of ["VIA", "POUR", "REGION"]) {
        const rs = records(fpDoc, t);
        if (!rs.length) continue;
        if (t === "REGION") for (const r of rs) this.region(r, { comp: c, side, ref });
        else this.rep.dropped(`${t} records inside footprints`, "footprints carry only pads, graphics and text in the board document", { count: rs.length, source: fpDoc?.uuid });
      }
      const art = fpDoc ? this.footprintArt(fpDoc, c.id) : { graphics: [], texts: [] };
      // texts placed on the board (designator and other visible attributes), into the footprint frame
      for (const at of attrs) {
        if (!truthy(at.data.valueVisible) || at.data.x === null || at.data.x === undefined) continue;
        const k = str(at.data.key);
        const { layer } = this.anyLayer(num(at.data.layerId));
        if (!layer) continue;
        const ownLayer = side === "bottom" ? flipSide(layer) : layer;
        const dx = num(at.data.x) - num(c.data.x);
        const dy = num(at.data.y) - num(c.data.y);
        const t = (-a * Math.PI) / 180;
        let lx = dx * Math.cos(t) - dy * Math.sin(t);
        let ly = dx * Math.sin(t) + dy * Math.cos(t);
        if (side === "bottom") ly = -ly;
        const worldAngle = num(at.data.angle);
        const localAngle = side === "bottom" ? a - worldAngle : worldAngle - a;
        const ft = this.textFields({ ...at.data, text: k.toLowerCase() === "designator" ? ref : str(at.data.value), x: lx, y: ly, angle: localAngle }, ownLayer, true);
        if (ft) art.texts.push({ ...ft, role: k.toLowerCase() === "designator" ? "ref" : k.toLowerCase() === "value" ? "value" : "user" });
      }
      if (art.texts.length > 100) {
        this.rep.dropped("footprint texts", "more than 100 on one footprint", { count: art.texts.length - 100, source: ref });
        art.texts.length = 100;
      }
      const supplier = str(attr("Supplier Part")?.data.value) || str(device["Supplier Part"]);
      const value = str(attr("Value")?.data.value) || str(device.Value);
      const fpName = (fpDoc?.title ?? this.p.footprintTitles.get(fpUuid) ?? (fpUuid ? `easyeda:${fpUuid}` : "easyeda:unknown")).slice(0, 200);
      const rec: FootprintRec = {
        kind: "footprint",
        id: this.uid("fp", ref),
        ref,
        footprint: fpName,
        ...(value ? { value: value.slice(0, 200) } : {}),
        ...(/^C\d+$/.test(supplier) ? { supplier_part: supplier } : {}),
        x: this.X(c.data.x),
        y: this.Y(c.data.y),
        rotation,
        side,
        pads,
        ...(art.graphics.length ? { graphics: art.graphics } : {}),
        ...(art.texts.length ? { texts: art.texts } : {}),
        ...(truthy(c.data.locked) ? { locked: true as const } : {}),
        provenance: PROVENANCE,
      };
      this.push(rec, c.id);
    }
    // pad nets
    let unknownComp = 0;
    let unresolved = 0;
    for (const r of records(this.pcb, "PAD_NET")) {
      const parts = idParts(r.id);
      let comp: string;
      let padNum: string;
      let padId: string;
      if (parts[0] === "PAD_NET" && parts.length >= 3) {
        comp = str(parts[1]);
        padNum = str(parts[2]);
        padId = str(parts[3]);
      } else {
        comp = str(r.data.componentId ?? parts[0]);
        padNum = str(r.data.padNum);
        padId = str(r.data.padId);
      }
      const net = str(r.data.padNet);
      const ref = this.refOf.get(comp);
      if (!ref) {
        unknownComp++;
        continue;
      }
      if (!net) continue;
      // by pad number, else by the footprint pad's id (the documented optional padId)
      let number = this.padNumbers.get(comp)?.get(padNum) ?? (padId ? this.padIds.get(comp)?.get(padId) : undefined);
      if (number === undefined) {
        unresolved++;
        number = this.padNumber(padNum, 0);
      }
      this.addPin(net, `${ref}.${number}`);
    }
    if (unknownComp) this.rep.dropped("pad net assignments", "name a component that is not on this PCB", { count: unknownComp });
    if (unresolved) this.rep.info("pad net assignments", "name a pad its footprint does not have (or whose footprint is missing); kept in the netlist, where the board lists them as missing pins", { count: unresolved });
    // free pads: each becomes a one-pad footprint
    let free = 0;
    for (const r of records(this.pcb, "PAD")) {
      free++;
      const ref = this.sanitizeRef(`FREEPAD${free}`, `FREEPAD${free}`);
      const raw = str(r.data.num);
      const number = this.padNumber(raw, 0);
      const bottom = this.layerType(num(r.data.layerId)) === "BOTTOM";
      const pad = this.pad({ ...r, data: { ...r.data, layerId: 1, centerX: 0, centerY: 0, padAngle: bottom ? -num(r.data.padAngle) : num(r.data.padAngle) } }, undefined, number);
      if (!pad) continue;
      this.push({ kind: "footprint", id: this.uid("fp", ref), ref, footprint: "easyeda:free-pad", x: this.X(r.data.centerX), y: this.Y(r.data.centerY), rotation: 0, side: bottom ? "bottom" : "top", pads: [pad], ...(truthy(r.data.locked) ? { locked: true as const } : {}), provenance: PROVENANCE }, r.id);
      const net = str(r.data.netName);
      if (net) this.addPin(net, `${ref}.${number}`);
    }
    if (free) this.rep.approximated("free pads (not in a component)", "each became a one-pad footprint FREEPAD<n> so its net reaches the netlist", { count: free });
  }

  addPin(net: string, pin: string): void {
    this.netNames.add(net);
    let s = this.netPins.get(net);
    if (!s) this.netPins.set(net, (s = new Set()));
    s.add(pin);
  }

  // ---- copper and drawings

  copperAndDrawings(): void {
    const segTrack = (src: string, net: string | undefined, layer: CopperLayer, width: number, a: { x: number; y: number }, b: { x: number; y: number }, sweep: number | undefined, locked: boolean, suffix = "") => {
      if (width <= 0) {
        this.rep.dropped("copper segments of zero width", "a track needs a width", { source: src });
        return;
      }
      this.push({ kind: "track", id: this.uid("trk", src + suffix), ...(net ? { net } : {}), layer, width, start: a, end: b, ...(sweep ? { sweep } : {}), ...(locked ? { locked: true as const } : {}), provenance: PROVENANCE }, src);
    };
    const drawing = (r: SourceRecord, t: string, layer: AnyLayer) => {
      this.shapesOf(r, t, layer, false).forEach((g, i) => this.push({ ...g, kind: "graphic", id: this.uid("gfx", i ? `${r.id}.${i}` : r.id), ...(truthy(r.data.locked) ? { locked: true as const } : {}), provenance: PROVENANCE } as GraphicRec, r.id));
    };
    const where = (r: SourceRecord) => {
      const lid = num(r.data.layerId);
      const type = this.layerType(lid);
      return { type, copper: this.copperOf(lid), drawing: DRAWING[type] };
    };
    const skipLayer = (r: SourceRecord, t: string, type: string) => {
      if (type === "OUTLINE") return; // consumed by the outline
      if ((type === "SIGNAL" || type === "PLANE") && !this.copperOf(num(r.data.layerId))) this.rep.dropped(`${t} records on unused or extra inner layers`, "the layer is not in the stackup", { source: r.id });
      else this.rep.dropped(`${t} records on ${type} layers`, type === "MULTI" ? "drawing on the multi layer has no board layer" : "this layer type is not documented or has no board layer", { source: r.id });
    };
    for (const t of ["LINE", "ARC", "CARC"])
      for (const r of records(this.pcb, t)) {
        if (r.data.polyType === "BOARD_OUTLINE") continue;
        const w = where(r);
        if (w.copper) {
          const sweep = t === "LINE" ? undefined : clampSweep(num(r.data.angle));
          segTrack(r.id, this.useNet(str(r.data.netName)), w.copper, this.L(r.data.width), { x: this.X(r.data.startX), y: this.Y(r.data.startY) }, { x: this.X(r.data.endX), y: this.Y(r.data.endY) }, sweep, truthy(r.data.locked));
        } else if (w.drawing) drawing(r, t, w.drawing);
        else skipLayer(r, t, w.type);
      }
    for (const r of records(this.pcb, "POLY")) {
      if (r.data.polyType === "BOARD_OUTLINE") continue;
      const w = where(r);
      if (w.copper) {
        const s = parseSingle(r.data.path, this.notes);
        if (!s) continue;
        const net = this.useNet(str(r.data.netName));
        const width = this.L(r.data.width);
        const ring = s.kind === "circle" ? circleRing(s.cx, s.cy, s.r) : s.pts;
        const closed = s.kind === "circle" || s.closed;
        const n = ring.length;
        for (let i = 0; i < (closed ? n : n - 1); i++) {
          const a = ring[i];
          const b = ring[(i + 1) % n];
          segTrack(r.id, net, w.copper, width, { x: this.X(a.x), y: this.Y(a.y) }, { x: this.X(b.x), y: this.Y(b.y) }, a.sweep ? clampSweep(a.sweep) : undefined, truthy(r.data.locked), `.${i + 1}`);
        }
      } else if (w.drawing) drawing(r, "POLY", w.drawing);
      else skipLayer(r, "POLY", w.type);
    }
    for (const r of records(this.pcb, "VIA")) {
      const ruleName = str(r.data.ruleName);
      if (ruleName) this.rep.approximated("vias with a layer-pair rule", "the rule's layers are not documented; imported as through vias", { source: r.id });
      const od = this.L(r.data.viaDiameter);
      const hd = this.L(r.data.holeDiameter);
      if (od <= 0 || hd <= 0) {
        this.rep.dropped("vias", "without a diameter or hole", { source: r.id });
        continue;
      }
      const net = this.useNet(str(r.data.netName));
      this.push({ kind: "via", id: this.uid("via", r.id), ...(net ? { net } : {}), x: this.X(r.data.centerX), y: this.Y(r.data.centerY), outer_diameter: od, hole_diameter: hd, from_layer: "top", to_layer: "bottom", ...(truthy(r.data.locked) ? { locked: true as const } : {}), provenance: PROVENANCE }, r.id);
    }
    // FILL: copper fills become zones (with their shape as stored fill), drawings become filled graphics
    let fillZones = 0;
    for (const r of records(this.pcb, "FILL")) {
      const w = where(r);
      if (w.copper) {
        const shapes = parseComplex(r.data.path, this.notes);
        if (!shapes.length) continue;
        const outer = shapes[0];
        const c = this.contour(outer.kind === "circle" ? circleRing(outer.cx, outer.cy, outer.r) : outer.pts);
        if (c.length < 3) continue;
        const net = this.useNet(str(r.data.netName));
        const id = this.uid("zone", r.id);
        fillZones++;
        if (shapes.length > 1) this.rep.approximated("copper fills with holes", "the zone outline is the outer boundary; the holes are kept in the stored fill only", { source: r.id });
        this.push({ kind: "zone", id, ...(net ? { net } : {}), layers: [w.copper], outline: c, priority: 1000, pad_connection: "solid", fill_mode: "solid", remove_islands: "never", name: `fill ${key(r.id)}`.slice(0, 120), ...(truthy(r.data.locked) ? { locked: true as const } : {}), provenance: PROVENANCE } as ZoneRec, r.id);
        this.fills.push({ zone: id, source: r.id, ...(net ? { net } : {}), layer: w.copper, polygons: ringsToPolygons(shapes.map((s) => flatten(s).map((p) => ({ x: this.X(p.x), y: this.Y(p.y) })))) });
      } else if (w.drawing) drawing(r, "FILL", w.drawing);
      else skipLayer(r, "FILL", w.type);
    }
    if (fillZones) this.rep.approximated("copper FILL shapes", "imported as solid zones (priority 1000, solid pad connection, islands kept) with their exact shape as the stored fill; a refill may carve them by clearance", { count: fillZones });
    // POUR: zones, and POURED: their stored fill
    const pourZone = new Map<string, { id: string; layer: CopperLayer; net?: string }>();
    for (const r of records(this.pcb, "POUR")) {
      const w = where(r);
      if (!w.copper) {
        this.rep.dropped("pours", `on a ${w.type} layer, which is not copper`, { source: r.id });
        continue;
      }
      const shapes = parseComplex(r.data.path, this.notes);
      if (!shapes.length) continue;
      if (shapes.length > 1) this.rep.approximated("pour outlines with holes", "the zone keeps the outer boundary only", { source: r.id });
      const outer = shapes[0];
      const c = this.contour(outer.kind === "circle" ? circleRing(outer.cx, outer.cy, outer.r) : outer.pts);
      if (c.length < 3) continue;
      const net = this.useNet(str(r.data.netName));
      const pt = (r.data.pourType && typeof r.data.pourType === "object" && !Array.isArray(r.data.pourType) ? r.data.pourType : {}) as Obj;
      const kind = str(pt.pourType) || "SOLID";
      const fine = num(pt.fineness);
      const zone: ZoneRec = {
        kind: "zone",
        id: this.uid("zone", r.id),
        ...(net ? { net } : {}),
        layers: [w.copper],
        outline: c,
        priority: Math.max(0, Math.min(1000, Math.round(num(r.data.order)))),
        ...(fine > 0 ? { min_width: this.L(fine) } : {}),
        pad_connection: "thermal",
        fill_mode: kind === "SOLID" ? "solid" : "hatch",
        remove_islands: truthy(r.data.keepIsland) ? "never" : "always",
        ...(str(r.data.name) ? { name: str(r.data.name).slice(0, 120) } : {}),
        ...(truthy(r.data.locked) ? { locked: true as const } : {}),
        provenance: PROVENANCE,
      };
      if (kind !== "SOLID") {
        if (num(pt.lineWidth) > 0) zone.hatch_width = this.L(pt.lineWidth);
        if (num(pt.lineGap) > 0) zone.hatch_gap = this.L(pt.lineGap);
        this.rep.approximated("line-filled pours", "imported as hatch zones (the line direction and angle are not modeled)", { source: r.id });
      }
      this.push(zone, r.id);
      pourZone.set(r.id, { id: zone.id, layer: w.copper, ...(net ? { net } : {}) });
    }
    const pours = records(this.pcb, "POUR").length;
    if (pours) {
      this.rep.approximated("pours", "pad connection (thermal or direct) and clearance live in design rules, whose contents are not documented: thermal is assumed and clearance left to the board's rules", { count: pours });
      this.rep.approximated("pours", "the documentation names the order field a priority without saying which way it runs; it is copied as the zone priority", { count: pours });
    }
    let strokes = 0;
    for (const r of records(this.pcb, "POURED")) {
      const target = str(r.data.targetId) || str(idParts(r.id)[1]);
      const z = pourZone.get(target);
      if (!z) {
        this.rep.dropped("pour results", "belong to a pour that was not imported", { source: r.id });
        continue;
      }
      const items = Array.isArray(r.data.pourFill) ? r.data.pourFill : [];
      const rings: { x: number; y: number }[][] = [];
      for (const it of items) {
        if (!it || typeof it !== "object" || Array.isArray(it)) continue;
        if (!truthy(it.fill)) {
          strokes++;
          continue;
        }
        for (const s of parseComplex(it.path, this.notes)) rings.push(flatten(s).map((p) => ({ x: this.X(p.x), y: this.Y(p.y) })));
      }
      if (rings.length) this.fills.push({ zone: z.id, source: target, ...(z.net ? { net: z.net } : {}), layer: z.layer, polygons: ringsToPolygons(rings) });
    }
    if (strokes) this.rep.approximated("pour result strokes", "stroked outlines (thermal spokes, hatch lines) are not in the stored fill; filled areas are", { count: strokes });
  }

  // ---- keep-outs

  region(r: SourceRecord, inFootprint?: { comp: SourceRecord; side: "top" | "bottom"; ref: string }): void {
    const prohibit = Array.isArray(r.data.prohibitType) ? r.data.prohibitType.map((v) => str(v).toUpperCase()) : [];
    const blocks = {
      tracks: prohibit.includes("TRACK"),
      vias: prohibit.includes("VIA"),
      pours: prohibit.some((p) => p === "COPPER" || p === "FILL" || p === "PLANE"),
      footprints: prohibit.includes("COMPONENT"),
    };
    if (!blocks.tracks && !blocks.vias && !blocks.pours && !blocks.footprints) {
      this.rep.dropped("regions without prohibitions", "constraint regions select design rules, which are not imported", { source: r.id });
      return;
    }
    if (prohibit.includes("FILL") && !prohibit.includes("COPPER")) this.rep.approximated("regions that forbid fills", "mapped to blocking pours", { source: r.id });
    const unknown = prohibit.filter((p) => !["TRACK", "VIA", "COPPER", "FILL", "PLANE", "COMPONENT"].includes(p));
    if (unknown.length) this.rep.dropped("region prohibitions", `not documented: ${unknown.join(", ")}`, { source: r.id });
    const lid = num(r.data.layerId);
    const type = this.layerType(lid);
    let layers: CopperLayer[];
    const c = this.copperOf(lid);
    if (c) layers = [inFootprint?.side === "bottom" ? (flipSide(c) as CopperLayer) : c];
    else {
      layers = [...this.copper];
      if (type !== "MULTI") this.rep.approximated("regions on non-copper layers", "applied to every copper layer", { source: r.id });
    }
    const shapes = parseComplex(r.data.path, this.notes);
    if (!shapes.length) return;
    if (shapes.length > 1) this.rep.approximated("regions with holes", "the keep-out keeps the outer boundary only", { source: r.id });
    const s = shapes[0];
    let ring = s.kind === "circle" ? circleRing(s.cx, s.cy, s.r) : s.pts;
    if (inFootprint) {
      // footprint frame (source units) to the board: (x, y) + R(a) p on top, (x, y) + R(a) (px, -py) on the bottom
      const a = (num(inFootprint.comp.data.angle) * Math.PI) / 180;
      const cx = num(inFootprint.comp.data.x);
      const cy = num(inFootprint.comp.data.y);
      const bottom = inFootprint.side === "bottom";
      ring = ring.map((p) => {
        const py = bottom ? -p.y : p.y;
        return { x: cx + p.x * Math.cos(a) - py * Math.sin(a), y: cy + p.x * Math.sin(a) + py * Math.cos(a), ...(p.sweep ? { sweep: bottom ? -p.sweep : p.sweep } : {}) };
      });
    }
    const outline = this.contour(ring);
    if (outline.length < 3) return;
    const name = str(r.data.name);
    const kp: KeepoutRec = {
      kind: "keepout",
      id: this.uid("kpo", inFootprint ? `${inFootprint.comp.id}.${r.id}` : r.id),
      outline,
      layers,
      blocks,
      tier: "no_go",
      ...(inFootprint ? { footprint: `fp:${inFootprint.ref}` } : {}),
      ...(name ? { name: name.slice(0, 120) } : {}),
      ...(truthy(r.data.locked) ? { locked: true as const } : {}),
      provenance: PROVENANCE,
    };
    this.push(kp, r.id);
  }

  // ---- text

  texts(): void {
    for (const r of records(this.pcb, "STRING")) {
      const { layer, type } = this.anyLayer(num(r.data.layerId));
      if (!layer) {
        this.rep.dropped(`text on ${type} layers`, "this layer type has no board layer", { source: r.id });
        continue;
      }
      const f = this.textFields(r.data, layer, false);
      if (!f) continue;
      this.push({ kind: "text", id: this.uid("txt", r.id), ...f, ...(truthy(r.data.mirror) ? { mirrored: true as const } : {}), ...(truthy(r.data.locked) ? { locked: true as const } : {}), provenance: PROVENANCE }, r.id);
    }
  }

  // ---- nets

  netlist(source: string): Netlist {
    const classes = new Map<string, string[]>();
    let diff = 0;
    let eq = 0;
    for (const r of records(this.pcb, "NET")) {
      const parts = idParts(r.id);
      const name = str(parts[0] === "NET" ? parts[1] : parts[0]);
      if (!name) continue;
      this.netNames.add(name);
      const t = str(r.data.netType);
      if (t) {
        const cls = t.replace(/[^A-Za-z0-9_.\-+]/g, "_");
        if (cls !== t) this.rep.approximated("net class names", "changed to letters, digits and _ . - +", { source: t });
        const l = classes.get(cls) ?? [];
        l.push(name);
        classes.set(cls, l);
      }
      if (str(r.data.differentialName)) diff++;
      if (str(r.data.equalLengthGroupName)) eq++;
    }
    if (diff) this.rep.dropped("differential pair memberships", "differential pairs are not modeled", { count: diff });
    if (eq) this.rep.dropped("equal-length group memberships", "equal-length groups are not modeled", { count: eq });
    const classOf = new Map<string, string>();
    for (const [cls, nets] of [...classes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      for (const n of nets) classOf.set(n, cls);
      this.push({ kind: "netclass", id: `class:${cls}`, name: cls, nets: [...nets].sort(), provenance: PROVENANCE }, `NET ${cls}`);
    }
    const nets = [...this.netNames]
      .sort()
      .map((name) => ({ name, ...(classOf.has(name) ? { class: classOf.get(name)! } : {}), pins: [...(this.netPins.get(name) ?? [])].sort() }));
    return { source, nets };
  }

  board(name: string): void {
    this.push({ kind: "board", id: "board", name: (name || "EasyEDA board").slice(0, 120), thickness: this.thickness, copper_layers: this.copper.length, origin: "center", provenance: PROVENANCE }, "PCB");
  }

  /** The center of everything placed, in source units (when there is no outline). */
  objectsBox(): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of records(this.pcb, "COMPONENT")) {
      xs.push(num(r.data.x));
      ys.push(num(r.data.y));
    }
    for (const t of ["LINE", "ARC"])
      for (const r of records(this.pcb, t)) {
        xs.push(num(r.data.startX), num(r.data.endX));
        ys.push(num(r.data.startY), num(r.data.endY));
      }
    for (const r of records(this.pcb, "VIA")) {
      xs.push(num(r.data.centerX));
      ys.push(num(r.data.centerY));
    }
    if (!xs.length) return undefined;
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
}

/** A closed ring in the opposite direction (each edge's sweep moves to its new start vertex, negated). */
export function reverseRing(pts: PVertex[]): PVertex[] {
  const n = pts.length;
  return pts.map((_, k) => {
    const v = pts[(n - k) % n];
    const s = pts[(n - k - 1 + n) % n].sweep;
    return { x: v.x, y: v.y, ...(s ? { sweep: -s } : {}) };
  });
}

function flattenBox(points: Vertex[] | undefined): { w: number; h: number } {
  if (!points?.length) return { w: 0, h: 0 };
  const flat = flatten({ kind: "ring", pts: points.map((v) => ({ x: v.x, y: v.y, ...(v.sweep ? { sweep: v.sweep / 1000 } : {}) })), closed: true });
  const xs = flat.map((p) => p.x);
  const ys = flat.map((p) => p.y);
  return { w: Math.max(1, Math.round(Math.max(...xs) - Math.min(...xs))), h: Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys))) };
}

/** Pick the PCB document to import. */
export function choosePcb(p: SourceProject, want?: string): SourceDoc {
  const pcbs = listPcbs(p);
  if (!pcbs.length) throw new Error("this EasyEDA Pro project has no PCB document");
  if (want) {
    const hit = pcbs.find((x) => x.uuid === want) ?? pcbs.find((x) => x.title === want);
    if (!hit) throw new Error(`no PCB ${JSON.stringify(want)} in this project; it has ${pcbs.map((x) => JSON.stringify(x.title)).join(", ")}`);
    return p.docs.get(hit.uuid)!;
  }
  const withBoard = pcbs.find((x) => x.board && x.records > 0);
  const best = withBoard ?? [...pcbs].sort((a, b) => b.records - a.records)[0];
  return p.docs.get(best.uuid)!;
}

/** Convert one PCB document of a project. */
export function convertProject(p: SourceProject, options: ConvertOptions = {}): EasyEdaImportResult {
  const pcb = choosePcb(p, options.pcb);
  const cv = new Converter(p, pcb);
  const pcbs = listPcbs(p);
  if (pcbs.length > 1) cv.rep.info("PCB documents in the project", `imported "${pcb.title ?? pcb.uuid}"; pass the pcb option to choose another (${pcbs.map((x) => x.title).join(", ")})`, { count: pcbs.length });
  if (typeof pcb.meta?.parent === "string" && pcb.meta.parent) cv.rep.info("sub-PCB", "this PCB is a child of another PCB document", { source: pcb.uuid });
  for (const w of p.warnings) cv.rep.dropped("unreadable lines", "not records of the documented form", { source: w });
  cv.stackup();
  cv.outline();
  const box = cv.bbox ?? cv.objectsBox();
  if (box) {
    cv.ox = Math.round(((box.minX + box.maxX) / 2) * UNIT_NM);
    cv.oy = Math.round(((box.minY + box.maxY) / 2) * UNIT_NM);
  }
  if (!box) cv.rep.info("empty PCB document", "no outline and no placed objects; the board has no outline", { source: pcb.uuid });
  cv.rep.info("board recentered", `every coordinate was shifted by (${-cv.ox}, ${-cv.oy}) nm so the outline's bounding box is centered on the origin`);
  cv.rep.info("units", "read as mils (0.001 inch); the documentation says 0.01 inch, but the exports checked use mils");
  if (!cv.outlineRing && box) {
    const w = (box.maxX - box.minX) / 2 + 40;
    const h = (box.maxY - box.minY) / 2 + 40;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    cv.outlineRing = { pts: [{ x: cx - w, y: cy - h }, { x: cx + w, y: cy - h }, { x: cx + w, y: cy + h }, { x: cx - w, y: cy + h }], locked: false, src: "bbox" };
  }
  cv.writeOutline();
  cv.footprints();
  cv.copperAndDrawings();
  for (const r of records(pcb, "REGION")) cv.region(r);
  cv.texts();
  if (cv.textVertical) cv.rep.approximated("texts aligned to their top or middle", "the board document anchors text horizontally only; the vertical alignment is not kept", { count: cv.textVertical });
  if (cv.notes.beziers) cv.rep.approximated("Bezier curves", `flattened to 16 straight segments each`, { count: cv.notes.beziers });
  if (cv.notes.rotatedRects) cv.rep.approximated("rotated rectangles", "rotated about their top-left corner (the documentation does not name the pivot)", { count: cv.notes.rotatedRects });
  if (cv.notes.bad) cv.rep.dropped("path tokens", "could not be read; the shape was cut short or left out", { count: cv.notes.bad });
  const netlist = cv.netlist(p.format === 3 ? "epro2" : "epro");
  cv.board(pcb.title ?? p.title ?? "EasyEDA board");

  // record types: the PCB document and the footprints it uses
  const recordTypes: Record<string, { count: number; handling: Handling }> = {};
  const count = (d: SourceDoc) => {
    for (const [t, m] of d.records) {
      const h = HANDLING[t] ?? "dropped";
      const e = (recordTypes[t] ??= { count: 0, handling: h });
      e.count += m.size;
    }
  };
  count(pcb);
  for (const u of cv.footprintDocsUsed) count(p.docs.get(u)!);
  for (const [t, e] of Object.entries(recordTypes)) {
    if (e.handling !== "dropped") continue;
    cv.rep.dropped(`${t} records`, DROP_REASON[t] ?? "this record type is not documented or not modeled", { count: e.count });
  }
  const ignored = Object.entries(recordTypes).filter(([, e]) => e.handling === "ignored");
  if (ignored.length) cv.rep.info("editor-state records", `not board content, skipped: ${ignored.map(([t, e]) => `${t} ${e.count}`).join(", ")}`, { count: ignored.reduce((s, [, e]) => s + e.count, 0) });
  if (pcb.deletedCount) cv.rep.info("deleted records", "the project log keeps deleted records; they were skipped", { count: pcb.deletedCount });

  const nl = NetlistSchema.safeParse(netlist);
  let finalNetlist: Netlist = netlist;
  if (!nl.success) {
    // drop the offending pins, keep the rest
    const bad = new Set<string>();
    for (const i of nl.error.issues) {
      const [, ni, , pi] = i.path as (string | number)[];
      if (typeof ni === "number" && typeof pi === "number") bad.add(`${ni}:${pi}`);
    }
    finalNetlist = { source: netlist.source, nets: netlist.nets.map((n, ni) => ({ ...n, pins: n.pins.filter((_, pi) => !bad.has(`${ni}:${pi}`)) })) };
    cv.rep.dropped("netlist pins", "not in the <ref>.<pad> form", { count: bad.size });
  }
  const document = createDocument(cv.out, finalNetlist);
  const made = createZoneFill(document, "easyeda-pro", cv.fills);
  const fill: DerivedFill = made.fill;
  if (made.droppedRings) cv.rep.dropped("zone fill rings", "fewer than three points", { count: made.droppedRings });
  return {
    document,
    netlist: finalNetlist,
    report: cv.rep.items(),
    fill,
    offset: { x: cv.ox, y: cv.oy },
    format: p.format,
    pcb: { uuid: pcb.uuid, title: pcb.title ?? pcb.uuid },
    pcbs,
    recordTypes,
  };
}
