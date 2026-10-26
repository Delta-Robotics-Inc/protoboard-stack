/**
 * Builders for the quadcopter's mounting hardware: standard ISO fasteners,
 * standoffs and spacers bought from a supplier, and the screws, nut and
 * grommets that ship with the parts they fix (PB-775, PB-836).
 *
 * Each part is a project-researched purchased part with its own file
 * (parts/local/<id>.uhd.ts, citing its sources) and its evidence in
 * parts/evidence/<id>/. None is in the cloud catalog yet (searched
 * 2026-10-03: `protoboard parts search` for screw, nyloc, spacer, standoff,
 * nut, grommet); `protoboard parts publish` promotes one once someone with
 * the publish token agrees. Each body is a nominal shape generated through
 * the `cad` capability: a cad.config.ts in parts/local/<id>/ names
 * @protoboardai/ext-frame-cad (`protoboard run cad:generate`, `cad:export
 * --module <id>`, or `run hardware-cad` for all of them).
 *
 * Not a source file (no .uhd.ts): the definitions are the part files.
 */
import type { MaterialSpec, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { connectorTrait, fastenerDiameterMm } from "@deltarobotics/uhd";
import { hardwareCadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

/** The part's provider directory: its cad.config.ts, native params (frame-cad/) and body (out/). */
const cad = (id: string) => hardwareCadArtifacts({ dir: `parts/local/${id}`, name: id });

/**
 * Materials for mass = CAD volume × density (PB-797) where no supplier
 * states a weight. The bodies are the generator's nominal shapes (ISO 4762
 * head with hex socket and a plain shank at 0.95 d; hex nut with its bore),
 * so every computed mass is an assumption.
 */
export const A2: MaterialSpec = {
  name: "A2 (304 / 1.4301) stainless steel",
  density_g_cm3: 8.0,
  source: "https://www.thyssenkrupp-materials.co.uk/stainless-steel-304-14301.html",
  assumption: "Volume is the generator's nominal shape (plain shank, no thread form), not a measured part.",
};
export const A2_UNSTATED: MaterialSpec = {
  ...A2,
  assumption: "The maker does not state the material; steel (A2 density) and the generator's nominal shape are assumed.",
};
export const A2_NYLOC: MaterialSpec = {
  ...A2,
  assumption: "Nominal hex nut shape with the nylon insert counted as steel (a slight over-estimate); not a measured part.",
};
export const RUBBER: MaterialSpec = {
  name: "Silicone rubber (assumed)",
  density_g_cm3: 1.15,
  assumption: "DolphinRC calls the grommets 'Rubber' and states no compound, size or weight; 1.15 g/cm³ is an unsourced estimate for a soft silicone rubber, on the nominal tube shape. The few tenths of a gram this gives do not move the all-up weight.",
};

/** A supplier listing that was fetched and checked (fastener research 2026-09-26, re-fetched 2026-10-03). */
export interface Supplier {
  name: string;
  partNumber: string;
  url: string;
  title: string;
  packQuantity?: number;
  note?: string;
  /** Mass per piece as the supplier's datasheet states it (PB-797). */
  weight?: { g: number; source: string; quote: string };
}

const supplierTraits = (sup?: Supplier): TraitDef[] =>
  sup
    ? [
        { type: "usage_note", params: { note: `Supplier listing: ${sup.title} (${sup.name} ${sup.partNumber}).${sup.note ? " " + sup.note : ""}`, source: sup.url } },
        ...(sup.packQuantity ? [{ type: "performance", params: { kind: "packaging", pack_quantity: sup.packQuantity, source: sup.url } }] : []),
      ]
    : [];

/** Where research looked for a manufacturer model (verify-part asks for it on a generated body). */
const cadGap = (where: string): TraitDef => ({
  type: "data_gap",
  params: { fields: ["manufacturer CAD"], note: `No manufacturer model: ${where}. The body is the nominal shape @protoboardai/ext-frame-cad generates from the part's sizes.` },
});

/** Ships with another part: the BOM lists it without a purchase. */
const included = (partId: string, quote: string, source: string): TraitDef[] => [
  { type: "usage_note", params: { note: `Ships with ${partId}: ${quote}`, included_with: partId, source } },
];

export interface ScrewSpec {
  id: string;
  size: 2 | 3;
  length: number;
  name: string;
  head: { dk: number; k: number; source: string };
  includedWith?: { part: string; quote: string; source: string };
  supplier?: Supplier;
  why: string;
}

export function screw(s: ScrewSpec): ModuleDef {
  return {
    id: s.id,
    name: s.name,
    kind: "module",
    version: "0.1.0",
    manufacturer: s.includedWith ? "Included (unbranded)" : "Generic (ISO 4762 / DIN 912)",
    part_number: s.supplier?.partNumber ?? `ISO 4762 M${s.size}x${s.length}`,
    description: `ISO 4762 socket head cap screw M${s.size} x ${s.length} mm (head Ø${s.head.dk} x ${s.head.k} mm). ${s.why}`,
    tags: ["standard-part", "fastener", "screw", `m${s.size}`, "iso-4762"],
    categories: ["mechanical.fastener.screw"],
    interfaces: [
      {
        id: "thread",
        name: `M${s.size} external thread, ${s.length} mm`,
        domain: "mechanical",
        exposed: true,
        default_active: true,
        protocols: [{ type: "custom", roles: ["peer"] }],
        capabilities: ["fastener", "external_thread"],
        parameters: [fastenerDiameterMm(s.size), { id: "length", unit: "mm", value: s.length }],
        traits: [connectorTrait("metric_thread_external", { gender: "male" })],
      },
    ],
    domains: [
      {
        domain: "mechanical",
        dimensions_mm: { length: s.length + s.head.k, width: s.head.dk, height: s.head.dk },
        material: s.includedWith ? A2_UNSTATED : A2,
        metadata: { head_diameter_mm: s.head.dk, head_height_mm: s.head.k, standard: "ISO 4762", source: s.head.source },
      },
    ],
    traits: [
      { type: "assumption", params: { field: "length", value: `${s.length} mm`, reason: s.why } },
      ...supplierTraits(s.supplier),
      ...(s.includedWith
        ? [
            ...included(s.includedWith.part, s.includedWith.quote, s.includedWith.source),
            { type: "data_gap", params: { fields: ["screw length", "head size"], note: "The maker includes the screws but states neither their length nor their head; the length is chosen for the stack-up and the head is ISO 4762 nominal." } },
          ]
        : []),
      cadGap(s.includedWith ? `${s.includedWith.part}'s maker publishes none for its screws` : `${s.supplier?.name ?? "the supplier"} offers none; the standard defines the shape`),
    ],
    artifacts: [...(s.supplier ? [{ id: "supplier_listing", name: s.supplier.title, type: "documentation" as const, url: s.supplier.url }] : []), ...cad(s.id)],
  };
}

export interface HexPartSpec {
  id: string;
  name: string;
  kind: "nut" | "spacer" | "standoff";
  size: 2 | 3 | 5;
  length: number;
  od: number;
  threaded: boolean;
  /** Bore the maker states (mm); otherwise the generator's nominal bore (a spacer's d + 0.4). */
  bore?: number;
  material: string;
  manufacturer?: string;
  partNumber?: string;
  supplier?: Supplier;
  includedWith?: { part: string; quote: string; source: string };
  /** Material for mass from CAD volume when the supplier states no weight. */
  massMaterial?: MaterialSpec;
  /** Extra tags (e.g. "grommet", "prop-nut"). */
  tags?: string[];
  why: string;
  /** Sizes not stated by the source, with the reason. */
  gaps?: { fields: string[]; note: string };
}

export function hexPart(o: HexPartSpec): ModuleDef {
  return {
    id: o.id,
    name: o.name,
    kind: "module",
    version: "0.1.0",
    manufacturer: o.supplier?.name ?? o.manufacturer ?? "Generic",
    part_number: o.supplier?.partNumber ?? o.partNumber ?? o.name,
    description: `${o.name}. ${o.why}`,
    tags: ["standard-part", "fastener", o.kind, `m${o.size}`, ...(o.tags ?? [])],
    // a nut is a fastener; spacers, standoffs and grommets are mounting hardware (as the catalog files its spacer)
    categories: [o.kind === "nut" ? "mechanical.fastener.nut" : "mechanical.mounting"],
    interfaces: [
      {
        id: o.kind === "nut" ? "thread" : "bore",
        name: o.threaded ? `M${o.size} internal thread` : `Ø${o.bore ?? o.size + 0.4} mm bore`,
        domain: "mechanical",
        exposed: true,
        default_active: true,
        protocols: [{ type: "custom", roles: ["peer"] }],
        capabilities: o.threaded ? ["fastener", "internal_thread"] : ["fastener"],
        parameters: [fastenerDiameterMm(o.size), { id: "length", unit: "mm", value: o.length }],
        traits: [connectorTrait(o.threaded ? "metric_thread_internal" : "clearance_bore", { gender: "female" })],
      },
    ],
    domains: [
      {
        domain: "mechanical",
        dimensions_mm: { length: o.od, width: o.od, height: o.length },
        ...(o.supplier?.weight ? { weight_g: o.supplier.weight.g } : {}),
        ...(o.massMaterial && !o.supplier?.weight ? { material: o.massMaterial } : {}),
        metadata: { outer_mm: o.od, ...(o.bore ? { bore_mm: o.bore } : {}), material: o.material, ...(o.supplier?.weight ? { source: o.supplier.weight.source, weight_quote: o.supplier.weight.quote } : {}) },
      },
    ],
    traits: [
      { type: "assumption", params: { field: "part choice", value: o.name, reason: o.why } },
      ...supplierTraits(o.supplier),
      ...(o.includedWith ? included(o.includedWith.part, o.includedWith.quote, o.includedWith.source) : []),
      ...(o.gaps ? [{ type: "data_gap", params: o.gaps }] : []),
      cadGap(o.includedWith ? `${o.includedWith.part}'s maker publishes none for it` : `${o.supplier?.name ?? "the supplier"} offers none`),
    ],
    artifacts: [...(o.supplier ? [{ id: "supplier_listing", name: o.supplier.title, type: "documentation" as const, url: o.supplier.url }] : []), ...cad(o.id)],
  };
}

export const WESTFIELD_ISO_4762 = {
  m3: { dk: 5.5, k: 3.0, source: "https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/Stainless-Socket-Cap-Screw-M3x8mm.html" },
  m2: { dk: 3.8, k: 2.0, source: "https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/304-DIN-912-Cap-Screw-M2x12mm.html" },
} as const;
