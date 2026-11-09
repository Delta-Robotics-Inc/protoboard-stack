/**
 * Draw layers and what the Layers panel shows. A draw layer is one GPU group (one color, one opacity, composited
 * as a whole so overlaps inside it never double-blend). The panel's rows ("groups") switch draw layers on and off
 * together; presets set the rows at once. Order is bottom-most first for the top view and reversed for the
 * bottom view, with the active copper layer lifted above the other copper.
 */
import type { CopperLayer } from "./board.js";

export type DrawLayerId = string;

export interface DrawLayerDef {
  id: DrawLayerId;
  /** The board-side layer it shows: a copper layer name, `top` or `bottom` for side layers, or none. */
  copper?: CopperLayer;
  side?: "top" | "bottom";
  /** The panel row that switches it. */
  group: string;
}

/** Draw layer ids. */
export const cu = (l: string): DrawLayerId => `cu:${l}`;
export const SIDE_LAYERS = ["pads", "silk", "mask", "paste", "fab", "crtyd"] as const;
export type SideKind = (typeof SIDE_LAYERS)[number];
export const sideId = (kind: SideKind, side: "top" | "bottom"): DrawLayerId => `${kind}:${side}`;

/** Every draw layer of a board with these copper layers. */
export function drawLayers(copper: readonly CopperLayer[]): DrawLayerDef[] {
  const out: DrawLayerDef[] = [{ id: "board", group: "outline" }];
  for (const l of copper) out.push({ id: cu(l), copper: l, group: cu(l) });
  for (const side of ["top", "bottom"] as const) {
    out.push({ id: sideId("pads", side), side, group: "pads" });
    out.push({ id: sideId("silk", side), side, group: `silk:${side}` });
    out.push({ id: sideId("mask", side), side, group: `mask:${side}` });
    out.push({ id: sideId("paste", side), side, group: "paste" });
    out.push({ id: sideId("fab", side), side, group: "fab" });
    out.push({ id: sideId("crtyd", side), side, group: "crtyd" });
  }
  out.push(
    { id: "vias", group: "vias" },
    { id: "holes", group: "holes" },
    { id: "keepout", group: "keepout" },
    { id: "notes", group: "notes" },
    { id: "edge", group: "outline" },
    { id: "ratsnest", group: "ratsnest" },
    { id: "labels:tracks", group: "labels" },
    { id: "labels:pads", group: "labels" },
  );
  return out;
}

/** A row of the Layers panel. */
export interface LayerGroup {
  id: string;
  label: string;
  /** The short name a KiCad user knows (F.Cu, B.SilkS). */
  short: string;
  copper?: CopperLayer;
}

const COPPER_LABEL: Record<string, [string, string]> = {
  top: ["Top copper", "F.Cu"],
  bottom: ["Bottom copper", "B.Cu"],
};

/** The panel's rows, in the concept's order: copper first, then silk, mask, pads, outline, courtyard and the rest. */
export function layerGroups(copper: readonly CopperLayer[]): LayerGroup[] {
  const rows: LayerGroup[] = copper.map((l, i) => {
    const [label, short] = COPPER_LABEL[l] ?? [`Inner ${l.replace("inner", "")} copper`, `In${i}.Cu`];
    return { id: cu(l), label, short, copper: l };
  });
  rows.push(
    { id: "silk:top", label: "Top silk", short: "F.Silk" },
    { id: "silk:bottom", label: "Bottom silk", short: "B.Silk" },
    { id: "mask:top", label: "Top mask", short: "F.Mask" },
    { id: "mask:bottom", label: "Bottom mask", short: "B.Mask" },
    { id: "pads", label: "Pads and finish", short: "Pads" },
    { id: "vias", label: "Vias", short: "Vias" },
    { id: "outline", label: "Board outline", short: "Edge" },
    { id: "crtyd", label: "Courtyard", short: "CrtYd" },
    { id: "fab", label: "Fabrication", short: "Fab" },
    { id: "paste", label: "Paste", short: "Paste" },
    { id: "keepout", label: "Keep-outs", short: "Keep" },
    { id: "ratsnest", label: "Ratsnest", short: "Rats" },
    { id: "labels", label: "Net names", short: "Names" },
  );
  return rows;
}

export type PresetId = "all" | "routing" | "top" | "fab";
export const PRESETS: { id: PresetId; label: string; key: string }[] = [
  { id: "all", label: "All", key: "Alt+1" },
  { id: "routing", label: "Routing", key: "Alt+2" },
  { id: "top", label: "Top only", key: "Alt+3" },
  { id: "fab", label: "Fab check", key: "Alt+4" },
];

/** The rows a preset turns on (every other row off). */
export function presetGroups(preset: PresetId, copper: readonly CopperLayer[]): Set<string> {
  const allCopper = copper.map((l) => cu(l));
  const base = ["pads", "vias", "holes", "outline"];
  switch (preset) {
    case "all":
      return new Set([...allCopper, ...base, "silk:top", "silk:bottom", "mask:top", "mask:bottom", "crtyd", "fab", "paste", "keepout", "ratsnest", "labels", "notes"]);
    case "routing":
      return new Set([...allCopper, ...base, "silk:top", "keepout", "ratsnest", "labels"]);
    case "top":
      return new Set([cu("top"), ...base, "silk:top", "keepout", "ratsnest", "labels"]);
    case "fab":
      return new Set([...allCopper, ...base, "silk:top", "silk:bottom", "mask:top", "mask:bottom", "crtyd", "fab", "paste", "keepout"]);
  }
}

/** The default rows: the concept's L1 (copper, silk, mask off, pads, outline, courtyard, keep-outs, ratsnest). */
export function defaultGroups(copper: readonly CopperLayer[]): Set<string> {
  return new Set([...copper.map((l) => cu(l)), "pads", "vias", "holes", "outline", "silk:top", "silk:bottom", "crtyd", "keepout", "ratsnest", "labels", "notes"]);
}

/**
 * Draw order, bottom-most first: for the top view the bottom side's layers come first and the top side's last;
 * the bottom view is the mirror. The active copper layer (and its side's pads) is lifted above the other copper.
 */
export function drawOrder(copper: readonly CopperLayer[], active: CopperLayer, flipped: boolean): DrawLayerId[] {
  const near: "top" | "bottom" = flipped ? "bottom" : "top";
  const far: "top" | "bottom" = flipped ? "top" : "bottom";
  const stack = flipped ? [...copper] : [...copper].reverse(); // far copper first
  const others = stack.filter((l) => l !== active);
  const activeSide = active === "top" ? "top" : active === "bottom" ? "bottom" : undefined;
  const padsAfter = (l: CopperLayer) => (l === "top" ? [sideId("pads", "top")] : l === "bottom" ? [sideId("pads", "bottom")] : []);
  const copperOrder: DrawLayerId[] = [];
  for (const l of others) copperOrder.push(cu(l), ...padsAfter(l));
  copperOrder.push(cu(active), ...padsAfter(active));
  // pads of an inner active layer's sides keep their place; a side without its copper layer listed still draws its pads
  for (const s of ["top", "bottom"] as const) if (!copper.includes(s) && s !== activeSide) copperOrder.push(sideId("pads", s));
  return [
    "board",
    sideId("fab", far),
    sideId("crtyd", far),
    sideId("paste", far),
    sideId("mask", far),
    sideId("silk", far),
    ...copperOrder,
    "vias",
    "holes",
    sideId("mask", near),
    sideId("paste", near),
    sideId("silk", near),
    sideId("crtyd", near),
    sideId("fab", near),
    "keepout",
    "notes",
    "edge",
    "labels:tracks",
    "labels:pads",
    "ratsnest",
  ];
}

/** The draw layer of a drawing-layer name (graphics and text). */
export function drawLayerOf(layer: string): DrawLayerId {
  switch (layer) {
    case "top_silkscreen":
      return "silk:top";
    case "bottom_silkscreen":
      return "silk:bottom";
    case "top_soldermask":
      return "mask:top";
    case "bottom_soldermask":
      return "mask:bottom";
    case "top_paste":
      return "paste:top";
    case "bottom_paste":
      return "paste:bottom";
    case "top_fabrication":
      return "fab:top";
    case "bottom_fabrication":
      return "fab:bottom";
    case "top_courtyard":
      return "crtyd:top";
    case "bottom_courtyard":
      return "crtyd:bottom";
    case "edge_cuts":
      return "edge";
    case "user_notes":
      return "notes";
    default:
      return cu(layer);
  }
}

/** Which group (panel row) a draw layer belongs to. */
export function groupOf(defs: readonly DrawLayerDef[], id: DrawLayerId): string {
  return defs.find((d) => d.id === id)?.group ?? id;
}
