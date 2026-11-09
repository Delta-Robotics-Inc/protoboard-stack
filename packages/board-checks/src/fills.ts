/**
 * Zone fill, derived data (contract section 4.3): the copper a zone actually has, per zone and per copper layer,
 * as polygons with holes in integer nanometers (+Y up, board coordinates). The board document stores only the
 * zone's intent; an importer that reads stored fills (KiCad's `filled_polygon`) or a future fill engine produces
 * this structure, and the checks accept it as an optional input.
 *
 * The shape this package expects (`ZoneFillSet`):
 *
 * ```ts
 * [
 *   { zone: "zone:g.1a2b3c4d5e6f", layer: "inner1",
 *     polygons: [ { outline: [{ x, y }, ...], holes: [[{ x, y }, ...], ...] }, ...] },
 *   ...
 * ]
 * ```
 *
 * - one entry per zone and copper layer that has fill (a zone on two layers has two entries);
 * - `outline` and each hole are closed implicitly (the last point is not repeated; a repeated one is dropped);
 * - points may carry `sweep` (an arc to the next point, millidegrees), which is flattened to 0.5 micrometers;
 * - winding does not matter (containment is even-odd);
 * - a zone with an entry is filled exactly as given; a zone with no entry has no known fill and is treated as
 *   not connecting anything (the result says which zones).
 *
 * `normalizeFills` also accepts, without a conversion step:
 *
 * - the board importer's derived fill (`protoboard.zone-fill/v1` from `@protoboardai/board-import`): an object with
 *   `fills: [{ zone?, source, net?, layer, polygons: [{ outer: [x0, y0, x1, y1, ...], holes: [[...], ...] }] }]`,
 *   rings as flat nanometer arrays. An entry without `zone` (a Circuit JSON copper pour with no zone record) is
 *   copper of its `net` with the id `fill:<source>`;
 * - a record keyed by zone id then layer (`{ "zone:x": { top: [polygon, ...] } }`), or a `Map` of the same;
 * - polygons given as `[outline, ...holes]` arrays of points.
 */
import type { CopperLayer, Vertex } from "@protoboardai/board";

export interface FillPolygon {
  outline: Vertex[];
  holes?: Vertex[][];
}
/** A polygon as flat nanometer rings (the importer's form): kept flat, never converted to points. */
export interface FlatFillPolygon {
  outer: number[];
  holes?: number[][];
}
export interface ZoneFill {
  /** The zone record's id, or `fill:<source>` for fill without a zone record. */
  zone: string;
  layer: CopperLayer;
  /** The net of fill without a zone record (a zone's fill takes its zone's net). */
  net?: string;
  polygons: (FillPolygon | FlatFillPolygon)[];
}
export type ZoneFillSet = ZoneFill[];

type PolygonInput = FillPolygon | FlatFillPolygon | Vertex[][];
/** The importer's derived fill file (only the fields read here). */
export interface DerivedFillInput {
  schema?: string;
  fills: readonly { zone?: string; source?: string; net?: string; layer: string; polygons: readonly FlatFillPolygon[] }[];
}
export type ZoneFillInput =
  | DerivedFillInput
  | readonly ZoneFill[]
  | Readonly<Record<string, Readonly<Record<string, readonly PolygonInput[]>>>>
  | ReadonlyMap<string, ReadonlyMap<string, readonly PolygonInput[]> | Readonly<Record<string, readonly PolygonInput[]>>>;

function toPolygon(p: PolygonInput): FillPolygon | FlatFillPolygon {
  if (Array.isArray(p)) {
    const [outline, ...holes] = p as Vertex[][];
    return { outline: outline ?? [], holes };
  }
  if ("outer" in p) return { outer: p.outer, holes: p.holes ?? [] };
  return { outline: p.outline, holes: p.holes ?? [] };
}

const isDerived = (x: unknown): x is DerivedFillInput => !!x && typeof x === "object" && !Array.isArray(x) && !(x instanceof Map) && Array.isArray((x as DerivedFillInput).fills);

/** The fills in one form: entries sorted by zone id then layer, polygons in their given order. */
export function normalizeFills(input: ZoneFillInput | undefined): ZoneFillSet | undefined {
  if (!input) return undefined;
  const out: ZoneFill[] = [];
  if (isDerived(input)) {
    for (const f of input.fills) {
      const zone = f.zone ?? `fill:${f.source ?? "unnamed"}`;
      out.push({ zone, layer: f.layer as CopperLayer, ...(!f.zone && f.net ? { net: f.net } : {}), polygons: f.polygons.map(toPolygon) });
    }
  } else if (Array.isArray(input)) {
    for (const f of input as ZoneFill[]) out.push({ zone: f.zone, layer: f.layer, ...(f.net ? { net: f.net } : {}), polygons: f.polygons.map(toPolygon) });
  } else {
    const entries = input instanceof Map ? [...input.entries()] : Object.entries(input as Record<string, unknown>);
    for (const [zone, layers] of entries) {
      const le = layers instanceof Map ? [...layers.entries()] : Object.entries(layers as Record<string, PolygonInput[]>);
      for (const [layer, polys] of le) out.push({ zone, layer: layer as CopperLayer, polygons: (polys as PolygonInput[]).map(toPolygon) });
    }
  }
  for (const f of out) {
    if (typeof f.zone !== "string" || !(f.zone.startsWith("zone:") || f.zone.startsWith("fill:"))) throw new Error(`zone fill entry names ${JSON.stringify(f.zone)}, not a zone id`);
    for (const p of f.polygons) {
      if ("outer" in p) {
        for (const r of [p.outer, ...(p.holes ?? [])]) if (!Array.isArray(r) || r.length % 2 || !r.every(Number.isFinite)) throw new Error(`zone fill of ${f.zone} on ${f.layer} has a ring that is not x, y numbers`);
        continue;
      }
      if (!Array.isArray(p.outline)) throw new Error(`zone fill of ${f.zone} on ${f.layer} has a polygon without an outline`);
      for (const v of [...p.outline, ...(p.holes ?? []).flat()])
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) throw new Error(`zone fill of ${f.zone} on ${f.layer} has a point that is not a number`);
    }
  }
  out.sort((a, b) => (a.zone < b.zone ? -1 : a.zone > b.zone ? 1 : a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));
  return out;
}
