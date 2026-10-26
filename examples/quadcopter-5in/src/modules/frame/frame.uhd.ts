/**
 * Custom 5-inch quadcopter frame — the reference project's custom module.
 *
 * This is a design-intent module, not a purchased part: it exists as
 * requirements and mechanical interfaces before its CAD does (PB-781,
 * docs/specs/cad-uhd-integration.md). Every interface mirrors the mating
 * pattern of a selected part, cited by that part's own sources:
 *   - stack_mount: 30.5 x 30.5 mm M3 — dolphinrc-am32-60a-4in1-esc / dolphinrc-f405-v3-flight-controller
 *   - motor_mount_*: the MEPS NEON 2207 V2 base pattern — meps-neon-2207-v2-1950kv
 *   - camera_mount: DJI O4 camera lens-mount side holes — dji-o4-air-unit
 *   - vtx_mount: DJI O4 transmission module 25.5 x 25.5 mm M2 — dji-o4-air-unit
 *   - standoff_mount: the top plate's standoff pattern (design)
 * The GPS mount is on the top plate (src/modules/top-plate/top-plate.uhd.ts).
 * Sources: the mating parts' sources.json files; see
 * library/systems/quadcopter-5in/README.md for the brief.
 *
 * Its CAD is derived from these interfaces by @protoboardai/ext-frame-cad, the
 * `cad` provider named in cad.config.ts next to this file (PB-798, PB-822).
 * `protoboard run cad:generate --module quadcopter-5in-frame` writes the
 * native design (frame-cad/params.json from the bolt patterns and frames
 * below and the config's constraints, and the generated frame-cad/frames.json);
 * `cad:export` runs the generic build123d plate generator on it and writes the
 * standard outputs to out/: body.step, body.glb, body.manifest.json, the
 * cutting profiles body.dxf and per-interface GLBs. Its `cad:check` keeps the
 * frames below equal to the generated ones; `frame-cad-rebind` re-binds
 * explicitly after a reviewed change.
 * Material is a declared design choice (CARBON_3K); mass is the generated
 * CAD volume × its density (UHD systemMass).
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { BoltPattern, defineModule } from "@deltarobotics/uhd";
import type { MaterialSpec } from "@deltarobotics/uhd";
import { feature, own, procedural, withGeometry } from "@deltarobotics/uhd";
// What the cad capability writes for this module (standard outputs in out/,
// the native design in frame-cad/): the provider's file layout. The generator
// ships in the extension package, so the source artifact records it as
// provenance only.
import { plateCadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

/**
 * Plate material (design choice, PB-797). Density: DragonPlate's carbon
 * sheet table, "Quasi-isotropic (woven) 0.055 [lb/in³] 1.52 [g/cm³]".
 */
export const CARBON_3K: MaterialSpec = {
  name: "3K woven carbon fibre / epoxy laminate",
  density_g_cm3: 1.52,
  source: "https://dragonplate.com/carbon-fiber-sheets",
  assumption: "DragonPlate's woven quasi-isotropic row is taken for 3K woven plate; the table does not name the tow size, and a real plate's resin content varies. The CAD body is the design geometry (no chamfers, countersinks or cutting kerf).",
};

const motorMount = (corner: string, label: string) =>
  BoltPattern({
    id: `motor_mount_${corner}`,
    name: `${label} motor mount`,
    role: "structure",
    shape: "circle",
    spacingMm: 16,
    holeCount: 4,
    fastener: "M3",
    fastenerDiameterMm: 3,
    threaded: false,
    note: "Through holes on the arm tip on a 16 mm bolt circle (opposite holes 16 mm apart, adjacent 11.31 mm — the FPV '16x16' pattern). M3 screws thread into the motor base. Mirrors meps-neon-2207-v2-1950kv base_mount.",
  });

const QUADCOPTER_5IN_FRAME_BASE: ModuleDef = defineModule({
  id: "quadcopter-5in-frame",
  name: "5-inch quadcopter frame (custom)",
  version: "0.1.0",
  manufacturer: "Delta Robotics (custom)",
  part_number: "QUAD5-FRAME",
  description:
    "Custom true-X 5-inch frame for the reference quadcopter: 30.5 mm stack mount, four motor mounts, DJI O4 camera and transmission-module mounts, battery strap slots.",
  tags: ["frame", "custom", "quadcopter", "5-inch"],
  categories: ["mechanical.structure.airframe", "robotics.drone"],
  display: { icon: "hexagon" },

  interfaces: [
    BoltPattern({
      id: "stack_mount",
      name: "Stack mount",
      role: "structure",
      shape: "square",
      spacingMm: 30.5,
      holeCount: 4,
      fastener: "M3",
      fastenerDiameterMm: 3,
      threaded: false,
      note: "M3 standoffs through the bottom plate carry the ESC then the FC (30.5 x 30.5 mm).",
    }),
    motorMount("fl", "Front-left"),
    motorMount("fr", "Front-right"),
    motorMount("rl", "Rear-left"),
    motorMount("rr", "Rear-right"),
    BoltPattern({
      id: "camera_mount",
      name: "Camera side plates",
      role: "structure",
      shape: "rectangle",
      spacingMm: 16,
      spacingYmm: 14,
      holeCount: 4,
      fastener: "M2",
      fastenerDiameterMm: 2,
      note: "Side plates for the 14 mm-wide DJI O4 camera; mirrors dji-o4-air-unit camera_mount.",
    }),
    BoltPattern({
      id: "standoff_mount",
      name: "Top-plate standoffs",
      role: "structure",
      shape: "rectangle",
      spacingMm: 56,
      spacingYmm: 48,
      holeCount: 4,
      fastener: "M3",
      fastenerDiameterMm: 3,
      threaded: false,
      note: "Four M3 holes for the 30 mm standoffs carrying the top plate (quadcopter-5in-top-plate).",
    }),
    BoltPattern({
      id: "vtx_mount",
      name: "Transmission module mount",
      role: "structure",
      shape: "square",
      spacingMm: 25.5,
      holeCount: 4,
      fastener: "M2",
      fastenerDiameterMm: 2,
      note: "Rear top-plate holes for the DJI O4 transmission module (25.5 x 25.5 mm, M2); mirrors dji-o4-air-unit tx_module_mount.",
    }),
  ],

  requirements: [
    { type: "capability", description: "Clear 5.1 in (130 mm) propellers on a true-X layout with at least 5 mm prop-to-prop clearance." },
    { type: "capability", description: "Carry a 75 x 39.5 x 35 mm, 211 g 6S 1100 mAh pack on a top-mounted strap." },
    { type: "capability", description: "Protect the DJI O4 camera between side plates and provide airflow to the transmission module (DJI cooling requirement)." },
    { type: "capability", description: "Keep the GNSS/compass module at least 10 cm from power wiring, ESCs and motors (Matek M10Q-5883 guidance)." },
  ],

  domains: [
    {
      domain: "mechanical",
      // PB-797: mass = CAD volume (generator manifest) × this density
      material: CARBON_3K,
      metadata: {
        layout: "true-X, 5-inch",
        status: "generated from its interfaces (@protoboardai/ext-frame-cad)",
        wheelbase_mm: 225,
        plate_thickness_mm: 5,
        standoff_height_mm: 30,
        // the generator's design values are its constraints in cad.config.ts
      },
    },
  ],

  traits: [
    {
      type: "assumption",
      params: {
        field: "material",
        value: "3K woven carbon fibre, 1.52 g/cm³",
        reason: "Design choice for the custom frame; mass is computed from the generated CAD volume × this density (systemMass), so it moves with the design. Wheelbase (225 mm), plate thickness (5 mm) and standoffs (30 mm) are design values (the interface frames and plate_thickness_mm).",
      },
    },
  ],

  artifacts: [],
});

// ---------------------------------------------------------------------------
// Geometry (PB-775). Frame coordinates: X forward, Y left, Z up, origin at the
// stack centre on the underside of the bottom plate. Motor pads are raised
// 0.5 mm so the frame side of each motor face is its own planar face.
// ---------------------------------------------------------------------------

export const QUADCOPTER_5IN_FRAME: ModuleDef = withGeometry(
  QUADCOPTER_5IN_FRAME_BASE,
  {
    stack_mount: {
      frame: { origin: [0, 0, 5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("stack_mount", { area_mm2: 201.062, centroid: [0.0, 0.0, 2.5] }), own("stack_mount"), procedural("bolt_pattern")],
    },
    motor_mount_fl: {
      frame: { origin: [79.55, 79.55, 5.5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("motor_mount_fl", { area_mm2: 309.478, centroid: [79.55, 79.55, 5.5], normal: [0.0, 0.0, 1.0] }), own("motor_mount_fl"), procedural("bolt_pattern")],
    },
    motor_mount_fr: {
      frame: { origin: [79.55, -79.55, 5.5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("motor_mount_fr", { area_mm2: 309.478, centroid: [79.55, -79.55, 5.5], normal: [0.0, 0.0, 1.0] }), own("motor_mount_fr"), procedural("bolt_pattern")],
    },
    motor_mount_rl: {
      frame: { origin: [-79.55, 79.55, 5.5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("motor_mount_rl", { area_mm2: 309.478, centroid: [-79.55, 79.55, 5.5], normal: [0.0, 0.0, 1.0] }), own("motor_mount_rl"), procedural("bolt_pattern")],
    },
    motor_mount_rr: {
      frame: { origin: [-79.55, -79.55, 5.5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("motor_mount_rr", { area_mm2: 309.478, centroid: [-79.55, -79.55, 5.5], normal: [0.0, 0.0, 1.0] }), own("motor_mount_rr"), procedural("bolt_pattern")],
    },
    camera_mount: {
      frame: { origin: [50.0, 0, 15.0], normal: [0, -1, 0], xAxis: [1, 0, 0] },
      refs: [feature("camera_mount", { area_mm2: 864.795, centroid: [50.0, 0.0, 16.018] }), own("camera_mount")],
    },
    standoff_mount: {
      frame: { origin: [0, 0, 5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 180 },
      refs: [feature("standoff_mount", { area_mm2: 201.062, centroid: [0.0, 0.0, 2.5] }), own("standoff_mount"), procedural("bolt_pattern")],
    },
    vtx_mount: {
      frame: { origin: [-45.0, 0, 5], normal: [0, 0, 1], xAxis: [1, 0, 0], symmetryDeg: 90 },
      refs: [feature("vtx_mount", { area_mm2: 138.23, centroid: [-45.0, 0.0, 2.5] }), own("vtx_mount"), procedural("bolt_pattern")],
    },
  },
  [
    ...plateCadArtifacts({
      dir: "src/modules/frame",
      name: "quadcopter-5in-frame",
      interfaces: ["stack_mount", "motor_mount_fl", "motor_mount_fr", "motor_mount_rl", "motor_mount_rr", "camera_mount", "vtx_mount", "standoff_mount"],
    }),
  ],
);

/** Where the battery sits on the top plate (root coordinates): not an interface (the pack is strapped), used to place it. */
export const BATTERY_PAD = { origin: [7.5, 0, 37] as [number, number, number], normal: [0, 0, 1] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number] };
