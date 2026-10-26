/**
 * Routed geometry for battery-leads (@protoboardai/ext-harness-cad). The cable is declared
 * in ../harnesses.uhd.ts, so this config names it; this folder is its provider
 * directory (harness-cad/ route, out/ bodies).
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "battery-leads" });
