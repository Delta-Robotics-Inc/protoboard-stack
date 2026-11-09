/**
 * Circuit JSON to a board document. This adapter and its exporter are the only code allowed to touch
 * `circuit-json` types (contract section 2.1). Circuit JSON is millimeters and degrees with +Y up; the document is
 * nanometers and millidegrees, so the projection is a field copy with `mm` and `deg`.
 *
 * Footprints are keyed by the source component's name (`fp:U1`). Copper (tracks, vias) gets deterministic ids
 * (`trk:g.<hash>`) and every object provenance `generated` (tool `circuit-json`), so a regeneration replaces it.
 * Copper pours are fill results, not zone intent: they become derived fill only. Nets come from the source
 * traces' connectivity (source ports and source nets joined).
 */
import type { AnyCircuitElement } from "circuit-json";
import {
  COPPER_LAYERS,
  deg,
  mm,
  normAngle,
  rotatePoint,
  type AnyLayer,
  type BoardRec,
  type CopperLayer,
  type FootprintGraphic,
  type FootprintRec,
  type FootprintText,
  type KeepoutRec,
  type Netlist,
  type Pad,
  type Point,
  type Provenance,
  type RuleRec,
  type Side,
  type Vertex,
} from "@protoboardai/board";
import { assemble, emptyDraft, type Draft } from "../assemble.js";
import type { FillPolygon } from "../fill.js";
import { ccwContour, circleContour, dedupeContour, polygonArea, tessellate, validContour } from "../geom.js";
import { Reporter } from "../report.js";
import type { BoardImportResult } from "../types.js";

export const CIRCUIT_JSON_IMPORTER_ID = "circuit-json";

export interface CircuitJsonImportOptions {
  name?: string;
  /** Provenance of everything imported (default `generated`: Circuit JSON is a generator's output). */
  provenance?: "generated" | "imported";
  recenter?: boolean;
}

type El<T extends AnyCircuitElement["type"]> = Extract<AnyCircuitElement, { type: T }>;
// shape-specific fields are read through this view; READ_FIELDS and the conformance test pin their names
type Loose = Record<string, any>;
type XY = { x: number; y: number };

const P = (p: Loose | undefined): Point => ({ x: mm(Number(p?.x ?? 0)) || 0, y: mm(Number(p?.y ?? 0)) || 0 });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** A ring of Circuit JSON points (with optional DXF-style bulges) as a contour. */
function ringContour(vertices: readonly Loose[]): Vertex[] {
  const out: Vertex[] = vertices.map((v) => {
    const p = P(v as XY);
    const b = Number(v.bulge ?? 0);
    if (!b) return p;
    const sweep = Math.round(((4 * Math.atan(b)) * 180_000) / Math.PI);
    return sweep && sweep > -360_000 && sweep <= 360_000 ? { ...p, sweep } : p;
  });
  return dedupeContour(out);
}

const flat = (pts: readonly XY[]): number[] => pts.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);

export function importCircuitJson(input: readonly unknown[], options: CircuitJsonImportOptions = {}): BoardImportResult {
  const t0 = performance.now();
  const rep = new Reporter();
  const PROV: Provenance = { by: options.provenance ?? "generated", tool: "circuit-json" };
  const els = input.filter((e): e is AnyCircuitElement => !!e && typeof e === "object" && typeof (e as Loose).type === "string");
  if (els.length !== input.length) rep.dropped("Circuit JSON entry", "not an element (no type)", { count: input.length - els.length });
  const of = <T extends AnyCircuitElement["type"]>(t: T): El<T>[] => els.filter((e): e is El<T> => e.type === t);

  // ---------------------------------------------------------------- board
  const boards = of("pcb_board");
  if (boards.length > 1) rep.dropped("pcb_board", "a document holds one board; the first is imported", { count: boards.length - 1 });
  const pb = boards[0] as Loose | undefined;
  const nLayers = Math.max(1, Math.min(10, Number(pb?.num_layers ?? 2)));
  const copper: CopperLayer[] = nLayers <= 1 ? ["top"] : ["top", ...COPPER_LAYERS.slice(1, nLayers - 1), "bottom"];
  const board: BoardRec = { kind: "board", id: "board", name: clip(options.name ?? "imported board", 120), thickness: mm(Number(pb?.thickness ?? 1.6)), copper_layers: copper.length, origin: "center", provenance: PROV };
  if (pb && pb.thickness === undefined) rep.approximated("board thickness", "absent; 1.6 mm used");
  const draft: Draft = emptyDraft(board);
  if (pb) {
    let outline: Vertex[] | undefined;
    if (Array.isArray(pb.outline) && pb.outline.length >= 3) outline = ringContour(pb.outline);
    else if (pb.width > 0 && pb.height > 0) {
      const c = P(pb.center);
      const w = mm(pb.width) / 2;
      const h = mm(pb.height) / 2;
      outline = [
        { x: c.x - w, y: c.y - h },
        { x: c.x + w, y: c.y - h },
        { x: c.x + w, y: c.y + h },
        { x: c.x - w, y: c.y + h },
      ];
    }
    const valid = outline && validContour(ccwContour(outline));
    if (valid) draft.outline = { kind: "outline", id: "outline", outline: valid, source: { kind: "board" }, provenance: PROV };
    else rep.dropped("board outline", "the pcb_board has neither an outline nor a size");
    draft.rules.push(...boardRules(pb, PROV, rep));
  } else rep.dropped("board outline", "no pcb_board element");

  // ---------------------------------------------------------------- nets: union of ports and nets by traces and connectivity keys
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let x = a;
    while (parent.get(x) !== r) {
      const nx = parent.get(x)!;
      parent.set(x, r);
      x = nx;
    }
    return r;
  };
  const node = (a: string) => {
    if (!parent.has(a)) parent.set(a, a);
    return a;
  };
  const join = (a: string, b: string) => {
    const ra = find(node(a));
    const rb = find(node(b));
    if (ra !== rb) parent.set(ra, rb);
  };
  const sourcePorts = new Map(of("source_port").map((p) => [p.source_port_id, p]));
  const sourceNets = of("source_net");
  const sourceTraces = of("source_trace");
  for (const t of sourceTraces) {
    const tk = `t:${t.source_trace_id}`;
    node(tk);
    for (const p of t.connected_source_port_ids ?? []) join(tk, `p:${p}`);
    for (const n of t.connected_source_net_ids ?? []) join(tk, `n:${n}`);
  }
  // groups that carry a name or a trace become nets
  const groupName = new Map<string, string>();
  for (const n of [...sourceNets].sort((a, b) => (a.source_net_id < b.source_net_id ? -1 : 1))) {
    const r = find(node(`n:${n.source_net_id}`));
    if (!groupName.has(r) && n.name) groupName.set(r, n.name);
  }
  for (const t of [...sourceTraces].sort((a, b) => (a.source_trace_id < b.source_trace_id ? -1 : 1))) {
    const r = find(`t:${t.source_trace_id}`);
    if (!groupName.has(r)) groupName.set(r, (t as Loose).display_name ?? (t as Loose).name ?? t.source_trace_id);
  }
  // distinct groups with the same name are one net
  const netOfKey = (k: string): string | undefined => (parent.has(k) ? groupName.get(find(k)) : undefined);
  const usedNets = new Set<string>(groupName.values());
  // tscircuit's connectivity keys: a port or via outside every source trace still names its net through its key
  const keyNet = new Map<string, string>();
  for (const t of sourceTraces) {
    const k = (t as Loose).subcircuit_connectivity_map_key as string | undefined;
    const n = netOfKey(`t:${t.source_trace_id}`);
    if (k && n && !keyNet.has(k)) keyNet.set(k, n);
  }
  for (const s of sourceNets) {
    const k = (s as Loose).subcircuit_connectivity_map_key as string | undefined;
    const n = netOfKey(`n:${s.source_net_id}`);
    if (k && n && !keyNet.has(k)) keyNet.set(k, n);
  }
  let byKey = 0;
  const netOfPort = (sourcePortId: string | undefined) => {
    if (!sourcePortId) return undefined;
    const direct = netOfKey(`p:${sourcePortId}`);
    if (direct) return direct;
    const k = (sourcePorts.get(sourcePortId) as Loose | undefined)?.subcircuit_connectivity_map_key as string | undefined;
    const n = k ? keyNet.get(k) : undefined;
    if (n) byKey++;
    return n;
  };
  const netOfTrace = (id: string | undefined) => (id ? netOfKey(`t:${id}`) : undefined);
  const netOfNet = (id: string | undefined) => (id ? netOfKey(`n:${id}`) : undefined);
  const pcbPorts = new Map(of("pcb_port").map((p) => [p.pcb_port_id, p]));

  // ---------------------------------------------------------------- footprints
  const sourceComponents = new Map(els.filter((e) => e.type === "source_component").map((e) => [(e as Loose).source_component_id as string, e as Loose]));
  const cad = new Map(of("cad_component").map((c) => [c.pcb_component_id, c]));
  const fps = new Map<string, FootprintRec>();
  const refs = new Set<string>();
  const pins = new Map<string, Set<string>>();
  for (const pc of of("pcb_component")) {
    const sc = sourceComponents.get(pc.source_component_id);
    const raw = String(sc?.name ?? pc.pcb_component_id);
    let ref = raw.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z]/.test(ref)) ref = `X${ref}`;
    const base = ref;
    for (let n = 2; refs.has(ref); n++) ref = `${base}_${n}`;
    refs.add(ref);
    if (ref !== raw) rep.approximated("component name renamed", "references are letters, digits and _ and unique on the board", { source: `${raw} -> ${ref}` });
    const sp = sc?.supplier_part_numbers as Record<string, string[]> | undefined;
    const supplier = [...(sp?.jlcpcb ?? []), ...(sp?.lcsc ?? [])].find((s) => /^C\d+$/.test(s));
    const mpn = sc?.manufacturer_part_number as string | undefined;
    const fpName = (cad.get(pc.pcb_component_id) as Loose | undefined)?.footprinter_string ?? `tscircuit:${mpn ?? sc?.ftype ?? "footprint"}`;
    const value = (sc?.display_value as string | undefined) ?? mpn;
    const fileSide: Side = pc.layer === "bottom" ? "bottom" : "top";
    // a component whose SMD pads all sit on the other side is placed on the side of its pads (every point keeps
    // its position; only the footprint's own side flips)
    const padSides = (of("pcb_smtpad") as Loose[]).filter((p) => p.pcb_component_id === pc.pcb_component_id).map((p) => (p.layer === "bottom" ? "bottom" : "top"));
    const side: Side = padSides.length && padSides.every((s) => s !== fileSide) ? (fileSide === "top" ? "bottom" : "top") : fileSide;
    if (side !== fileSide) rep.approximated("component with all its SMD pads on the other side", `imported as a ${side} footprint (positions unchanged; the footprint's own side flips)`, { source: pc.pcb_component_id });
    if (pc.layer !== "top" && pc.layer !== "bottom") rep.approximated("component on an inner layer", "placed on the top", { source: pc.pcb_component_id });
    fps.set(pc.pcb_component_id, {
      kind: "footprint",
      id: `fp:${ref}`,
      ref,
      footprint: clip(String(fpName), 200),
      ...(value ? { value: clip(String(value), 200) } : {}),
      ...(supplier ? { supplier_part: supplier } : {}),
      ...P(pc.center),
      rotation: normAngle(deg(Number(pc.rotation ?? 0))),
      side,
      pads: [],
      provenance: PROV,
    });
  }
  /** A world point (millimeters) in a footprint's own frame (nanometers). */
  const toFrame = (fp: FootprintRec, w: Loose): Point => {
    const W = P(w);
    const r = rotatePoint({ x: W.x - fp.x, y: W.y - fp.y }, -fp.rotation);
    const x = Math.round(fp.side === "bottom" ? -r.x : r.x);
    return { x: x || 0, y: Math.round(r.y) || 0 };
  };
  /** A world rotation (degrees) in a footprint's frame. */
  const frameRot = (fp: FootprintRec, a: number) => normAngle(fp.side === "bottom" ? fp.rotation - deg(a) : deg(a) - fp.rotation);
  const frameLayer = (fp: FootprintRec, layer: string | undefined, kind: "silkscreen" | "fabrication" | "courtyard"): AnyLayer => {
    const worldSide = layer === "bottom" ? "bottom" : "top";
    const own = worldSide === fp.side ? "top" : "bottom";
    return `${own}_${kind}` as AnyLayer;
  };
  const owner = (e: Loose): FootprintRec | undefined => (e.pcb_component_id ? fps.get(e.pcb_component_id) : undefined);
  const extras = new Map<string, { graphics: FootprintGraphic[]; texts: FootprintText[]; courtyard?: Vertex[] }>();
  const extra = (fp: FootprintRec) => {
    let x = extras.get(fp.id);
    if (!x) extras.set(fp.id, (x = { graphics: [], texts: [] }));
    return x;
  };

  // ---------------------------------------------------------------- pads
  const padNumber = (e: Loose): { number: string; net?: string } => {
    const port = e.pcb_port_id ? pcbPorts.get(e.pcb_port_id) : undefined;
    const sp = port ? sourcePorts.get(port.source_port_id) : undefined;
    const n = sp?.pin_number !== undefined ? String(sp.pin_number) : sp?.name ?? e.port_hints?.[0] ?? "_";
    const net = netOfPort(sp?.source_port_id);
    return { number: clip(String(n).replace(/\s+/g, "_") || "_", 40), ...(net ? { net } : {}) };
  };
  const addPad = (fp: FootprintRec, pad: Pad, net: string | undefined) => {
    (fp.pads as Pad[]).push(pad);
    if (net) {
      const s = pins.get(net) ?? new Set<string>();
      s.add(`${fp.ref}.${pad.number}`);
      pins.set(net, s);
    }
  };
  const polyPoints = (fp: FootprintRec, center: Point, pts: readonly XY[]): Vertex[] | undefined => {
    const c = pts.map((p) => {
      const f = toFrame(fp, p);
      return { x: f.x - center.x, y: f.y - center.y };
    });
    return validContour(ccwContour(dedupeContour(c)));
  };
  const margins = (e: Loose) => ({ ...(e.soldermask_margin !== undefined ? { mask_margin: mm(e.soldermask_margin) } : {}), ...(e.solderpaste_margin !== undefined ? { paste_margin: mm(e.solderpaste_margin) } : {}) });

  for (const e of of("pcb_smtpad") as Loose[]) {
    const fp = owner(e);
    if (!fp) {
      rep.dropped("pcb_smtpad", "not on a component (board-level pads are not modeled)", { source: e.pcb_smtpad_id });
      continue;
    }
    const worldSide = e.layer === "bottom" ? "bottom" : "top";
    // a pad on the other side from its component keeps its position with layer "bottom" (the footprint frame's other side)
    const frameSide = worldSide === fp.side ? ("top" as const) : ("bottom" as const);
    if (frameSide === "bottom") rep.info("pcb_smtpad on the other side from its component", "kept on the opposite side (pad layer bottom in the footprint frame)", { source: e.pcb_smtpad_id });
    if (e.is_covered_with_solder_mask) rep.approximated("pcb_smtpad covered with solder mask", "mask coverage of a pad is not modeled", { source: e.pcb_smtpad_id });
    const { number, net } = padNumber(e);
    const common = { number, type: "smd" as const, layer: frameSide, ...margins(e) };
    let pad: Pad | undefined;
    if (e.shape === "polygon") {
      const xs = e.points.map((p: XY) => p.x);
      const ys = e.points.map((p: XY) => p.y);
      const c = toFrame(fp, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
      const points = polyPoints(fp, c, e.points);
      if (points) pad = { ...common, shape: "polygon", x: c.x, y: c.y, points };
    } else {
      const c = toFrame(fp, e);
      const rotation = frameRot(fp, Number(e.ccw_rotation ?? 0));
      const base = { ...common, x: c.x, y: c.y, ...(rotation ? { rotation } : {}) };
      const cr = Number(e.corner_radius ?? e.rect_border_radius ?? 0);
      if (e.shape === "circle") pad = { ...base, shape: "circle", radius: mm(e.radius) };
      else if (e.shape === "rect" || e.shape === "rotated_rect") pad = cr > 0 ? { ...base, shape: "roundrect", width: mm(e.width), height: mm(e.height), corner_radius: mm(cr) } : { ...base, shape: "rect", width: mm(e.width), height: mm(e.height) };
      else if (e.shape === "pill" || e.shape === "rotated_pill") pad = { ...base, shape: "oval", width: mm(e.width), height: mm(e.height) };
      else rep.dropped("pcb_smtpad", `shape ${e.shape} not known`, { source: e.pcb_smtpad_id });
    }
    if (pad) addPad(fp, pad, net);
  }

  for (const e of of("pcb_plated_hole") as Loose[]) {
    const fp = owner(e);
    if (!fp) {
      rep.dropped("pcb_plated_hole", "not on a component (board-level plated holes are not modeled)", { source: e.pcb_plated_hole_id });
      continue;
    }
    const { number, net } = padNumber(e);
    const c = toFrame(fp, e);
    const common = { number, type: "th" as const, x: c.x, y: c.y, ...margins(e) };
    const rot = (a: unknown) => {
      const r = frameRot(fp, Number(a ?? 0));
      return r ? { rotation: r } : {};
    };
    if (Number(e.hole_offset_x ?? 0) || Number(e.hole_offset_y ?? 0)) rep.approximated("plated hole offset", "the hole is placed at the pad center", { source: e.pcb_plated_hole_id });
    const holeWH = e.hole_width !== undefined && e.hole_height !== undefined && e.hole_width !== e.hole_height ? { hole_width: mm(e.hole_width), hole_height: mm(e.hole_height) } : { hole_diameter: mm(e.hole_diameter ?? e.hole_width ?? e.hole_height) };
    let pad: Pad | undefined;
    switch (e.shape) {
      case "circle":
        pad = { ...common, shape: "circle", outer_diameter: mm(e.outer_diameter), hole_diameter: mm(e.hole_diameter) };
        break;
      case "oval":
      case "pill":
        pad = { ...common, shape: "oval", outer_width: mm(e.outer_width), outer_height: mm(e.outer_height), ...holeWH, ...rot(e.ccw_rotation) };
        break;
      case "circular_hole_with_rect_pad":
      case "pill_hole_with_rect_pad":
      case "rotated_pill_hole_with_rect_pad": {
        if (e.shape === "rotated_pill_hole_with_rect_pad" && Number(e.hole_ccw_rotation ?? 0) !== Number(e.rect_ccw_rotation ?? 0)) rep.approximated("plated hole turned apart from its pad", "the hole takes the pad's rotation", { source: e.pcb_plated_hole_id });
        const br = Number(e.rect_border_radius ?? 0);
        pad = { ...common, shape: br > 0 ? "roundrect" : "rect", outer_width: mm(e.rect_pad_width), outer_height: mm(e.rect_pad_height), ...(br > 0 ? { corner_radius: mm(br) } : {}), ...holeWH, ...rot(e.rect_ccw_rotation) };
        break;
      }
      case "hole_with_polygon_pad": {
        // pad_outline is relative to the hole's center
        const pts = (e.pad_outline as XY[]).map((p) => ({ x: Number(p.x) + Number(e.x), y: Number(p.y) + Number(e.y) }));
        const points = polyPoints(fp, c, pts);
        if (points) {
          const xs = points.map((p) => p.x);
          const ys = points.map((p) => p.y);
          pad = { ...common, shape: "polygon", points, outer_width: Math.max(1, Math.max(...xs) - Math.min(...xs)), outer_height: Math.max(1, Math.max(...ys) - Math.min(...ys)), ...holeWH };
          rep.info("plated hole with a polygon pad", "its pad outline is read relative to the hole's center", { source: e.pcb_plated_hole_id });
        }
        break;
      }
      default:
        rep.dropped("pcb_plated_hole", `shape ${e.shape} not known`, { source: e.pcb_plated_hole_id });
    }
    if (pad) addPad(fp, pad, net);
  }

  for (const e of of("pcb_hole") as Loose[]) {
    const fp = owner(e);
    const d = Number(e.hole_diameter ?? Math.min(Number(e.hole_width ?? 0), Number(e.hole_height ?? 0)));
    if (!(d > 0)) {
      rep.dropped("pcb_hole", "no size", { source: e.pcb_hole_id });
      continue;
    }
    if (e.hole_shape !== "circle") rep.approximated("pcb_hole", `${e.hole_shape} hole read as round (its smaller size)`, { source: e.pcb_hole_id });
    if (!fp) {
      const c = P(e);
      draft.cutouts.push({ kind: "cutout", outline: circleContour(c.x, c.y, mm(d) / 2), provenance: PROV });
      rep.approximated("board-level pcb_hole", "imported as a round cutout", { source: e.pcb_hole_id });
      continue;
    }
    const c = toFrame(fp, e);
    (fp.pads as Pad[]).push({ number: "_", type: "np", shape: "circle", x: c.x, y: c.y, hole_diameter: mm(d) });
  }

  // ---------------------------------------------------------------- footprint drawings
  const stroke = (e: Loose) => Math.max(0, mm(Number(e.stroke_width ?? 0)));
  const drawing = (e: Loose, kind: "silkscreen" | "fabrication", shape: () => { frame: Omit<FootprintGraphic, "layer">; world: Omit<FootprintGraphic, "layer"> } | undefined) => {
    const g = shape();
    if (!g) {
      rep.dropped(`${e.type}`, "degenerate", { source: e[`${e.type}_id`] });
      return;
    }
    const fp = owner(e);
    if (fp) extra(fp).graphics.push({ layer: frameLayer(fp, e.layer, kind), ...g.frame });
    else draft.graphics.push({ kind: "graphic", layer: `${e.layer === "bottom" ? "bottom" : "top"}_${kind}` as AnyLayer, ...g.world, provenance: PROV });
  };
  const both = (fp: FootprintRec | undefined, pts: XY[]) => ({ frame: fp ? pts.map((p) => toFrame(fp, p)) : [], world: pts.map((p) => P(p)) });
  const pathShape = (e: Loose, closed = false) => () => {
    const route = (e.route ?? []) as XY[];
    if (route.length < 2) return undefined;
    const fp = owner(e);
    const b = both(fp, route);
    const sw = stroke(e);
    const isClosed = closed || (route.length > 3 && route[0].x === route[route.length - 1].x && route[0].y === route[route.length - 1].y);
    const mk = (pts: Point[]): Omit<FootprintGraphic, "layer"> => {
      const p = isClosed ? pts.slice(0, -1) : pts;
      return isClosed && p.length >= 3 ? { shape: "polygon", points: p, stroke_width: sw, ...(e.is_filled ? { filled: true as const } : {}) } : { shape: "path", points: pts, stroke_width: sw };
    };
    return { frame: mk(b.frame), world: mk(b.world) };
  };
  for (const e of of("pcb_silkscreen_line") as Loose[])
    drawing(e, "silkscreen", () => {
      const fp = owner(e);
      const b = both(fp, [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
      const sw = stroke(e);
      return { frame: { shape: "line", start: b.frame[0], end: b.frame[1], stroke_width: sw }, world: { shape: "line", start: b.world[0], end: b.world[1], stroke_width: sw } };
    });
  for (const e of of("pcb_silkscreen_path") as Loose[]) drawing(e, "silkscreen", pathShape(e));
  for (const e of of("pcb_fabrication_note_path") as Loose[]) drawing(e, "fabrication", pathShape(e));
  for (const e of of("pcb_silkscreen_circle") as Loose[])
    drawing(e, "silkscreen", () => {
      const r = mm(Number(e.radius));
      if (!(r > 0)) return undefined;
      const fp = owner(e);
      const b = both(fp, [e.center]);
      const f = e.is_filled ? { filled: true as const } : {};
      return { frame: { shape: "circle", center: b.frame[0], radius: r, stroke_width: stroke(e), ...f }, world: { shape: "circle", center: b.world[0], radius: r, stroke_width: stroke(e), ...f } };
    });
  for (const e of of("pcb_silkscreen_rect") as Loose[])
    drawing(e, "silkscreen", () => {
      const w = mm(Number(e.width));
      const h = mm(Number(e.height));
      if (!(w > 0 && h > 0)) return undefined;
      if (Number(e.corner_radius ?? 0) > 0) rep.approximated("pcb_silkscreen_rect corner radius", "corners drawn sharp", { source: e.pcb_silkscreen_rect_id });
      const fp = owner(e);
      const b = both(fp, [e.center]);
      const f = e.is_filled ? { filled: true as const } : {};
      const a = Number(e.ccw_rotation ?? 0);
      const fr = fp ? frameRot(fp, a) : 0;
      const wr = normAngle(deg(a));
      return { frame: { shape: "rect", center: b.frame[0], width: w, height: h, ...(fr ? { rotation: fr } : {}), stroke_width: stroke(e), ...f }, world: { shape: "rect", center: b.world[0], width: w, height: h, ...(wr ? { rotation: wr } : {}), stroke_width: stroke(e), ...f } };
    });
  for (const t of ["pcb_silkscreen_oval", "pcb_silkscreen_pill", "pcb_silkscreen_graphic", "pcb_fabrication_note_rect", "pcb_fabrication_note_dimension", "pcb_note_text", "pcb_note_path", "pcb_note_line", "pcb_note_rect", "pcb_note_dimension", "pcb_copper_text"] as const) {
    const n = els.filter((e) => e.type === t).length;
    if (n) rep.dropped(t, "not modeled by this adapter", { count: n });
  }

  const anchorOf = (a: string | undefined): FootprintText["anchor"] | undefined => {
    if (!a || a === "center") return undefined;
    if (a.endsWith("left")) return "left";
    if (a.endsWith("right")) return "right";
    return undefined;
  };
  const textEl = (e: Loose, kind: "silkscreen" | "fabrication") => {
    const text = String(e.text ?? "");
    const h = mm(Number(e.font_size ?? 1));
    if (!text || !(h > 0)) return rep.dropped(e.type, "empty or without a size", { source: e[`${e.type}_id`] });
    if (e.anchor_alignment && /^(top|bottom)_/.test(e.anchor_alignment)) rep.approximated("text anchored at its top or bottom", "anchored on its middle line", { source: e[`${e.type}_id`] });
    const anchor = anchorOf(e.anchor_alignment);
    const fp = owner(e);
    if (fp) {
      const p = toFrame(fp, e.anchor_position);
      const rotation = frameRot(fp, Number(e.ccw_rotation ?? 0));
      const role = text === fp.ref ? "ref" : "user";
      extra(fp).texts.push({ layer: frameLayer(fp, e.layer, kind), text: clip(role === "ref" ? fp.ref : text, 500), x: p.x, y: p.y, height: h, ...(rotation ? { rotation } : {}), ...(anchor ? { anchor } : {}), role });
    } else {
      const p = P(e.anchor_position);
      const rotation = normAngle(deg(Number(e.ccw_rotation ?? 0)));
      draft.texts.push({ kind: "text", layer: `${e.layer === "bottom" ? "bottom" : "top"}_${kind}` as AnyLayer, text: clip(text, 500), ...p, height: h, ...(rotation ? { rotation } : {}), ...(anchor ? { anchor } : {}), ...(e.is_mirrored ? { mirrored: true as const } : {}), provenance: PROV });
    }
  };
  for (const e of of("pcb_silkscreen_text") as Loose[]) textEl(e, "silkscreen");
  for (const e of of("pcb_fabrication_note_text") as Loose[]) textEl(e, "fabrication");
  for (const e of of("pcb_text") as Loose[]) {
    const text = String(e.text ?? "");
    const h = mm(Number(e.height ?? 0)) / Math.max(1, Number(e.lines ?? 1));
    if (!text || !(h > 0)) {
      rep.dropped("pcb_text", "empty or without a size", { source: e.pcb_text_id });
      continue;
    }
    const layer: AnyLayer = copper.includes(e.layer) ? e.layer : e.layer === "bottom" ? "bottom_silkscreen" : "top_silkscreen";
    rep.approximated("pcb_text", "its box becomes a text height (box height divided by its lines)", { source: e.pcb_text_id });
    draft.texts.push({ kind: "text", layer, text: clip(text, 500), ...P(e.center), height: Math.round(h), provenance: PROV });
  }

  // ---------------------------------------------------------------- courtyards
  const setCourtyard = (e: Loose, contour: Vertex[] | undefined) => {
    const fp = owner(e);
    if (!fp) return rep.dropped(e.type, "not on a component", { source: e[`${e.type}_id`] });
    const c = contour && validContour(ccwContour(dedupeContour(contour)));
    if (!c) return rep.dropped(e.type, "degenerate", { source: e[`${e.type}_id`] });
    const x = extra(fp);
    if (x.courtyard) {
      rep.approximated("second courtyard", "kept as a courtyard graphic", { source: e[`${e.type}_id`] });
      x.graphics.push({ layer: "top_courtyard", shape: "polygon", points: c, stroke_width: 0 });
    } else x.courtyard = c;
  };
  for (const e of of("pcb_courtyard_outline") as Loose[]) {
    const fp = owner(e);
    setCourtyard(e, fp ? (e.outline as XY[]).map((p) => toFrame(fp, p)) : undefined);
  }
  for (const e of of("pcb_courtyard_polygon") as Loose[]) {
    const fp = owner(e);
    setCourtyard(e, fp ? (e.points as XY[]).map((p) => toFrame(fp, p)) : undefined);
  }
  for (const e of of("pcb_courtyard_rect") as Loose[]) {
    const fp = owner(e);
    if (!fp) {
      setCourtyard(e, undefined);
      continue;
    }
    const w = Number(e.width) / 2;
    const h = Number(e.height) / 2;
    const a = (Number(e.ccw_rotation ?? 0) * Math.PI) / 180;
    const corner = (dx: number, dy: number) => ({ x: Number(e.center.x) + dx * Math.cos(a) - dy * Math.sin(a), y: Number(e.center.y) + dx * Math.sin(a) + dy * Math.cos(a) });
    setCourtyard(e, [corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)].map((p) => toFrame(fp, p)));
  }
  for (const e of of("pcb_courtyard_circle") as Loose[]) {
    const fp = owner(e);
    if (!fp) {
      setCourtyard(e, undefined);
      continue;
    }
    const c = toFrame(fp, e.center);
    setCourtyard(e, circleContour(c.x, c.y, mm(Number(e.radius))));
  }

  for (const fp of fps.values()) {
    const x = extras.get(fp.id);
    const rec: FootprintRec = { ...fp, ...(x?.courtyard ? { courtyard: x.courtyard } : {}), ...(x?.graphics.length ? { graphics: x.graphics } : {}), ...(x?.texts.length ? { texts: x.texts.slice(0, 100) } : {}) };
    draft.footprints.push(rec);
  }
  const pasteCount = els.filter((e) => e.type === "pcb_solder_paste").length;
  if (pasteCount) rep.dropped("pcb_solder_paste", "paste openings are derived from pads (paste_margin); not imported", { count: pasteCount });

  // ---------------------------------------------------------------- copper
  const layerOk = (l: unknown): l is CopperLayer => typeof l === "string" && (copper as string[]).includes(l);
  const vias = of("pcb_via") as Loose[];
  for (const t of of("pcb_trace") as Loose[]) {
    const route = (t.route ?? []) as Loose[];
    // the trace's net: its source trace, else a port it starts or ends on
    const portNet = () => {
      for (const p of route) for (const id of [p.start_pcb_port_id, p.end_pcb_port_id]) if (id && pcbPorts.get(id)) return netOfPort(pcbPorts.get(id)!.source_port_id);
      return undefined;
    };
    const net = netOfTrace(t.source_trace_id) ?? portNet();
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i];
      const b = route[i + 1];
      if (a.route_type === "through_pad" || b.route_type === "through_pad") continue;
      if (a.route_type !== "wire" || b.route_type !== "wire") continue;
      if (a.layer !== b.layer) {
        rep.dropped("trace step between layers without a via point", "skipped", { source: t.pcb_trace_id });
        continue;
      }
      if (!layerOk(a.layer)) {
        rep.dropped("trace segment", `on layer ${a.layer}, which the board does not have`, { source: t.pcb_trace_id });
        continue;
      }
      const start = P(a);
      const end = P(b);
      if (start.x === end.x && start.y === end.y) continue;
      const w = mm(Number(a.width ?? b.width ?? 0));
      if (!(w > 0)) {
        rep.dropped("trace segment", "no width", { source: t.pcb_trace_id });
        continue;
      }
      if (a.start_width !== undefined || a.end_width !== undefined) rep.approximated("tapered trace segment", "one width (the point's width) used", { source: t.pcb_trace_id });
      draft.tracks.push({ kind: "track", ...(net ? { net } : {}), layer: a.layer, width: w, start, end, provenance: PROV });
    }
    for (const p of route) {
      if (p.route_type === "through_pad") {
        if (p.start_layer === p.end_layer && layerOk(p.start_layer) && Number(p.width) > 0) {
          const start = P(p.start);
          const end = P(p.end);
          if (start.x !== end.x || start.y !== end.y) draft.tracks.push({ kind: "track", ...(net ? { net } : {}), layer: p.start_layer, width: mm(p.width), start, end, provenance: PROV });
        } else rep.dropped("through-pad route step", "between layers or without a width", { source: t.pcb_trace_id });
      }
      if (p.route_type !== "via") continue;
      const near = vias.some((v) => Math.abs(Number(v.x) - Number(p.x)) < 0.001 && Math.abs(Number(v.y) - Number(p.y)) < 0.001);
      if (near) continue;
      if (Number(p.outer_diameter) > 0 && Number(p.hole_diameter) > 0 && layerOk(p.from_layer) && layerOk(p.to_layer)) {
        const [from, to] = [p.from_layer, p.to_layer].sort((x, y) => copper.indexOf(x) - copper.indexOf(y));
        draft.vias.push({ kind: "via", ...(net ? { net } : {}), ...P(p), outer_diameter: mm(p.outer_diameter), hole_diameter: mm(p.hole_diameter), from_layer: from, to_layer: to, provenance: PROV });
      } else rep.dropped("via route point", "no pcb_via there and no sizes or layers on the point", { source: t.pcb_trace_id });
    }
  }
  for (const v of vias) {
    const ls = ((v.layers as string[] | undefined) ?? [v.from_layer, v.to_layer]).filter(layerOk);
    const span = [v.from_layer, v.to_layer].every(layerOk) ? [v.from_layer, v.to_layer] : ls.length ? ls : [copper[0], copper[copper.length - 1]];
    const sorted = [...span].sort((a, b) => copper.indexOf(a) - copper.indexOf(b));
    const net =
      netOfTrace(v.source_trace_id) ??
      netOfNet(v.source_net_id) ??
      (v.pcb_trace_id ? netOfTrace((of("pcb_trace") as Loose[]).find((t) => t.pcb_trace_id === v.pcb_trace_id)?.source_trace_id) : undefined) ??
      (v.subcircuit_connectivity_map_key ? keyNet.get(v.subcircuit_connectivity_map_key) : undefined);
    const top = v.tented_on_top;
    const bottom = v.tented_on_bottom;
    const tented = top === undefined && bottom === undefined ? undefined : top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "none";
    if (!(Number(v.outer_diameter) > 0 && Number(v.hole_diameter) > 0)) {
      rep.dropped("pcb_via", "no diameters", { source: v.pcb_via_id });
      continue;
    }
    draft.vias.push({ kind: "via", ...(net ? { net } : {}), ...P(v), outer_diameter: mm(v.outer_diameter), hole_diameter: mm(v.hole_diameter), from_layer: sorted[0], to_layer: sorted[sorted.length - 1], ...(tented ? { tented } : {}), provenance: PROV });
  }

  // ---------------------------------------------------------------- keep-outs, cutouts, pours
  for (const k of of("pcb_keepout") as Loose[]) {
    let outline: Vertex[] | undefined;
    if (k.shape === "rect") {
      const c = P(k.center);
      const w = mm(k.width) / 2;
      const h = mm(k.height) / 2;
      outline = [
        { x: c.x - w, y: c.y - h },
        { x: c.x + w, y: c.y - h },
        { x: c.x + w, y: c.y + h },
        { x: c.x - w, y: c.y + h },
      ];
    } else if (k.shape === "circle") {
      const c = P(k.center);
      outline = circleContour(c.x, c.y, mm(k.radius));
    } else if (Array.isArray(k.outline)) outline = (k.outline as XY[]).map(P);
    const c = outline && validContour(ccwContour(dedupeContour(outline)));
    if (!c) {
      rep.dropped("pcb_keepout", "degenerate", { source: k.pcb_keepout_id });
      continue;
    }
    let ls = ((k.layers ?? []) as string[]).filter(layerOk);
    if (!ls.length) {
      ls = [...copper];
      rep.approximated("pcb_keepout without copper layers", "applied to every copper layer", { source: k.pcb_keepout_id });
    }
    const tracks = k.allow_traces !== true;
    rep.info("pcb_keepout", "vias and pours follow allow_traces (Circuit JSON has no separate flags)", { source: k.pcb_keepout_id });
    if (k.excluded_pcb_component_ids?.length) rep.dropped("pcb_keepout excluded components", "keep-out exceptions are not modeled", { source: k.pcb_keepout_id });
    const rec: Omit<KeepoutRec, "id"> = { kind: "keepout", outline: c, layers: copper.filter((l) => ls.includes(l)), blocks: { tracks, vias: tracks, pours: tracks, footprints: k.allow_placements !== true }, tier: k.warning_only ? "policy" : "no_go", ...(k.description ? { description: clip(String(k.description), 500) } : {}), provenance: PROV };
    draft.keepouts.push(rec);
  }
  for (const c of of("pcb_cutout") as Loose[]) {
    let outline: Vertex[] | undefined;
    if (c.shape === "rect") {
      const ctr = c.center as XY;
      const w = Number(c.width) / 2;
      const h = Number(c.height) / 2;
      const a = (Number(c.rotation ?? 0) * Math.PI) / 180;
      const corner = (dx: number, dy: number) => P({ x: ctr.x + dx * Math.cos(a) - dy * Math.sin(a), y: ctr.y + dx * Math.sin(a) + dy * Math.cos(a) });
      outline = [corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)];
      if (Number(c.corner_radius ?? 0) > 0) rep.approximated("pcb_cutout corner radius", "corners cut sharp", { source: c.pcb_cutout_id });
    } else if (c.shape === "circle") {
      const ctr = P(c.center);
      outline = circleContour(ctr.x, ctr.y, mm(c.radius));
    } else if (c.shape === "polygon") outline = (c.points as XY[]).map(P);
    else rep.dropped("pcb_cutout", `shape ${c.shape} not modeled`, { source: c.pcb_cutout_id });
    const v = outline && validContour(ccwContour(dedupeContour(outline)));
    if (v) draft.cutouts.push({ kind: "cutout", outline: v, provenance: PROV });
    else if (outline) rep.dropped("pcb_cutout", "degenerate", { source: c.pcb_cutout_id });
  }
  for (const p of of("pcb_copper_pour") as Loose[]) {
    if (!layerOk(p.layer)) {
      rep.dropped("pcb_copper_pour", `on layer ${p.layer}, which the board does not have`, { source: p.pcb_copper_pour_id });
      continue;
    }
    let polys: FillPolygon[] = [];
    const ring = (vs: Loose[]): XY[] => tessellate(ringContour(vs), 2);
    const orient = (pts: XY[], ccw: boolean) => (polygonArea(pts) >= 0 === ccw ? pts : [...pts].reverse());
    if (p.shape === "rect") {
      const ctr = p.center as XY;
      const w = Number(p.width) / 2;
      const h = Number(p.height) / 2;
      const a = (Number(p.rotation ?? 0) * Math.PI) / 180;
      const pts = [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ].map(([dx, dy]) => P({ x: ctr.x + dx * Math.cos(a) - dy * Math.sin(a), y: ctr.y + dx * Math.sin(a) + dy * Math.cos(a) }));
      polys = [{ outer: flat(orient(pts, true)), holes: [] }];
    } else if (p.shape === "polygon") polys = [{ outer: flat(orient((p.points as XY[]).map(P), true)), holes: [] }];
    else if (p.shape === "brep") {
      const b = p.brep_shape as Loose;
      polys = [{ outer: flat(orient(ring(b.outer_ring.vertices), true)), holes: (b.inner_rings ?? []).map((r: Loose) => flat(orient(ring(r.vertices), false))) }];
    }
    const net = netOfNet(p.source_net_id);
    if (polys.length) draft.looseFills.push({ source: String(p.pcb_copper_pour_id), ...(net ? { net } : {}), layer: p.layer, polygons: polys });
  }
  if (byKey) rep.info("pad joined to its net by connectivity key", "the port is in no source trace; tscircuit's connectivity key names its net", { count: byKey });
  const pours = draft.looseFills.length;
  if (pours) rep.info("pcb_copper_pour", "imported as derived fill only (a pour is a fill result, not zone intent)", { count: pours });

  // ---------------------------------------------------------------- netlist
  for (const t of draft.tracks) if (t.net) usedNets.add(t.net);
  const netlist: Netlist = { source: "circuit-json", nets: [...usedNets].sort().map((name) => ({ name, pins: [...(pins.get(name) ?? [])].sort() })) };
  const ignored = new Map<string, number>();
  const handled = new Set(["pcb_board", "source_port", "source_net", "source_trace", "pcb_port", "source_component", "cad_component", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_silkscreen_line", "pcb_silkscreen_path", "pcb_silkscreen_rect", "pcb_silkscreen_circle", "pcb_silkscreen_text", "pcb_fabrication_note_path", "pcb_fabrication_note_text", "pcb_text", "pcb_courtyard_outline", "pcb_courtyard_rect", "pcb_courtyard_polygon", "pcb_courtyard_circle", "pcb_solder_paste", "pcb_trace", "pcb_via", "pcb_keepout", "pcb_cutout", "pcb_copper_pour", "pcb_silkscreen_oval", "pcb_silkscreen_pill", "pcb_silkscreen_graphic", "pcb_fabrication_note_rect", "pcb_fabrication_note_dimension", "pcb_note_text", "pcb_note_path", "pcb_note_line", "pcb_note_rect", "pcb_note_dimension", "pcb_copper_text"]);
  for (const e of els) if (e.type.startsWith("pcb_") && !handled.has(e.type) && !/_(error|warning)$/.test(e.type)) ignored.set(e.type, (ignored.get(e.type) ?? 0) + 1);
  for (const [t, n] of ignored) rep.dropped(t, "not a board object this adapter reads", { count: n });

  const done = assemble(draft, { netlist, source: "circuit-json", rep, recenter: options.recenter });
  if (done.offset.x || done.offset.y) rep.info("board offset", `the board was centered on its outline (offset ${done.offset.x}, ${done.offset.y} nm); Circuit JSON x_mm = (x + offset.x) / 1e6, y_mm = (y + offset.y) / 1e6`);
  return { ...done, netlist, report: rep.items(), summary: rep.summary(), importer: CIRCUIT_JSON_IMPORTER_ID, ms: performance.now() - t0 };
}

/** pcb_board's minimum spacings as floor rules (tscircuit's checks); same-net spacing has no rule. */
function boardRules(pb: Loose, prov: Provenance, rep: Reporter): RuleRec[] {
  const out: RuleRec[] = [];
  const map: Record<string, { check: RuleRec["check"]; between?: RuleRec["applies"]["between"] }> = {
    min_trace_width: { check: "track_width" },
    min_via_hole_diameter: { check: "via_hole" },
    min_via_pad_diameter: { check: "via_diameter" },
    min_board_edge_clearance: { check: "edge_clearance" },
    min_trace_to_pad_edge_clearance: { check: "clearance", between: ["track", "pad"] },
    min_pad_edge_to_pad_edge_clearance: { check: "clearance", between: ["pad", "pad"] },
    min_via_edge_to_pad_edge_clearance: { check: "clearance", between: ["via", "pad"] },
    min_different_net_trace_edge_to_trace_edge_clearance: { check: "clearance", between: ["track", "track"] },
    min_trace_to_hole_edge_clearance: { check: "hole_clearance", between: ["track", "hole"] },
    min_via_hole_edge_to_via_hole_edge_clearance: { check: "hole_to_hole", between: ["via", "via"] },
    min_plated_hole_drill_edge_to_drill_edge_clearance: { check: "hole_to_hole", between: ["pad", "pad"] },
  };
  for (const [k, v] of Object.entries(pb)) {
    if (!k.startsWith("min_")) continue;
    const m = map[k];
    if (!m) {
      if (typeof v === "number" && v > 0) rep.dropped("pcb_board minimum", "no rule check expresses it", { source: k });
      continue;
    }
    if (typeof v !== "number" || !(v > 0)) continue;
    out.push({ kind: "rule", id: `rule:circuit-json.${k}`, tier: "floor", check: m.check, applies: m.between ? { between: m.between } : {}, min: mm(v), note: `pcb_board ${k}`, provenance: prov });
  }
  return out;
}
