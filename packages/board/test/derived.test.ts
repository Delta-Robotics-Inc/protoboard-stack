/** Derived data (contract section 4.3): the shared zone fill type, its cache path and its input hash. */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../src/fixtures/airnode-c3.js";
import { createZoneFill, loadZoneFill, parseZoneFill, readZoneFill, recordsOfKind, withChanges, writeZoneFill, zoneFillInputHash, zoneFillIsCurrent, zoneFillPath, ZONE_FILL_SCHEMA } from "../src/index.js";

const square = (s: number) => [0, 0, s, 0, s, s, 0, s];

describe("zone fill", () => {
  const doc = airnodeC3();
  const zone = recordsOfKind(doc, "zone")[0];

  it("is stamped with the zones' hash and goes stale when a zone changes", () => {
    const { fill, droppedRings } = createZoneFill(doc, "computed", [
      { zone: zone.id, source: "engine", layer: zone.layers[0], polygons: [{ outer: square(1000), holes: [[1, 1, 2, 2]] }, { outer: [0, 0, 1, 1], holes: [] }] },
    ]);
    expect(droppedRings).toBe(2);
    expect(fill.fills[0].polygons).toEqual([{ outer: square(1000), holes: [] }]);
    expect(fill.schema).toBe(ZONE_FILL_SCHEMA);
    expect(fill.inputHash).toBe(zoneFillInputHash(doc));
    expect(zoneFillIsCurrent(fill, doc)).toBe(true);
    const edited = withChanges(doc, [{ ...zone, priority: zone.priority + 1 }]);
    expect(zoneFillIsCurrent(fill, edited)).toBe(false);
    // a change to anything but a zone leaves it current
    const fp = recordsOfKind(doc, "footprint")[0];
    expect(zoneFillIsCurrent(fill, withChanges(doc, [{ ...fp, x: fp.x + 1 }]))).toBe(true);
  });

  it("accepts the four sources and refuses malformed files", () => {
    for (const source of ["kicad", "easyeda-pro", "circuit-json", "computed"] as const) expect(createZoneFill(doc, source, []).fill.source).toBe(source);
    const ok = createZoneFill(doc, "kicad", []).fill;
    expect(() => parseZoneFill({ ...ok, source: "gerber" })).toThrow(/not a valid/);
    expect(() => parseZoneFill({ ...ok, fills: [{ source: "x", layer: "top", polygons: [{ outer: [0, 0, 1], holes: [] }] }] })).toThrow(/not a valid/);
    // a cache written before the shared type (source kicad_pcb) still reads
    expect(parseZoneFill({ ...ok, source: "kicad_pcb" }).source).toBe("kicad");
  });

  it("caches beside the project under .protoboard/build/board/<board key>/zone-fill.json", () => {
    const root = mkdtempSync(join(tmpdir(), "pb-board-derived-"));
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    const dir = join(root, "src", "main", "board");
    mkdirSync(dir, { recursive: true });
    expect(zoneFillPath(dir)).toBe(join(root, ".protoboard", "build", "board", "src__main__board", "zone-fill.json"));
    expect(loadZoneFill(dir, doc)).toBeUndefined();
    const { fill } = createZoneFill(doc, "kicad", [{ zone: zone.id, source: "z", net: "GND", layer: "top", polygons: [{ outer: square(5), holes: [] }] }]);
    const path = writeZoneFill(dir, fill);
    expect(readZoneFill(path)).toEqual(fill);
    expect(loadZoneFill(dir, doc)).toMatchObject({ current: true, path });
    // a board outside any project: the cache is a sibling of the board folder, never inside it
    const lone = join(mkdtempSync(join(tmpdir(), "pb-board-lone-")), "imported");
    mkdirSync(lone);
    const p = writeZoneFill(lone, fill);
    expect(p).toBe(join(lone, "..", ".protoboard", "build", "board", "imported", "zone-fill.json"));
    expect(existsSync(join(lone, ".protoboard"))).toBe(false);
  });
});
