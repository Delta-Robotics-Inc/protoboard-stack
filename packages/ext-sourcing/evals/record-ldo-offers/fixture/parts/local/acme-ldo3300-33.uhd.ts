import type { ModuleDef } from "@deltarobotics/uhd";

/**
 * ACME LDO3300-33SOT-TR: a fictional 3.3 V regulator (eval fixture).
 * Sources: ../evidence/acme-ldo3300-33/sources.json
 */
export const ACME_LDO3300_33: ModuleDef = {
  id: "acme-ldo3300-33",
  name: "ACME LDO3300 3.3 V regulator",
  kind: "module",
  manufacturer: "ACME",
  part_number: "LDO3300-33SOT-TR",
  interfaces: [],
};
