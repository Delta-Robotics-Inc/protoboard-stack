/**
 * Routed geometry for radiomaster-rp1-crsf-wire (@protoboardai/ext-harness-cad). The cable is declared
 * with the others in ../harnesses.uhd.ts, so this config names it; this
 * folder is its provider directory (harness-cad/ route, out/ bodies).
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "radiomaster-rp1-crsf-wire" });
