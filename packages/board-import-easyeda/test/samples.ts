/**
 * Hand-written synthetic EasyEDA Pro exports following the published format (file format 3 log lines and file
 * format 2 arrays). They describe the synthetic "Airnode C3" sample only; no real design is in this file.
 * Coordinates are in format units (mils), +Y up.
 */
import { writeZip } from "../src/zip.js";

const line = (outer: Record<string, unknown>, inner: unknown): string => `${JSON.stringify(outer)}||${inner === "" ? "" : JSON.stringify(inner)}|`;

let ticket = 0;
const rec = (type: string, id: string | undefined, inner: unknown, t?: number) => line({ type, ...(id !== undefined ? { id } : {}), ticket: t ?? ++ticket }, inner);
const head = (docType: string, uuid: string, client = "c1") => line({ type: "DOCHEAD" }, { docType, uuid, client });
const layer = (id: number, layerType: string, use = true) => rec("LAYER", JSON.stringify(["LAYER", id]), { layerId: id, layerType, layerName: layerType, use });

/** The format 3 project log of the synthetic sample. */
export function airnodeLog(): string {
  ticket = 0;
  const L: string[] = [];
  L.push(head("BOARD", "b1"), rec("META", "META", { title: "Airnode C3", sort: 1 }));
  // a two-pad surface footprint
  L.push(head("FOOTPRINT", "f1"), rec("META", "META", { title: "R0603" }), layer(1, "TOP"), layer(3, "TOP_SILK"), layer(48, "COMPONENT_SHAPE"));
  L.push(
    rec("PAD", "e1", { layerId: 1, num: "1", centerX: -30, centerY: 0, padAngle: 0, hole: null, defaultPad: { padType: "RECT", width: 30, height: 35, radius: 0 }, specialPad: [], plated: true, topSolderExpansion: 2 }),
    rec("PAD", "e2", { layerId: 1, num: "2", centerX: 30, centerY: 0, padAngle: 0, hole: null, defaultPad: { padType: "RECT", width: 30, height: 35, radius: 0 }, specialPad: [], plated: true }),
    rec("POLY", "e3", { layerId: 3, width: 6, path: [-50, 25, "L", 50, 25, 50, -25, -50, -25, -50, 25] }),
    rec("POLY", "e4", { layerId: 48, width: 2, path: [-40, 20, "L", 40, 20] }),
    rec("ATTR", "e5", { parentId: "", layerId: 3, x: null, y: null, key: "Designator", value: "R?", valueVisible: false }),
  );
  // a three-pad through-hole footprint: round, slotted, and a non-plated hole
  L.push(head("FOOTPRINT", "f2"), rec("META", "META", { title: "HDR-3" }), layer(1, "TOP"), layer(12, "MULTI"), layer(3, "TOP_SILK"));
  L.push(
    rec("PAD", "e1", { layerId: 12, num: "1", centerX: 0, centerY: 0, padAngle: 0, hole: { holeType: "ROUND", width: 40, height: 40 }, defaultPad: { padType: "ELLIPSE", width: 60, height: 60 }, plated: true }),
    rec("PAD", "e2", { layerId: 12, num: "2", centerX: 100, centerY: 0, padAngle: 0, hole: { holeType: "SLOT", width: 30, height: 60 }, defaultPad: { padType: "OVAL", width: 60, height: 100 }, relativeAngle: 0, plated: true }),
    rec("PAD", "e3", { layerId: 12, num: "", centerX: 200, centerY: 0, padAngle: 0, hole: { holeType: "ROUND", width: 50, height: 50 }, defaultPad: { padType: "ELLIPSE", width: 50, height: 50 }, plated: false }),
    rec("STRING", "e4", { layerId: 3, x: 0, y: 60, text: "1", fontSize: 30, strokeWidth: 5, origin: "LEFT_BOTTOM", angle: 0 }),
  );
  L.push(head("DEVICE", "d1"), rec("META", "META", { title: "10k", attributes: { "Supplier Part": "C25804", Value: "10k", Designator: "R?" } }));
  // the PCB
  L.push(head("PCB", "p1"), rec("META", "META", { title: "Airnode C3 main", board: "b1", parent: "" }));
  L.push(layer(1, "TOP"), layer(2, "BOTTOM"), layer(3, "TOP_SILK"), layer(4, "BOT_SILK"), layer(5, "TOP_SOLDER_MASK"), layer(11, "OUTLINE"), layer(12, "MULTI"), layer(15, "SIGNAL", false));
  L.push(
    rec("LAYER_PHYS", JSON.stringify(["LAYER_PHYS", 5]), { material: "", thickness: 0.394, permittivity: 3.3, zIndex: 1 }),
    rec("LAYER_PHYS", JSON.stringify(["LAYER_PHYS", 1]), { material: "", thickness: 1.378, zIndex: 2 }),
    rec("LAYER_PHYS", JSON.stringify(["LAYER_PHYS", 361]), { material: "FR4", thickness: 59.449, permittivity: 4.5, lossTangent: 0.02, zIndex: 3 }),
    rec("LAYER_PHYS", JSON.stringify(["LAYER_PHYS", 2]), { material: "", thickness: 1.378, zIndex: 4 }),
  );
  L.push(rec("CANVAS", "CANVAS", { originX: 0, originY: 0, unit: "mm" }));
  // outline: a 2000 x 1000 mil rectangle from its top-left corner (0, 1000)
  L.push(rec("POLY", "o1", { layerId: 11, width: 10, path: ["R", 0, 1000, 2000, 1000, 0, 0], polyType: "BOARD_OUTLINE", locked: true }));
  // nets
  L.push(rec("NET", JSON.stringify(["NET", "GND"]), { netType: "Power", differentialName: null }), rec("NET", JSON.stringify(["NET", "VCC"]), { netType: null }));
  // components
  const comp = (id: string, x: number, y: number, angle: number, layerId: number, fp: string, ref: string, extra: Record<string, unknown> = {}) => [
    rec("COMPONENT", id, { layerId, x, y, angle, attrs: {}, locked: false, ...extra }),
    rec("ATTR", `${id}a1`, { parentId: id, layerId: 3, x: null, y: null, key: "Footprint", value: fp, valueVisible: false }),
    rec("ATTR", `${id}a2`, { parentId: id, layerId: layerId === 2 ? 4 : 3, x: x, y: y + 60, key: "Designator", value: ref, valueVisible: true, fontSize: 40, strokeWidth: 6, origin: "LEFT_BOTTOM", angle }),
    rec("ATTR", `${id}a3`, { parentId: id, layerId: 3, x: null, y: null, key: "Device", value: "d1", valueVisible: false }),
  ];
  L.push(...comp("c1", 500, 500, 90, 1, "f1", "R1", { locked: true }), ...comp("c2", 1500, 500, 0, 2, "f1", "R2"), ...comp("c3", 1000, 200, 0, 1, "f2", "J1"));
  L.push(
    rec("PAD_NET", JSON.stringify(["PAD_NET", "c1", "1", "e1"]), { padNet: "GND" }),
    rec("PAD_NET", JSON.stringify(["PAD_NET", "c1", "2", "e2"]), { padNet: "VCC" }),
    rec("PAD_NET", JSON.stringify(["PAD_NET", "c2", "1", "e1"]), { padNet: "VCC" }),
    rec("PAD_NET", JSON.stringify(["PAD_NET", "c2", "2", "e2"]), { padNet: "GND" }),
    rec("PAD_NET", JSON.stringify(["PAD_NET", "c3", "1", "e1"]), { padNet: "GND" }),
  );
  // copper: R1 pad 2 is at (500, 530) after the 90 degree turn
  L.push(
    rec("LINE", "t1", { netName: "VCC", layerId: 1, startX: 500, startY: 530, endX: 800, endY: 530, width: 10, locked: false }),
    rec("LINE", "t2", { netName: "VCC", layerId: 1, startX: 800, startY: 530, endX: 900, endY: 600, width: 10 }, 1),
    rec("LINE", "t2", { netName: "VCC", layerId: 1, startX: 800, startY: 530, endX: 900, endY: 600, width: 20 }, 9999),
    rec("LINE", "t3", { netName: "GND", layerId: 1, startX: 0, startY: 0, endX: 1, endY: 1, width: 10 }),
    rec("LINE", "t3", "", 99999),
    rec("ARC", "a1", { netName: "GND", layerId: 2, startX: 1470, startY: 500, endX: 1300, endY: 300, angle: 90, width: 10 }),
    rec("VIA", "v1", { netName: "VCC", ruleName: "", centerX: 800, centerY: 530, holeDiameter: 12, viaDiameter: 24, viaType: "NORMAL", locked: false }),
    rec("POUR", "z1", { netName: "GND", layerId: 2, width: 0.2, name: "GND bottom", order: 2, path: [["R", 20, 980, 1960, 960, 0, 0]], pourType: { pourType: "SOLID", fineness: 8 }, keepIsland: false }),
    rec(
      "POURED",
      JSON.stringify(["POURED", "z1"]),
      {
        pourFill: [
          { strokeWidth: 0, fill: true, path: [[40, 40, "L", 1960, 40, 1960, 960, 40, 960, 40, 40], [100, 100, "L", 100, 200, 200, 200, 200, 100, 100, 100]] },
          { strokeWidth: 5, fill: false, path: [[300, 300, "L", 310, 300]] },
        ],
      },
    ),
    rec("FILL", "f9", { netName: "GND", layerId: 1, width: 0, fillStyle: "SOLID", path: [["CIRCLE", 1800, 800, 50]] }),
    rec("REGION", "k1", { layerId: 1, width: 0.2, prohibitType: ["TRACK", "VIA"], path: [[100, 900, "L", 300, 900, 300, 700, 100, 700, 100, 900]], name: "no via here" }),
    rec("REGION", "k2", { layerId: 1, width: 0.2, prohibitType: [], path: [[100, 600, "L", 300, 600, 300, 400]], regionType: "CONSTRAINT" }),
    rec("STRING", "s1", { layerId: 3, x: 1000, y: 900, text: "Airnode C3", fontSize: 50, strokeWidth: 6, origin: "CENTER_MIDDLE", angle: 720, mirror: false }),
    rec("DIMENSION", "dim1", { type: "LENGTH", layerId: 13, coords: [0, 0, 100, 0] }),
    rec("RULE", JSON.stringify(["RULE", "TRACK", "trackWidth"]), { ruleState: "DEFAULT", ruleContext: {} }),
  );
  // a second PCB, deleted
  L.push(head("PCB", "p2"), rec("META", "META", { title: "old", board: "" }), line({ type: "DELETE_DOC", ticket: 1 }, { isDelete: true }));
  return L.join("\n") + "\n";
}

/** The synthetic sample as a format 3 export (`.epro2`). */
export const airnodeEpro2 = (): Uint8Array => writeZip({ "project2.json": JSON.stringify({ title: "Airnode C3" }), "Airnode C3.epru": airnodeLog() }, { deflate: true });

/** A small format 2 export (`.epro`) of the same kind. */
export function airnodeEpro(): Uint8Array {
  const j = (a: unknown[]) => JSON.stringify(a);
  const fp = [
    j(["DOCTYPE", "FOOTPRINT", "1.8"]),
    j(["HEAD", { editorVersion: "2.2", importFlag: 0 }]),
    j(["LAYER", 1, "TOP", "Top Layer", 3, "#ff0000", 1, "#7f0000", 0.5]),
    j(["LAYER", 3, "TOP_SILK", "Top Silkscreen Layer", 3, "#ffcc00", 1, "#7f6600", 0.5]),
    j([]),
    j(["PAD", "e1", 0, "", 1, "1", -30, 0, 0, null, ["RECT", 30, 35, 0], [], 0, 0, null, 1, 0, null, null, null, null, 0, null, null, null, null, []]),
    j(["PAD", "e2", 0, "", 1, "2", 30, 0, 0, null, ["RECT", 30, 35, 0], [], 0, 0, null, 1, 0, null, null, null, null, 0, null, null, null, null, []]),
    j(["POLY", "e3", 0, "", 3, 6, [-50, 25, "L", 50, 25], 0]),
  ].join("\n");
  const pcb = [
    j(["DOCTYPE", "PCB", "1.8"]),
    j(["HEAD", { editorVersion: "2.2", importFlag: 0 }]),
    j(["LAYER", 1, "TOP", "Top Layer", 3, "#ff0000", 1, "#7f0000", 0.5]),
    j(["LAYER", 2, "BOTTOM", "Bottom Layer", 3, "#0000ff", 1, "#00007f", 0.5]),
    j(["LAYER", 3, "TOP_SILK", "Top Silkscreen Layer", 3, "#ffcc00", 1, "#7f6600", 0.5]),
    j(["LAYER", 11, "OUTLINE", "Board Outline Layer", 3, "#ff00ff", 1, "#7f007f", 0.5]),
    j(["LAYER", 15, "SIGNAL", "Inner1", 0, "#999966", 1, "#4c4c33", 0.5]),
    j(["LAYER_PHYS", 1, "", 1.378, 0, 0, 1]),
    j(["LAYER_PHYS", 361, "FR4", 59.449, 4.5, 0, 0]),
    j(["LAYER_PHYS", 2, "", 1.378, 0, 0, 1]),
    j(["NET", "GND", null, null, 1, null, 0, null]),
    j(["LINE", "e10", 0, "", 11, -500, 500, 500, 500, 10, 0]),
    j(["LINE", "e11", 0, "", 11, 500, 500, 500, -500, 10, 0]),
    j(["ARC", "e12", 0, "", 11, -500, -500, -500, 500, -90, 10, 0]),
    j(["LINE", "e13", 0, "", 11, 500, -500, -500, -500, 10, 0]),
    j(["COMPONENT", "e20", 0, 1, 0, 0, 0, {}, 0]),
    j(["ATTR", "e20e1", 0, "e20", 3, null, null, "Footprint", "fp1", 0, 0, "default", 45, 6, 0, 0, 3, 0, 0, 0, 0, 0]),
    j(["ATTR", "e20e2", 0, "e20", 3, 0, 60, "Designator", "R1", 0, 1, "default", 45, 6, 0, 0, 4, 0, 0, 0, 0, 0]),
    j(["PAD_NET", "e20", "1", "GND", "e1"]),
    j(["PAD_NET", "e20", "2", "SIG", "e2"]),
    j(["LINE", "e30", 0, "GND", 1, -30, 0, -300, 0, 10, 1]),
    j(["VIA", "e31", 0, "GND", "", -300, 0, 12, 24, 0, null, null, 0, []]),
    j(["REGION", "e32", 0, 1, 0.2, [5, 3], [[100, 100, "L", 200, 100, 200, 200, 100, 200, 100, 100]], 0, null]),
    j(["STRING", "e33", 0, 3, 0, -300, "V2", "default", 40, 6, 0, 0, 4, 0, 0, 0, 0, 0]),
    j(["POUR", "e34", 0, "GND", 2, 1, "", 1, [[-400, 400, "L", 400, 400, 400, -400, -400, -400, -400, 400]], ["SOLID", 0], 1, 0]),
    j(["FILL", "e35", 0, "", 3, 0, 0, [["CIRCLE", 0, 300, 20]], 0]),
    j(["RULE", "Safe Clearance", "default", 1, { unit: "mm" }]),
  ].join("\n");
  const project = {
    boards: { Board1: { schematic: "", pcb: "pcb1" } },
    pcbs: { pcb1: "Airnode C3 v2" },
    footprints: { fp1: { title: "R0603" } },
    devices: {},
    config: { title: "Airnode C3" },
  };
  return writeZip({ "project.json": JSON.stringify(project), "PCB/pcb1.epcb": pcb, "FOOTPRINT/fp1.efoo": fp });
}
