/**
 * The circuit input (contract section 3): parts, pins with their facts, nets and groups, derived from the
 * project's UHD board module on every load (`circuitFromUhd` in ./uhd.ts) and never stored by the schematic.
 */
import { z } from "zod";
import { byCodeUnit, canonical, deepFreeze, sha256Hex } from "@protoboardai/board";

export const CIRCUIT_SCHEMA = "protoboard.schematic-circuit/v1";

export const PART_CLASSES = ["resistor", "capacitor", "inductor", "ferrite_bead", "led", "diode", "switch", "connector", "crystal", "transistor", "regulator", "mcu", "module", "ic"] as const;
export type PartClass = (typeof PART_CLASSES)[number];

export const PIN_TYPES = ["power_in", "power_out", "ground", "io", "input", "output", "analog_in", "analog_out", "passive", "nc"] as const;
export type CircuitPinType = (typeof PIN_TYPES)[number];

const Voltage = z.object({ min: z.number().optional(), max: z.number().optional(), nominal: z.number().optional() }).strict();
export type Voltage = z.infer<typeof Voltage>;

export const CircuitPinSchema = z
  .object({
    id: z.string().min(1),
    number: z.string().min(1),
    name: z.string(),
    type: z.enum(PIN_TYPES),
    voltage: Voltage.optional(),
    functions: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strict();
export type CircuitPin = z.infer<typeof CircuitPinSchema>;

export const CircuitPartSchema = z
  .object({
    path: z.string().min(1).regex(/^[A-Za-z0-9_.\-/+~]+$/),
    group: z.string(),
    part: z.string().min(1),
    name: z.string(),
    class: z.enum(PART_CLASSES),
    value: z.string().optional(),
    mpn: z.string().optional(),
    ref: z.string().optional(),
    categories: z.array(z.string()).optional(),
    unconnected: z.record(z.string()).optional(),
    pins: z.array(CircuitPinSchema),
  })
  .strict();
export type CircuitPart = z.infer<typeof CircuitPartSchema>;

export const CircuitNetSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(["ground", "power", "signal"]),
    voltage: Voltage.optional(),
    pins: z.array(z.string()),
  })
  .strict();
export type CircuitNet = z.infer<typeof CircuitNetSchema>;

export const CircuitSchema = z
  .object({
    schema: z.literal(CIRCUIT_SCHEMA),
    board: z.string(),
    parts: z.array(CircuitPartSchema),
    nets: z.array(CircuitNetSchema),
    groups: z.array(z.object({ path: z.string(), name: z.string(), module: z.string(), parent: z.string().optional() }).strict()),
    edge: z.array(z.object({ id: z.string(), net: z.string().optional(), pins: z.array(z.string()) }).strict()).optional(),
  })
  .strict();
export type SchematicCircuit = z.infer<typeof CircuitSchema>;

/** `<part path>:<pin id>`. */
export const pinKey = (part: string, pin: string): string => `${part}:${pin}`;
/** Split a pin key at its last colon. */
export function splitPinKey(key: string): { part: string; pin: string } {
  const i = key.lastIndexOf(":");
  return { part: key.slice(0, i), pin: key.slice(i + 1) };
}

/** Validate, normalize (sorted pins, nets by name, parts by path) and freeze a circuit. Throws on a bad one. */
export function normalizeCircuit(input: SchematicCircuit): SchematicCircuit {
  const c = CircuitSchema.parse(input);
  const parts = [...c.parts].sort((a, b) => byCodeUnit(a.path, b.path));
  const seen = new Set<string>();
  const pinsOf = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.path)) throw new Error(`circuit: part ${p.path} appears twice`);
    seen.add(p.path);
    const ids = new Set<string>();
    for (const pin of p.pins) {
      if (ids.has(pin.id)) throw new Error(`circuit: ${p.path} has pin ${pin.id} twice`);
      ids.add(pin.id);
      pinsOf.add(pinKey(p.path, pin.id));
    }
  }
  const owner = new Map<string, string>();
  const nets = [...c.nets].map((n) => ({ ...n, pins: [...n.pins].sort(byCodeUnit) })).sort((a, b) => byCodeUnit(a.name, b.name));
  const names = new Set<string>();
  for (const n of nets) {
    if (names.has(n.name)) throw new Error(`circuit: net ${n.name} appears twice`);
    names.add(n.name);
    for (const pin of n.pins) {
      if (!pinsOf.has(pin)) throw new Error(`circuit: net ${n.name} names ${pin}, which no part has`);
      const o = owner.get(pin);
      if (o) throw new Error(`circuit: ${pin} is on nets ${o} and ${n.name}`);
      owner.set(pin, n.name);
    }
  }
  return deepFreeze({ ...c, parts, nets, groups: [...c.groups].sort((a, b) => byCodeUnit(a.path, b.path)) });
}

/** SHA-256 over the canonical JSON of the circuit: the schematic records it to know when its layout is stale. */
export const circuitHash = (c: SchematicCircuit): string => sha256Hex(canonical(c)).slice(0, 16);

/** The reference designator prefix of a class. */
export const REF_PREFIX: Record<PartClass, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  ferrite_bead: "FB",
  led: "D",
  diode: "D",
  switch: "SW",
  connector: "J",
  crystal: "Y",
  transistor: "Q",
  regulator: "U",
  mcu: "U",
  module: "U",
  ic: "U",
};

export const isTwoTerminal = (p: CircuitPart): boolean => p.pins.length === 2 || ["resistor", "capacitor", "inductor", "ferrite_bead", "led", "diode"].includes(p.class);

/**
 * A passive value in compact ASCII engineering notation, as schematics print it: 4700 Ω gives `4.7k`, 100 Ω
 * `100R`, 1e-7 F `100nF`, 1e-5 H `10uH`. ASCII only, so every renderer and the KiCad export show it the same.
 */
export function formatValue(value: number, unit: string): string {
  const prefixes: [number, string][] = [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  const ohms = /^(Ω|ohm|R)$/i.test(unit);
  const a = Math.abs(value);
  for (const [f, p] of prefixes) {
    if (a >= f * 0.9999 || f === 1e-12) {
      const n = Math.round((value / f) * 1000) / 1000;
      if (ohms) return p ? `${n}${p}` : `${n}R`;
      return `${n}${p}${unit}`;
    }
  }
  return `${value}${unit}`;
}

/** Whether a printed value carries its unit (rule C24): `10k`, `100R`, `1uF`, `10uH`; free text for other parts. */
export function valueHasUnit(cls: PartClass, value: string | undefined): boolean {
  if (!value) return !["resistor", "capacitor", "inductor"].includes(cls);
  if (cls === "resistor") return /^\d+(\.\d+)?\s?([kKM]|R|Ω|ohm)\d*$/.test(value.trim());
  if (cls === "capacitor") return /^\d+(\.\d+)?\s?[pnuµm]?F$/.test(value.trim());
  if (cls === "inductor") return /^\d+(\.\d+)?\s?[pnuµm]?H$/.test(value.trim());
  return true;
}
