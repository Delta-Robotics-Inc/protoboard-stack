import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "quadcopter-5in",
  root: { source: "src/quadcopter.uhd.ts", export: "QUADCOPTER_5IN" },
  // local definitions: the system, custom frame and top plate, sub-assemblies,
  // harnesses and assembly materials (src/), and the purchased parts
  // researched here (parts/local: the bulk capacitor and the mounting
  // hardware, evidence in parts/evidence/; each with a cad.config.ts)
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  // purchased parts from the Protoboard Cloud parts catalog (`protoboard parts add`),
  // pinned in parts/origins.json with their files under parts/catalog/<id>/
  catalog: "parts/catalog",
  // named variants (fault scenarios) carried into the UHD bundle for viewers
  scenarios: { source: "src/scenarios.ts", export: "SCENARIOS" },
  // installed npm packages with a protoboard-extension.json
  extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-docs", "@protoboardai/ext-drone", "@protoboardai/ext-frame-cad", "@protoboardai/ext-harness-cad", "@protoboardai/ext-release"],
  // `protoboard release`: the Manufacturing Package gets a folder per unit. The
  // flight stack is built and bench-tested on its own; everything else is
  // final assembly onto the frame (the root). The arms (motor + prop) are not
  // units: propellers go on last, after configuration with the props off.
  release: {
    units: ["stack"],
    // the quadcopter's own bring-up checks: what the model cannot say how to test. Expected values come from the
    // parts, docs/power-budget.md and docs/decisions.md; each cites where.
    checks: [
      {
        unit: "stack",
        check: "Flight-controller sensors",
        subject: "DolphinRC F405 V3: ICM-42688-P gyro, SPL06-001 barometer",
        how: "USB-C to Betaflight Configurator; Setup tab, then tilt the stack by hand",
        pass: "the sensor line shows the gyro/accelerometer and the barometer; the model on the Setup tab follows the tilt",
        record: "sensors shown; firmware version",
        trace: "parts/catalog/dolphinrc-f405-v3-flight-controller (manual p.2)",
      },
      {
        unit: "stack",
        check: "ESCs answer",
        subject: "DolphinRC AM32 60A 4-in-1 ESC through the FC (passthrough)",
        how: "Bench supply on the ESC battery pads; the AM32 configurator (or the ESC tab of Betaflight) through the FC's USB, read all four",
        pass: "four ESCs found, AM32 firmware for the AT32F421; no motor is connected yet, so nothing turns",
        record: "ESC firmware version per channel",
        trace: "parts/catalog/dolphinrc-am32-60a-4in1-esc",
      },
      {
        unit: "stack",
        check: "Battery voltage and current readings",
        subject: "FC VBAT and CUR from the ESC over the 8-pin cable",
        how: "Bench supply at 22.2 V on the ESC battery pads; Betaflight Power & Battery tab, a multimeter on the pads",
        pass: "voltage within 0.2 V of the meter (target); current reads near zero with nothing loaded (the configuration sets scale 150, offset 0 at final assembly; record the stock reading here)",
        record: "meter and Betaflight voltages; idle current reading",
        trace: "firmware/betaflight/cli.txt (current_meter, ibata_scale)",
      },
      {
        phase: "power",
        check: "Motor lead gauge",
        subject: "MEPS NEON 2207 V2 phase lead (one lead, cut end)",
        how: "Calipers on the bare strand bundle of a cut lead, before tinning",
        pass: "about 0.8 mm (20 AWG, as modelled); about 0.5 mm means 24 AWG: record it and see docs/decisions.md D-Q03",
        record: "bundle diameter; gauge found",
        trace: "docs/decisions.md D-Q03",
      },
      {
        phase: "power",
        check: "Bench current with every load",
        subject: "Quadcopter on the bench supply, props off, receiver, air unit and GNSS connected",
        how: "Bench supply at 22.2 V in place of the pack, after the power-up check; read the supply current for 2 min with the air unit transmitting",
        pass: "at most 1 A (the stated loads need about 10.3 W, 0.46 A at 22.2 V; the FC, ESC and receiver state no idle draw: docs/power-budget.md)",
        record: "supply current after 2 min",
        trace: "docs/power-budget.md",
      },
      {
        check: "Motor order and spin",
        subject: "ESC motor pads M1–M4 against Betaflight Quad-X",
        how: "Props off; Betaflight Motors tab, spin each motor alone at low throttle and watch which corner turns and which way",
        pass: "M1 rear-right CW, M2 front-right CCW, M3 rear-left CCW, M4 front-left CW, seen from above (docs/decisions.md D-Q02); reverse a motor in the ESC configurator, never by re-soldering",
        record: "corner and direction per motor; any channel reversed",
        trace: "docs/decisions.md D-Q02; src/quadcopter.uhd.ts (ARMS)",
      },
      {
        check: "Failsafe",
        subject: "RP1 V2 link and Betaflight failsafe",
        how: "Props off, armed on the bench with the transmitter on; switch the transmitter off",
        pass: "the motors stop and Betaflight reports RXLOSS / failsafe within 2 s (target)",
        record: "time to failsafe",
        trace: "docs/brief.md R4",
      },
    ],
  },
});
