/**
 * The KiCad handoff without KiCad (docs/specs/pcb-kicad-handoff.md): the
 * S-expression reader and writer, reference designators, reading KiCad's
 * board, schematic and netlist files (test/fixtures/kicad), and the
 * three-way comparison check makes on a locked board.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatValue } from "../lib/kicad/fields.ts";
import { compare, comparisonDiagnostics, HANDOFF_SCHEMA, type Handoff } from "../lib/kicad/handoff.ts";
import { diffNetlists, netParity, parityProblems, readBoardNetlist, readKicadNetlist, readSchematicParts, type Netlist } from "../lib/kicad/netlists.ts";
import { libItemName, stableUuid } from "../lib/kicad/project.ts";
import { assignRefdes, emptyRefdes } from "../lib/kicad/refdes.ts";
import { child, children, parse, print, printDocument, property, str, text } from "../lib/kicad/sexpr.ts";

const FIX = fileURLToPath(new URL("./fixtures/kicad/", import.meta.url));
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const REFDES = { j1: "J1", r1: "R1", r2: "R2" };

/** The fixture board with an edit applied to its text. */
const edited = (edit: (s: string) => string) => readBoardNetlist(edit(read("divider.kicad_pcb")), REFDES);

describe("S-expressions", () => {
  it("reads a board and writes it back meaning the same", () => {
    const doc = parse(read("divider.kicad_pcb"));
    expect(children(doc, "footprint")).toHaveLength(4);
    const again = parse(printDocument(doc));
    expect(print(again)).toBe(print(doc));
  });

  it("keeps quoted strings quoted, with their escapes", () => {
    const doc = parse('(a "x \\"y\\" z" bare (b "1"))');
    expect(text(doc.items[1])).toBe('x "y" z');
    expect(print(doc)).toBe('(a "x \\"y\\" z" bare\n\t(b "1")\n)');
    expect(() => parse("(a (b)")).toThrow(/not closed/);
    expect(() => parse("(a))")).toThrow(/unbalanced/);
  });

  it("finds properties and children", () => {
    const fp = children(parse(read("divider.kicad_pcb")), "footprint")[1];
    expect(property(fp, "Reference")).toBe("R1");
    expect(text(child(fp, "at")?.items[3])).toBe("90");
    const p = parse('(x (property "A" "1"))');
    children(p, "property")[0].items[2] = str("2");
    expect(property(p, "A")).toBe("2");
  });
});

describe("reference designators", () => {
  const comps = [
    { instance: "r3", kind: "resistor" as const },
    { instance: "pullup", kind: "resistor" as const },
    { instance: "u1", kind: "ic" as const },
    { instance: "mcu", kind: "ic" as const },
    { instance: "c1", kind: "resistor" as const }, // an id that reads as another kind's designator
    { instance: "usb", kind: "connector" as const },
  ];

  it("keeps an id that reads as its kind's designator, numbers the rest in instance order", () => {
    const { record, added } = assignRefdes(comps);
    expect(record.assigned).toEqual({ c1: "R1", mcu: "U2", pullup: "R2", r3: "R3", u1: "U1", usb: "J1" });
    expect(added).toHaveLength(6);
  });

  it("keeps what is recorded, reserves a removed instance's designator, and gives new ones the next free number", () => {
    const first = assignRefdes(comps).record;
    const later = assignRefdes([...comps.filter((c) => c.instance !== "pullup"), { instance: "r_new", kind: "resistor" }, { instance: "r2", kind: "resistor" }], first);
    expect(later.record.assigned.pullup).toBe("R2"); // still reserved
    expect(later.record.assigned.r_new).toBe("R4");
    expect(later.record.assigned.r2).toBe("R5"); // R2 is taken by the removed pullup
    expect(later.added.sort()).toEqual(["r2", "r_new"]);
    expect(assignRefdes(comps, first).added).toEqual([]);
    expect(assignRefdes([], emptyRefdes()).record.assigned).toEqual({});
  });
});

describe("fields and names", () => {
  it("writes passive values the way they are printed", () => {
    expect(formatValue({ value: 10_000, unit: "Ω" })).toBe("10k");
    expect(formatValue({ value: 4.7e-6, unit: "F" })).toBe("4.7µF");
    expect(formatValue({ value: 1e-7, unit: "F" })).toBe("100nF");
    expect(formatValue({ value: 1_000_000, unit: "Ω" })).toBe("1M");
  });

  it("derives the same UUID from the same board and key, and library names KiCad accepts", () => {
    expect(stableUuid("b", "symbol:r1")).toBe(stableUuid("b", "symbol:r1"));
    expect(stableUuid("b", "symbol:r1")).not.toBe(stableUuid("b", "symbol:r2"));
    expect(stableUuid("b", "x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(libItemName("Device:R / 0402")).toBe("Device_R_0402");
  });
});

describe("reading KiCad files", () => {
  it("reads a KiCad 10 board: parts by UHD instance, copper nets by pad, board-only footprints left out", () => {
    const k = readBoardNetlist(read("divider.kicad_pcb"), REFDES);
    expect(Object.keys(k.parts).sort()).toEqual(["j1", "r1", "r2"]);
    expect(k.parts.r1).toEqual({ refdes: "R1", footprint: "divider:yageo-rc0402-reflow", fields: { Value: "10k", MPN: "RC0402FR-0710KL", Manufacturer: "Yageo", LCSC: "C25744" } });
    expect(k.nets).toEqual({ gnd: ["j1.2", "r2.2"], mid: ["r1.2", "r2.1"], vin: ["j1.1", "r1.1"] });
  });

  it("reads numbered nets (KiCad 6 to 9) and finds a part by its designator when it has no UHD_Instance", () => {
    const old = read("divider.kicad_pcb")
      .replace(/\(net "(\w+)"\)/g, (_, n) => `(net ${{ vin: 1, mid: 2, gnd: 3 }[n as "vin"]} "${n}")`)
      .replace(/\(property "UHD_Instance" "r2"[\s\S]*?\n\t\t\)\n/, "");
    const k = readBoardNetlist(old, REFDES);
    expect(k.nets.mid).toEqual(["r1.2", "r2.1"]);
    expect(k.parts.r2.refdes).toBe("R2");
    expect(() => readBoardNetlist("(kicad_sch)", REFDES)).toThrow(/not a KiCad board/);
  });

  it("reads the schematic's symbols and KiCad's netlist of it, power symbols left out", () => {
    const sym = readSchematicParts(read("divider.kicad_sch"), REFDES);
    expect(Object.keys(sym).sort()).toEqual(["j1", "r1", "r2"]);
    expect(sym.j1.footprint).toBe("divider:jst-sh-2");
    const net = readKicadNetlist(read("divider.net"), REFDES);
    expect(net.nets).toEqual({ "/mid": ["r1.2", "r2.1"], gnd: ["j1.2", "r2.2"], vin: ["j1.1", "r1.1"] });
    expect(net.parts.r1.fields).toMatchObject({ MPN: "RC0402FR-0710KL", LCSC: "C25744", Value: "10k" });
  });

  it("finds no parity problem between the fixture's schematic and board (net names aside)", () => {
    const pcb = readBoardNetlist(read("divider.kicad_pcb"), REFDES);
    expect(parityProblems(readSchematicParts(read("divider.kicad_sch"), REFDES), pcb.parts)).toEqual([]);
    expect(netParity(readKicadNetlist(read("divider.net"), REFDES), pcb)).toEqual([]);
    const moved = edited((s) => s.replace(/(\(property "Reference" "R2"[\s\S]*?\(pad "2"[\s\S]*?)\(net "gnd"\)/, '$1(net "mid")'));
    // r2.2 joined mid, which left j1.2 alone (a net of one pin is no net)
    expect(netParity(readKicadNetlist(read("divider.net"), REFDES), moved)).toEqual(["pin j1.2: schematic gnd, board no net", "pin r2.2: schematic gnd, board mid"]);
  });
});

describe("the three-way comparison of a locked board", () => {
  const base = readBoardNetlist(read("divider.kicad_pcb"), REFDES);
  const clone = (n: Netlist): Netlist => JSON.parse(JSON.stringify(n));
  const record = (model: Netlist, kicad: Netlist): Handoff => ({
    schema: HANDOFF_SCHEMA,
    state: "locked",
    board: "divider",
    lockedAt: "2026-10-17T00:00:00.000Z",
    netlistDigest: "sha256:x",
    boardShape: "sha256:y",
    model,
    kicad,
    tscircuit: { sourceDigest: "s", circuit: "c", core: "0" },
    tools: { converter: "0.0.237", provider: "0.1.6" },
    files: {},
  });
  const codes = (h: Handoff, m: Netlist, k: Netlist, shapeChanged = false) => comparisonDiagnostics(compare(h, m, k), { board: "divider", file: "kicad/divider.kicad_pcb", shapeChanged, module: "divider" });

  it("finds nothing when neither side changed", () => {
    expect(codes(record(base, base), base, base)).toEqual([]);
    expect(diffNetlists(base, clone(base))).toEqual([]);
  });

  it("model changes: a part added (stale), a net renamed and a field changed (warnings), the outline (stale)", () => {
    const m = clone(base);
    m.parts.r3 = { refdes: "R3", footprint: "divider:yageo-rc0402-reflow", fields: { Value: "1k" } };
    m.nets.vin.push("r3.1");
    m.nets.gnd.push("r3.2");
    m.nets.divider = m.nets.mid;
    delete m.nets.mid;
    m.parts.r2.fields.MPN = "RC0402FR-0712KL";
    const d = codes(record(base, base), m, base, true);
    expect(d.map((x) => `${x.severity} ${x.code}`)).toEqual(["error CIRCUIT_KICAD_STALE", "error CIRCUIT_KICAD_STALE", "warning CIRCUIT_KICAD_MODEL_CHANGED", "warning CIRCUIT_KICAD_FIELDS"]);
    expect(d[0].message).toMatch(/r3 \(R3\) added/);
    expect(d[2].message).toMatch(/net mid renamed divider \(r1\.2, r2\.1\)/);
    expect(d[3].message).toMatch(/r2 \(R2\) MPN "RC0402FR-0710KL" → "RC0402FR-0712KL"/);
  });

  it("hand edits in KiCad: a part deleted, a footprint swapped, a net renamed, a pin moved", () => {
    const k = clone(base);
    delete k.parts.j1;
    k.nets.vin = ["r1.1"];
    k.nets.gnd = ["r2.2"];
    k.parts.r2.footprint = "divider:R_0402_1005Metric";
    const renamed = edited((s) => s.replace(/"mid"/g, '"MID_NODE"'));
    const moved = edited((s) => s.replace(/(\(property "Reference" "R2"[\s\S]*?\(pad "2"[\s\S]*?)\(net "gnd"\)/, '$1(net "vin")'));
    expect(codes(record(base, base), base, k).map((x) => x.code)).toEqual(["CIRCUIT_KICAD_PART_MISSING", "CIRCUIT_KICAD_FOOTPRINT_CHANGED"]);
    expect(codes(record(base, base), base, renamed).map((x) => `${x.code}: ${x.message}`)).toEqual([expect.stringMatching(/^CIRCUIT_KICAD_NET_RENAMED: net\(s\) renamed in KiCad: net mid renamed MID_NODE/)]);
    const d = codes(record(base, base), base, moved);
    expect(d.map((x) => x.code)).toEqual(["CIRCUIT_KICAD_NET_CHANGED"]);
    // one pin moved: that pin, and the pin it left alone, are named; not every pin of the two nets
    expect(d[0].message).toMatch(/pin j1\.2: gnd → no net; pin r2\.2: gnd → vin \(with j1\.1, r1\.1\)/);
    expect(d[0].message).not.toMatch(/pin (j1\.1|r1\.1)/);
  });

  it("a model change made in KiCad too is applied, not a hand edit; one not yet made is pending", () => {
    const m = clone(base);
    m.nets.divider = m.nets.mid;
    delete m.nets.mid;
    const applied = edited((s) => s.replace(/"mid"/g, '"divider"'));
    expect(codes(record(base, base), m, applied).map((x) => x.code)).toEqual(["CIRCUIT_KICAD_APPLIED"]);
    expect(codes(record(base, base), m, base).map((x) => x.code)).toEqual(["CIRCUIT_KICAD_MODEL_CHANGED"]);
  });

  it("compares KiCad with KiCad as exported, so what the export could not match is not a hand edit", () => {
    // the export left r2's pad 2 off its net (a converter limit): recorded as the KiCad side at lock
    const exported = edited((s) => s.replace(/(\(property "Reference" "R2"[\s\S]*?\(pad "2"[\s\S]*?)\(net "gnd"\)\n/, "$1"));
    expect(codes(record(base, exported), base, exported)).toEqual([]);
  });
});

describe("designator prefixes by part (owner's review of nested boards, 2026-10-17)", async () => {
  const { assignRefdes, prefixFromPart } = await import("../lib/kicad/refdes.ts");
  it("gives diodes and LEDs D, transistors Q, crystals Y, fuses F, batteries BT, buzzers LS; other chips keep U", () => {
    expect(prefixFromPart({ id: "kingbright-led", categories: ["output.led"] })).toBe("D");
    expect(prefixFromPart({ id: "x", categories: ["component.discrete.diode"] })).toBe("D");
    expect(prefixFromPart({ id: "onsemi-mbr0540t1g", name: "Schottky diode 40 V" })).toBe("D");
    expect(prefixFromPart({ id: "aos-ao3400a", categories: ["component.discrete.transistor"] })).toBe("Q");
    expect(prefixFromPart({ id: "abracon-abm8", name: "Crystal 12 MHz" })).toBe("Y");
    expect(prefixFromPart({ id: "littelfuse-0603", name: "Fuse 1 A" })).toBe("F");
    expect(prefixFromPart({ id: "adafruit-328", name: "LiPo battery 2500 mAh" })).toBe("BT");
    expect(prefixFromPart({ id: "cui-buzzer", name: "Magnetic buzzer" })).toBe("LS");
    expect(prefixFromPart({ id: "espressif-esp32-c3", name: "ESP32-C3 module" })).toBeUndefined();
    // a large field board's first run: the name and id misled the first version
    expect(prefixFromPart({ id: "diodes-dmg2305uxq-7", name: "Diodes DMG2305UXQ-7 P-channel MOSFET", categories: ["component.discrete.transistor", "component.protection", "power"] })).toBe("Q");
    expect(prefixFromPart({ id: "hycon-hy2113-gb3a", name: "1-cell Li-ion protection IC", categories: ["component.protection", "component.ic"] })).toBeUndefined();
    expect(prefixFromPart({ id: "ti-bq25170dsgr", name: "1-cell Li-ion linear charger", categories: ["power.charger", "component.ic"] })).toBeUndefined();
    expect(prefixFromPart({ id: "ti-tps61169dckr", name: "boost LED driver", categories: ["component.ic.led_driver", "power.regulator"] })).toBeUndefined();
    expect(prefixFromPart({ id: "st-usblc6-2sc6", name: "USB ESD protection" })).toBeUndefined();
    const parts: Record<string, string> = { d1: "D", q1: "Q", u1: "" };
    const { record } = assignRefdes(
      [{ instance: "led1/d1", kind: "ic" }, { instance: "led1/q1", kind: "ic" }, { instance: "u1", kind: "ic" }, { instance: "r1", kind: "resistor" }],
      undefined,
      (c) => parts[c.instance.split("/").pop()!] || undefined,
    );
    expect(record.assigned).toEqual({ "led1/d1": "D1", "led1/q1": "Q1", u1: "U1", r1: "R1" });
  });
});
