/**
 * Supplier part numbers for the board's components, from the sourcing data the
 * project already holds (no network), read through core's one offer reader
 * (`@protoboardai/core/offers`, PB-1033):
 *
 *   parts/offers.json                     the library's offers by part id (`protoboard parts offers`)
 *   parts/evidence/<part>/sourcing.json   the project's own sourcing record (ext-sourcing)
 *
 * A project part's own evidence comes first, a library part's library offers.
 * An offer counts for a component when it names no ordering code or the
 * component's own MPN (a series passive's offers are per value). Suppliers are
 * read into tscircuit's keys; LCSC first (JLCPCB assembles from LCSC's
 * C-numbers), then DigiKey and Mouser. They go into the generated source
 * (`supplierPartNumbers`), the BOM, the pick-and-place and the KiCad fields,
 * so a fab or a later KiCad export carries them.
 */
import type { BoardComponent } from "@protoboardai/core";
import { readProjectOffers, supplierNumbersOf, SUPPLIER_ORDER, type ProjectOffers, type SupplierNumbers } from "@protoboardai/core/offers";

export { supplierKey, type SupplierKey, type SupplierNumbers } from "@protoboardai/core/offers";

/** The offers a capability's project holds (its catalog folder says which parts are library parts). */
export const projectOffers = (project: { root: string; config: { catalog?: string } }): ProjectOffers => readProjectOffers(project.root, { catalog: project.config.catalog });

/** Supplier part numbers by instance (components with none are left out), LCSC first, each supplier's in precedence order. */
export function supplierNumbers(root: string, components: Pick<BoardComponent, "instance" | "part" | "mpn">[], offers: ProjectOffers = readProjectOffers(root)): Record<string, SupplierNumbers> {
  const out: Record<string, SupplierNumbers> = {};
  for (const c of components) {
    const n = supplierNumbersOf(offers.forPart(c.part), c.mpn);
    if (Object.keys(n).length) out[c.instance] = n;
  }
  return out;
}

/** The BOM and PnP columns: the first LCSC number, and every number as `supplier:number`. */
export function supplierColumns(n: SupplierNumbers | undefined): { lcsc: string; suppliers: string } {
  if (!n) return { lcsc: "", suppliers: "" };
  return { lcsc: n.lcsc?.[0] ?? "", suppliers: SUPPLIER_ORDER.flatMap((k) => (n[k] ?? []).map((s) => `${k}:${s}`)).join(" ") };
}
