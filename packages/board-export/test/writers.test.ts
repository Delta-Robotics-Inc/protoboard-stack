/**
 * Writers against hand-computed expectations: number formatting, a small Gerber layer written byte for byte,
 * aperture macros, Excellon, IPC-D-356 columns, the JLCPCB BOM and CPL, DXF entities, polygon fracturing, ZIP CRC.
 */
import { describe, expect, it } from "vitest";
import { createDocument, mm, type BoardRecord, type FootprintRec } from "@protoboardai/board";
import {
  bomLines,
  crc32,
  drillFiles,
  boardHoles,
  evalExpr,
  fracture,
  JLCPCB,
  GENERIC,
  mmText,
  placements,
  readGerber,
  apertureShapes,
  areaOf,
  readIpc356,
  writeBom,
  writeCpl,
  writeDxf,
  writeExcellon,
  writeGerber,
  writeIpc356,
  zip,
  unzipStored,
  type PlotLayer,
} from "../src/index.js";

const PROV = { by: "hand" } as const;

/** A 10 x 10 mm two-layer board with one resistor, one through-hole header pin, one via and one track. */
function tiny(): ReturnType<typeof createDocument> {
  const recs: BoardRecord[] = [
    { kind: "board", id: "board", name: "Tiny", thickness: mm(1.6), copper_layers: 2, origin: "center" },
    { kind: "layer", id: "layer:top", name: "top", type: "copper", order: 0, thickness: 35_000 },
    { kind: "layer", id: "layer:bottom", name: "bottom", type: "copper", order: 2, thickness: 35_000 },
    { kind: "layer", id: "layer:core1", name: "core1", type: "dielectric", order: 1, thickness: mm(1.5) },
    {
      kind: "outline",
      id: "outline",
      source: { kind: "board" },
      outline: [
        { x: mm(-5), y: mm(-5) },
        { x: mm(5), y: mm(-5) },
        { x: mm(5), y: mm(5) },
        { x: mm(-5), y: mm(5) },
      ],
    },
    {
      kind: "footprint",
      id: "fp:R1",
      ref: "R1",
      footprint: "Lib:R_0603",
      value: "10k",
      supplier_part: "C25804",
      x: mm(1),
      y: mm(2),
      rotation: 90_000,
      side: "top",
      pads: [
        { number: "1", type: "smd", shape: "rect", x: mm(-0.8), y: 0, width: mm(0.8), height: mm(0.9) },
        { number: "2", type: "smd", shape: "rect", x: mm(0.8), y: 0, width: mm(0.8), height: mm(0.9) },
      ],
      provenance: PROV,
    } as FootprintRec,
    {
      kind: "footprint",
      id: "fp:J1",
      ref: "J1",
      footprint: "Lib:Pin_1x01",
      x: mm(-3),
      y: mm(-3),
      rotation: 0,
      side: "top",
      pads: [{ number: "1", type: "th", shape: "circle", x: 0, y: 0, outer_diameter: mm(1.7), hole_diameter: mm(1) }],
      provenance: PROV,
    } as FootprintRec,
    { kind: "via", id: "via:a", net: "N1", x: mm(-1), y: mm(-1), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", provenance: PROV },
    { kind: "track", id: "trk:a", net: "N1", layer: "top", width: mm(0.25), start: { x: mm(-1), y: mm(-1) }, end: { x: mm(1), y: mm(1.2) }, provenance: PROV },
  ];
  return createDocument(recs, { source: "fixture", nets: [{ name: "N1", pins: ["R1.1", "J1.1"] }] });
}

describe("number formatting", () => {
  it("writes nanometers as exact millimeters", () => {
    expect(mmText(1_500_000)).toBe("1.5");
    expect(mmText(-250_000)).toBe("-0.25");
    expect(mmText(1)).toBe("0.000001");
    expect(mmText(0)).toBe("0");
    expect(mmText(1_234_567, 4)).toBe("1.2346");
    expect(mmText(-1_234_550, 4)).toBe("-1.2346");
    expect(mmText(-40, 4)).toBe("0");
  });
});

describe("Gerber writer", () => {
  it("writes a layer byte for byte: header, apertures with functions, attributes, flash, draw, arc, region", () => {
    const layer: PlotLayer = {
      id: "copper:top",
      kind: "copper",
      side: "top",
      copper: "top",
      index: 1,
      fileFunction: "Copper,L1,Top",
      polarity: "Positive",
      objects: [
        { k: "region", ring: [{ x: 0, y: 0 }, { x: mm(2), y: 0 }, { x: mm(2), y: mm(1) }], fn: "Conductor", attrs: { N: "GND" }, src: "zone:z" },
        { k: "draw", width: mm(0.25), path: [{ x: 0, y: 0 }, { x: mm(1), y: 0 }, { x: mm(2), y: mm(1), sweep: 90_000 }], fn: "Conductor", attrs: { N: "N1" }, src: "trk:t" },
        { k: "flash", ap: { t: "R", w: mm(0.8), h: mm(0.9) }, x: mm(1), y: mm(-2), fn: "SMDPad,CuDef", attrs: { N: "N1", P: ["R1", "1"], C: "R1" }, src: "pad:R1:1" },
      ],
    };
    const text = writeGerber(layer, { origin: { x: 0, y: 0 }, generator: ["Protoboard", "board-export", "0.2.2"] });
    expect(text).toBe(
      [
        "%TF.GenerationSoftware,Protoboard,board-export,0.2.2*%",
        "%TF.SameCoordinates,Original*%",
        "%TF.FileFunction,Copper,L1,Top*%",
        "%TF.FilePolarity,Positive*%",
        "%TF.Part,Single*%",
        "%FSLAX46Y46*%",
        "%MOMM*%",
        "%LPD*%",
        "%TA.AperFunction,Conductor*%",
        "%ADD10C,0.25*%",
        "%TD.AperFunction*%",
        "%TA.AperFunction,SMDPad,CuDef*%",
        "%ADD11R,0.8X0.9*%",
        "%TD.AperFunction*%",
        "%TA.AperFunction,Conductor*%",
        "%TO.N,GND*%",
        "G36*",
        "X0Y0D02*",
        "G01*",
        "X2000000Y0D01*",
        "X2000000Y1000000D01*",
        "X0Y0D01*",
        "G37*",
        "%TD.AperFunction*%",
        "%TO.N,N1*%",
        "D10*",
        "X0Y0D02*",
        "X1000000Y0D01*",
        "G75*",
        "G03*",
        // a quarter circle counterclockwise from (1, 0) to (2, 1) has its center at (1, 1): I = 0, J = 1 mm
        "X2000000Y1000000I0J1000000D01*",
        "%TO.C,R1*%",
        "%TO.P,R1,1*%",
        "D11*",
        "X1000000Y-2000000D03*",
        "%TD*%",
        "M02*",
        "",
      ].join("\n"),
    );
    const r = readGerber(text);
    expect(r.errors).toEqual([]);
    expect(r.objects.map((o) => o.k)).toEqual(["region", "draw", "draw", "flash"]);
    const arc = r.objects[2];
    expect(arc.k === "draw" && arc.arc).toEqual({ cx: mm(1), cy: mm(1), ccw: true });
    const f = r.objects[3];
    expect(f.k === "flash" && f.attrs).toEqual({ ".C": ["R1"], ".N": ["N1"], ".P": ["R1", "1"] });
  });

  it("escapes reserved characters in attribute values and writes the comment form", () => {
    const layer: PlotLayer = { id: "profile", kind: "profile", fileFunction: "Profile,NP", polarity: "Positive", objects: [{ k: "flash", ap: { t: "C", d: mm(1) }, x: 0, y: 0, attrs: { N: "A,B*C" }, src: "x" }] };
    const text = writeGerber(layer, { x2: "comments" });
    expect(text).toContain("G04 #@! TO.N,A\\u002CB\\u002AC*");
    expect(text).not.toContain("%TF");
    const r = readGerber(text);
    expect(r.fileAttrs[".FileFunction"]).toEqual(["Profile", "NP"]);
    expect(r.objects[0].attrs[".N"]).toEqual(["A,B*C"]);
  });

  it("defines macros whose shapes have the expected areas", () => {
    // rounded rectangle 2 x 1 mm, corner 0.25 mm, rotated 30 degrees: area = w h - (4 - pi) r^2
    const layer: PlotLayer = { id: "copper:top", kind: "copper", copper: "top", index: 1, fileFunction: "Copper,L1,Top", polarity: "Positive", objects: [{ k: "flash", ap: { t: "RoundRect", r: mm(0.25), w: mm(2), h: mm(1), rot: 30_000 }, x: 0, y: 0, src: "p" }] };
    const text = writeGerber(layer);
    expect(text).toContain("%ADD10RoundRect,0.25X2X1X30*%");
    const r = readGerber(text);
    const shapes = apertureShapes(r, r.apertures.get(10)!);
    expect(shapes).toHaveLength(6);
    expect(evalExpr("$2-$1-$1", [0, 0.25, 2, 1])).toBeCloseTo(1.5);
    expect(evalExpr("$1-$3/2", [0, 0.25, 2, 1])).toBeCloseTo(-0.25);
    expect(evalExpr("(1+2)x3", [])).toBe(9);
    // the two center lines are 2 x 0.5 and 1.5 x 1
    expect(areaOf(shapes[0].ring)).toBeCloseTo(mm(2) * mm(0.5), -6);
    expect(areaOf(shapes[1].ring)).toBeCloseTo(mm(1.5) * mm(1), -6);
  });
});

describe("Excellon writer", () => {
  it("writes the tool table and holes in decimal millimeters with X2 drill functions", () => {
    const doc = tiny();
    const files = drillFiles(doc, boardHoles(doc));
    expect(files.map((f) => f.fileFunction)).toEqual(["Plated,1,2,PTH"]);
    const text = writeExcellon(files[0], { generator: ["Protoboard", "board-export", "0.2.2"] });
    expect(text).toBe(
      [
        "M48",
        "; DRILL file, Protoboard board-export",
        "; FORMAT={-:-/ absolute / metric / decimal}",
        "; #@! TF.GenerationSoftware,Protoboard,board-export,0.2.2",
        "; #@! TF.FileFunction,Plated,1,2,PTH",
        "FMAT,2",
        "METRIC",
        "; #@! TA.AperFunction,Plated,PTH,ViaDrill",
        "T1C0.3",
        "; #@! TA.AperFunction,Plated,PTH,ComponentDrill",
        "T2C1.0",
        "%",
        "G90",
        "G05",
        "T1",
        "X-1.0Y-1.0",
        "T2",
        "X-3.0Y-3.0",
        "M30",
        "",
      ].join("\n"),
    );
  });

  it("writes slots as routed paths or as G85", () => {
    const file = { key: "pth", fileFunction: "Plated,1,2,PTH", plated: "plated" as const, span: [1, 2] as [number, number], holes: [{ x: 0, y: 0, d: mm(0.6), plated: true, fn: "ComponentDrill" as const, span: ["top", "bottom"] as ["top", "bottom"], slot: { a: { x: 0, y: mm(-0.5) }, b: { x: 0, y: mm(0.5) } }, src: "pad:J1:S" }] };
    expect(writeExcellon(file)).toContain(["G00X0.0Y-0.5", "M15", "G01X0.0Y0.5", "M16", "G05"].join("\n"));
    expect(writeExcellon(file, { slotMode: "g85" })).toContain("X0.0Y-0.5G85X0.0Y0.5");
  });
});

describe("IPC-D-356A", () => {
  it("writes fixed columns in 0.0001 inch", () => {
    const text = writeIpc356(tiny());
    const lines = text.split("\n");
    // R1 pad 1 at (1, 2) + rotate 90 of (-0.8, 0) = (1, 1.2) mm = (0.03937, 0.04724) in: 394, 472 tenth-mils
    const r1 = lines.find((l) => l.startsWith("327N1"))!;
    expect(r1).toBe(`327${"N1".padEnd(14)}   ${"R1".padEnd(6)}-${"1".padEnd(4)} ${" ".repeat(6)}A01X+000394Y+000472X0315Y0354R090S2`);
    expect(r1.slice(20, 26)).toBe("R1    ");
    const via = lines.find((l) => l.includes("VIA"))!;
    // 0.3 mm hole = 118 tenth-mils, 0.6 mm = 236; tented both sides by default: S3
    expect(via).toBe(`317${"N1".padEnd(14)}   ${"VIA".padEnd(6)} ${"".padEnd(4)}MD0118PA00X-000394Y-000394X0236Y0236R000S3`);
    const th = lines.find((l) => l.includes("J1"))!;
    expect(th.slice(32, 41)).toBe("D0394PA00");
    expect(lines.at(-2)).toBe("999");
    const read = readIpc356(text);
    expect(read.records.map((r) => `${r.ref}-${r.pin}:${r.net}`)).toEqual(["J1-1:N1", "R1-1:N1", "R1-2:N/C", "VIA-:N1"]);
  });
});

describe("assembly files", () => {
  it("writes JLCPCB's CPL and BOM columns, flags a line without an LCSC number, and marks consigned parts", () => {
    const doc = tiny();
    const rows = placements(doc, JLCPCB, { parts: { J1: { consigned: "hand-cut header supplied by us" } } });
    expect(rows.map((r) => [r.ref, r.lcsc, r.consigned])).toEqual([
      ["J1", undefined, true],
      ["R1", "C25804", false],
    ]);
    const cpl = writeCpl(rows, "jlcpcb");
    expect(cpl).toBe(["Designator,Mid X,Mid Y,Layer,Rotation", "J1,-3.0000mm,-3.0000mm,Top,0", "R1,1.0000mm,2.0000mm,Top,90", ""].join("\n"));
    const lines = bomLines(rows, "Tiny");
    expect(writeBom(lines, "jlcpcb")).toBe(["Comment,Designator,Footprint,LCSC Part #", "Pin_1x01 (consigned),J1,Pin_1x01,", "10k,R1,R_0603,C25804", ""].join("\n"));
    // without part data the header has no supplier number: flagged, never guessed
    const bare = bomLines(placements(doc, JLCPCB), "Tiny");
    expect(bare.find((l) => l.refs[0] === "J1")!.flags).toEqual(["no LCSC part number"]);
    expect(bare.find((l) => l.refs[0] === "J1")!.lcsc).toBeUndefined();
  });

  it("applies rotation corrections: the part's own value, then the exact LCSC entry, then the longest package pattern", () => {
    const doc = tiny();
    const entries = [
      { package: "^R_", rotation: 90, source: "test" },
      { package: "^R_0603", rotation: 180, source: "test" },
      { lcsc: "C25804", rotation: -90, source: "test" },
    ];
    const byLcsc = placements(doc, JLCPCB, { rotations: entries }).find((r) => r.ref === "R1")!;
    expect(byLcsc.correction.source).toBe("lcsc");
    expect(byLcsc.rotationOut).toBe(0);
    const byPkg = placements(doc, JLCPCB, { rotations: entries.slice(0, 2) }).find((r) => r.ref === "R1")!;
    expect([byPkg.correction.source, byPkg.rotationOut]).toEqual(["package", 270_000]);
    const own = placements(doc, JLCPCB, { rotations: entries, parts: { R1: { rotation: 45 } } }).find((r) => r.ref === "R1")!;
    expect([own.correction.source, own.rotationOut]).toEqual(["part", 135_000]);
  });

  it("writes a bottom part's rotation in KiCad's convention (180 degrees from the document's)", () => {
    const doc = tiny();
    const fp = doc.records.get("fp:R1") as FootprintRec;
    const flipped = createDocument([...[...doc.records.values()].filter((r) => r.id !== "fp:R1"), { ...fp, side: "bottom", rotation: 270_000 }], doc.netlist);
    const r = placements(flipped, GENERIC).find((x) => x.ref === "R1")!;
    expect(r.rotationOut).toBe(90_000);
    expect(writeCpl([r], "generic")).toContain("R1,10k,R_0603,1.0000,2.0000,90,Bottom,smt");
  });
});

describe("DXF writer", () => {
  it("writes the outline as LINE entities in millimeters with $INSUNITS 4, and arcs as ARC", () => {
    const text = writeDxf(tiny());
    expect(text).toContain(["9", "$INSUNITS", "70", "4"].join("\n"));
    expect(text).toContain(["0", "LINE", "8", "OUTLINE", "10", "-5", "20", "-5", "30", "0", "11", "5", "21", "-5", "31", "0"].join("\n"));
    const arc = createDocument([
      ...[...tiny().records.values()].filter((r) => r.kind !== "outline"),
      { kind: "outline", id: "outline", source: { kind: "board" }, outline: [{ x: mm(-5), y: 0, sweep: 180_000 }, { x: mm(5), y: 0 }] as never },
    ]);
    // a half circle counterclockwise from (-5, 0) to (5, 0) passes below: center (0, 0), from 180 to 360 degrees
    expect(writeDxf(arc)).toContain(["0", "ARC", "8", "OUTLINE", "10", "0", "20", "0", "30", "0", "40", "5", "50", "180", "51", "0"].join("\n"));
  });
});

describe("geometry and archive", () => {
  it("fractures a square with a square hole into one contour of the right area", () => {
    const outer = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const hole = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
    const ring = fracture(outer, [hole]);
    expect(ring.length).toBe(4 + 4 + 2);
    expect(areaOf(ring)).toBe(100 * 100 - 20 * 20);
  });

  it("computes the standard CRC-32 check value and stores entries", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = zip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    expect(unzipStored(z).map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([["a.txt", "hello"]]);
  });
});
