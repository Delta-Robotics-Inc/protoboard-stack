/**
 * Routed geometry for dolphinrc-xt60-battery-lead (@protoboardai/ext-harness-cad). The cable is declared
 * with the others in ../harnesses.uhd.ts, so this config names it; this
 * folder is its provider directory (harness-cad/ route, out/ bodies).
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "dolphinrc-xt60-battery-lead" });
