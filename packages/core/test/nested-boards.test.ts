/**
 * Nested boards (docs/specs/nested-boards.md): a board's sub-modules expanded
 * into one netlist. Each rule of the spec and each error case, on small
 * boards written with UHD's own builders.
 */
import { describe, expect, it } from "vitest";
import { Connector, I2C, Net, Passive, checkSystem, defineModule, netLinks, pinTable, type ModuleDef } from "@deltarobotics/uhd";
import { boardChildRole, boardFirmware, boardNetlist, type BoardNetlist } from "../src/index.js";

const SRC = "test fixture (not a real part)";
const pkg = (name: string, pin_count: number) => [{ domain: "mechanical" as const, package: { name, pin_count, exposed_pad: false } }];

const R = Passive({ id: "fx-r", name: "10 kΩ 0402", kind: "resistor", value: 10e3, unit: "Ω", package: { name: "0402", pin_count: 2, exposed_pad: false } });
const C = Passive({ id: "fx-c", name: "100 nF 0402", kind: "capacitor", value: 100e-9, unit: "F", package: { name: "0402", pin_count: 2, exposed_pad: false } });
const MCU: ModuleDef = defineModule({
  id: "fx-mcu",
  name: "Controller",
  categories: ["microcontroller"],
  interfaces: [
    ...pinTable(
      [
        { pin: 1, name: "VDD", type: "power_in", voltageV: [1.8, 3.6] },
        { pin: 2, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
        { pin: 3, name: "SCL", type: "io", capabilities: ["i2c_scl"] },
        [4, "GPIO", "io"],
        [5, "GND", "ground"],
      ],
      { source: SRC, logicV: [0, 3.6] },
    ),
    ...I2C({ id: "i2c0", roles: ["master"], sda: "pin_2", scl: "pin_3" }),
  ],
  domains: pkg("SOT-23-5", 5),
});
const SENSOR: ModuleDef = defineModule({
  id: "fx-sensor",
  name: "Sensor",
  interfaces: [
    ...pinTable(
      [
        { pin: 1, name: "VDD", type: "power_in", voltageV: [1.8, 3.6] },
        { pin: 2, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
        { pin: 3, name: "SCL", type: "input", capabilities: ["i2c_scl"] },
        [4, "GND", "ground"],
      ],
      { source: SRC, logicV: [0, 3.6] },
    ),
    ...I2C({ id: "i2c", roles: ["slave"], address: 0x48, sda: "pin_2", scl: "pin_3" }),
  ],
  domains: pkg("DFN-4", 4),
});
const HEADER: ModuleDef = defineModule({
  id: "fx-header",
  name: "Header",
  categories: ["connector"],
  interfaces: [...pinTable([{ pin: 1, name: "VIN", type: "power_in", voltageV: [3, 3.6] }, [2, "GND", "ground"]], { source: SRC }), Connector({ id: "port", name: "Port", connector: "fx_2", gender: "header", pins: [["VIN", "pin_1"], ["GND", "pin_2"]] })],
  domains: pkg("FX-2", 2),
});
const SOCKET: ModuleDef = defineModule({
  id: "fx-socket",
  name: "Socket",
  categories: ["connector"],
  interfaces: [...pinTable([{ pin: 1, name: "VIN", type: "power_in", voltageV: [3, 3.6] }, [2, "GND", "ground"]], { source: SRC }), Connector({ id: "port", name: "Port", connector: "fx_2", gender: "receptacle", pins: [["VIN", "pin_1"], ["GND", "pin_2"]] })],
  domains: pkg("FX-2", 2),
});

/** A sensor sub-module: its own nets and decoupling, a pin exported per rail, its I2C port exported whole. */
const SENSE: ModuleDef = defineModule({
  id: "fx-sense",
  name: "Sense",
  interfaces: [Net({ id: "vdd", name: "VDD", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" })],
  children: [
    { id: "s1", moduleDefId: "fx-sensor" },
    { id: "c1", moduleDefId: "fx-c" },
  ],
  links: [...netLinks("vdd", ["s1:pin_1", "c1:pin_1"]), ...netLinks("gnd", ["s1:pin_4", "c1:pin_2"])],
  exports: [
    { id: "vdd_port", from: { child: "s1", interfaceId: "pin_1" } },
    { id: "gnd_port", from: { child: "s1", interfaceId: "pin_4" } },
    { id: "i2c", from: { child: "s1", interfaceId: "i2c" } },
  ],
});

/** A channel used twice: an inner net, two exported pins. */
const CHANNEL: ModuleDef = defineModule({
  id: "fx-channel",
  name: "Channel",
  interfaces: [Net({ id: "mid", name: "MID" })],
  children: [
    { id: "r1", moduleDefId: "fx-r" },
    { id: "r2", moduleDefId: "fx-r" },
  ],
  links: [...netLinks("mid", ["r1:pin_2", "r2:pin_1"])],
  exports: [
    { id: "top", from: { child: "r1", interfaceId: "pin_1" } },
    { id: "bottom", from: { child: "r2", interfaceId: "pin_2" } },
  ],
});

/** An organisational group: wired entirely by its parent through `<child>__<interface>`. */
const DECOUPLING: ModuleDef = defineModule({ id: "fx-decoupling", name: "Decoupling", kind: "group", interfaces: [], children: [{ id: "c1", moduleDefId: "fx-c" }] });

const BOARD: ModuleDef = defineModule({
  id: "fx-board",
  name: "Grouped board",
  interfaces: [Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" }), Net({ id: "ctl", name: "CTL" })],
  children: [
    { id: "u1", moduleDefId: "fx-mcu" },
    { id: "sense", moduleDefId: "fx-sense" },
    { id: "ch1", moduleDefId: "fx-channel" },
    { id: "ch2", moduleDefId: "fx-channel" },
    { id: "dec", moduleDefId: "fx-decoupling" },
  ],
  links: [
    ...netLinks("v3v3", ["u1:pin_1", "sense:vdd_port", "ch1:top", "ch2:top", "dec:c1__pin_1"]),
    ...netLinks("gnd", ["u1:pin_5", "sense:gnd_port", "ch1:bottom", "ch2:bottom", "dec:c1__pin_2"]),
    { id: "bus", a: { child: "u1", interfaceId: "i2c0" }, b: { child: "sense", interfaceId: "i2c" } },
    ...netLinks("ctl", ["u1:pin_4"]),
  ],
});

const DEFS = [R, C, MCU, SENSOR, HEADER, SOCKET, SENSE, CHANNEL, DECOUPLING, BOARD];
const lookupWith = (extra: ModuleDef[] = []) => (id: string) => [...extra, ...DEFS].find((d) => d.id === id);
const lookup = lookupWith();
const net = (n: BoardNetlist, id: string) => n.nets.find((x) => x.id === id);

describe("nested boards: which children are expanded (spec §2)", () => {
  const n = boardNetlist(BOARD, lookup);

  it("expands sub-modules into parts under their paths, in tree order", () => {
    expect(n.problems).toEqual([]);
    expect(n.components.map((c) => c.instance)).toEqual(["u1", "sense/s1", "sense/c1", "ch1/r1", "ch1/r2", "ch2/r1", "ch2/r2", "dec/c1"]);
    expect(n.components.find((c) => c.instance === "ch2/r1")?.group).toBe("ch2");
    expect(n.components.find((c) => c.instance === "u1")?.group).toBeUndefined();
    expect(n.groups).toEqual([
      { path: "sense", module: "fx-sense", name: "Sense" },
      { path: "ch1", module: "fx-channel", name: "Channel" },
      { path: "ch2", module: "fx-channel", name: "Channel" },
      { path: "dec", module: "fx-decoupling", name: "Decoupling" },
    ]);
  });

  it("classifies by the first rule that applies: harness, part, board, mated, sub-module", () => {
    const parent = { ...BOARD, links: [] };
    const ref = { id: "x", moduleDefId: "?" };
    expect(boardChildRole(MCU, ref, parent, lookup)).toBe("part");
    expect(boardChildRole(SENSE, ref, parent, lookup)).toBe("submodule");
    expect(boardChildRole(DECOUPLING, ref, parent, lookup)).toBe("submodule");
    expect(boardChildRole({ ...DECOUPLING, children: [] }, ref, parent, lookup)).toBe("submodule"); // an empty group is still a group
    // a bought module with contents is one part
    expect(boardChildRole({ ...SENSE, part_number: "FX-MOD-1" }, ref, parent, lookup)).toBe("part");
    expect(boardChildRole({ ...SENSE, kind: "harness" }, ref, parent, lookup)).toBe("harness");
    expect(boardChildRole({ ...SENSE, traits: [{ type: "design_envelope", params: { max_mm: { length: 10, width: 10 } } }] }, ref, parent, lookup)).toBe("board");
    expect(boardChildRole(SENSE, ref, parent, lookup, { isBoard: (id) => id === "fx-sense" })).toBe("board");
  });

  it("keeps a daughterboard mated by connector, a child board and a harness off this PCB", () => {
    const DAUGHTER: ModuleDef = defineModule({ id: "fx-daughter", name: "Daughterboard", interfaces: [], children: [{ id: "j1", moduleDefId: "fx-socket" }, { id: "r1", moduleDefId: "fx-r" }], exports: [{ id: "port", from: { child: "j1", interfaceId: "port" } }] });
    const CARRIER: ModuleDef = defineModule({
      id: "fx-carrier",
      name: "Carrier",
      interfaces: [Net({ id: "gnd", name: "GND" })],
      children: [{ id: "j1", moduleDefId: "fx-header" }, { id: "d", moduleDefId: "fx-daughter" }, { id: "u1", moduleDefId: "fx-mcu" }],
      links: [{ id: "mate", a: { child: "j1", interfaceId: "port" }, b: { child: "d", interfaceId: "port" } }, ...netLinks("gnd", ["j1:pin_2", "u1:pin_5"])],
    });
    const c = boardNetlist(CARRIER, lookupWith([DAUGHTER, CARRIER]));
    expect(c.problems).toEqual([]); // the mate is not a conductor of this PCB
    expect(c.components.map((x) => x.instance)).toEqual(["j1", "u1"]);
    expect(c.boundaries).toEqual([{ instance: "d", module: "fx-daughter", reason: "mated" }]);

    // a net of this board reaching into a separate board is an error
    const into = boardNetlist({ ...BOARD, links: [...BOARD.links!, ...netLinks("gnd", ["ch1:bottom"]).map((l) => ({ ...l, id: "gnd.x" }))] }, lookup, { isBoard: (id) => id === "fx-channel" });
    expect(into.boundaries?.map((b) => `${b.instance} ${b.reason}`)).toEqual(["ch1 board", "ch2 board"]);
    expect(into.problems.join("\n")).toMatch(/link gnd\.ch1\.bottom joins ch1:bottom, which is on ch1 \(fx-channel\), a separate board, not on this PCB/);
  });
});

describe("nested boards: nets across the boundary (spec §4, §5)", () => {
  const n = boardNetlist(BOARD, lookup);

  it("joins a board net to a sub-module's net through the exported pin; the shallowest net names the conductor", () => {
    expect(net(n, "v3v3")).toMatchObject({ name: "3V3", kind: "power", voltageV: 3.3, aliases: ["sense:vdd"] });
    expect(net(n, "v3v3")?.pins).toEqual(["ch1/r1:pin_1", "ch2/r1:pin_1", "dec/c1:pin_1", "sense/c1:pin_1", "sense/s1:pin_1", "u1:pin_1"]);
    expect(net(n, "gnd")?.aliases).toEqual(["sense:gnd"]);
    expect(net(n, "gnd")?.pins).toContain("sense/c1:pin_2"); // on the sub-module's own gnd only, reached through s1's exported pin
  });

  it("names a net wholly inside a sub-module by its UHD canonical path; a definition used twice gives two nets", () => {
    expect(net(n, "ch1:mid")).toMatchObject({ name: "ch1/MID", pins: ["ch1/r1:pin_2", "ch1/r2:pin_1"], links: ["ch1/mid.r1.pin_2", "ch1/mid.r2.pin_1"] });
    expect(net(n, "ch2:mid")?.pins).toEqual(["ch2/r1:pin_2", "ch2/r2:pin_1"]);
  });

  it("wires an organisational group through its implicit exports", () => {
    expect(net(n, "gnd")?.pins).toContain("dec/c1:pin_2");
  });

  it("carries a bus into a sub-module as one link between composites, paired line by line by UHD", () => {
    const sda = n.nets.find((x) => x.pins.includes("u1:pin_2"));
    expect(sda).toMatchObject({ id: "bus.sda", pins: ["sense/s1:pin_2", "u1:pin_2"], links: ["bus.sda"] });
    expect(n.nets.find((x) => x.pins.includes("u1:pin_3"))?.pins).toEqual(["sense/s1:pin_3", "u1:pin_3"]);
  });

  it("treats a sub-module's own pin linked inside and outside as a junction", () => {
    const PORTED: ModuleDef = defineModule({
      id: "fx-ported",
      name: "Ported",
      interfaces: [...pinTable([[1, "IN", "io"]], { source: SRC })],
      children: [{ id: "r1", moduleDefId: "fx-r" }],
      links: [{ id: "in", a: { self: true, interfaceId: "pin_1" }, b: { child: "r1", interfaceId: "pin_1" } }],
    });
    const b = boardNetlist({ ...BOARD, children: [...BOARD.children!, { id: "p", moduleDefId: "fx-ported" }], links: [...BOARD.links!, ...netLinks("ctl", ["p:pin_1"])] }, lookupWith([PORTED]));
    expect(b.problems).toEqual([]);
    expect(net(b, "ctl")?.pins).toEqual(["p/r1:pin_1", "u1:pin_4"]);
  });
});

describe("nested boards: error cases (spec §11)", () => {
  it("warns of a declared export the parent leaves unconnected, unless the child marks it", () => {
    const loose = boardNetlist({ ...BOARD, links: BOARD.links!.filter((l) => l.id !== "gnd.ch2.bottom") }, lookup);
    expect(loose.problems).toEqual([]);
    expect(loose.notes).toEqual(["ch2 exports bottom (ch2/r2:pin_2), which fx-board leaves unconnected; mark it unconnected on ch2 (ChildModuleRef.unconnected) if that is intended"]);
    const marked = boardNetlist(
      { ...BOARD, children: BOARD.children!.map((c) => (c.id === "ch2" ? { ...c, unconnected: [{ interfaceId: "bottom", reason: "fixture" }] } : c)), links: BOARD.links!.filter((l) => l.id !== "gnd.ch2.bottom") },
      lookup,
    );
    expect(marked.notes).toBeUndefined();
  });

  it("takes the shallowest stated voltage: a net that states none does not conflict", () => {
    const n = boardNetlist({ ...BOARD, interfaces: BOARD.interfaces.map((i) => (i.id === "v3v3" ? Net({ id: "v3v3", name: "3V3" }) : i)) }, lookup);
    expect(n.problems).toEqual([]);
    expect(net(n, "v3v3")?.voltageV).toBe(3.3);
  });

  it("warns of a sub-module with no parts", () => {
    const empty = boardNetlist({ ...BOARD, children: [...BOARD.children!, { id: "nothing", moduleDefId: "fx-empty" }] }, lookupWith([{ id: "fx-empty", name: "Empty", kind: "group", interfaces: [], children: [] }]));
    expect(empty.notes).toEqual(["sub-module nothing (fx-empty) contributes no parts to the board"]);
  });

  it("refuses quantity on a sub-module, a link to a sub-module's own net, two nets of one module joined, and conflicting voltages", () => {
    const q = boardNetlist({ ...BOARD, children: BOARD.children!.map((c) => (c.id === "ch1" ? { ...c, quantity: 2 } : c)) }, lookup);
    expect(q.problems).toEqual(["sub-module ch1 (fx-channel) has quantity 2: a board places each part, so give each copy its own child"]);

    const own = boardNetlist({ ...BOARD, links: [...BOARD.links!, { id: "x", a: { child: "u1", interfaceId: "pin_4" }, b: { child: "ch1", interfaceId: "mid" } }] }, lookup);
    expect(own.problems.join("\n")).toMatch(/link x joins ch1:mid, a net of the sub-module ch1 that it does not export; a net joins pins on the module that declares it \(UHD net_not_own\)/);

    // ch1 exports two pins of its mid net when the parent joins both to different board nets
    const SHORT: ModuleDef = { ...CHANNEL, id: "fx-short", exports: [{ id: "top", from: { child: "r1", interfaceId: "pin_2" } }, { id: "bottom", from: { child: "r2", interfaceId: "pin_1" } }] };
    const short = boardNetlist({ ...BOARD, children: BOARD.children!.map((c) => (c.id === "ch1" ? { ...c, moduleDefId: "fx-short" } : c)) }, lookupWith([SHORT]));
    expect(short.problems).toContain("nets gnd, v3v3 are joined by links into one conductor");
    expect(short.problems).toContain("in sense (fx-sense): nets gnd, vdd are joined by links into one conductor");

    const HOT: ModuleDef = { ...SENSE, id: "fx-hot", interfaces: [Net({ id: "vdd", name: "VDD", voltageV: 5 }), Net({ id: "gnd", name: "GND" })] };
    const hot = boardNetlist({ ...BOARD, children: BOARD.children!.map((c) => (c.id === "sense" ? { ...c, moduleDefId: "fx-hot" } : c)) }, lookupWith([HOT]));
    expect(hot.problems).toEqual(["net v3v3 is joined to sense:vdd, which states 5 V against 3.3 V"]);
  });

  it("stops at a definition that contains itself", () => {
    const LOOP: ModuleDef = { id: "fx-loop", name: "Loop", kind: "group", interfaces: [], children: [{ id: "again", moduleDefId: "fx-loop" }] };
    const loop = boardNetlist({ ...BOARD, children: [{ id: "l", moduleDefId: "fx-loop" }], links: [] }, lookupWith([LOOP]));
    expect(loop.problems.join("\n")).toMatch(/is nested more than 16 deep \(a definition that contains itself\?\)/);
  });

  it("reports a part a sub-module uses that is not defined, with its path", () => {
    const LOST: ModuleDef = { ...CHANNEL, id: "fx-lost", children: [{ id: "r1", moduleDefId: "fx-r" }, { id: "r2", moduleDefId: "nope" }] };
    const lost = boardNetlist({ ...BOARD, children: BOARD.children!.map((c) => (c.id === "ch1" ? { ...c, moduleDefId: "fx-lost" } : c)) }, lookupWith([LOST]));
    expect(lost.problems.join("\n")).toMatch(/component ch1\/r2: part nope is not defined/);
  });
});

describe("nested boards: what firmware reads (spec §10)", () => {
  it("finds the controller and its bus among the expanded components", () => {
    const board: ModuleDef = { ...BOARD, children: BOARD.children!.map((c) => (c.id === "u1" ? { ...c, id: "u1" } : c)) };
    const fw = boardFirmware(board, lookup);
    expect(fw.controller?.instance).toBe("u1");
    // a controller inside a sub-module is found by its path
    const CORE: ModuleDef = defineModule({ id: "fx-core", name: "Core", kind: "group", interfaces: [], children: [{ id: "mcu", moduleDefId: "fx-mcu" }] });
    const deep = boardFirmware({ ...BOARD, children: [{ id: "core", moduleDefId: "fx-core" }], links: [] }, lookupWith([CORE]));
    expect(deep.controller?.instance).toBe("core/mcu");
  });
});

/**
 * UHD 0.3.0 (docs/specs/nested-boards.md §4.2, §12; review-tools r6/uhd-nested-followup.md §3): a
 * sub-module exports its own net as a net port, `{ self: true, interfaceId }`, and a module marked
 * `kind: "board"` is one PCB.
 */
describe("nested boards: net ports and the board marker (UHD 0.3.0)", () => {
  /** The sensor sub-module of BOARD with its rails ported (the ports take the nets' ids) instead of a pin of each. */
  const SENSE_PORTED: ModuleDef = defineModule({
    ...SENSE,
    id: "fx-sense-ported",
    exports: [
      { id: "vdd", from: { self: true, interfaceId: "vdd" } },
      { id: "gnd", from: { self: true, interfaceId: "gnd" } },
      { id: "i2c", from: { child: "s1", interfaceId: "i2c" } },
    ],
  });
  const PORTED_BOARD: ModuleDef = defineModule({
    ...BOARD,
    id: "fx-board-ported",
    children: BOARD.children!.map((c) => (c.id === "sense" ? { ...c, moduleDefId: "fx-sense-ported" } : c)),
    links: [
      ...netLinks("v3v3", ["u1:pin_1", "sense:vdd", "ch1:top", "ch2:top", "dec:c1__pin_1"]),
      ...netLinks("gnd", ["u1:pin_5", "sense:gnd", "ch1:bottom", "ch2:bottom", "dec:c1__pin_2"]),
      { id: "bus", a: { child: "u1", interfaceId: "i2c0" }, b: { child: "sense", interfaceId: "i2c" } },
      ...netLinks("ctl", ["u1:pin_4"]),
    ],
  });
  const plook = lookupWith([SENSE_PORTED, PORTED_BOARD]);
  const conductors = (n: BoardNetlist) => n.nets.map((x) => ({ id: x.id, name: x.name, kind: x.kind, voltageV: x.voltageV, pins: x.pins, aliases: x.aliases }));

  it("is a board UHD accepts: no net_not_own, the rails crossing by port", () => {
    const errors = checkSystem(PORTED_BOARD, plook).diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("gives the same conductors, pins and aliases as the exported-pin idiom", () => {
    const pinned = boardNetlist(BOARD, lookup);
    const ported = boardNetlist(PORTED_BOARD, plook);
    expect(ported.problems).toEqual([]);
    expect(ported.notes).toBeUndefined();
    expect(conductors(ported)).toEqual(conductors(pinned));
    expect(net(ported, "v3v3")?.links).toContain("v3v3.sense.vdd");
  });

  it("joins a port whose id differs from its net, and a pin linked straight to a port", () => {
    const RENAMED: ModuleDef = defineModule({ ...SENSE, id: "fx-sense-renamed", exports: [{ id: "supply", from: { self: true, interfaceId: "vdd" } }, { id: "ground", from: { self: true, interfaceId: "gnd" } }, { id: "i2c", from: { child: "s1", interfaceId: "i2c" } }] });
    const board: ModuleDef = {
      ...PORTED_BOARD,
      children: [...PORTED_BOARD.children!, { id: "aux", moduleDefId: "fx-sense-renamed" }],
      links: [
        ...PORTED_BOARD.links!,
        ...netLinks("gnd", ["aux:ground"]),
        // the controller's GPIO straight onto aux's supply port: one conductor with aux's vdd net
        { id: "tap", a: { child: "u1", interfaceId: "pin_4" }, b: { child: "aux", interfaceId: "supply" } },
      ],
    };
    const n = boardNetlist(board, lookupWith([SENSE_PORTED, RENAMED]));
    expect(n.problems).toEqual([]);
    expect(n.nets.find((x) => x.pins.includes("aux/s1:pin_1"))).toMatchObject({ id: "ctl", aliases: ["aux:vdd"], pins: ["aux/c1:pin_1", "aux/s1:pin_1", "u1:pin_4"] });
    expect(net(n, "gnd")?.pins).toContain("aux/c1:pin_2");
  });

  it("still refuses a child's net that has no port (net_not_own)", () => {
    const own = boardNetlist({ ...PORTED_BOARD, links: [...PORTED_BOARD.links!, { id: "x", a: { child: "u1", interfaceId: "pin_4" }, b: { child: "ch1", interfaceId: "mid" } }] }, plook);
    expect(own.problems.join("\n")).toMatch(/link x joins ch1:mid, a net of the sub-module ch1 that it does not export; .*export the net as a net port/);
  });

  it("notes a net port the parent leaves unconnected, unless the child marks it", () => {
    const loose = boardNetlist({ ...PORTED_BOARD, links: PORTED_BOARD.links!.filter((l) => l.id !== "gnd.sense.gnd") }, plook);
    expect(loose.notes).toEqual(["sense exports gnd (a net port, sense:gnd), which fx-board-ported leaves unconnected; mark it unconnected on sense (ChildModuleRef.unconnected) if that is intended"]);
  });

  it("puts a net port on the board's edge as the whole conductor of its net, the board's own or re-exported", () => {
    const edged: ModuleDef = { ...PORTED_BOARD, exports: [{ id: "v3v3", from: { self: true, interfaceId: "v3v3" } }, { id: "sense_gnd", name: "Sensor GND", from: { child: "sense", interfaceId: "gnd" } }] };
    const n = boardNetlist(edged, plook);
    expect(n.problems).toEqual([]);
    expect(n.edge).toEqual([
      { id: "v3v3", name: "3V3", instance: "", interface: "v3v3", net: "v3v3", pins: net(n, "v3v3")!.pins },
      { id: "sense_gnd", name: "Sensor GND", instance: "sense", interface: "gnd", net: "gnd", pins: net(n, "gnd")!.pins },
    ]);
  });

  it("keeps a child marked kind: board off this PCB, before any other signal; a part number still makes a part", () => {
    const parent = { ...BOARD, links: [] };
    const ref = { id: "x", moduleDefId: "?" };
    expect(boardChildRole({ ...SENSE, kind: "board" }, ref, parent, lookup)).toBe("board");
    expect(boardChildRole({ ...MCU, domains: undefined, kind: "board", children: undefined }, ref, parent, lookup)).toBe("board");
    expect(boardChildRole({ ...SENSE, kind: "board", part_number: "FX-MOD-1" }, ref, parent, lookup)).toBe("part");
    const MARKED: ModuleDef = { ...CHANNEL, id: "fx-channel-board", kind: "board" };
    const n = boardNetlist({ ...BOARD, children: BOARD.children!.map((c) => (c.id === "ch2" ? { ...c, moduleDefId: "fx-channel-board" } : c)), links: BOARD.links!.filter((l) => !l.id.includes(".ch2.")) }, lookupWith([MARKED]));
    expect(n.problems).toEqual([]);
    expect(n.boundaries).toEqual([{ instance: "ch2", module: "fx-channel-board", reason: "board" }]);
    expect(n.components.some((c) => c.instance.startsWith("ch2/"))).toBe(false);
  });
});
