/**
 * check: the built board against tscircuit's own rules and against the UHD
 * board module. Pure: it reads circuit.json and build.json and writes nothing.
 *
 *   CIRCUIT_NOT_BUILT        no build yet (info, like an output never exported)
 *   CIRCUIT_STALE            the native source, the UHD module, or generate's other inputs
 *                            (layout.json, footprints.json, constraints) changed since the build;
 *                            or (ops/circuit.ts) out/ was exported from other inputs than the
 *                            current ones, named (fingerprint.ts), or with no record of them
 *   CIRCUIT_DRC              an error tscircuit recorded while building, or one @tscircuit/checks finds
 *   CIRCUIT_NET_OPEN / _SHORT / _EXTRA / _UNROUTED / _PIN_MISSING
 *                            the nets as the copper joins them differ from the UHD nets
 *   CIRCUIT_PAD_UNNETTED     a pin with several pads (exposed pads) whose pads the copper does not all join
 *   CIRCUIT_HAND_PAD_JOIN    a trace written by hand that joins pads of one pin, which generate joins itself
 *                            (warning; in KiCad it is copper on no net)
 *   CIRCUIT_COMPONENT_MISSING / _EXTRA
 *                            a UHD component is not on the board, or the board has one UHD lacks
 *   CIRCUIT_OUTSIDE_OUTLINE  copper outside the board outline (error), or a body overhanging it (warning)
 *   CIRCUIT_KEEPOUT          copper (pads, traces, vias) inside a keep-out on its layer (error), or a
 *                            keep-out that cannot apply: off the board, or reaching no copper layer (warning)
 *   CIRCUIT_PLACEMENT_MOVED  a part the config fixes is not where the config puts it
 *   CIRCUIT_FOOTPRINT_FAMILY / _MISMATCH
 *                            a land pattern chosen by package family (info), or a package that land patterns
 *                            of its name or family do not fit (pin count, pitch, size): reported, not guessed
 *   CIRCUIT_FOOTPRINT_UNVERIFIED
 *                            a land pattern the board uses has no verification record against its
 *                            maker's drawing, or its copper, stencil, mask or courtyard differ from it
 *   CIRCUIT_VIA_RULES        a via smaller than the config's rules (via_pad_mm, via_drill_mm): a hand via (error)
 *   CIRCUIT_VIA_IN_PAD       a via inside an SMD pad (warning) unless the config's via_in_pad says the
 *                            fab fills and caps them
 */
import { netlistDrift, type BoardNetlist, type CapabilityResult } from "@protoboardai/core";
import type { DiagnosticLocation } from "@protoboardai/core";
import type { BoardConstraints, Vec2 } from "./config.ts";
import { boardLands, packageFamily, resolveFootprint, type FootprintOverrides } from "./footprints.ts";
import { inside, insideKeepout } from "./config.ts";
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map";
import { boardGeometry, copperNets, handPadJoins, ofType, portPins, unjoinedPads } from "./layout.ts";
import type { NameMap } from "./source.ts";
import type { Native } from "./native.ts";
import { offline, type CircuitElement } from "./runtime.ts";

type Diagnostic = NonNullable<CapabilityResult["diagnostics"]>[number];

const DRIFT_CODES = { net_open: "CIRCUIT_NET_OPEN", net_short: "CIRCUIT_NET_SHORT", extra_connection: "CIRCUIT_NET_EXTRA", net_unrouted: "CIRCUIT_UNROUTED", pin_missing: "CIRCUIT_PIN_MISSING" } as const;

export interface CheckInput {
  native?: Native;
  netlist: BoardNetlist;
  netlistDigest: string;
  sourceDigest: string;
  /** Digest of generate's other inputs now (layout.json, footprints.json, constraints); see native.ts. */
  inputsDigest: string;
  constraints?: BoardConstraints;
  /** Non-blocking findings from reading the constraints (keep-outs off the board, …). */
  constraintNotes?: string[];
  /** File the findings point at (the native source). */
  file: string;
  /** Module id the findings are about. */
  module: string;
  /** The project's land-pattern overrides (tscircuit/footprints.json). */
  overrides?: FootprintOverrides;
  /** board.gen.tsx as generate wrote it: the traces in it are the generator's (CIRCUIT_HAND_PAD_JOIN). */
  generatedSource?: string;
}

/** Copper of one layer as sample points: pad corners and centres, trace points every 0.05 mm, vias. */
function copperPoints(cj: CircuitElement[], layer: string): { at: Vec2; what: string }[] {
  const pts: { at: Vec2; what: string }[] = [];
  for (const p of ofType(cj, "pcb_smtpad")) {
    if (p.layer !== layer) continue;
    const w = (p.width ?? (p.radius ?? 0) * 2) / 2;
    const h = (p.height ?? (p.radius ?? 0) * 2) / 2;
    const what = `pad ${p.pcb_smtpad_id}`;
    for (const [dx, dy] of [[0, 0], [-w, -h], [w, -h], [w, h], [-w, h]]) pts.push({ at: [p.x + dx, p.y + dy], what });
  }
  for (const t of ofType(cj, "pcb_trace")) {
    const route = (t.route ?? []) as { route_type: string; x: number; y: number; layer?: string }[];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== layer) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05));
      for (let k = 0; k <= n; k++) pts.push({ at: [a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n], what: `trace ${t.pcb_trace_id}` });
    }
  }
  for (const v of ofType(cj, "pcb_via")) pts.push({ at: [v.x, v.y], what: `via ${v.pcb_via_id}` });
  return pts;
}

export async function checkBoard(input: CheckInput): Promise<Diagnostic[]> {
  const out: Diagnostic[] = [];
  // every finding says where it is on the board (DiagnosticLocation: mm in the board frame, layer, ids), for a viewer to draw it there
  const add = (severity: Diagnostic["severity"], code: string, message: string, location: DiagnosticLocation = { scope: "design" }) => out.push({ code, severity, message, entity: { kind: "definition", id: input.module }, source: { file: input.file }, location });
  const { native, netlist } = input;
  for (const n of input.constraintNotes ?? []) add("warning", "CIRCUIT_KEEPOUT", n);
  // ---- land patterns: each compared with its maker's recommended land pattern (footprints.ts verifyEntry)
  for (const l of boardLands(netlist.components, input.overrides)) {
    if (!l.problems.length) continue;
    const who = `${l.instances.slice(0, 6).join(", ")}${l.instances.length > 6 ? ` (+${l.instances.length - 6})` : ""}`;
    add("warning", "CIRCUIT_FOOTPRINT_UNVERIFIED", `land pattern ${l.entry.id} (${l.from === "provider" ? "provider table" : "tscircuit/footprints.json"}) for ${who} is not verified: ${l.problems[0]}${l.problems.length > 1 ? ` (+${l.problems.length - 1} more)` : ""}`, { components: [...l.instances] });
  }
  // ---- land patterns chosen by package family, and packages no entry fits (a mismatch, not a guess)
  for (const c of netlist.components) {
    if (!c.package) continue;
    const r = resolveFootprint(c.instance, { ...c.package, manufacturer: c.manufacturer }, input.overrides);
    if (r.entry && r.by === "family") add("info", "CIRCUIT_FOOTPRINT_FAMILY", `${c.instance} (${c.part}): package "${c.package.name}" has land pattern ${r.entry.id} by its family ${packageFamily(c.package.name, c.package.pin_count)} (the entry says "${r.entry.match.package}"); its pin count${r.entry.match.pitch_mm ? ", pitch" : ""}${r.entry.match.size_mm ? " and body size" : ""} agree`, { components: [c.instance] });
    if (!r.entry && r.near?.length) add("error", "CIRCUIT_FOOTPRINT_MISMATCH", `${c.instance} (${c.part}): package "${c.package.name}" (${c.package.pin_count} pins${c.package.pitch_mm ? `, ${c.package.pitch_mm} mm pitch` : ""}) matches land patterns by name or family that do not fit it: ${r.near.join("; ")}. Correct the part's package facts, or add an entry that fits to tscircuit/footprints.json`, { components: [c.instance] });
  }
  if (!native) {
    add("info", "CIRCUIT_NOT_BUILT", `${netlist.board} has no built board yet; run \`protoboard run circuit:generate --module ${netlist.board}\``);
    return out;
  }
  const { circuitJson: cj, build } = native;
  const sourceName = new Map(ofType(cj, "source_component").map((x) => [x.source_component_id, x.name as string]));
  const instanceOf = new Map(ofType(cj, "pcb_component").map((x) => [x.pcb_component_id, build.map.components[sourceName.get(x.source_component_id) ?? ""]?.instance]));
  const at = (x: number, y: number): [number, number] => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4];
  const portsById = new Map(ofType(cj, "pcb_port").map((p) => [p.pcb_port_id, p]));
  const padsByPort = new Map<string, CircuitElement[]>();
  for (const p of [...ofType(cj, "pcb_smtpad"), ...ofType(cj, "pcb_plated_hole")]) if (p.pcb_port_id) padsByPort.set(p.pcb_port_id, [...(padsByPort.get(p.pcb_port_id) ?? []), p]);
  const padId = (p: CircuitElement) => p.pcb_smtpad_id ?? p.pcb_plated_hole_id;
  const padLoc = (p: CircuitElement): DiagnosticLocation => ({ at: at(p.x, p.y), ...(p.layer ? { layer: p.layer } : {}), components: [instanceOf.get(p.pcb_component_id) ?? p.pcb_component_id], pads: [padId(p)] });
  const placed = (inst: string): DiagnosticLocation => {
    const c = boardGeometry(cj, build.map).components.find((x) => x.instance === inst);
    return c ? { at: at(c.center[0], c.center[1]), layer: c.side, components: [inst] } : { components: [inst] };
  };
  /** Where a tscircuit error element points: its centre or position, the ports, pads, components and copper it names. */
  const drcLocation = (e: CircuitElement): DiagnosticLocation => {
    const ports = [e.pcb_port_id, ...(e.pcb_port_ids ?? [])].filter(Boolean) as string[];
    const pads = ports.flatMap((id) => padsByPort.get(id) ?? []);
    const comps = [...new Set([e.pcb_component_id, ...(e.pcb_component_ids ?? []), ...pads.map((p) => p.pcb_component_id)].filter(Boolean).map((id: string) => instanceOf.get(id) ?? id))];
    const items = [e.pcb_trace_id, e.pcb_via_id, ...(e.pcb_trace_ids ?? []), ...(e.pcb_via_ids ?? []), e.pcb_hole_id].filter(Boolean) as string[];
    const point = e.center ?? e.pcb_center ?? (typeof e.x === "number" && typeof e.y === "number" ? e : undefined) ?? (ports[0] ? portsById.get(ports[0]) : undefined);
    const loc: DiagnosticLocation = {};
    if (point && typeof point.x === "number") loc.at = at(point.x, point.y);
    if (typeof e.layer === "string") loc.layer = e.layer;
    if (comps.length) loc.components = comps;
    if (pads.length) loc.pads = pads.map(padId);
    if (items.length) loc.items = items;
    return Object.keys(loc).length ? loc : { scope: "design" };
  };

  if (build.sourceDigest !== input.sourceDigest) add("warning", "CIRCUIT_STALE", "the native source (board.tsx, the generated source, or a file they import: a hand file, the JSON it reads) changed since the last build; run circuit:export (it rebuilds) before trusting these findings");
  if (build.netlistDigest !== input.netlistDigest) add("warning", "CIRCUIT_STALE", `the UHD board module ${netlist.board} changed since generate; run circuit:generate`);
  if (build.inputsDigest !== input.inputsDigest) add("warning", "CIRCUIT_STALE", "layout.json, footprints.json or the circuit.config.ts constraints changed since generate (board.gen.tsx bakes them in); run circuit:generate");

  // ---- tscircuit's own rules
  const seen = new Set<string>();
  let drc: CircuitElement[] = [];
  try {
    const { runAllChecks } = (await import("@tscircuit/checks")) as unknown as { runAllChecks: (cj: unknown) => Promise<CircuitElement[]> | CircuitElement[] };
    drc = await offline(async () => runAllChecks(cj));
  } catch (e) {
    add("warning", "CIRCUIT_DRC", `@tscircuit/checks did not run: ${(e as Error).message.split("\n")[0]}`);
  }
  for (const e of [...cj.filter((x) => /_error$/.test(x.type)), ...drc.filter((x) => /_error$/.test(x.type))]) {
    const key = `${e.type}|${e.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // a placement-only board (routing: off) has no traces by design: an unconnected port is information there
    add(input.constraints?.routing === "off" && (e.type === "pcb_port_not_connected_error" || e.type === "pcb_trace_missing_error") ? "info" : "error", "CIRCUIT_DRC", `${e.type}: ${e.message}`, drcLocation(e));
  }

  // ---- components: every UHD component on the board, nothing else
  const names = new Set(ofType(cj, "source_component").map((s) => s.name as string));
  const mapped = new Set(Object.values(build.map.components).map((c) => c.instance));
  for (const c of netlist.components) {
    if (!mapped.has(c.instance)) add("error", "CIRCUIT_COMPONENT_MISSING", `${c.instance} (${c.part}) is in the UHD board but not in the native design; run circuit:generate`, { components: [c.instance] });
  }
  for (const [name, m] of Object.entries(build.map.components)) {
    if (!names.has(name)) add("error", "CIRCUIT_COMPONENT_MISSING", `${m.instance} (${m.part}) is missing from the built board`, { components: [m.instance] });
    else if (!netlist.components.some((c) => c.instance === m.instance)) add("error", "CIRCUIT_COMPONENT_EXTRA", `${m.instance} is on the board but no longer in the UHD board module`, placed(m.instance));
  }
  for (const name of names) if (!build.map.components[name]) add("error", "CIRCUIT_COMPONENT_EXTRA", `${name} is on the board but has no UHD instance (added in the native source by hand?)`, { components: [name] });

  // ---- netlist drift: copper vs UHD
  const { nets, present } = copperNets(cj, build.map);
  // routing off (placement only): nets are expected to be unrouted, so that is information, not an error
  const placementOnly = input.constraints?.routing === "off";
  // a drift finding is located at the pins of the nets it names
  const pinPads = new Map<string, CircuitElement[]>();
  for (const [port, pin] of portPins(cj, build.map)) pinPads.set(pin, [...(pinPads.get(pin) ?? []), ...(padsByPort.get(port) ?? [])]);
  const netOfPin = new Map(netlist.nets.flatMap((n) => n.pins.map((p) => [p, n.id] as const)));
  for (const f of netlistDrift(netlist.nets, nets, present)) {
    // at the pins it names: their pads, components and nets
    const pins = f.pins.length ? f.pins : (netlist.nets.find((n) => n.id === f.net)?.pins ?? []);
    const pads = pins.flatMap((p) => pinPads.get(p) ?? []);
    const netIds = [...new Set([...(f.net ? [f.net] : []), ...pins.map((p) => netOfPin.get(p)).filter((x): x is string => !!x)])];
    const loc: DiagnosticLocation = { ...(pads[0] ? { at: at(pads[0].x, pads[0].y), points: pads.map((p) => at(p.x, p.y)), pads: pads.map(padId) } : {}), components: [...new Set(pins.map((p) => p.split(":")[0]))], ...(netIds.length ? { nets: netIds } : {}) };
    const routingOff = placementOnly && (f.code === "net_unrouted" || f.code === "net_open");
    add(routingOff ? "info" : "error", DRIFT_CODES[f.code], routingOff ? `${f.message} (routing: off)` : f.message, loc);
  }
  // every pad of a pin with several (a module's exposed ground pads) carries the pin's net, not only the first
  const netOf = new Map(netlist.nets.flatMap((n) => n.pins.map((p) => [p, n.id] as const)));
  for (const u of unjoinedPads(cj, build.map, new Set(netOf.keys()))) {
    const pads = u.ports.flatMap((id) => padsByPort.get(id) ?? []);
    add(placementOnly ? "info" : "error", "CIRCUIT_PAD_UNNETTED", `${u.pin} has ${u.pads} pads in ${u.pieces} copper pieces: not every pad is joined to net ${netOf.get(u.pin)}; run circuit:generate (it joins the pin's pads to each other)`, { ...(pads[0] ? { at: at(pads[0].x, pads[0].y), layer: pads[0].layer, points: pads.map((p) => at(p.x, p.y)) } : {}), components: [u.pin.split(":")[0]], pads: pads.map(padId), nets: [netOf.get(u.pin)!] });
  }

  // ---- traces written by hand between pads of one pin: generate joins them itself (PB-1027, F22)
  if (input.generatedSource !== undefined) {
    for (const h of handPadJoins(cj, build.map, input.generatedSource)) {
      add("warning", "CIRCUIT_HAND_PAD_JOIN", `a trace written by hand (${h.trace}) joins pads of ${h.instance}:${h.pin}, which generate joins itself; remove it from tscircuit/board.tsx: in KiCad it becomes copper on no net`, { components: [h.instance] });
    }
  }

  // ---- geometry: outline, keep-outs, fixed placements
  const g = boardGeometry(cj, build.map);
  for (const p of ofType(cj, "pcb_smtpad")) {
    const w = (p.width ?? (p.radius ?? 0) * 2) / 2;
    const h = (p.height ?? (p.radius ?? 0) * 2) / 2;
    const corners: Vec2[] = [[p.x - w, p.y - h], [p.x + w, p.y - h], [p.x + w, p.y + h], [p.x - w, p.y + h]];
    if (corners.some((c) => !inside(c, g.outline))) {
      add("error", "CIRCUIT_OUTSIDE_OUTLINE", `a pad of ${instanceOf.get(p.pcb_component_id) ?? p.pcb_component_id} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) lies outside the board outline`, padLoc(p));
    }
  }
  // a component's extent: its courtyard as placed (turned with the part), else its axis-aligned box
  const courtyardOf = new Map<string, Vec2[]>();
  for (const r of ofType(cj, "pcb_courtyard_rect")) {
    const inst = instanceOf.get(r.pcb_component_id);
    if (!inst) continue;
    const a = ((r.ccw_rotation ?? 0) * Math.PI) / 180;
    const [hw, hh] = [r.width / 2, r.height / 2];
    courtyardOf.set(inst, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [r.center.x + x * Math.cos(a) - y * Math.sin(a), r.center.y + x * Math.sin(a) + y * Math.cos(a)] as Vec2));
  }
  // a part the native entry lets off the board (a mid-mount receptacle in its cut-out) is not reported for its body; its pads still are
  const offBoard = new Set(ofType(cj, "pcb_component").filter((x) => x.is_allowed_to_be_off_board).map((x) => instanceOf.get(x.pcb_component_id)));
  for (const c of g.components) {
    if (offBoard.has(c.instance)) continue;
    const [hw, hh] = [c.size[0] / 2, c.size[1] / 2];
    const corners: Vec2[] = courtyardOf.get(c.instance) ?? [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [c.center[0] + x, c.center[1] + y] as Vec2);
    if (corners.some((p) => !inside(p, g.outline)) && !corners.every((p) => !inside(p, g.outline))) {
      add("warning", "CIRCUIT_OUTSIDE_OUTLINE", `${c.instance}'s footprint (${c.size.join(" × ")} mm at ${c.center.join(", ")}) overhangs the board outline`, { at: at(c.center[0], c.center[1]), layer: c.side, components: [c.instance] });
    } else if (corners.every((p) => !inside(p, g.outline))) add("error", "CIRCUIT_OUTSIDE_OUTLINE", `${c.instance} at (${c.center.join(", ")}) is outside the board outline`, { at: at(c.center[0], c.center[1]), layer: c.side, components: [c.instance] });
  }
  for (const k of input.constraints?.keepouts ?? []) {
    for (const layer of k.layers) {
      const hits = copperPoints(cj, layer).filter((p) => insideKeepout(p.at, k));
      const what = [...new Set(hits.map((h) => h.what))];
      if (what.length) add("error", "CIRCUIT_KEEPOUT", `${what.length} copper item(s) on the ${layer} layer inside keep-out ${k.name}${k.reason ? ` (${k.reason})` : ""}: ${what.slice(0, 5).join(", ")}${what.length > 5 ? ", …" : ""}`, { at: at(hits[0].at[0], hits[0].at[1]), points: [...new Map(hits.map((h) => [h.what, at(h.at[0], h.at[1])])).values()], layer, items: [k.name, ...what.map((w) => w.split(" ").pop()!)] });
    }
  }
  // copper pours are areas: no keep-out may hold any of a pour, on any layer
  for (const pour of ofType(cj, "pcb_copper_pour")) {
    const outer = (pour.brep_shape?.outer_ring?.vertices ?? []).map((v: { x: number; y: number }) => [v.x, v.y] as Vec2);
    const holes = (pour.brep_shape?.inner_rings ?? []).map((r: { vertices: { x: number; y: number }[] }) => r.vertices.map((v) => [v.x, v.y] as Vec2));
    if (outer.length < 3) continue;
    const filled = (p: Vec2) => inside(p, outer) && !holes.some((h: Vec2[]) => inside(p, h));
    for (const k of input.constraints?.keepouts ?? []) {
      const [cx, cy, w, h] = "rect" in k.shape ? [...k.shape.rect.at, ...k.shape.rect.size] : [...k.shape.circle.at, k.shape.circle.diameter_mm, k.shape.circle.diameter_mm];
      let hit = false;
      for (let i = 1; i < 20 && !hit; i++) for (let j = 1; j < 20 && !hit; j++) {
        const p: Vec2 = [cx - w / 2 + (w * i) / 20, cy - h / 2 + (h * j) / 20];
        if (insideKeepout(p, k) && filled(p)) hit = true;
      }
      if (hit) add("error", "CIRCUIT_KEEPOUT", `copper pour ${pour.pcb_copper_pour_id} on the ${pour.layer} layer fills keep-out ${k.name}${k.reason ? ` (${k.reason})` : ""}`, { at: at(cx, cy), layer: pour.layer, items: [k.name, pour.pcb_copper_pour_id] });
    }
  }
  // ---- vias below the board's own via rules (PB-1027, F31): the router keeps to them, a via written by hand may not
  if (input.constraints) {
    for (const v of viasBelowRules(cj, input.constraints.rules)) add("error", "CIRCUIT_VIA_RULES", `via ${v.via} is ${v.what}; the board's rules ask for at least ${v.want} mm (circuit.config.ts rules). Make it to the rules, or change the rules if the fab can make it`, { at: at(v.at[0], v.at[1]), items: [v.via] });
  }
  // ---- vias inside SMD pads: kept out, or filled and capped by the fab (config via_in_pad)
  const inPad = viasInPads(cj);
  if (inPad.length) {
    const where = [...new Set(inPad.map((v) => instanceOf.get(v.pad.pcb_component_id) ?? v.pad.pcb_component_id))];
    const viaLoc: DiagnosticLocation = { at: at(inPad[0].via.x, inPad[0].via.y), points: inPad.map((v) => at(v.via.x, v.via.y)), components: where, pads: inPad.map((v) => padId(v.pad)), items: inPad.map((v) => v.via.pcb_via_id) };
    const msg = `${inPad.length} via(s) inside SMD pads (${where.slice(0, 8).join(", ")}${where.length > 8 ? ", …" : ""})`;
    if (input.constraints?.via_in_pad === "fill_and_cap") add("info", "CIRCUIT_VIA_IN_PAD", `${msg}: the fabrication order asks the fab to fill and cap them (via_in_pad: fill_and_cap)`, viaLoc);
    else add("error", "CIRCUIT_VIA_IN_PAD", `${msg}: an open via wicks solder from the joint; move them out (regenerate: via_in_pad defaults to avoid) or set via_in_pad: "fill_and_cap" so the fab fills and caps them`, viaLoc);
  }
  // ---- the via policy beyond pads: none touching a pad, none under a body (config; the router has no such rule)
  if (input.constraints?.via_touching_pad === "avoid") {
    const touching = viasTouchingPads(cj);
    if (touching.length) {
      const where = [...new Set(touching.map((v) => instanceOf.get(v.pad.pcb_component_id) ?? v.pad.pcb_component_id))];
      add("error", "CIRCUIT_VIA_TOUCHING_PAD", `${touching.length} via(s) touching an SMD pad they do not sit in (${where.slice(0, 8).join(", ")}${where.length > 8 ? ", …" : ""}): the ring and the pad share copper with no mask between them (via_touching_pad: avoid); move the parts a little and generate again`, { at: at(touching[0].via.x, touching[0].via.y), points: touching.map((v) => at(v.via.x, v.via.y)), components: where, pads: touching.map((v) => padId(v.pad)), items: touching.map((v) => v.via.pcb_via_id) });
    }
  }
  if (input.constraints?.via_under_body === "avoid") {
    const hits = ofType(cj, "pcb_via").flatMap((v) => [...courtyardOf].filter(([, poly]) => inside([v.x, v.y], poly)).map(([inst]) => ({ inst, v })));
    const under = hits.map((h) => h.inst);
    if (under.length) {
      const where = [...new Set(under)];
      add("error", "CIRCUIT_VIA_UNDER_BODY", `${under.length} via(s) under a component's body (inside its courtyard: ${where.slice(0, 8).join(", ")}${where.length > 8 ? ", …" : ""}) (via_under_body: avoid); give the parts room or move the vias in board.tsx`, { at: at(hits[0].v.x, hits[0].v.y), points: hits.map((h) => at(h.v.x, h.v.y)), components: where, items: hits.map((h) => h.v.pcb_via_id) });
    }
  }
  // ---- non-plated holes against copper, round holes as circles (not their bounding box)
  const clearance = input.constraints?.rules.hole_clearance_mm ?? 0;
  for (const h of holeClearanceFaults(cj, clearance)) {
    add("error", "CIRCUIT_HOLE_CLEARANCE", `${h.what} is ${h.gap < 0 ? `${(-h.gap).toFixed(3)} mm into` : `${h.gap.toFixed(3)} mm from`} the hole ${h.hole} at (${h.at.map((v) => v.toFixed(2)).join(", ")})${clearance ? `; the rule is ${clearance} mm (rules.hole_clearance_mm)` : ""}`, { at: at(h.at[0], h.at[1]), ...(h.layer ? { layer: h.layer } : {}), items: [h.hole, ...(h.id ? [h.id] : [])], ...(h.component ? { components: [instanceOf.get(h.component) ?? h.component] } : {}) });
  }
  // ---- trace widths the config asks for (trace_widths): the narrowest routed segment of each net
  const asked = new Map<string, number>();
  for (const n of netlist.nets) {
    const w = input.constraints?.trace_widths.nets[n.id] ?? input.constraints?.trace_widths.classes[n.kind];
    if (w !== undefined) asked.set(n.id, w);
  }
  if (asked.size) {
    const where = new Map<string, { at: [number, number]; layer?: string; trace: string }>();
    for (const [net, narrowest] of narrowestTraces(cj, build.map, netlist, where)) {
      const want = asked.get(net);
      if (want !== undefined && narrowest < want - 1e-4) add("warning", "CIRCUIT_TRACE_WIDTH", `net ${net} has traces ${+narrowest.toFixed(4)} mm wide; trace_widths asks for ${want} mm (the router narrows traces where it cannot fit the width: give the net room, or accept the neck-down)`, { ...(where.get(net) ? { at: where.get(net)!.at, ...(where.get(net)!.layer ? { layer: where.get(net)!.layer } : {}), items: [where.get(net)!.trace] } : {}), nets: [net] });
    }
  }
  for (const [inst, want] of Object.entries(input.constraints?.placements ?? {})) {
    const c = g.components.find((x) => x.instance === inst);
    if (!c) continue;
    const moved = Math.hypot(c.origin[0] - want.at[0], c.origin[1] - want.at[1]);
    const turned = Math.abs(((((c.rotation_deg - want.rotation_deg) % 360) + 540) % 360) - 180);
    if (moved > 0.01 || turned > 0.1 || c.side !== want.side) {
      add("error", "CIRCUIT_PLACEMENT_MOVED", `${inst} is at (${c.origin.join(", ")}) rot ${c.rotation_deg}° ${c.side}; circuit.config.ts fixes it at (${want.at.join(", ")}) rot ${want.rotation_deg}° ${want.side}`, { at: at(c.origin[0], c.origin[1]), layer: c.side, components: [inst], points: [at(c.origin[0], c.origin[1]), at(want.at[0], want.at[1])] });
    }
  }
  return out;
}

/** Vias whose centre lies inside an SMD pad (any copper layer the via reaches holds the pad). */
/** Vias whose pad or drill is smaller than the rules' (via_pad_mm, via_drill_mm). */
export function viasBelowRules(cj: CircuitElement[], rules: { via_pad_mm: number; via_drill_mm: number }): { via: string; at: Vec2; what: string; want: number }[] {
  const out: { via: string; at: Vec2; what: string; want: number }[] = [];
  const r = (v: number) => +v.toFixed(4);
  for (const v of ofType(cj, "pcb_via")) {
    const pad = Number(v.outer_diameter);
    const drill = Number(v.hole_diameter);
    const at: Vec2 = [Number(v.x), Number(v.y)];
    if (Number.isFinite(pad) && pad < rules.via_pad_mm - 1e-4) out.push({ via: String(v.pcb_via_id), at, what: `${r(pad)} mm across its pad`, want: rules.via_pad_mm });
    else if (Number.isFinite(drill) && drill < rules.via_drill_mm - 1e-4) out.push({ via: String(v.pcb_via_id), at, what: `drilled ${r(drill)} mm`, want: rules.via_drill_mm });
  }
  return out;
}

export function viasInPads(cj: CircuitElement[]): { via: CircuitElement; pad: CircuitElement }[] {
  const pads = ofType(cj, "pcb_smtpad");
  const out: { via: CircuitElement; pad: CircuitElement }[] = [];
  for (const v of ofType(cj, "pcb_via")) {
    const pad = pads.find((p) => {
      const w = (p.width ?? (p.radius ?? 0) * 2) / 2;
      const h = (p.height ?? (p.radius ?? 0) * 2) / 2;
      return Math.abs(v.x - p.x) < w && Math.abs(v.y - p.y) < h && (!v.layers || v.layers.includes(p.layer));
    });
    if (pad) out.push({ via: v, pad });
  }
  return out;
}


/** Distance from a point to an axis-aligned rectangle (0 inside). */
const rectDistance = (p: Vec2, c: Vec2, w: number, h: number) => Math.hypot(Math.max(0, Math.abs(p[0] - c[0]) - w / 2), Math.max(0, Math.abs(p[1] - c[1]) - h / 2));

/** Distance from a point to a pad's copper (rect, rotated rect, circle, pill), 0 inside. */
function padDistance(p: Vec2, pad: CircuitElement): number {
  if (pad.shape === "circle") return Math.max(0, Math.hypot(p[0] - pad.x, p[1] - pad.y) - pad.radius);
  const a = (-(pad.ccw_rotation ?? 0) * Math.PI) / 180;
  const [dx, dy] = [p[0] - pad.x, p[1] - pad.y];
  const local: Vec2 = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  const w = pad.width ?? (pad.radius ?? 0) * 2;
  const h = pad.height ?? (pad.radius ?? 0) * 2;
  if (pad.shape === "pill" || pad.shape === "rotated_pill") {
    const r = Math.min(w, h) / 2;
    const half = Math.max(w, h) / 2 - r;
    const [u, v] = w >= h ? local : [local[1], local[0]];
    return Math.max(0, Math.hypot(Math.max(0, Math.abs(u) - half), v) - r);
  }
  return rectDistance(local, [0, 0], w, h);
}

/** Vias whose ring reaches an SMD pad on a layer it spans, with the centre outside the pad (in-pad vias are viasInPads'). */
export function viasTouchingPads(cj: CircuitElement[]): { via: CircuitElement; pad: CircuitElement }[] {
  const pads = ofType(cj, "pcb_smtpad");
  const out: { via: CircuitElement; pad: CircuitElement }[] = [];
  for (const v of ofType(cj, "pcb_via")) {
    const r = (v.outer_diameter ?? 0.6) / 2;
    const pad = pads.find((p) => (!v.layers || v.layers.includes(p.layer)) && padDistance([v.x, v.y], p) > 0 && padDistance([v.x, v.y], p) <= r + 1e-6);
    if (pad) out.push({ via: v, pad });
  }
  return out;
}

/** Distance from point p to segment ab. */
const segmentDistance = (p: Vec2, a: Vec2, b: Vec2) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/**
 * Copper closer to a non-plated hole's wall than `clearance` (0: copper in the hole). A round hole
 * is its circle and a pill its stadium, not a bounding box; copper is every pad, plated hole, via,
 * trace (by its width) and pour (its outline less its cut-outs).
 */
export function holeClearanceFaults(cj: CircuitElement[], clearance: number): { hole: string; at: Vec2; what: string; gap: number; id?: string; layer?: string; component?: string }[] {
  const out: { hole: string; at: Vec2; what: string; gap: number; id?: string; layer?: string; component?: string }[] = [];
  for (const h of ofType(cj, "pcb_hole")) {
    const at: Vec2 = [h.x, h.y];
    const round = h.hole_shape === "circle" || h.hole_shape === "round" || (h.hole_diameter !== undefined && h.hole_width === undefined);
    const w = round ? h.hole_diameter : h.hole_width;
    const ht = round ? h.hole_diameter : h.hole_height;
    if (!w || !ht) continue;
    const r = Math.min(w, ht) / 2;
    const half = Math.max(w, ht) / 2 - r;
    // the hole as a stadium (a circle when half = 0): distance from its wall
    const wall = (p: Vec2) => (w >= ht ? segmentDistance(p, [at[0] - half, at[1]], [at[0] + half, at[1]]) : segmentDistance(p, [at[0], at[1] - half], [at[0], at[1] + half])) - r;
    const name = h.pcb_hole_id;
    let worst: { what: string; gap: number; id?: string; layer?: string; component?: string } | undefined;
    const consider = (what: string, gap: number, el?: CircuitElement) => {
      if (gap < clearance - 1e-6 && (!worst || gap < worst.gap)) {
        const id = el ? (el.pcb_smtpad_id ?? el.pcb_plated_hole_id ?? el.pcb_via_id ?? el.pcb_trace_id ?? el.pcb_copper_pour_id) : undefined;
        worst = { what, gap, ...(id ? { id } : {}), ...(typeof el?.layer === "string" ? { layer: el.layer } : {}), ...(el?.pcb_component_id ? { component: el.pcb_component_id } : {}) };
      }
    };
    for (const p of ofType(cj, "pcb_smtpad")) {
      // distance between the pad and the hole wall: sample the pad's outline towards the hole
      const axis: Vec2[] = half ? (w >= ht ? [[at[0] - half, at[1]], at, [at[0] + half, at[1]]] : [[at[0], at[1] - half], at, [at[0], at[1] + half]]) : [at];
      consider(`pad ${p.pcb_smtpad_id}`, Math.min(...axis.map((q) => padDistance(q, p))) - r, p);
    }
    for (const p of ofType(cj, "pcb_plated_hole")) consider(`plated hole ${p.pcb_plated_hole_id}`, wall([p.x, p.y]) - (p.outer_diameter ?? Math.max(p.outer_width ?? 0, p.outer_height ?? 0)) / 2, p);
    for (const v of ofType(cj, "pcb_via")) consider(`via ${v.pcb_via_id}`, wall([v.x, v.y]) - (v.outer_diameter ?? 0.6) / 2, v);
    for (const t of ofType(cj, "pcb_trace")) {
      const route = (t.route ?? []) as { route_type: string; x: number; y: number; width?: number }[];
      for (let i = 1; i < route.length; i++) {
        const [a, b] = [route[i - 1], route[i]];
        if (a.route_type !== "wire" || b.route_type !== "wire") continue;
        // the segment's distance to the hole's centre line, less the hole's radius and the trace's half-width
        const d = half ? Math.min(segmentDistance([at[0] - half, at[1]], [a.x, a.y], [b.x, b.y]), segmentDistance([at[0] + half, at[1]], [a.x, a.y], [b.x, b.y]), segmentDistance(at, [a.x, a.y], [b.x, b.y])) : segmentDistance(at, [a.x, a.y], [b.x, b.y]);
        consider(`trace ${t.pcb_trace_id}`, d - r - (a.width ?? 0.15) / 2, { ...t, layer: (a as { layer?: string }).layer });
      }
    }
    for (const pour of ofType(cj, "pcb_copper_pour")) {
      const outer = (pour.brep_shape?.outer_ring?.vertices ?? []).map((v: { x: number; y: number }) => [v.x, v.y] as Vec2);
      if (outer.length < 3) continue;
      const rings = [outer, ...(pour.brep_shape?.inner_rings ?? []).map((ring: { vertices: { x: number; y: number }[] }) => ring.vertices.map((v) => [v.x, v.y] as Vec2))];
      const inHole = rings.slice(1).some((ring: Vec2[]) => inside(at, ring));
      const filled = inside(at, outer) && !inHole;
      const edge = Math.min(...rings.map((ring: Vec2[]) => Math.min(...ring.map((p, i) => segmentDistance(at, p, ring[(i + 1) % ring.length])))));
      consider(`copper pour ${pour.pcb_copper_pour_id} (${pour.layer})`, filled ? -r : edge - r - half, pour);
    }
    if (worst) out.push({ hole: name, at, ...worst });
  }
  return out;
}

/** The narrowest routed segment of each UHD net (by the copper the trace connects). */
export function narrowestTraces(cj: CircuitElement[], map: NameMap, netlist: BoardNetlist, where?: Map<string, { at: [number, number]; layer?: string; trace: string }>): Map<string, number> {
  const connectivity = getFullConnectivityMapFromCircuitJson(cj.filter((e) => e.type.startsWith("pcb_")) as never);
  const netOfPin = new Map(netlist.nets.flatMap((n) => n.pins.map((p) => [p, n.id] as const)));
  const uhdNet = new Map<string, string>();
  for (const [port, pin] of portPins(cj, map)) {
    const c = connectivity.getNetConnectedToId(port);
    const n = netOfPin.get(pin);
    if (c && n) uhdNet.set(c, n);
  }
  const out = new Map<string, number>();
  for (const t of ofType(cj, "pcb_trace")) {
    const net = uhdNet.get(connectivity.getNetConnectedToId(t.pcb_trace_id) ?? "");
    if (!net) continue;
    for (const p of (t.route ?? []) as { route_type: string; width?: number; x: number; y: number; layer?: string }[]) {
      if (p.route_type !== "wire" || typeof p.width !== "number") continue;
      if (p.width < (out.get(net) ?? Infinity)) where?.set(net, { at: [p.x, p.y], ...(p.layer ? { layer: p.layer } : {}), trace: t.pcb_trace_id });
      out.set(net, Math.min(out.get(net) ?? Infinity, p.width));
    }
  }
  return out;
}
