/**
 * JLCPCB's assembly upload files (out/jlcpcb/bom.csv and cpl.csv) from a small
 * board: JLC's column names, one BOM row per part with its designators grouped
 * in natural order, mm with the unit, Top/Bottom, and an empty LCSC field (never
 * a guess) for a part the project has no LCSC offer for. The generic bom.csv and
 * pnp.csv keep their instance-keyed columns (core's standard outputs).
 */
import { describe, expect, it } from "vitest";
import { parseCsv, type BoardComponent, type BoardNetlist } from "@protoboardai/core";
import { bomCsv, jlcAssembly, jlcComment, JLC_BOM_HEADER, JLC_CPL_HEADER, pnpCsv, type Placement } from "../lib/outputs.ts";

const part = (instance: string, kind: BoardComponent["kind"], extra: Partial<BoardComponent>): BoardComponent => ({ instance, part: instance, name: instance.toUpperCase(), kind, pins: [], bodies: [], ...extra });
const chip = (name: string) => ({ name, pin_count: 2, exposed_pad: false });
const netlist: BoardNetlist = {
  schema: "protoboard.board-netlist/v0",
  board: "b",
  components: [
    part("r1", "resistor", { mpn: "0402WGF1002TCE", value: { value: 1e4, unit: "Ω" }, package: chip("0402") }),
    part("power/r10", "resistor", { mpn: "0402WGF1002TCE", value: { value: 1e4, unit: "Ω" }, package: chip("0402") }),
    part("r2", "resistor", { mpn: "0402WGF1002TCE", value: { value: 1e4, unit: "Ω" }, package: chip("0402") }),
    part("r3", "resistor", { mpn: "0402WGF3300TCE", value: { value: 330, unit: "Ω" }, package: chip("0402") }),
    part("c1", "capacitor", { mpn: "CL05B104KO5NNNC", value: { value: 1e-7, unit: "F" }, package: chip("0402") }),
    part("l1", "inductor", { mpn: "XFL4020-152ME", value: { value: 1.5e-6, unit: "H" }, package: chip("XFL4020") }),
    part("u1", "ic", { mpn: "RP2040", package: { name: "QFN-56", pin_count: 56, exposed_pad: true } }),
    part("j1", "connector", { mpn: "SM04B-SRSS-TB", package: { name: "JST SH, 4 pin", pin_count: 4, exposed_pad: false } }),
  ],
  nets: [],
  edge: [],
  problems: [],
};
const designators = { r1: "R1", "power/r10": "R10", r2: "R2", r3: "R3", c1: "C1", l1: "L1", u1: "U1", j1: "J1" };
const suppliers = { r1: { lcsc: ["C25744"] }, "power/r10": { lcsc: ["C25744"] }, r2: { lcsc: ["C25744"] }, r3: { lcsc: ["C25104"] }, c1: { lcsc: ["C1525"] }, l1: { mouser: ["994-XFL4020-152MEC"] }, u1: { lcsc: ["C2040"] } };
const placements: Placement[] = [
  { instance: "u1", x: -4, y: 2, rotation_deg: 0, side: "top" },
  { instance: "power/r10", x: 1.25, y: -0.5, rotation_deg: 90, side: "top" },
  { instance: "r2", x: 3, y: 3, rotation_deg: -90, side: "top" },
  { instance: "j1", x: 0, y: -7.123456, rotation_deg: 180, side: "bottom" },
];

describe("JLCPCB BOM", () => {
  const { bom, withoutLcsc } = jlcAssembly(netlist, designators, suppliers, placements);
  const rows = parseCsv(bom).rows;

  it("has JLC's columns and one row per part, designators grouped in natural order", () => {
    expect(rows[0]).toEqual(["Comment", "Designator", "Footprint", "LCSC Part #"]);
    expect(rows[0]).toEqual(JLC_BOM_HEADER);
    expect(rows.slice(1)).toEqual([
      ["100nF", "C1", "0402", "C1525"],
      ["SM04B-SRSS-TB", "J1", "JST SH, 4 pin", ""],
      ["1.5uH", "L1", "XFL4020", ""],
      ["10k", "R1,R2,R10", "0402", "C25744"],
      ["330", "R3", "0402", "C25104"],
      ["RP2040", "U1", "QFN-56", "C2040"],
    ]);
    // a grouped designator list is one quoted field
    expect(bom).toContain('10k,"R1,R2,R10",0402,C25744');
  });

  it("leaves the LCSC field empty for a part without an LCSC offer and names it (a Mouser number is not used)", () => {
    expect(withoutLcsc).toEqual(["J1", "L1"]);
  });

  it("writes values in ASCII, as JLC's parts library does", () => {
    expect(jlcComment({ value: { value: 4700, unit: "Ω" }, name: "R" })).toBe("4.7k");
    expect(jlcComment({ value: { value: 2.2e-5, unit: "F" }, name: "C" })).toBe("22uF");
    expect(jlcComment({ value: { value: 1e6, unit: "Ω" }, name: "R" })).toBe("1M");
    expect(jlcComment({ mpn: "TPS63020", name: "Buck-boost" })).toBe("TPS63020");
    expect(jlcComment({ name: "Test point" })).toBe("Test point");
  });
});

describe("JLCPCB CPL", () => {
  const rows = parseCsv(jlcAssembly(netlist, designators, suppliers, placements).cpl).rows;

  it("has JLC's columns, by designator in natural order, mm with the unit, Top or Bottom, rotation in 0-360", () => {
    expect(rows[0]).toEqual(JLC_CPL_HEADER);
    expect(rows[0]).toEqual(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]);
    expect(rows.slice(1)).toEqual([
      ["J1", "0.0000mm", "-7.1235mm", "Bottom", "180"],
      ["R2", "3.0000mm", "3.0000mm", "Top", "270"],
      ["R10", "1.2500mm", "-0.5000mm", "Top", "90"],
      ["U1", "-4.0000mm", "2.0000mm", "Top", "0"],
    ]);
  });

  it("falls back to the instance path only for a placement with no designator (a footprint only KiCad has)", () => {
    const cpl = parseCsv(jlcAssembly(netlist, designators, suppliers, [{ instance: "LOGO1", x: 0, y: 0, rotation_deg: 0, side: "top" }]).cpl).rows;
    expect(cpl[1][0]).toBe("LOGO1");
  });
});

describe("the generic files", () => {
  it("keep their instance-keyed columns for the code that reads them", () => {
    expect(parseCsv(bomCsv(netlist, suppliers)).rows[0][0]).toBe("instance");
    expect(parseCsv(pnpCsv(netlist, { components: [{ instance: "u1", center: [-4, 2], rotation_deg: 0, side: "top", part: "u1" }] } as never, suppliers)).rows[0]).toEqual(["instance", "x_mm", "y_mm", "rotation_deg", "side", "part", "mpn", "package", "lcsc"]);
  });
});
