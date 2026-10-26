/**
 * Documentation spec for the smart bottle (the uhd-tech-docs skill,
 * @protoboardai/ext-docs): the datasheet and assembly guide, and through the
 * release the Manufacturing Package's spec sheet and assembly guide.
 *
 * Presentation only: which model values are "key", the order of assembly
 * steps, cameras and notes. Every value is a query into the model; battery
 * life is the power budget's stand-in test data (docs/test-data/
 * battery-life.json, written by scripts/power-budget.ts), watermarked until
 * measured.
 *
 *   npx protoboard run tech-docs && npx protoboard run tech-docs-verify
 */
import type { DocConfig } from "@protoboardai/ext-docs";

const ESP = "espressif-esp32-c3-mini-1-h4x";
const TOF = "st-vl53l4cdv0dh-1";
const PROBE = "adafruit-381-ds18b20-probe";
const CELL = "lipol-lp503450";
const LED = "ti-lp5024rsm";
const CHG = "microchip-mcp73831t-2aci-mc";
const BB = "ti-tps63020dsjr";
const GAUGE = "adi-max17048g-t10";
const USB = "gct-usb4720-03-a";
const BOTTLE = "nalgene-32oz-wide-mouth";
const CAP = "bottle-cap-enclosure";

const p = (mod: string, iface: string, param: string) => `def:${mod}:interfaces[id=${iface}].parameters[id=${param}].value`;
const perf = (mod: string, key: string) => `def:${mod}:traits[type=performance].params.${key}`;
const mech = (mod: string, key: string) => `def:${mod}:domains[domain=mechanical].${key}`;

const config: DocConfig = {
  title: "Smart Water Bottle Cap",
  subtitle: "Reference system",
  docId: "UHD-BOTTLE",
  revision: "A",
  root: ["cap"],
  camera: { dir: [1, -1.2, 0.9] },

  datasheet: {
    keyFigures: [
      { label: "Battery life", q: "test:battery-life:summary[id=target_days].value", f: "d0", sub: "minute samples, hourly sync" },
      { label: "Cell", q: p(CELL, "battery_out", "capacity"), sub: "LP503450 LiPo" },
      { label: "Sleep current", q: "test:battery-life:summary[id=sleep_floor_uA].value", f: "d0", sub: "at the cell" },
      { label: "Level range", q: perf(TOF, "fov_deg"), f: "u=deg", sub: "ToF field of view, 940 nm" },
      { label: "Probe accuracy", q: `def:${PROBE}:domains[domain=thermal].metadata.accuracy_C[0].error_C`, f: "u=°C", sub: "DS18B20, −10 to +85 °C" },
      { label: "Bottle", q: mech(BOTTLE, "metadata.capacity_ml"), f: "d0", sub: "Nalgene 32 oz Wide Mouth" },
    ],
    specGroups: [
      {
        title: "Sensing",
        rows: [
          { label: "Level sensor", q: `def:${TOF}:name` },
          { label: "ToF I2C address", q: p(TOF, "i2c", "i2c_address"), f: "hex" },
          { label: "Temperature probe", q: `def:${PROBE}:name` },
          { label: "Probe range", q: perf(PROBE, "range_C") },
          { label: "Probe conversion (12 bit)", q: `def:${PROBE}:traits[type=performance].params.conversion_time_ms_max.12`, f: "u=ms" },
        ],
      },
      {
        title: "Processing and radio",
        rows: [
          { label: "Module", q: `def:${ESP}:name` },
          { label: "Supply", q: `def:${ESP}:traits[type=operating_conditions].params.vdd33_V` },
          { label: "Wi-Fi TX peak", q: `def:${ESP}:interfaces[id=wifi].traits[type=performance].params.current_mA.tx_802_11b_20dBm`, f: "u=mA" },
          { label: "Deep-sleep current", q: `def:${ESP}:domains[domain=electrical].metadata.currents_typ.deep_sleep_rtc_timer_memory_uA`, f: "u=µA" },
        ],
      },
      {
        title: "Light ring",
        rows: [
          { label: "LED driver", q: `def:${LED}:name` },
          { label: "LEDs", q: "def:kingbright-aptf1616lseezgkqbkc:name" },
        ],
      },
      {
        title: "Power",
        rows: [
          { label: "Cell", q: `def:${CELL}:name` },
          { label: "Cell voltage", q: p(CELL, "battery_out", "voltage"), f: "d2" },
          { label: "Charger", q: `def:${CHG}:name` },
          { label: "Charge current range", q: perf(CHG, "charge_current_mA") },
          { label: "3V3 converter", q: `def:${BB}:name` },
          { label: "Converter output rating", q: p(BB, "vout", "max_current") },
          { label: "Fuel gauge", q: `def:${GAUGE}:name` },
          { label: "USB-C", q: `def:${USB}:name` },
          { label: "Constant-current charge", q: "test:battery-life:summary[id=charge_h].value", f: "d1", sub: "from empty, plus the taper" },
        ],
      },
      {
        title: "Mechanical",
        rows: [
          { label: "Cap", q: `def:${CAP}:name` },
          { label: "Bottle", q: `def:${BOTTLE}:name` },
          { label: "Bottle size", q: mech(BOTTLE, "dimensions_mm") },
          { label: "Neck finish", q: mech(BOTTLE, "metadata.neck_finish") },
          { label: "Closing torque (max)", q: p(BOTTLE, "neck_thread", "closing_torque"), f: "u=N·m" },
          { label: "Bottle mass", q: mech(BOTTLE, "weight_g") },
        ],
      },
    ],
    mechanicalCallouts: ["cap.neck", "cap.lip_seal", "cap.usb_port", "cap.tof_window", "cap.button", "cap.probe_seal", "cap.led1"],
    // the board: its links to the cell, the probe and the cap are the system's (the module's own
    // pins are board copper, tabulated in the board's Manufacturing Package unit)
    hub: "board",
    envelope: {
      rows: [
        { label: "Cap envelope (max)", q: `def:${CAP}:traits[type=design_envelope].params.max_mm`, f: "u=mm" },
        { label: "Board envelope (max)", q: "def:bottle-cap-board:traits[type=design_envelope].params.max_mm", f: "u=mm" },
        { label: "Neck thread OD", q: p(BOTTLE, "neck_thread", "thread_major_diameter"), f: "d2" },
        { label: "Neck thread pitch", q: p(BOTTLE, "neck_thread", "thread_pitch"), f: "d3" },
        { label: "Board bolt circle", q: `def:${CAP}:interfaces[id=board_mount].parameters[id=hole_spacing].value` },
        { label: "Cap mass (printed)", q: `derived:mass.module(${CAP})`, f: "d1" },
        { label: "Cap material", q: `def:${CAP}:domains[domain=mechanical].material.name` },
      ],
      note: "The cap's mass is the generated CAD volume × the declared material density (systemMass), so it follows the design. It is Ø80 mm overall: the bayonet lid needs no screw lugs (decisions D-B09).",
      topCaption: "Top view of the assembled cap on the bottle.",
      sideCaption: "Right side: the cap on the Nalgene 32 oz Wide Mouth bottle.",
    },
  },

  assembly: {
    explode: 14,
    steps: [
      {
        id: "board",
        title: "Fit the board on the cap's bosses",
        mates: ["board_on_bosses"],
        // the plunger is a printed part of the cap (no instance of its own): it goes in before the board covers its bore
        before: ["Push the button plunger (printed with the cap) into its bore in the side wall from inside, flange inward; the board's switch holds it once the board is in."],
        camera: { dir: [1, -1.2, 1.1] },
        notes: [
          { kind: "tip", text: "The cap comes from its own unit with the four heat-set inserts set and the light pipes filled; nothing is fitted in its grooves yet." },
          { kind: "caution", text: "The receptacle's tongue faces the USB-C port: check its gasket sits square to the wall before tightening." },
        ],
      },
      {
        id: "probe",
        title: "Fit the temperature probe and solder its cable",
        place: ["probe", "probe_oring"],
        wiring: ["probe_*"],
        figure: "wiring",
        notes: [
          { kind: "tip", text: "Grease the AS568-010 O-ring lightly with silicone grease and push the probe up through the floor seal until the heat shrink meets the boss." },
          { kind: "caution", text: "Only the stainless tube enters the bottle; keep the PVC cable inside the cap (OQ-B5)." },
        ],
      },
      {
        id: "cell",
        title: "Fit the cell and solder its leads",
        place: ["cell"],
        wiring: ["cell_*", "bat_*"],
        figure: "wiring",
        notes: [{ kind: "warning", text: "Red to BAT+, black to BAT-. Never short the leads: the cell's protection board is the only protection. Tape the cell to the module shield with 0.5 mm foam tape." }],
      },
      {
        id: "seals",
        title: "Fit the lid and lip O-rings",
        place: ["lid_oring", "lip_oring"],
        notes: [{ kind: "tip", text: "Seat the AS568-040 in the collar's groove above the lugs and the AS568-138 in the floor's groove without twisting them; grease the AS568-040 lightly with silicone grease." }],
      },
      {
        id: "lid",
        title: "Close the lid",
        before: ["Push the lid down over the collar with each of its three slots' open ends on a lug (the wide slot on the wide lug, at the USB-C port's side: the lid goes on only that way), until it seats on the rim, then turn it 30° clockwise (seen from above) until the lugs stop at the slots' ends: the light pipes then stand over the LEDs."],
        notes: [{ kind: "tip", text: "The skirt's lead-in rides over the greased AS568-040; no tool and no screws. To open, turn back 30° and lift." }],
      },
      {
        id: "bottle",
        title: "Screw the cap onto the bottle",
        mates: ["cap_on_bottle"],
        after: "test",
        notes: [{ kind: "caution", text: "Bring-up and the bench test run with the cap off the bottle. Close to Nalgene's 4.5-6.3 N·m (assumption from the lab line) and no tighter." }],
      },
    ],
  },
};

export default config;
