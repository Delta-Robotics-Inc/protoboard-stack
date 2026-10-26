/**
 * What one placement of a part is, for bills of materials (the board
 * netlist, `build`'s BOM, the release BOM and ordering list).
 *
 * Most parts are the same at every placement: the definition's MPN. A series
 * passive (a catalog chip resistor or capacitor whose value is chosen per
 * placement) takes its value, tolerance and MPN from the board child's
 * `ChildModuleRef.overrides`, resolved by UHD's `passiveInstance` against
 * the rules the part itself carries. Problems with the overrides are UHD's
 * `passive_override` system rule; here they are returned for the caller to
 * report where it already reports problems (the board netlist).
 */
import { passiveInstance, type ModuleDef } from "@deltarobotics/uhd";

export interface PlacementPart {
  /** The placement's MPN (the definition's, for a part that is the same everywhere). */
  mpn?: string;
  /** Passive value in SI units with tolerance as a fraction. */
  value?: { value: number; unit: string; tolerance?: number };
  /** True when overrides make this placement differ from the definition's default. */
  overridden: boolean;
  problems: string[];
}

/** One placement of `def` with the child's `overrides`. */
export function placementPart(def: ModuleDef, overrides?: Record<string, unknown>): PlacementPart {
  const inst = passiveInstance(def, overrides ?? {});
  if (!inst) return { ...(def.part_number ? { mpn: def.part_number } : {}), overridden: false, problems: [] };
  const mpn = inst.part_number ?? (inst.overridden ? undefined : def.part_number);
  return {
    ...(mpn ? { mpn } : {}),
    value: { value: inst.value, unit: inst.unit, ...(inst.tolerance !== undefined ? { tolerance: inst.tolerance } : {}) },
    overridden: inst.overridden,
    problems: inst.problems,
  };
}

/** Engineering notation for a passive value: 4.7 kΩ, 100 nF, 1.5 µH. */
export function formatPassiveValue(v: { value: number; unit: string }): string {
  const prefixes: [number, string][] = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [scale, p] = prefixes.find(([s]) => Math.abs(v.value) >= s * 0.999) ?? prefixes[prefixes.length - 1];
  return `${+(v.value / scale).toPrecision(4)} ${p}${v.unit}`;
}

/** Value with tolerance, as a BOM shows it: "4.7 kΩ ±1 %". */
export function formatPassive(v: { value: number; unit: string; tolerance?: number }): string {
  return `${formatPassiveValue(v)}${v.tolerance !== undefined ? ` ±${+(v.tolerance * 100).toPrecision(3)} %` : ""}`;
}
