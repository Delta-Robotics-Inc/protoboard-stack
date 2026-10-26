/**
 * 5-inch 6S quadcopter — the Protoboard Stack reference system (PB-782).
 *
 * Children are catalog parts (parts/catalog, vendored from the Protoboard
 * Cloud parts catalog with origins in parts/origins.json), a purchased part
 * researched here (parts/local), custom modules (src/modules), and harnesses
 * (src/harnesses). `protoboard check` resolves
 * them and runs link DRC, system rules, assembly and geometry checks.
 *
 * Motor order follows Betaflight Quad-X: M1 rear-right, M2 front-right,
 * M3 rear-left, M4 front-left; spin is Betaflight's default "props in".
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { DOLPHINRC_F405_V3_STACK, QUADCOPTER_5IN_ARM } from "./modules/assemblies.uhd.js";
import { QUADCOPTER_5IN_FRAME } from "./modules/frame/frame.uhd.js";
import { QUADCOPTER_5IN_TOP_PLATE } from "./modules/top-plate/top-plate.uhd.js";
import { HARNESSES, PHASE_LEADS } from "./harnesses/harnesses.uhd.js";

// `leads`: rotation of the motor on its pad (a multiple of the pattern's 90°)
// that points its phase leads back along the arm toward the ESC.
// `spin`: Betaflight Quad-X default ("props in", yaw_motors_reversed OFF):
// M1 rear-right CW, M2 front-right CCW, M3 rear-left CCW, M4 front-left CW,
// viewed from above (betaflight-reference.md §3a). Set on the arm instance,
// it applies to the arm's motor (ESC direction) and to its prop (variant).
const ARMS = [
  { id: "arm_fr", label: "Front-right arm", motor: 2, leads: 180, spin: "ccw" },
  { id: "arm_rr", label: "Rear-right arm", motor: 1, leads: 270, spin: "cw" },
  { id: "arm_rl", label: "Rear-left arm", motor: 3, leads: 0, spin: "ccw" },
  { id: "arm_fl", label: "Front-left arm", motor: 4, leads: 90, spin: "cw" },
] as const;

const corner = (armId: string) => armId.slice(4);

const link = (
  id: string,
  name: string,
  a: [string, string],
  b: [string, string],
  extra: Partial<InterfaceLink> = {},
): InterfaceLink => ({
  id,
  name,
  a: { child: a[0], interfaceId: a[1] },
  b: { child: b[0], interfaceId: b[1] },
  ...extra,
});

export const QUADCOPTER_5IN: ModuleDef = {
  id: "quadcopter-5in",
  name: "5-inch 6S quadcopter",
  kind: "module",
  version: "0.1.0",
  description:
    "Reference 5-inch 6S freestyle quadcopter: DolphinRC F405 V3 + AM32 60A stack, four MEPS NEON 2207 V2 1950KV motors with HQProp Ethix S5 props, CNHL 1100 mAh 6S pack, RadioMaster RP1 V2 ELRS receiver, DJI O4 Air Unit, Matek M9N-5883 GNSS/compass, custom frame.",
  tags: ["quadcopter", "reference-project", "5-inch", "6s"],
  display: { icon: "plane" },
  interfaces: [],
  children: [
    { id: "frame", moduleDefId: "quadcopter-5in-frame", name: "Frame" },
    { id: "top_plate", moduleDefId: "quadcopter-5in-top-plate", name: "Top plate" },
    { id: "stack", moduleDefId: "dolphinrc-f405-v3-stack", name: "FC + ESC stack" },
    ...ARMS.map((arm) => ({ id: arm.id, moduleDefId: "quadcopter-5in-arm", name: arm.label, spin: arm.spin })),
    { id: "battery", moduleDefId: "cnhl-black-series-1100mah-6s-100c", name: "6S battery" },
    { id: "receiver", moduleDefId: "radiomaster-rp1-v2-elrs-2g4", name: "ELRS receiver" },
    { id: "video", moduleDefId: "dji-o4-air-unit", name: "DJI O4 Air Unit" },
    { id: "gnss", moduleDefId: "matek-m9n-5883", name: "GNSS + compass" },
    { id: "strap", moduleDefId: "hglrc-kevlar-battery-strap-20x250mm", name: "Battery strap" },
    { id: "bulk_cap", moduleDefId: "panasonic-eeu-fr1v471", name: "Bulk capacitor 470 µF" },
    // harnesses carrying links
    { id: "xt60_lead", moduleDefId: "dolphinrc-xt60-battery-lead", name: "XT60 battery lead" },
    { id: "dji_cable", moduleDefId: "dji-o4-3in1-cable", name: "DJI 3-in-1 cable" },
    { id: "gnss_lead", moduleDefId: "matek-gh6p-gnss-lead", name: "GNSS lead" },
    { id: "rx_wire", moduleDefId: "radiomaster-rp1-crsf-wire", name: "Receiver wires" },
    { id: "bulk_cap_leads", moduleDefId: "panasonic-eeu-fr1v471-leads", name: "Bulk capacitor leads" },
    ...ARMS.map((arm) => ({ id: `${arm.id}_leads`, moduleDefId: PHASE_LEADS[arm.id].id, name: `Motor ${arm.motor} phase leads` })),
    { id: "stack_hardware", moduleDefId: "quadcopter-5in-stack-hardware", name: "Stack hardware" },
    { id: "frame_hardware", moduleDefId: "quadcopter-5in-frame-hardware", name: "Frame hardware" },
    ...ARMS.map((arm) => ({ id: `${arm.id}_hardware`, moduleDefId: "quadcopter-5in-motor-hardware", name: `${arm.label} motor hardware` })),
    { id: "vtx_hardware", moduleDefId: "quadcopter-5in-vtx-hardware", name: "Air unit hardware" },
    { id: "camera_hardware", moduleDefId: "quadcopter-5in-camera-hardware", name: "Camera hardware" },
    { id: "gps_hardware", moduleDefId: "quadcopter-5in-gps-hardware", name: "GPS hardware" },
    // assembly materials (src/materials.uhd.ts): kitted at the start; the steps that use them say how (docs/docspec.ts)
    { id: "solder", moduleDefId: "quad-solder-wire", name: "Solder wire" },
    { id: "flux", moduleDefId: "quad-flux", name: "Flux" },
    { id: "threadlocker", moduleDefId: "quad-threadlocker", name: "Threadlocker" },
    { id: "rx_sleeve", moduleDefId: "quad-receiver-heat-shrink", name: "Receiver heat-shrink sleeve" },
    { id: "mount_tape", moduleDefId: "quad-foam-mount-tape", name: "Foam mounting tape" },
    { id: "cable_ties", moduleDefId: "quad-cable-ties", name: "Cable ties" },
  ],
  links: [
    // Power: the pack's XT60 into the lead, the lead soldered to the ESC pads
    // (a link-scoped composition: the ESC has no connector there). UHD derives
    // battery_out -> bat_in and battery_gnd -> bat_neg through the lead.
    link("battery_plug", "XT60", ["battery", "xt60"], ["xt60_lead", "end_battery"]),
    {
      id: "battery_pads",
      name: "ESC battery pads",
      a: { child: "xt60_lead", interfaceId: "end_esc" },
      b: { child: "stack", interfaceId: "battery_pads", compose: { p1: "bat_in", p2: "bat_neg" } },
    },
    // The bulk capacitor's own leads, soldered into the same pads' holes (+ to +).
    {
      id: "bulk_cap_can",
      name: "Capacitor leads",
      a: { child: "bulk_cap", interfaceId: "leads", compose: { p1: "pos", p2: "neg" } },
      b: { child: "bulk_cap_leads", interfaceId: "end_cap" },
    },
    {
      id: "bulk_cap_pads",
      name: "Capacitor on the ESC battery pads",
      a: { child: "bulk_cap_leads", interfaceId: "end_esc" },
      b: { child: "stack", interfaceId: "cap_pads", compose: { p1: "bat_in", p2: "bat_neg" } },
    },

    // Propulsion: each motor's own leads (a harness: cut, twisted, soldered)
    // from the motor to its ESC phase pads; UHD derives ESC motor_N ->
    // motor phases through them. Arm -> frame is the motor mount.
    ...ARMS.flatMap((arm) => [
      {
        id: `m${arm.motor}_leads`,
        name: `Motor ${arm.motor} leads`,
        a: { child: arm.id, interfaceId: "motor_leads", compose: { p1: "motor:phases_a", p2: "motor:phases_b", p3: "motor:phases_c" } },
        b: { child: `${arm.id}_leads`, interfaceId: "end_motor" },
      },
      {
        id: `m${arm.motor}_pads`,
        name: `Motor ${arm.motor} pads`,
        a: { child: `${arm.id}_leads`, interfaceId: "end_esc" },
        b: {
          child: "stack",
          interfaceId: `motor_${arm.motor}_pads`,
          compose: { p1: `esc:motor_${arm.motor}_a`, p2: `esc:motor_${arm.motor}_b`, p3: `esc:motor_${arm.motor}_c` },
        },
      },
      link(`${arm.id}_mount`, `${arm.label} mount`, [arm.id, "motor__base_mount"], ["frame", `motor_mount_${corner(arm.id)}`], {
        harness: `${arm.id}_hardware`,
        mate: { rotationDeg: arm.leads },
      }),
    ]),

    // Stack to frame
    // Gaps to each PCB's underside along the M3 screws: 6 mm spacer, 4 mm
    // grommet with the 1.6 mm PCB centred in it, 6 mm spacer, 4 mm grommet
    // (stack hardware's fastenerStack). Both boards mate to the frame's pattern.
    link("stack_mount", "ESC on frame", ["stack", "stack_mount"], ["frame", "stack_mount"], { harness: "stack_hardware", mate: { gapMm: 7.2 } }),
    link("fc_mount", "FC on frame", ["stack", "fc_stack_mount"], ["frame", "stack_mount"], { harness: "stack_hardware", mate: { gapMm: 17.2 } }),
    // Top plate on four 30 mm standoffs
    link("top_plate_mount", "Top plate on standoffs", ["frame", "standoff_mount"], ["top_plate", "standoff_mount"], { harness: "frame_hardware", mate: { gapMm: 30 } }),

    // Receiver: its four included wires, soldered at both ends: CRSF on
    // UART2 (receiver TX -> RX2, RX -> TX2), 5 V BEC, GND. Derived: UART2 <->
    // CRSF, 5 V -> VCC, GND.
    {
      id: "rx_pads",
      name: "Receiver pads",
      a: { child: "receiver", interfaceId: "rx_pads", compose: { p1: "crsf_tx", p2: "crsf_rx", p3: "vcc_5v", p4: "gnd" } },
      b: { child: "rx_wire", interfaceId: "end_rx" },
    },
    {
      id: "rx_fc_pads",
      name: "Receiver wires on the FC",
      a: { child: "rx_wire", interfaceId: "end_fc" },
      b: { child: "stack", interfaceId: "rx_fc_pads", compose: { p1: "fc:uart2_rx", p2: "fc:uart2_tx", p3: "bec_5v", p4: "gnd" } },
    },

    // Video: the 3-in-1 cable from the FC's DJI socket to the O4. Derived
    // through it: 10 V BEC -> VCC, GND x2, UART5 <-> MSP DisplayPort, S.Bus.
    link("dji_fc", "DJI socket", ["stack", "dji_socket"], ["dji_cable", "end_fc"]),
    link("dji_o4", "O4 cable socket", ["dji_cable", "end_o4"], ["video", "fc_cable_socket"]),
    link("camera_mount", "Camera plates", ["video", "camera_mount"], ["frame", "camera_mount"], { harness: "camera_hardware" }),
    // 3 mm airflow spacers under the module (DJI: mount in airflow)
    link("vtx_mount", "Air unit mount", ["video", "tx_module_mount"], ["frame", "vtx_mount"], { harness: "vtx_hardware", mate: { gapMm: 3 } }),

    // GNSS: its GH6P lead plugged into GH6P-2 (the socket facing the rear of
    // the top plate; GH6P-1 faces the battery), the other end soldered to the
    // FC pads (4.5 V rail, UART1, I2C1, GND): the FC's GPS socket has no I2C.
    // Derived: UART1 <-> GNSS UART, I2C1 <-> compass, 4.5 V -> 5V in, GND.
    link("gnss_socket", "GH6P-2", ["gnss", "gh6p_2"], ["gnss_lead", "end_gnss"]),
    {
      id: "gnss_pads",
      name: "GNSS pads",
      a: { child: "gnss_lead", interfaceId: "end_fc" },
      b: {
        child: "stack",
        interfaceId: "gnss_pads",
        compose: { p1: "rail_4v5", p2: "fc:uart1_tx", p3: "fc:uart1_rx", p4: "fc:i2c1_scl", p5: "fc:i2c1_sda", p6: "gnd" },
      },
    },
    // 5 mm standoffs: the GH6P sockets stand 4.35 mm proud of the component side (vendor STEP)
    link("gps_mount", "GPS mount", ["gnss", "mount"], ["top_plate", "gps_mount"], { harness: "gps_hardware", mate: { gapMm: 5 } }),
  ],
};
