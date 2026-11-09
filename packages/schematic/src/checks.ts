/**
 * The electrical checks (contract section 10.1): unconnected pins, single-pin nets, conflicting outputs and the
 * voltage check. They read the circuit (UHD facts); a schematic document adds no-connect marks and locations.
 * Messages are built from facts only.
 */
import { byCodeUnit, findingId } from "@protoboardai/board";
import { pinKey, splitPinKey, type CircuitPart, type CircuitPin, type SchematicCircuit } from "./circuit.ts";
import { recordsOfKind, type SchematicDocument } from "./document.ts";
import { geometryOf } from "./geometry.ts";
import type { XY } from "./units.ts";

export interface SchematicFinding {
  id: string;
  check: "unconnected_pin" | "single_pin_net" | "conflicting_outputs" | "voltage";
  severity: "error" | "warning" | "info";
  objects: string[];
  location?: { card?: string; x: number; y: number };
  /** the chain that explains a voltage finding, driver first */
  path?: string[];
  measured?: number;
  required?: number;
  message: string;
}

const volts = (v: number) => `${Math.round(v * 100) / 100} V`;

/** Where each net can sit: the highest and lowest voltage it can reach, with the chain that explains the highest. */
export interface NetReach {
  max: number;
  min: number;
  path: string[];
  /** false when the level comes only from a supply output's stated range (a load switch, an adjustable output): it may, not will, reach it */
  certain: boolean;
}

const CARRIES = new Set(["resistor", "inductor", "ferrite_bead"]);

/** The reach of every net (contract 10.1): design voltage, supply outputs, then through resistors, inductors and beads. */
export function netReach(c: SchematicCircuit, refOf: (path: string) => string = (p) => p): Map<string, NetReach> {
  const parts = new Map(c.parts.map((p) => [p.path, p]));
  const pinOf = (k: string): { part: CircuitPart; pin: CircuitPin } => {
    const { part, pin } = splitPinKey(k);
    const p = parts.get(part)!;
    return { part: p, pin: p.pins.find((x) => x.id === pin)! };
  };
  const reach = new Map<string, NetReach>();
  const set = (net: string, r: NetReach) => {
    const cur = reach.get(net);
    if (!cur || r.max > cur.max + 1e-9) reach.set(net, { ...r, min: Math.min(r.min, cur?.min ?? r.min) });
  };
  for (const n of c.nets) {
    if (n.kind === "ground") {
      set(n.name, { max: 0, min: 0, path: [`${n.name} (ground, 0 V)`], certain: true });
      continue;
    }
    // the net's design voltage decides (an adjustable regulator's output range says nothing by itself, as in UHD);
    // the supply output that makes it explains it. Without a design voltage, a supply output's nominal (else its top).
    const design = n.voltage?.max ?? n.voltage?.nominal;
    const drivers = n.pins.map(pinOf).filter((x) => x.pin.type === "power_out");
    if (design !== undefined) {
      const d = drivers.find((x) => x.pin.voltage && (x.pin.voltage.nominal === design || ((x.pin.voltage.min ?? -Infinity) <= design && design <= (x.pin.voltage.max ?? Infinity))));
      const fixed = d?.pin.voltage?.nominal === design || (d?.pin.voltage?.min === design && d?.pin.voltage?.max === design);
      set(n.name, { max: design, min: n.voltage?.min ?? design, path: d ? [`${refOf(d.part.path)} ${d.pin.name} (supply out, ${volts(design)}${fixed ? "" : " set by the net"})`, n.name] : [`${n.name} (design ${volts(design)})`], certain: true });
      continue;
    }
    for (const { part, pin } of drivers) {
      const v = pin.voltage?.nominal ?? pin.voltage?.max;
      if (v === undefined) continue;
      set(n.name, { max: v, min: pin.voltage?.min ?? v, path: [`${refOf(part.path)} ${pin.name} (supply out, ${pin.voltage?.nominal !== undefined ? "" : "up to "}${volts(v)})`, n.name], certain: pin.voltage?.nominal !== undefined });
    }
  }
  // propagate through two-terminal parts that carry a DC level (a pull-up holds a high-impedance node at its rail)
  const netOfPin = new Map<string, string>();
  for (const n of c.nets) for (const k of n.pins) netOfPin.set(k, n.name);
  for (let it = 0; it < c.parts.length + 1; it++) {
    let grew = false;
    for (const p of c.parts) {
      if (!CARRIES.has(p.class) || p.pins.length !== 2) continue;
      const [a, b] = p.pins.map((x) => netOfPin.get(pinKey(p.path, x.id)));
      if (!a || !b || a === b) continue;
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const r = reach.get(from);
        if (!r) continue;
        const toNet = c.nets.find((n) => n.name === to)!;
        if (toNet.kind === "ground") continue;
        const cur = reach.get(to);
        if (!cur || r.max > cur.max + 1e-9) {
          reach.set(to, { max: r.max, min: Math.min(r.min, cur?.min ?? r.min), path: [...r.path, `${refOf(p.path)} ${p.value ?? p.class}`, to], certain: r.certain });
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return reach;
}

/** Run the four checks. `doc` adds no-connect marks, designators and locations. */
export function electricalChecks(c: SchematicCircuit, doc?: SchematicDocument): SchematicFinding[] {
  const g = doc ? geometryOf(doc) : undefined;
  const refs = new Map<string, string>();
  if (doc) for (const s of recordsOfKind(doc, "symbol")) refs.set(s.part, s.ref);
  for (const p of c.parts) if (!refs.has(p.path) && p.ref) refs.set(p.path, p.ref);
  const refOf = (path: string) => refs.get(path) ?? path;
  const marked = new Set(doc ? recordsOfKind(doc, "noconnect").map((n) => n.pin) : []);
  const netOfPin = new Map<string, string>();
  for (const n of c.nets) for (const k of n.pins) netOfPin.set(k, n.name);
  const loc = (k: string): SchematicFinding["location"] => {
    const p = g?.pins.get(k);
    if (!p) return undefined;
    const card = g!.symbols.get(`sym:${p.part}`)?.rec.card;
    return { ...(card ? { card } : {}), x: p.at[0], y: p.at[1] };
  };
  const out: SchematicFinding[] = [];
  const add = (f: Omit<SchematicFinding, "id">) => {
    const l = f.location ?? { x: 0, y: 0 };
    out.push({ id: findingId(f.check, undefined, f.objects, { x: l.x, y: l.y }), ...f });
  };
  const pinLabel = (k: string) => {
    const { part, pin } = splitPinKey(k);
    const p = c.parts.find((x) => x.path === part)!;
    const q = p.pins.find((x) => x.id === pin)!;
    return `${refOf(part)} pin ${q.number} ${q.name}`;
  };
  // unconnected pins
  for (const p of c.parts)
    for (const pin of p.pins) {
      const k = pinKey(p.path, pin.id);
      if (netOfPin.has(k) || pin.type === "nc" || p.unconnected?.[pin.id] || marked.has(k)) continue;
      const severity = pin.type === "power_in" || pin.type === "ground" || pin.type === "power_out" ? "error" : pin.type === "input" ? "warning" : "info";
      add({ check: "unconnected_pin", severity, objects: [`pin:${k}`], ...(loc(k) ? { location: loc(k) } : {}), message: `${pinLabel(k)} (${pin.type.replace("_", " ")}) is on no net and not marked as left open` });
    }
  // single-pin nets
  const edge = new Set((c.edge ?? []).flatMap((e) => (e.net ? [e.net] : [])));
  for (const n of c.nets)
    if (n.pins.length === 1 && !edge.has(n.name)) add({ check: "single_pin_net", severity: "warning", objects: [`net:${n.name}`, `pin:${n.pins[0]}`], ...(loc(n.pins[0]) ? { location: loc(n.pins[0]) } : {}), message: `${n.name} joins only ${pinLabel(n.pins[0])}` });
  // conflicting outputs
  for (const n of c.nets) {
    const typeOf = (k: string) => c.parts.find((p) => p.path === splitPinKey(k).part)!.pins.find((x) => x.id === splitPinKey(k).pin)!.type;
    const supplies = n.pins.filter((k) => typeOf(k) === "power_out");
    const supplyParts = new Set(supplies.map((k) => splitPinKey(k).part));
    if (supplyParts.size > 1) add({ check: "conflicting_outputs", severity: "error", objects: [`net:${n.name}`, ...supplies.map((k) => `pin:${k}`)], ...(loc(supplies[0]) ? { location: loc(supplies[0]) } : {}), message: `${n.name} is driven by ${supplyParts.size} supply outputs: ${supplies.map(pinLabel).join(", ")}` });
    const outs = n.pins.filter((k) => typeOf(k) === "output");
    const outParts = new Set(outs.map((k) => splitPinKey(k).part));
    if (outParts.size > 1 || (outs.length && supplyParts.size)) add({ check: "conflicting_outputs", severity: "warning", objects: [`net:${n.name}`, ...outs.map((k) => `pin:${k}`)], ...(loc(outs[0]) ? { location: loc(outs[0]) } : {}), message: `${n.name} has ${outs.length + supplies.length} outputs driving it: ${[...supplies, ...outs].map(pinLabel).join(", ")}` });
  }
  // voltage
  const reach = netReach(c, refOf);
  for (const n of c.nets) {
    const r = reach.get(n.name);
    if (!r || n.kind === "ground") continue;
    for (const k of n.pins) {
      const { part, pin } = splitPinKey(k);
      const q = c.parts.find((p) => p.path === part)!.pins.find((x) => x.id === pin)!;
      if (!q.voltage || q.type === "ground" || q.type === "passive" || q.type === "power_out") continue;
      const max = q.voltage.max;
      const min = q.voltage.min;
      const path = [...r.path, `${pinLabel(k)} (max ${max !== undefined ? volts(max) : "not stated"})`];
      if (max !== undefined && r.max > max + 1e-9) {
        add({ check: "voltage", severity: r.certain ? "error" : "warning", objects: [`net:${n.name}`, `pin:${k}`], ...(loc(k) ? { location: loc(k) } : {}), path, measured: r.max, required: max, message: `${r.certain ? "" : "up to "}${volts(r.max)} on ${pinLabel(k)}, which allows ${volts(max)}: ${path.join(" -> ")}${r.certain ? "" : " (the driver states only a range; give the net a design voltage)"}` });
        continue;
      }
      if (q.type === "power_in" && min !== undefined && r.max < min - 1e-9 && r.max > 0) add({ check: "voltage", severity: "error", objects: [`net:${n.name}`, `pin:${k}`], ...(loc(k) ? { location: loc(k) } : {}), path, measured: r.max, required: min, message: `${n.name} reaches only ${volts(r.max)}; ${pinLabel(k)} needs at least ${volts(min)}` });
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || byCodeUnit(a.id, b.id));
}

export type { XY };
