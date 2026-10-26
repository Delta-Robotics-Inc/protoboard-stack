/**
 * TEST FIXTURE: a watch mainboard reduced to what firmware configures. An
 * nRF52840 module (Raytac MDBT50Q-1MV2) with, on one I2C bus, a heart-rate
 * sensor, a fuel gauge and a haptic driver; a round SPI display with D/C and
 * reset; a side button; the charger's status line; a 32.768 kHz crystal on
 * XL1/XL2; a GNSS receiver on a UART; USB.
 *
 * NOT A MANUFACTURABLE DESIGN: decoupling, the battery path, the display's
 * 2.8 V supply and backlight, and the heart-rate sensor's 1.8 V core supply
 * are left out. Pin choices follow the module's usage note: buses on
 * full-drive pads (16-29, 36-49), slow signals on the low-frequency pads.
 */
import { Net, defineModule, netLinks, type ModuleDef } from "@deltarobotics/uhd";

export const WATCH_CORE_BOARD: ModuleDef = defineModule({
  id: "watch-core-board",
  name: "Watch core board (test fixture)",
  interfaces: [
    Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }),
    Net({ id: "vbus", name: "VBUS", voltageV: 5 }),
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "i2c_sda", name: "I2C_SDA" }),
    Net({ id: "i2c_scl", name: "I2C_SCL" }),
    Net({ id: "hr_int", name: "HR_INT" }),
    Net({ id: "fg_alrt", name: "FG_ALRT" }),
    Net({ id: "hap_en", name: "HAP_EN" }),
    Net({ id: "stat", name: "STAT" }),
    Net({ id: "chg_stat", name: "CHG_STAT" }),
    Net({ id: "lcd_sck", name: "LCD_SCK" }),
    Net({ id: "lcd_mosi", name: "LCD_MOSI" }),
    Net({ id: "lcd_cs", name: "LCD_CS" }),
    Net({ id: "lcd_dc", name: "LCD_DC" }),
    Net({ id: "lcd_rst", name: "LCD_RST" }),
    Net({ id: "btn", name: "BTN" }),
    Net({ id: "xl1", name: "XL1" }),
    Net({ id: "xl2", name: "XL2" }),
    Net({ id: "gnss_tx", name: "GNSS_TX" }),
    Net({ id: "gnss_rx", name: "GNSS_RX" }),
    Net({ id: "usb_dp", name: "USB_D+" }),
    Net({ id: "usb_dm", name: "USB_D-" }),
  ],
  children: [
    { id: "u1", moduleDefId: "raytac-mdbt50q-1mv2", name: "MCU module" },
    { id: "u2", moduleDefId: "adi-max30102efd", name: "Heart-rate sensor" },
    { id: "u3", moduleDefId: "adi-max17048g-t10", name: "Fuel gauge" },
    { id: "u4", moduleDefId: "microchip-mcp73831t-2aci-ot", name: "Charger" },
    { id: "u5", moduleDefId: "ti-drv2605ldgs", name: "Haptic driver" },
    { id: "d1", moduleDefId: "eastrising-er-tft128-1", name: "Display" },
    { id: "sw1", moduleDefId: "alps-skrtlae010", name: "Side button" },
    { id: "y1", moduleDefId: "epson-fc-135-32k768-12p5", name: "32.768 kHz crystal" },
    { id: "r1", moduleDefId: "fx-r-4k7-0402", name: "SDA pull-up" },
    { id: "r2", moduleDefId: "fx-r-4k7-0402", name: "SCL pull-up" },
    { id: "r3", moduleDefId: "fx-r-4k7-0402", name: "STAT divider (top)" },
    { id: "r4", moduleDefId: "fx-r-4k7-0402", name: "STAT divider (bottom)" },
    { id: "m1", moduleDefId: "fx-gnss-uart", name: "GNSS" },
    { id: "j1", moduleDefId: "fx-usb-c", name: "USB-C" },
  ],
  links: [
    // supplies: VDD and VDDH together (normal voltage mode)
    ...netLinks("v3v3", ["u1:pin_28", "u1:pin_30", "u3:pin_3", "u5:pin_10", "m1:pin_1", "r1:pin_1", "r2:pin_1"]),
    ...netLinks("vbus", ["j1:pin_1", "u1:pin_32", "u4:pin_4"]),
    ...netLinks("gnd", [
      "u1:pin_1", "u1:pin_2", "u1:pin_15", "u1:pin_33", "u1:pin_55",
      "u2:pin_4", "u3:pin_4", "u3:ep", "u3:pin_1", "u3:pin_6", "u4:pin_2", "u5:pin_4",
      "d1:pin_1", "d1:pin_5", "d1:pin_6", "d1:pin_12",
      "sw1:pin_1", "sw1:pin_3", "m1:pin_2", "j1:pin_4", "r4:pin_2",
    ]),
    // I2C: heart rate, fuel gauge, haptics
    ...netLinks("i2c_sda", ["u1:pin_37", "u2:pin_3", "u3:pin_8", "u5:pin_3", "r1:pin_2"]),
    ...netLinks("i2c_scl", ["u1:pin_36", "u2:pin_2", "u3:pin_7", "u5:pin_2", "r2:pin_2"]),
    ...netLinks("hr_int", ["u1:pin_39", "u2:pin_13"]),
    ...netLinks("fg_alrt", ["u1:pin_38", "u3:pin_5"]),
    ...netLinks("hap_en", ["u1:pin_41", "u5:pin_5"]),
    // charger status on a low-frequency pad, through a divider: the MCP73831's STAT drives high to its VDD (VBUS)
    ...netLinks("stat", ["u4:pin_1", "r3:pin_1"]),
    ...netLinks("chg_stat", ["u1:pin_3", "r3:pin_2", "r4:pin_1"]),
    // display: 4-wire SPI with D/C and reset
    ...netLinks("lcd_sck", ["u1:pin_42", "d1:pin_9"]),
    ...netLinks("lcd_mosi", ["u1:pin_43", "d1:pin_10"]),
    ...netLinks("lcd_cs", ["u1:pin_44", "d1:pin_8"]),
    ...netLinks("lcd_dc", ["u1:pin_45", "d1:pin_7"]),
    ...netLinks("lcd_rst", ["u1:pin_46", "d1:pin_11"]),
    // side button: terminal 2 to the GPIO, 1 and 3 to GND (the part's typical wiring)
    ...netLinks("btn", ["u1:pin_4", "sw1:pin_2"]),
    ...netLinks("xl1", ["u1:pin_17", "y1:pin_1"]),
    ...netLinks("xl2", ["u1:pin_18", "y1:pin_2"]),
    // GNSS: its TXD to the MCU's receive pin, its RXD to the MCU's transmit pin
    ...netLinks("gnss_tx", ["u1:pin_16", "m1:pin_3"]),
    ...netLinks("gnss_rx", ["u1:pin_19", "m1:pin_4"]),
    ...netLinks("usb_dp", ["u1:pin_35", "j1:pin_3"]),
    ...netLinks("usb_dm", ["u1:pin_34", "j1:pin_2"]),
  ],
});
