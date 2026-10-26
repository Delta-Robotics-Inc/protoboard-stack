/**
 * Per-placement passive values: a catalog series part (Yageo RC0402, a test
 * copy of the dev catalog's revision) placed on a small board at two values
 * through `ChildModuleRef.overrides`. The board netlist, `build`'s BOM and
 * the UHD check each see the placement's value and MPN, not the
 * definition's default.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Net, defineModule, netLinks, pinTable, type ModuleDef } from "@deltarobotics/uhd";
import { bom, boardNetlist, formatPassive, loadProject, placementPart } from "../src/index.js";
import { catalogPart, vendorCatalogParts } from "./catalog.js";

const RC0402 = catalogPart("yageo-rc0402");

const SENSOR: ModuleDef = defineModule({
  id: "fx-sensor",
  name: "Fixture sensor",
  manufacturer: "Fixture Co",
  part_number: "FX-1",
  interfaces: pinTable(
    [
      { pin: 1, name: "VDD", type: "power_in", voltageV: [1.7, 3.6] },
      [2, "GND", "ground"],
      { pin: 3, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
      { pin: 4, name: "SCL", type: "input", capabilities: ["i2c_scl"] },
      { pin: 5, name: "EN", type: "input" },
    ],
    { source: "test fixture", logicV: [1.7, 3.6] },
  ),
});

/** r1/r2: 4.7 kΩ I2C pull-ups; r3: the default 10 kΩ enable pull-up; r4: 100 kΩ ±5 %. */
const BOARD: ModuleDef = defineModule({
  id: "fx-board",
  name: "Fixture board",
  interfaces: [Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" }), Net({ id: "sda", name: "SDA" }), Net({ id: "scl", name: "SCL" }), Net({ id: "en", name: "EN" })],
  children: [
    { id: "u1", moduleDefId: "fx-sensor" },
    { id: "r1", moduleDefId: "yageo-rc0402", name: "SDA pull-up", overrides: { resistance: 4700 } },
    { id: "r2", moduleDefId: "yageo-rc0402", name: "SCL pull-up", overrides: { resistance: 4700 } },
    { id: "r3", moduleDefId: "yageo-rc0402", name: "EN pull-up" },
    { id: "r4", moduleDefId: "yageo-rc0402", name: "EN pull-down", overrides: { resistance: 100e3, tolerance: 0.05 } },
  ],
  links: [
    ...netLinks("v3v3", ["u1:pin_1", "r1:pin_1", "r2:pin_1", "r3:pin_1"]),
    ...netLinks("gnd", ["u1:pin_2", "r4:pin_2"]),
    ...netLinks("sda", ["u1:pin_3", "r1:pin_2"]),
    ...netLinks("scl", ["u1:pin_4", "r2:pin_2"]),
    ...netLinks("en", ["u1:pin_5", "r3:pin_2", "r4:pin_1"]),
  ],
});

const DEFS = [RC0402, SENSOR, BOARD];
const lookup = (id: string) => DEFS.find((d) => d.id === id);

describe("placementPart", () => {
  it("resolves a series passive's overrides with the part's own ordering rule", () => {
    expect(placementPart(RC0402)).toEqual({ mpn: "RC0402FR-0710KL", value: { value: 10e3, unit: "Ω", tolerance: 0.01 }, overridden: false, problems: [] });
    expect(placementPart(RC0402, { resistance: 4700 })).toEqual({ mpn: "RC0402FR-074K7L", value: { value: 4700, unit: "Ω", tolerance: 0.01 }, overridden: true, problems: [] });
    expect(placementPart(RC0402, { resistance: 100e3, tolerance: 0.05 }).mpn).toBe("RC0402JR-07100KL");
    expect(placementPart(SENSOR, { anything: 1 })).toEqual({ mpn: "FX-1", overridden: false, problems: [] });
    expect(formatPassive({ value: 4700, unit: "Ω", tolerance: 0.01 })).toBe("4.7 kΩ ±1 %");
  });
});

describe("board netlist with per-placement values", () => {
  const n = boardNetlist(BOARD, lookup);
  const c = (id: string) => n.components.find((x) => x.instance === id)!;

  it("gives each placement its own value and MPN", () => {
    expect(n.problems).toEqual([]);
    expect(["r1", "r2", "r3", "r4"].map((id) => [id, c(id).mpn, c(id).value])).toEqual([
      ["r1", "RC0402FR-074K7L", { value: 4700, unit: "Ω", tolerance: 0.01 }],
      ["r2", "RC0402FR-074K7L", { value: 4700, unit: "Ω", tolerance: 0.01 }],
      ["r3", "RC0402FR-0710KL", { value: 10e3, unit: "Ω", tolerance: 0.01 }],
      ["r4", "RC0402JR-07100KL", { value: 100e3, unit: "Ω", tolerance: 0.05 }],
    ]);
    expect(c("r1")).toMatchObject({ part: "yageo-rc0402", kind: "resistor", overrides: { resistance: 4700 }, package: { name: "0402" } });
    expect(c("r3").overrides).toBeUndefined();
  });

  it("reports overrides the series does not allow as problems", () => {
    const bad = boardNetlist({ ...BOARD, children: [...BOARD.children!, { id: "r9", moduleDefId: "yageo-rc0402", overrides: { resistance: 20e6, power: 0.1 } }] }, lookup);
    expect(bad.problems).toEqual([
      "component r9 (yageo-rc0402): power is not an instance parameter of yageo-rc0402 (overridable: resistance, tolerance, part_number)",
      "component r9 (yageo-rc0402): resistance 20000000 Ω is not made at ±1 % (1–10000000 Ω)",
    ]);
  });
});

describe("a project placing the catalog part at two values", () => {
  const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-passives");
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));

  async function project(board: ModuleDef) {
    const dir = join(TMP, board.children!.length.toString());
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "protoboard.config.ts"), `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
    writeFileSync(
      join(dir, "src/sys.uhd.ts"),
      `export const SENSOR = ${JSON.stringify(SENSOR)};\nexport const BOARD = ${JSON.stringify(board)};\nexport const SYS = { id: "sys", name: "System", interfaces: [], children: [{ id: "board", moduleDefId: "fx-board", quantity: 2 }] };\n`,
    );
    vendorCatalogParts(dir, ["yageo-rc0402"]);
    return loadProject(dir);
  }

  it("build's BOM has one line per value, with the placement's MPN and the instances", async () => {
    const p = await project(BOARD);
    expect(p.instances.find((i) => i.path === "board/r4")?.overrides).toEqual({ resistance: 100e3, tolerance: 0.05 });
    const lines = bom(p).filter((l) => l.definition === "yageo-rc0402");
    expect(lines.map((l) => [l.partNumber, l.value, l.quantity, l.instances.join(" ")])).toEqual([
      ["RC0402FR-0710KL", "10 kΩ ±1 %", 2, "board/r3"],
      ["RC0402FR-074K7L", "4.7 kΩ ±1 %", 4, "board/r1 board/r2"],
      ["RC0402JR-07100KL", "100 kΩ ±5 %", 2, "board/r4"],
    ]);
    expect(p.diagnostics.filter((d) => d.code === "UHD_PASSIVE_OVERRIDE")).toEqual([]);
  });

  it("the UHD check reports a placement the series does not make", async () => {
    const p = await project({ ...BOARD, children: [...BOARD.children!, { id: "r9", moduleDefId: "yageo-rc0402", overrides: { resistance: 2e6, tolerance: 0.001 } }] });
    const found = p.diagnostics.filter((d) => d.code === "UHD_PASSIVE_OVERRIDE");
    expect(found.map((d) => [d.severity, d.message])).toEqual([["error", "board/r9 (yageo-rc0402): resistance 2000000 Ω is not made at ±0.1 % (10–1000000 Ω)"]]);
  });
});
