import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "wearable-watch",
  root: { source: "src/watch.uhd.ts", export: "WEARABLE_WATCH" },
  // local definitions: the system, the main board (src/boards), the case
  // (src/enclosures), the internal harnesses (src/harnesses), and three
  // purchased parts researched for this project (parts/local, evidence in
  // parts/evidence/)
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  // purchased parts from the Protoboard Cloud parts catalog (`protoboard parts add`),
  // pinned in parts/origins.json with their files under parts/catalog/<id>/
  catalog: "parts/catalog",
  // named variants (fault scenarios) carried into the UHD bundle for viewers
  scenarios: { source: "src/scenarios.ts", export: "SCENARIOS" },
  extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-docs", "@protoboardai/ext-harness-cad", "@protoboardai/ext-release"],
  // `protoboard release`: the Manufacturing Package gets a folder per unit. The
  // main board (with its display, soldered by the FPC) is built by the fab and
  // bench-tested on its own; everything else is final assembly into the case
  // (the root): leads, LRA, back cover, spring bars.
  release: {
    units: ["board"],
    // the watch's own bring-up and final checks: what the model cannot say how to test. Expected values come
    // from the parts, docs/power-budget.md and docs/decisions.md; each cites where.
    checks: [
      {
        unit: "board",
        check: "Display",
        subject: "DS1 ER-TFT1.28-1 on SPIM3, backlight Q1",
        how: "Firmware draws colour bars and a 1-pixel border; step the backlight PWM on P0.20 from 0 to 100 %",
        pass: "full 240 × 240 round image, no missing lines or columns, colours in order; the backlight follows the PWM and is off at 0 %",
        record: "pass or fail; photo",
        trace: "docs/system.md (display pins)",
      },
      {
        unit: "board",
        check: "Buttons and wake",
        subject: "SW1 on P1.02, SW2 on P1.04, IMU INT1 on P0.22",
        how: "Read each input while pressing; then put the module in System OFF and press SW1, SW2 and tap the board",
        pass: "each input reads low only while pressed; each of the three wakes the module from System OFF",
        record: "pass or fail per input",
        trace: "src/boards/watch-main/zephyr (wakeup-gpios)",
      },
      {
        unit: "board",
        check: "32.768 kHz crystal",
        subject: "Y1 with C4/C5 (20 pF) on XL1/XL2",
        how: "Firmware starts LFCLK from the crystal and reads LFCLKSTAT; count RTC ticks against a reference over 60 s",
        pass: "LFCLKSTAT shows the crystal running; error within ±50 ppm (Y1 ±20 ppm plus load-capacitance trim, OQ-W9)",
        record: "measured error in ppm",
        trace: "docs/decisions.md (Y1 load capacitance assumption)",
      },
      {
        unit: "board",
        check: "Charge current and status",
        subject: "U6 MCP73831 (RPROG 12 kΩ), STAT via R10/R11 to P0.08",
        how: "5 V on VBUS; electronic load or a cell at 3.7 V on J3; read the current into J3, then raise J3 to 4.2 V until charging ends",
        pass: "75–92 mA in constant current (83 mA nominal, ±10 %); P0.08 low while charging and high at termination, 2.4–2.6 V at the pin",
        record: "charge current; P0.08 voltage at termination",
        trace: "docs/power-budget.md (Charging); docs/decisions.md D-W17",
      },
      {
        unit: "board",
        check: "Fuel gauge",
        subject: "U5 MAX17048 on I2C 0x36",
        how: "Bench supply on J3 at 3.6, 3.8 and 4.1 V; read VCELL",
        pass: "VCELL within 20 mV of a meter at J3 at each point",
        record: "VCELL and meter readings",
        trace: "parts/catalog/adi-max17048g-t10",
      },
      {
        unit: "board",
        check: "Haptics",
        subject: "U4 DRV2605L with the VG0832012 on J4",
        how: "LRA soldered to J4 on the bench; run the DRV2605L's auto-calibration with RATED_VOLTAGE and OD_CLAMP for 1.8 Vrms; play effect 1",
        pass: "calibration reports no fault (DIAG_RESULT 0); the LRA vibrates; resonance near 235 Hz",
        record: "calibration result and reported back-EMF period",
        trace: "docs/decisions.md D-W9",
      },
      {
        unit: "board",
        check: "Sleep current",
        subject: "Whole board from J3",
        how: "3.7 V bench supply on J3 through a µA meter; firmware in its idle state: display sleep-in, IMU low-power, MAX30102 and DRV2605L shut down, BLE connected at a 1 s interval",
        pass: "average at most 75 µA (power budget floor 59.5 µA plus 25 %)",
        record: "average current over 60 s",
        trace: "docs/power-budget.md (Sleep floor); docs/power-budget.json",
      },
      {
        check: "Through the case",
        subject: "Lens, heart-rate cover, plungers, LRA on the back cover",
        how: "Closed watch on the wrist, firmware running",
        pass: "display fully visible through the lens; each plunger registers one press and springs back; the heart-rate reading settles within 30 s; a haptic alert is felt through the back cover",
        record: "pass or fail per item",
        trace: "docs/brief.md (Functions)",
      },
      {
        check: "Sleep current, closed",
        subject: "Wearable watch on its cell",
        how: "Cell lead cut-in or a µA meter in series with J3 before closing; idle state as on the board",
        pass: "average at most 75 µA",
        record: "average current over 60 s",
        trace: "docs/power-budget.md",
      },
    ],
  },
});
