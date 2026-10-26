/**
 * The firmware capability for Zephyr on nRF52840 modules: the shared
 * operations from @protoboardai/core with this provider's design, pin reader
 * and rules (a devicetree structural check of what it generates).
 */
import type { CapabilityOperationFn } from "@protoboardai/core";
import { firmwareOperations, previewFirmware, type FirmwareProviderSpec } from "@protoboardai/core";
import { designZephyr } from "../lib/design.ts";
import { checkDts } from "../lib/dts.ts";
import { readZephyrPins } from "../lib/pins.ts";
import { NRF52840, ZEPHYR_VERSION, socOf } from "../lib/soc.ts";

export const SPEC: FirmwareProviderSpec = {
  provider: "@protoboardai/ext-zephyr",
  framework: "zephyr",
  frameworkVersion: ZEPHYR_VERSION,
  design: (fw, board, controller, ctx) => {
    const d = designZephyr(fw, board, controller, ctx);
    // the generated devicetree must be well formed, whatever the board
    const dts = Object.fromEntries(d.files.filter((f) => /\.dtsi?$/.test(f.path)).map((f) => [f.path, f.lines.map((l) => l.text).join("\n")]));
    for (const p of checkDts(dts, (socOf(controller) ?? NRF52840).labels)) {
      d.findings.push({ code: "FW_DTS_SYNTAX", severity: "error", message: `${p.file}:${p.line}: ${p.message} (provider defect)` });
    }
    return d;
  },
  readPins: readZephyrPins,
  // any nRF52840 GPIO wakes the chip from System OFF through its SENSE level (PS §6.9)
  rules: () => ({ sleepName: "System OFF", i2cAddressRequired: true }),
};

const ops = firmwareOperations(SPEC);
export const generate: CapabilityOperationFn = ops.generate;
export const exportOutputs: CapabilityOperationFn = ops.exportOutputs;
export const extract: CapabilityOperationFn = ops.extract;
export const check: CapabilityOperationFn = ops.check;
export { previewFirmware };
