/**
 * ACME LDO3300-33SOT-TR (LDO3300 series, 3.3 V, SOT-23-5) — datasheet-honest UHD part.
 * EVAL SOLUTION: ACME and the LDO3300 are fictional (the ext-parts eval fixture).
 *
 * Sources (see parts/evidence/acme-ldo3300-33/sources.json):
 *   - src_datasheet: ACME LDO3300 Series datasheet, Rev. 3, March 2026 — https://acme.example/ldo3300.pdf
 *
 * Modelling notes:
 *   - One leaf interface per package pin from the pin table (§3): VIN (1),
 *     GND (2), EN (3), NC (4), VOUT (5), each with its designator.
 *   - VOUT is the regulated 3.3 V output, 300 mA (§1, §6); VIN 2.5–6.0 V (§5).
 *   - EN is an active-high logic input (high > 1.2 V, low < 0.4 V, §6) with an
 *     internal 2 MΩ pull-down; its level range is 0 V to VIN (§5).
 *   - CAD: ACME's own SOT-23-5 model (STEP, and the GLB from the same
 *     download page) in parts/local/acme-ldo3300-33/, unmodified, under
 *     ACME's CAD terms. No mechanical interface: the part is soldered to its
 *     board.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { defineModule, pinTable } from "@deltarobotics/uhd";

const SRC = {
  datasheet: "https://acme.example/ldo3300.pdf",
  step: "https://acme.example/cad/LDO3300-SOT-23-5.step",
  glb: "https://acme.example/cad/LDO3300-SOT-23-5.glb",
} as const;
const CAD = "parts/local/acme-ldo3300-33";

const pins = pinTable(
  [
    { pin: 1, name: "VIN", type: "power_in", id: "vin", voltageV: [2.5, 6.0], description: "Input supply. Bypass with 1 µF to GND." },
    { pin: 2, name: "GND", type: "ground", id: "gnd", description: "Ground." },
    { pin: 3, name: "EN", type: "input", id: "en", voltageV: [0, 6.0], description: "Enable. High = on (> 1.2 V), low = off (< 0.4 V). Internal 2 MΩ pull-down. Do not leave floating in noisy environments." },
    { pin: 4, name: "NC", type: "nc", id: "nc", description: "No internal connection. Leave open or connect to GND." },
    { pin: 5, name: "VOUT", type: "power_out", id: "vout", voltageV: 3.3, description: "Regulated output. Bypass with ≥ 1 µF ceramic to GND." },
  ],
  { source: `${SRC.datasheet} (§3 Pin configuration and functions, p.2)` },
);

export const ACME_LDO3300_33: ModuleDef = defineModule({
  id: "acme-ldo3300-33",
  name: "ACME LDO3300-33 3.3 V 300 mA LDO regulator",
  version: "1.0.0",
  manufacturer: "ACME Semiconductor",
  part_number: "LDO3300-33SOT-TR",
  description:
    "300 mA low-dropout linear regulator, fixed 3.3 V output (±1.5 % at 25 °C), VIN 2.5–6.0 V, 180 mV typical dropout at 300 mA, 45 µA quiescent, active-high enable, SOT-23-5, tape and reel.",
  tags: ["ldo", "regulator", "3v3", "sot-23-5", "acme"],
  categories: ["power", "power.regulator"],
  interfaces: pins,
  artifacts: [
    { id: "datasheet", name: "ACME LDO3300 Series datasheet, Rev. 3", type: "datasheet", url: SRC.datasheet },
    { id: "cad_vendor_step", name: "ACME SOT-23-5 model (STEP)", type: "3d_model", role: "source", format: "step", units: "mm", url: SRC.step, filePath: `${CAD}/LDO3300-SOT-23-5.step` },
    { id: "cad_vendor_glb", name: "ACME SOT-23-5 model (GLB)", type: "3d_model", role: "body", format: "glb", units: "mm", url: SRC.glb, filePath: `${CAD}/LDO3300-SOT-23-5.glb` },
  ],
  domains: [
    {
      domain: "electrical",
      power_domains: [
        { id: "vin", name: "Input (VIN)", voltage_range_V: [2.5, 6.0] },
        { id: "vout", name: "Output (VOUT)", nominal_voltage_V: 3.3, voltage_range_V: [3.25, 3.35], max_current_mA: 300, regulation_type: "regulated" },
      ],
      metadata: { dropout_mV: { typ: 180, max: 260, at_mA: 300 }, current_limit_mA: [350, 450], source: `${SRC.datasheet} (§6, p.3)` },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 2.9, width: 1.6, height: 1.1 },
      package: { name: "SOT-23-5", pin_count: 5, pitch_mm: 0.95, exposed_pad: false, source: `${SRC.datasheet} (§1 Features; §7 Package, p.3)` },
    },
    {
      domain: "thermal",
      metadata: { junction_C: [-40, 125], thermal_shutdown_C: 160, source: `${SRC.datasheet} (§5, §6)` },
    },
  ],
  traits: [
    { type: "operating_conditions", params: { vin_V: [2.5, 6.0], en_V: "0 V to VIN", iout_mA: [0, 300], junction_C: [-40, 125], source: `${SRC.datasheet} (§5 Recommended operating conditions, p.2)` } },
    { type: "absolute_maximum", params: { vin_en_V: [-0.3, 6.5], vout_V: "-0.3 V to VIN + 0.3 V", junction_C: 150, storage_C: [-65, 150], source: `${SRC.datasheet} (§4 Absolute maximum ratings, p.2)` } },
    {
      type: "performance",
      params: { kind: "regulator", topology: "linear, low dropout", output_V: 3.3, accuracy_pct: 1.5, output_current_mA: 300, dropout_mV_typ: 180, quiescent_current_uA: 45, shutdown_current_uA: 0.1, source: `${SRC.datasheet} (§1, §6)` },
    },
    { type: "usage_note", params: { note: "Stable with a 1 µF ceramic output capacitor; bypass VIN with 1 µF to GND.", source: `${SRC.datasheet} (§1, §3)` } },
    { type: "assumption", params: { field: "package height (dimensions)", value: "1.1 mm", reason: "The datasheet gives 1.1 mm as the maximum height; the nominal is not stated." } },
    { type: "data_gap", params: { fields: ["mass"], note: "The datasheet does not state the mass." } },
  ],
});
