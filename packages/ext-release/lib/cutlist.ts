/**
 * A wire harness's cut list from its UHD facts (tool-neutral): one row per
 * conductor, from the ends' connector positions through the harness's
 * internal conductor link, with the cable facts (`performance` kind cable:
 * installed and supplied length, gauge) and build facts (`cable_build`:
 * colour per position of the first end, lay, strip length).
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { toCsv } from "./util.ts";

export interface CutRow {
  conductor: number;
  from: string;
  to: string;
  colour: string;
  length_mm: number | null;
  supplied_length_mm: number | null;
  gauge_awg: number | null;
  od_mm: number | null;
  strip_mm: number | null;
  lay: string;
  note: string;
}

export const CUT_COLUMNS = ["conductor", "from", "to", "colour", "length_mm", "supplied_length_mm", "gauge_awg", "od_mm", "strip_mm", "lay", "note"];

const params = (def: ModuleDef, type: string, kind?: string) =>
  (def.traits ?? []).find((t) => t.type === type && (!kind || (t.params as Record<string, unknown> | undefined)?.kind === kind))?.params as Record<string, unknown> | undefined;
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** True for a cable: a wire harness with conductors between connector ends. */
export const isCable = (def: ModuleDef) => def.kind === "harness" && (def as { topology?: string }).topology === "wire";

export function cutList(def: ModuleDef): CutRow[] {
  const cable = params(def, "performance", "cable") ?? {};
  const build = params(def, "cable_build") ?? {};
  const wires = (def.links ?? []).find((l) => "self" in l.a && "self" in l.b);
  const ends = (def.interfaces ?? []).filter((i) => i.slots?.length);
  const a = wires ? ends.find((i) => i.id === wires.a.interfaceId) : ends[0];
  const b = wires ? ends.find((i) => i.id === wires.b.interfaceId) : ends[1];
  const count = n(cable.conductors) ?? a?.slots?.length ?? 0;
  const pairs: [string, string][] = wires?.childLinks?.length
    ? wires.childLinks.map((c) => [c.a, c.b])
    : Array.from({ length: count }, (_, i) => [`p${i + 1}`, `p${i + 1}`]);
  const label = (end: InterfaceDef | undefined, slot: string) => {
    const s = end?.slots?.find((x) => x.id === slot);
    return end ? `${end.name ?? end.id} ${s?.label ?? slot}` : slot;
  };
  const colours = Array.isArray(build.colors) ? (build.colors as string[]) : [];
  const lay = [build.bundle, build.twist_pitch_mm ? `${build.twist_pitch_mm} mm pitch` : ""].filter(Boolean).join(", ");
  const position = (slot: string, i: number) => {
    const k = a?.slots?.findIndex((s) => s.id === slot) ?? -1;
    return k >= 0 ? k : i;
  };
  return pairs.map(([x, y], i) => ({
    conductor: i + 1,
    from: label(a, x),
    to: label(b, y),
    colour: colours[position(x, i)] ?? "",
    length_mm: n(cable.length_mm),
    supplied_length_mm: n(cable.supplied_length_mm),
    gauge_awg: n(cable.wire_gauge_awg),
    od_mm: n(build.od_mm),
    strip_mm: n(build.strip_mm),
    lay,
    note: i === 0 && typeof cable.length_basis === "string" ? `length ${cable.length_basis}` : "",
  }));
}

export const cutListCsv = (def: ModuleDef) => toCsv(CUT_COLUMNS, cutList(def) as unknown as Record<string, unknown>[]);
