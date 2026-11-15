/**
 * The Atlas's colors and shapes, from the viewer's theme tokens only (no
 * color is named here, except a custom one a person picked), so the map
 * follows the Protoboard light and dark themes, VS Code's, and the
 * high-contrast ones. The canvas cannot read CSS variables: the view
 * resolves each token on its themed element (`tokenColor`, AtlasView.tsx's
 * `useAtlasPalette`) whenever the theme or the appearance changes, and hands
 * the result here. Type-only imports, so the renderer and its tests stay
 * free of the component library.
 */
import type { Theme, ThemeToken } from "@deltarobotics/uhd-viewer/components";
import { ATLAS_KIND_ORDER, type AtlasKind } from "@protoboardai/core/atlas";
import type { KindColor } from "./appearance.js";

export type Shape = "hex" | "square" | "dot" | "diamond";

/** The shapes a kind may take, in the order the popover offers them. */
export const SHAPES = ["hex", "square", "diamond", "dot"] as const satisfies readonly Shape[];

/**
 * Each kind's default shape and color token. Every kind is a hexagon, so the
 * color alone tells kinds apart: modules take the strongest neutral (the
 * text color), parts and other files the two grays below it, every other
 * kind a different hue. The accent (orange) is no kind's: it is reserved
 * for the hover and the selection, and the oranges next to it are left out
 * (signalPower, domainElectrical, and signalPwm, amber-brown in light).
 * The viewer's data tokens give signalI2c and domainNetwork the same violet,
 * signalPhase and domainThermal almost the same red, and domainOther almost
 * the canvas's own gray, so neither twin is used twice, nor domainOther at
 * all. The closest pairs left (their OKLab distance) are in docs/specs/atlas.md.
 */
export const KIND_STYLE: Record<AtlasKind, { shape: Shape; token: ThemeToken }> = {
  module: { shape: "hex", token: "text" },
  part: { shape: "hex", token: "textMuted" },
  concept: { shape: "hex", token: "signalCan" },
  render: { shape: "hex", token: "signalSpi" },
  photo: { shape: "hex", token: "signalAnalog" },
  image: { shape: "hex", token: "domainPneumatic" },
  model: { shape: "hex", token: "domainNetwork" },
  cad: { shape: "hex", token: "domainSoftware" },
  board: { shape: "hex", token: "signalRf" },
  doc: { shape: "hex", token: "domainHydraulic" },
  data: { shape: "hex", token: "signalDigital" },
  firmware: { shape: "hex", token: "domainThermal" },
  other: { shape: "hex", token: "textFaint" },
};

/** Each kind's Lucide icon (the inspector's preview glyph draws it inside a file outline). */
export const KIND_ICON: Record<AtlasKind, string> = {
  module: "box",
  part: "cpu",
  concept: "lightbulb",
  render: "aperture",
  photo: "camera",
  image: "image",
  model: "cuboid",
  cad: "pencil-ruler",
  board: "circuit-board",
  doc: "file-text",
  data: "table",
  firmware: "microchip",
  other: "file-question-mark",
};

/**
 * With "Color by type" off, every node is the neutral (`textFaint`) and the
 * well-linked hubs a step stronger (`textMuted`): the modules, and any node
 * with at least `HUB_DEGREE` links.
 */
export const HUB_DEGREE = 8;

/** The surface tokens the canvas draws with. */
export const SURFACE_TOKENS = ["canvas", "canvasDot", "text", "textMuted", "textFaint", "border", "accent", "accentHover", "surface", "contrastBorder"] as const satisfies readonly ThemeToken[];

export interface AtlasPalette {
  canvas: string;
  canvasDot: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  accent: string;
  /** The accent as text (the focused node's label): a step toward the text color, readable on the canvas. */
  accentHover: string;
  surface: string;
  contrastBorder: string;
  /** Each kind's color as chosen (Appearance), resolved: the Atlas's kinds, or the System Map's item types. */
  kinds: Record<string, string>;
  /** Each kind's shape as chosen. */
  shapes: Record<string, Shape>;
  /** Nodes take their kind's color; else `neutral`, hubs `hub`. */
  byType: boolean;
  neutral: string;
  hub: string;
  /** The label font family (the theme's monospace font). */
  font: string;
  /** A high-contrast theme: outlines replace fills. */
  highContrast: boolean;
}

/** What the person chose (appearance.ts `lookOf`): every kind's color and shape, and whether colors are by type. */
export interface AtlasLook {
  colorByType: boolean;
  /** Every kind the graph draws (its keys are the kinds the palette resolves). */
  colors: Record<string, KindColor>;
  shapes: Record<string, Shape>;
}

/** The defaults: every kind a hexagon in its token's color. */
export const DEFAULT_LOOK: AtlasLook = {
  colorByType: true,
  colors: Object.fromEntries(ATLAS_KIND_ORDER.map((k) => [k, KIND_STYLE[k].token])) as Record<AtlasKind, KindColor>,
  shapes: Object.fromEntries(ATLAS_KIND_ORDER.map((k) => [k, KIND_STYLE[k].shape])) as Record<AtlasKind, Shape>,
};

/** A palette from a token reader: the view's resolves on the themed element, the tests pass their own. */
export function paletteFrom(color: (token: ThemeToken) => string, font: string, highContrast: boolean, look: AtlasLook = DEFAULT_LOOK): AtlasPalette {
  const surface = Object.fromEntries(SURFACE_TOKENS.map((t) => [t, color(t)])) as Record<(typeof SURFACE_TOKENS)[number], string>;
  const kinds = Object.fromEntries(Object.entries(look.colors).map(([k, c]) => [k, resolveColor(c, color)])) as Record<string, string>;
  return { ...surface, kinds, shapes: { ...look.shapes }, byType: look.colorByType, neutral: surface.textFaint, hub: surface.textMuted, font, highContrast };
}

/** A kind color as the canvas draws it: a custom one as it is, a token resolved. */
export const resolveColor = (c: KindColor, color: (token: ThemeToken) => string): string => (c.startsWith("#") ? c : color(c as ThemeToken));

/** Whether a node is a hub (drawn a step stronger with "Color by type" off). */
export const isHub = (n: { kind: string; deg: number; hub?: boolean }): boolean => n.hub === true || n.kind === "module" || n.deg >= HUB_DEGREE;

/** The color a node is drawn in: its kind's, or the neutral (a hub's a step stronger). */
export const nodeColor = (p: AtlasPalette, n: { kind: string; deg: number; hub?: boolean }): string => (p.byType ? (p.kinds[n.kind] ?? p.neutral) : isHub(n) ? p.hub : p.neutral);

export const isHighContrast = (theme: Pick<Theme, "scheme">) => theme.scheme === "high-contrast" || theme.scheme === "high-contrast-light";
