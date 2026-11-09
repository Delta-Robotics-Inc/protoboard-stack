/**
 * Test helpers: KiCad's own pad positions computed straight from the file (the footprint's position plus the pad's
 * local position turned by the footprint's angle, KiCad's convention), to check the importer's footprint frame
 * against; and a save-and-reload through the core's file format.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deg, documentsEqual, loadBoardDir, normAngle, padsOf, type BoardDocument, type FootprintRec } from "@protoboardai/board";
import { saveImportedBoard, type BoardImportResult } from "../src/index.js";
import { isList, kid, kids, num, parseSexpr, str, xyOf } from "../src/sexpr.js";

export interface KicadPad {
  ref: string;
  number: string;
  /** World, nanometers, +Y up, before centering. */
  x: number;
  y: number;
  /** KiCad's absolute pad angle, millidegrees. */
  angle: number;
  shape: string;
}

/** Every pad of every footprint, footprint by footprint in file order, in KiCad's world turned +Y up. */
export function kicadWorldPads(text: string): KicadPad[][] {
  const root = parseSexpr(text);
  const out: KicadPad[][] = [];
  for (const fp of kids(root, "footprint")) {
    const at = kid(fp, "at");
    const [fx, fy] = xyOf(at) ?? [0, 0];
    const th = ((num(at?.[3]) || 0) * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const ref = str(kids(fp, "property").find((p) => str(p[1]) === "Reference")?.[2]) ?? str(kids(fp, "fp_text").find((t) => str(t[1]) === "reference")?.[2]) ?? "";
    const pads: KicadPad[] = [];
    for (const p of fp.filter(isList).filter((x) => x[0] === "pad")) {
      const pa = kid(p, "at");
      const [px, py] = xyOf(pa) ?? [0, 0];
      const wx = fx + px * c + py * s;
      const wy = fy - px * s + py * c;
      pads.push({ ref, number: str(p[1]) || "_", x: Math.round(wx * 1e6), y: -Math.round(wy * 1e6), angle: normAngle(deg(num(pa?.[3]) || 0)), shape: str(p[3]) ?? "" });
    }
    out.push(pads);
  }
  return out;
}

/**
 * The largest distance (nm) between an imported pad's world center and the KiCad pad of the same number in the same
 * footprint (file order), and the number of imported pads whose world angle differs from KiCad's (non-polygon pads).
 */
export function padWorldError(doc: BoardDocument, offset: { x: number; y: number }, kicad: KicadPad[][]): { maxNm: number; angleMismatches: number; checked: number } {
  const fps = [...doc.records.values()].filter((r): r is FootprintRec => r.kind === "footprint");
  let maxNm = 0;
  let angleMismatches = 0;
  let checked = 0;
  fps.forEach((fp, i) => {
    const kp = kicad[i] ?? [];
    for (const wp of padsOf(fp)) {
      const same = kp.filter((k) => k.number === wp.pad.number);
      if (!same.length) continue;
      const wx = wp.x + offset.x;
      const wy = wp.y + offset.y;
      let best = Infinity;
      let bestPad: KicadPad | undefined;
      for (const k of same) {
        const d = Math.hypot(k.x - wx, k.y - wy);
        if (d < best) {
          best = d;
          bestPad = k;
        }
      }
      checked++;
      if (best > maxNm) maxNm = best;
      if (bestPad && wp.pad.shape !== "polygon" && wp.pad.type !== "np") {
        // rectangles, ovals and rounded rectangles look the same turned half a turn; circles at any angle
        if (wp.pad.shape !== "circle" && normAngle(wp.rotation - bestPad.angle) % 180_000 !== 0) angleMismatches++;
      }
    }
  });
  return { maxNm, angleMismatches, checked };
}

/** Save the imported board through the core's file format, load it back, and say whether it is the same document. */
export function saveAndReload(result: BoardImportResult): { equal: boolean; doc: BoardDocument } {
  const dir = mkdtempSync(join(tmpdir(), "pb-board-import-"));
  try {
    saveImportedBoard(dir, result);
    const loaded = loadBoardDir(dir);
    return { equal: documentsEqual(loaded.doc, result.document), doc: loaded.doc };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
