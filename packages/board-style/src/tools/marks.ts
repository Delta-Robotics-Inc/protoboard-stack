/**
 * Logos and marks from the asset registry: the maker mark, the company mark, an open hardware mark (only when the
 * call says the board is released as open hardware), the easter egg (at most `marks.easterEgg.max`) and the motto,
 * on `marks.side`. `brand.mode` decides which apply: house (all), client (the maker mark only; no company mark, motto
 * or easter egg), neutral (none). Sizes stay within the asset's limits and keep its smallest feature at or above the
 * silk line. Assets whose license is unresolved are refused unless the call allows them; traced assets are noted.
 */
import { type BoardDocument, type Side } from "@protoboardai/board";
import { assetUsable, loadAssets, readAsset, type LoadedAsset } from "../assets.js";
import { changeSet, ignoredByTool, type Desired, type Skipped, type StyleChangeSet } from "../changeset.js";
import { keyhole, nm, simplifyRing, type Ring } from "../geom.js";
import { tok, tokNum, type ResolvedStyle } from "../resolve.js";
import { BoardSpace, ringShape } from "../space.js";
import type { AssetSlot } from "../tokens.js";
import { boardPoint, cased, findSpot, reverseRing, silkClearances, silkLayer, textBox, textClassNm, textShape, vertices, type DrawOptions } from "./common.js";
import { edgeTextActive } from "./edge-text.js";

export interface MarksOptions extends DrawOptions {
  /** The board is released as open hardware (draws the open hardware mark). */
  openHardware?: boolean;
  /** Draw assets whose license is unresolved (never for a shipped theme). */
  allowUnresolved?: boolean;
  /** Where to place marks, by slot, as fractions of the board box seen from the side (default: corners). */
  anchors?: Partial<Record<AssetSlot | "motto", [number, number]>>;
}

const ANCHORS: Record<AssetSlot | "motto", [number, number]> = { maker: [0.2, 0.25], company: [0.8, 0.25], oshw: [0.2, 0.75], easterEgg: [0.85, 0.8], motto: [0.5, 0.15] };

export function styleMarks(doc: BoardDocument, style: ResolvedStyle, o: MarksOptions = {}): StyleChangeSet {
  const mode = tok<string>(style, "brand.mode");
  const side = tok<string>(style, "marks.side") as Side;
  const layer = silkLayer(side);
  const skipped: Skipped[] = [];
  const notes: string[] = [];
  const desired: Desired[] = [];
  if (mode === "neutral") return changeSet("marks", "No marks (brand mode neutral)", "remove board marks", doc, [], { notes: ["brand.mode is neutral"], ...(o.force ? { force: true } : {}) });
  const assets = loadAssets(style.places);
  const space = new BoardSpace(doc, { ignoreSilk: ignoredByTool(doc, "marks") });
  const clr = silkClearances(style, { silk: true, courtyard: true });
  const minLine = nm(style.fab.silk.minLine.value);
  const slots: AssetSlot[] = mode === "client" ? ["maker"] : ["maker", "company", "oshw", "easterEgg"];
  if (mode === "client") notes.push("brand.mode client: the maker mark only (no company mark, motto or easter egg)");
  const placed: { slot: string; asset?: string; text?: string; at: { x: number; y: number }; height: number }[] = [];
  for (const slot of slots) {
    const id = tok<string>(style, `marks.${slot}`);
    if (id === "none") continue;
    if (slot === "oshw" && !o.openHardware) {
      skipped.push({ what: `marks.oshw (${id})`, reason: "the call did not say the board is released as open hardware" });
      continue;
    }
    if (slot === "easterEgg" && tokNum(style, "marks.easterEgg.max") < 1) continue;
    const a = assets.get(id);
    const why = assetUsable(a, o);
    if (why) {
      skipped.push({ what: `marks.${slot} (${id})`, reason: why });
      continue;
    }
    const entry = (a as LoadedAsset).entry;
    if (entry.traced) notes.push(`${id} was traced from an image, not taken from a vector file`);
    if (entry.status === "placeholder") notes.push(`${id} is a placeholder: register your own mark and point marks.${slot} at it`);
    const file = readAsset(a!);
    let h = nm(tokNum(style, slot === "easterEgg" ? "marks.easterEgg.height" : "marks.height"));
    h = Math.min(Math.max(h, nm(entry.minHeight)), nm(entry.maxHeight));
    if (entry.minFeature * h < minLine) h = Math.ceil(minLine / entry.minFeature / 10_000) * 10_000;
    if (h > nm(entry.maxHeight)) {
      skipped.push({ what: `marks.${slot} (${id})`, reason: `its smallest feature needs a height over its ${entry.maxHeight} mm limit to print` });
      continue;
    }
    const w = Math.round(h * file.aspect);
    const spot = findSpot(space, side, w + 2 * clr.pad, h + 2 * clr.pad, boardPoint(space, side, ...(o.anchors?.[slot] ?? ANCHORS[slot])), clr);
    if (!spot) {
      skipped.push({ what: `marks.${slot} (${id})`, reason: `no free ${(w / 1e6).toFixed(1)} x ${(h / 1e6).toFixed(1)} mm spot on the ${side}` });
      continue;
    }
    const [cx, cy] = spot;
    const map = (x: number, y: number): [number, number] => {
      const lx = (x - file.aspect / 2) * h;
      return [Math.round(cx + (side === "bottom" ? -lx : lx)), Math.round(cy + (y - 0.5) * h)];
    };
    for (const p of file.polygons) {
      const ring = (r: number[]): Ring => {
        const out: number[] = [];
        for (let i = 0; i < r.length; i += 2) out.push(...map(r[i], r[i + 1]));
        return out;
      };
      let outer = ring(p.outer);
      let holes = (p.holes ?? []).map(ring);
      if (side === "bottom") {
        outer = reverseRing(outer);
        holes = holes.map(reverseRing);
      }
      const contour = simplifyRing(keyhole({ outer, holes }));
      desired.push({ kind: "graphic", layer, shape: "polygon", points: vertices(pairs(contour)), stroke_width: 0, filled: true });
    }
    space.addSilk(`mark:${slot}`, side, [ringShape([cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2])]);
    placed.push({ slot, asset: id, at: { x: cx, y: cy }, height: h });
  }
  // the motto, unless the edge ring carries it
  const motto = tok<string>(style, "marks.motto");
  const ringHasMotto = edgeTextActive(doc, style) && tok<string[]>(style, "edgeText.items").some((t) => t.includes("${MOTTO}"));
  if (motto && mode === "house" && !ringHasMotto) {
    const { height, stroke, cls } = textClassNm(style, "type.class.mark");
    const text = cased(motto, cls);
    const box = textBox(text, height, stroke);
    const spot = findSpot(space, side, box.w, box.h, boardPoint(space, side, ...(o.anchors?.motto ?? ANCHORS.motto)), clr);
    if (spot) {
      desired.push({ kind: "text", layer, text, x: spot[0], y: spot[1], height, stroke_width: stroke, anchor: "center", ...(side === "bottom" ? { mirrored: true as const } : {}) });
      space.addSilk("motto", side, [textShape(spot[0], spot[1], box.w, box.h)]);
      placed.push({ slot: "motto", text, at: { x: spot[0], y: spot[1] }, height });
    } else skipped.push({ what: "marks.motto", reason: `no free spot on the ${side} for it` });
  }
  return changeSet("marks", `Place ${placed.length} mark${placed.length === 1 ? "" : "s"} on the ${side}`, "place logos and marks", doc, desired, { skipped, notes, report: { placed }, ...(o.force ? { force: true } : {}) });
}

const pairs = (r: Ring): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
  return out;
};
