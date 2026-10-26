/**
 * Reading a built board (circuit JSON) back in UHD's terms: where each
 * component instance sits, the frames of its mating faces, the outline and
 * holes, and the nets as the copper actually joins them.
 *
 * Board frame throughout: mm, +X right and +Y up in the top view (tscircuit's
 * PCB coordinates), +Z out of the top copper, z = 0 on the board's mid-plane
 * (tscircuit's own 3D convention), so the top surface is z = +thickness/2.
 */
import type { GeometryFrame } from "@deltarobotics/uhd";
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map";
import type { Side, Vec2 } from "./config.ts";
import type { CircuitElement } from "./runtime.ts";
import type { NameMap } from "./source.ts";

type Vec3 = [number, number, number];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const v3 = (x: number, y: number, z: number): Vec3 => [r4(x), r4(y), r4(z)];

/** tscircuit insertion directions, already rotated into the board frame. */
const DIRECTION: Record<string, Vec3> = {
  from_left: [-1, 0, 0],
  from_right: [1, 0, 0],
  from_top: [0, 1, 0],
  from_bottom: [0, -1, 0],
  from_above: [0, 0, 1],
  from_below: [0, 0, -1],
};

export interface PlacedComponent {
  instance: string;
  /** tscircuit component name. */
  name: string;
  part: string;
  /** Footprint origin as placed (pcbX/pcbY). */
  origin: Vec2;
  /** Pad and courtyard bounding-box centre (what pick-and-place machines take). */
  center: Vec2;
  rotation_deg: number;
  side: Side;
  /** Bounding box of pads and courtyard, rotated (board-aligned). */
  size: Vec2;
  /** The face that meets a mating part: the connector mouth, else the top (or bottom) of the body at its centre. */
  frame: GeometryFrame & { source: "insertion_direction" | "inferred_from_cable_insertion_center" | "body_top" };
}

export interface BoardGeometry {
  thickness_mm: number;
  layers: number;
  outline: Vec2[];
  holes: { name: string; at: Vec2; diameter_mm: number }[];
  keepouts: { center: Vec2; shape: string; width?: number; height?: number; radius?: number; layers: string[] }[];
  components: PlacedComponent[];
  routing: { traces: number; vias: number; wire_mm: number };
  toolVersion?: string;
}

export const ofType = (cj: CircuitElement[], t: string) => cj.filter((e) => e.type === t);

/** Placement, frames, outline and holes of a built board. */
export function boardGeometry(cj: CircuitElement[], map: NameMap): BoardGeometry {
  const board = ofType(cj, "pcb_board")[0];
  if (!board) throw new Error("circuit JSON has no pcb_board");
  const half = board.thickness / 2;
  const sources = new Map(ofType(cj, "source_component").map((s) => [s.source_component_id, s]));
  const outline: Vec2[] = board.outline
    ? board.outline.map((p: { x: number; y: number }) => [r4(p.x), r4(p.y)] as Vec2)
    : [
        [board.center.x - board.width / 2, board.center.y - board.height / 2],
        [board.center.x + board.width / 2, board.center.y - board.height / 2],
        [board.center.x + board.width / 2, board.center.y + board.height / 2],
        [board.center.x - board.width / 2, board.center.y + board.height / 2],
      ];
  const components: PlacedComponent[] = [];
  for (const pc of ofType(cj, "pcb_component")) {
    const name = sources.get(pc.source_component_id)?.name as string | undefined;
    const m = name ? map.components[name] : undefined;
    if (!name || !m) continue;
    const side: Side = pc.layer === "bottom" ? "bottom" : "top";
    const z = side === "bottom" ? -half : half;
    const rot = ((pc.rotation ?? 0) * Math.PI) / 180;
    const xAxis = v3(Math.cos(rot) * (side === "bottom" ? -1 : 1), Math.sin(rot), 0);
    let frame: PlacedComponent["frame"];
    const mouth = pc.cable_insertion_center as { x: number; y: number } | undefined;
    if (mouth && pc.insertion_direction && DIRECTION[pc.insertion_direction]) {
      frame = { origin: v3(mouth.x, mouth.y, z), normal: DIRECTION[pc.insertion_direction], xAxis, source: "insertion_direction" };
    } else if (mouth && Math.hypot(mouth.x - pc.center.x, mouth.y - pc.center.y) > 1e-6) {
      const d = Math.hypot(mouth.x - pc.center.x, mouth.y - pc.center.y);
      frame = { origin: v3(mouth.x, mouth.y, z), normal: v3((mouth.x - pc.center.x) / d, (mouth.y - pc.center.y) / d, 0), xAxis, source: "inferred_from_cable_insertion_center" };
    } else frame = { origin: v3(pc.center.x, pc.center.y, z), normal: [0, 0, side === "bottom" ? -1 : 1], xAxis, source: "body_top" };
    components.push({
      instance: m.instance,
      name,
      part: m.part,
      origin: [r4(pc.display_offset_x ?? pc.center.x), r4(pc.display_offset_y ?? pc.center.y)],
      center: [r4(pc.center.x), r4(pc.center.y)],
      rotation_deg: r4((((pc.rotation ?? 0) % 360) + 360) % 360),
      side,
      size: [r4(pc.width), r4(pc.height)],
      frame,
    });
  }
  let wire = 0;
  for (const t of ofType(cj, "pcb_trace")) {
    for (let i = 1; i < (t.route ?? []).length; i++) {
      const a = t.route[i - 1];
      const b = t.route[i];
      if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer) wire += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return {
    thickness_mm: board.thickness,
    layers: board.num_layers,
    outline,
    holes: ofType(cj, "pcb_hole")
      .filter((h) => !h.pcb_component_id)
      .map((h, i) => ({ name: (h.name as string | undefined) ?? `hole_${i + 1}`, at: [r4(h.x), r4(h.y)] as Vec2, diameter_mm: h.hole_diameter })),
    keepouts: ofType(cj, "pcb_keepout").map((k) => ({ center: [k.center.x, k.center.y] as Vec2, shape: k.shape, width: k.width, height: k.height, radius: k.radius, layers: k.layers })),
    components,
    routing: { traces: ofType(cj, "pcb_trace").length, vias: ofType(cj, "pcb_via").length, wire_mm: r4(wire) },
    toolVersion: ofType(cj, "source_project_metadata")[0]?.software_used_string,
  };
}

/**
 * UHD pin (`<instance>:<interface>`) of every pcb_port that carries one, via
 * the name map: component name → instance, pad number → interface.
 */
export function portPins(cj: CircuitElement[], map: NameMap): Map<string, string> {
  const sources = new Map(ofType(cj, "source_component").map((s) => [s.source_component_id, s]));
  const sourcePorts = new Map(ofType(cj, "source_port").map((s) => [s.source_port_id, s]));
  const out = new Map<string, string>();
  for (const p of ofType(cj, "pcb_port")) {
    const sp = sourcePorts.get(p.source_port_id);
    const sc = sp && sources.get(sp.source_component_id);
    const m = sc && map.components[sc.name];
    if (!m || sp.pin_number === undefined) continue;
    const iface = m.ports[String(sp.pin_number)];
    if (iface) out.set(p.pcb_port_id, `${m.instance}:${iface}`);
  }
  return out;
}

/**
 * Traces written by hand (board.tsx, or an edited board.gen.tsx) that join pads of one pin
 * (PB-1027, seen on a large field board): generate joins a pin's pads itself since 0.1.7 (padJoins), so such a trace
 * duplicates its joins, and the converter writes it into KiCad as copper on no net. A trace is
 * the generator's when the generated source (`generated`, board.gen.tsx as generate wrote it) has
 * a `<trace from=… to=…>` of the same two selectors; each one there accounts for one in the build.
 */
export function handPadJoins(cj: CircuitElement[], map: NameMap, generated: string): { trace: string; instance: string; pin: string; ports: string[] }[] {
  const sources = new Map(ofType(cj, "source_component").map((s) => [s.source_component_id, s.name as string]));
  const sourcePorts = new Map(ofType(cj, "source_port").map((s) => [s.source_port_id, s]));
  const pinOf = (id: string): { comp: string; pin: string } | undefined => {
    const sp = sourcePorts.get(id);
    const comp = sp && sources.get(sp.source_component_id);
    if (!comp) return undefined;
    const names = [String(sp.name ?? ""), ...((sp.port_hints as string[] | undefined) ?? [])];
    const internal = names.map((n) => /^pin(\d+)_internal_\d+$/.exec(n)?.[1]).find(Boolean);
    const pin = internal ?? (sp.pin_number !== undefined ? String(sp.pin_number) : names.map((n) => /^pin(\d+)$/.exec(n)?.[1]).find(Boolean));
    return pin ? { comp, pin } : undefined;
  };
  // the generator's own traces, by "<from> to <to>" (tscircuit's display name of a trace)
  const ours = new Map<string, number>();
  for (const m of generated.matchAll(/<trace\s+from=("(?:[^"\\]|\\.)*")\s+to=("(?:[^"\\]|\\.)*")/g)) {
    const key = `${JSON.parse(m[1])} to ${JSON.parse(m[2])}`;
    ours.set(key, (ours.get(key) ?? 0) + 1);
  }
  const out: { trace: string; instance: string; pin: string; ports: string[] }[] = [];
  for (const t of ofType(cj, "source_trace")) {
    const ids = (t.connected_source_port_ids as string[] | undefined) ?? [];
    if (ids.length < 2 || ((t.connected_source_net_ids as string[] | undefined) ?? []).length) continue;
    const pins = ids.map(pinOf);
    if (pins.some((p) => !p) || new Set(pins.map((p) => `${p!.comp}/${p!.pin}`)).size !== 1) continue;
    const name = String(t.display_name ?? t.source_trace_id);
    const left = ours.get(name) ?? 0;
    if (left > 0) {
      ours.set(name, left - 1);
      continue;
    }
    const m = map.components[pins[0]!.comp];
    out.push({ trace: name, instance: m?.instance ?? pins[0]!.comp, pin: m?.ports[pins[0]!.pin] ?? `pin${pins[0]!.pin}`, ports: ids.map((id) => String(sourcePorts.get(id)?.name ?? id)) });
  }
  return out;
}

/**
 * Pins whose pads the copper does not join: a pin with several pads (a module's exposed ground
 * pads, a thermal pad split into windows) is one tscircuit port on its first pad and an internal
 * port (`pinN_internal_k`) on each other pad. Generate traces every internal port to the pin's net
 * (source.ts); this finds, among `pins` (`<instance>:<interface>`, the pins on a UHD net), each
 * whose pads lie in more than one copper piece.
 */
export function unjoinedPads(cj: CircuitElement[], map: NameMap, pins: Set<string>): { pin: string; pads: number; pieces: number; ports: string[] }[] {
  const sources = new Map(ofType(cj, "source_component").map((s) => [s.source_component_id, s]));
  const sourcePorts = new Map(ofType(cj, "source_port").map((s) => [s.source_port_id, s]));
  const byPin = new Map<string, string[]>();
  // SMD pads only: a pin's plated holes (a receptacle's shell stakes) are joined by the part's own metal
  const smd = new Set(ofType(cj, "pcb_smtpad").map((p) => p.pcb_port_id));
  for (const p of ofType(cj, "pcb_port")) {
    if (!smd.has(p.pcb_port_id)) continue;
    const sp = sourcePorts.get(p.source_port_id);
    const m = sp && map.components[sources.get(sp.source_component_id)?.name];
    if (!m) continue;
    const n = sp.pin_number !== undefined ? String(sp.pin_number) : /^pin(\d+)_internal_\d+$/.exec(String(sp.name ?? ""))?.[1];
    const iface = n !== undefined ? m.ports[n] : undefined;
    if (!iface || !pins.has(`${m.instance}:${iface}`)) continue;
    byPin.set(`${m.instance}:${iface}`, [...(byPin.get(`${m.instance}:${iface}`) ?? []), p.pcb_port_id]);
  }
  const multi = [...byPin].filter(([, ports]) => ports.length > 1);
  if (!multi.length) return [];
  const connectivity = getFullConnectivityMapFromCircuitJson(cj.filter((e) => e.type.startsWith("pcb_")) as never);
  const out: { pin: string; pads: number; pieces: number; ports: string[] }[] = [];
  for (const [pin, ports] of multi) {
    const pieces = new Set(ports.map((id) => connectivity.getNetConnectedToId(id) ?? `alone:${id}`)).size;
    if (pieces > 1) out.push({ pin, pads: ports.length, pieces, ports });
  }
  return out.sort((a, b) => a.pin.localeCompare(b.pin));
}

/**
 * The nets as the copper joins them: groups of UHD pins connected by traces,
 * vias, pads and pours. Built from pcb_* elements only: the connectivity
 * map's full mode also merges the source intent (source_trace, source_net),
 * which would make an unrouted net look connected (spike §4).
 */
export function copperNets(cj: CircuitElement[], map: NameMap): { nets: { pins: string[] }[]; present: Set<string> } {
  const pins = portPins(cj, map);
  const connectivity = getFullConnectivityMapFromCircuitJson(cj.filter((e) => e.type.startsWith("pcb_")) as never);
  const groups = new Map<string, string[]>();
  for (const [portId, pin] of pins) {
    const net = connectivity.getNetConnectedToId(portId) ?? `alone:${portId}`;
    groups.set(net, [...(groups.get(net) ?? []), pin]);
  }
  return { nets: [...groups.values()].filter((g) => g.length > 1).map((g) => ({ pins: [...new Set(g)].sort() })), present: new Set(pins.values()) };
}
