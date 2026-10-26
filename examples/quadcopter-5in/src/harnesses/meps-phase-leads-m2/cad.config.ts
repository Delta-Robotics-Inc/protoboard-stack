/**
 * Routed geometry for meps-phase-leads-m2 (tool-integrations §4). The cable is declared
 * with the others in ../harnesses.uhd.ts, so this config names it; this
 * folder is its provider directory (harness-cad/ route, out/ bodies).
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "meps-phase-leads-m2" });
