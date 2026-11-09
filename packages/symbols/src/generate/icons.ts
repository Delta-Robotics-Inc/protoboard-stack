/**
 * Icons for code-built families, drawn to the same rules as the pack (24 px, 2 px stroke, 2 px clear, no fill).
 * A box's icon is computed: one stub per side that has pins.
 */
import type { BodyElement } from "../types.ts";
import type { Placement } from "./box.ts";

const P = (d: string, role: BodyElement["role"] = "body"): BodyElement => ({ el: "path", d, role });
const R = (x: number, y: number, width: number, height: number, rx = 2): BodyElement => ({ el: "rect", x, y, width, height, rx, role: "body" });
const C = (cx: number, cy: number, r: number): BodyElement => ({ el: "circle", cx, cy, r, role: "body" });

/** Generic IC: the box with one stub on each side that has pins. */
export function boxIcon(pl: Placement, mark: BodyElement[] = []): BodyElement[] {
  const has = (s: keyof Placement) => pl[s].some(Boolean);
  return [
    R(6, 6, 12, 12),
    ...(has("left") ? [P("M2 12h4")] : []),
    ...(has("right") ? [P("M18 12h4")] : []),
    ...(has("top") ? [P("M12 2v4")] : []),
    ...(has("bottom") ? [P("M12 18v4")] : []),
    ...mark,
  ];
}

/** Regulators, converters, chargers: the box with a flow arrow inside. */
export const regulatorMark = (): BodyElement[] => [P("M10 12h4"), P("m12 10 2 2-2 2")];

/** Microcontroller: a box with two pins on every side. */
export const mcuIcon = (): BodyElement[] => [R(6, 6, 12, 12), P("M9 2v4"), P("M15 2v4"), P("M9 18v4"), P("M15 18v4"), P("M2 9h4"), P("M2 15h4"), P("M18 9h4"), P("M18 15h4")];

/** Module or dev board: a board outline with header pins along each long side. */
export const moduleIcon = (): BodyElement[] => [R(4, 3, 16, 18), C(9, 8, 1), C(15, 8, 1), C(9, 16, 1), C(15, 16, 1)];

/** Pin header: a strip with three pins. */
export const headerIcon = (): BodyElement[] => [R(9, 3, 6, 18, 1), P("M3 7h6"), P("M3 12h6"), P("M3 17h6")];

/** Terminal block: a strip with screw heads. */
export const terminalIcon = (): BodyElement[] => [R(4, 4, 16, 16), C(12, 12, 3), P("M10 14l4-4")];

/** USB receptacle: the rounded slot with its tongue. */
export const usbIcon = (): BodyElement[] => [R(3, 7, 18, 10, 5), P("M8 12h8")];

/** Hierarchical sheet: a page with a folded corner and one port. */
export const sheetIcon = (): BodyElement[] => [P("M6 3h8l4 4v14H6z"), P("M2 13h4")];

/** DIP switch: a strip with two small levers. */
export const dipIcon = (): BodyElement[] => [R(4, 3, 16, 18), P("M8 9h8"), C(14, 9, 1), P("M8 15h8"), C(10, 15, 1)];

/** Hobby servo: a body with the output horn. */
export const servoIcon = (): BodyElement[] => [R(3, 9, 14, 10), C(10, 14, 2), P("M10 12V5h10")];
