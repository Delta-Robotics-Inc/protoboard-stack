/**
 * The box a stored record covers on the sheet, in grid units (+Y down) as `[x0, y0, x1, y1]`: what a query by
 * region meets and what a region lease covers. Symbols take their full placed box (body, pins and fields), labels
 * and power symbols their glyph and text, wires the bounds of their points, cards and frames their own box, text its
 * anchor, a no-connect mark its pin. Records with no place (the schematic record, proposals) have none.
 */
import type { SchematicDocument } from "./document.ts";
import { geometryOf, labelBox, powerBoxes, unionBoxes } from "./geometry.ts";
import type { SchematicRecord } from "./schema.ts";
import type { LBox } from "./symbols.ts";

export type GuBox = [number, number, number, number];

const r = (v: number) => Math.round(v * 100) / 100;
const of = (b: LBox): GuBox => [r(b.x0), r(b.y0), r(b.x1), r(b.y1)];

export function recordBox(doc: SchematicDocument, rec: SchematicRecord): GuBox | undefined {
  switch (rec.kind) {
    case "symbol": {
      const p = geometryOf(doc).symbols.get(rec.id);
      return p ? of(p.full) : [rec.x, rec.y, rec.x, rec.y];
    }
    case "card":
    case "frame":
      return [rec.x, rec.y, rec.x + rec.w, rec.y + rec.h];
    case "wire": {
      const xs = rec.points.map((p) => p[0]);
      const ys = rec.points.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    case "label":
      return of(unionBoxes([labelBox(rec, doc), { x0: rec.x, y0: rec.y, x1: rec.x, y1: rec.y }]));
    case "power": {
      const b = powerBoxes(rec, doc);
      return of(unionBoxes([b.glyph, ...(b.text ? [b.text] : []), { x0: rec.x, y0: rec.y, x1: rec.x, y1: rec.y }]));
    }
    case "text":
      return [rec.x, rec.y, rec.x, rec.y];
    case "noconnect": {
      const p = geometryOf(doc).pins.get(rec.pin);
      return p ? [p.at[0], p.at[1], p.at[0], p.at[1]] : undefined;
    }
    default:
      return undefined;
  }
}

/** Whether two boxes meet (touching counts). */
export const guBoxesMeet = (a: GuBox, b: GuBox): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
