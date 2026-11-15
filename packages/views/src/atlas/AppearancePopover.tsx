/**
 * The Atlas's Appearance popover: "Color by type", the shape presets, and
 * per kind a color (a row of the theme's swatches, or a custom color from
 * the native picker) and a shape; Reset puts everything back. It opens above
 * the toolbar from its palette button and closes on Escape, a press
 * elsewhere or the button. What it changes is the person's own (local
 * storage, settings.ts), never the project's.
 *
 * Built from the view's primitives: the legend card (`Legend`) as the
 * popover, `ToggleGroup` for the presets and shapes, the inspector's
 * `ActionButton` for Reset. The swatches and the switch have no primitive,
 * so they are drawn here with the theme's tokens.
 */
import { useEffect, useRef } from "react";
import { Legend, ScrollArea, ToggleGroup, cx, token, type ThemeToken } from "@deltarobotics/uhd-viewer/components";
import { ATLAS_KINDS } from "@protoboardai/core/atlas";
import { ATLAS_KIND_TABLE, SWATCH_TOKENS, defaultAppearance, kindColor, kindShape, presetOf, withKind, withPreset, type AtlasAppearance, type KindColor, type KindTable, type ShapePreset } from "./appearance.js";
import { ActionButton } from "./Inspector.js";
import type { Shape } from "./palette.js";

/** Each swatch's name (its tooltip and accessible name). */
const SWATCH_NAME: Record<(typeof SWATCH_TOKENS)[number], string> = {
  text: "Neutral, strongest",
  textMuted: "Neutral, medium",
  textFaint: "Neutral, faint",
  signalGround: "Stone",
  domainMechanical: "Slate",
  signalCan: "Yellow",
  signalAnalog: "Lime",
  domainSoftware: "Green",
  signalUart: "Teal",
  domainPneumatic: "Cyan",
  signalDigital: "Sky",
  domainHydraulic: "Indigo",
  domainNetwork: "Violet",
  signalRf: "Fuchsia",
  signalSpi: "Pink",
  domainThermal: "Rose",
};

const SHAPE_OPTIONS = [
  { id: "hex", icon: "hexagon", label: "Hexagon" },
  { id: "square", icon: "square", label: "Square" },
  { id: "diamond", icon: "diamond", label: "Diamond" },
  { id: "dot", icon: "circle", label: "Dot" },
] as const satisfies readonly { id: Shape; icon: string; label: string }[];

export const PRESET_OPTIONS = [
  { id: "hexagons", icon: "hexagon", label: "All hexagons" },
  { id: "by-type", icon: "shapes", label: "Shapes by type: modules hexagons, images squares, board files diamonds, the rest dots" },
] as const satisfies readonly { id: ShapePreset; icon: string; label: string }[];

/** A kind color as CSS: a token's variable, or the custom color itself. */
export const kindCss = (c: KindColor): string => (c.startsWith("#") ? c : token(c as ThemeToken));

/** A kind's shape as a small SVG glyph, in its color (the popover's rows). */
export function KindGlyph({ shape, color, size = 12 }: { shape: Shape; color: string; size?: number }) {
  const h = size / 2;
  const path =
    shape === "hex"
      ? Array.from({ length: 6 }, (_, i) => {
          const a = i * (Math.PI / 3) + Math.PI / 6;
          return `${(h + Math.cos(a) * h).toFixed(2)},${(h + Math.sin(a) * h).toFixed(2)}`;
        }).join(" ")
      : shape === "diamond"
        ? `${h},0 ${size},${h} ${h},${size} 0,${h}`
        : "";
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {shape === "dot" ? <circle cx={h} cy={h} r={h * 0.9} fill={color} /> : shape === "square" ? <rect x={size * 0.08} y={size * 0.08} width={size * 0.84} height={size * 0.84} rx={size * 0.2} fill={color} /> : <polygon points={path} fill={color} />}
    </svg>
  );
}

/**
 * Classes that turn a legend row's swatch (`LegendItem`'s dot) into a
 * kind's shape: the left panel's kind list draws the shapes chosen here.
 */
export const LEGEND_SHAPE: Record<Shape, string> = {
  hex: "[&_.uhd-legend-item>span:first-child]:size-[9px] [&_.uhd-legend-item>span:first-child]:rounded-none [&_.uhd-legend-item>span:first-child]:[clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)]",
  square: "[&_.uhd-legend-item>span:first-child]:rounded-[2px]",
  diamond: "[&_.uhd-legend-item>span:first-child]:rounded-none [&_.uhd-legend-item>span:first-child]:rotate-45 [&_.uhd-legend-item>span:first-child]:scale-[0.85]",
  dot: "",
};

export interface AppearancePopoverProps {
  appearance: AtlasAppearance;
  onChange(next: AtlasAppearance): void;
  /** The kinds this project has, in order (only those get a row). */
  kinds: readonly string[];
  /** Each kind's color as drawn now (`#rrggbb`): the custom picker starts from it. */
  resolved: Record<string, string>;
  onClose(): void;
  className?: string;
  /** The kinds' defaults and presets (the Atlas's by default; the System Map passes its item types'). */
  table?: KindTable;
  /** A kind's name in its row (the Atlas's kind labels by default). */
  kindName?(kind: string): string;
  /** The shape presets offered (the Atlas's by default). */
  presets?: readonly { id: string; icon: string; label: string }[];
}

export function AppearancePopover({ appearance, onChange, kinds, resolved, onClose, className, table = ATLAS_KIND_TABLE, kindName = (k) => ATLAS_KINDS[k as keyof typeof ATLAS_KINDS]?.label ?? k, presets = PRESET_OPTIONS }: AppearancePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  // the keyboard goes into the popover when it opens
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, []);
  const preset = presetOf(appearance, table);
  return (
    <Legend
      ref={ref}
      role="dialog"
      aria-label="Appearance"
      title="Appearance"
      className={cx("w-[min(352px,calc(100vw-16px))]", className)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span id="pb-atlas-bytype" className="text-[11px] text-fg">
          Color by type
        </span>
        <Switch labelledBy="pb-atlas-bytype" checked={appearance.colorByType} onChange={(on) => onChange({ ...appearance, colorByType: on })} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg">Shapes</span>
        <ToggleGroup label="Shape preset" size="sm" tooltipSide="top" options={presets} value={(preset ?? "") as ShapePreset} onChange={(p) => onChange(withPreset(appearance, p, table))} />
      </div>
      <div className="h-px bg-line" aria-hidden />
      <ScrollArea className="-mr-2 max-h-[min(360px,calc(100vh-220px))]" contentClassName="flex flex-col gap-2.5 pr-2">
        {kinds.map((k) => {
          const color = kindColor(appearance, k, table);
          const shape = kindShape(appearance, k, table);
          const name = kindName(k);
          return (
            <div key={k} role="group" aria-label={name} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <KindGlyph shape={shape} color={appearance.colorByType ? kindCss(color) : token("textFaint")} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg">{name}</span>
                <ToggleGroup label={`${name}: shape`} size="sm" tooltipSide="top" options={SHAPE_OPTIONS} value={shape} onChange={(s) => onChange(withKind(appearance, k, { shape: s }, table))} />
              </div>
              <div role="radiogroup" aria-label={`${name}: color`} className={cx("flex flex-wrap items-center gap-[2px] pl-5", !appearance.colorByType && "opacity-55")}>
                {SWATCH_TOKENS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={color === t}
                    aria-label={SWATCH_NAME[t]}
                    data-tooltip={SWATCH_NAME[t]}
                    data-tooltip-side="top"
                    onClick={() => onChange(withKind(appearance, k, { color: t }, table))}
                    className={cx(
                      "size-[14px] shrink-0 cursor-pointer rounded-[3px] border border-line p-0 outline-offset-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus",
                      color === t && "outline outline-[1.5px] outline-fg",
                    )}
                    style={{ background: token(t) }}
                  />
                ))}
                <input
                  type="color"
                  aria-label={`${name}: custom color`}
                  data-tooltip="Custom color"
                  data-tooltip-side="top"
                  value={color.startsWith("#") ? color : resolved[k]}
                  onChange={(e) => onChange(withKind(appearance, k, { color: e.target.value.toLowerCase() as KindColor }, table))}
                  className={cx(
                    "ml-1 size-[14px] shrink-0 cursor-pointer rounded-[3px] border border-line bg-transparent p-0 outline-offset-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus [&::-webkit-color-swatch]:rounded-[2px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0",
                    color.startsWith("#") && "outline outline-[1.5px] outline-fg",
                  )}
                />
              </div>
            </div>
          );
        })}
      </ScrollArea>
      <div className="h-px bg-line" aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-fg-muted">Kept in this browser, for you only</span>
        <ActionButton icon="rotate-ccw" label="Reset" onClick={() => onChange(defaultAppearance(table))} />
      </div>
    </Legend>
  );
}

/** An on/off switch (no primitive has one): a track and a knob in the theme's tokens, `role="switch"`. */
function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange(on: boolean): void; labelledBy: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-4 w-7 shrink-0 cursor-pointer rounded-full border p-0 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus",
        checked ? "border-accent bg-accent" : "border-line bg-sunken",
      )}
    >
      <span aria-hidden className={cx("absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-[left] duration-150 motion-reduce:transition-none", checked ? "left-[13px] bg-on-accent" : "left-[2px] bg-fg-muted")} />
    </button>
  );
}
