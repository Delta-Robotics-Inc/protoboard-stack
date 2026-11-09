/**
 * The circuit from UHD (contract section 3). The board is flattened by the stack's `boardNetlist` (the same
 * reading every circuit provider starts from), and each pin's facts are read from its UHD leaf interface: type
 * from its protocols, `voltage` from its voltage parameter, `functions` from its pin_functions trait. The schematic
 * never stores this; it is derived on every load.
 */
import { boardNetlist, type BoardComponent, type BoardOptions } from "@protoboardai/core";
import type { ChildModuleRef, InterfaceDef, ModuleDef, ModuleLookup } from "@deltarobotics/uhd";
import { CIRCUIT_SCHEMA, formatValue, normalizeCircuit, pinKey, type CircuitPin, type PartClass, type SchematicCircuit, type Voltage } from "./circuit.ts";

export interface FromUhdOptions extends BoardOptions {
  /** Reference designators the board already uses, by instance path (cross-probe). */
  refs?: Record<string, string>;
}

/** The pin type a UHD leaf interface states. */
export function pinTypeOf(iface: InterfaceDef | undefined, coarse: string): CircuitPin["type"] {
  if (!iface) return coarse === "ground" ? "ground" : coarse === "power_out" ? "power_out" : coarse === "power_in" ? "power_in" : coarse === "passive" ? "passive" : coarse === "nc" ? "nc" : "io";
  const power = iface.protocols.find((p) => p.type === "power");
  if (power?.roles.includes("ground")) return "ground";
  if (power?.roles.includes("output")) return "power_out";
  if (power) return "power_in";
  if (iface.protocols.some((p) => p.type === "passive")) return "passive";
  if (iface.protocols.some((p) => p.roles.includes("no_connect"))) return "nc";
  const analog = iface.protocols.find((p) => p.type === "analog");
  if (analog) return analog.roles.includes("output") ? "analog_out" : "analog_in";
  const roles = new Set(iface.protocols.flatMap((p) => p.roles ?? []));
  const input = roles.has("input");
  const output = roles.has("output");
  if (roles.has("bidirectional") || (input && output)) return "io";
  if (output) return "output";
  if (input) return "input";
  return "io";
}

/** A UHD `voltage` parameter as a range. */
export function voltageOf(params: InterfaceDef["parameters"]): Voltage | undefined {
  const p = params?.find((x) => x.id === "voltage");
  if (!p) return undefined;
  const v: Voltage = {};
  if (typeof p.value === "number") v.nominal = p.value;
  if (Array.isArray(p.range)) {
    v.min = p.range[0];
    v.max = p.range[1];
  } else if (typeof p.value === "number") {
    v.min = p.value;
    v.max = p.value;
  }
  return v;
}

/** The part class (contract section 6.1). */
export function classOf(c: BoardComponent, def: ModuleDef | undefined): PartClass {
  if (c.kind === "resistor" || c.kind === "capacitor" || c.kind === "inductor" || c.kind === "ferrite_bead") return c.kind;
  const cats = (def?.categories ?? []).join(" ").toLowerCase();
  const name = `${c.name} ${def?.tags?.join(" ") ?? ""}`.toLowerCase();
  if (/\bled\b|component\.led|\.led\b/.test(cats) || /\bled\b/.test(name)) return "led";
  if (/diode/.test(cats) || /\bdiode\b|\btvs\b|schottky|zener/.test(name)) return "diode";
  if (/crystal|resonator|oscillator/.test(cats + name)) return "crystal";
  if (/transistor|mosfet/.test(cats + name)) return "transistor";
  if (c.kind === "switch" || /switch|button/.test(cats)) return "switch";
  if (c.kind === "connector" || /^connector|\bconnector\./.test(cats)) return "connector";
  if (/power\.regulator|regulator|\bldo\b/.test(cats + " " + name)) return "regulator";
  if (/microcontroller\./.test(cats)) return c.pins.length > 24 && /\.module|development_board/.test(cats) ? "module" : "mcu";
  if (c.pins.length > 24 && /module/.test(cats)) return "module";
  return "ic";
}

function childRef(board: ModuleDef, path: string, lookup: ModuleLookup): ChildModuleRef | undefined {
  let def: ModuleDef | undefined = board;
  let ref: ChildModuleRef | undefined;
  for (const seg of path.split("/")) {
    ref = def?.children?.find((c) => c.id === seg);
    if (!ref) return undefined;
    def = lookup(ref.moduleDefId);
  }
  return ref;
}

/** The schematic's circuit input from a UHD board module. */
export function circuitFromUhd(board: ModuleDef, lookup: ModuleLookup, options: FromUhdOptions = {}): SchematicCircuit {
  const nl = boardNetlist(board, lookup, options);
  if (nl.problems.length) throw new Error(`the board does not flatten: ${nl.problems.join("; ")}`);
  const parts = nl.components.map((c) => {
    const def = lookup(c.part);
    const leaf = (id: string) => def?.interfaces.find((i) => i.id === id);
    const pins: CircuitPin[] = c.pins.map((p) => {
      const iface = leaf(p.interface);
      const v = voltageOf(iface?.parameters);
      const fn = iface?.traits?.find((t) => t.type === "pin_functions")?.params as { description?: string } | undefined;
      return {
        id: p.interface,
        number: p.pin,
        name: p.name,
        type: pinTypeOf(iface, p.kind),
        ...(v ? { voltage: v } : {}),
        ...(fn?.description ? { functions: fn.description } : {}),
        ...(iface?.capabilities?.length ? { capabilities: [...iface.capabilities] } : {}),
      };
    });
    const ref = childRef(board, c.instance, lookup);
    const unconnected = Object.fromEntries((ref?.unconnected ?? []).map((u) => [u.interfaceId, u.reason]));
    const cls = classOf(c, def);
    return {
      path: c.instance,
      group: c.group ?? "",
      part: c.part,
      name: c.name,
      class: cls,
      ...(c.value ? { value: formatValue(c.value.value, c.value.unit) } : {}),
      ...(c.mpn ? { mpn: c.mpn } : {}),
      ...(options.refs?.[c.instance] ? { ref: options.refs[c.instance] } : {}),
      ...(def?.categories?.length ? { categories: [...def.categories] } : {}),
      ...(Object.keys(unconnected).length ? { unconnected } : {}),
      pins,
    };
  });
  const nets = nl.nets.map((n) => {
    const v = n.voltageV === undefined ? undefined : Array.isArray(n.voltageV) ? { min: n.voltageV[0], max: n.voltageV[1] } : { nominal: n.voltageV, min: n.voltageV, max: n.voltageV };
    return { name: n.name, kind: n.kind, ...(v ? { voltage: v } : {}), pins: n.pins.map((k) => pinKey(k.slice(0, k.lastIndexOf(":")), k.slice(k.lastIndexOf(":") + 1))) };
  });
  return normalizeCircuit({
    schema: CIRCUIT_SCHEMA,
    board: board.id,
    parts,
    nets,
    groups: (nl.groups ?? []).map((g) => ({ path: g.path, name: g.name, module: g.module, ...(g.parent ? { parent: g.parent } : {}) })),
    ...(nl.edge.length ? { edge: nl.edge.map((e) => ({ id: e.id, ...(e.net ? { net: e.net } : {}), pins: [...e.pins] })) } : {}),
  });
}
