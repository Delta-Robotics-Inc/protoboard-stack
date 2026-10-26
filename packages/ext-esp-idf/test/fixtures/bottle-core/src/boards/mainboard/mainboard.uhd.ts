/**
 * TEST FIXTURE: a smart-bottle cap board reduced to what firmware
 * configures. An ESP32-C3 module (ESP32-C3-MINI-1-H4X) with, on one I2C
 * bus, an RGB LED driver, a time-of-flight level sensor and a fuel gauge; a
 * DS18B20 temperature probe on 1-Wire; a BOOT button on GPIO9 and a wake
 * button on GPIO5; a 32.768 kHz crystal on GPIO0/1; a GNSS receiver on
 * GPIO20/21; USB Serial/JTAG on GPIO18/19.
 *
 * NOT A MANUFACTURABLE DESIGN: decoupling, the battery path, the LEDs on
 * the driver's outputs, the sensor's 2.8 V supply and the EN RC are left
 * out. Pin choices follow the module's usage notes: wake inputs on RTC GPIOs
 * (GPIO0-5), no peripheral output on the strapping pins GPIO2/8/9.
 */
import { Net, defineModule, netLinks, type ModuleDef } from "@deltarobotics/uhd";

export const BOTTLE_CORE_BOARD: ModuleDef = defineModule({
  id: "bottle-core-board",
  name: "Bottle core board (test fixture)",
  interfaces: [
    Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }),
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "i2c_sda", name: "I2C_SDA" }),
    Net({ id: "i2c_scl", name: "I2C_SCL" }),
    Net({ id: "fg_alrt", name: "FG_ALRT" }),
    Net({ id: "tof_int", name: "TOF_INT" }),
    Net({ id: "temp_dq", name: "TEMP_DQ" }),
    Net({ id: "btn_boot", name: "BTN_BOOT" }),
    Net({ id: "btn_wake", name: "BTN_WAKE" }),
    Net({ id: "x32k_p", name: "X32K_P" }),
    Net({ id: "x32k_n", name: "X32K_N" }),
    Net({ id: "gnss_tx", name: "GNSS_TX" }),
    Net({ id: "gnss_rx", name: "GNSS_RX" }),
    Net({ id: "usb_dp", name: "USB_D+" }),
    Net({ id: "usb_dm", name: "USB_D-" }),
  ],
  children: [
    { id: "u1", moduleDefId: "espressif-esp32-c3-mini-1-h4x", name: "MCU module" },
    { id: "u2", moduleDefId: "ti-lp5024rsm", name: "LED driver" },
    { id: "u3", moduleDefId: "st-vl53l4cdv0dh-1", name: "Level sensor" },
    { id: "u4", moduleDefId: "adi-max17048g-t10", name: "Fuel gauge" },
    { id: "p1", moduleDefId: "adafruit-381-ds18b20-probe", name: "Temperature probe" },
    { id: "sw1", moduleDefId: "alps-skrtlae010", name: "BOOT button" },
    { id: "sw2", moduleDefId: "alps-skrtlae010", name: "Wake button" },
    { id: "y1", moduleDefId: "epson-fc-135-32k768-12p5", name: "32.768 kHz crystal" },
    { id: "r1", moduleDefId: "fx-r-4k7-0402", name: "SDA pull-up" },
    { id: "r2", moduleDefId: "fx-r-4k7-0402", name: "SCL pull-up" },
    { id: "r3", moduleDefId: "fx-r-4k7-0402", name: "1-Wire pull-up" },
    { id: "m1", moduleDefId: "fx-gnss-uart", name: "GNSS" },
    { id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },
  ],
  links: [
    // LP5024 EN and the VL53L4CD XSHUT tied high: always on
    ...netLinks("v3v3", ["u1:pin_3", "u2:pin_27", "u2:pin_30", "u3:pin_5", "u4:pin_3", "p1:wire_vdd", "m1:pin_1", "r1:pin_1", "r2:pin_1", "r3:pin_1"]),
    ...netLinks("gnd", [
      "u1:pin_1", "u1:pin_2", "u1:pin_11", "u1:pin_14", "u1:pin_49",
      // LP5024 ADDR0/ADDR1 low: address 0x28
      "u2:pin_33", "u2:pin_25", "u2:pin_26",
      "u3:pin_2", "u3:pin_4", "u3:pin_6", "u3:pin_12",
      "u4:pin_4", "u4:ep", "u4:pin_1", "u4:pin_6",
      "p1:wire_gnd", "sw1:pin_1", "sw1:pin_3", "sw2:pin_1", "sw2:pin_3", "m1:pin_2", "j1:pin_4",
    ]),
    ...netLinks("i2c_sda", ["u1:pin_20", "u2:pin_28", "u3:pin_9", "u4:pin_8", "r1:pin_2"]),
    ...netLinks("i2c_scl", ["u1:pin_21", "u2:pin_29", "u3:pin_10", "u4:pin_7", "r2:pin_2"]),
    // interrupts on RTC GPIOs, so they can wake the chip
    ...netLinks("fg_alrt", ["u1:pin_6", "u4:pin_5"]),
    ...netLinks("tof_int", ["u1:pin_18", "u3:pin_7"]),
    ...netLinks("temp_dq", ["u1:pin_16", "p1:wire_dq", "r3:pin_2"]),
    // GPIO9 low at reset selects download boot: that is the BOOT button
    ...netLinks("btn_boot", ["u1:pin_23", "sw1:pin_2"]),
    ...netLinks("btn_wake", ["u1:pin_19", "sw2:pin_2"]),
    ...netLinks("x32k_p", ["u1:pin_12", "y1:pin_1"]),
    ...netLinks("x32k_n", ["u1:pin_13", "y1:pin_2"]),
    // GNSS on the UART0 pins (GPIO20 RX, GPIO21 TX); the console is on USB
    ...netLinks("gnss_tx", ["u1:pin_30", "m1:pin_3"]),
    ...netLinks("gnss_rx", ["u1:pin_31", "m1:pin_4"]),
    ...netLinks("usb_dp", ["u1:pin_27", "j1:pin_3"]),
    ...netLinks("usb_dm", ["u1:pin_26", "j1:pin_2"]),
  ],
});
