/**
 * ACME mounting plate (fixture): the structure side of the SB-25's pattern,
 * for pair DRC. Not verified itself. Source: https://example.com/acme-plate.pdf
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { BoltPattern, defineModule } from "@deltarobotics/uhd";

export const ACME_PLATE: ModuleDef = defineModule({
  id: "acme-plate",
  name: "ACME mounting plate",
  version: "1.0.0",
  manufacturer: "ACME",
  part_number: "MP-1",
  description: "Fixture: a plate with the SB-25 pattern.",
  interfaces: [BoltPattern({ id: "bracket_mount", role: "structure", shape: "square", spacingMm: 20, holeCount: 4, fastener: "M3", fastenerDiameterMm: 3 })],
});
