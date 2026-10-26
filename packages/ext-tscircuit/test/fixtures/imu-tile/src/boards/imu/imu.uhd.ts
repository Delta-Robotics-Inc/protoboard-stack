/**
 * TEST FIXTURE: the IMU tile board, an RP2040 reading a BMI270 over I2C, both
 * on 3.3 V from a TPS63020 buck-boost, fed and debugged through a JST SH
 * header. It started from the layout of UHD's fixture board (uhd
 * test/fixtures/imu-board.ts, which now uses synthetic chips) and adds the
 * real parts, the decoupling, the regulator's input/output capacitors and the
 * connector, so a PCB tool has every component it must place.
 *
 * NOT A MANUFACTURABLE DESIGN. Left out: the RP2040's QSPI flash, crystal,
 * USB and BOOTSEL; four of its six IOVDD and one of its two DVDD capacitors
 * (RP2040 datasheet §2.9.1–2.9.2 asks for one per pin); the TPS63020's
 * power-good pull-up. Decoupling is on the board as components, as UHD
 * requires: the provider adds none.
 *
 * Sources: TPS6302x SLVS916I §8.2 (Figure 7, Table 3, §8.2.2.3–8.2.2.5);
 * BMI270 BST-BMI270-DS000-08 Table 22 and §7.2; RP2040 datasheet Table 1,
 * §2.9–2.10. URLs are on the parts.
 */
import { Net, defineModule, netLinks, type ModuleDef } from "@deltarobotics/uhd";

export const IMU_TILE_BOARD: ModuleDef = defineModule({
  id: "imu-tile-board",
  name: "IMU tile board (test fixture)",
  description: "RP2040 + BMI270 on I2C0, 3.3 V from a TPS63020, power and SWD on a JST SH header. Test fixture; not a complete design.",
  interfaces: [
    Net({ id: "vin", name: "VIN", voltageV: [2.5, 5.5] }),
    Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }),
    Net({ id: "v1v1", name: "1V1", voltageV: 1.1 }),
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "fb", name: "FB" }),
    Net({ id: "sw1", name: "SW1" }),
    Net({ id: "sw2", name: "SW2" }),
    Net({ id: "sda", name: "SDA" }),
    Net({ id: "scl", name: "SCL" }),
    Net({ id: "imu_int1", name: "IMU_INT1" }),
    Net({ id: "swdio", name: "SWDIO" }),
    Net({ id: "swclk", name: "SWCLK" }),
  ],
  children: [
    { id: "u1", moduleDefId: "rp2040", name: "MCU" },
    { id: "u2", moduleDefId: "bosch-bmi270", name: "IMU" },
    { id: "u3", moduleDefId: "ti-tps63020dsjr", name: "3V3 buck-boost" },
    { id: "l1", moduleDefId: "fx-coilcraft-xfl4020-152me", name: "Buck-boost inductor" },
    { id: "r1", moduleDefId: "fx-r-1m-0402", name: "FB upper" },
    { id: "r2", moduleDefId: "fx-r-180k-0402", name: "FB lower" },
    { id: "r3", moduleDefId: "fx-r-4k7-0402", name: "SDA pull-up" },
    { id: "r4", moduleDefId: "fx-r-4k7-0402", name: "SCL pull-up" },
    { id: "c1", moduleDefId: "fx-c-10u-0603", name: "VIN input" },
    { id: "c2", moduleDefId: "fx-c-100n-0402", name: "VINA bypass" },
    { id: "c3", moduleDefId: "fx-c-22u-0805", name: "VOUT 1" },
    { id: "c4", moduleDefId: "fx-c-22u-0805", name: "VOUT 2" },
    { id: "c5", moduleDefId: "fx-c-22u-0805", name: "VOUT 3" },
    { id: "c6", moduleDefId: "fx-c-100n-0402", name: "IOVDD pin 1" },
    { id: "c7", moduleDefId: "fx-c-100n-0402", name: "IOVDD pin 22" },
    { id: "c8", moduleDefId: "fx-c-100n-0402", name: "DVDD pin 23" },
    { id: "c9", moduleDefId: "fx-c-1u-0402", name: "VREG_VIN" },
    { id: "c10", moduleDefId: "fx-c-1u-0402", name: "VREG_VOUT" },
    { id: "c11", moduleDefId: "fx-c-100n-0402", name: "IMU VDD" },
    { id: "c12", moduleDefId: "fx-c-100n-0402", name: "IMU VDDIO" },
    { id: "j1", moduleDefId: "fx-jst-sm04b-srss-tb", name: "Power + SWD header" },
  ],
  links: [
    // TPS63020: VIN, VINA, EN and PS/SYNC on the input (Figure 7)
    ...netLinks("vin", ["u3:pin_10", "u3:pin_11", "u3:pin_1", "u3:pin_12", "u3:pin_13", "c1:pin_1", "c2:pin_1", "j1:pin_1"]),
    ...netLinks("sw1", ["u3:pin_8", "u3:pin_9", "l1:pin_1"]),
    ...netLinks("sw2", ["u3:pin_6", "u3:pin_7", "l1:pin_2"]),
    ...netLinks("fb", ["u3:pin_3", "r1:pin_2", "r2:pin_1"]),
    ...netLinks("v3v3", [
      "u3:pin_4", "u3:pin_5", "r1:pin_1", "c3:pin_1", "c4:pin_1", "c5:pin_1",
      // RP2040 IOVDD ×6, ADC_AVDD, VREG_VIN, USB_VDD
      "u1:pin_1", "u1:pin_10", "u1:pin_22", "u1:pin_33", "u1:pin_42", "u1:pin_49", "u1:pin_43", "u1:pin_44", "u1:pin_48",
      "c6:pin_1", "c7:pin_1", "c9:pin_1",
      // BMI270 VDD, VDDIO, and CSB high for I2C
      "u2:pin_8", "u2:pin_5", "u2:pin_12", "c11:pin_1", "c12:pin_1",
      "r3:pin_1", "r4:pin_1",
    ]),
    // RP2040 core: VREG_VOUT feeds both DVDD pins
    ...netLinks("v1v1", ["u1:pin_45", "u1:pin_23", "u1:pin_50", "c8:pin_1", "c10:pin_1"]),
    ...netLinks("gnd", [
      "u3:pin_2", "u3:pgnd", "r2:pin_2",
      "u1:pad_gnd", "u1:pin_19", // TESTEN tied to GND
      "u2:pin_6", "u2:pin_7", "u2:pin_1", // SDO low: I2C address 0x68
      "c1:pin_2", "c2:pin_2", "c3:pin_2", "c4:pin_2", "c5:pin_2", "c6:pin_2", "c7:pin_2", "c8:pin_2", "c9:pin_2", "c10:pin_2", "c11:pin_2", "c12:pin_2",
      "j1:pin_4",
    ]),
    ...netLinks("sda", ["u1:pin_2", "u2:pin_14", "r3:pin_2"]),
    ...netLinks("scl", ["u1:pin_3", "u2:pin_13", "r4:pin_2"]),
    ...netLinks("imu_int1", ["u1:pin_4", "u2:pin_4"]),
    ...netLinks("swdio", ["u1:pin_25", "j1:pin_2"]),
    ...netLinks("swclk", ["u1:pin_24", "j1:pin_3"]),
  ],
  // the board edge: the header, and the debug port behind it
  exports: [
    { id: "port", name: "Power + SWD", from: { child: "j1", interfaceId: "port" } },
    { id: "swd", name: "SWD", from: { child: "u1", interfaceId: "swd" } },
  ],
  traits: [
    {
      type: "design_envelope",
      params: { max_mm: { length: 32, width: 32, height: 6 }, reason: "Fixture requirement: fits a 32 mm round bay." },
    },
  ],
});
