/**
 * Cost drivers a profile reports: counts from the board and its part data, and what each implies at that fab, in
 * words. No prices: fees change and are not read live here.
 */
import { copperLayers, padsOf, recordsOfKind, viaLayers, type BoardDocument } from "@protoboardai/board";
import type { BomLine } from "./assembly.js";
import { mmText } from "./format.js";
import { flattenContour } from "./geom.js";
import type { Hole } from "./drill.js";
import type { FabProfile } from "./profiles.js";

export interface CostDriver {
  id: string;
  title: string;
  /** The count or value found on this board. */
  value: string;
  /** What it implies at this fab, in words. */
  implication: string;
}

/** Vias whose center lies on a pad of a footprint on a layer the via reaches. */
export function viasInPads(doc: BoardDocument): string[] {
  const stack = copperLayers(doc);
  const pads = recordsOfKind(doc, "footprint").flatMap((fp) => padsOf(fp, stack));
  const out: string[] = [];
  for (const v of recordsOfKind(doc, "via")) {
    const span = viaLayers(doc, v.from_layer, v.to_layer);
    if (pads.some((p) => p.layers.some((l) => span.includes(l)) && v.x >= p.box.minX && v.x <= p.box.maxX && v.y >= p.box.minY && v.y <= p.box.maxY)) out.push(v.id);
  }
  return out;
}

export function costDrivers(doc: BoardDocument, profile: FabProfile, lines: BomLine[], holes: Hole[], maskColor: string): CostDriver[] {
  const out: CostDriver[] = [];
  const active = lines.filter((l) => !l.dnp && !l.hand);
  const stack = copperLayers(doc);
  if (profile.id === "jlcpcb") {
    const ext = active.filter((l) => l.libraryClass === "extended");
    const unknown = active.filter((l) => !l.libraryClass && !l.consigned);
    out.push({
      id: "extended",
      title: "Extended part types",
      value: `${ext.length}${ext.length ? ` (${ext.flatMap((l) => l.refs).slice(0, 8).join(", ")}${ext.flatMap((l) => l.refs).length > 8 ? ", ..." : ""})` : ""}${unknown.length ? `; ${unknown.length} lines with no library class in the part data` : ""}`,
      implication: "each Extended part type adds a loading fee per order at JLCPCB (see its fee schedule; not read live here); Basic parts do not",
    });
  }
  const tht = active.filter((l) => l.process === "tht" || l.process === "mixed");
  if (tht.length) out.push({ id: "tht", title: "Through-hole parts", value: `${tht.flatMap((l) => l.refs).length} (${tht.flatMap((l) => l.refs).slice(0, 8).join(", ")})`, implication: "a hand or wave soldering step on top of SMT assembly" });
  const bottom = active.filter((l) => l.sides.includes("bottom"));
  if (bottom.length) out.push({ id: "bottom", title: "Parts on the bottom side", value: String(bottom.flatMap((l) => l.refs).length), implication: "a second side of assembly" });
  const web = profile.limits.maskWeb ? (profile.limits.maskWeb[maskColor] ?? profile.limits.maskWeb["*"]) : undefined;
  out.push({ id: "mask", title: `${maskColor[0].toUpperCase()}${maskColor.slice(1)} solder mask`, value: maskColor === profile.maskColorDefault ? "the fab's default color" : `not the default (${profile.maskColorDefault})`, implication: web !== undefined ? `minimum mask web ${mmText(web, 2)} mm at this color` : "the fab states no web minimum by color" });
  const vip = viasInPads(doc);
  if (vip.length) out.push({ id: "via-in-pad", title: "Vias in pads", value: String(vip.length), implication: "via-in-pad needs filled and capped vias, an extra fabrication process" });
  const spans = new Set(holes.filter((h) => h.fn === "ViaDrill" && (h.span[0] !== stack[0] || h.span[1] !== stack[stack.length - 1])).map((h) => `${h.span[0]}-${h.span[1]}`));
  if (spans.size) out.push({ id: "blind-buried", title: "Blind or buried via spans", value: [...spans].join(", "), implication: "blind and buried vias need sequential lamination; confirm the fab offers them" });
  const outline = doc.records.get("outline");
  if (outline?.kind === "outline") {
    const pts = flattenContour(outline.outline, 1000);
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    out.push({ id: "size", title: "Board size class", value: `${mmText(w, 1)} x ${mmText(h, 1)} mm, ${w <= 100e6 && h <= 100e6 ? "within 100 x 100 mm" : "larger than 100 x 100 mm"}`, implication: "fabs price by area and panel use; the quote decides" });
  }
  out.push({ id: "layers", title: "Copper layers", value: String(stack.length), implication: stack.length > 2 ? "multilayer: a laminated stackup" : "a standard two-layer process" });
  if (profile.id === "circuithub") {
    const big = holes.filter((h) => h.fn === "ViaDrill" && h.d > 300_000);
    out.push({ id: "via-fill", title: "Vias over 0.3 mm", value: String(big.length), implication: big.length ? "CircuitHub fills vias over 0.3 mm with epoxy or resin rather than mask" : "every via can be filled with mask" });
    const board = doc.records.get("board");
    const copper = recordsOfKind(doc, "layer").filter((l) => l.type === "copper");
    const nonDefault = (board?.kind === "board" && board.thickness !== 1_600_000) || copper.some((l) => l.copper_weight_oz !== undefined && l.copper_weight_oz !== 1) || recordsOfKind(doc, "layer").some((l) => l.type === "dielectric" && l.material && !/fr-?4/i.test(l.material));
    out.push({ id: "stackup", title: "Stackup", value: nonDefault ? "not CircuitHub's default (1.6 mm, 1 oz, FR4)" : "CircuitHub's default (1.6 mm, 1 oz, FR4)", implication: nonDefault ? "a non-standard stackup or material goes to manual review" : "quoted automatically" });
  }
  return out;
}
