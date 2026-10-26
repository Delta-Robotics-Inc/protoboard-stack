/**
 * Top plate of the 5-inch quadcopter frame: a separate 2 mm plate on four
 * 30 mm standoffs (frame hardware harness). It carries the GPS mast pad and
 * the battery, strapped through two slots.
 *
 * Its interfaces mirror the frame's standoff pattern and the Matek M9N-5883
 * mount (see each interface's note). Like the frame, its CAD comes from these
 * interfaces through @protoboardai/ext-frame-cad, the `cad` provider named in
 * cad.config.ts next to this file: `protoboard run cad:generate --module
 * quadcopter-5in-top-plate`, then `cad:export`. The plate's outline over the
 * pack and its strap slots are design values: the config's constraints.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { BoltPattern, defineModule } from "@deltarobotics/uhd";
import { feature, own, procedural, withGeometry } from "@deltarobotics/uhd";
import { plateCadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";
import { CARBON_3K } from "../frame/frame.uhd.js";

const QUADCOPTER_5IN_TOP_PLATE_BASE: ModuleDef = defineModule({
  id: "quadcopter-5in-top-plate",
  name: "5-inch frame top plate (custom)",
  version: "0.1.0",
  manufacturer: "Delta Robotics (custom)",
  part_number: "QUAD5-TOP",
  description: "2 mm top plate on four 30 mm standoffs: carries the GPS mast pad and the battery (strap slots).",
  tags: ["frame", "custom", "quadcopter", "plate"],
  categories: ["mechanical.structure.airframe", "robotics.drone"],
  display: { icon: "square" },
  interfaces: [
    BoltPattern({
      id: "standoff_mount",
      name: "Standoff holes",
      role: "component",
      shape: "rectangle",
      spacingMm: 56,
      spacingYmm: 48,
      holeCount: 4,
      fastener: "M3",
      fastenerDiameterMm: 3,
      threaded: false,
      note: "Mirrors quadcopter-5in-frame standoff_mount.",
    }),
    BoltPattern({
      id: "gps_mount",
      name: "GPS mount",
      role: "structure",
      shape: "square",
      spacingMm: 26,
      holeCount: 4,
      fastener: "M2",
      fastenerDiameterMm: 2,
      note: "Rear GPS mast pad for the Matek M9N-5883 (26 mm hole spacing, Φ2 mm); keep >= 10 cm from power wiring, ESC and motors (Matek guidance). Mirrors matek-m9n-5883 mount.",
    }),
  ],
  domains: [
    {
      domain: "mechanical",
      material: CARBON_3K,
      metadata: {
        plate_thickness_mm: 2,
        status: "generated from its interfaces (@protoboardai/ext-frame-cad)",
        // the generator's design values (outline over the pack, strap slots) are its constraints in cad.config.ts
      },
    },
  ],
  traits: [{ type: "assumption", params: { field: "material", value: "3K woven carbon fibre, 1.52 g/cm³", reason: "Design choice; mass = generated CAD volume × density (systemMass). Plate thickness (mechanical metadata) and the outline and strap slots (cad.config.ts constraints) are design values." } }],
  artifacts: [],
});

/** Top-plate coordinates: origin at the standoff pattern centre on the plate's underside. */
export const QUADCOPTER_5IN_TOP_PLATE: ModuleDef = withGeometry(
  QUADCOPTER_5IN_TOP_PLATE_BASE,
  {
    standoff_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0], symmetryDeg: 180 },
      refs: [feature("standoff_mount", { area_mm2: 80.425, centroid: [0.0, 0.0, 1.0] }), own("standoff_mount"), procedural("bolt_pattern")],
    },
    gps_mount: {
      frame: { origin: [-52, 0, 2], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("gps_mount", { area_mm2: 55.292, centroid: [-52.0, 0.0, 1.0] }), own("gps_mount"), procedural("bolt_pattern")],
    },
  },
  plateCadArtifacts({
    dir: "src/modules/top-plate",
    name: "quadcopter-5in-top-plate",
    interfaces: ["standoff_mount", "gps_mount"],
  }),
);
