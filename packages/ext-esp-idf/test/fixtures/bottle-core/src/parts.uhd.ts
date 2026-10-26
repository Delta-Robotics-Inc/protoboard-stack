/**
 * TEST FIXTURE parts (project-specific): I2C pull-ups, a UART GNSS receiver
 * and a USB-C receptacle, reduced to the pins a firmware configuration
 * reads. The researched parts come from parts/catalog.
 */
import { Passive, UART, defineModule, pinTable, type ModuleDef } from "@deltarobotics/uhd";

const EIA = "Assumption: nominal EIA 0402 outline (1.0 × 0.5 × 0.35 mm); no part number chosen.";

export const R_4K7 = Passive({
  id: "fx-r-4k7-0402",
  name: "Resistor 4.7 kΩ 1 % 0402",
  kind: "resistor",
  value: 4.7e3,
  unit: "Ω",
  tolerance: 0.01,
  package: { name: "0402", pin_count: 2, exposed_pad: false, assumption: EIA },
  dimensions_mm: { length: 1.0, width: 0.5, height: 0.35 },
  assumption: "Pull-up: a common value at 400 kHz and 3.3 V, not sized from a bus-capacitance budget.",
});

const gnssPins = pinTable(
  [
    { pin: 1, name: "VCC", type: "power_in", voltageV: [3.0, 3.6], nominalV: 3.3 },
    { pin: 2, name: "GND", type: "ground" },
    { pin: 3, name: "TXD", type: "output", capabilities: ["uart_tx"] },
    { pin: 4, name: "RXD", type: "input", capabilities: ["uart_rx"] },
  ],
  { source: "test fixture", logicV: [0, 3.6] },
);

/** A GNSS receiver on a UART at 9600 baud (fixture: no real part). */
export const GNSS: ModuleDef = defineModule({
  id: "fx-gnss-uart",
  name: "GNSS receiver, UART (test fixture)",
  categories: ["sensor", "sensor.gnss"],
  domains: [{ domain: "mechanical", package: { name: "LCC-18 module", pin_count: 4, exposed_pad: false, assumption: "fixture" }, dimensions_mm: { length: 10, width: 10, height: 2.5 } }],
  interfaces: [
    ...gnssPins,
    ...UART({ id: "uart", name: "NMEA UART", tx: "pin_3", rx: "pin_4", defaultActive: true }).map((i) => (i.id === "uart" ? { ...i, parameters: [...(i.parameters ?? []), { id: "baud_rate", name: "Default baud rate", unit: "baud", value: 9600 }] } : i)),
  ],
});

/** USB-C receptacle, USB 2.0 pins only (fixture). */
export const USB_C: ModuleDef = defineModule({
  id: "fx-usb-c",
  name: "USB-C receptacle, USB 2.0 (test fixture)",
  categories: ["connector", "connector.usb"],
  domains: [{ domain: "mechanical", package: { name: "USB-C 6-pin", pin_count: 4, exposed_pad: false, assumption: "fixture: shell and CC pins left out" }, dimensions_mm: { length: 7.3, width: 8.9, height: 3.2 } }],
  interfaces: pinTable(
    [
      { pin: 1, name: "VBUS", type: "power_out", voltageV: [4.75, 5.25], nominalV: 5 },
      { pin: 2, name: "D-", type: "io", protocols: [{ type: "usb", roles: ["bidirectional"] }], capabilities: ["usb_dm"] },
      { pin: 3, name: "D+", type: "io", protocols: [{ type: "usb", roles: ["bidirectional"] }], capabilities: ["usb_dp"] },
      { pin: 4, name: "GND", type: "ground" },
    ],
    { source: "test fixture", logicV: [0, 3.6] },
  ),
});
