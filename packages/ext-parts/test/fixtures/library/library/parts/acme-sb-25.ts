/**
 * ACME SB-25 servo bracket (fixture) — a test part, not a real product.
 *
 * Sources (see ./acme-sb-25/sources.json):
 *   - src_drawing: ACME SB-25 drawing — https://example.com/acme-sb-25.pdf
 *
 * Modelling notes:
 *   - One 20 x 20 mm M3 pattern on the underside; geometry generated from
 *     the drawing (no manufacturer CAD).
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { BoltPattern, defineModule, feature, procedural, withGeometry } from "@deltarobotics/uhd";

const SRC = { drawing: "https://example.com/acme-sb-25.pdf" } as const;
const DIR = "library/parts/acme-sb-25/artifacts/cad";

const BASE: ModuleDef = defineModule({
  id: "acme-sb-25",
  name: "ACME SB-25 servo bracket",
  version: "1.0.0",
  manufacturer: "ACME",
  part_number: "SB-25",
  description: "Fixture: a bracket with one square M3 pattern.",
  tags: ["fixture", "bracket"],
  categories: ["mechanical.mounting"],
  interfaces: [BoltPattern({ id: "mount", role: "component", shape: "square", spacingMm: 20, holeCount: 4, fastener: "M3", fastenerDiameterMm: 3 })],
  domains: [{ domain: "mechanical", dimensions_mm: { length: 30, width: 30, height: 3 } }],
  traits: [
    { type: "operating_conditions", params: { operating_temperature_C: [-20, 60], source: SRC.drawing } },
    { type: "data_gap", params: { fields: ["manufacturer CAD"], note: "The drawing is the only source; geometry generated from it." } },
  ],
  artifacts: [{ id: "drawing", name: "SB-25 drawing", type: "datasheet", url: SRC.drawing }],
});

export const ACME_SB_25: ModuleDef = withGeometry(
  BASE,
  {
    mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("mount", { area_mm2: 120.637, centroid: [0, 0, 1.5] }), procedural("bolt_pattern")],
    },
  },
  [
    { id: "cad_source", name: "acme-sb-25 generator", type: "cad", role: "source", format: "py", description: "Fixture: no generator." },
    { id: "cad_step", name: "acme-sb-25 (STEP)", type: "3d_model", role: "body", format: "step", units: "mm", filePath: `${DIR}/acme-sb-25.step`, provenance: { generatedFrom: "cad_source", tool: "fixture" } },
    { id: "cad_manifest", name: "acme-sb-25 feature manifest", type: "cad", role: "source", format: "json", filePath: `${DIR}/acme-sb-25.manifest.json`, provenance: { generatedFrom: "cad_step", tool: "fixture" } },
  ],
);
