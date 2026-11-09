/**
 * Airnode C3: a synthetic sample board for tests and examples. 40 x 30 mm, 2 copper layers: an ESP32-C3 module,
 * a USB-C connector (power and USB data), an LDO with its capacitors, an I2C sensor with pull-ups, two LEDs with
 * resistors, and a boot button. Land patterns are simplified stand-ins, not manufacturer drawings; rule values
 * are illustrative, not a fab's published limits. It is built here in code so its files can be regenerated
 * (packages/board/scripts/write-fixture.ts) and compared byte for byte.
 */
import { createDocument, type BoardDocument } from "../document.js";
import { padsOf } from "../geometry.js";
import type { BoardRecord, FootprintRec, FootprintText, Netlist, Pad, Point, Provenance, Vertex } from "../schema.js";
import { mm } from "../units.js";

const GEN: Provenance = { by: "generated", tool: "airnode-c3-fixture" };
const HAND: Provenance = { by: "hand" };
const AGENT: Provenance = { by: "agent", actor: "agent:fixture" };
const ROUTED: Provenance = { by: "routed", tool: "fixture-router" };

const rect = (w: number, h: number, cx = 0, cy = 0): Vertex[] => [
  { x: mm(cx - w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy + h / 2) },
  { x: mm(cx - w / 2), y: mm(cy + h / 2) },
];

/** A rounded rectangle centered on the origin, counterclockwise, corner arcs as vertex sweeps. */
function roundedRect(w: number, h: number, r: number): Vertex[] {
  const x = w / 2;
  const y = h / 2;
  return [
    { x: mm(-x + r), y: mm(-y) },
    { x: mm(x - r), y: mm(-y), sweep: 90_000 },
    { x: mm(x), y: mm(-y + r) },
    { x: mm(x), y: mm(y - r), sweep: 90_000 },
    { x: mm(x - r), y: mm(y) },
    { x: mm(-x + r), y: mm(y), sweep: 90_000 },
    { x: mm(-x), y: mm(y - r) },
    { x: mm(-x), y: mm(-y + r), sweep: 90_000 },
  ];
}

const smd = (number: string, x: number, y: number, w: number, h: number): Pad => ({ number, type: "smd", shape: "rect", x: mm(x), y: mm(y), width: mm(w), height: mm(h), layer: "top" });
const refText = (y: number): FootprintText => ({ layer: "top_silkscreen", text: "REF", x: 0, y: mm(y), height: mm(0.8), stroke_width: mm(0.12), role: "ref" });

interface Place {
  ref: string;
  path: string;
  value?: string;
  x: number;
  y: number;
  rotation?: number;
  side?: "top" | "bottom";
  locked?: true;
}

function footprint(p: Place, name: string, pads: Pad[], court: [number, number], extra: Partial<FootprintRec> = {}): FootprintRec {
  return {
    kind: "footprint",
    id: `fp:${p.path}`,
    ref: p.ref,
    path: p.path,
    footprint: name,
    ...(p.value ? { value: p.value } : {}),
    x: mm(p.x),
    y: mm(p.y),
    rotation: p.rotation ?? 0,
    side: p.side ?? "top",
    pads,
    courtyard: rect(court[0], court[1]),
    texts: [refText(court[1] / 2 + 0.6)],
    ...extra,
    ...(p.locked ? { locked: true as const } : {}),
    provenance: GEN,
  };
}

const CHIP = {
  "0402": { pitch: 0.48, w: 0.56, h: 0.62, court: [1.6, 0.9] as [number, number] },
  "0603": { pitch: 0.8, w: 0.8, h: 0.95, court: [2.4, 1.3] as [number, number] },
  "0805": { pitch: 0.95, w: 1.0, h: 1.3, court: [2.9, 1.7] as [number, number] },
};
function chip(p: Place, pkg: keyof typeof CHIP, kind: "R" | "C" | "LED"): FootprintRec {
  const c = CHIP[pkg];
  return footprint(p, `Airnode:${kind === "LED" ? "LED" : kind === "R" ? "R" : "C"}_${pkg}`, [smd("1", -c.pitch, 0, c.w, c.h), smd("2", c.pitch, 0, c.w, c.h)], c.court);
}

function moduleFootprint(p: Place): FootprintRec {
  const pads: Pad[] = [];
  for (let i = 0; i < 11; i++) pads.push(smd(String(1 + i), -6.2, 2.8 - i * 0.8, 0.8, 0.4));
  for (let i = 0; i < 11; i++) pads.push(smd(String(12 + i), -4.0 + i * 0.8, -7.6, 0.4, 0.8));
  for (let i = 0; i < 11; i++) pads.push(smd(String(23 + i), 6.2, -5.2 + i * 0.8, 0.8, 0.4));
  pads.push(smd("34", 0, -1.5, 4.0, 4.0));
  return footprint(p, "Airnode:ESP32-C3-module", pads, [13.6, 17.0], {
    graphics: [
      { layer: "top_silkscreen", shape: "rect", center: { x: 0, y: 0 }, width: mm(13.2), height: mm(16.6), stroke_width: mm(0.12) },
      { layer: "top_fabrication", shape: "line", start: { x: mm(-6.6), y: mm(3.3) }, end: { x: mm(6.6), y: mm(3.3) }, stroke_width: mm(0.1) },
    ],
  });
}

function usbC(p: Place): FootprintRec {
  const xs = [-3.0, -2.2, -1.2, -0.4, 0.4, 1.2, 2.2, 3.0];
  const nums = ["A1", "A4", "A5", "A6", "A7", "B5", "B4", "B1"];
  const pads: Pad[] = nums.map((n, i) => smd(n, xs[i], 3.0, 0.5, 1.2));
  // four shell tabs share the number "S": their pad keys are S, S~2, S~3, S~4
  for (const [x, y] of [
    [-4.3, 2.6],
    [4.3, 2.6],
    [-4.3, -1.6],
    [4.3, -1.6],
  ])
    pads.push({ number: "S", type: "th", shape: "oval", x: mm(x), y: mm(y), outer_width: mm(1.0), outer_height: mm(2.0), hole_width: mm(0.6), hole_height: mm(1.6) });
  return footprint(p, "Airnode:USB-C-receptacle", pads, [9.8, 7.4]);
}

function sot23_5(p: Place): FootprintRec {
  return footprint(p, "Airnode:SOT-23-5", [smd("1", -0.95, -1.1, 0.6, 1.06), smd("2", 0, -1.1, 0.6, 1.06), smd("3", 0.95, -1.1, 0.6, 1.06), smd("4", 0.95, 1.1, 0.6, 1.06), smd("5", -0.95, 1.1, 0.6, 1.06)], [3.6, 3.5]);
}

function dfn4(p: Place): FootprintRec {
  return footprint(p, "Airnode:DFN-4-1.5mm", [smd("1", -0.75, 0.4, 0.5, 0.4), smd("2", -0.75, -0.4, 0.5, 0.4), smd("3", 0.75, -0.4, 0.5, 0.4), smd("4", 0.75, 0.4, 0.5, 0.4)], [2.4, 2.2]);
}

function tactSwitch(p: Place): FootprintRec {
  return footprint(p, "Airnode:SW-tact-4pad", [smd("1", -1.9, 1.0, 1.0, 0.7), smd("2", 1.9, 1.0, 1.0, 0.7), smd("3", -1.9, -1.0, 1.0, 0.7), smd("4", 1.9, -1.0, 1.0, 0.7)], [5.0, 3.4], {
    graphics: [{ layer: "top_silkscreen", shape: "circle", center: { x: 0, y: 0 }, radius: mm(0.8), stroke_width: mm(0.12) }],
  });
}

export const AIRNODE_C3_NETLIST: Netlist = {
  source: "fixture",
  nets: [
    { name: "VBUS", class: "power", pins: ["J1.A4", "J1.B4", "U2.1", "U2.3", "C1.1"] },
    { name: "GND", class: "power", pins: ["J1.A1", "J1.B1", "J1.S", "U2.2", "C1.2", "C2.2", "C3.2", "C4.2", "C5.2", "U1.1", "U1.2", "U1.34", "U3.4", "SW1.3", "SW1.4", "D1.2", "D2.2", "R5.2", "R6.2"] },
    { name: "+3V3", class: "power", pins: ["U2.5", "C2.1", "C3.1", "U1.3", "U3.3", "C4.1", "R3.1", "R4.1", "R7.1"] },
    { name: "EN", pins: ["U1.8", "R7.2", "C5.1"] },
    { name: "BOOT", pins: ["U1.13", "SW1.1", "SW1.2"] },
    { name: "I2C_SDA", pins: ["U1.15", "U3.1", "R3.2"] },
    { name: "I2C_SCL", pins: ["U1.16", "U3.2", "R4.2"] },
    { name: "USB_DP", pins: ["J1.A6", "U1.27"] },
    { name: "USB_DN", pins: ["J1.A7", "U1.26"] },
    { name: "CC1", pins: ["J1.A5", "R5.1"] },
    { name: "CC2", pins: ["J1.B5", "R6.1"] },
    { name: "LED1", pins: ["U1.18", "R1.1"] },
    { name: "LED1_A", pins: ["R1.2", "D1.1"] },
    { name: "LED2", pins: ["U1.19", "R2.1"] },
    { name: "LED2_A", pins: ["R2.2", "D2.1"] },
  ],
};

/** The Airnode C3 records (unsorted) and netlist. */
export function airnodeC3Records(): BoardRecord[] {
  const fps: FootprintRec[] = [
    moduleFootprint({ ref: "U1", path: "mcu/module", value: "ESP32-C3 module", x: 10, y: 6.5 }),
    usbC({ ref: "J1", path: "usb/connector", value: "USB-C", x: -10, y: -12.5, locked: true }),
    sot23_5({ ref: "U2", path: "power/ldo", value: "LDO 3.3 V", x: -10, y: -3 }),
    chip({ ref: "C1", path: "power/c_in", value: "1 uF", x: -12.5, y: -3, rotation: 90_000 }, "0603", "C"),
    chip({ ref: "C2", path: "power/c_out", value: "1 uF", x: -7.5, y: -3, rotation: 90_000 }, "0603", "C"),
    chip({ ref: "C3", path: "mcu/c_bulk", value: "10 uF", x: 6, y: -5 }, "0805", "C"),
    dfn4({ ref: "U3", path: "sensor/ic", value: "I2C humidity sensor", x: -4, y: 9 }),
    chip({ ref: "C4", path: "sensor/c_dec", value: "100 nF", x: -4, y: 11.5 }, "0402", "C"),
    chip({ ref: "R3", path: "sensor/r_sda", value: "4.7 k", x: -7.5, y: 9.5 }, "0402", "R"),
    chip({ ref: "R4", path: "sensor/r_scl", value: "4.7 k", x: -7.5, y: 8 }, "0402", "R"),
    chip({ ref: "D1", path: "status/led1", value: "green", x: -16, y: 10 }, "0603", "LED"),
    chip({ ref: "D2", path: "status/led2", value: "amber", x: -16, y: 7 }, "0603", "LED"),
    chip({ ref: "R1", path: "status/r1", value: "1 k", x: -13, y: 10 }, "0402", "R"),
    chip({ ref: "R2", path: "status/r2", value: "1 k", x: -13, y: 7 }, "0402", "R"),
    tactSwitch({ ref: "SW1", path: "ui/boot_button", value: "BOOT", x: -15, y: 0 }),
    chip({ ref: "R5", path: "usb/r_cc1", value: "5.1 k", x: -4, y: -9.5 }, "0402", "R"),
    chip({ ref: "R6", path: "usb/r_cc2", value: "5.1 k", x: -4, y: -11 }, "0402", "R"),
    chip({ ref: "R7", path: "mcu/r_en", value: "10 k", x: 1, y: -4 }, "0402", "R"),
    chip({ ref: "C5", path: "mcu/c_en", value: "1 uF", x: 1, y: -6 }, "0402", "C"),
  ];
  const byRef = new Map(fps.map((f) => [f.ref, f]));
  const pad = (ref: string, number: string): Point => {
    const p = padsOf(byRef.get(ref)!).find((x) => x.pad.number === number)!;
    return { x: p.x, y: p.y };
  };
  const at = (x: number, y: number): Point => ({ x: mm(x), y: mm(y) });
  const seg = (key: string, net: string | undefined, layer: "top" | "bottom", width: number, start: Point, end: Point, provenance: Provenance, extra: { sweep?: number; locked?: true } = {}): BoardRecord => ({
    kind: "track",
    id: `trk:f.${key}`,
    ...(net ? { net } : {}),
    layer,
    width: mm(width),
    start,
    end,
    ...(extra.sweep !== undefined ? { sweep: extra.sweep } : {}),
    ...(extra.locked ? { locked: true as const } : {}),
    provenance,
  });
  const vbusA = pad("J1", "A4");
  const vbusB = pad("U2", "1");
  const sdaA = pad("U3", "1");
  const sdaB = pad("U1", "15");
  const sclA = pad("U3", "2");
  const sclB = pad("U1", "16");
  const v3a = pad("U2", "5");
  const v3b = pad("C2", "1");
  const copper: BoardRecord[] = [
    seg("vbus.1", "VBUS", "top", 0.5, vbusA, { x: vbusA.x, y: vbusB.y - mm(1.5) }, HAND, { locked: true }),
    seg("vbus.2", "VBUS", "top", 0.5, { x: vbusA.x, y: vbusB.y - mm(1.5) }, vbusB, HAND, { locked: true }),
    seg("i2c_sda.1", "I2C_SDA", "top", 0.2, sdaA, { x: sdaA.x, y: mm(7.5) }, AGENT),
    seg("i2c_sda.2", "I2C_SDA", "top", 0.2, { x: sdaA.x, y: mm(7.5) }, sdaB, AGENT),
    seg("i2c_scl.1", "I2C_SCL", "bottom", 0.2, sclA, sclB, AGENT),
    seg("usb_dp.1", "USB_DP", "top", 0.25, pad("J1", "A6"), at(0, -6.5), ROUTED),
    seg("usb_dn.1", "USB_DN", "top", 0.25, pad("J1", "A7"), at(0.5, -7), ROUTED),
    seg("3v3.1", "+3V3", "top", 0.4, v3a, { x: v3a.x, y: v3b.y + mm(1.0) }, ROUTED),
    seg("3v3.arc", "+3V3", "top", 0.4, { x: v3a.x, y: v3b.y + mm(1.0) }, { x: v3a.x + mm(1.0), y: v3b.y + mm(2.0) }, ROUTED, { sweep: -90_000 }),
    seg("spare.1", undefined, "bottom", 0.3, at(14, -12), at(17, -12), HAND),
    { kind: "via", id: "via:f.gnd.1", net: "GND", x: mm(-10), y: mm(-5.2), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", provenance: ROUTED },
    { kind: "via", id: "via:f.gnd.2", net: "GND", x: mm(-12.5), y: mm(-1.5), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", provenance: ROUTED },
    { kind: "via", id: "via:f.gnd.3", net: "GND", x: mm(10), y: mm(5), outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", tented: "both", provenance: GEN },
  ];
  const layers: BoardRecord[] = [
    { kind: "layer", id: "layer:top_mask", name: "top_mask", type: "soldermask", order: 0, thickness: mm(0.01) },
    { kind: "layer", id: "layer:top", name: "top", type: "copper", order: 1, thickness: mm(0.035), copper_weight_oz: 1 },
    { kind: "layer", id: "layer:core1", name: "core1", type: "dielectric", order: 2, thickness: mm(1.51), material: "FR4", epsilon_r: 4.5, loss_tangent: 0.02 },
    { kind: "layer", id: "layer:bottom", name: "bottom", type: "copper", order: 3, thickness: mm(0.035), copper_weight_oz: 1 },
    { kind: "layer", id: "layer:bottom_mask", name: "bottom_mask", type: "soldermask", order: 4, thickness: mm(0.01) },
  ];
  const rules: BoardRecord[] = [
    { kind: "netclass", id: "class:power", name: "power", nets: ["+3V3", "GND", "VBUS"] },
    { kind: "netclass", id: "class:usb", name: "usb", patterns: ["USB_*"] },
    { kind: "rule", id: "rule:floor.clearance", tier: "floor", check: "clearance", applies: {}, min: mm(0.127), note: "illustrative fab limit" },
    { kind: "rule", id: "rule:floor.track_width", tier: "floor", check: "track_width", applies: {}, min: mm(0.127) },
    { kind: "rule", id: "rule:floor.via_hole", tier: "floor", check: "via_hole", applies: {}, min: mm(0.3) },
    { kind: "rule", id: "rule:floor.edge_clearance", tier: "floor", check: "edge_clearance", applies: {}, min: mm(0.3) },
    { kind: "rule", id: "rule:target.clearance", tier: "target", check: "clearance", applies: {}, min: mm(0.2), preferred: mm(0.2) },
    { kind: "rule", id: "rule:target.track_width", tier: "target", check: "track_width", applies: {}, min: mm(0.2), preferred: mm(0.25) },
    { kind: "rule", id: "rule:target.power_track_width", tier: "target", check: "track_width", applies: { classes: ["power"] }, min: mm(0.4), preferred: mm(0.5) },
    { kind: "rule", id: "rule:policy.via_under_module", tier: "policy", check: "via_under_footprint", applies: { region: rect(13.2, 16.6, 10, 6.5) }, cost: 5, severity: "warning" },
    { kind: "rule", id: "rule:no_go.via_in_pad_usb", tier: "no_go", check: "via_in_pad", applies: { classes: ["usb"] } },
  ];
  return [
    { kind: "board", id: "board", name: "Airnode C3", thickness: mm(1.6), copper_layers: 2, origin: "center", workflow: { order: "board-first" } },
    ...layers,
    { kind: "outline", id: "outline", outline: roundedRect(40, 30, 1), source: { kind: "board" }, provenance: GEN },
    ...fps,
    ...copper,
    {
      kind: "zone",
      id: "zone:f.gnd_bottom",
      net: "GND",
      layers: ["bottom"],
      outline: rect(39, 29),
      priority: 0,
      clearance: mm(0.25),
      pad_connection: "thermal",
      thermal_gap: mm(0.25),
      thermal_spoke_width: mm(0.3),
      fill_mode: "solid",
      remove_islands: "always",
      name: "GND bottom",
      provenance: GEN,
    },
    {
      kind: "keepout",
      id: "kpo:f.antenna",
      outline: rect(13.2, 5.2, 10, 12.4),
      layers: ["top", "bottom"],
      blocks: { tracks: true, vias: true, pours: true, footprints: false },
      tier: "no_go",
      footprint: "fp:mcu/module",
      name: "antenna clearance",
      provenance: GEN,
    },
    { kind: "graphic", id: "gfx:f.logo_box", layer: "top_silkscreen", shape: "rect", center: { x: mm(14), y: mm(-11) }, width: mm(8), height: mm(4), stroke_width: mm(0.15), provenance: HAND },
    { kind: "text", id: "txt:f.title", layer: "top_silkscreen", text: "Airnode C3", x: mm(14), y: mm(-11), height: mm(1.2), stroke_width: mm(0.15), provenance: HAND },
    ...rules,
  ];
}

/** The Airnode C3 board document with its netlist. */
export function airnodeC3(): BoardDocument {
  return createDocument(airnodeC3Records(), AIRNODE_C3_NETLIST);
}
