/**
 * TEST FIXTURE parts for the grouped lamp board (docs/specs/nested-boards.md):
 * generic packages the provider has land patterns for (0402, 0603, SOT-23,
 * SOT-23-5, SOIC-8 through tscircuit/footprints.json, JST SH). Pinouts and
 * values are the fixture's own choices, not any real part's; nothing here is
 * a design to build.
 */
import { Connector, I2C, Led, Passive, defineModule, pinTable, type ModuleDef } from "@deltarobotics/uhd";

const FX = "Assumption: test fixture part; pinout and size are the fixture's choice, not a datasheet's.";
const chip = (code: "0402" | "0603") => ({
  package: { name: code, pin_count: 2, exposed_pad: false, assumption: FX },
  dimensions_mm: code === "0402" ? { length: 1.0, width: 0.5, height: 0.35 } : { length: 1.6, width: 0.8, height: 0.45 },
});

export const R_150 = Passive({ id: "fx-r-150-0402", name: "Resistor 150 Ω 0402", kind: "resistor", value: 150, unit: "Ω", tolerance: 0.01, ...chip("0402"), assumption: FX });
export const R_100K = Passive({ id: "fx-r-100k-0402", name: "Resistor 100 kΩ 0402", kind: "resistor", value: 100e3, unit: "Ω", tolerance: 0.01, ...chip("0402"), assumption: FX });
export const R_4K7 = Passive({ id: "fx-r-4k7-0402", name: "Resistor 4.7 kΩ 0402", kind: "resistor", value: 4.7e3, unit: "Ω", tolerance: 0.01, ...chip("0402"), assumption: FX });
export const C_100N = Passive({ id: "fx-c-100n-0402", name: "Capacitor 100 nF 0402", kind: "capacitor", value: 100e-9, unit: "F", ...chip("0402"), assumption: FX });
export const C_1U = Passive({ id: "fx-c-1u-0402", name: "Capacitor 1 µF 0402", kind: "capacitor", value: 1e-6, unit: "F", ...chip("0402"), assumption: FX });

export const LED_0603 = Led({
  id: "fx-led-white-0603",
  name: "White LED 0603",
  emitter: { color: "white", forward_voltage_V: [2.8, 3.2], test_current_mA: 5, max_current_mA: 20 },
  pins: { anode: 1, cathode: 2 },
  ...chip("0603"),
  assumption: FX,
});

const sot23 = (n: 3 | 5) => [{ domain: "mechanical" as const, dimensions_mm: { length: 2.9, width: 1.6, height: 1.1 }, package: { name: n === 3 ? "SOT-23" : "SOT-23-5", pin_count: n, pitch_mm: 0.95, exposed_pad: false, assumption: FX } }];

/** An N-channel MOSFET, SOT-23: 1 G, 2 S, 3 D. */
export const NMOS: ModuleDef = defineModule({
  id: "fx-nmos-sot23",
  name: "N-MOSFET SOT-23 (fixture)",
  categories: ["component.transistor"],
  interfaces: [...pinTable([[1, "G", "input"], [2, "S", "passive"], [3, "D", "passive"]], { logicV: [0, 5.5], source: FX })],
  domains: sot23(3),
});

/** A 3.3 V LDO, SOT-23-5: 1 VIN, 2 GND, 3 EN, 4 NC, 5 VOUT. */
export const LDO: ModuleDef = defineModule({
  id: "fx-ldo-3v3-sot23-5",
  name: "3.3 V LDO SOT-23-5 (fixture)",
  categories: ["component.power.regulator"],
  interfaces: [
    ...pinTable(
      [
        { pin: 1, name: "VIN", type: "power_in", voltageV: [3.6, 6] },
        [2, "GND", "ground"],
        [3, "EN", "input"],
        [4, "NC", "nc"],
        { pin: 5, name: "VOUT", type: "power_out", voltageV: [3.3, 3.3] },
      ],
      { logicV: [0, 6], source: FX },
    ),
  ],
  domains: sot23(5),
});

/** An I2C sensor, SOT-23-5: 1 VDD, 2 GND, 3 SDA, 4 SCL, 5 INT. */
export const SENSOR: ModuleDef = defineModule({
  id: "fx-i2c-sensor-sot23-5",
  name: "I2C sensor SOT-23-5 (fixture)",
  categories: ["sensor"],
  interfaces: [
    ...pinTable(
      [
        { pin: 1, name: "VDD", type: "power_in", voltageV: [1.8, 3.6] },
        [2, "GND", "ground"],
        { pin: 3, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
        { pin: 4, name: "SCL", type: "input", capabilities: ["i2c_scl"] },
        [5, "INT", "output"],
      ],
      { logicV: [0, 3.6], source: FX },
    ),
    ...I2C({ id: "i2c", roles: ["slave"], address: 0x48, sda: "pin_3", scl: "pin_4" }),
  ],
  domains: sot23(5),
});

/** The board's controller, SOIC-8: 1 VDD, 2 SDA, 3 SCL, 4 GPIO1, 5 GPIO2, 6 GPIO3, 7 NC, 8 GND. */
export const CONTROLLER: ModuleDef = defineModule({
  id: "fx-controller-soic8",
  name: "Controller SOIC-8 (fixture)",
  categories: ["microcontroller"],
  interfaces: [
    ...pinTable(
      [
        { pin: 1, name: "VDD", type: "power_in", voltageV: [1.8, 3.6] },
        { pin: 2, name: "SDA", type: "io", capabilities: ["i2c_sda"] },
        { pin: 3, name: "SCL", type: "io", capabilities: ["i2c_scl"] },
        [4, "GPIO1", "io"],
        [5, "GPIO2", "io"],
        [6, "GPIO3", "io"],
        [7, "NC", "nc"],
        [8, "GND", "ground"],
      ],
      { logicV: [0, 3.6], source: FX },
    ),
    ...I2C({ id: "i2c0", roles: ["master"], sda: "pin_2", scl: "pin_3" }),
  ],
  domains: [{ domain: "mechanical", dimensions_mm: { length: 4.9, width: 3.9, height: 1.5 }, package: { name: "SOIC-8", pin_count: 8, pitch_mm: 1.27, exposed_pad: false, assumption: FX } }],
});

/** Power in: JST SH 4-way, 1 VIN, 2 NC, 3 NC, 4 GND. */
export const JST_SH4: ModuleDef = defineModule({
  id: "fx-jst-sh4",
  name: "JST SH 4-way header (fixture)",
  categories: ["connector"],
  interfaces: [
    ...pinTable([{ pin: 1, name: "VIN", type: "power_in", voltageV: [4.5, 5.5] }, [2, "NC1", "nc"], [3, "NC2", "nc"], [4, "GND", "ground"]], { logicV: [0, 5.5], source: FX }),
    Connector({ id: "port", name: "Power in", connector: "jst_sh", gender: "receptacle", pins: [["VIN", "pin_1"], ["NC1"], ["NC2"], ["GND", "pin_4"]] }),
  ],
  domains: [{ domain: "mechanical", dimensions_mm: { length: 6.0, width: 4.25, height: 2.9 }, package: { name: "JST SH 4-pin side entry", pin_count: 4, pitch_mm: 1.0, exposed_pad: false, assumption: FX } }],
});
