/**
 * SMD pads on the side opposite to their footprint (contract section 4.1, Pad): `layer: "bottom"` in the footprint
 * frame. The world side follows the footprint's side, the bottom mirror rule moves every pad, flipping twice is the
 * identity, and files without the field load and save byte-identical.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import {
  BOARD_FILES,
  boundsOf,
  canonicalRecord,
  documentsEqual,
  fileName,
  getOperation,
  provenanceFor,
  footprintToWorld,
  FootprintRec as FootprintSchema,
  layersOf,
  loadBoardDir,
  mm,
  Pad as PadSchema,
  padFrameSide,
  padsOf,
  padWorldSide,
  withChanges,
  writeBoardDir,
  type BoardDocument,
  type FootprintRec,
  type OpCall,
  type Pad,
} from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/airnode-c3/", import.meta.url));

/** Apply one call as the system (no provenance edit), directly through the registry. */
function applyCall(doc: BoardDocument, call: OpCall) {
  const def = getOperation(call.op)!;
  const { op: _o, ...args } = call;
  const actor = { kind: "system", id: "system" } as const;
  return def.apply(doc, def.input.parse(args), { actor, issueId: (k) => `${k}:t.1`, provenance: provenanceFor(actor), edited: undefined, lockCopper: false });
}

/** A footprint with a pad on its own side, one on the opposite side, and a plated hole. */
const twoFaced = (side: "top" | "bottom", rotation = 0): FootprintRec => ({
  kind: "footprint",
  id: "fp:J9",
  ref: "J9",
  footprint: "Airnode:TwoFaced",
  x: mm(3),
  y: mm(-2),
  rotation,
  side,
  pads: [
    { number: "1", type: "smd", shape: "rect", x: mm(1), y: mm(0.5), width: mm(0.6), height: mm(1.2), layer: "top" },
    { number: "2", type: "smd", shape: "rect", x: mm(-1), y: mm(0.5), rotation: 30_000, width: mm(0.6), height: mm(1.2), layer: "bottom" },
    { number: "3", type: "th", shape: "circle", x: 0, y: mm(-1), outer_diameter: mm(1.6), hole_diameter: mm(0.9) },
  ],
  provenance: { by: "imported" },
});

describe("pads on the opposite side of a footprint", () => {
  it("absent layer means the footprint's own side; th pads may not name the bottom", () => {
    const p: Pad = { number: "1", type: "smd", shape: "rect", x: 0, y: 0, width: 1, height: 1 };
    expect(PadSchema.safeParse(p).success).toBe(true);
    expect(padFrameSide(p)).toBe("top");
    expect(padFrameSide({ layer: "bottom" })).toBe("bottom");
    expect(PadSchema.safeParse({ ...p, layer: "bottom" }).success).toBe(true);
    expect(PadSchema.safeParse({ number: "1", type: "th", shape: "circle", x: 0, y: 0, outer_diameter: 2, hole_diameter: 1, layer: "bottom" }).success).toBe(false);
    expect(FootprintSchema.safeParse(twoFaced("bottom")).success).toBe(true);
  });

  it("lands each SMD pad on its world side: own side follows the footprint, the other side is opposite", () => {
    expect(padsOf(twoFaced("top")).map((p) => p.layers)).toEqual([["top"], ["bottom"], ["top", "bottom"]]);
    expect(padsOf(twoFaced("bottom")).map((p) => p.layers)).toEqual([["bottom"], ["top"], ["top", "bottom"]]);
    expect(padWorldSide({ side: "bottom" }, { layer: "bottom" })).toBe("top");
    const doc = withChanges(airnodeC3(), [twoFaced("top")]);
    expect(layersOf(doc, doc.records.get("fp:J9")!)).toEqual(expect.arrayContaining(["top", "bottom"]));
  });

  it("mirrors every pad, whatever its side, by the footprint transform", () => {
    for (const side of ["top", "bottom"] as const)
      for (const rotation of [0, 90_000, 217_500]) {
        const fp = twoFaced(side, rotation);
        for (const [i, wp] of padsOf(fp).entries()) {
          const c = footprintToWorld(fp, fp.pads[i]);
          expect([wp.x, wp.y]).toEqual([Math.round(c.x), Math.round(c.y)]);
        }
        // the box covers every pad on either side
        const b = boundsOf(fp)!;
        for (const wp of padsOf(fp)) expect(b.minX <= wp.box.minX && b.maxX >= wp.box.maxX && b.minY <= wp.box.minY && b.maxY >= wp.box.maxY).toBe(true);
      }
  });

  it("flipping moves both faces to the other side; flipping twice is the identity", () => {
    const doc = withChanges(airnodeC3(), [twoFaced("top", 37_000)]);
    const once = applyCall(doc, { op: "footprint.flip", ids: ["fp:J9"] }).doc;
    const fp1 = once.records.get("fp:J9") as FootprintRec;
    expect(fp1.side).toBe("bottom");
    expect(padsOf(fp1).map((p) => p.layers[0])).toEqual(["bottom", "top", "top"]);
    // a flip about its own origin mirrors x about the footprint: pad 1 moves to the other side of x = 3 mm
    const p0 = padsOf(doc.records.get("fp:J9") as FootprintRec)[0];
    const q0 = padsOf(fp1)[0];
    expect(q0.x - mm(3)).toBe(-(p0.x - mm(3)));
    expect(q0.y).toBe(p0.y);
    const twice = applyCall(once, { op: "footprint.flip", ids: ["fp:J9"] }).doc;
    expect(canonicalRecord(twice.records.get("fp:J9"))).toBe(canonicalRecord(doc.records.get("fp:J9")));
    expect(padsOf(twice.records.get("fp:J9") as FootprintRec)).toEqual(padsOf(doc.records.get("fp:J9") as FootprintRec));
    expect(documentsEqual(twice, doc)).toBe(true);
  });

  it("files without the field still load and save byte-identical; a bottom pad round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-board-padside-"));
    cpSync(FIXTURE, dir, { recursive: true });
    const before = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    const loaded = loadBoardDir(dir);
    expect(writeBoardDir(dir, loaded.doc).written).toEqual([]);
    for (const f of BOARD_FILES) expect(readFileSync(join(dir, fileName(f)), "utf8")).toBe(before[fileName(f)]);
    const next = withChanges(loaded.doc, [twoFaced("bottom")]);
    expect(writeBoardDir(dir, next).written).toEqual(["placement"]);
    const back = loadBoardDir(dir).doc;
    expect(documentsEqual(back, next)).toBe(true);
    expect(readFileSync(join(dir, "placement.jsonl"), "utf8")).toContain('"layer":"bottom"');
  });
});
