/**
 * The KiCad schematic the provider writes (PB-1032, lib/kicad/schematic.ts),
 * without KiCad: pin names as the model gives them, electrical types from the
 * UHD leaf types, a block per sub-module with its ICs first and their
 * passives beside them, a stub and a label at every connected pin, PWR_FLAGs
 * where no power output drives a rail, and everything on the grid.
 */
import { describe, expect, it } from "vitest";
import type { BoardComponent, BoardNetlist } from "@protoboardai/core";
import { buildSchematic, kicadPinType, pinName } from "../lib/kicad/schematic.ts";
import { child, children, findAll, property, text, type List } from "../lib/kicad/sexpr.ts";

const comp = (instance: string, kind: BoardComponent["kind"], pins: [string, string, BoardComponent["pins"][number]["kind"]][], group?: string): BoardComponent => ({
  instance,
  ...(group ? { group } : {}),
  part: `${kind}-part`,
  name: instance,
  kind,
  pins: pins.map(([pin, name, k]) => ({ interface: `p${pin}`, pin, name, kind: k })),
  bodies: [],
});

const netlist: BoardNetlist = {
  schema: "protoboard.board-netlist/v0",
  board: "demo",
  components: [
    comp("j1", "connector", [["1", "VBUS", "power_in"], ["2", "D+", "signal"], ["3", "D-", "signal"], ["4", "GND", "ground"], ["5", "GND", "ground"]]),
    comp("cmp/u1", "ic", [["1", "OUT", "signal"], ["2", "VEE", "ground"], ["3", "IN+", "signal"], ["4", "IN-", "signal"], ["5", "VCC", "power_in"]], "cmp"),
    comp("cmp/r1", "resistor", [["1", "1", "passive"], ["2", "2", "passive"]], "cmp"),
    comp("cmp/d1", "ic", [["1", "A (anode pad)", "passive"], ["2", "K (cathode pad, cathode mark notch)", "passive"]], "cmp"),
    comp("reg/u2", "ic", [["1", "VIN", "power_in"], ["2", "GND", "ground"], ["3", "VOUT", "power_out"], ["4", "VOUT", "power_out"], ["5", "NC", "nc"]], "reg"),
  ],
  nets: [],
  edge: [],
  groups: [
    { path: "cmp", module: "comparator", name: "Comparator" },
    { path: "reg", module: "regulator", name: "3.3 V regulator" },
  ],
  problems: [],
};
const refdes: Record<string, string> = { j1: "J1", "cmp/u1": "U1", "cmp/r1": "R1", "cmp/d1": "D1", "reg/u2": "U2" };
const padNets = new Map<string, Map<string, string>>([
  ["J1", new Map([["1", "vbus"], ["2", "dp"], ["3", "dn"], ["4", "gnd"], ["5", "gnd"]])],
  ["U1", new Map([["1", "out"], ["2", "gnd"], ["3", "light"], ["4", "ref"], ["5", "v3v3"]])],
  ["R1", new Map([["1", "out"], ["2", "v3v3"]])],
  ["D1", new Map([["1", "out"], ["2", "gnd"]])],
  ["U2", new Map([["1", "vbus"], ["2", "gnd"], ["3", "v3v3"], ["4", "v3v3"]])],
]);
const pads = new Map(netlist.components.map((c) => [c.instance, new Map(c.pins.map((p) => [p.pin, p.interface]))]));
const pinTypes = { "cmp/u1": { p1: kicadPinType("signal", { protocols: [{ type: "digital", roles: ["output"] }], capabilities: ["open_drain"] }), p3: kicadPinType("signal", { protocols: [{ type: "analog", roles: ["input"] }] }), p4: kicadPinType("signal", { protocols: [{ type: "analog", roles: ["input"] }] }) } };

const build = () =>
  buildSchematic({ board: "demo", lib: "demo", netlist, pads, refdes, fields: {}, footprint: (i) => `demo:${i}`, padNets, pinTypes, symbolUuid: Object.fromEntries(netlist.components.map((c, i) => [c.instance, `00000000-0000-4000-8000-00000000000${i}`])), uuid: (k) => `uuid-${k}` });

const pinsOf = (sym: List) => findAll(sym, "pin").filter((p) => child(p, "name"));

describe("the provider's KiCad schematic", () => {
  it("names pins as the model does: +, - and / kept, a note in brackets dropped", () => {
    expect(pinName("IN+")).toBe("IN+");
    expect(pinName("D-")).toBe("D-");
    expect(pinName("SCL/SPC")).toBe("SCL/SPC");
    expect(pinName("K (cathode pad, cathode mark notch)")).toBe("K");
    expect(pinName("GND (EPAD)")).toBe("GND");
    expect(pinName("VDD IO")).toBe("VDD_IO");
  });

  it("types pins from the UHD leaf: power in and out, input, output, open collector, bidirectional, passive", () => {
    expect(kicadPinType("ground")).toBe("power_in");
    expect(kicadPinType("power_out")).toBe("power_out");
    expect(kicadPinType("passive")).toBe("passive");
    expect(kicadPinType("signal", { protocols: [{ type: "digital", roles: ["input"] }] })).toBe("input");
    expect(kicadPinType("signal", { protocols: [{ type: "digital", roles: ["output"] }] })).toBe("output");
    expect(kicadPinType("signal", { protocols: [{ type: "digital", roles: ["output"] }], capabilities: ["open_drain"] })).toBe("open_collector");
    expect(kicadPinType("signal", { protocols: [{ type: "digital", roles: ["input", "output", "bidirectional"] }] })).toBe("bidirectional");
    expect(kicadPinType("signal", { protocols: [{ type: "passive", roles: ["terminal"] }] })).toBe("passive");
  });

  it("writes symbols with the model's pin names and types, one rail's output pins as one source", () => {
    const { libSymbols, pinNames } = build();
    const pin = (s: List, n: string) => pinsOf(s).find((p) => text(child(p, "number")?.items[1]) === n)!;
    expect([...pinNames.keys()].length).toBeGreaterThan(0);
    const names = [...new Set(libSymbols.flatMap((s) => pinsOf(s).map((p) => text(child(p, "name")?.items[1]))))];
    expect(names).toEqual(expect.arrayContaining(["IN+", "IN-", "OUT", "VCC", "VEE", "D+", "D-", "A", "K", "VOUT"]));
    // two pins named GND on one net keep one name; two VOUT pins on one rail: the second is not a second source
    expect(names).not.toContain("GND_2");
    const comparator = libSymbols.find((s) => pinsOf(s).some((p) => text(child(p, "name")?.items[1]) === "IN+"))!;
    expect(pin(comparator, "1").items[1]).toBe("open_collector");
    expect(pin(comparator, "3").items[1]).toBe("input");
    expect(pin(comparator, "5").items[1]).toBe("power_in");
    const reg = libSymbols.find((s) => pinsOf(s).some((p) => text(child(p, "name")?.items[1]) === "VOUT"))!;
    expect([pin(reg, "3").items[1], pin(reg, "4").items[1]]).toEqual(["power_out", "passive"]);
    expect(pin(reg, "5").items[1]).toBe("no_connect");
  });

  it("puts every pin and every symbol on the grid", () => {
    const { sch, libSymbols } = build();
    const onGrid = (v: string) => Math.abs(Number(v) / 1.27 - Math.round(Number(v) / 1.27)) < 1e-6;
    for (const s of libSymbols) for (const p of pinsOf(s)) for (const v of child(p, "at")!.items.slice(1, 3)) expect(onGrid(text(v)!), `${text(s.items[1])} ${text(v)}`).toBe(true);
    for (const s of children(sch, "symbol")) for (const v of child(s, "at")!.items.slice(1, 3)) expect(onGrid(text(v)!)).toBe(true);
  });

  it("lays out one titled block per sub-module, a stub and a label at each connected pin, a no-connect at the others, PWR_FLAGs where no output drives", () => {
    const { sch } = build();
    const texts = children(sch, "text").map((t) => text(t.items[1]));
    expect(texts).toEqual(expect.arrayContaining(["demo", "cmp", "Comparator", "reg", "3.3 V regulator", "Power flags"]));
    expect(children(sch, "rectangle")).toHaveLength(4);
    const labels = children(sch, "global_label");
    const wires = children(sch, "wire");
    const connected = [...padNets.values()].reduce((n, m) => n + m.size, 0);
    // each pin's label, and each flag's
    const flags = children(sch, "symbol").filter((s) => property(s, "Reference")?.startsWith("#FLG"));
    expect(labels).toHaveLength(connected + flags.length);
    expect(wires).toHaveLength(labels.length);
    expect(children(sch, "no_connect")).toHaveLength(1);
    // vbus and gnd have power inputs and no power output; v3v3 has the regulator's
    const labelAt = (x: number, y: number) => labels.find((l) => Math.abs(Number(text(child(l, "at")!.items[1])) - x) < 1e-6 && Math.abs(Number(text(child(l, "at")!.items[2])) - y) < 1e-6);
    const flagNets = flags.map((f) => {
      const [x, y] = child(f, "at")!.items.slice(1, 3).map((v) => Number(text(v)));
      return text(labelAt(x + 5.08, y)?.items[1]);
    });
    expect(flagNets.sort()).toEqual(["gnd", "vbus"]);
    // the comparator's resistor and LED sit beside it, to its right
    const at = (ref: string) => Number(text(child(children(sch, "symbol").find((s) => property(s, "Reference") === ref)!, "at")!.items[1]));
    expect(at("R1")).toBeGreaterThan(at("U1"));
  });
});
