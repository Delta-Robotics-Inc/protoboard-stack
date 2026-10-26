/**
 * Icons the views need that Lucide does not have, drawn on Lucide's grid
 * (24 px, a 2 px round stroke, no fill) so they sit beside Lucide's in a tab
 * strip, and `ViewIcon`, which draws a view's icon by name: one of these, else
 * the Lucide icon of that name.
 */
import type { SVGProps } from "react";
import { Icon } from "@deltarobotics/uhd-viewer/components";

/** The schematic view's icon: a resistor, the schematic symbol everyone reads (the PCB view has the circuit board). */
import { SCHEMATIC_ICON } from "./tabs.js";

export { SCHEMATIC_ICON };

/** Each custom icon's paths, in a 24 × 24 box. */
export const CUSTOM_ICONS: Record<string, readonly string[]> = {
  [SCHEMATIC_ICON]: ["M2 12h2.5l1.5-4 3 8 3-8 3 8 3-8 1.5 4H22"],
};

type IconProps = {
  name: string;
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
} & Omit<SVGProps<SVGSVGElement>, "name" | "ref">;

/** A view's icon by name: a custom one (CUSTOM_ICONS), else Lucide's. */
export function ViewIcon({ name, size = 24, strokeWidth = 2, absoluteStrokeWidth, className, ...rest }: IconProps) {
  const paths = CUSTOM_ICONS[name];
  if (!paths)
    return (
      <Icon
        name={name}
        size={Number(size)}
        strokeWidth={Number(strokeWidth)}
        absoluteStrokeWidth={absoluteStrokeWidth}
        className={className}
        {...(rest as object)}
      />
    );
  const sw = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["lucide", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A custom icon as an SVG document in one colour (for hosts that need a file, such as an editor tab's icon). */
export function customIconSvg(name: string, color: string): string | undefined {
  const paths = CUSTOM_ICONS[name];
  if (!paths) return undefined;
  const c = color.replace(/[^#a-zA-Z0-9(),.% ]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}
