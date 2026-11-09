/**
 * Crop helpers: the box to look at for an object, a net, a finding, and a grid of crops for a whole-board walkthrough.
 * Boxes are millimeters; pass one to `describeBoard` as `region`.
 */
import { toMm, type Finding } from "@protoboardai/board";
import { netBox, objectBox, type BoardModel } from "./model.js";
import { inflateBox, type BoxMm } from "./util.js";

/** The box of an object (footprint, pad, track, via, zone, keep-out, `net:<name>`) grown by `pad` mm. */
export function cropToObject(model: BoardModel, id: string, pad = 2): BoxMm {
  const b = objectBox(model, id);
  if (!b) throw new Error(`unknown object: ${id}`);
  return square(inflateBox(b, pad), 4);
}

/** The box of a net's pads, tracks and vias grown by `pad` mm. */
export function cropToNet(model: BoardModel, net: string, pad = 2): BoxMm {
  const b = netBox(model, net);
  if (!b) throw new Error(`net ${net} has nothing on the board`);
  return square(inflateBox(b, pad), 4);
}

/** The box of a finding (its box, else its location) grown by `pad` mm. */
export function cropToFinding(finding: Finding, pad = 2): BoxMm {
  const b = finding.box
    ? { minX: toMm(finding.box.minX), minY: toMm(finding.box.minY), maxX: toMm(finding.box.maxX), maxY: toMm(finding.box.maxY) }
    : { minX: toMm(finding.location.x), minY: toMm(finding.location.y), maxX: toMm(finding.location.x), maxY: toMm(finding.location.y) };
  return square(inflateBox(b, pad), 4);
}

/** Widen the shorter side so a crop is never thinner than `min` mm or more than 3:1. */
function square(b: BoxMm, min: number): BoxMm {
  let w = b.maxX - b.minX;
  let h = b.maxY - b.minY;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  w = Math.max(w, min, h / 3);
  h = Math.max(h, min, w / 3);
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

export interface Tile {
  /** `A1` is top left: letters are columns left to right, numbers rows top to bottom. */
  name: string;
  col: number;
  row: number;
  box: BoxMm;
}

/** A grid of crops over the board, `cols` by `rows` (default: tiles about `tile` mm, 15 mm), each overlapping by `overlap` mm. */
export function walkthroughTiles(model: BoardModel, options: { cols?: number; rows?: number; tile?: number; overlap?: number } = {}): Tile[] {
  const b = model.box;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const tile = options.tile ?? 15;
  const cols = options.cols ?? Math.max(1, Math.ceil(w / tile));
  const rows = options.rows ?? Math.max(1, Math.ceil(h / tile));
  const ov = options.overlap ?? 1;
  const tw = w / cols;
  const th = h / rows;
  const out: Tile[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const minX = b.minX + c * tw - ov;
      const maxY = b.maxY - r * th + ov;
      out.push({ name: `${String.fromCharCode(65 + (c % 26))}${r + 1}`, col: c, row: r, box: { minX, minY: maxY - th - 2 * ov, maxX: minX + tw + 2 * ov, maxY } });
    }
  return out;
}
