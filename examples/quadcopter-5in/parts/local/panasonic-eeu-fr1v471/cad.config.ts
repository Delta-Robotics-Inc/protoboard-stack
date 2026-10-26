/**
 * The bulk capacitor's `cad` provider (tool-integrations §4): its body is
 * drawn by part-cad/bulk_capacitor.py from the datasheet's dimension drawing,
 * run by @protoboardai/ext-parts (`protoboard run cad:generate --module
 * panasonic-eeu-fr1v471`, then `cad:export`). Bought, not made: no process.
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-parts",
  module: "panasonic-eeu-fr1v471",
  constraints: { generator: "bulk_capacitor.py" },
});
