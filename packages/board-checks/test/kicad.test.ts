/** The KiCad cross-check: finding kicad-cli, reading its report, the coordinate transform, and the comparison. */
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { mm } from "@protoboardai/board";
import { compareWithKicad, crossCheckWithKicad, findKicadCli, formatCrossCheck, kicadCliCandidates, parseKicadDrc, readKicadPlacements, runBoardChecks, type KicadDrcReport } from "../src/index.js";
import { boardRecords, fp, makeDoc, rule, smd, trk } from "./helpers.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const IMPORTER = join(here, "..", "..", "board-import", "src", "index.ts");
const SAMPLE = join(here, "..", "..", "ext-tscircuit", "test", "fixtures", "pcb-regression", "airnode-c3", "airnode-c3.kicad_pcb");

describe("finding kicad-cli", () => {
  it("searches the override, then PATH, then the install folders", () => {
    const c = kicadCliCandidates({ PROTOBOARD_KICAD_CLI: "/opt/k/kicad-cli", PATH: ["/a", "/b"].join(delimiter) });
    expect(c[0]).toEqual({ path: "/opt/k/kicad-cli", from: "env" });
    expect(c.filter((x) => x.from === "path").map((x) => x.path)).toContain(join("/a", process.platform === "win32" ? "kicad-cli.exe" : "kicad-cli"));
  });
  it("reports none when nothing is there", () => {
    expect(findKicadCli({ env: { PATH: "", PROTOBOARD_KICAD_CLI: join(here, "no-such-kicad-cli") } })).toBeUndefined();
  });
});

describe("KiCad board positions", () => {
  it("reads each footprint's reference and position", () => {
    const text = '(kicad_pcb (version 20240108) (footprint "R_0402" (layer "F.Cu") (at 105.5 99.25 90) (property "Reference" "R1" (at 0 0)) (pad "1" smd rect (at -0.5 0)))\n (module R_old (layer F.Cu) (at 10 20) (fp_text reference R2 (at 0 0))))';
    expect(readKicadPlacements(text)).toEqual([
      { ref: "R1", x: 105.5, y: 99.25, rotation: 90, layer: "F.Cu" },
      { ref: "R2", x: 10, y: 20, rotation: 0, layer: "F.Cu" },
    ]);
  });
});

describe("comparison", () => {
  // a board where trk:x shorts N1 to N2's pad and N2 has one missing link
  const doc = makeDoc([...boardRecords(), fp("A", 0, 0, [smd("1", -2, 0, 0.8, 0.8), smd("2", 2, 0, 0.8, 0.8)]), fp("B", 0, 5, [smd("1", -2, 0, 0.8, 0.8), smd("2", 2, 0, 0.8, 0.8)]), trk("x", "N1", "top", 0.25, [-2, 0], [2, 0]), trk("y", "N1", "top", 0.25, [-2, 0], [-2, 5]), rule("c", "floor", "clearance", 0.1)], { N1: ["A.1", "B.1"], N2: ["A.2", "B.2"] });
  const ours = runBoardChecks(doc);
  // KiCad's frame: board (x, y) nm is (x / 1e6 + 100, -y / 1e6 + 100) mm
  const k = (x: number, y: number) => ({ x: x + 100, y: -y + 100 });
  const report: KicadDrcReport = {
    kicad_version: "10.0.5",
    coordinate_units: "mm",
    violations: [
      { type: "shorting_items", severity: "error", description: "Items shorting two nets", items: [{ description: "Track [N1] on F.Cu", pos: k(-2, 0) }, { description: "Pad 2 [N2] of A on F.Cu", pos: k(2, 0) }] },
      { type: "text_height", severity: "warning", description: "Text height out of range", items: [{ pos: k(0, 0) }] },
    ],
    unconnected_items: [{ type: "unconnected_items", severity: "error", description: "Missing connection between items", items: [{ description: "Pad 2 [N2] of A on F.Cu", pos: k(2, 0) }, { description: "Pad 2 [N2] of B on F.Cu", pos: k(2, 5) }] }],
  };

  it("matches by location and lists what KiCad checks and we do not", () => {
    const c = compareWithKicad(ours, report, { transform: { tx: -mm(100), ty: mm(100), source: "given" } });
    expect(c.totals).toEqual({ ours: { unconnected: 1, errors: 1, warnings: 0 }, kicad: { unconnected: 1, errors: 1, warnings: 1, excluded: 0 } });
    expect(c.matched.map((m) => m.kicad.type).sort()).toEqual(["shorting_items", "unconnected_items"]);
    const row = (cat: string) => c.categories.find((r) => r.category === cat)!;
    expect(row("short")).toMatchObject({ ours: { errors: 1, warnings: 0 }, kicad: { errors: 1, warnings: 0 }, matched: 1, oursOnly: 0, kicadOnly: 0 });
    expect(row("kicad:text_height")).toMatchObject({ ours: null, kicadOnly: 1, note: "not checked by Protoboard" });
    expect(c.differences).toContain("kicad:text_height: KiCad only, 0 error(s) and 1 warning(s); Protoboard does not check this");
    // like with like: KiCad's text height warning is KiCad only, so the comparable counts agree
    expect(c.comparable).toEqual({ ours: { unconnected: 1, errors: 1, warnings: 0 }, kicad: { unconnected: 1, errors: 1, warnings: 0 } });
    expect(c.kicadOnlyCategories).toEqual({ count: 1, reports: 1, byType: { text_height: 1 } });
    expect(c.differences.some((d) => /^(errors|warnings):/.test(d))).toBe(false);
    expect(c.unconnectedByNet).toEqual([]);
    expect(formatCrossCheck(c)).toMatch(/short\s+ours 1E 0W\s+KiCad 1E 0W/);
  });

  it("never hides a difference: an unmatched item of each side is listed", () => {
    const moved: KicadDrcReport = { ...report, violations: [{ ...report.violations![0], items: [{ pos: k(8, 8) }, { pos: k(9, 9) }] }] };
    const c = compareWithKicad(ours, moved, { transform: { tx: -mm(100), ty: mm(100), source: "given" } });
    expect(c.oursOnly.map((f) => f.check)).toEqual(["short"]);
    expect(c.kicadOnly.map((e) => e.type)).toEqual(["shorting_items"]);
    expect(c.differences.join("\n")).toMatch(/short: equal counts but 1 of ours and 1 of KiCad's did not match by location/);
  });

  it("without a transform, compares counts and says so", () => {
    const c = compareWithKicad(ours, report);
    expect(c.matched).toEqual([]);
    expect(c.differences[0]).toMatch(/no coordinate transform/);
  });

  it("parses a report and refuses other units", () => {
    expect(parseKicadDrc(JSON.stringify(report)).violations).toHaveLength(2);
    expect(() => parseKicadDrc(JSON.stringify({ ...report, coordinate_units: "mils" }))).toThrow(/--units mm/);
  });

  it("is reported as not run without a board file or without KiCad", () => {
    expect(crossCheckWithKicad(ours, {})).toEqual({ ran: false, reason: "no KiCad board file for this board", inputHash: ours.inputHash });
    const none = crossCheckWithKicad(ours, { pcbPath: join(here, "missing.kicad_pcb") });
    expect(none.ran).toBe(false);
  });
});

// The tracked sample's KiCad board, through the KiCad importer when it is present and kicad-cli when it is installed
const live = existsSync(IMPORTER) && existsSync(SAMPLE) && findKicadCli() !== undefined;
describe.skipIf(!live)("cross-check against KiCad on the tracked sample board", () => {
  it("our unconnected count and locations agree with KiCad's", async () => {
    const { importBoard } = (await import(pathToFileURL(IMPORTER).href)) as { importBoard: (s: { path: string }) => Promise<{ document: never; fill: never; offset: { x: number; y: number } }> };
    const imp = await importBoard({ path: SAMPLE });
    const res = runBoardChecks(imp.document, { fills: imp.fill });
    const c = crossCheckWithKicad(res, { pcbPath: SAMPLE, doc: imp.document, transform: { tx: -imp.offset.x, ty: -imp.offset.y } });
    if (!c.ran) throw new Error(c.reason);
    console.log(formatCrossCheck(c));
    expect(c.totals.ours.unconnected).toBe(c.totals.kicad.unconnected);
    expect(c.categories.find((r) => r.category === "unconnected")!.kicadOnly).toBe(0);
    // the comparable errors and warnings agree (KiCad's text and library warnings are KiCad only)
    expect(c.comparable.ours).toEqual(c.comparable.kicad);
    expect(c.oursOnly).toEqual([]);
    expect(c.kicadOnly).toEqual([]);
  });
});

describe("KiCad reports counted once per item set", () => {
  const doc = makeDoc([...boardRecords(), fp("A", 0, 0, [smd("1", 0, 9.8, 0.8, 0.8)]), rule("e", "floor", "edge_clearance", 0.5)], { N1: ["A.1"] });
  const ours = runBoardChecks(doc);
  const k = (x: number, y: number) => ({ x: x + 100, y: -y + 100 });
  const edge = (desc: string, at: { x: number; y: number }) => ({ type: "copper_edge_clearance", severity: "error", description: desc, items: [{ description: "Segment on Edge.Cuts", pos: k(-10, 10) }, { description: "Pad 1 [N1] of A on F.Cu", pos: at }] });
  it("folds repeats of one item set, matches an edge item by its copper item, and leaves out rules not evaluated", () => {
    const report: KicadDrcReport = {
      coordinate_units: "mm",
      violations: [
        edge("Board edge clearance violation (rule 'e' clearance 0.5000 mm; actual 0.0000 mm)", k(0, 9.8)),
        edge("Board edge clearance violation (rule 'e' clearance 0.5000 mm; actual 0.0100 mm)", k(0, 9.8)),
        { type: "items_not_allowed", severity: "warning", description: "Items not allowed (rule 'odd')", items: [{ description: "Via", pos: k(1, 1) }] },
      ],
      unconnected_items: [],
    };
    const c = compareWithKicad(ours, report, { transform: { tx: -mm(100), ty: mm(100), source: "given" }, notEvaluated: [{ name: "custom rule 'odd'", reason: "condition not mapped" }] });
    const row = c.categories.find((r) => r.category === "edge_clearance")!;
    expect(row).toMatchObject({ ours: { errors: 1, warnings: 0 }, kicad: { errors: 1, warnings: 0 }, kicadReports: 2, matched: 1 });
    expect(c.notEvaluated.kicadItems.map((e) => e.type)).toEqual(["items_not_allowed"]);
    expect(c.comparable.kicad).toEqual({ unconnected: 0, errors: 1, warnings: 0 });
  });

  it("folds findings on objects the source gives one identity (pads sharing a UUID) into one", () => {
    const twins = makeDoc([...boardRecords(), fp("A", 0, 0, [smd("1", 0, 9.8, 0.8, 0.8), smd("1", 0, 9.8, 0.8, 0.8, { layer: "bottom" })]), rule("e", "floor", "edge_clearance", 0.5)], { N1: ["A.1"] });
    const r = runBoardChecks(twins);
    expect(r.findings.filter((f) => f.check === "edge_clearance")).toHaveLength(2);
    const report: KicadDrcReport = { coordinate_units: "mm", violations: [edge("Board edge clearance violation (rule 'e' clearance 0.5000 mm; actual 0.0000 mm)", k(0, 9.8))], unconnected_items: [] };
    const c = compareWithKicad(r, report, { transform: { tx: -mm(100), ty: mm(100), source: "given" }, sharedIds: [["pad:A:1", "pad:A:1~2"]] });
    expect(c.folded).toHaveLength(1);
    expect(c.comparable.ours.errors).toBe(1);
    // the two pads of one net are also one unconnected link apart; KiCad reports that too, not given here
    expect(c.categories.find((x) => x.category === "edge_clearance")).toMatchObject({ ours: { errors: 1 }, kicad: { errors: 1 }, matched: 1, oursOnly: 0, kicadOnly: 0 });
  });
});
