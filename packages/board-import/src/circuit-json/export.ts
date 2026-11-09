/**
 * A board document to Circuit JSON, for the elements of the contract's table (section 2.1): components, pads,
 * plated holes, holes, traces, vias, keep-outs, the board, cutouts, silkscreen drawings and texts, and nets (with
 * the source ports and traces that join pads to them). Millimeters and degrees, +Y up; ids are deterministic
 * (`pcb_smtpad_0`, ... in document order). What has no Circuit JSON element is listed in the report.
 */
import type { AnyCircuitElement } from "circuit-json";
import {
  contourBox,
  copperLayers,
  footprintBox,
  footprintToWorld,
  normAngle,
  padsOf,
  recordsOfKind,
  sideLayer,
  toDeg,
  toMm,
  viaLayers,
  type BoardDocument,
  type FootprintGraphic,
  type FootprintRec,
  type Point,
  type TrackRec,
  type Vertex,
} from "@protoboardai/board";
import { arcPoints, tessellate } from "../geom.js";
import { Reporter } from "../report.js";
import type { ImportReportItem } from "@protoboardai/board";

export interface CircuitJsonExport {
  elements: AnyCircuitElement[];
  report: ImportReportItem[];
}

type Loose = Record<string, unknown>;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const M = (nm: number) => r6(toMm(nm));
const MP = (p: { x: number; y: number }) => ({ x: M(p.x), y: M(p.y) });
const D = (mdeg: number) => r6(toDeg(normAngle(mdeg)));

/** An arc as a polyline in 1 degree steps (the contract's projection), start included. */
const arcPolyline = (start: Point, end: Point, sweep: number): Point[] => [start, ...arcPoints(start, end, sweep, 1)];

export function exportCircuitJson(doc: BoardDocument): CircuitJsonExport {
  const rep = new Reporter();
  const out: Loose[] = [];
  const counters = new Map<string, number>();
  const nextId = (type: string) => {
    const n = counters.get(type) ?? 0;
    counters.set(type, n + 1);
    return `${type}_${n}`;
  };
  const copper = copperLayers(doc);

  // ---- board
  const outline = doc.records.get("outline");
  if (outline?.kind === "outline") {
    const b = contourBox(outline.outline);
    const rect = outline.outline.length === 4 && outline.outline.every((v) => v.sweep === undefined) && outline.outline.every((v) => (v.x === b.minX || v.x === b.maxX) && (v.y === b.minY || v.y === b.maxY));
    out.push({
      type: "pcb_board",
      pcb_board_id: "pcb_board_0",
      center: MP({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }),
      width: M(b.maxX - b.minX),
      height: M(b.maxY - b.minY),
      ...(rect ? {} : { outline: tessellate(outline.outline, 1).map(MP) }),
      thickness: M(doc.records.get("board")?.kind === "board" ? (doc.records.get("board") as { thickness: number }).thickness : 1_600_000),
      num_layers: copper.length,
      material: "fr4",
    });
  } else rep.dropped("board outline", "the board has none; pcb_board left out");
  for (const c of recordsOfKind(doc, "cutout")) out.push({ type: "pcb_cutout", pcb_cutout_id: nextId("pcb_cutout"), shape: "polygon", points: tessellate(c.outline, 1).map(MP) });

  // ---- nets and components
  const nets = doc.netlist?.nets ?? [];
  const netId = new Map<string, string>();
  nets.forEach((n, i) => {
    netId.set(n.name, `source_net_${i}`);
    out.push({ type: "source_net", source_net_id: `source_net_${i}`, name: n.name, member_source_group_ids: [] });
  });
  const portsOfNet = new Map<string, string[]>();
  const traceOfNet = new Map<string, string>();
  nets.forEach((n, i) => traceOfNet.set(n.name, `source_trace_${i}`));
  const footprints = recordsOfKind(doc, "footprint");
  footprints.forEach((fp, ci) => {
    const scId = `source_component_${ci}`;
    const pcId = `pcb_component_${ci}`;
    const box = footprintBox(fp);
    out.push({ type: "source_component", source_component_id: scId, ftype: "simple_chip", name: fp.ref, ...(fp.supplier_part ? { supplier_part_numbers: { jlcpcb: [fp.supplier_part] } } : {}) });
    out.push({ type: "pcb_component", pcb_component_id: pcId, source_component_id: scId, center: MP(fp), layer: fp.side, rotation: D(fp.rotation), width: M(box.maxX - box.minX), height: M(box.maxY - box.minY) });
    const world = padsOf(fp, copper);
    fp.pads.forEach((pad, pi) => {
      const wp = world[pi];
      const net = doc.padNets.get(wp.id);
      let portId: string | undefined;
      if (pad.type !== "np") {
        const spId = nextId("source_port");
        portId = nextId("pcb_port");
        out.push({ type: "source_port", source_port_id: spId, source_component_id: scId, name: pad.number, ...(/^\d+$/.test(pad.number) ? { pin_number: Number(pad.number) } : {}), port_hints: [pad.number] });
        out.push({ type: "pcb_port", pcb_port_id: portId, source_port_id: spId, pcb_component_id: pcId, x: M(wp.x), y: M(wp.y), layers: wp.layers });
        if (net) portsOfNet.set(net, [...(portsOfNet.get(net) ?? []), spId]);
      }
      const at = { x: M(wp.x), y: M(wp.y) };
      const rot = wp.rotation;
      const quarter = rot % 90_000 === 0;
      const swap = rot === 90_000 || rot === 270_000;
      const margins = { ...(pad.mask_margin !== undefined ? { soldermask_margin: M(pad.mask_margin) } : {}), ...(pad.paste_margin !== undefined ? { solderpaste_margin: M(pad.paste_margin) } : {}) };
      const polygonWorld = () => {
        const pts = tessellate(pad.points ?? [], 1).map((q) => {
          const r = rotate(q, pad.rotation ?? 0);
          return MP(footprintToWorld(fp, { x: pad.x + r.x, y: pad.y + r.y }));
        });
        return pts;
      };
      if (pad.type === "smd") {
        const base = { type: "pcb_smtpad", pcb_smtpad_id: nextId("pcb_smtpad"), pcb_component_id: pcId, ...(portId ? { pcb_port_id: portId } : {}), layer: wp.layers[0], port_hints: [pad.number], ...margins };
        if (pad.shape === "circle") out.push({ ...base, shape: "circle", ...at, radius: M(pad.radius!) });
        else if (pad.shape === "polygon") out.push({ ...base, shape: "polygon", points: polygonWorld() });
        else if (pad.shape === "oval") {
          const w = M(pad.width!);
          const h = M(pad.height!);
          if (quarter) out.push({ ...base, shape: "pill", ...at, width: swap ? h : w, height: swap ? w : h, radius: Math.min(w, h) / 2 });
          else out.push({ ...base, shape: "rotated_pill", ...at, width: w, height: h, radius: Math.min(w, h) / 2, ccw_rotation: D(rot) });
        } else {
          const w = M(pad.width!);
          const h = M(pad.height!);
          const cr = pad.shape === "roundrect" && pad.corner_radius ? { corner_radius: M(pad.corner_radius) } : {};
          if (quarter) out.push({ ...base, shape: "rect", ...at, width: swap ? h : w, height: swap ? w : h, ...cr });
          else out.push({ ...base, shape: "rotated_rect", ...at, width: w, height: h, ccw_rotation: D(rot), ...cr });
        }
      } else if (pad.type === "th") {
        const base = { type: "pcb_plated_hole", pcb_plated_hole_id: nextId("pcb_plated_hole"), pcb_component_id: pcId, ...(portId ? { pcb_port_id: portId } : {}), ...at, layers: copper, port_hints: [pad.number], ...margins };
        const hw = pad.hole_width ?? pad.hole_diameter!;
        const hh = pad.hole_height ?? pad.hole_diameter!;
        if (pad.shape === "circle") out.push({ ...base, shape: "circle", outer_diameter: M(pad.outer_diameter!), hole_diameter: M(pad.hole_diameter!) });
        else if (pad.shape === "oval") out.push({ ...base, shape: "pill", outer_width: M(pad.outer_width!), outer_height: M(pad.outer_height!), hole_width: M(hw), hole_height: M(hh), ccw_rotation: D(rot) });
        else if (pad.shape === "polygon") {
          const pts = polygonWorld().map((p) => ({ x: r6(p.x - at.x), y: r6(p.y - at.y) }));
          out.push({ ...base, shape: "hole_with_polygon_pad", hole_shape: pad.hole_diameter !== undefined ? "circle" : "pill", ...(pad.hole_diameter !== undefined ? { hole_diameter: M(pad.hole_diameter) } : { hole_width: M(hw), hole_height: M(hh) }), pad_outline: pts, hole_offset_x: 0, hole_offset_y: 0 });
        } else {
          const br = pad.shape === "roundrect" && pad.corner_radius ? { rect_border_radius: M(pad.corner_radius) } : {};
          if (pad.hole_diameter !== undefined) out.push({ ...base, shape: "circular_hole_with_rect_pad", hole_shape: "circle", pad_shape: "rect", hole_diameter: M(pad.hole_diameter), rect_pad_width: M(pad.outer_width!), rect_pad_height: M(pad.outer_height!), ...br, ...(rot ? { rect_ccw_rotation: D(rot) } : {}) });
          else out.push({ ...base, shape: "rotated_pill_hole_with_rect_pad", hole_shape: "rotated_pill", pad_shape: "rect", hole_width: M(hw), hole_height: M(hh), hole_ccw_rotation: D(rot), rect_pad_width: M(pad.outer_width!), rect_pad_height: M(pad.outer_height!), rect_ccw_rotation: D(rot), ...br });
        }
      } else out.push({ type: "pcb_hole", pcb_hole_id: nextId("pcb_hole"), pcb_component_id: pcId, hole_shape: "circle", hole_diameter: M(pad.hole_diameter!), ...at });
    });
    // footprint silkscreen and texts, in world coordinates
    for (const g of fp.graphics ?? []) silk(g, fp, pcId);
    for (const t of fp.texts ?? []) {
      const layer = sideLayer(t.layer, fp.side);
      if (layer !== "top_silkscreen" && layer !== "bottom_silkscreen") {
        rep.dropped("footprint text not on silkscreen", "only silkscreen texts have a Circuit JSON element", { id: fp.id });
        continue;
      }
      const w = footprintToWorld(fp, t);
      const rot = fp.side === "bottom" ? fp.rotation - (t.rotation ?? 0) : fp.rotation + (t.rotation ?? 0);
      out.push({ type: "pcb_silkscreen_text", pcb_silkscreen_text_id: nextId("pcb_silkscreen_text"), pcb_component_id: pcId, layer: layer === "top_silkscreen" ? "top" : "bottom", text: t.role === "ref" ? fp.ref : t.role === "value" && fp.value ? fp.value : t.text, anchor_position: MP(w), anchor_alignment: t.anchor === "left" ? "center_left" : t.anchor === "right" ? "center_right" : "center", font: "tscircuit2024", font_size: M(t.height), ccw_rotation: D(rot), ...(fp.side === "bottom" ? { is_mirrored: true } : {}) });
    }
    if (fp.courtyard) rep.dropped("footprint courtyard", "courtyards are not written to Circuit JSON by this adapter", { id: fp.id });
  });
  nets.forEach((n) => out.push({ type: "source_trace", source_trace_id: traceOfNet.get(n.name), connected_source_port_ids: portsOfNet.get(n.name) ?? [], connected_source_net_ids: [netId.get(n.name)], display_name: n.name }));

  // ---- board drawings
  for (const g of recordsOfKind(doc, "graphic")) {
    if (g.layer === "top_silkscreen" || g.layer === "bottom_silkscreen") silk(g, undefined, "");
    else rep.dropped("board graphic not on silkscreen", "only silkscreen drawings have Circuit JSON elements here", { id: g.id });
  }
  for (const t of recordsOfKind(doc, "text")) {
    if (t.layer !== "top_silkscreen" && t.layer !== "bottom_silkscreen") {
      rep.dropped("board text not on silkscreen", "only silkscreen texts are written", { id: t.id });
      continue;
    }
    out.push({ type: "pcb_silkscreen_text", pcb_silkscreen_text_id: nextId("pcb_silkscreen_text"), pcb_component_id: "", layer: t.layer === "top_silkscreen" ? "top" : "bottom", text: t.text, anchor_position: MP(t), anchor_alignment: t.anchor === "left" ? "center_left" : t.anchor === "right" ? "center_right" : "center", font: "tscircuit2024", font_size: M(t.height), ccw_rotation: D(t.rotation ?? 0), ...(t.mirrored ? { is_mirrored: true } : {}) });
  }

  // ---- copper: chain each net's connected segments on one layer into one pcb_trace
  const tracks = recordsOfKind(doc, "track");
  const groups = new Map<string, TrackRec[]>();
  for (const t of tracks) {
    const k = `${t.net ?? ""}\u0000${t.layer}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const list of groups.values()) {
    const key = (p: Point) => `${p.x},${p.y}`;
    const at = new Map<string, number[]>();
    list.forEach((t, i) => {
      for (const p of [t.start, t.end]) at.set(key(p), [...(at.get(key(p)) ?? []), i]);
    });
    const used = new Uint8Array(list.length);
    const piece = (t: TrackRec, from: Point): Point[] => {
      const forward = from.x === t.start.x && from.y === t.start.y;
      if (t.sweep === undefined) return [forward ? t.end : t.start];
      const pts = arcPolyline(t.start, t.end, t.sweep).slice(1);
      return forward ? pts : [...arcPolyline(t.start, t.end, t.sweep)].reverse().slice(1);
    };
    for (let s = 0; s < list.length; ) {
      if (used[s]) {
        s++;
        continue;
      }
      // walk back from segment s to an end of its chain, then forward from there; every pass uses at least one
      // segment (the one it arrived by), so the loop ends
      let head = list[s].start;
      const seen = new Set([s]);
      for (;;) {
        const next = (at.get(key(head)) ?? []).find((i) => !used[i] && !seen.has(i));
        if (next === undefined) break;
        seen.add(next);
        const t = list[next];
        head = head.x === t.start.x && head.y === t.start.y ? t.end : t.start;
      }
      const pts: { p: Point; w: number }[] = [{ p: head, w: list[s].width }];
      let cur = head;
      for (;;) {
        const i = (at.get(key(cur)) ?? []).find((j) => !used[j]);
        if (i === undefined) break;
        used[i] = 1;
        const t = list[i];
        for (const p of piece(t, cur)) pts.push({ p, w: t.width });
        cur = cur.x === t.start.x && cur.y === t.start.y ? t.end : t.start;
      }
      if (pts.length > 1) pts[0].w = pts[1].w;
      const net = list[s].net;
      out.push({
        type: "pcb_trace",
        pcb_trace_id: nextId("pcb_trace"),
        ...(net && traceOfNet.get(net) ? { source_trace_id: traceOfNet.get(net) } : {}),
        route: pts.map(({ p, w }) => ({ route_type: "wire", ...MP(p), width: M(w), layer: list[s].layer })),
      });
    }
  }
  for (const v of recordsOfKind(doc, "via")) {
    out.push({ type: "pcb_via", pcb_via_id: nextId("pcb_via"), ...MP(v), outer_diameter: M(v.outer_diameter), hole_diameter: M(v.hole_diameter), from_layer: v.from_layer, to_layer: v.to_layer, layers: viaLayers(doc, v.from_layer, v.to_layer), ...(v.net && traceOfNet.get(v.net) ? { source_trace_id: traceOfNet.get(v.net) } : {}) });
  }
  for (const z of recordsOfKind(doc, "zone")) rep.dropped("zone", "zones are intent; Circuit JSON pours are fill results and are not written", { id: z.id });
  for (const k of recordsOfKind(doc, "keepout")) {
    const b = contourBox(k.outline);
    const rect = k.outline.length === 4 && k.outline.every((v) => v.sweep === undefined && (v.x === b.minX || v.x === b.maxX) && (v.y === b.minY || v.y === b.maxY));
    if (k.blocks.vias !== k.blocks.tracks || k.blocks.pours !== k.blocks.tracks) rep.approximated("keep-out", "Circuit JSON keeps out traces as one flag; vias and pours follow it", { id: k.id });
    const shape = rect ? { shape: "rect", center: MP({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }), width: M(b.maxX - b.minX), height: M(b.maxY - b.minY) } : { shape: "outline", outline: tessellate(k.outline, 1).map(MP) };
    out.push({ type: "pcb_keepout", pcb_keepout_id: nextId("pcb_keepout"), ...shape, layers: k.layers, ...(k.description ? { description: k.description } : {}), ...(k.tier === "policy" ? { warning_only: true } : {}), allow_traces: !k.blocks.tracks, allow_placements: !k.blocks.footprints });
  }
  const unwritten = ["netclass", "rule", "layer"] as const;
  for (const kind of unwritten) {
    const n = recordsOfKind(doc, kind).length;
    if (n) rep.dropped(`${kind} record`, "no Circuit JSON element", { count: n });
  }
  return { elements: out as unknown as AnyCircuitElement[], report: rep.items() };

  function silk(g: FootprintGraphic, fp: FootprintRec | undefined, pcId: string): void {
    const layer = fp ? sideLayer(g.layer, fp.side) : g.layer;
    if (layer !== "top_silkscreen" && layer !== "bottom_silkscreen") return;
    const side = layer === "top_silkscreen" ? "top" : "bottom";
    const W = (p: Point) => MP(fp ? footprintToWorld(fp, p) : p);
    const base = { pcb_component_id: pcId, layer: side, stroke_width: M(g.stroke_width) };
    const path = (pts: Point[]) => out.push({ type: "pcb_silkscreen_path", pcb_silkscreen_path_id: nextId("pcb_silkscreen_path"), ...base, route: pts.map(W) });
    if (g.shape === "line" && g.start && g.end) {
      if (g.sweep !== undefined) return void path(arcPolyline(g.start, g.end, g.sweep));
      const a = W(g.start);
      const b = W(g.end);
      out.push({ type: "pcb_silkscreen_line", pcb_silkscreen_line_id: nextId("pcb_silkscreen_line"), ...base, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    } else if (g.shape === "arc" && g.start && g.end && g.sweep !== undefined) path(arcPolyline(g.start, g.end, g.sweep));
    else if (g.shape === "circle" && g.center && g.radius) out.push({ type: "pcb_silkscreen_circle", pcb_silkscreen_circle_id: nextId("pcb_silkscreen_circle"), ...base, center: W(g.center), radius: M(g.radius), ...(g.filled ? { is_filled: true } : {}) });
    else if (g.shape === "rect" && g.center && g.width && g.height) {
      const rot = fp ? (fp.side === "bottom" ? fp.rotation - (g.rotation ?? 0) : fp.rotation + (g.rotation ?? 0)) : g.rotation ?? 0;
      out.push({ type: "pcb_silkscreen_rect", pcb_silkscreen_rect_id: nextId("pcb_silkscreen_rect"), ...base, center: W(g.center), width: M(g.width), height: M(g.height), ...(g.filled ? { is_filled: true } : {}), ...(normAngle(rot) ? { ccw_rotation: D(rot) } : {}) });
    } else if (g.shape === "polygon" && g.points) {
      const pts = tessellate(g.points, 1);
      path([...pts, pts[0]]);
    } else if (g.shape === "path" && g.points) {
      const pts: Point[] = [];
      g.points.forEach((v: Vertex, i) => {
        pts.push(v);
        const n = g.points![i + 1];
        if (v.sweep !== undefined && n) pts.push(...arcPoints(v, n, v.sweep, 1).slice(0, -1));
      });
      path(pts);
    }
  }
}

const rotate = (p: Point, mdeg: number): Point => {
  if (!mdeg) return p;
  const a = (mdeg / 1000) * (Math.PI / 180);
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
};
