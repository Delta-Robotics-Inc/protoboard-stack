/**
 * Leases on a schematic (contract section 10, after the board core's section 9.5). The board's lease table is
 * generic (actors, fencing tokens, roots, nets, a region box), so the schematic uses it as is; what is the
 * schematic's own is what a record covers:
 *
 * - a symbol: its part's UHD instance path; a no-connect mark: its pin's part;
 * - a card: its group (the UHD sub-module path, "" at the board's root);
 * - a wire, label or power symbol: its card's group and its net; a text: its card's group;
 * - every placed record: its box in grid units (`recordBox`), for region leases (`{ minX, minY, maxX, maxY }`, +Y down).
 *
 * A lease root of "" covers the whole sheet; a person's edit inside an agent's lease revokes it.
 */
import { createLeaseTable, type Scope } from "@protoboardai/board";
import { splitPinKey } from "./circuit.ts";
import type { SchematicDocument } from "./document.ts";
import { recordBox } from "./record-box.ts";
import type { SchematicRecord } from "./schema.ts";

export { createLeaseTable };
export type { Box as LeaseBox, ClaimResult, EndedLease, Lease, LeaseClaim, LeaseRegion, LeaseTable, Scope } from "@protoboardai/board";

/** The group of the card a record sits in. */
function groupOf(doc: SchematicDocument, card: string | undefined): string[] {
  if (!card) return [];
  const c = doc.records.get(card);
  return c?.kind === "card" ? [c.group] : [];
}

/** What a record covers, for lease checks: UHD paths, nets and its box (grid units). */
export function scopeOf(doc: SchematicDocument, rec: SchematicRecord): Scope {
  const b = recordBox(doc, rec);
  const base = { id: rec.id, layers: [] as string[], ...(b ? { box: { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] } } : {}) };
  switch (rec.kind) {
    case "symbol":
      return { ...base, paths: [rec.part], nets: [] };
    case "card":
      return { ...base, paths: [rec.group], nets: [] };
    case "wire":
    case "label":
    case "power":
      return { ...base, paths: groupOf(doc, rec.card), nets: [rec.net] };
    case "noconnect": {
      const part = splitPinKey(rec.pin).part;
      return { ...base, paths: part ? [part] : [], nets: [] };
    }
    case "text":
      return { ...base, paths: groupOf(doc, rec.card), nets: [] };
    default:
      // frames cover only their box; the schematic record (settings) and proposals cover nothing
      return { ...base, paths: [], nets: [] };
  }
}
