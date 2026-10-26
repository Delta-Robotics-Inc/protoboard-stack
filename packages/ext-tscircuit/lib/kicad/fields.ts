/**
 * The fields each KiCad symbol and footprint carries for a component: its
 * value, MPN, manufacturer, LCSC number and UHD identity
 * (docs/specs/pcb-kicad-handoff.md §2). LCSC numbers come from the offers the
 * project holds (`parts/offers.json` and `parts/evidence/<part>/sourcing.json`).
 */
import type { BoardComponent } from "@protoboardai/core";
import { lcscNumberOf, readProjectOffers, type ProjectOffers } from "@protoboardai/core/offers";

export interface ComponentFields {
  Value: string;
  MPN?: string;
  Manufacturer?: string;
  LCSC?: string;
  UHD_Instance: string;
  UHD_Part: string;
  /** The sub-module the part sits in (its path), when it is not a child of the board itself. */
  UHD_Group?: string;
}

/** The field names written beside Reference, Value and Footprint, in order. */
export const EXTRA_FIELDS = ["MPN", "Manufacturer", "LCSC", "UHD_Instance", "UHD_Part", "UHD_Group"] as const;

/**
 * part id → LCSC code for a placement with this MPN, through core's one offer
 * reader (PB-1033): the part's own sourcing evidence first for a project part,
 * its library offers first for a library part; an offer for another MPN does
 * not count (a series passive's offers are per value).
 */
export function lcscNumbers(root: string, offers: ProjectOffers = readProjectOffers(root)): (part: string, mpn?: string) => string | undefined {
  return (part, mpn) => lcscNumberOf(offers, part, mpn);
}

const SI: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** A passive value as engineers write it: 10k, 4.7µF, 100nF, 2.2µH. */
export function formatValue(v: { value: number; unit: string }): string {
  const unit = v.unit === "Ω" || /^ohm/i.test(v.unit) ? "" : v.unit;
  const abs = Math.abs(v.value);
  const [scale, prefix] = SI.find(([s]) => abs >= s * 0.999) ?? SI[SI.length - 1];
  const n = Math.round((v.value / scale) * 1000) / 1000;
  return `${n}${prefix}${unit}` || "0";
}

export function componentFields(c: BoardComponent, lcsc: (part: string, mpn?: string) => string | undefined): ComponentFields {
  const code = lcsc(c.part, c.mpn);
  return {
    Value: c.value ? formatValue(c.value) : c.mpn ?? c.name,
    ...(c.mpn ? { MPN: c.mpn } : {}),
    ...(c.manufacturer ? { Manufacturer: c.manufacturer } : {}),
    ...(code ? { LCSC: code } : {}),
    UHD_Instance: c.instance,
    UHD_Part: c.part,
    ...(c.group ? { UHD_Group: c.group } : {}),
  };
}
