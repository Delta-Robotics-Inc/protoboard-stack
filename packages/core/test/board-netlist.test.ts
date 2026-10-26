/**
 * Board netlist (PB-820): the tool-neutral first step of a circuit provider.
 * A small board written with UHD's own builders (pinTable, Passive, Net,
 * netLinks) is flattened into components, nets and edge, and the drift
 * comparison finds opens, shorts, stray connections and missing pins.
 */
import { describe, expect, it } from "vitest";
import { I2C, Net, Passive, defineModule, netLinks, pinTable, type ModuleDef } from "@deltarobotics/uhd";
import { boardNetlist, netlistDrift, netlistReport } from "../src/index.js";

const SRC = "test fixture (not a real part)";

const SENSOR: ModuleDef = defineModule({
  id: "fx-sensor",
  name: "Fixture sensor",
  manufacturer: "Fixture Co",
  part_number: "FX-1",
  interfaces: [
    ...pinTable(
      [
        { pin: 1, name: "VDD", type: "power_in", voltageV: [1.7, 3.6], nominalV: 3.3 },
        [2, "GND", "ground"],
        { pin: 3, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
        { pin: 4, name: "SCL", type: "input", capabilities: ["i2c_scl"] },
        [5, "NC", "nc"],
        [6, "GND", "ground"],
      ],
      { source: SRC, logicV: [1.7, 3.6] },
    ),
    ...I2C({ id: "i2c", sda: "pin_3", scl: "pin_4" }),
  ],
  domains: [{ domain: "mechanical", dimensions_mm: { length: 2, width: 2, height: 0.8 }, package: { name: "DFN-6", pin_count: 6, pitch_mm: 0.65, exposed_pad: false } }],
});

const CONN: ModuleDef = defineModule({
  id: "fx-header",
  name: "Fixture 3-pin header",
  categories: ["connector"],
  interfaces: pinTable([{ pin: 1, name: "VIN", type: "power_in", voltageV: [3, 3.6] }, [2, "GND", "ground"], [3, "SIG", "io"]], { source: SRC, logicV: [0, 3.6] }),
});

const R10K = Passive({ id: "fx-r-10k", name: "10 kΩ 0402", kind: "resistor", value: 10e3, unit: "Ω", tolerance: 0.01, package: { name: "0402", pin_count: 2, exposed_pad: false } });

const BOARD: ModuleDef = defineModule({
  id: "fx-board",
  name: "Fixture board",
  interfaces: [Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" }), Net({ id: "sda", name: "SDA" })],
  children: [
    { id: "u1", moduleDefId: "fx-sensor", name: "Sensor" },
    { id: "j1", moduleDefId: "fx-header" },
    { id: "r1", moduleDefId: "fx-r-10k", name: "SDA pull-up" },
  ],
  links: [
    ...netLinks("v3v3", ["j1:pin_1", "u1:pin_1", "r1:pin_1"]),
    ...netLinks("gnd", ["j1:pin_2", "u1:pin_2", "u1:pin_6"]),
    ...netLinks("sda", ["u1:pin_3", "r1:pin_2"]),
    // a plain pin-to-pin link is a net too
    { id: "sig", a: { child: "j1", interfaceId: "pin_3" }, b: { child: "u1", interfaceId: "pin_4" } },
  ],
  exports: [
    { id: "power", name: "Power", from: { child: "j1", interfaceId: "pin_1" } },
    { id: "bus", name: "I2C", from: { child: "u1", interfaceId: "i2c" } },
  ],
  traits: [{ type: "design_envelope", params: { max_mm: { length: 20, width: 10 }, reason: "fixture" } }],
});

const DEFS = [SENSOR, CONN, R10K, BOARD];
const lookup = (id: string) => DEFS.find((d) => d.id === id);

describe("boardNetlist", () => {
  const n = boardNetlist(BOARD, lookup);

  it("lists each component with its part, kind, package facts and designated pins", () => {
    expect(n.problems).toEqual([]);
    expect(n.components.map((c) => [c.instance, c.part, c.kind])).toEqual([
      ["u1", "fx-sensor", "ic"],
      ["j1", "fx-header", "connector"],
      ["r1", "fx-r-10k", "resistor"],
    ]);
    const u1 = n.components[0];
    expect(u1).toMatchObject({ name: "Sensor", manufacturer: "Fixture Co", mpn: "FX-1", package: { name: "DFN-6", pin_count: 6, size_mm: { length: 2, width: 2 } } });
    expect(u1.pins.map((p) => `${p.pin}:${p.interface}:${p.kind}`)).toEqual(["1:pin_1:power_in", "2:pin_2:ground", "3:pin_3:signal", "4:pin_4:signal", "5:pin_5:nc", "6:pin_6:ground"]);
    expect(n.components[2].value).toEqual({ value: 10e3, unit: "Ω", tolerance: 0.01 });
  });

  it("builds nets from membership links and pin-to-pin links, with kinds and voltages", () => {
    expect(n.nets.map((x) => [x.id, x.name, x.kind, x.pins.join(" ")])).toEqual([
      ["gnd", "GND", "ground", "j1:pin_2 u1:pin_2 u1:pin_6"],
      ["sda", "SDA", "signal", "r1:pin_2 u1:pin_3"],
      ["sig", "sig", "signal", "j1:pin_3 u1:pin_4"],
      ["v3v3", "3V3", "power", "j1:pin_1 r1:pin_1 u1:pin_1"],
    ]);
    expect(n.nets.find((x) => x.id === "v3v3")?.voltageV).toBe(3.3);
    expect(n.nets.find((x) => x.id === "sig")?.links).toEqual(["sig"]);
  });

  it("reports the edge with the leaf pins each export carries, and the envelope", () => {
    expect(n.edge).toEqual([
      { id: "power", name: "Power", instance: "j1", interface: "pin_1", pins: ["j1:pin_1"] },
      { id: "bus", name: "I2C", instance: "u1", interface: "i2c", pins: ["u1:pin_3", "u1:pin_4"] },
    ]);
    expect(n.envelope?.max_mm).toEqual({ length: 20, width: 10 });
  });

  it("refuses a composite linked to a pin, a pairing UHD finds incompatible, and parts it cannot find, without throwing", () => {
    const bad = boardNetlist(
      {
        ...BOARD,
        children: [...BOARD.children!, { id: "u2", moduleDefId: "fx-sensor" }, { id: "x1", moduleDefId: "nope" }],
        links: [...BOARD.links!, { id: "half", a: { child: "u1", interfaceId: "i2c" }, b: { child: "j1", interfaceId: "pin_3" } }, { id: "bus", a: { child: "u1", interfaceId: "i2c" }, b: { child: "u2", interfaceId: "i2c" } }],
      },
      lookup,
    );
    expect(bad.problems.join("\n")).toMatch(/x1: part nope is not defined/);
    expect(bad.problems.join("\n")).toMatch(/link half joins u1:i2c, a composite interface/);
    // two controllers' ports: UHD does not pair them (docs/specs/nested-boards.md §4.4)
    expect(bad.problems.join("\n")).toMatch(/link bus pairs u1:i2c with u2:i2c, which UHD finds incompatible/);
  });

  it("writes the intended nets as a protoboard.netlist/v0 report", () => {
    const r = netlistReport(n);
    expect(r.schema).toBe("protoboard.netlist/v0");
    expect(r.nets.find((x) => x.id === "sig")).toEqual({ id: "sig", link: "sig", pins: ["j1:pin_3", "u1:pin_4"] });
  });
});

describe("netlistDrift", () => {
  const intended = [
    { id: "a", pins: ["u1:p1", "u2:p1", "u3:p1"] },
    { id: "b", pins: ["u1:p2", "u2:p2"] },
    { id: "c", pins: ["u1:p3", "u2:p3"] },
  ];
  const present = new Set(["u1:p1", "u2:p1", "u3:p1", "u1:p2", "u2:p2", "u1:p3", "u2:p3", "u1:p4"]);

  it("finds nothing when copper matches the model", () => {
    expect(netlistDrift(intended, [{ pins: ["u1:p1", "u2:p1", "u3:p1"] }, { pins: ["u1:p2", "u2:p2"] }, { pins: ["u1:p3", "u2:p3"] }], present)).toEqual([]);
  });

  it("reports opens, shorts, unrouted nets, stray connections and missing pins", () => {
    const found = netlistDrift(
      intended,
      [{ pins: ["u1:p1", "u2:p1"] }, { pins: ["u3:p1"] }, { pins: ["u1:p2", "u2:p2", "u1:p4"] }],
      new Set([...present].filter((p) => p !== "u2:p3")),
    );
    expect(found.map((f) => `${f.code}:${f.net ?? ""}`)).toEqual(["net_open:a", "pin_missing:c", "extra_connection:b"]);
    const shorted = netlistDrift(intended, [{ pins: ["u1:p1", "u2:p1", "u3:p1", "u1:p2", "u2:p2"] }, { pins: ["u1:p3", "u2:p3"] }], present);
    expect(shorted.map((f) => f.code)).toEqual(["net_short"]);
    expect(shorted[0].message).toMatch(/copper joins nets a \+ b/);
    const unrouted = netlistDrift(intended, [{ pins: ["u1:p1", "u2:p1", "u3:p1"] }, { pins: ["u1:p2", "u2:p2"] }], present);
    expect(unrouted.map((f) => `${f.code}:${f.net}`)).toEqual(["net_unrouted:c"]);
  });
});
