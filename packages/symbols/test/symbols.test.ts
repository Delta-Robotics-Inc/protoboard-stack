import { describe, expect, it } from "vitest";
import { checkPack, readPack } from "../src/pack.ts";
import { checkSymbol, formatFindings } from "../src/check.ts";
import { formatSymbol } from "../src/format.ts";
import { iconSvg, schematicSvg } from "../src/render.ts";
import { MARGIN, UNIT, type SymbolDef } from "../src/types.ts";
import { SAMPLES, SENSOR_PINS } from "../src/generate/samples.ts";
import { buildVariant, header2, icBox, kicadBox, mcu, netLabel, regulator, usbC } from "../src/generate/families.ts";
import { pinName, twoSided } from "../src/generate/box.ts";
import { pinName as kicadPinName } from "../../ext-tscircuit/lib/kicad/schematic.ts";

const files = readPack();
const byId = new Map(files.map((f) => [f.def.id, f.def]));
const errors = (def: SymbolDef) => checkSymbol(def, { packIds: new Set(byId.keys()) }).filter((f) => f.severity === "error");

describe("the drawn pack", () => {
  it("passes every check (format, metadata, lattice, leads, bounds, 2 px icon gaps)", () => {
    const { findings } = checkPack();
    expect(formatFindings(findings.filter((f) => f.severity === "error"))).toBe("");
  });

  it("has the first pack's 77 drawn symbols", () => {
    expect(files.length).toBe(77);
  });

  it("is in the canonical text form (deterministic formatting)", () => {
    for (const f of files) expect(formatSymbol(JSON.parse(f.text)), f.file).toBe(f.text);
  });

  it("never names a color, a fill or a transform", () => {
    for (const f of files) expect(f.text, f.file).not.toMatch(/"(fill|stroke|style|class|transform|color)"/);
  });

  it("puts every pin anchor on the lattice and every lead's first point on it", () => {
    for (const f of files)
      for (const p of f.def.pins) {
        expect(Number.isInteger(p.at[0]) && Number.isInteger(p.at[1]), `${f.id}.${p.id}`).toBe(true);
        if (p.dir === "none") continue;
        const lead = f.def.body.find((e) => e.role === "lead" && e.pin === p.id)!;
        expect(lead.d!.startsWith(`M${MARGIN + UNIT * p.at[0]} ${MARGIN + UNIT * p.at[1]}`), `${f.id}.${p.id}`).toBe(true);
      }
  });

  it("builds the generated variants (IEC gates) and they pass, with pins where the US gate has them", () => {
    for (const f of files)
      for (const [name, v] of Object.entries(f.def.variants)) {
        if (!v.generator) continue;
        const built = buildVariant(f.def, name);
        expect(formatFindings(errors(built)), `${f.id}[${name}]`).toBe("");
        expect(built.pins.map((p) => [p.id, ...p.at]), `${f.id}[${name}]`).toEqual(f.def.pins.map((p) => [p.id, ...p.at]));
      }
  });

  it("gets the electrical conventions right", () => {
    // enhancement MOSFETs have a broken channel; the depletion variant a solid one
    expect(byId.get("mosfet-n")!.body.filter((e) => /^M9 \d+v\d+$/.test(e.d ?? "")).length).toBe(3);
    expect(byId.get("mosfet-n")!.variants.depletion.body!.some((e) => e.d === "M9 3v18")).toBe(true);
    // diodes: anode left, cathode right (the bar), K is pin 1
    for (const id of ["diode", "diode-schottky", "diode-zener", "diode-tvs", "led", "photodiode"]) {
      const d = byId.get(id)!;
      const a = d.pins.find((p) => p.id === "A")!;
      const k = d.pins.find((p) => p.id === "K")!;
      expect(a.dir === "left" && k.dir === "right" && k.number === "1", id).toBe(true);
    }
    // ground points down (pin on top), supplies up (pin at the bottom)
    expect(byId.get("ground")!.pins[0].dir).toBe("up");
    expect(byId.get("power-rail")!.pins[0].dir).toBe("down");
  });

  it("renders schematic and icon SVGs with currentColor only", () => {
    for (const f of files) {
      const sch = schematicSvg(f.def);
      const icon = iconSvg(f.def, (id) => byId.get(id));
      expect(sch).toContain('stroke="currentColor"');
      expect(icon).toContain('viewBox="0 0 24 24"');
      expect(sch + icon).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });
});

describe("code-built symbols", () => {
  it("every sample passes the checker", () => {
    for (const s of SAMPLES) expect(formatFindings(errors(s.build())), s.title).toBe("");
  });

  it("puts supplies on top, ground at the bottom, outputs right, and merges same-name ground pads", () => {
    const d = icBox(SENSOR_PINS);
    const side = (name: string) => d.pins.find((p) => p.name === name)!.dir;
    expect(side("VDD")).toBe("up");
    expect(side("GND")).toBe("down");
    expect(side("INT1")).toBe("right");
    expect(d.pins.find((p) => p.name === "GND")!.pads).toEqual(["3", "6"]);
    expect(d.pins.filter((p) => p.name === "GND").length).toBe(1);
  });

  it("keeps a function group together with a blank row before it", () => {
    const d = icBox(SENSOR_PINS);
    const ints = d.pins.filter((p) => p.group === "interrupts").map((p) => p.at[1]);
    expect(ints[1] - ints[0]).toBe(1);
    const right = d.pins.filter((p) => p.dir === "right").map((p) => p.at[1]).sort((a, b) => a - b);
    expect(right.some((r, i) => i > 0 && r - right[i - 1] === 2)).toBe(true);
  });

  it("mirrors the KiCad export's pin-name rule exactly", () => {
    for (const n of ["IN+", "VDD (3.3 V)", "SDA SDI", "~{RESET}", "~", "D_{+}", " GND "]) expect(pinName(n)).toBe(kicadPinName(n));
  });

  it("mirrors the KiCad export's side rule (supplies and inputs left, ground last on the left, sides within two)", () => {
    const pl = twoSided(SENSOR_PINS);
    const left = pl.left.filter(Boolean).map((p) => p!.name);
    const right = pl.right.filter(Boolean).map((p) => p!.name);
    expect(left.slice(0, 3)).toEqual(["VDDIO", "VDD", "CS"]);
    expect(left.slice(-2)).toEqual(["GND", "GND"]);
    expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(2);
    expect(kicadBox(SENSOR_PINS).pins.every((p) => p.dir === "left" || p.dir === "right")).toBe(true);
  });

  it("splits a microcontroller's ports by bank", () => {
    const pins = [{ name: "VDD" }, { name: "GND" }, ...Array.from({ length: 6 }, (_, i) => ({ name: `PA${i}` })), ...Array.from({ length: 6 }, (_, i) => ({ name: `PB${i}` })), { name: "NRST", type: "input" as const }];
    const d = mcu(pins);
    const sideOf = (n: string) => d.pins.find((p) => p.name === n)!.dir;
    expect(sideOf("PA0")).toBe(sideOf("PA5"));
    expect(sideOf("PB0")).toBe(sideOf("PB5"));
    expect(sideOf("PA0")).not.toBe(sideOf("PB0"));
    expect(sideOf("NRST")).toBe("left");
  });

  it("reads regulator pin roles from names when the data has no types", () => {
    const d = regulator("buck", [{ name: "VIN" }, { name: "EN" }, { name: "SW" }, { name: "FB" }, { name: "BST" }, { name: "GND" }]);
    const side = (n: string) => d.pins.find((p) => p.name === n)!.dir;
    expect([side("VIN"), side("EN"), side("SW"), side("FB"), side("BST"), side("GND")]).toEqual(["left", "left", "right", "right", "right", "down"]);
  });

  it("gives USB-C shared contacts one pin listing every pad", () => {
    const d = usbC();
    expect(d.pins.find((p) => p.name === "VBUS")!.pads).toEqual(["A4", "A9", "B4", "B9"]);
    expect(d.pins.find((p) => p.name === "GND")!.dir).toBe("down");
  });

  it("numbers a 2 x N header odd left, even right", () => {
    const d = header2(5);
    expect(d.pins.filter((p) => p.dir === "left").map((p) => p.number)).toEqual(["1", "3", "5", "7", "9"]);
  });

  it("sizes a net label to its text, on the lattice", () => {
    const short = netLabel("SDA");
    const long = netLabel("USB_VBUS_SENSE");
    expect(long.frame.w).toBeGreaterThan(short.frame.w);
    expect((long.frame.w - 4) % 5).toBe(0);
  });

  it("is deterministic", () => {
    for (const s of SAMPLES) expect(formatSymbol(s.build())).toBe(formatSymbol(s.build()));
  });
});

describe("the checker catches", () => {
  const base = () => JSON.parse(JSON.stringify(byId.get("resistor")!)) as SymbolDef;
  const rules = (def: SymbolDef, text?: string) => new Set(checkSymbol(def, { text }).filter((f) => f.severity === "error").map((f) => f.rule));
  it("a pin off the lattice, a lead off its anchor, a stray transform, a fill, a cramped mark and bad formatting", () => {
    const offLattice = base();
    offLattice.pins[0].at = [0, 2.5] as [number, number];
    expect(rules(offLattice).has("pins")).toBe(true);
    const offAnchor = base();
    offAnchor.body[0].d = "M2 11h2.5";
    expect(rules(offAnchor).has("leads")).toBe(true);
    const transform = base();
    (transform.body[1] as unknown as Record<string, string>).transform = "rotate(90)";
    expect(rules(transform).has("element")).toBe(true);
    const fill = base();
    (fill.body[1] as unknown as Record<string, string>).fill = "currentColor";
    expect(rules(fill).has("element")).toBe(true);
    const cramped = base();
    cramped.body.push({ el: "path", d: "M6 4.5h3", role: "arrow" });
    expect(rules(cramped).has("gap-icon")).toBe(true);
    const offGrid = base();
    offGrid.body[1].d = "M4.5 12 6 7.3l3 10";
    expect(rules(offGrid).has("numbers")).toBe(true);
    expect(rules(base(), JSON.stringify(base())).has("format")).toBe(true);
  });
});
