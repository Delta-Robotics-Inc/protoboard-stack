/**
 * Adafruit 381 Waterproof 1-Wire DS18B20 digital temperature sensor (ADA381):
 * a DS18B20 sealed in a stainless tube on a PVC cable — datasheet-honest UHD
 * part.
 *
 * Project-researched part (parts/local; docs/specs/tool-integrations.md §6 in the
 * Protoboard Stack), copied from the parts library workspace (commit 9a80317) with
 * its evidence (parts/evidence/adafruit-381-ds18b20-probe/) and generated CAD (parts/local/adafruit-381-ds18b20-probe/).
 *
 * Sources (see parts/evidence/adafruit-381-ds18b20-probe/sources.json):
 *   - src_product: Adafruit product 381 page (Description, Technical Details) —
 *     https://www.adafruit.com/product/381
 *   - src_product_api: Adafruit product API record (MPN, shipping weight) —
 *     https://www.adafruit.com/api/product/381
 *   - src_photos: Adafruit product photos 381-01 / 381-02 —
 *     https://cdn-shop.adafruit.com/970x728/381-02.jpg
 *   - src_datasheet: Maxim/ADI DS18B20 datasheet 19-7487 Rev 6 (7/19) —
 *     https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf
 *   - src_datasheet_adafruit: the older Dallas copy Adafruit links, corroboration only.
 *
 * Modelling notes:
 *   - Variant: the three-wire build (red 3-5 V, blue or black GND, yellow or
 *     white data). Adafruit ships a four-wire build under the same number
 *     (black GND, white data, plus a copper drain wire soldered to the
 *     shield); it is not modelled (see its `assumption`). Wire colours vary
 *     by batch, so the designators are the signal names VDD, GND and DQ, not
 *     colours; the colours are in each leaf's name and `pin_functions`.
 *   - The terminals are the three stripped wire ends: `wire_vdd`, `wire_gnd`
 *     and `wire_dq`. The DS18B20's TO-92 pin numbers are inside the potted
 *     tube and unreachable, so the mechanical domain states the termination
 *     as a 3-terminal package (Adafruit names none; see its `assumption`).
 *     `wire_ends` is the connector composite over them (bare wire leads, no
 *     housing), for a harness or a board's solder pads.
 *   - `wire_vdd` is a 3.0-5.5 V supply input with current_draw 1.5 mA, the
 *     DS18B20 active maximum (standby is 750 nA typ, 1 uA max; usage_note).
 *     Parasite power (VDD grounded, power through DQ) is described in a
 *     usage_note and not modelled as an alternative.
 *   - `wire_dq` is the open-drain 1-Wire data line: a digital leaf with role
 *     bidirectional, so it pairs with an MCU GPIO. UHD has no 1-Wire
 *     protocol (gaps.json, vocabulary); the bus facts (ROM code, timing,
 *     pull-up) are in traits. The 4.7 kOhm pull-up Adafruit supplies is a
 *     loose resistor: a board places it (DQ to VDD), so it is not part of
 *     this module.
 *   - `tube` is the exposed stainless tube, Ø6 x 30 mm: the sensing element
 *     and the surface a rod seal (the smart-bottle cap's AS568-010) or a
 *     gland closes on. Its frame sits on the axis at the shoulder where the
 *     heat-shrink sleeve begins, normal along the tube toward the tip.
 *     Protocol `custom` (peer) with capability rod_seal_surface (gaps.json,
 *     vocabulary). Adafruit says it is not IP rated and not for salt water.
 *   - `cable_exit` is where the flexible run starts: 6 mm behind the tube,
 *     where the heat shrink over the tube-to-cable joint stops being stiff
 *     (assumption). A project that cuts the cable to length starts its
 *     harness there (changed in the smart-bottle project, 2026-10-03: the
 *     library put it where the bare jacket leaves the second sleeve, 49 mm
 *     behind the tube, with the sleeves drawn rigid).
 *   - Operating temperature is -55 to +100 C: the DS18B20 is rated to
 *     +125 C, but Adafruit suggests keeping the probe under 100 C because of
 *     the PVC jacket (thermal domain metadata).
 *   - Geometry: generated (parts/local/adafruit-381-ds18b20-probe/adafruit-381-ds18b20-probe.py);
 *     no manufacturer CAD exists (data_gap "manufacturer CAD"). Only the tube
 *     and cable are dimensioned by Adafruit; the heat-shrink, breakout and
 *     wire sizes are read from the product photos; only the tube and the
 *     stiff joint are drawn (`assumption` traits).
 *   - No mass: only a 27.2 g shipping weight is published (data_gap). No
 *     material is declared, so no mass is derived from the CAD volume (the
 *     tube is hollow and potted, the CAD solid).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { Connector, Ground, PowerIn, currentDrawA, defineModule, voltageRangeV } from "@deltarobotics/uhd";
import { feature, own, withGeometry } from "@deltarobotics/uhd";
// the common generated-CAD layout (STEP, GLB, manifest), which the copied generator follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SRC = {
  product: "https://www.adafruit.com/product/381",
  productApi: "https://www.adafruit.com/api/product/381",
  photos: "https://cdn-shop.adafruit.com/970x728/381-02.jpg",
  datasheet: "https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf",
  datasheetAdafruit: "https://cdn-shop.adafruit.com/datasheets/DS18B20.pdf",
} as const;

const PRODUCT_SPECS = `${SRC.product} (Technical Details)`;
const DS_DC = `${SRC.datasheet} (DC Electrical Characteristics)`;
const DS_PINS = `${SRC.datasheet} (Pin Description)`;

// src_datasheet DC Electrical Characteristics unless noted
const VDD_RANGE: [number, number] = [3.0, 5.5]; // VDD local power +3.0 to +5.5 V
const ACTIVE_MAX_A = 0.0015; // IDD 1 mA typ, 1.5 mA max (VDD = 5 V)
// src_product Technical Details, "Cable specs"
const TUBE_D_MM = 6;
const TUBE_L_MM = 30;
const CABLE_D_MM = 4;
const CABLE_L_MM = 910; // 36" / 91 cm

const assumption = (field: string, value: string, reason: string, source?: string | string[]): TraitDef => ({
  type: "assumption",
  params: { field, value, reason, ...(source ? { source } : {}) },
});

// ---------------------------------------------------------------------------
// Leaves: the three stripped wire ends (3-wire build)
// ---------------------------------------------------------------------------

const wireVdd: InterfaceDef = {
  ...PowerIn({ id: "wire_vdd", name: "VDD wire (red), 3.0-5.5 V", pin: "VDD", voltageV: VDD_RANGE, parameters: [currentDrawA(ACTIVE_MAX_A)] }),
  traits: [
    {
      type: "pin_functions",
      params: {
        functions: [{ name: "VDD" }],
        description:
          "Probe: 'Red connects to 3-5V'. DS18B20 VDD (TO-92 pin 3): 'Optional VDD. VDD must be grounded for operation in parasite power mode.'",
        source: [PRODUCT_SPECS, DS_PINS],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "supply current",
        note: "current_draw is the 1.5 mA active maximum (1 mA typ, VDD = 5 V), drawn during temperature conversions and EEPROM writes: up to 750 ms per 12-bit conversion. Standby is 750 nA typ, 1000 nA max up to +70 C (typically 3 uA at +125 C); keep DQ within 0.3 V of GND or VDD for the lowest standby current.",
        source: `${DS_DC} (IDD, IDDS, Notes 7-9); ${SRC.datasheet} (AC Electrical Characteristics, tCONV)`,
      },
    },
  ],
};

const wireGnd: InterfaceDef = {
  ...Ground({ id: "wire_gnd", name: "GND wire (blue or black)", pin: "GND" }),
  traits: [
    {
      type: "pin_functions",
      params: {
        functions: [{ name: "GND" }],
        description: "Probe: three-wire 'Blue/Black connects to ground' (four-wire build: black). DS18B20 GND (TO-92 pin 1): 'Ground'.",
        source: [PRODUCT_SPECS, DS_PINS],
      },
    },
  ],
};

const wireDq: InterfaceDef = {
  id: "wire_dq",
  name: "DQ wire (yellow or white), 1-Wire data",
  pin: "DQ",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "digital", roles: ["bidirectional"] }],
  capabilities: ["digital_io", "onewire_dq", "open_drain"],
  parameters: [voltageRangeV(VDD_RANGE[0], VDD_RANGE[1])],
  traits: [
    {
      type: "pin_functions",
      params: {
        functions: [{ name: "DQ" }, { name: "1-Wire" }],
        description:
          "Probe: three-wire 'Yellow/White is data' (four-wire build: white). DS18B20 DQ (TO-92 pin 2): 'Data Input/Output. Open-drain 1-Wire interface pin. Also provides power to the device when used in parasite power mode.'",
        source: [PRODUCT_SPECS, DS_PINS],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "1-Wire bus and pull-up",
        note: "Open-drain; the bus needs an external pull-up of about 5 kOhm to VPU (3.0 V to VDD), and Adafruit supplies a 4.7 kOhm resistor 'required as a pullup from the DATA to VCC line'. Idle high; holding the bus low for more than 480 us resets every device on it. Levels: VIL max 0.8 V, VIH min 2.2 V (local power) up to the lower of 5.5 V or VDD + 0.3 V; sinks 4.0 mA min at 0.4 V; DQ input current 5 uA typ; 25 pF max. Time slots 60-120 us, reset low 480 us min.",
        source: [
          `${SRC.product} (Description)`,
          `${SRC.datasheet} (1-Wire Bus System; DC and AC Electrical Characteristics)`,
        ],
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "addressing and multidrop",
        note: "Each DS18B20 has a unique 64-bit ROM code with family code 28h, so several probes can share one DQ line; the master finds them with Search ROM and addresses them with Match ROM (or Skip ROM with a single device). There is no fixed address to configure.",
        source: `${SRC.datasheet} (Overview; 64-Bit Lasered ROM Code; ROM Commands)`,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Composed: the bare-lead end of the cable
// ---------------------------------------------------------------------------

const wireEnds: InterfaceDef = Connector({
  id: "wire_ends",
  name: "Cable end: 3 stripped wires (VDD red, GND blue/black, DQ yellow/white)",
  connector: "bare_wire_lead",
  pins: [
    ["VDD (red)", "wire_vdd"],
    ["GND (blue or black)", "wire_gnd"],
    ["DQ (yellow or white)", "wire_dq"],
  ],
  note: "Three-wire build: 'Red connects to 3-5V, Blue/Black connects to ground and Yellow/White is data' (src_product). The photos show the jacket stripped back and stranded copper ends stripped and untinned, no connector (src_photos). Position order follows Adafruit's listing; there is no pin 1.",
  traits: [
    {
      type: "usage_note",
      params: {
        topic: "four-wire build",
        note: "Some probes ship with four wires: 'Red connects to 3-5V, Black connects to ground and White is data. The copper wire is soldered to the wire shielding.' Check the wire count on receipt; on a four-wire probe the bare copper drain wire is the shield (ground it at the board end or leave it unconnected; Adafruit gives no recommendation).",
        source: PRODUCT_SPECS,
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Mechanical: the stainless tube and the cable exit
// ---------------------------------------------------------------------------

const tube: InterfaceDef = {
  id: "tube",
  name: "Stainless tube Ø6 x 30 mm (sensing end, seal surface)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  max_instances: 1,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["probe_tube", "rod_seal_surface", "immersion"],
  parameters: [
    { id: "tube_diameter", unit: "mm", value: TUBE_D_MM },
    { id: "tube_length", unit: "mm", value: TUBE_L_MM },
  ],
  traits: [
    {
      type: "usage_note",
      params: {
        topic: "sealing and immersion",
        note: "Stainless steel tube 6 mm diameter by 30 mm long, waterproofed with heat shrink. Adafruit: 'Not for use in salt water or other corrosive environments. These are not IP rated, and are not guaranteed for long term/high pressure usage.' A rod seal or gland closes on the exposed tube; the heat-shrink sleeve behind it is about the tube diameter or larger, so insert the probe tip first.",
        source: [PRODUCT_SPECS, `${SRC.product} (Description)`],
      },
    },
  ],
};

const cableExit: InterfaceDef = {
  id: "cable_exit",
  name: "Cable exit (the flexible run leaves the stiff tube-to-cable joint)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  max_instances: 1,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["cable_exit"],
  parameters: [
    { id: "cable_diameter", unit: "mm", value: CABLE_D_MM },
    { id: "cable_length", unit: "mm", value: CABLE_L_MM },
  ],
  traits: [
    {
      type: "usage_note",
      params: {
        topic: "cable",
        note: "Cable is 36\" / 91 cm long, 4 mm diameter, jacketed in PVC (keep under 100 C). It may be cut to length; the wires inside are re-stripped at the cut. Wire gauge is not stated.",
        source: [PRODUCT_SPECS, `${SRC.product} (Description)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const ADAFRUIT_381_DS18B20_PROBE_BASE: ModuleDef = defineModule({
  id: "adafruit-381-ds18b20-probe",
  name: "Adafruit 381 waterproof DS18B20 temperature probe",
  version: "1.0.0",
  manufacturer: "Adafruit Industries",
  part_number: "381 (ADA381)",
  description:
    "Pre-wired, waterproofed DS18B20 1-Wire digital thermometer in a stainless steel tube Ø6 x 30 mm on a 91 cm, Ø4 mm PVC cable, three wires (red VDD 3.0-5.5 V, blue/black GND, yellow/white DQ). -55 to +125 C sensor (keep under 100 C for the PVC cable), +-0.5 C from -10 to +85 C, 9-12 bit, 750 ms max per 12-bit conversion, unique 64-bit ROM code. Supplied with a 4.7 kOhm DQ pull-up resistor. Not IP rated.",
  tags: ["temperature", "sensor", "ds18b20", "1-wire", "onewire", "waterproof", "probe", "stainless", "adafruit", "wire-leads"],
  categories: ["sensor.environmental"],

  interfaces: [wireVdd, wireGnd, wireDq, wireEnds, tube, cableExit],

  artifacts: [
    { id: "art_product_page", name: "Adafruit 381 product page", type: "documentation", url: SRC.product },
    { id: "art_datasheet", name: "DS18B20 datasheet 19-7487 Rev 6 (Maxim/ADI)", type: "datasheet", url: SRC.datasheet },
    { id: "art_datasheet_adafruit", name: "DS18B20 datasheet copy linked by Adafruit (REV 042208)", type: "datasheet", url: SRC.datasheetAdafruit },
  ],

  domains: [
    {
      domain: "electrical",
      power_domains: [
        {
          id: "vdd",
          name: "VDD (red wire)",
          nominal_voltage_V: 3.3,
          voltage_range_V: VDD_RANGE,
          max_current_mA: ACTIVE_MAX_A * 1000,
        },
      ],
      metadata: {
        supply_current: { standby_nA: { typ: 750, max: 1000 }, active_mA: { typ: 1, max: 1.5 }, condition: "standby up to +70 C; active at VDD = 5 V" },
        nominal_voltage_note: "3.3 V is the smart-bottle rail; any VDD from 3.0 to 5.5 V is in range",
        pullup_supply_V: [3.0, "VDD"],
        pullup_supplied_ohm: 4700,
        source: [DS_DC, `${SRC.product} (Description)`],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: TUBE_L_MM + CABLE_L_MM, width: TUBE_D_MM, height: TUBE_D_MM },
      package: {
        name: "Waterproof probe, stainless tube Ø6 x 30 mm, 3-wire cable",
        code: "ADA381",
        pin_count: 3,
        exposed_pad: false,
        source: `${PRODUCT_SPECS}`,
        assumption: "Adafruit names no package; the name is built from its cable specs. The three terminals are the wire ends, designated VDD, GND and DQ (the wire colours vary by batch).",
      },
      metadata: {
        tube: { material: "stainless steel", diameter_mm: TUBE_D_MM, length_mm: TUBE_L_MM },
        cable: { jacket: "PVC", diameter_mm: CABLE_D_MM, length_mm: CABLE_L_MM, length_in: 36, conductors: 3 },
        sealing: "heat shrink; not IP rated",
        dimensions_note: "overall about 940 mm: the 30 mm tube plus the 910 mm cable (whether the 91 cm includes the tube is not stated); width and height are the tube diameter",
        shipping_weight_g: 27.2,
        shipping_weight_note: "shipping weight from the Adafruit product record, packaging and the resistor included; not the probe's mass",
        source: [PRODUCT_SPECS, `${SRC.product} (Description)`, SRC.productApi],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-55, 100],
      metadata: {
        operating_note: "DS18B20 operating range -55 to +125 C; Adafruit: 'While the sensor is good up to 125°C the cable is jacketed in PVC so we suggest keeping it under 100°C.'",
        sensor_operating_C: [-55, 125],
        storage_C: [-55, 125],
        accuracy_C: [
          { range_C: [-10, 85], error_C: 0.5 },
          { range_C: [-30, 100], error_C: 1 },
          { range_C: [-55, 125], error_C: 2 },
        ],
        source: [`${SRC.datasheet} (Absolute Maximum Ratings; DC Electrical Characteristics, tERR)`, `${SRC.product} (Description; Technical specs)`],
      },
    },
  ],

  traits: [
    {
      type: "performance",
      params: {
        kind: "temperature_sensor",
        sensing: "DS18B20 digital thermometer",
        range_C: [-55, 125],
        accuracy_C: { "-10 to +85 C": 0.5, "-30 to +100 C": 1, "-55 to +125 C": 2 },
        accuracy_note: "3-sigma limits (datasheet Note 3)",
        resolution_bits: [9, 12],
        resolution_C: { 9: 0.5, 10: 0.25, 11: 0.125, 12: 0.0625 },
        default_resolution_bits: 12,
        conversion_time_ms_max: { 9: 93.75, 10: 187.5, 11: 375, 12: 750 },
        drift_C: 0.2,
        drift_note: "1000-hour stress test at +125 C, VDD = 5.5 V (datasheet Note 11)",
        alarm: "nonvolatile TH / TL alarm registers, Alarm Search [ECh]",
        source: [`${SRC.datasheet} (DC and AC Electrical Characteristics; Operation)`, PRODUCT_SPECS],
      },
    },
    {
      type: "operating_conditions",
      params: {
        supply_voltage_V: VDD_RANGE,
        pullup_supply_V: "3.0 V to VDD",
        temperature_C: [-55, 100],
        temperature_note: "sensor -55 to +125 C; probe kept under 100 C for the PVC cable",
        environment: "not IP rated; not for salt water or corrosive environments; not guaranteed for long-term or high-pressure use",
        source: [DS_DC, `${SRC.product} (Description; Technical Details)`],
      },
    },
    {
      type: "absolute_maximum",
      params: {
        voltage_any_pin_V: [-0.5, 6.0],
        operating_temperature_C: [-55, 125],
        storage_temperature_C: [-55, 125],
        source: `${SRC.datasheet} (Absolute Maximum Ratings)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "parasite power",
        note: "The DS18B20 can run without VDD: tie the red VDD wire to GND and power the device through DQ. The master must then switch a strong pull-up onto DQ within 10 us of a Convert T [44h] or Copy Scratchpad [48h] and hold it for the conversion (up to 750 ms) or 10 ms write, and cannot poll for completion. Parasite power is not recommended above +100 C. With VDD powered (as modelled) the bus stays free during conversions.",
        source: `${SRC.datasheet} (Powering the DS18B20; Figures 6, 7)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "firmware",
        note: "Adafruit points to the Dallas Temperature Control Arduino library with the OneWire library. Query time is less than 750 ms at 12 bits; lower resolutions convert faster (93.75 ms at 9 bits). Adafruit tests that the sensors are genuine Maxim DS18B20s (since January 2021).",
        source: [`${SRC.product} (Description; Technical Details)`, `${SRC.datasheet} (AC Electrical Characteristics)`],
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["probe mass", "wire gauge", "internal DS18B20 package", "heat-shrink and breakout dimensions", "whether the 91 cm includes the tube"],
        note: "Adafruit dimensions only the tube and the cable, and publishes only a shipping weight (27.2 g, with packaging and resistor).",
        source: [SRC.product, SRC.productApi],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The Adafruit product page has no CAD link (its Downloads list only the DS18B20 datasheet), and the adafruit/Adafruit_CAD_Parts GitHub repository has no model for 381 or any DS18B20 probe. Geometry is generated from the product page dimensions and the product photos (parts/local/adafruit-381-ds18b20-probe/adafruit-381-ds18b20-probe.py).",
        source: [SRC.product, "https://github.com/adafruit/Adafruit_CAD_Parts"],
      },
    },
    assumption(
      "build variant",
      "three-wire build: red VDD, blue or black GND, yellow or white DQ; no shield or drain wire",
      "Adafruit ships three-wire and four-wire builds under product 381 and does not say which arrives. The smart-bottle brief assumes the three-wire build. A four-wire probe adds a copper drain wire soldered to the shield (wire_ends usage_note).",
      PRODUCT_SPECS,
    ),
    assumption(
      "tube length",
      "the 30 mm is the exposed stainless length, from the closed tip to the heat-shrink sleeve",
      "Adafruit states 'Stainless steel tube 6mm diameter by 30mm long' without saying whether the tube continues under the heat shrink. Photo 381-02 scaled by the 6 mm tube shows about 33 mm of exposed stainless, which agrees within the photo's precision.",
      [PRODUCT_SPECS, SRC.photos],
    ),
    assumption(
      "generated heat-shrink geometry",
      "sleeve behind the tube Ø6.3 x 24 mm, then a sleeve over the cable Ø4.8 x 25 mm",
      "Not dimensioned. Read from photo 381-02 scaled by the 6 mm tube (25 px) and the 4 mm cable (16 px), about 0.245 mm/px: the first sleeve is about the tube diameter and 99 px long, the second 19-20 px wide and 103 px long.",
      SRC.photos,
    ),
    assumption(
      "generated cable and wire-end geometry",
      "only the rigid part is drawn: the stainless tube and the first 6 mm of the Ø6.3 heat shrink over the tube-to-cable joint; the three wires are drawn as Ø1.5 x 1 mm stubs on that cut face (red at +Y, GND at 210 deg, DQ at 330 deg, on a 0.9 mm radius)",
      "Changed in the smart-bottle project (2026-10-03): the heat shrink beyond the joint and the cable bend, so a project models them as its routed harness and cuts the cable to that length; drawing them straight (as the library did: sleeves 49 mm, jacket 50 mm, wires 35 mm) put 134 mm of rigid cable above the tube. The stiff 6 mm is itself an assumption (not dimensioned). The cable_length parameter still states the delivered 910 mm.",
      [SRC.photos, PRODUCT_SPECS],
    ),
  ],
});

// ---------------------------------------------------------------------------
// Geometry: representative CAD from parts/local/adafruit-381-ds18b20-probe/adafruit-381-ds18b20-probe.py
// (mm; probe axis on Z, closed tube tip at z = 0, cable and wires toward +Z). Only the rigid
// part is drawn: the tube and the first 6 mm of heat shrink; the cable is the project harness.
// ---------------------------------------------------------------------------

const WIRE_VDD = feature("wire_vdd", { area_mm2: 1.767, centroid: [0.0, 0.9, 37.0], normal: [0.0, 0.0, 1.0] });
const WIRE_GND = feature("wire_gnd", { area_mm2: 1.767, centroid: [-0.779, -0.45, 37.0], normal: [0.0, 0.0, 1.0] });
const WIRE_DQ = feature("wire_dq", { area_mm2: 1.767, centroid: [0.779, -0.45, 37.0], normal: [0.0, 0.0, 1.0] });

export const ADAFRUIT_381_DS18B20_PROBE: ModuleDef = withGeometry(
  ADAFRUIT_381_DS18B20_PROBE_BASE,
  {
    // exposed stainless tube: frame on the axis at the shoulder where the heat shrink begins,
    // normal along the tube toward the tip (the direction it enters a seal bore)
    tube: {
      frame: { origin: [0, 0, 30], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [
        feature("tube", { area_mm2: 565.487, centroid: [0.0, 0.0, 15.0] }),
        feature("tube_tip", { area_mm2: 28.274, centroid: [0.0, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
        own("tube"),
      ],
    },
    // the flexible run (heat shrink, then the jacket) leaves the stiff joint: frame on the cable axis, normal along the cable away from the probe
    cable_exit: {
      frame: { origin: [0, 0, 36], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("cable_exit", { area_mm2: 31.172, centroid: [0.0, 0.0, 36.0], normal: [0.0, 0.0, 1.0] }), own("cable_exit")],
    },
    // the three wires as drawn stubs on the cut face: frame at each, normal along the wire
    wire_vdd: { frame: { origin: [0, 0.9, 37], normal: [0, 0, 1], xAxis: [1, 0, 0] }, refs: [WIRE_VDD, own("wire_vdd")] },
    wire_gnd: { frame: { origin: [-0.779, -0.45, 37], normal: [0, 0, 1], xAxis: [1, 0, 0] }, refs: [WIRE_GND, own("wire_gnd")] },
    wire_dq: { frame: { origin: [0.779, -0.45, 37], normal: [0, 0, 1], xAxis: [1, 0, 0] }, refs: [WIRE_DQ, own("wire_dq")] },
    wire_ends: { refs: [WIRE_VDD, WIRE_GND, WIRE_DQ] },
  },
  cadArtifacts({
    dir: "parts/local/adafruit-381-ds18b20-probe",
    name: "adafruit-381-ds18b20-probe",
    generator: "parts/local/adafruit-381-ds18b20-probe/adafruit-381-ds18b20-probe.py",
    tool: "build123d 0.13.0",
    interfaces: ["tube", "tube_tip", "cable_exit", "wire_vdd", "wire_gnd", "wire_dq"],
  }),
);
