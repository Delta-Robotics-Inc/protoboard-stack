/**
 * Assembly materials the watch needs that are neither parts with pins nor
 * fasteners (review of PB-829/830): the tapes that hold the cell, the LRA,
 * the display and the covers in place (docs/decisions.md D-W6, D-W16).
 *
 * They are specified by what the design needs (thickness, kind, size), not
 * yet by product: no supplier is chosen (OQ-W17). Each is a BOM line so the
 * kit and the ordering list carry it, and the assembly guide's steps place
 * them (docs/docspec.ts).
 */
import type { ModuleDef } from "@deltarobotics/uhd";

function material(o: { id: string; name: string; description: string; dims?: { length: number; width: number; height: number }; spec: string; why: string; quantity?: string }): ModuleDef {
  return {
    id: o.id,
    name: o.name,
    kind: "module",
    version: "0.1.0",
    // no manufacturer: no product is chosen yet (OQ-W17); the data_gap below says so
    description: o.description,
    categories: ["mechanical.mounting"],
    tags: ["consumable", "adhesive", "assembly-material"],
    display: { icon: "layers" },
    interfaces: [],
    ...(o.dims ? { domains: [{ domain: "mechanical" as const, dimensions_mm: o.dims }] } : {}),
    traits: [
      { type: "assumption", params: { field: "specification", value: o.spec, reason: o.why } },
      { type: "usage_note", params: { topic: "assembly", note: `${o.description}${o.quantity ? ` ${o.quantity}` : ""}` } },
      { type: "data_gap", params: { fields: ["product", "supplier"], note: "Specified by thickness and kind only; no product is chosen yet (OQ-W17)." } },
    ],
  };
}

export const WATCH_CELL_FOAM = material({
  id: "watch-cell-foam-pad",
  name: "Cell foam pad, 0.25 mm double-sided",
  description: "Double-sided closed-cell foam pad, 0.25 mm, cut to 20 × 30 mm: holds the cell on the display's rear face.",
  dims: { length: 30, width: 20, height: 0.25 },
  spec: "0.25 mm double-coated closed-cell foam (PE or PU), acrylic adhesive, die-cut to the cell's 20 × 30 mm face",
  why: "The stack puts the cell 0.25 mm behind the display (D-W6, D-W15); a compliant pad holds it without a hard point on the display's back and takes up some of the cell's swelling.",
});

export const WATCH_LRA_PAD = material({
  id: "watch-lra-adhesive-pad",
  name: "LRA adhesive pad, 0.25 mm, ø8 mm",
  description: "Double-sided adhesive pad, 0.25 mm, ø8 mm: bonds the LRA's can face to the inside of the back cover.",
  dims: { length: 8, width: 8, height: 0.25 },
  spec: "0.25 mm double-coated acrylic adhesive (a firm transfer tape, not foam), die-cut ø8 mm to the VG0832012's can",
  why: "A firm bond couples the LRA's Z-axis vibration into the back cover and the wrist (the VG0832012 vibrates along its Z axis, normal to the can face; D-W6). Foam would damp it.",
});

export const WATCH_DISPLAY_ADHESIVE = material({
  id: "watch-display-adhesive-ring",
  name: "Display adhesive ring, 0.25 mm",
  description: "Double-sided tape ring, 0.25 mm, 34.0 mm inside and 35.6 mm outside diameter: bonds the display's front rim to the case floor around the window.",
  dims: { length: 35.6, width: 35.6, height: 0.25 },
  spec: "0.25 mm double-coated tape (thin foam or acrylic carrier), die-cut ring ID 34.0 / OD 35.6 mm, outside the 33.4 mm visual area",
  why: "The display's viewing face sits 0.25 mm behind the case floor (cad.config.ts cavity); the ring fills that gap and bonds the display there (D-W6) outside the visual area (ER-TFT1.28-1 §2.2), leaving the panel unstressed (§6.1).",
});

export const WATCH_COVER_ADHESIVE = material({
  id: "watch-cover-adhesive",
  name: "Clear UV-curing adhesive for the window covers",
  description: "Clear UV-curing acrylic adhesive, a bead at the rim of the lens and of the heart-rate cover in their pockets.",
  spec: "clear, low-viscosity UV-curing acrylic adhesive for PMMA to PETG, applied at the cover's rim only (about 0.05 ml per watch)",
  why: "The covers sit flush on the pockets' ledges (the pockets are as deep as the covers), so no film goes under them; a rim bead holds them (D-W16).",
});

export const MATERIALS = [WATCH_CELL_FOAM, WATCH_LRA_PAD, WATCH_DISPLAY_ADHESIVE, WATCH_COVER_ADHESIVE];
