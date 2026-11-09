/** netlist.sync: apply a new netlist, mapping renamed nets by pin membership (Phase 2 contract, section 2.3). */
import { z } from "zod";
import { byCodeUnit } from "../canonical.js";
import { withNetlist } from "../document.js";
import { AIRNODE_C3_NETLIST } from "../fixtures/airnode-c3.js";
import { Netlist, type BoardRecord, type Netlist as NetlistType } from "../schema.js";
import { change, edited, registerOperation, type OpCall } from "./registry.js";

/**
 * The new net each vanished net maps to: the new net sharing the most of its pins found on the board, when it
 * shares at least half of them (ties go to the first in the new netlist).
 */
export function mapRenamedNets(old: NetlistType, next: NetlistType, missing: (net: string) => readonly string[]): Record<string, string> {
  const names = new Set(next.nets.map((n) => n.name));
  const pinSets = next.nets.map((n) => ({ name: n.name, pins: new Set(n.pins) }));
  const out: Record<string, string> = {};
  for (const o of old.nets) {
    if (names.has(o.name)) continue;
    const gone = new Set(missing(o.name));
    const onBoard = o.pins.filter((p) => !gone.has(p));
    if (!onBoard.length) continue;
    let best: { name: string; shared: number } | undefined;
    for (const n of pinSets) {
      const shared = onBoard.filter((p) => n.pins.has(p)).length;
      if (shared > 0 && (!best || shared > best.shared)) best = { name: n.name, shared };
    }
    if (best && best.shared * 2 >= onBoard.length) out[o.name] = best.name;
  }
  return out;
}

/** The example: the fixture's netlist with I2C_SDA renamed SDA (same pins), so its tracks follow the new name. */
const EXAMPLE_NETLIST: NetlistType = { source: AIRNODE_C3_NETLIST.source, nets: AIRNODE_C3_NETLIST.nets.map((n) => (n.name === "I2C_SDA" ? { ...n, name: "SDA" } : n)) };

registerOperation({
  name: "netlist.sync",
  title: "Apply a new netlist",
  description:
    "System operation: set the board's netlist (null removes it). With rename \"pins\" (the default), a net that disappears by name maps to the new net sharing the most of its pins, when it shares at least half of the old net's pins found on the board; tracks, vias, zones and net-class nets entries on the old name are renamed. Copper on a net that is not in the new netlist is orphaned (its net is cleared). Footprints are never added or removed here; the report lists missing and unused ones.",
  input: z.object({ netlist: Netlist.nullable(), rename: z.enum(["pins", "none"]).optional() }).strict(),
  audience: "system",
  phase: 2,
  example: { netlist: EXAMPLE_NETLIST },
  apply(doc, input, ctx) {
    const oldNl = doc.netlist;
    const newNl = input.netlist ?? undefined;
    const next = withNetlist(doc, newNl);
    const renamed = (input.rename ?? "pins") === "pins" && oldNl && newNl ? mapRenamedNets(oldNl, newNl, (n) => doc.nets.get(n)?.missing ?? []) : {};
    const names = newNl ? new Set(newNl.nets.map((n) => n.name)) : undefined;
    const puts: BoardRecord[] = [];
    const orphaned: string[] = [];
    for (const r of doc.records.values()) {
      if ((r.kind === "track" || r.kind === "via" || r.kind === "zone") && r.net !== undefined) {
        const target = renamed[r.net] ?? r.net;
        if (names && !names.has(target)) {
          const { net: _n, ...rest } = r;
          puts.push(edited(rest as typeof r, ctx));
          orphaned.push(r.id);
        } else if (target !== r.net) puts.push(edited({ ...r, net: target }, ctx));
      } else if (r.kind === "netclass" && r.nets?.some((n) => renamed[n] !== undefined)) {
        const nets = [...new Set(r.nets.map((n) => renamed[n] ?? n))];
        puts.push({ ...r, nets });
      }
    }
    const oldNames = new Set((oldNl?.nets ?? []).map((n) => n.name));
    const newNames = names ?? new Set<string>();
    const refs = new Set<string>();
    for (const r of doc.records.values()) if (r.kind === "footprint") refs.add(r.ref);
    const pinRefs = new Set((newNl?.nets ?? []).flatMap((n) => n.pins.map((p) => p.slice(0, p.indexOf(".")))));
    const report = {
      renamed,
      orphaned: orphaned.sort(byCodeUnit),
      added: [...newNames].filter((n) => !oldNames.has(n)).sort(byCodeUnit),
      removed: [...oldNames].filter((n) => !newNames.has(n)).sort(byCodeUnit),
      missingFootprints: [...pinRefs].filter((r) => !refs.has(r)).sort(byCodeUnit),
      unusedFootprints: newNl
        ? [...doc.records.values()]
            .filter((r) => r.kind === "footprint" && !pinRefs.has(r.ref))
            .map((r) => r.id)
            .sort(byCodeUnit)
        : [],
    };
    const r = change(next, puts, [], undefined, report);
    // restore the netlist first, then the records (record.put and record.remove)
    const inverse: OpCall[] = [{ op: "netlist.sync", netlist: oldNl ?? null, rename: "none" }, ...r.inverse];
    return { ...r, inverse };
  },
});

export {};
