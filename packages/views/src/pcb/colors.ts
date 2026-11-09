/**
 * Board colors. Board colors are for copper, mask and silkscreen only; the inactive copper layer is gray; blue is
 * selection and nothing else. The values follow the viewer's dark scene (uhd-viewer theme.css: scene background
 * #131313, ink #d4d4d4) and the layout concept's board tokens, mixed toward the ground the way the concept does
 * (`color-mix(in oklab, <hue> 78%, #131313)`), precomputed here as sRGB.
 */

export type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const toHex = (c: RGB): string => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;

/** The scene's ground (uhd-viewer `--uhd-scene-background`). */
export const GROUND = hex("#131313");

export interface LayerStyle {
  color: RGB;
  alpha: number;
}

/** Copper hues by layer: top red, bottom blue, inner layers muted olive, violet, teal and slate. */
const COPPER: Record<string, string> = {
  top: "#a13e35",
  bottom: "#3c5f8f",
  inner1: "#8a7a2e",
  inner2: "#77508a",
  inner3: "#2f7a72",
  inner4: "#5f63a6",
  inner5: "#8a5a3a",
  inner6: "#4f7f3a",
  inner7: "#7a3f5f",
  inner8: "#5a6f80",
};

export const BOARD_COLORS = {
  ground: GROUND,
  board: hex("#1b1b1a"),
  /** Copper on a layer that is not the active one, when the inactive-gray option is on (the concept's CU INACTIVE). */
  inactive: hex("#3d4046"),
  pad: hex("#b18738"),
  padInactive: hex("#5e5233"),
  silk: hex("#d4d4d4"),
  silkBottom: hex("#9a9a9a"),
  edge: hex("#d4d4d4"),
  via: hex("#a7a7a2"),
  hole: hex("#131313"),
  keepout: hex("#ef4444"),
  fab: hex("#8a8a8a"),
  courtyard: hex("#6e6e6e"),
  mask: hex("#2f7a4a"),
  paste: hex("#8c8c8c"),
  notes: hex("#a3a3a3"),
  ratsnest: hex("#e6e6e6"),
  labelOnPad: hex("#131313"),
  labelOnTrack: hex("#e6e6e6"),
  /** Selection and the active thing (the concept's selection token). */
  select: hex("#5aa9ff"),
  hover: hex("#e6e6e6"),
  grid: hex("#2a2a2a"),
  gridMajor: hex("#3a3a3a"),
};

export const copperColor = (layer: string): RGB => hex(COPPER[layer] ?? "#808080");

/** The style of a draw layer, given which copper layer is active and whether inactive copper is drawn gray. */
export function layerStyle(id: string, active: string, grayInactive: boolean): LayerStyle {
  if (id.startsWith("cu:")) {
    const l = id.slice(3);
    if (l === active) return { color: copperColor(l), alpha: 0.92 };
    return grayInactive ? { color: BOARD_COLORS.inactive, alpha: 0.85 } : { color: copperColor(l), alpha: 0.6 };
  }
  const side = id.endsWith(":bottom") ? "bottom" : "top";
  const activeSide = active === "bottom" ? "bottom" : active === "top" ? "top" : undefined;
  switch (id.split(":")[0]) {
    case "board":
      return { color: BOARD_COLORS.board, alpha: 1 };
    case "pads":
      return activeSide && side !== activeSide && grayInactive ? { color: BOARD_COLORS.padInactive, alpha: 1 } : { color: BOARD_COLORS.pad, alpha: 1 };
    case "silk":
      return side === "top" ? { color: BOARD_COLORS.silk, alpha: 0.9 } : { color: BOARD_COLORS.silkBottom, alpha: 0.55 };
    case "mask":
      return { color: BOARD_COLORS.mask, alpha: 0.45 };
    case "paste":
      return { color: BOARD_COLORS.paste, alpha: 0.5 };
    case "fab":
      return { color: BOARD_COLORS.fab, alpha: side === "top" ? 0.7 : 0.4 };
    case "crtyd":
      return { color: BOARD_COLORS.courtyard, alpha: side === "top" ? 0.9 : 0.5 };
    case "vias":
      return { color: BOARD_COLORS.via, alpha: 1 };
    case "holes":
      return { color: BOARD_COLORS.hole, alpha: 1 };
    case "keepout":
      return { color: BOARD_COLORS.keepout, alpha: 0.75 };
    case "notes":
      return { color: BOARD_COLORS.notes, alpha: 0.7 };
    case "edge":
      return { color: BOARD_COLORS.edge, alpha: 1 };
    case "ratsnest":
      return { color: BOARD_COLORS.ratsnest, alpha: 0.45 };
    case "labels":
      return id === "labels:pads" ? { color: BOARD_COLORS.labelOnPad, alpha: 0.85 } : { color: BOARD_COLORS.labelOnTrack, alpha: 0.8 };
    default:
      return { color: [0.6, 0.6, 0.6], alpha: 0.8 };
  }
}

/** The swatch a Layers panel row shows. */
export function groupSwatch(group: string, active: string, grayInactive: boolean): string {
  if (group.startsWith("cu:")) return toHex(layerStyle(group, active, grayInactive).color);
  const map: Record<string, RGB> = {
    "silk:top": BOARD_COLORS.silk,
    "silk:bottom": BOARD_COLORS.silkBottom,
    "mask:top": BOARD_COLORS.mask,
    "mask:bottom": BOARD_COLORS.mask,
    pads: BOARD_COLORS.pad,
    vias: BOARD_COLORS.via,
    outline: BOARD_COLORS.edge,
    crtyd: BOARD_COLORS.courtyard,
    fab: BOARD_COLORS.fab,
    paste: BOARD_COLORS.paste,
    keepout: BOARD_COLORS.keepout,
    ratsnest: BOARD_COLORS.ratsnest,
    labels: BOARD_COLORS.labelOnTrack,
  };
  return toHex(map[group] ?? [0.5, 0.5, 0.5]);
}
