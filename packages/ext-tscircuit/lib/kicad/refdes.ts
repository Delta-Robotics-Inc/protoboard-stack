/**
 * Reference designators for KiCad, stable between exports
 * (docs/specs/pcb-kicad-handoff.md §2.1). Assigned once per UHD instance path
 * and recorded in `tscircuit/refdes.json`, so a re-export (and KiCad's Update
 * PCB from Schematic) keeps every unchanged part's designator and placement.
 *
 *   1. an instance already recorded keeps its designator
 *   2. moved: a new instance whose last path segment is that of exactly one
 *      recorded instance no longer on the board, with a designator of its
 *      kind, takes it over (a part moved into or out of a sub-module keeps
 *      its designator; docs/specs/nested-boards.md §6)
 *   3. a new instance whose id (the last segment of its path: `led1/r1` reads
 *      `r1`) reads as a designator with its kind's prefix (`r3`, `U1`) gets
 *      it upper-cased, when free
 *   4. otherwise the kind's prefix and the lowest free number, new instances
 *      taken in instance-path order
 *
 * A removed instance stays in the record, so its designator is not reused.
 * Designators are unique over the whole board, sub-modules included.
 */
import type { BoardComponent, BoardComponentKind } from "@protoboardai/core";

export const REFDES_SCHEMA = "protoboard.refdes/v0";

export interface RefdesRecord {
  schema: typeof REFDES_SCHEMA;
  /** instance path → designator */
  assigned: Record<string, string>;
}

export const PREFIX: Record<BoardComponentKind, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  ferrite_bead: "FB",
  connector: "J",
  switch: "SW",
  ic: "U",
};

/**
 * The conventional prefix for a part the board netlist files under `ic`
 * (IEEE 315 / IPC usage): diodes and LEDs D, transistors Q, crystals and
 * resonators Y, fuses F, batteries BT, buzzers and speakers LS. Read from the
 * part's UHD categories: an integrated circuit (`component.ic…`) stays U
 * whatever its name says (an LED driver, a battery charger, a protection IC).
 * Only a part with no categories falls back to its name, never its id (an id
 * starts with the manufacturer: "Diodes Inc." makes MOSFETs). Undefined keeps
 * the kind's prefix.
 */
export function prefixFromPart(def: { id: string; name?: string; categories?: string[] } | undefined): string | undefined {
  if (!def) return undefined;
  const cats = (def.categories ?? []).map((c) => c.toLowerCase());
  const has = (re: RegExp) => cats.some((c) => re.test(c));
  if (cats.length) {
    if (has(/(^|\.)ic(\.|$)/)) return undefined;
    if (has(/(^|\.)transistors?(\.|$)|mosfet|bjt/)) return "Q";
    if (has(/(^|\.)(diodes?|leds?|tvs|zener|rectifiers?)(\.|$)/)) return "D";
    if (has(/(^|\.)(crystals?|resonators?|oscillators?)(\.|$)/)) return "Y";
    if (has(/(^|\.)fuses?(\.|$)/)) return "F";
    if (has(/(^|\.)(batter(y|ies)|cells?)(\.|$)/) && !has(/charger/)) return "BT";
    if (has(/(^|\.)(buzzers?|speakers?)(\.|$)/)) return "LS";
    return undefined;
  }
  const name = (def.name ?? "").toLowerCase();
  if (!name || /\b(ic|driver|controller|charger|regulator|converter|protection|monitor|gauge|module)\b/.test(name)) return undefined;
  if (/\b(transistor|mosfet|bjt|jfet|igbt)s?\b/.test(name)) return "Q";
  if (/\b(led|diode|zener|schottky|tvs|rectifier)s?\b/.test(name)) return "D";
  if (/\b(crystal|resonator|oscillator)s?\b/.test(name)) return "Y";
  if (/\b(fuse|polyfuse|ptc)s?\b/.test(name)) return "F";
  if (/\bbatter(y|ies)\b/.test(name)) return "BT";
  if (/\b(buzzer|speaker)s?\b/.test(name)) return "LS";
  return undefined;
}

export const refdesFile = (native: string) => `${native}/refdes.json`;

export function emptyRefdes(): RefdesRecord {
  return { schema: REFDES_SCHEMA, assigned: {} };
}

/** Designators for every component, extending `record` (returned as a new record) for the ones it lacks. */
export function assignRefdes(components: Pick<BoardComponent, "instance" | "kind">[], record: RefdesRecord = emptyRefdes(), prefixOf: (c: Pick<BoardComponent, "instance" | "kind">) => string | undefined = () => undefined): { record: RefdesRecord; added: string[] } {
  const assigned = { ...record.assigned };
  const taken = new Set(Object.values(assigned));
  const fresh = components.filter((c) => !assigned[c.instance]).sort((a, b) => a.instance.localeCompare(b.instance));
  const leaf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  // pass 0: a part that moved (same id, another path) keeps its designator, when the match is unambiguous
  const present = new Set(components.map((c) => c.instance));
  const gone = Object.keys(assigned).filter((i) => !present.has(i));
  for (const c of fresh) {
    const prefix = (c.kind === "ic" ? prefixOf(c) : undefined) ?? PREFIX[c.kind] ?? "U";
    const was = gone.filter((g) => leaf(g) === leaf(c.instance) && new RegExp(`^${prefix}\\d+$`).test(assigned[g]));
    if (was.length !== 1 || fresh.filter((f) => leaf(f.instance) === leaf(c.instance)).length !== 1) continue;
    assigned[c.instance] = assigned[was[0]];
    delete assigned[was[0]];
  }
  // pass 1: ids that already read as designators of their kind keep them
  for (const c of fresh) {
    if (assigned[c.instance]) continue;
    const prefix = (c.kind === "ic" ? prefixOf(c) : undefined) ?? PREFIX[c.kind] ?? "U";
    const m = /^([a-z]+)(\d+)$/i.exec(leaf(c.instance));
    const want = m && m[1].toUpperCase() === prefix ? `${prefix}${Number(m[2])}` : undefined;
    if (want && Number(m![2]) > 0 && !taken.has(want)) {
      assigned[c.instance] = want;
      taken.add(want);
    }
  }
  // pass 2: the lowest free number of the kind's prefix
  for (const c of fresh) {
    if (assigned[c.instance]) continue;
    const prefix = (c.kind === "ic" ? prefixOf(c) : undefined) ?? PREFIX[c.kind] ?? "U";
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n++;
    assigned[c.instance] = `${prefix}${n}`;
    taken.add(`${prefix}${n}`);
  }
  const sorted = Object.fromEntries(Object.entries(assigned).sort(([a], [b]) => a.localeCompare(b)));
  return { record: { schema: REFDES_SCHEMA, assigned: sorted }, added: fresh.map((c) => c.instance) };
}

export function parseRefdes(text: string | undefined): RefdesRecord | undefined {
  if (!text) return undefined;
  try {
    const r = JSON.parse(text) as RefdesRecord;
    return r?.schema === REFDES_SCHEMA && r.assigned && typeof r.assigned === "object" ? r : undefined;
  } catch {
    return undefined;
  }
}
