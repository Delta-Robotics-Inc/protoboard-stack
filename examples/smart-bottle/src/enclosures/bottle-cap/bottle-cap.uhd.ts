/**
 * The bottle cap (PB-834): a printed two-part housing (base and lid) that
 * screws onto the Nalgene 32 oz Wide Mouth bottle's 63 mm neck and holds the
 * cap board, the LiPo cell and the temperature probe.
 *
 * It is a UHD module whose interfaces are the features it must provide; the
 * cad provider (cad.config.ts here, @protoboardai/ext-enclosure-cad) generates
 * the geometry from them and from what the assembly puts inside. Nothing
 * here names a tool.
 *
 * Features, with their sources (docs/component-selection.md tags):
 *   - neck: internal thread for the bottle's 63 mm neck finish. SPI 63 mm
 *     T 61.62-62.51, E 59.23-60.12 mm, 6 TPI [B21], taken at their
 *     midpoints, as nalgene-32oz-wide-mouth states them (assumptions there:
 *     the consumer bottle shares the 63-415 finish; OQ-B4: measure the bottle
 *     before the thread is frozen). 12 mm skirt.
 *   - lip_seal: AS568-138 face seal on the bottle lip [B23], in the floor's
 *     underside. The liquid is inside the ring, so the groove is sized to the
 *     O-ring's O.D. (internal pressure, Parker ORD 5700 Design Chart 4-2).
 *   - lid_seal: AS568-040 radial seal at the lid joint [B23], in a groove
 *     round the base's collar (Parker Design Chart 4-1, static radial gland
 *     for a 1.78 mm section); the lid's skirt bore is the sealing surface.
 *   - probe_seal: AS568-010 static radial seal on the probe's Ø6 mm
 *     stainless tube [B4, B23], at (-20.5, 0) inside the bottle mouth.
 *   - tof_window: the VL53L4CD looks down through an IR window in the floor
 *     (OQ-B1): Ø8 mm aperture, Ø11 x 1.0 mm cover in a pocket on the inside.
 *   - usb_port: the USB4720 receptacle [B13]. GCT's panel is 1.8 mm with an
 *     inside recess for the gasket, and a mated plug's overmold stands 2.2 mm
 *     in front of it (drawing USB4720 rev B, mating view): about 2.8 mm from
 *     the gasket face to the overmold's seat. The wall here is 4.3 mm and
 *     curved, so the port is a stepped opening: GCT's plug aperture through
 *     the wall and an outside counterbore that leaves the overmold a flat
 *     seat 2.8 mm in front of the gasket. The provider has no stepped
 *     opening; the port uses its window feature (an aperture with an outside
 *     pocket), whose "cover" is that counterbore: nothing is fitted in it.
 *     The receptacle stands 1.5 mm inside the wall: the provider's fit
 *     analysis has no intended contact for a connector (only bosses), and
 *     the tongue would enter the wall. Its gasket therefore does not seal on
 *     the wall as generated (docs/decisions.md D-B10).
 *   - button: a plunger through the wall to the side-push switch [B15]. The
 *     membrane that seals it (OQ-B9) is not modelled.
 *   - led1-led8: Ø3 mm light pipes over the eight LEDs, filled with clear
 *     resin after printing (OQ-B7: the light guide).
 *   - board_mount: four insert bosses on a Ø54 mm circle under the board.
 *     The board is 0.6 mm thick and its M2 x 6 screws reach 5.4 mm below its
 *     top, so the holes are 6.0 mm deep (assumption below), not the
 *     insert's default 5.0.
 *   - lid_joint: a bayonet lid (D-B09): the base's wall steps in to a collar
 *     with three lugs, the lid's skirt slides over it and turns 30° to lock.
 *     One lug is a wider key that enters only its own slot, so the lid goes
 *     on one way and the slot ends fix its angle: its light pipes stand over
 *     the LEDs. No screws: nothing reaches past the Ø80 mm shell.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { fastenerDiameterMm } from "@deltarobotics/uhd";
import { Button, InsertBosses, LightPipe, RUTHEX_RX_M2X4, SealGland, Thread, TwistLid, Window } from "@protoboardai/ext-enclosure-cad/lib/index.ts";

const IN = 25.4;
const mid = (a: number, b: number) => Math.round(((a + b) / 2) * IN * 100) / 100;

/**
 * The provider's feature builders give a feature no protocol, so nothing can
 * mate with it. The neck thread and the lip seal mate with the bottle's own
 * interfaces (custom peer, as nalgene-32oz-wide-mouth states them; its
 * neck_thread pairs with a 63 mm closure by fastener_diameter).
 */
const mates = (i: InterfaceDef, extra: Partial<InterfaceDef> = {}): InterfaceDef => ({ ...i, protocols: [{ type: "custom", roles: ["peer"] }], ...extra });

/** Where the probe passes the floor (cap frame, mm): inside the bottle mouth, clear of the cell. */
export const PROBE_AT: [number, number] = [-20.5, 0];

export const BOTTLE_CAP_ENCLOSURE: ModuleDef = {
  id: "bottle-cap-enclosure",
  name: "Bottle cap housing",
  version: "0.1.0",
  description:
    "Printed PETG cap for the Nalgene 32 oz Wide Mouth bottle: base with the 63 mm internal thread, the AS568-138 lip seal, the probe's AS568-010 rod seal, the ToF window and the USB-C port; bayonet lid with eight light pipes, sealed by an AS568-040 radial O-ring on the base's collar, Ø80 mm overall.",
  categories: ["mechanical.enclosure"],
  tags: ["enclosure", "cap", "printed", "smart-bottle"],
  // the heat-set inserts are set when the cap is printed (its own unit): 4 in the board bosses (the bayonet lid needs none)
  children: [{ id: "inserts", moduleDefId: "ruthex-rx-m2x4", name: "M2 heat-set insert", quantity: 4 }],
  interfaces: [
    mates(Thread({
      id: "neck",
      name: "63 mm neck thread",
      majorDiameterMm: mid(2.426, 2.461),
      rootDiameterMm: mid(2.332, 2.367),
      pitchMm: Math.round((IN / 6) * 1000) / 1000,
      lengthMm: 12,
      source: "SPI 63 mm neck finish (T, E, 6 TPI) [B21] as nalgene-32oz-wide-mouth states it",
      assumption: "The consumer bottle has the SPI 63 mm finish (nalgene-32oz-wide-mouth assumption traits); measure it before the thread is frozen (OQ-B4). The provider's symmetric trapezoid stands in for Nalgene's semi-buttress profile.",
    }), { capabilities: ["closure_finish", "internal_thread"], parameters: [fastenerDiameterMm(63)] }),
    mates(SealGland({
      id: "lip_seal",
      name: "Bottle lip seal (AS568-138)",
      type: "face",
      oring: "AS568-138",
      pressure: "internal",
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      source: "AS568-138 proposed in docs/component-selection.md (O-rings) [B23]",
    }), { capabilities: ["face_seal"] }),
    SealGland({
      id: "lid_seal",
      name: "Lid seal (AS568-040)",
      type: "radial",
      oring: "AS568-040",
      at: "joint",
      source: "AS568-040 proposed in docs/component-selection.md (O-rings) [B23]; radial gland on the collar under the bayonet lid's skirt (D-B09)",
    }),
    SealGland({
      id: "probe_seal",
      name: "Probe tube seal (AS568-010)",
      type: "radial",
      oring: "AS568-010",
      rodDiameterMm: 6.0,
      frame: { origin: [PROBE_AT[0], PROBE_AT[1], 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      source: "Adafruit 381: stainless tube Ø6 mm [B4]; AS568-010 [B23]",
    }),
    Window({
      id: "tof_window",
      name: "ToF window",
      serves: { child: "board", interfaceId: "tof" },
      aperture: { diameterMm: 8 },
      cover: { diameterMm: 11, thicknessMm: 1.0, material: "clear PMMA or glass, IR-transmissive at 940 nm (OQ-B1)" },
      side: "inside",
      assumption: "Aperture Ø8 covers the emitter and the receiver (3 mm apart) and the sensor's 18° field of view across the 4 mm floor; cover size and material are open (OQ-B1).",
    }),
    Window({
      id: "usb_port",
      name: "USB-C port (plug aperture and overmold counterbore)",
      serves: { child: "board", interfaceId: "usb" },
      aperture: { widthMm: 8.44, heightMm: 2.66 },
      cornerRadiusMm: 1.05,
      cover: { widthMm: 12.75, heightMm: 6.9, thicknessMm: 3.0, material: "none: a counterbore for the plug's overmold, nothing is fitted" },
      side: "outside",
      source: "GCT drawing USB4720 rev B: plug opening 8.44 x 2.66 mm, R1.05 ends, panel 1.80 mm (ref), overmold 2.2 mm (ref) in front of the panel when mated; USB Type-C overmold 12.35 x 6.5 mm max (USB Type-C Compliance Document rev 1.2, Figure B-1)",
      assumption: "Counterbore 12.75 x 6.9 x 3.0 mm deep (the overmold plus 0.2 mm a side), so the overmold seats 2.8 mm in front of the gasket face, the distance GCT's 1.8 mm panel with its 1.17 mm inside recess and 2.2 mm overmold stand-off give; GCT's inside recess for the gasket (9.14/9.64 x 3.35/3.86 mm) is not modelled.",
    }),
    Button({ id: "button", name: "Button plunger", serves: { child: "board", interfaceId: "button" }, holeDiameterMm: 2.5, travelMm: 0.2, gapMm: 0.1 }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) =>
      LightPipe({
        id: `led${k}`,
        name: `Light pipe ${k}`,
        serves: { child: "board", interfaceId: `led${k}` },
        diameterMm: 3.0,
        fill: "clear UV-cure resin",
        assumption: "Ø3 mm hole over each LED, filled with clear UV-cure resin after printing (light guide and seal; OQ-B7)",
      }),
    ),
    InsertBosses({
      id: "board_mount",
      name: "Board bosses (4 x M2 inserts)",
      shape: "circle",
      spacingMm: 54,
      holeCount: 4,
      fastener: "M2",
      fastenerDiameterMm: 2,
      insert: { ...RUTHEX_RX_M2X4, hole_depth_mm: 6.0, assumption: "hole 6.0 mm deep: an M2 x 6 screw through the 0.6 mm board reaches 5.4 mm below the boss top, past the 4.0 mm insert" },
      // boss tops; the first hole on X, at 45° like the board's
      frame: { origin: [0, 0, 6.8], normal: [0, 0, 1], xAxis: [Math.SQRT1_2, Math.SQRT1_2, 0] },
    }),
    TwistLid({
      id: "lid_joint",
      name: "Bayonet lid (3 lugs, one a key, 30° turn)",
      lock: "bayonet",
      lugs: 3,
      lugWidthMm: 6,
      // the lug on +Y is 10 mm wide and enters only its own slot: the lid goes on one way, so the light
      // pipes (45° apart, 157.5° + 45k) stand over their LEDs; three equal lugs let it go on 120° turned
      keyLugWidthMm: 10,
      // the skirt's bore is drawn 0.1 mm (radial) over the bore it should print at, for a printed bore's
      // undersize; the O-ring groove's depth is from the printed bore (OQ-B16: measure it on the first print)
      boreAllowanceMm: 0.1,
      lugDepthMm: 1.0,
      lugHeightMm: 2.0,
      twistDeg: 30,
      assumption: "Two 6 mm lugs and a 10 mm key lug, 1.0 mm deep and 2.0 mm tall, locked by a 30° turn; 0.2 mm radial and 0.15 mm axial clearance at the lugs, and the seal bore drawn 0.1 mm (radial) oversize for a printed PETG fit, so it prints at Parker's 0.089 mm diametral fit. Not from a standard: check the fit on the first print (OQ-B16).",
    }),
  ],
  domains: [
    {
      domain: "mechanical",
      // mass = the generated CAD volume (out/body.manifest.json) x this density (systemMass)
      material: {
        name: "PETG",
        density_g_cm3: 1.27,
        source: "https://www.prusa3d.com/downloads/manuals/datasheets/prusament_petg_tds_en.pdf",
        assumption: "Prusament PETG's stated density stands in for the PETG the cap is printed in (cad.config.ts material); the mass is for a solid body, and a print with partial infill weighs less.",
      },
    },
  ],
  traits: [
    {
      type: "design_envelope",
      params: {
        max_mm: { length: 80, width: 80, height: 57 },
        reason: "The brief: a cap ≤ 80 mm in diameter and ≤ 45 mm above the lip, plus the 12 mm thread skirt under it (docs/brief.md; decisions D-B09).",
      },
    },
    { type: "usage_note", params: { note: "Hand wash only. PETG is not claimed food-safe (OQ-B5); keep hot drinks under 60 °C (brief)." } },
  ],
  // the cad provider's native design and standard outputs (cad:extract lists them); the cap is the assembly's root body
  artifacts: [
    { id: "cad_source", name: "Cap native design", type: "cad", role: "source", format: "build123d", filePath: "src/enclosures/bottle-cap/build123d" },
    { id: "cad_step", name: "Cap body (STEP)", type: "cad", role: "body", format: "step", units: "mm", filePath: "src/enclosures/bottle-cap/out/body.step", provenance: { generatedFrom: "cad_source" } },
    { id: "cad_glb", name: "Cap body (GLB)", type: "cad", role: "body", format: "glb", units: "mm", filePath: "src/enclosures/bottle-cap/out/body.glb", provenance: { generatedFrom: "cad_step" } },
    { id: "cad_manifest", name: "Cap geometry manifest", type: "cad", format: "json", filePath: "src/enclosures/bottle-cap/out/body.manifest.json", provenance: { generatedFrom: "cad_step" } },
    ...(["base", "lid", "plunger_button"] as const).flatMap((part) => [
      { id: `${part}_stl`, name: `${part} (STL, for printing)`, type: "cad" as const, role: "body" as const, format: "stl", units: "mm" as const, filePath: `src/enclosures/bottle-cap/out/${part}.stl`, tags: ["manufacturing", "print"], provenance: { generatedFrom: "cad_step" } },
      { id: `${part}_3mf`, name: `${part} (3MF, for printing)`, type: "cad" as const, role: "body" as const, format: "3mf", units: "mm" as const, filePath: `src/enclosures/bottle-cap/out/${part}.3mf`, tags: ["manufacturing", "print"], provenance: { generatedFrom: "cad_step" } },
    ]),
  ],
};
