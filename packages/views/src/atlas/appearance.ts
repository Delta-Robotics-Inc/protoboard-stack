/**
 * The Atlas's look, as each person chooses it (the Appearance popover):
 * whether nodes take their kind's color, and each kind's color and shape.
 * Pure, so the tests check it directly; type-only imports of the component
 * library, as palette.ts explains.
 *
 * A kind's color is one of the theme's tokens offered as swatches
 * (`SWATCH_TOKENS`, so it follows light and dark), or a custom `#rrggbb`
 * (the same in every theme). Unset, a kind keeps its default (`KIND_STYLE`).
 * Stored per person in the browser (local storage, `protoboard.atlas:ui`,
 * field `appearance`), never in the project; read with `parseAppearance`,
 * which keeps only valid values.
 */
import type { ThemeToken } from "@deltarobotics/uhd-viewer/components";
import { ATLAS_KIND_ORDER, type AtlasKind } from "@protoboardai/core/atlas";
import { KIND_STYLE, SHAPES, type AtlasLook, type Shape } from "./palette.js";

/** A kind's color: a swatch token, or a custom "#rrggbb". */
export type KindColor = ThemeToken | `#${string}`;

export interface AtlasAppearance {
  /** Nodes in their kind's color (else every node a neutral gray, hubs a step stronger). */
  colorByType: boolean;
  /** Per kind, what differs from its default (the Atlas's kinds, or the System Map's item types). */
  kinds: Partial<Record<string, { color?: KindColor; shape?: Shape }>>;
}

export const DEFAULT_APPEARANCE: AtlasAppearance = { colorByType: true, kinds: {} };

/**
 * The swatches the popover offers, from the theme's text and data tokens, by
 * hue (grays first). The accent and the oranges next to it are left out:
 * orange is the hover's and the selection's.
 */
export const SWATCH_TOKENS = [
  "text",
  "textMuted",
  "textFaint",
  "signalGround",
  "domainMechanical",
  "signalCan",
  "signalAnalog",
  "domainSoftware",
  "signalUart",
  "domainPneumatic",
  "signalDigital",
  "domainHydraulic",
  "domainNetwork",
  "signalRf",
  "signalSpi",
  "domainThermal",
] as const satisfies readonly ThemeToken[];

/** The shape presets: every kind a hexagon (the default), or the earlier mapping by type. */
export const SHAPE_PRESETS = {
  hexagons: Object.fromEntries(ATLAS_KIND_ORDER.map((k) => [k, "hex"])) as Record<AtlasKind, Shape>,
  "by-type": {
    module: "hex",
    part: "dot",
    concept: "square",
    render: "square",
    photo: "square",
    image: "square",
    model: "dot",
    cad: "dot",
    board: "diamond",
    doc: "dot",
    data: "dot",
    firmware: "dot",
    other: "dot",
  } satisfies Record<AtlasKind, Shape>,
} as const;

export type ShapePreset = keyof typeof SHAPE_PRESETS;

/**
 * The kinds an appearance is kept for, each kind's default shape and color,
 * and the shape presets: the Atlas's (`ATLAS_KIND_TABLE`, the default of
 * every function here), or another graph's (the System Map's item types,
 * sysmap/model.ts), whose appearance is kept apart.
 */
export interface KindTable {
  order: readonly string[];
  style: Record<string, { shape: Shape; token: ThemeToken }>;
  presets: Record<string, Record<string, Shape>>;
  /** Whether nodes take their kind's color until the person says (default true; the System Map starts neutral, as its approved design). */
  colorByType?: boolean;
}

/** The appearance before the person changes anything (Reset puts it back). */
export const defaultAppearance = (t: KindTable = ATLAS_KIND_TABLE): AtlasAppearance => ({ colorByType: t.colorByType ?? true, kinds: {} });

export const ATLAS_KIND_TABLE: KindTable = { order: ATLAS_KIND_ORDER, style: KIND_STYLE, presets: SHAPE_PRESETS };

const HEX = /^#[0-9a-f]{6}$/i;
const isShape = (s: unknown): s is Shape => typeof s === "string" && (SHAPES as readonly string[]).includes(s);
export const isKindColor = (c: unknown): c is KindColor => typeof c === "string" && (HEX.test(c) || (SWATCH_TOKENS as readonly string[]).includes(c));

/** An appearance from stored data: anything not valid is dropped (an unknown kind, shape or color, a wrong type). */
export function parseAppearance(raw: unknown, t: KindTable = ATLAS_KIND_TABLE): AtlasAppearance {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultAppearance(t);
  const v = raw as { colorByType?: unknown; kinds?: unknown };
  const kinds: AtlasAppearance["kinds"] = {};
  if (v.kinds && typeof v.kinds === "object" && !Array.isArray(v.kinds)) {
    for (const [k, entry] of Object.entries(v.kinds as Record<string, unknown>)) {
      if (!t.order.includes(k) || !entry || typeof entry !== "object") continue;
      const e = entry as { color?: unknown; shape?: unknown };
      const out: { color?: KindColor; shape?: Shape } = {};
      if (isKindColor(e.color)) out.color = (HEX.test(e.color) ? e.color.toLowerCase() : e.color) as KindColor;
      if (isShape(e.shape)) out.shape = e.shape;
      if (out.color || out.shape) kinds[k] = out;
    }
  }
  return { colorByType: v.colorByType === undefined ? (t.colorByType ?? true) : v.colorByType !== false, kinds };
}

/** A kind's color as chosen (its default token when unset). */
export const kindColor = (a: AtlasAppearance, k: string, t: KindTable = ATLAS_KIND_TABLE): KindColor => a.kinds[k]?.color ?? t.style[k]?.token ?? "textFaint";

/** A kind's shape as chosen (its default when unset). */
export const kindShape = (a: AtlasAppearance, k: string, t: KindTable = ATLAS_KIND_TABLE): Shape => a.kinds[k]?.shape ?? t.style[k]?.shape ?? "hex";

/** Every kind's shape. */
export const shapesOf = (a: AtlasAppearance, t: KindTable = ATLAS_KIND_TABLE): Record<string, Shape> => Object.fromEntries(t.order.map((k) => [k, kindShape(a, k, t)]));

/** What the palette draws with (palette.ts `paletteFrom`). */
export const lookOf = (a: AtlasAppearance, t: KindTable = ATLAS_KIND_TABLE): AtlasLook => ({
  colorByType: a.colorByType,
  colors: Object.fromEntries(t.order.map((k) => [k, kindColor(a, k, t)])),
  shapes: shapesOf(a, t),
});

/** The preset the shapes match, if any. */
export function presetOf(a: AtlasAppearance, t: KindTable = ATLAS_KIND_TABLE): ShapePreset | null {
  const shapes = shapesOf(a, t);
  for (const [name, preset] of Object.entries(t.presets)) {
    if (t.order.every((k) => shapes[k] === preset[k])) return name as ShapePreset;
  }
  return null;
}

/** One kind changed (`undefined` puts a field back to its default); an entry left empty is dropped. */
export function withKind(a: AtlasAppearance, k: string, patch: { color?: KindColor | undefined; shape?: Shape | undefined }, t: KindTable = ATLAS_KIND_TABLE): AtlasAppearance {
  const next = { ...a.kinds[k], ...patch };
  if (next.color === undefined || next.color === t.style[k]?.token) delete next.color;
  if (next.shape === undefined || next.shape === t.style[k]?.shape) delete next.shape;
  const kinds = { ...a.kinds };
  if (next.color || next.shape) kinds[k] = next;
  else delete kinds[k];
  return { ...a, kinds };
}

/** A shape preset applied to every kind (the colors kept). */
export function withPreset(a: AtlasAppearance, preset: string, t: KindTable = ATLAS_KIND_TABLE): AtlasAppearance {
  const shapes = t.presets[preset];
  if (!shapes) return a;
  let out: AtlasAppearance = a;
  for (const k of t.order) out = withKind(out, k, { shape: shapes[k] }, t);
  return out;
}
