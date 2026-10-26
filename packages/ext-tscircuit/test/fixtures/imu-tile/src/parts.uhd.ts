/**
 * TEST FIXTURE parts for the IMU tile board (project-researched tier): the
 * passives, the inductor and the edge connector. The three ICs come from the
 * UHD library through parts/catalog.
 *
 * Values follow the cited application notes. Chip sizes are nominal EIA
 * outlines, stated once here as an assumption: they are what a part number
 * would pin down, and the fixture names none.
 */
import { Connector, Passive, defineModule, pinTable, type ModuleDef } from "@deltarobotics/uhd";

const TPS = "https://www.ti.com/lit/ds/symlink/tps63020.pdf";
const RP = "https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf";
const BMI = "https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmi270-ds000.pdf";
const EIA = "Assumption: nominal EIA chip outline (0402 1.0 × 0.5 × 0.35 mm, 0603 1.6 × 0.8 × 0.45 mm, 0805 2.0 × 1.25 × 0.85 mm); no part number chosen.";

const chip = (code: "0402" | "0603" | "0805") => ({
  package: { name: code, pin_count: 2, exposed_pad: false, assumption: EIA },
  dimensions_mm: { "0402": { length: 1.0, width: 0.5, height: 0.35 }, "0603": { length: 1.6, width: 0.8, height: 0.45 }, "0805": { length: 2.0, width: 1.25, height: 0.85 } }[code],
});

export const R_1M = Passive({ id: "fx-r-1m-0402", name: "Resistor 1 MΩ 1 % 0402", kind: "resistor", value: 1e6, unit: "Ω", tolerance: 0.01, ...chip("0402"), source: `${TPS} (§8.2 Figure 7, R1 for VOUT 3.3 V)` });
export const R_180K = Passive({ id: "fx-r-180k-0402", name: "Resistor 180 kΩ 1 % 0402", kind: "resistor", value: 180e3, unit: "Ω", tolerance: 0.01, ...chip("0402"), source: `${TPS} (§8.2 Figure 7, R2 for VOUT 3.3 V)` });
export const R_4K7 = Passive({
  id: "fx-r-4k7-0402",
  name: "Resistor 4.7 kΩ 1 % 0402",
  kind: "resistor",
  value: 4.7e3,
  unit: "Ω",
  tolerance: 0.01,
  ...chip("0402"),
  assumption: "I2C pull-up: a common value at 400 kHz and 3.3 V, not sized from a bus-capacitance budget.",
});
export const C_100N = Passive({ id: "fx-c-100n-0402", name: "Capacitor 100 nF X7R 0402", kind: "capacitor", value: 100e-9, unit: "F", ...chip("0402"), source: `${RP} (§2.9.1, §2.9.2: 100 nF per IOVDD and DVDD pin); ${BMI} (§7.2: 100 nF at VDDIO and VDD); ${TPS} (§8.2.2.5: 0.1 µF VINA bypass)` });
export const C_1U = Passive({ id: "fx-c-1u-0402", name: "Capacitor 1 µF X5R 0402", kind: "capacitor", value: 1e-6, unit: "F", ...chip("0402"), source: `${RP} (§2.10.1: 1 µF at VREG_VIN and VREG_VOUT)` });
export const C_10U = Passive({ id: "fx-c-10u-0603", name: "Capacitor 10 µF X5R 0603", kind: "capacitor", value: 10e-6, unit: "F", ...chip("0603"), source: `${TPS} (§8.2.2.4: 10 µF input capacitor)` });
export const C_22U = Passive({ id: "fx-c-22u-0805", name: "Capacitor 22 µF X5R 0805", kind: "capacitor", value: 22e-6, unit: "F", ...chip("0805"), source: `${TPS} (§8.2.2.3: three 22 µF output capacitors)` });

/** Coilcraft XFL4020-152ME, named in TPS63020 §8.2.2 (inductor table: 1.5 µH, 5.1 A, 4 × 4 × 2.1 mm). */
export const L_XFL4020 = Passive({
  id: "fx-coilcraft-xfl4020-152me",
  name: "Inductor 1.5 µH Coilcraft XFL4020-152ME",
  kind: "inductor",
  value: 1.5e-6,
  unit: "H",
  manufacturer: "Coilcraft",
  part_number: "XFL4020-152ME",
  package: { name: "XFL4020", pin_count: 2, exposed_pad: false, source: `${TPS} (§8.2.2 inductor table: 4 x 4 x 2.1 mm)` },
  dimensions_mm: { length: 4.0, width: 4.0, height: 2.1 },
  source: `${TPS} (§8.2 Figure 7 L1 1.5 µH; §8.2.2 inductor table)`,
});

/**
 * Edge connector: JST SH 4-way side-entry SMD header (SM04B-SRSS-TB), carrying
 * the supply input and SWD. The pin assignment is this fixture's choice.
 */
const JST = "https://www.jst-mfg.com/product/pdf/eng/eSH.pdf";
const jstPins = pinTable(
  [
    { pin: 1, name: "VIN", type: "power_in", voltageV: [2.5, 5.5] },
    [2, "SWDIO", "io"],
    [3, "SWCLK", "io"],
    [4, "GND", "ground"],
  ],
  { source: `${JST} (SH series, 1.0 mm pitch); pin assignment: fixture choice`, logicV: [0, 3.6] },
);
export const JST_SH4: ModuleDef = defineModule({
  id: "fx-jst-sm04b-srss-tb",
  name: "JST SH 4-way side-entry header SM04B-SRSS-TB",
  manufacturer: "JST",
  part_number: "SM04B-SRSS-TB",
  categories: ["connector"],
  interfaces: [
    ...jstPins,
    Connector({ id: "port", name: "Power + SWD", connector: "jst_sh", gender: "receptacle", pins: [["VIN", "pin_1"], ["SWDIO", "pin_2"], ["SWCLK", "pin_3"], ["GND", "pin_4"]] }),
  ],
  domains: [
    {
      domain: "mechanical",
      dimensions_mm: { length: 6.0, width: 4.25, height: 2.9 },
      package: {
        name: "JST SH 4-pin side entry",
        pin_count: 4,
        pitch_mm: 1.0,
        exposed_pad: false,
        source: `${JST} (SH series, SMT side entry)`,
        assumption: "Body 6.0 × 4.25 × 2.9 mm and the two mechanical tabs recalled for SM04B-SRSS-TB, not re-read from the drawing in this fixture.",
      },
    },
  ],
});
