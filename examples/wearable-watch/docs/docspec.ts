/**
 * Documentation spec for the wearable watch (the uhd-tech-docs skill,
 * @protoboardai/ext-docs): the spec sheet and the assembly guide.
 *
 * Presentation only: which model values are "key", the order of assembly
 * steps, cameras and notes. Every value is a query into the model (ext-docs
 * lib/values.ts). The board, the cell and the LRA have no mate to the case
 * (they are held and bonded, docs/decisions.md D-W6), so their placements
 * come from the project's display file, the same placements the viewer uses.
 *
 *   npx protoboard run tech-docs && npx protoboard run tech-docs-verify
 */
import { readFileSync } from "node:fs";
import type { Mat4 } from "@deltarobotics/uhd";
import type { DocConfig } from "@protoboardai/ext-docs";

const display = JSON.parse(readFileSync(new URL("../.protoboard/display.json", import.meta.url), "utf8")) as {
  spatial: { placements: Record<string, { matrix: Mat4; note: string }> };
};
const hint = (id: string) => ({ path: [id], matrix: display.spatial.placements[id].matrix, note: `.protoboard/display.json: ${display.spatial.placements[id].note}` });

const MCU = "raytac-mdbt50q-1mv2";
const DISPLAY = "eastrising-er-tft128-1";
const CELL = "lipol-lp402030";
const PADS = "watch-cell-pads";
const IMU = "bosch-bmi270";
const HR = "adi-max30102efd";
const HAPTIC = "ti-drv2605ldgs";
const LRA = "vybronics-vg0832012";
const GAUGE = "adi-max17048g-t10";
const CHARGER = "microchip-mcp73831t-2aci-ot";
const SYS = "wearable-watch";

const p = (mod: string, iface: string, param: string) => `def:${mod}:interfaces[id=${iface}].parameters[id=${param}].value`;
const perf = (mod: string, key: string) => `def:${mod}:traits[type=performance].params.${key}`;
const mech = (mod: string, key: string) => `def:${mod}:domains[domain=mechanical].${key}`;

const config: DocConfig = {
  title: "Wearable Watch",
  subtitle: "Reference system",
  docId: "UHD-WATCH",
  revision: "A",
  root: ["case"],
  camera: { dir: [1, -1.1, -0.9] },
  placementHints: [hint("board"), hint("cell"), hint("lra")],

  datasheet: {
    keyFigures: [
      { label: "Display", q: perf(DISPLAY, "resolution"), sub: "1.28-inch round IPS" },
      { label: "Active area", q: perf(DISPLAY, "active_area_dia_mm"), f: "u=mm", sub: "display diameter" },
      { label: "Battery", q: p(CELL, "battery_out", "capacity"), sub: "1S LiPo" },
      { label: "Peak current", q: p(PADS, "battery_in", "current_draw"), f: "u=A|d3", sub: "with the firmware limits" },
      { label: "Charge current", q: p(PADS, "charge_out", "max_current"), f: "u=A|d3", sub: "USB-C, max" },
      { label: "All-up weight", q: "derived:mass.all_up", f: "d1", sub: "parts with a stated mass" },
    ],
    specGroups: [
      {
        title: "Display",
        rows: [
          { label: "Panel", q: `def:${DISPLAY}:name` },
          { label: "Technology", q: perf(DISPLAY, "technology") },
          { label: "Resolution", q: perf(DISPLAY, "resolution") },
          { label: "Active area", q: perf(DISPLAY, "active_area_dia_mm"), f: "u=mm" },
          { label: "Brightness", q: perf(DISPLAY, "brightness_cd_m2_typ"), f: "u=cd/m²", sub: "typical" },
          { label: "Controller", q: perf(DISPLAY, "controller") },
        ],
      },
      {
        title: "Sensors and haptics",
        rows: [
          { label: "IMU", q: `def:${IMU}:name` },
          { label: "Accelerometer ranges", q: perf(IMU, "accel_ranges_g"), f: "u=g" },
          { label: "Gyroscope ranges", q: perf(IMU, "gyro_ranges_dps"), f: "u=°/s" },
          { label: "Heart rate", q: `def:${HR}:name` },
          { label: "Heart-rate ADC", q: perf(HR, "adc_bits"), f: "u=bit" },
          { label: "Haptic driver", q: `def:${HAPTIC}:name` },
          { label: "Actuator", q: `def:${LRA}:name` },
        ],
      },
      {
        title: "Power",
        rows: [
          { label: "Cell", q: `def:${CELL}:name` },
          { label: "Capacity", q: p(CELL, "battery_out", "capacity") },
          { label: "Cell voltage", q: p(CELL, "battery_out", "voltage"), f: "d2" },
          { label: "Continuous discharge", q: p(CELL, "battery_out", "max_current") },
          { label: "Cell mass", q: mech(CELL, "weight_g") },
          { label: "Charger", q: `def:${CHARGER}:name` },
          { label: "Charge current (max)", q: p(PADS, "charge_out", "max_current"), f: "u=A|d4" },
          { label: "Fuel gauge", q: `def:${GAUGE}:name` },
        ],
      },
    ],
    envelope: {
      rows: [
        { label: "Case length", q: "def:watch-case:traits[type=design_envelope].params.max_mm.width", f: "u=mm", sub: "length across the lugs, max" },
        { label: "Strap width", q: "def:esslinger-82-2225-spring-bar:traits[type=performance].params.fits_lug_width_mm", f: "u=mm" },
        { label: "Case thickness", q: "def:watch-case:traits[type=design_envelope].params.max_mm.height", f: "u=mm", sub: "max" },
        { label: "Board diameter", q: "def:watch-main-board:traits[type=design_envelope].params.max_mm.length", f: "u=mm" },
        { label: "Cell thickness", q: mech(CELL, "dimensions_mm.height"), f: "u=mm" },
        { label: "Display mass", q: mech(DISPLAY, "weight_g") },
        { label: "All-up weight", q: "derived:mass.all_up", f: "d1", sub: "parts with a stated mass" },
      ],
    },
    heroHints: true,
    performance: {
      title: "Battery and power (estimates)",
      rows: [
        { label: "Battery life, typical use", q: perf(SYS, "typical_days"), f: "u=days", sub: "35 min screen, HR every 10 min, 20 alerts a day" },
        { label: "Battery life, standby", q: perf(SYS, "standby_days"), f: "u=days", sub: "BLE connected, screen off" },
        { label: "Charge per typical day", q: perf(SYS, "typical_mAh_per_day"), f: "u=mAh/day|d2" },
        { label: "Sleep floor", q: perf(SYS, "sleep_floor_uA"), f: "u=µA" },
        { label: "Peak current", q: perf(SYS, "peak_current_mA"), f: "u=mA", sub: "instantaneous, with the firmware limits" },
        { label: "Charge current, max", q: perf(SYS, "charge_current_max_mA"), f: "u=mA" },
        { label: "Charge time", q: perf(SYS, "charge_time_h"), f: "u=h", sub: "estimate, from empty" },
      ],
      note: "Computed by src/power-budget.ts from datasheet currents and an assumed use profile (docs/power-budget.md). Not measured: a discharge test replaces these.",
      charts: [
        {
          title: "Charge used per typical day",
          y: "Charge",
          unit: "mAh",
          decimals: 2,
          items: [
            { label: "Sleep floor", q: perf(SYS, "daily_mAh.sleep_floor") },
            { label: "Screen on", q: perf(SYS, "daily_mAh.screen_on") },
            { label: "Heart rate", q: perf(SYS, "daily_mAh.heart_rate") },
            { label: "Haptics", q: perf(SYS, "daily_mAh.haptics") },
          ],
          caption: "From the power budget's use profile: the screen dominates a typical day.",
        },
        {
          title: "Peak current stack-up",
          y: "Current",
          unit: "mA",
          items: [
            { label: "3V0 load", q: perf(SYS, "peak_mA.load_3v0") },
            { label: "Backlight", q: perf(SYS, "peak_mA.backlight") },
            { label: "LRA", q: perf(SYS, "peak_mA.lra") },
            { label: "HR LEDs", q: perf(SYS, "peak_mA.hr_leds") },
          ],
          refs: [{ label: "cell 200 mA continuous", q: perf(SYS, "cell_continuous_mA") }],
          caption: "Instantaneous currents from VBAT with the firmware limits; their sum is the peak.",
        },
      ],
    },
    mechanicalCallouts: ["case.display_window", "case.usb_opening", "case.hr_window", "case.lugs_12", "case.lugs_6"],
    hub: "board",
  },

  assembly: {
    explode: 12,
    steps: [
      {
        id: "covers",
        title: "Fit the lens, the heart-rate cover and the plungers",
        mates: ["lens_seat", "hr_cover_seat"],
        place: ["cover_adhesive"],
        actions: [
          "Push the two printed plungers (plunger_button_1, plunger_button_2) into their bores in the case wall from inside, flange inwards; each must slide freely.",
        ],
        notes: [
          { kind: "tip", text: "Peel the protective film from the inner face only. Put a thin bead of adhesive on each pocket's ledge, press the cover in flush and cure it before anything goes inside the case." },
          { kind: "caution", text: "Keep adhesive off the apertures: on the heart-rate window it would scatter the sensor's light (OQ-W7)." },
        ],
      },
      {
        id: "cell-leads",
        title: "Solder the cell leads to J3",
        wiring: ["cell_*"],
        // the pads are sites of the board (frames, not parts fitted here)
        mates: ["board/j3_site"],
        figure: "wiring",
        actions: ["Lay the cell flat beside the board's +y edge, PCM end towards J3 and no more than 3 mm past the board's edge, so its leads reach J3 on the board's rear face."],
        notes: [
          { kind: "caution", text: "Red (+) to pad 1, black (-) to pad 2. Cut and strip one lead at a time so the two never touch: the cell is charged and its PCM is the only protection." },
          { kind: "tip", text: "Cut the leads to the length in the BOM (installed length plus 1.5 mm stripped) before stripping: the cell then folds under the board with no slack to spare." },
        ],
      },
      {
        id: "board",
        title: "Fold the cell and the display, and seat the board in the case",
        place: ["cell_pad", "cell", "display_ring", "board"],
        explode: 14,
        // from the back, the case face down on the bench
        camera: { dir: [0.9, -1.1, 1.2] },
        actions: [
          "Fold the cell under the board's rear face on its leads, PCM end towards 12 o'clock, and stick it to the display's rear face with the foam pad.",
          "Fold the display over the cell on its FPC, viewing face out.",
          "Stick the adhesive ring to the display's front rim, outside its visual area, and lower the board and display into the case: display face onto the floor, USB-C into its opening, button stems behind their plungers.",
        ],
        notes: [
          { kind: "caution", text: "Do not crease the display's FPC: it bends once, past the cell's edge, as it left the board unit." },
        ],
      },
      {
        id: "lra-leads",
        title: "Solder the LRA leads to J4",
        wiring: ["lra_*"],
        mates: ["board/j4_site"],
        figure: "wiring",
        notes: [{ kind: "tip", text: "Red (+) to pad 1, blue (-) to pad 2, with the LRA lying in the board's free region (x 5.7-14.5 mm). An LRA is not polarised in use, but keeping the order makes the test record comparable." }],
      },
      {
        id: "lra",
        title: "Put the LRA in place for the back cover",
        place: ["lra_pad", "lra"],
        camera: { dir: [0.9, -1.1, 1.2] },
        notes: [{ kind: "tip", text: "Stick the adhesive pad on the LRA's can face and leave its liner on until the back cover goes on: the cover picks the LRA up as it closes. Leads towards J4 (12 o'clock), clear of the heart-rate window." }],
      },
      {
        id: "close",
        title: "Press the inserts and close the back cover",
        mates: ["back_cover"],
        explode: 10,
        camera: { dir: [0.9, -1.1, 1.2] },
        actions: ["Remove the LRA pad's liner, then lower the back cover so the pad meets the cover's inner face, heart-rate window over U3."],
        notes: [{ kind: "tip", text: "Press the four inserts flush with the joint face before the first assembly (iron at about 220 °C for PETG). Tighten the screws in a cross pattern." }],
        after: "test",
      },
      {
        id: "strap",
        title: "Fit the spring bars",
        mates: ["bar_*_lugs"],
        wiring: ["bar_*_lugs"],
        explode: 10,
        after: "test",
      },
    ],
  },
};

export default config;
