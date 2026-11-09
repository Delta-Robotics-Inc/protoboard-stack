/**
 * Which zone fills are stale for a board, and why. The service and the editor call this after a commit (or on
 * load) to mark pours that no longer match the board, so a fill is never shown or checked as if it were current
 * when it is not.
 *
 * - A computed fill with its inputs record: per zone and layer, stale when a record it read changed or is gone
 *   (`inputs-changed`), when copper or an area now lies in the area it searched that it did not read
 *   (`new-copper`), when its zone changed (`zone-changed`), when a higher-priority fill it kept clear of changed
 *   (`dependency-changed`), when board-wide inputs changed (`rules-changed`: rules, net classes, layers, the
 *   netlist, settings), or when it has no entry (`no-fill`).
 * - Any fill without an inputs record (imported, or computed without one): only the core's zone hash can be
 *   compared; a mismatch makes every zone stale (`zones-changed`). Copper moved under an imported fill leaves it
 *   current but out of date, as in the source tool until it refills; the result says so in `notes`.
 */
import { copperLayers, recordsOfKind, zoneFillInputHash, type BoardDocument, type BoardSnapshot, type CopperLayer, type DerivedZoneFill } from "@protoboardai/board";
import { collectBoardShapes } from "./collect.js";
import { boxesMeet } from "./shapes.js";
import { globalInputsHash, polygonsHash, recordHash, type FillInputs } from "./zones.js";

export type StaleReason = "no-fill" | "zone-removed" | "zone-changed" | "zones-changed" | "inputs-changed" | "new-copper" | "dependency-changed" | "rules-changed";

export interface StaleZone {
  zone: string;
  layer?: CopperLayer;
  reason: StaleReason;
  /** The records behind the reason (changed, removed or new ids), sorted. */
  ids?: string[];
}

export interface Staleness {
  /** True when no zone layer is stale. */
  current: boolean;
  stale: StaleZone[];
  notes: string[];
}

const docOf = (s: BoardSnapshot | BoardDocument): BoardDocument => ("doc" in s && (s as BoardSnapshot).doc ? (s as BoardSnapshot).doc : (s as BoardDocument));

/** Which zones' fills are stale for this board, and why. */
export function staleZones(source: BoardSnapshot | BoardDocument, fill: DerivedZoneFill | undefined, inputs?: FillInputs): Staleness {
  const doc = docOf(source);
  const stack = copperLayers(doc);
  const zones = recordsOfKind(doc, "zone");
  const stale: StaleZone[] = [];
  const notes: string[] = [];
  const allLayers = (reason: StaleReason) => {
    for (const z of zones) for (const l of z.layers) if (stack.includes(l)) stale.push({ zone: z.id, layer: l, reason });
  };
  if (!fill) {
    allLayers("no-fill");
    return { current: stale.length === 0, stale, notes };
  }
  if (!inputs || fill.source !== "computed" || inputs.inputHash !== fill.inputHash) {
    if (fill.inputHash !== zoneFillInputHash(doc)) allLayers("zones-changed");
    else {
      const have = new Set(fill.fills.map((f) => `${f.zone}\u0000${f.layer}`));
      for (const z of zones) for (const l of z.layers) if (stack.includes(l) && !have.has(`${z.id}\u0000${l}`)) notes.push(`${z.id} on ${l}: no fill polygons (empty, or not filled)`);
    }
    notes.push(fill.source === "computed" ? "no inputs record: copper changes under the zones are not tracked" : `fill from ${fill.source}: copper moved since it was saved is not tracked (as in the source tool until it refills)`);
    return { current: stale.length === 0, stale, notes };
  }
  if (globalInputsHash(doc, inputs.settings) !== inputs.global) {
    allLayers("rules-changed");
    return { current: false, stale, notes };
  }
  const entries = new Map(inputs.entries.map((e) => [`${e.zone}\u0000${e.layer}`, e]));
  const fillHash = new Map(inputs.entries.map((e) => [`${e.zone}\u0000${e.layer}`, e.fill]));
  const shapes = collectBoardShapes(doc);
  const zoneIds = new Set(zones.map((z) => z.id));
  for (const e of inputs.entries) if (!zoneIds.has(e.zone)) stale.push({ zone: e.zone, layer: e.layer, reason: "zone-removed" });
  // fills as stored, to compare dependencies against
  const stored = new Map(fill.fills.filter((f) => f.zone).map((f) => [`${f.zone}\u0000${f.layer}`, polygonsHash(f.polygons)]));
  for (const z of zones) {
    for (const l of z.layers) {
      if (!stack.includes(l)) continue;
      const key = `${z.id}\u0000${l}`;
      const e = entries.get(key);
      if (!e) {
        stale.push({ zone: z.id, layer: l, reason: "no-fill" });
        continue;
      }
      if (recordHash(doc, z.id) !== e.reads[z.id]) {
        stale.push({ zone: z.id, layer: l, reason: "zone-changed", ids: [z.id] });
        continue;
      }
      const changed = Object.entries(e.reads)
        .filter(([id, h]) => recordHash(doc, id) !== h)
        .map(([id]) => id)
        .sort();
      if (changed.length) {
        stale.push({ zone: z.id, layer: l, reason: "inputs-changed", ids: changed });
        continue;
      }
      const fresh = new Set<string>();
      for (const it of shapes.items) if (it.layers.includes(l) && boxesMeet(it.box, e.near) && !(it.record in e.reads)) fresh.add(it.record);
      for (const h of shapes.holes) if (boxesMeet(h.box, e.near) && !(h.record in e.reads)) fresh.add(h.record);
      for (const a of shapes.cutouts) if (boxesMeet(a.box, e.near) && !(a.id in e.reads)) fresh.add(a.id);
      for (const k of shapes.keepouts) if (k.layers.includes(l) && boxesMeet(k.box, e.near) && !(k.id in e.reads)) fresh.add(k.id);
      if (shapes.outline && !("outline" in e.reads)) fresh.add("outline");
      if (fresh.size) {
        stale.push({ zone: z.id, layer: l, reason: "new-copper", ids: [...fresh].sort() });
        continue;
      }
      const depIds = Object.entries(e.deps)
        .filter(([dz, h]) => (fillHash.get(`${dz}\u0000${l}`) ?? stored.get(`${dz}\u0000${l}`)) !== h)
        .map(([dz]) => dz);
      // a higher-priority zone of another net that now overlaps but was not kept clear of
      for (const o of zones) {
        if (o.id === z.id || !o.layers.includes(l) || o.id in e.deps) continue;
        const before = o.priority > z.priority || (o.priority === z.priority && o.id < z.id);
        if (!before || (z.net !== undefined && o.net === z.net)) continue;
        const oe = entries.get(`${o.id}\u0000${l}`);
        if (oe && oe.fill !== polygonsHash([]) && boxesMeet(oe.near, e.near) && !(o.id in e.reads)) depIds.push(o.id);
      }
      if (depIds.length) stale.push({ zone: z.id, layer: l, reason: "dependency-changed", ids: depIds.sort() });
    }
  }
  return { current: stale.length === 0, stale, notes };
}
