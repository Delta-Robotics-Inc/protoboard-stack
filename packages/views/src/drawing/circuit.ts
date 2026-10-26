/**
 * A routed board as the PCB view draws it, read from the circuit provider's
 * own result (`circuit.json`, Circuit JSON: what `circuit:generate` built and
 * routed). Nothing is re-routed or re-placed here: every pad, trace, via and
 * pour is drawn where the file puts it.
 *
 * The model sorts the board into layers the view turns on and off one by one
 * (each copper layer, silkscreen, courtyard and fabrication on each side,
 * drills, the board edge), knows which net every piece of copper belongs to
 * and what that net is called, which component every pad belongs to, and
 * where a finding of the board's check is on the board.
 *
 * Board coordinates are millimetres with y up; the model's are the drawing's:
 * millimetres with y down (`y` negated), so an SVG draws them as they are.
 * Rotations are the drawing's too (clockwise on screen).
 *
 * No DOM here: it runs in Node for tests and in any shell.
 */

/** One element of Circuit JSON; only the fields read here are typed. */
export type CircuitElement = { type: string; [key: string]: unknown };

export type Side = "top" | "bottom";

/** A layer the view can turn on and off. */
export type LayerId = `copper:${string}` | `silk:${Side}` | `courtyard:${Side}` | `fab:${Side}` | "drill" | "edge" | "keepout";

export type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; rotate?: number; r?: number }
  | { kind: "circle"; x: number; y: number; r: number }
  /** A stroked line through points (a trace run, a silkscreen path). */
  | { kind: "line"; points: [number, number][]; width: number }
  /** A filled outline, with holes (a copper pour, a board outline). */
  | { kind: "area"; rings: [number, number][][] }
  | { kind: "text"; x: number; y: number; text: string; size: number; rotate?: number; anchor?: "start" | "middle" | "end" };

export interface Piece {
  shape: Shape;
  /** The net's key (several names may join on one net; the key is the net). */
  net?: string;
  /** The component it belongs to, by its reference (`u1`). */
  ref?: string;
  /** A pad's pin name (`GND`, `pin3`). */
  pin?: string;
  /** Outline only (silkscreen, courtyard, fabrication drawings): `stroke` width, no fill. */
  stroke?: number;
}

export interface Net {
  key: string;
  /** What people call it: the source net's name; else the first pad on it (`u1.GND`). */
  name: string;
  /** Pads on it, as `ref.pin`. */
  pads: string[];
}

export interface Component {
  ref: string;
  /** Centre and size on the board (drawing coordinates), rotation (clockwise on screen, degrees). */
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  side: Side;
  /** The manufacturer part number the source gives. */
  mpn?: string;
}

export interface Layer {
  id: LayerId;
  label: string;
  /** The theme role it is drawn in (`--pb-d-<role>`). */
  role: string;
  pieces: Piece[];
}

export interface PcbModel {
  /** Layers in drawing order, bottom-most first. Copper is top, inner…, bottom by `copperLayers`. */
  layers: Layer[];
  /** Copper layer names, top first: top, inner1, inner2, …, bottom. */
  copperLayers: string[];
  /** The board's box (drawing coordinates): x, y, width, height. */
  box: [number, number, number, number];
  nets: Map<string, Net>;
  components: Map<string, Component>;
  /** The errors and warnings the provider recorded in the file, with where they are when it says. */
  recorded: { type: string; message: string; at?: [number, number] }[];
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const pt = (p: unknown): [number, number] => {
  const o = (p ?? {}) as { x?: unknown; y?: unknown };
  return [num(o.x), -num(o.y)];
};
/** A board rotation (counter-clockwise, y up) as the drawing's (clockwise on screen, y down): the same number negated. */
const rot = (deg: unknown) => -num(deg);

const COPPER_ORDER = (a: string, b: string) => {
  const rank = (l: string) => (l === "top" ? -1 : l === "bottom" ? 1e6 : Number(/^inner(\d+)$/.exec(l)?.[1] ?? 1e5));
  return rank(a) - rank(b);
};

/** The copper layer's name for people: Top, Inner 1, Bottom. */
export const copperLabel = (l: string) => (l === "top" ? "Top" : l === "bottom" ? "Bottom" : /^inner(\d+)$/.test(l) ? `Inner ${l.slice(5)}` : l);

/** Read a board's Circuit JSON. */
export function readCircuit(cj: CircuitElement[]): PcbModel {
  const of = (type: string) => cj.filter((e) => e.type === type);
  const byId = (type: string, idKey: string) => new Map(of(type).map((e) => [String(e[idKey]), e]));

  // ---- components: reference, side, place
  const sourceComponents = byId("source_component", "source_component_id");
  const pcbComponents = byId("pcb_component", "pcb_component_id");
  const refOfPcb = new Map<string, string>();
  const components = new Map<string, Component>();
  for (const [id, c] of pcbComponents) {
    const sc = sourceComponents.get(String(c.source_component_id));
    const ref = str(sc?.name) ?? id;
    refOfPcb.set(id, ref);
    const [x, y] = pt(c.center);
    components.set(ref, { ref, x, y, w: num(c.width), h: num(c.height), rotate: rot(c.rotation), side: c.layer === "bottom" ? "bottom" : "top", ...(str(sc?.manufacturer_part_number) ? { mpn: str(sc?.manufacturer_part_number) } : {}) });
  }

  // ---- nets: the connectivity key the provider wrote on every port, net and trace
  const sourcePorts = byId("source_port", "source_port_id");
  const pcbPorts = byId("pcb_port", "pcb_port_id");
  const sourceNets = of("source_net");
  const sourceTraces = byId("source_trace", "source_trace_id");
  const netNames = new Map<string, string>();
  for (const n of sourceNets) {
    const key = str(n.subcircuit_connectivity_map_key) ?? String(n.source_net_id);
    if (!netNames.has(key) && str(n.name)) netNames.set(key, String(n.name));
  }
  const netKeyOfSourceNet = new Map(sourceNets.map((n) => [String(n.source_net_id), str(n.subcircuit_connectivity_map_key) ?? String(n.source_net_id)]));
  const nets = new Map<string, Net>();
  const portInfo = (pcbPortId: unknown): { net?: string; ref?: string; pin?: string } => {
    const pp = pcbPorts.get(String(pcbPortId));
    if (!pp) return {};
    const sp = sourcePorts.get(String(pp.source_port_id));
    const ref = refOfPcb.get(String(pp.pcb_component_id)) ?? str(sourceComponents.get(String(sp?.source_component_id))?.name);
    const pin = str(sp?.name) ?? (sp?.pin_number !== undefined ? `pin${String(sp.pin_number)}` : undefined);
    const net = str(sp?.subcircuit_connectivity_map_key);
    if (net && ref && pin) {
      const n = nets.get(net) ?? { key: net, name: "", pads: [] };
      if (!n.pads.includes(`${ref}.${pin}`)) n.pads.push(`${ref}.${pin}`);
      nets.set(net, n);
    }
    return { net, ref, pin };
  };
  const traceNet = (t: CircuitElement): string | undefined => {
    const st = sourceTraces.get(String(t.source_trace_id));
    const k = str(st?.subcircuit_connectivity_map_key) ?? str(t.subcircuit_connectivity_map_key);
    if (k) return k;
    const cn = str(t.connection_name);
    if (cn && netKeyOfSourceNet.has(cn)) return netKeyOfSourceNet.get(cn);
    for (const p of (t.route ?? []) as Record<string, unknown>[]) {
      const n = portInfo(p.start_pcb_port_id ?? p.end_pcb_port_id).net;
      if (n) return n;
    }
    return undefined;
  };

  // ---- layers
  const copperNames = new Set<string>(["top", "bottom"]);
  const board = of("pcb_board")[0];
  const count = num(board?.num_layers, 2);
  for (let i = 1; i <= count - 2; i++) copperNames.add(`inner${i}`);
  const copper = new Map<string, Piece[]>();
  const onCopper = (layer: string, p: Piece) => {
    copperNames.add(layer);
    copper.set(layer, [...(copper.get(layer) ?? []), p]);
  };
  const side = (l: unknown): Side => (l === "bottom" ? "bottom" : "top");
  const silk: Record<Side, Piece[]> = { top: [], bottom: [] };
  const courtyard: Record<Side, Piece[]> = { top: [], bottom: [] };
  const fab: Record<Side, Piece[]> = { top: [], bottom: [] };
  const drill: Piece[] = [];
  const keepout: Piece[] = [];
  const edge: Piece[] = [];

  // pads
  for (const p of of("pcb_smtpad")) {
    const info = portInfo(p.pcb_port_id);
    const ref = info.ref ?? refOfPcb.get(String(p.pcb_component_id));
    const [x, y] = [num(p.x), -num(p.y)];
    const shape = String(p.shape);
    let s: Shape;
    if (shape === "circle") s = { kind: "circle", x, y, r: num(p.radius) };
    else if (shape === "polygon") s = { kind: "area", rings: [((p.points ?? []) as unknown[]).map(pt)] };
    else {
      const w = num(p.width);
      const h = num(p.height);
      const pill = /pill/.test(shape);
      s = { kind: "rect", x, y, w, h, ...(p.ccw_rotation !== undefined ? { rotate: rot(p.ccw_rotation) } : {}), ...(pill ? { r: num(p.radius, Math.min(w, h) / 2) } : num(p.corner_radius) ? { r: num(p.corner_radius) } : {}) };
    }
    onCopper(String(p.layer ?? "top"), { shape: s, ...(info.net ? { net: info.net } : {}), ...(ref ? { ref } : {}), ...(info.pin ? { pin: info.pin } : {}) });
  }
  // plated holes: a pad on every copper layer, and a drill
  for (const h of of("pcb_plated_hole")) {
    const info = portInfo(h.pcb_port_id);
    const ref = info.ref ?? refOfPcb.get(String(h.pcb_component_id));
    const [x, y] = [num(h.x), -num(h.y)];
    const shape = String(h.shape);
    const rotate = h.ccw_rotation !== undefined ? rot(h.ccw_rotation) : undefined;
    let pad: Shape;
    let hole: Shape;
    if (shape === "circle") {
      pad = { kind: "circle", x, y, r: num(h.outer_diameter) / 2 };
      hole = { kind: "circle", x, y, r: num(h.hole_diameter) / 2 };
    } else if (/rect_pad/.test(shape)) {
      pad = { kind: "rect", x, y, w: num(h.rect_pad_width), h: num(h.rect_pad_height), ...(rotate !== undefined ? { rotate } : {}), ...(num(h.rect_border_radius) ? { r: num(h.rect_border_radius) } : {}) };
      hole = /pill/.test(shape)
        ? { kind: "rect", x, y, w: num(h.hole_width), h: num(h.hole_height), r: Math.min(num(h.hole_width), num(h.hole_height)) / 2, ...(rotate !== undefined ? { rotate } : {}) }
        : { kind: "circle", x, y, r: num(h.hole_diameter) / 2 };
    } else {
      const ow = num(h.outer_width);
      const oh = num(h.outer_height);
      pad = { kind: "rect", x, y, w: ow, h: oh, r: Math.min(ow, oh) / 2, ...(rotate !== undefined ? { rotate } : {}) };
      hole = { kind: "rect", x, y, w: num(h.hole_width), h: num(h.hole_height), r: Math.min(num(h.hole_width), num(h.hole_height)) / 2, ...(rotate !== undefined ? { rotate } : {}) };
    }
    const layers = (h.layers as string[] | undefined) ?? [...copperNames];
    for (const l of layers) onCopper(l, { shape: pad, ...(info.net ? { net: info.net } : {}), ...(ref ? { ref } : {}), ...(info.pin ? { pin: info.pin } : {}) });
    drill.push({ shape: hole, ...(ref ? { ref } : {}) });
  }
  for (const h of of("pcb_hole")) {
    const [x, y] = [num(h.x), -num(h.y)];
    const shape = String(h.hole_shape ?? h.shape ?? "circle");
    drill.push({ shape: shape === "circle" || shape === "round" ? { kind: "circle", x, y, r: num(h.hole_diameter) / 2 } : { kind: "rect", x, y, w: num(h.hole_width), h: num(h.hole_height), r: shape === "rect" ? 0 : Math.min(num(h.hole_width), num(h.hole_height)) / 2 } });
  }
  // traces: one stroked run per stretch on one layer
  const traceNetById = new Map<string, string>();
  for (const t of of("pcb_trace")) {
    const net = traceNet(t);
    if (net) traceNetById.set(String(t.pcb_trace_id), net);
    let run: { layer: string; points: [number, number][]; width: number } | undefined;
    const flush = () => {
      if (run && run.points.length > 1) onCopper(run.layer, { shape: { kind: "line", points: run.points, width: run.width }, ...(net ? { net } : {}) });
      run = undefined;
    };
    for (const p of (t.route ?? []) as Record<string, unknown>[]) {
      if (p.route_type !== "wire") {
        flush();
        continue;
      }
      const layer = String(p.layer ?? "top");
      const width = num(p.width, 0.15);
      if (run && (run.layer !== layer || run.width !== width)) {
        const last = run.points[run.points.length - 1]!;
        flush();
        run = { layer, points: [last], width };
      }
      run ??= { layer, points: [], width };
      run.points.push([num(p.x), -num(p.y)]);
    }
    flush();
  }
  // vias: copper on every layer they join, and a drill
  for (const v of of("pcb_via")) {
    const [x, y] = [num(v.x), -num(v.y)];
    const net = str(v.subcircuit_connectivity_map_key) ?? traceNetById.get(String(v.pcb_trace_id));
    const layers = (v.layers as string[] | undefined) ?? [String(v.from_layer ?? "top"), String(v.to_layer ?? "bottom")];
    for (const l of layers) onCopper(l, { shape: { kind: "circle", x, y, r: num(v.outer_diameter, 0.6) / 2 }, ...(net ? { net } : {}) });
    drill.push({ shape: { kind: "circle", x, y, r: num(v.hole_diameter, 0.3) / 2 } });
  }
  // pours
  for (const p of of("pcb_copper_pour")) {
    const net = netKeyOfSourceNet.get(String(p.source_net_id)) ?? str(p.subcircuit_connectivity_map_key);
    let s: Shape | undefined;
    const brep = p.brep_shape as { outer_ring?: { vertices?: unknown[] }; inner_rings?: { vertices?: unknown[] }[] } | undefined;
    if (brep?.outer_ring?.vertices) s = { kind: "area", rings: [brep.outer_ring.vertices.map(pt), ...(brep.inner_rings ?? []).map((r) => (r.vertices ?? []).map(pt))] };
    else if (Array.isArray(p.points)) s = { kind: "area", rings: [(p.points as unknown[]).map(pt)] };
    else if (p.shape === "rect") s = { kind: "rect", x: pt(p.center)[0], y: pt(p.center)[1], w: num(p.width), h: num(p.height), ...(p.rotation !== undefined ? { rotate: rot(p.rotation) } : {}) };
    if (s) onCopper(String(p.layer ?? "top"), { shape: s, ...(net ? { net } : {}) });
  }

  // silkscreen
  for (const e of cj) {
    if (!e.type.startsWith("pcb_silkscreen_") && !e.type.startsWith("pcb_fabrication_note_") && !e.type.startsWith("pcb_courtyard_")) continue;
    const ref = refOfPcb.get(String(e.pcb_component_id));
    const target = e.type.startsWith("pcb_silkscreen_") ? silk : e.type.startsWith("pcb_courtyard_") ? courtyard : fab;
    const sd = side(e.layer);
    const w = num(e.stroke_width, e.type.startsWith("pcb_courtyard_") ? 0.05 : 0.1);
    const kind = e.type.replace(/^pcb_(silkscreen|fabrication_note|courtyard)_/, "");
    let s: Shape | undefined;
    let stroke: number | undefined = w;
    if (kind === "path") s = { kind: "line", points: ((e.route ?? []) as unknown[]).map(pt), width: w };
    else if (kind === "line") s = { kind: "line", points: [[num(e.x1), -num(e.y1)], [num(e.x2), -num(e.y2)]], width: w };
    else if (kind === "outline") s = { kind: "line", points: [...((e.outline ?? []) as unknown[]).map(pt), ...((e.outline as unknown[] | undefined)?.length ? [pt((e.outline as unknown[])[0])] : [])], width: w };
    else if (kind === "rect") {
      const [x, y] = pt(e.center);
      s = { kind: "rect", x, y, w: num(e.width), h: num(e.height), ...(e.ccw_rotation !== undefined ? { rotate: rot(e.ccw_rotation) } : {}) };
    } else if (kind === "circle") {
      const [x, y] = pt(e.center);
      s = { kind: "circle", x, y, r: num(e.radius) };
    } else if (kind === "text") {
      const [x, y] = pt(e.anchor_position);
      const a = str(e.anchor_alignment) ?? "center";
      s = { kind: "text", x, y, text: String(e.text ?? ""), size: num(e.font_size, 1), ...(e.ccw_rotation ? { rotate: rot(e.ccw_rotation) } : {}), anchor: /left/.test(a) ? "start" : /right/.test(a) ? "end" : "middle" };
      stroke = undefined;
    }
    if (s) target[sd].push({ shape: s, ...(ref ? { ref } : {}), ...(stroke !== undefined ? { stroke } : {}) });
  }
  // the fabrication drawing: each component's body box and reference (a tool that writes its own notes adds to them)
  for (const c of components.values()) {
    fab[c.side].push({ shape: { kind: "rect", x: c.x, y: c.y, w: c.w, h: c.h, rotate: c.rotate }, ref: c.ref, stroke: 0.08 });
    fab[c.side].push({ shape: { kind: "text", x: c.x, y: c.y, text: c.ref.toUpperCase(), size: Math.max(0.4, Math.min(1.2, Math.min(c.w, c.h) * 0.35)), anchor: "middle" }, ref: c.ref });
  }
  for (const k of of("pcb_keepout")) {
    const [x, y] = pt(k.center);
    keepout.push({ shape: k.shape === "circle" ? { kind: "circle", x, y, r: num(k.radius) } : { kind: "rect", x, y, w: num(k.width), h: num(k.height) }, stroke: 0.08 });
  }

  // the board: its outline, else its rectangle
  let box: [number, number, number, number] = [0, 0, 1, 1];
  if (board) {
    const outline = (board.outline as unknown[] | undefined)?.map(pt);
    const [cx, cy] = pt(board.center);
    const shape: Shape = outline?.length ? { kind: "area", rings: [outline] } : { kind: "rect", x: cx, y: cy, w: num(board.width), h: num(board.height) };
    edge.push({ shape, stroke: 0.1 });
    const xs = outline?.length ? outline.map((p) => p[0]) : [cx - num(board.width) / 2, cx + num(board.width) / 2];
    const ys = outline?.length ? outline.map((p) => p[1]) : [cy - num(board.height) / 2, cy + num(board.height) / 2];
    box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }

  for (const n of nets.values()) n.name = netNames.get(n.key) ?? n.pads[0] ?? n.key;
  for (const [key, name] of netNames) if (!nets.has(key)) nets.set(key, { key, name, pads: [] });

  // what the provider recorded: an error or a warning, at its place when it names one
  const recorded: PcbModel["recorded"] = [];
  for (const e of cj) {
    if (!/_(error|warning)$/.test(e.type)) continue;
    let at: [number, number] | undefined;
    if (e.center) at = pt(e.center);
    else if (e.x !== undefined && e.y !== undefined) at = [num(e.x), -num(e.y)];
    else {
      const ports = ((e.pcb_port_ids ?? []) as string[]).map((id) => pcbPorts.get(id)).filter(Boolean) as CircuitElement[];
      if (ports.length) at = pt(ports[0]);
      const comps = ((e.pcb_component_ids ?? (e.pcb_component_id ? [e.pcb_component_id] : [])) as string[]).map((id) => components.get(refOfPcb.get(id) ?? ""));
      if (!at && comps[0]) at = [comps[0].x, comps[0].y];
      const sc = e.source_component_id ? components.get(str(sourceComponents.get(String(e.source_component_id))?.name) ?? "") : undefined;
      if (!at && sc) at = [sc.x, sc.y];
    }
    recorded.push({ type: e.type, message: String(e.message ?? e.type), ...(at ? { at } : {}) });
  }

  const copperLayers = [...copperNames].sort(COPPER_ORDER);
  // drawn bottom-most first: the far side's copper under the near side's
  const layers: Layer[] = [
    { id: "edge", label: "Board edge", role: "edge", pieces: edge },
    ...[...copperLayers].reverse().map<Layer>((l) => ({ id: `copper:${l}`, label: copperLabel(l), role: l === "top" ? "copper-top" : l === "bottom" ? "copper-bottom" : `copper-inner-${(Number(l.slice(5)) - 1) % 4}`, pieces: copper.get(l) ?? [] })),
    { id: "courtyard:bottom", label: "Courtyard · bottom", role: "courtyard", pieces: courtyard.bottom },
    { id: "fab:bottom", label: "Fab · bottom", role: "fab", pieces: fab.bottom },
    { id: "silk:bottom", label: "Silkscreen · bottom", role: "silk-bottom", pieces: silk.bottom },
    { id: "drill", label: "Drills", role: "drill", pieces: drill },
    { id: "courtyard:top", label: "Courtyard · top", role: "courtyard", pieces: courtyard.top },
    { id: "fab:top", label: "Fab · top", role: "fab", pieces: fab.top },
    { id: "silk:top", label: "Silkscreen · top", role: "silk", pieces: silk.top },
    { id: "keepout", label: "Keep-outs", role: "keepout", pieces: keepout },
  ];
  return { layers, copperLayers, box, nets, components, recorded };
}

/**
 * The layers in the order they are drawn, bottom-most first, for a board seen
 * from `side`: the board itself (its edge, filled) always first, then the far
 * side's drawings, the copper from the far side to the near one, the drills,
 * the near side's drawings and the keep-outs on top. (Reversing the top
 * side's order for the bottom drew the filled board over everything.)
 */
export function drawOrder(model: PcbModel, side: Side = "top"): Layer[] {
  const by = new Map(model.layers.map((l) => [l.id, l]));
  const near = side;
  const far: Side = side === "top" ? "bottom" : "top";
  const copper = model.copperLayers.map((l) => by.get(`copper:${l}`)).filter((l): l is Layer => !!l);
  const pick = (ids: LayerId[]) => ids.map((id) => by.get(id)).filter((l): l is Layer => !!l);
  const below = [...pick(["edge", `silk:${far}`, `fab:${far}`, `courtyard:${far}`]), ...(side === "top" ? [...copper].reverse() : copper)];
  const above = pick(["drill", `courtyard:${near}`, `fab:${near}`, `silk:${near}`, "keepout"]);
  // anything the reader adds later and these lists do not know goes between the copper and the drills
  const rest = model.layers.filter((l) => !below.includes(l) && !above.includes(l));
  return [...below, ...rest, ...above];
}

/**
 * Where a finding of the board's check is, from what its message names: a
 * point it gives (`at (1.20, -3.40)`), a piece of copper by its id, or a
 * component by its reference. Undefined when it names no place (a stale
 * build, a footprint not verified).
 */
export function locate(message: string, model: PcbModel, cj?: CircuitElement[]): [number, number] | undefined {
  const point = /\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/.exec(message);
  if (point) return [Number(point[1]), -Number(point[2])];
  if (cj) {
    for (const m of message.matchAll(/\b(pcb_(?:smtpad|via|plated_hole|hole|copper_pour|port)_\d+)\b/g)) {
      const e = cj.find((x) => x[`${x.type}_id`] === m[1]);
      if (e && e.x !== undefined) return [num(e.x), -num(e.y)];
      if (e?.center) return pt(e.center);
    }
  }
  // a component the message is about: its reference as a word
  const words = message.split(/[^A-Za-z0-9_]+/).filter(Boolean);
  for (const w of words) {
    const c = model.components.get(w) ?? model.components.get(w.toLowerCase());
    if (c) return [c.x, c.y];
  }
  return undefined;
}

/** The layer list's toggle for the board check's marks (B11): the marks are the findings with a place, said as such when some have none. */
export function findingsLabel(located: number, total: number): string {
  return located === total ? `Findings · ${total}` : `Findings · ${located} of ${total}`;
}
